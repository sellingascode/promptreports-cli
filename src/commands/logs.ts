/**
 * Logs command — Unified log stream from Sentry and Vercel
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';

interface LogEntry {
  source: string;
  level: string;
  message: string;
  timestamp: string;
  url?: string;
}

function parseTimeWindow(since: string): number {
  const match = since.match(/^(\d+)(h|d|m)$/);
  if (!match) return 3600 * 1000; // default 1h
  const n = parseInt(match[1]);
  switch (match[2]) {
    case 'm': return n * 60 * 1000;
    case 'h': return n * 3600 * 1000;
    case 'd': return n * 86400 * 1000;
    default: return 3600 * 1000;
  }
}

function httpGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

function loadEnvVar(name: string): string | null {
  // Check process.env first
  if (process.env[name]) return process.env[name]!;

  // Check .env.local
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key === name) return value;
    }
  }

  return null;
}

async function fetchSentryIssues(token: string, sinceMs: number): Promise<LogEntry[]> {
  // Discover org and project from DSN or env
  const org = loadEnvVar('SENTRY_ORG') || 'default';
  const project = loadEnvVar('SENTRY_PROJECT') || 'default';

  try {
    const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&sort=date&limit=25`;
    const data = await httpGet(url, {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    });

    const issues = JSON.parse(data);
    if (!Array.isArray(issues)) return [];

    const cutoff = Date.now() - sinceMs;
    const entries: LogEntry[] = [];

    for (const issue of issues) {
      const ts = new Date(issue.lastSeen || issue.firstSeen).getTime();
      if (ts < cutoff) continue;

      entries.push({
        source: 'sentry',
        level: issue.level || 'error',
        message: issue.title || issue.metadata?.value || 'Unknown issue',
        timestamp: issue.lastSeen || issue.firstSeen,
        url: issue.permalink,
      });
    }

    return entries;
  } catch (err: unknown) {
    console.log(`  ○ Sentry: ${err instanceof Error ? err.message : 'Failed to fetch'}`);
    return [];
  }
}

async function fetchVercelDeployments(token: string, sinceMs: number): Promise<LogEntry[]> {
  try {
    const url = 'https://api.vercel.com/v6/deployments?limit=20';
    const data = await httpGet(url, {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    });

    const response = JSON.parse(data);
    const deployments = response.deployments || [];
    const cutoff = Date.now() - sinceMs;
    const entries: LogEntry[] = [];

    for (const dep of deployments) {
      const ts = dep.created || dep.createdAt;
      const tsMs = typeof ts === 'number' ? ts : new Date(ts).getTime();
      if (tsMs < cutoff) continue;

      const state = dep.state || dep.readyState || 'unknown';
      const level = state === 'ERROR' ? 'error' : state === 'CANCELED' ? 'warn' : 'info';

      entries.push({
        source: 'vercel',
        level,
        message: `Deploy ${dep.uid?.substring(0, 8) || '?'}: ${state} — ${dep.meta?.githubCommitMessage || dep.name || ''}`,
        timestamp: new Date(tsMs).toISOString(),
        url: dep.url ? `https://${dep.url}` : undefined,
      });
    }

    return entries;
  } catch (err: unknown) {
    console.log(`  ○ Vercel: ${err instanceof Error ? err.message : 'Failed to fetch'}`);
    return [];
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').substring(0, 19);
  } catch {
    return iso.substring(0, 19);
  }
}

export async function logs(args: string[]): Promise<void> {
  const showJson = args.includes('--json');

  // --source filter
  const sourceIdx = args.indexOf('--source');
  const sourceFilter = sourceIdx >= 0 ? args[sourceIdx + 1]?.split(',') || [] : [];

  // --since time window
  const sinceIdx = args.indexOf('--since');
  const sinceStr = sinceIdx >= 0 ? args[sinceIdx + 1] || '1h' : '1h';
  const sinceMs = parseTimeWindow(sinceStr);

  // --level filter
  const levelIdx = args.indexOf('--level');
  const levelFilter = levelIdx >= 0 ? args[levelIdx + 1]?.split(',') || [] : [];

  // --search filter
  const searchIdx = args.indexOf('--search');
  const searchTerm = searchIdx >= 0 ? args[searchIdx + 1] || '' : '';

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  UNIFIED LOG STREAM                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const sentryToken = loadEnvVar('SENTRY_AUTH_TOKEN');
  const vercelToken = loadEnvVar('VERCEL_TOKEN');

  const doSentry = sentryToken && (sourceFilter.length === 0 || sourceFilter.includes('sentry'));
  const doVercel = vercelToken && (sourceFilter.length === 0 || sourceFilter.includes('vercel'));

  if (!doSentry && !doVercel) {
    console.log('  No log sources configured. Set one or more:');
    console.log('');
    if (!sentryToken) console.log('    ○ SENTRY_AUTH_TOKEN — for Sentry issues');
    if (!vercelToken) console.log('    ○ VERCEL_TOKEN     — for Vercel deployments');
    console.log('');
    console.log('  Add to .env.local or environment variables.');
    return;
  }

  console.log(`  Time window: last ${sinceStr}`);
  console.log(`  Sources: ${[doSentry && 'sentry', doVercel && 'vercel'].filter(Boolean).join(', ')}`);
  if (levelFilter.length > 0) console.log(`  Levels: ${levelFilter.join(', ')}`);
  if (searchTerm) console.log(`  Search: "${searchTerm}"`);
  console.log('');

  // Fetch from all sources in parallel
  const fetches: Promise<LogEntry[]>[] = [];
  if (doSentry) {
    console.log('  Fetching Sentry issues...');
    fetches.push(fetchSentryIssues(sentryToken!, sinceMs));
  }
  if (doVercel) {
    console.log('  Fetching Vercel deployments...');
    fetches.push(fetchVercelDeployments(vercelToken!, sinceMs));
  }

  const results = await Promise.all(fetches);
  let entries = results.flat();

  // Apply filters
  if (levelFilter.length > 0) {
    entries = entries.filter(e => levelFilter.includes(e.level));
  }
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    entries = entries.filter(e => e.message.toLowerCase().includes(lower));
  }

  // Sort by timestamp descending
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  console.log('');

  if (entries.length === 0) {
    console.log('  No log entries found for the given filters.');
    return;
  }

  // Display table
  console.log('  ┌──────────┬───────────────────────┬───────┬───────────────────────────────┐');
  console.log('  │ Source   │ Timestamp             │ Level │ Message                       │');
  console.log('  ├──────────┼───────────────────────┼───────┼───────────────────────────────┤');

  for (const entry of entries.slice(0, 50)) {
    const source = entry.source.padEnd(8);
    const ts = formatTimestamp(entry.timestamp).padEnd(21);
    const level = entry.level.padEnd(5);
    const icon = entry.level === 'error' ? '✗' : entry.level === 'warn' ? '!' : '○';
    const msg = entry.message.length > 29 ? entry.message.substring(0, 26) + '...' : entry.message.padEnd(29);
    console.log(`  │ ${source} │ ${ts} │ ${icon} ${level} │ ${msg} │`);
  }

  console.log('  └──────────┴───────────────────────┴───────┴───────────────────────────────┘');

  if (entries.length > 50) {
    console.log(`  ... and ${entries.length - 50} more entries`);
  }

  console.log('');
  console.log(`  ${entries.length} entries total`);

  // Summary by source
  const bySrc = new Map<string, number>();
  const byLevel = new Map<string, number>();
  for (const e of entries) {
    bySrc.set(e.source, (bySrc.get(e.source) || 0) + 1);
    byLevel.set(e.level, (byLevel.get(e.level) || 0) + 1);
  }

  console.log('');
  console.log('  By source: ' + Array.from(bySrc.entries()).map(([s, c]) => `${s}: ${c}`).join(', '));
  console.log('  By level:  ' + Array.from(byLevel.entries()).map(([l, c]) => `${l}: ${c}`).join(', '));

  if (showJson) {
    const outPath = path.join(process.cwd(), 'logs-report.json');
    fs.writeFileSync(outPath, JSON.stringify({ entries, summary: { bySrc: Object.fromEntries(bySrc), byLevel: Object.fromEntries(byLevel) } }, null, 2));
    console.log('');
    console.log(`  ✓ JSON exported to ${outPath}`);
  }

  console.log('');
}
