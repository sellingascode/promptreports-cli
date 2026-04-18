/**
 * health command — Post-deploy health check across all services.
 */

import { execSync } from 'node:child_process';
import type { GlobalFlags } from '../cli';
import { discoverFromProject } from '../../fetchers/env-discovery';
import { runAllFetchers } from '../../fetchers/index';
import { colorize, statusIcon, box, formatCost } from '../utils/format';

interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
  value?: string;
}

async function getLastDeploy(token: string): Promise<{ hash: string; time: string; state: string } | null> {
  try {
    const res = await fetch('https://api.vercel.com/v6/deployments?limit=1&state=READY', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.deployments?.[0];
    if (!d) return null;
    return { hash: d.meta?.githubCommitSha?.slice(0, 8) || '', time: new Date(d.created).toISOString(), state: d.state };
  } catch {
    return null;
  }
}

async function checkSentryErrors(token: string, sinceMs: number): Promise<HealthCheck> {
  const org = process.env.SENTRY_ORG || '';
  const project = process.env.SENTRY_PROJECT || '';
  if (!org || !project) {
    return { name: 'Sentry errors', status: 'warning', detail: 'SENTRY_ORG or SENTRY_PROJECT not set' };
  }
  try {
    const hours = Math.max(1, Math.round(sinceMs / 3600000));
    const res = await fetch(
      `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&statsPeriod=${hours}h&limit=5`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return { name: 'Sentry errors', status: 'warning', detail: `API returned ${res.status}` };
    const issues = await res.json();
    const count = (issues as any[]).length;
    if (count === 0) return { name: 'Sentry errors', status: 'ok', detail: '0 new errors since deploy' };
    return { name: 'Sentry errors', status: count > 3 ? 'error' : 'warning', detail: `${count} unresolved issues`, value: String(count) };
  } catch (e) {
    return { name: 'Sentry errors', status: 'warning', detail: 'Failed to fetch' };
  }
}

async function checkProductionUrl(): Promise<HealthCheck> {
  const url = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (!url) return { name: 'Production URL', status: 'warning', detail: 'NEXTAUTH_URL not set' };
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - start;
    if (res.ok) return { name: 'Production URL', status: 'ok', detail: `Responding (${ms}ms)`, value: `${ms}ms` };
    return { name: 'Production URL', status: 'error', detail: `HTTP ${res.status} (${ms}ms)` };
  } catch {
    return { name: 'Production URL', status: 'error', detail: 'Not responding' };
  }
}

async function checkProviderBilling(days: number): Promise<HealthCheck> {
  const { envVars } = discoverFromProject(process.cwd());
  try {
    const results = await runAllFetchers(envVars, days, 'p0');
    const okProviders = results.filter(r => r.status === 'ok');
    const totalCost = okProviders.reduce((sum, r) => sum + r.cost.amount, 0);
    const errors = results.filter(r => r.status === 'error');
    if (errors.length > 0) {
      return { name: 'Provider billing', status: 'warning', detail: `${errors.length} providers returned errors`, value: formatCost(totalCost) };
    }
    return { name: 'Provider billing', status: 'ok', detail: `${okProviders.length} providers — ${formatCost(totalCost)} total`, value: formatCost(totalCost) };
  } catch {
    return { name: 'Provider billing', status: 'warning', detail: 'Failed to scan providers' };
  }
}

function checkGitStatus(): HealthCheck {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    const uncommitted = status.split('\n').filter(l => l.trim()).length;
    if (uncommitted === 0) return { name: 'Git status', status: 'ok', detail: 'Clean working tree' };
    return { name: 'Git status', status: 'warning', detail: `${uncommitted} uncommitted changes` };
  } catch {
    return { name: 'Git status', status: 'warning', detail: 'Not a git repository' };
  }
}

function checkDatabaseUrl(): HealthCheck {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl) return { name: 'Database URL', status: 'warning', detail: 'DATABASE_URL not set' };
  return { name: 'Database URL', status: 'ok', detail: 'Set' };
}

export async function healthCommand(flags: GlobalFlags): Promise<void> {
  const vercelToken = process.env.VERCEL_TOKEN || '';
  const sentryToken = process.env.SENTRY_AUTH_TOKEN || '';

  // Get last deploy time to determine "since" window
  let sinceMs = flags.days * 86400000;
  let lastDeploy: { hash: string; time: string; state: string } | null = null;

  if (vercelToken) {
    lastDeploy = await getLastDeploy(vercelToken);
    if (lastDeploy) {
      sinceMs = Date.now() - new Date(lastDeploy.time).getTime();
    }
  }

  // Run all checks in parallel
  const checkPromises: Promise<HealthCheck>[] = [
    checkProductionUrl(),
    checkProviderBilling(flags.days),
  ];
  if (sentryToken) checkPromises.push(checkSentryErrors(sentryToken, sinceMs));

  const asyncChecks = await Promise.all(checkPromises);
  const syncChecks = [checkGitStatus(), checkDatabaseUrl()];
  const checks = [...asyncChecks, ...syncChecks];

  // Calculate score
  const scores: number[] = checks.map(c => c.status === 'ok' ? 100 : c.status === 'warning' ? 50 : 0);
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  if (flags.json) {
    console.log(JSON.stringify({ score: overallScore, checks, lastDeploy }, null, 2));
    return;
  }

  const statusLabel = (s: HealthCheck['status']) => {
    if (s === 'ok') return colorize('OK', 'green');
    if (s === 'warning') return colorize('WARN', 'yellow');
    return colorize('ERR', 'red');
  };

  const lines: string[] = [];
  if (lastDeploy) {
    lines.push(colorize(`Since deploy ${lastDeploy.hash} — ${new Date(lastDeploy.time).toLocaleString()}`, 'dim'));
    lines.push('');
  }

  for (const check of checks) {
    lines.push(`  ${statusLabel(check.status).padEnd(20)} ${check.name.padEnd(22)} ${colorize(check.detail, 'dim')}`);
  }

  lines.push('');
  const scoreColor = overallScore >= 80 ? 'green' : overallScore >= 50 ? 'yellow' : 'red';
  lines.push(`Score: ${colorize(`${overallScore}/100`, scoreColor)}`);

  box('Health Check', lines.join('\n'));
}
