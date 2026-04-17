/**
 * Env Sync command — Compare .env.local vs Vercel environment variables
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface EnvEntry {
  key: string;
  local: boolean;
  vercel: boolean;
  status: 'healthy' | 'missing-vercel' | 'missing-local' | 'drift';
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

function getVercelProjectId(cwd: string): string | null {
  // Check .vercel/project.json
  const vercelProjectPath = path.join(cwd, '.vercel', 'project.json');
  if (fs.existsSync(vercelProjectPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(vercelProjectPath, 'utf-8'));
      if (content.projectId) return content.projectId;
    } catch {}
  }

  // Check env for VERCEL_PROJECT_ID
  const envPath = path.join(cwd, '.env.local');
  const envVars = parseEnvFile(envPath);
  if (envVars['VERCEL_PROJECT_ID']) return envVars['VERCEL_PROJECT_ID'];

  return null;
}

async function fetchVercelEnv(token: string, projectId: string): Promise<Record<string, boolean>> {
  const url = `https://api.vercel.com/v9/projects/${projectId}/env`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.log(`  ✗ Vercel API returned ${res.status}: ${res.statusText}`);
      return {};
    }
    const data = await res.json() as { envs?: Array<{ key: string }> };
    const keys: Record<string, boolean> = {};
    if (data.envs) {
      for (const env of data.envs) {
        keys[env.key] = true;
      }
    }
    return keys;
  } catch (err: any) {
    console.log(`  ✗ Failed to fetch Vercel env: ${err.message}`);
    return {};
  }
}

export async function envSync(args: string[]): Promise<void> {
  const showDiff = args.includes('--diff');
  const showMerge = args.includes('--merge');
  const showBackup = args.includes('--backup');
  const showJson = args.includes('--json');

  const cwd = process.cwd();
  const envPath = path.join(cwd, '.env.local');

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ENV SYNC — Local vs Vercel Environment Check               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Parse local .env.local
  const localVars = parseEnvFile(envPath);
  const localKeys = Object.keys(localVars);

  if (localKeys.length === 0) {
    console.log('  ✗ No .env.local found or file is empty');
    console.log(`    Expected at: ${envPath}`);
    console.log('');
    return;
  }

  console.log(`  ✓ Local .env.local — ${localKeys.length} variables`);

  // 2. Backup if requested
  if (showBackup) {
    const backupPath = envPath + '.backup.' + new Date().toISOString().slice(0, 10);
    try {
      fs.copyFileSync(envPath, backupPath);
      console.log(`  ✓ Backup saved to ${backupPath}`);
    } catch (err: any) {
      console.log(`  ✗ Backup failed: ${err.message}`);
    }
  }

  // 3. Check Vercel token
  const vercelToken = localVars['VERCEL_TOKEN'] || process.env.VERCEL_TOKEN;
  const projectId = getVercelProjectId(cwd);

  let vercelKeys: Record<string, boolean> = {};
  let hasVercel = false;

  if (!vercelToken) {
    console.log('  ○ No VERCEL_TOKEN found — Vercel comparison skipped');
    console.log('    Set VERCEL_TOKEN in .env.local or environment to enable');
  } else if (!projectId) {
    console.log('  ○ No Vercel project ID found — check .vercel/project.json or VERCEL_PROJECT_ID');
  } else {
    console.log(`  ✓ Vercel project: ${projectId}`);
    console.log('  Fetching Vercel environment...');
    vercelKeys = await fetchVercelEnv(vercelToken, projectId);
    hasVercel = Object.keys(vercelKeys).length > 0;
    if (hasVercel) {
      console.log(`  ✓ Vercel — ${Object.keys(vercelKeys).length} variables`);
    }
  }

  console.log('');

  // 4. Build comparison table
  const allKeys = new Set<string>([...localKeys, ...Object.keys(vercelKeys)]);
  const entries: EnvEntry[] = [];

  for (const key of Array.from(allKeys).sort()) {
    const inLocal = key in localVars;
    const inVercel = key in vercelKeys;
    let status: EnvEntry['status'] = 'healthy';

    if (inLocal && !inVercel && hasVercel) status = 'missing-vercel';
    else if (!inLocal && inVercel) status = 'missing-local';
    else if (inLocal && inVercel) status = 'healthy';
    else status = 'healthy'; // local only, no vercel comparison

    entries.push({ key, local: inLocal, vercel: inVercel, status });
  }

  // 5. JSON output
  if (showJson) {
    const jsonPath = path.join(cwd, 'env-sync-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      localCount: localKeys.length,
      vercelCount: Object.keys(vercelKeys).length,
      hasVercel,
      entries: entries.map(e => ({ key: e.key, local: e.local, vercel: e.vercel, status: e.status })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`  ✓ JSON report saved to ${jsonPath}`);
    console.log('');
    return;
  }

  // 6. Display table
  const keyWidth = Math.min(40, Math.max(20, ...entries.map(e => e.key.length + 2)));

  console.log('┌' + '─'.repeat(keyWidth) + '┬─────────┬─────────┬─────────────────┐');
  console.log('│' + ' Key'.padEnd(keyWidth) + '│ Local   │ Vercel  │ Status          │');
  console.log('├' + '─'.repeat(keyWidth) + '┼─────────┼─────────┼─────────────────┤');

  let healthy = 0;
  let missingVercel = 0;
  let missingLocal = 0;

  for (const entry of entries) {
    const localIcon = entry.local ? '  ✓    ' : '  ✗    ';
    const vercelIcon = hasVercel ? (entry.vercel ? '  ✓    ' : '  ✗    ') : '  ─    ';
    let statusText: string;
    switch (entry.status) {
      case 'healthy':        statusText = ' ✓ healthy       '; healthy++; break;
      case 'missing-vercel': statusText = ' ✗ missing-vercel'; missingVercel++; break;
      case 'missing-local':  statusText = ' ✗ missing-local '; missingLocal++; break;
      default:               statusText = ' ○ unknown       '; break;
    }

    const displayKey = entry.key.length > keyWidth - 2
      ? ' ' + entry.key.slice(0, keyWidth - 4) + '… '
      : (' ' + entry.key).padEnd(keyWidth);

    if (showDiff && entry.status === 'healthy') continue;

    console.log('│' + displayKey + '│' + localIcon + '│' + vercelIcon + '│' + statusText + '│');
  }

  console.log('└' + '─'.repeat(keyWidth) + '┴─────────┴─────────┴─────────────────┘');
  console.log('');

  // 7. Summary
  console.log(`  Summary: ${healthy} healthy, ${missingVercel} missing in Vercel, ${missingLocal} missing locally`);

  if (showMerge && (missingVercel > 0 || missingLocal > 0)) {
    console.log('');
    console.log('  Merge suggestions:');
    for (const entry of entries) {
      if (entry.status === 'missing-vercel') {
        console.log(`    → Add ${entry.key} to Vercel: vercel env add ${entry.key}`);
      }
      if (entry.status === 'missing-local') {
        console.log(`    → Add ${entry.key} to .env.local from Vercel`);
      }
    }
  }

  console.log('');
}
