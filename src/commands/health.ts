/**
 * Health command — Post-deploy health check
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
  points: number;
  maxPoints: number;
}

function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return vars;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key) vars[key] = val;
    }
  } catch {}

  return vars;
}

async function checkProductionUrl(url: string): Promise<{ ok: boolean; statusCode: number; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    return { ok: res.ok, statusCode: res.status, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, statusCode: 0, latencyMs: Date.now() - start };
  }
}

async function checkSentry(token: string, org: string, project: string): Promise<{ ok: boolean; recentErrors: number }> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&statsPeriod=24h&limit=25`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, recentErrors: -1 };
    const issues = await res.json() as Array<{ count: string }>;
    return { ok: true, recentErrors: issues.length };
  } catch {
    return { ok: false, recentErrors: -1 };
  }
}

export async function health(args: string[]): Promise<void> {
  const showJson = args.includes('--json');
  const cwd = process.cwd();
  const envPath = path.join(cwd, '.env.local');
  const envVars = parseEnvFile(envPath);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  HEALTH CHECK — Post-Deploy Verification                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const checks: HealthCheck[] = [];

  // 1. Production URL check
  const prodUrl = envVars['NEXTAUTH_URL'] || envVars['NEXT_PUBLIC_APP_URL'] || '';
  if (prodUrl) {
    console.log(`  Pinging ${prodUrl}...`);
    const result = await checkProductionUrl(prodUrl);
    if (result.ok) {
      checks.push({
        name: 'Production URL',
        status: 'pass',
        detail: `${result.statusCode} OK — ${result.latencyMs}ms`,
        points: 30,
        maxPoints: 30,
      });
    } else {
      checks.push({
        name: 'Production URL',
        status: 'fail',
        detail: result.statusCode > 0
          ? `HTTP ${result.statusCode} — ${result.latencyMs}ms`
          : `Unreachable after ${result.latencyMs}ms`,
        points: 0,
        maxPoints: 30,
      });
    }
  } else {
    checks.push({
      name: 'Production URL',
      status: 'skip',
      detail: 'No NEXTAUTH_URL or NEXT_PUBLIC_APP_URL found in .env.local',
      points: 0,
      maxPoints: 30,
    });
  }

  // 2. Sentry check
  const sentryToken = envVars['SENTRY_AUTH_TOKEN'] || '';
  const sentryOrg = envVars['SENTRY_ORG'] || '';
  const sentryProject = envVars['SENTRY_PROJECT'] || '';
  if (sentryToken && sentryOrg && sentryProject) {
    console.log('  Checking Sentry for recent errors...');
    const result = await checkSentry(sentryToken, sentryOrg, sentryProject);
    if (result.ok) {
      if (result.recentErrors === 0) {
        checks.push({
          name: 'Sentry Errors (24h)',
          status: 'pass',
          detail: 'No unresolved issues in last 24h',
          points: 25,
          maxPoints: 25,
        });
      } else {
        checks.push({
          name: 'Sentry Errors (24h)',
          status: 'warn',
          detail: `${result.recentErrors} unresolved issues in last 24h`,
          points: 10,
          maxPoints: 25,
        });
      }
    } else {
      checks.push({
        name: 'Sentry Errors (24h)',
        status: 'fail',
        detail: 'Could not reach Sentry API — check token/org/project',
        points: 0,
        maxPoints: 25,
      });
    }
  } else {
    checks.push({
      name: 'Sentry Errors (24h)',
      status: 'skip',
      detail: 'Missing SENTRY_AUTH_TOKEN, SENTRY_ORG, or SENTRY_PROJECT',
      points: 0,
      maxPoints: 25,
    });
  }

  // 3. Git status check
  try {
    const gitStatus = execSync('git status --porcelain 2>/dev/null', { encoding: 'utf-8', cwd }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf-8', cwd }).trim();
    const lastCommit = execSync('git log -1 --format="%h %s" 2>/dev/null', { encoding: 'utf-8', cwd }).trim();

    if (gitStatus.length === 0) {
      checks.push({
        name: 'Git Status',
        status: 'pass',
        detail: `Clean on ${branch} — last: ${lastCommit}`,
        points: 20,
        maxPoints: 20,
      });
    } else {
      const dirtyFiles = gitStatus.split('\n').length;
      checks.push({
        name: 'Git Status',
        status: 'warn',
        detail: `${dirtyFiles} uncommitted changes on ${branch}`,
        points: 10,
        maxPoints: 20,
      });
    }
  } catch {
    checks.push({
      name: 'Git Status',
      status: 'skip',
      detail: 'No git repository detected',
      points: 0,
      maxPoints: 20,
    });
  }

  // 4. DATABASE_URL check
  const dbUrl = envVars['DATABASE_URL'] || process.env.DATABASE_URL || '';
  if (dbUrl) {
    // Mask the URL for display
    const masked = dbUrl.replace(/\/\/[^@]+@/, '//***@');
    checks.push({
      name: 'DATABASE_URL',
      status: 'pass',
      detail: `Set — ${masked.slice(0, 50)}${masked.length > 50 ? '…' : ''}`,
      points: 15,
      maxPoints: 15,
    });
  } else {
    checks.push({
      name: 'DATABASE_URL',
      status: 'fail',
      detail: 'Not set in .env.local or environment',
      points: 0,
      maxPoints: 15,
    });
  }

  // 5. Node.js version check
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  if (major >= 18) {
    checks.push({
      name: 'Node.js Version',
      status: 'pass',
      detail: `${nodeVersion} (18+ required)`,
      points: 10,
      maxPoints: 10,
    });
  } else {
    checks.push({
      name: 'Node.js Version',
      status: 'fail',
      detail: `${nodeVersion} — version 18+ required`,
      points: 0,
      maxPoints: 10,
    });
  }

  console.log('');

  // Calculate score
  const totalPoints = checks.reduce((s, c) => s + c.points, 0);
  const maxPoints = checks.reduce((s, c) => s + c.maxPoints, 0);
  const score = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;

  // JSON output
  if (showJson) {
    const jsonPath = path.join(cwd, 'health-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      score,
      totalPoints,
      maxPoints,
      checks: checks.map(c => ({ name: c.name, status: c.status, detail: c.detail, points: c.points, maxPoints: c.maxPoints })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`  ✓ JSON report saved to ${jsonPath}`);
    console.log('');
    return;
  }

  // Display results
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log(`│  HEALTH SCORE: ${score}/100`.padEnd(62) + '│');
  console.log('├─────────────────────────────────────────────────────────────┤');

  for (const check of checks) {
    let icon: string;
    switch (check.status) {
      case 'pass': icon = '✓'; break;
      case 'fail': icon = '✗'; break;
      case 'warn': icon = '◐'; break;
      case 'skip': icon = '○'; break;
    }
    const pointsStr = `[${check.points}/${check.maxPoints}]`;
    console.log(`│  ${icon} ${check.name.padEnd(22)} ${pointsStr.padEnd(8)} ${check.detail.slice(0, 24).padEnd(24)} │`);
  }

  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');

  // Score interpretation
  if (score >= 90) {
    console.log('  ✓ Excellent — production looks healthy');
  } else if (score >= 70) {
    console.log('  ◐ Good — some items need attention');
  } else if (score >= 50) {
    console.log('  ◐ Fair — review failed checks before shipping');
  } else {
    console.log('  ✗ Poor — address critical issues before deploy');
  }
  console.log('');
}
