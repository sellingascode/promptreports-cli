/**
 * push command — Push token stats to PromptReports.ai.
 *
 * Builds PlatformPayload from session analysis and POSTs to the platform.
 * Maintains a checkpoint file for delta pushes.
 * Batches 500 turns per request to stay under Vercel body size limits.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GlobalFlags } from '../cli';
import {
  scanProjectSessions,
  parseSession,
  analyzeSession,
  buildPayload,
  type SessionStats,
  type PlatformPayload,
} from '../utils/session-scanner';
import { colorize, formatTokens, formatCost } from '../utils/format';

const BATCH_SIZE = 500;
const CHECKPOINT_FILE = '.claude/.token-push-checkpoint.json';

export async function pushCommand(flags: GlobalFlags): Promise<void> {
  const { days, dryRun, quiet } = flags;

  // Load env
  loadEnvLocal();

  const apiKey = process.env['PROMPTREPORTS_API_KEY'];
  const url = process.env['PROMPTREPORTS_URL'] || 'https://www.promptreports.ai';

  if (!apiKey) {
    console.error(colorize('  No PROMPTREPORTS_API_KEY found. Set it in .env.local or environment.', 'red'));
    process.exit(1);
  }

  // Scan and analyze sessions
  const jsonlFiles = scanProjectSessions(days);
  if (jsonlFiles.length === 0) {
    console.log(colorize('  No sessions found.', 'yellow'));
    return;
  }

  const allStats: SessionStats[] = [];
  for (const file of jsonlFiles) {
    const entries = parseSession(file);
    const stats = analyzeSession(entries, days);
    if (stats) allStats.push(stats);
  }

  if (allStats.length === 0) {
    console.log(colorize(`  No sessions in the last ${days} days.`, 'yellow'));
    return;
  }

  const payload = buildPayload(allStats, days);

  if (!quiet) {
    console.log('');
    console.log(colorize('  Push Summary', 'bold'));
    console.log(`  Sessions:  ${allStats.length}`);
    console.log(`  Turns:     ${payload.turns.length}`);
    console.log(`  Tokens:    ${formatTokens(payload.aggregate.totalTokens)}`);
    console.log(`  Cost:      ${formatCost(payload.aggregate.estimatedCostUsd)}`);
    console.log('');
  }

  // Delta push: filter to turns not already pushed
  const checkpointPath = join(process.cwd(), CHECKPOINT_FILE);
  let lastPushedKeys = new Set<string>();
  try {
    if (existsSync(checkpointPath)) {
      const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
      lastPushedKeys = new Set(checkpoint.turnKeys || []);
      if (!quiet) {
        console.log(`  Last push: ${lastPushedKeys.size} turns already synced`);
      }
    }
  } catch {
    // No checkpoint yet — push everything
  }

  const allTurnKeys = payload.turns.map(t => `${t.sessionId || ''}-${t.turnNumber}-${t.timestamp}`);
  const newTurns = payload.turns.filter((_, i) => !lastPushedKeys.has(allTurnKeys[i]));

  if (newTurns.length === 0 && lastPushedKeys.size > 0) {
    console.log(colorize('  Already up to date \u2014 no new turns to push.', 'green'));
    return;
  }

  if (!quiet) {
    console.log(`  New turns: ${newTurns.length} (${payload.turns.length - newTurns.length} already synced)`);
  }

  if (dryRun) {
    console.log('');
    console.log(colorize('  --dry-run: Would push the above data. No changes made.', 'yellow'));
    console.log('');
    return;
  }

  // Push in batches. The server treats the POST as append-only (no dedup, no merge);
  // this checkpoint file is the ONLY thing that prevents a turn from being re-sent.
  // Batch 1 creates the per-push summary doc; subsequent batches POST with
  // ?turnsOnly=true to only append additional turn pages under the same pushId.
  const pushId = generatePushId();
  const deltaPayload: PlatformPayload = { ...payload, turns: newTurns, pushId } as PlatformPayload;
  const endpoint = `${url}/api/swarm/token-stats`;
  const endpointTurnsOnly = `${url}/api/swarm/token-stats?turnsOnly=true`;
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };

  const allTurnsToSend = deltaPayload.turns;
  const totalBatches = Math.max(1, Math.ceil(allTurnsToSend.length / BATCH_SIZE));

  // First batch: summary + first chunk of turns.
  const firstBatch = allTurnsToSend.slice(0, BATCH_SIZE);
  const firstPayload = { ...deltaPayload, turns: firstBatch };

  if (!quiet) {
    console.log(`  Sending batch 1/${totalBatches} (${firstBatch.length} turns + aggregate) [push ${pushId}]...`);
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(firstPayload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as Record<string, string>;
    throw new Error(`Push failed: ${res.status}: ${err.error || JSON.stringify(err)}`);
  }

  const firstResult = await res.json() as Record<string, string>;

  // Remaining batches: turns only — server skips summary doc creation.
  for (let i = 1; i < totalBatches; i++) {
    const batchTurns = allTurnsToSend.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (!quiet) {
      console.log(`  Sending batch ${i + 1}/${totalBatches} (${batchTurns.length} turns)...`);
    }

    const batchPayload = { ...deltaPayload, turns: batchTurns, pushId };

    const batchRes = await fetch(endpointTurnsOnly, {
      method: 'POST',
      headers,
      body: JSON.stringify(batchPayload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!batchRes.ok) {
      console.error(colorize(`  Batch ${i + 1} failed (${batchRes.status}) \u2014 continuing...`, 'yellow'));
    }
  }

  // Save checkpoint
  const allKeys = [...lastPushedKeys, ...allTurnKeys];
  const trimmedKeys = allKeys.slice(-50000); // Prevent unbounded growth
  mkdirSync(join(process.cwd(), '.claude'), { recursive: true });
  writeFileSync(checkpointPath, JSON.stringify({
    lastPushedAt: new Date().toISOString(),
    turnKeys: trimmedKeys,
    turnCount: trimmedKeys.length,
  }));

  console.log('');
  console.log(colorize(`  Pushed: ${firstResult.message || 'success'} (${totalBatches} batch${totalBatches > 1 ? 'es' : ''}, ${allTurnsToSend.length} turns)`, 'green'));
  console.log('');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generatePushId(): string {
  // Avoid importing node:crypto at top to keep this file portable.
  // 8 alphanumeric chars; collision-resistant enough for per-push tagging.
  const rand = Math.random().toString(36).slice(2, 6);
  const ts = Date.now().toString(36).slice(-4);
  return `${ts}${rand}`;
}

function loadEnvLocal(): void {
  try {
    const envPath = join(process.cwd(), '.env.local');
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {
    // Silently ignore
  }
}
