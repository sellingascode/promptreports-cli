/**
 * Platform push — send stats to promptreports.ai
 */

import type { SessionStats } from '../scanners/claude-sessions.js';

export async function pushToplatform(
  sessions: SessionStats[],
  apiKey: string,
  days: number
): Promise<{ message: string }> {
  const url = process.env.PROMPTREPORTS_URL || 'https://www.promptreports.ai';
  const endpoint = `${url}/api/swarm/token-stats`;

  const totalTokens = sessions.reduce((s, st) => s + st.totalTokens, 0);
  const totalInput = sessions.reduce((s, st) => s + st.totalInputTokens, 0);
  const totalOutput = sessions.reduce((s, st) => s + st.totalOutputTokens, 0);
  const totalCost = sessions.reduce((s, st) => s + st.estimatedCostUsd, 0);
  const avgCacheHit = sessions.reduce((s, st) => s + st.cacheHitRate, 0) / sessions.length;

  const allTurns = sessions.flatMap(s => s.turns);

  const payload = {
    collectedAt: new Date().toISOString(),
    periodDays: days,
    source: 'cli' as const,
    version: '1.0',
    aggregate: {
      sessions: sessions.length,
      messages: allTurns.length,
      totalTokens,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheWrite: sessions.reduce((s, st) => s + st.turns.reduce((ts, t) => ts + t.cacheWriteTokens, 0), 0),
      cacheRead: sessions.reduce((s, st) => s + st.turns.reduce((ts, t) => ts + t.cacheReadTokens, 0), 0),
      cacheHitRate: avgCacheHit,
      estimatedCostUsd: totalCost,
    },
    sessions: sessions.map(s => ({
      sessionId: s.sessionId,
      messageCount: s.messageCount,
      totalTokens: s.totalTokens,
      estimatedCostUsd: s.estimatedCostUsd,
      cacheHitRate: s.cacheHitRate,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    turns: allTurns.slice(0, 500), // First batch
    suggestions: [],
    patterns: {},
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'X-CLI-Version': '1.0.0',
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(`${res.status}: ${err.error || JSON.stringify(err)}`);
  }

  const result = (await res.json()) as { message?: string };

  // Push remaining turns in batches
  const BATCH_SIZE = 500;
  for (let i = 1; i < Math.ceil(allTurns.length / BATCH_SIZE); i++) {
    const batchTurns = allTurns.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, turns: batchTurns, aggregate: { ...payload.aggregate, totalTokens: 0, estimatedCostUsd: 0 }, sessions: [] }),
    });
  }

  return { message: `${result.message || 'success'} (${allTurns.length} turns)` };
}
