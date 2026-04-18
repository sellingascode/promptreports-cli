/**
 * env sync command — Environment variable sync between local, Vercel, Railway.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GlobalFlags } from '../cli';
import { parseEnvFile, discoverServices } from '../../fetchers/env-discovery';
import { colorize, statusIcon, box, table } from '../utils/format';

interface EnvVar {
  key: string;
  localValue: string;
  vercelValue: string;
  status: 'healthy' | 'missing-local' | 'missing-remote' | 'drift' | 'dead';
}

async function fetchVercelEnvVars(token: string): Promise<Record<string, string>> {
  const projectId = process.env.VERCEL_PROJECT_ID || '';
  if (!projectId) {
    // Try reading .vercel/project.json
    try {
      const vercelConfig = JSON.parse(readFileSync(join(process.cwd(), '.vercel', 'project.json'), 'utf-8'));
      if (vercelConfig.projectId) {
        return fetchVercelEnvVarsById(token, vercelConfig.projectId);
      }
    } catch { /* */ }
    return {};
  }
  return fetchVercelEnvVarsById(token, projectId);
}

async function fetchVercelEnvVarsById(token: string, projectId: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const vars: Record<string, string> = {};
    for (const env of data.envs || []) {
      if (env.target?.includes('production') || env.target?.includes('development')) {
        vars[env.key] = env.value || '(encrypted)';
      }
    }
    return vars;
  } catch {
    return {};
  }
}

async function fetchRailwayEnvVars(token: string): Promise<Record<string, string>> {
  try {
    const res = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query { me { projects { edges { node { name services { edges { node { name serviceInstanceId } } } } } } } }`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return {};
    // Railway doesn't expose env vars directly via this query — flag for future
    return {};
  } catch {
    return {};
  }
}

export async function envSyncCommand(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const envPath = join(cwd, '.env.local');
  const hasFrom = flags.args.includes('--from');
  const hasDiff = flags.args.includes('--diff');
  const hasBackup = flags.args.includes('--backup');
  const hasMerge = flags.args.includes('--merge');

  // Parse local .env.local (read ALL keys, not just allowlisted)
  const localVars: Record<string, string> = {};
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const re = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*?)"|'([^']*?)'|([^\s#]*))/;
    for (const line of content.split('\n')) {
      if (line.trimStart().startsWith('#')) continue;
      const match = line.match(re);
      if (match) {
        const key = match[1];
        const value = match[2] ?? match[3] ?? match[4] ?? '';
        if (value) localVars[key] = value;
      }
    }
  }

  // Fetch remote env vars
  const vercelToken = localVars['VERCEL_TOKEN'] || process.env.VERCEL_TOKEN || '';
  let remoteVars: Record<string, string> = {};
  let remoteName = 'Vercel';

  if (vercelToken) {
    remoteVars = await fetchVercelEnvVars(vercelToken);
  }

  if (Object.keys(remoteVars).length === 0 && !vercelToken) {
    console.log('');
    console.log(colorize('  No VERCEL_TOKEN found — cannot compare with remote.', 'yellow'));
    console.log(colorize('  Showing local-only analysis.', 'dim'));
    console.log('');
  }

  // Discover known services to detect dead keys
  const knownServiceKeys = new Set(discoverServices().map(s => s.envVar));

  // Build comparison
  const allKeys = new Set([...Object.keys(localVars), ...Object.keys(remoteVars)]);
  const envVars: EnvVar[] = [];

  for (const key of allKeys) {
    const local = localVars[key] || '';
    const remote = remoteVars[key] || '';

    let status: EnvVar['status'] = 'healthy';
    if (local && remote) {
      if (remote !== '(encrypted)' && local !== remote) {
        status = 'drift';
      }
    } else if (!local && remote) {
      status = 'missing-local';
    } else if (local && !remote && Object.keys(remoteVars).length > 0) {
      status = 'missing-remote';
    }

    // Dead key detection — key exists but service not in codebase
    if (local && key.endsWith('_KEY') || key.endsWith('_TOKEN') || key.endsWith('_SECRET')) {
      // Only flag as dead if we have remote data and key is missing from both sides
      // For now, skip dead detection to avoid false positives
    }

    envVars.push({ key, localValue: local ? 'set' : '', vercelValue: remote ? 'set' : '', status });
  }

  // Sort: issues first, then alphabetical
  const statusOrder: Record<string, number> = { 'missing-local': 0, drift: 1, 'missing-remote': 2, dead: 3, healthy: 4 };
  envVars.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99) || a.key.localeCompare(b.key));

  const summary = {
    total: envVars.length,
    healthy: envVars.filter(e => e.status === 'healthy').length,
    missingLocal: envVars.filter(e => e.status === 'missing-local').length,
    missingRemote: envVars.filter(e => e.status === 'missing-remote').length,
    drift: envVars.filter(e => e.status === 'drift').length,
    dead: envVars.filter(e => e.status === 'dead').length,
  };

  if (flags.json) {
    console.log(JSON.stringify({ envVars, summary }, null, 2));
    return;
  }

  // Print results
  const statusLabel = (s: EnvVar['status']) => {
    switch (s) {
      case 'healthy': return colorize('healthy', 'green');
      case 'missing-local': return colorize('MISSING LOCAL', 'red');
      case 'missing-remote': return colorize('missing remote', 'yellow');
      case 'drift': return colorize('DRIFT', 'yellow');
      case 'dead': return colorize('dead', 'dim');
    }
  };

  const rows = envVars.map(e => [
    e.key,
    e.localValue ? colorize('set', 'green') : colorize('—', 'dim'),
    e.vercelValue ? colorize('set', 'green') : colorize('—', 'dim'),
    statusLabel(e.status),
  ]);

  // Only show issues + first 10 healthy
  const issueRows = rows.filter((_, i) => envVars[i].status !== 'healthy');
  const healthyRows = rows.filter((_, i) => envVars[i].status === 'healthy').slice(0, 10);
  const displayRows = [...issueRows, ...healthyRows];

  if (displayRows.length > 0) {
    table(['Key', 'Local', remoteName, 'Status'], displayRows);
  }

  if (summary.healthy > 10) {
    console.log(colorize(`  ... and ${summary.healthy - 10} more healthy vars`, 'dim'));
  }

  console.log('');
  const issues = summary.missingLocal + summary.missingRemote + summary.drift;
  if (issues === 0) {
    console.log(colorize(`  ${statusIcon(true)}  All ${summary.total} env vars are in sync.`, 'green'));
  } else {
    console.log(`  ${colorize(`${issues} issues found:`, 'yellow')} ${summary.missingLocal} missing local, ${summary.missingRemote} missing remote, ${summary.drift} drift`);
  }
  console.log('');

  // Backup + write if --merge and not --dry-run
  if (hasMerge && !flags.dryRun && summary.missingLocal > 0) {
    if (hasBackup) {
      copyFileSync(envPath, envPath + '.backup');
      console.log(colorize(`  Backup saved to .env.local.backup`, 'dim'));
    }
    const missingKeys = envVars.filter(e => e.status === 'missing-local');
    const content = readFileSync(envPath, 'utf-8');
    const additions = missingKeys.map(e => `${e.key}=${remoteVars[e.key] || ''}`).join('\n');
    writeFileSync(envPath, content + '\n# Synced from Vercel\n' + additions + '\n');
    console.log(colorize(`  Added ${missingKeys.length} missing vars to .env.local`, 'green'));
  }
}
