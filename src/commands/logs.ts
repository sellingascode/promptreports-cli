/**
 * logs command — Unified log stream from Sentry, Vercel, PostHog.
 */

import type { GlobalFlags } from '../cli';
import { colorize, box, table } from '../utils/format';

interface LogEntry {
  timestamp: string;
  source: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  route?: string;
}

function parseSince(since: string): number {
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (!match) return 2 * 3600 * 1000; // default 2h
  const val = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 3600 * 1000;
  return val * 86400 * 1000;
}

async function fetchSentryIssues(token: string, sinceMs: number): Promise<LogEntry[]> {
  const org = process.env.SENTRY_ORG || '';
  const project = process.env.SENTRY_PROJECT || '';
  if (!org || !project) {
    // Try to parse from DSN
    return [];
  }

  const hours = Math.max(1, Math.round(sinceMs / 3600000));
  const statsPeriod = hours <= 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;

  try {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&statsPeriod=${statsPeriod}&limit=25`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];
    const issues = await res.json();
    return (issues as any[]).map(issue => ({
      timestamp: issue.lastSeen || issue.firstSeen || new Date().toISOString(),
      source: 'sentry',
      level: issue.level === 'error' ? 'error' as const : 'warn' as const,
      message: `${issue.title} (${issue.count || 0} events)`,
      route: issue.culprit || '',
    }));
  } catch {
    return [];
  }
}

async function fetchVercelDeployments(token: string, sinceMs: number): Promise<LogEntry[]> {
  const since = Date.now() - sinceMs;
  try {
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?limit=20&since=${since}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.deployments || []) as any[]).map(d => ({
      timestamp: new Date(d.created).toISOString(),
      source: 'vercel',
      level: d.state === 'ERROR' ? 'error' as const : 'info' as const,
      message: `Deploy ${d.state}: ${d.meta?.githubCommitMessage || d.url || ''}`.trim(),
      route: d.url || '',
    }));
  } catch {
    return [];
  }
}

async function fetchPostHogErrors(token: string, sinceMs: number): Promise<LogEntry[]> {
  const projectId = process.env.POSTHOG_PROJECT_ID || '';
  const host = process.env.POSTHOG_HOST || 'https://app.posthog.com';
  if (!projectId) return [];

  try {
    const after = new Date(Date.now() - sinceMs).toISOString();
    const res = await fetch(
      `${host}/api/projects/${projectId}/events/?event=$exception&after=${after}&limit=20`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.results || []) as any[]).map(e => ({
      timestamp: e.timestamp || new Date().toISOString(),
      source: 'posthog',
      level: 'error' as const,
      message: e.properties?.$exception_message || e.event || 'Exception',
      route: e.properties?.$current_url || '',
    }));
  } catch {
    return [];
  }
}

export async function logsCommand(flags: GlobalFlags): Promise<void> {
  // Parse command-specific flags
  const sourceIdx = flags.args.indexOf('--source');
  const sources = sourceIdx >= 0 ? (flags.args[sourceIdx + 1] || '').split(',') : ['sentry', 'vercel', 'posthog'];
  const sinceIdx = flags.args.indexOf('--since');
  const sinceStr = sinceIdx >= 0 ? (flags.args[sinceIdx + 1] || '2h') : '2h';
  const sinceMs = parseSince(sinceStr);
  const levelIdx = flags.args.indexOf('--level');
  const levelFilter = levelIdx >= 0 ? (flags.args[levelIdx + 1] || '').split(',') : [];
  const searchIdx = flags.args.indexOf('--search');
  const searchTerm = searchIdx >= 0 ? (flags.args[searchIdx + 1] || '') : '';

  const sentryToken = process.env.SENTRY_AUTH_TOKEN || '';
  const vercelToken = process.env.VERCEL_TOKEN || '';
  const posthogToken = process.env.POSTHOG_PERSONAL_API_KEY || '';

  // Fetch from all sources in parallel
  const fetches: Promise<LogEntry[]>[] = [];
  const activeSourceNames: string[] = [];

  if (sources.includes('sentry') && sentryToken) {
    fetches.push(fetchSentryIssues(sentryToken, sinceMs));
    activeSourceNames.push('Sentry');
  }
  if (sources.includes('vercel') && vercelToken) {
    fetches.push(fetchVercelDeployments(vercelToken, sinceMs));
    activeSourceNames.push('Vercel');
  }
  if (sources.includes('posthog') && posthogToken) {
    fetches.push(fetchPostHogErrors(posthogToken, sinceMs));
    activeSourceNames.push('PostHog');
  }

  if (fetches.length === 0) {
    console.log('');
    console.log(colorize('  No log sources configured. Set SENTRY_AUTH_TOKEN, VERCEL_TOKEN, or POSTHOG_PERSONAL_API_KEY.', 'yellow'));
    console.log('');
    return;
  }

  const results = await Promise.allSettled(fetches);
  let logs: LogEntry[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') logs.push(...result.value);
  }

  // Apply filters
  if (levelFilter.length > 0) {
    logs = logs.filter(l => levelFilter.includes(l.level));
  }
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    logs = logs.filter(l => l.message.toLowerCase().includes(lower) || (l.route || '').toLowerCase().includes(lower));
  }

  // Sort by timestamp descending
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (flags.json) {
    console.log(JSON.stringify({ logs, sources: activeSourceNames }, null, 2));
    return;
  }

  if (logs.length === 0) {
    console.log('');
    console.log(colorize(`  No logs found in the last ${sinceStr} from: ${activeSourceNames.join(', ')}`, 'green'));
    console.log('');
    return;
  }

  const levelColor = (l: string) => {
    if (l === 'error') return colorize('ERR', 'red');
    if (l === 'warn') return colorize('WRN', 'yellow');
    return colorize('INF', 'dim');
  };

  const sourceColor = (s: string) => {
    if (s === 'sentry') return colorize('Sentry', 'magenta');
    if (s === 'vercel') return colorize('Vercel', 'cyan');
    return colorize('PostHog', 'blue');
  };

  const rows = logs.slice(0, 30).map(l => [
    colorize(new Date(l.timestamp).toLocaleTimeString(), 'dim'),
    sourceColor(l.source),
    levelColor(l.level),
    l.message.slice(0, 70),
  ]);

  table(['Time', 'Source', 'Level', 'Message'], rows);

  if (logs.length > 30) {
    console.log(colorize(`  ... and ${logs.length - 30} more entries. Use --json for full output.`, 'dim'));
  }

  // Summary
  const errors = logs.filter(l => l.level === 'error').length;
  const warns = logs.filter(l => l.level === 'warn').length;
  console.log('');
  console.log(`  ${colorize(`${logs.length} entries`, 'bold')} from ${activeSourceNames.join(', ')} — ${colorize(`${errors} errors`, errors > 0 ? 'red' : 'green')}, ${colorize(`${warns} warnings`, warns > 0 ? 'yellow' : 'green')}`);
  console.log('');
}
