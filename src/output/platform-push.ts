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

  const totalInput = sessions.reduce((s, st) => s + st.totalInputTokens, 0);
  const totalOutput = sessions.reduce((s, st) => s + st.totalOutputTokens, 0);
  const totalCost = sessions.reduce((s, st) => s + st.estimatedCostUsd, 0);
  const totalCacheWrite = sessions.reduce((s, st) => s + st.turns.reduce((ts, t) => ts + t.cacheWriteTokens, 0), 0);
  const totalCacheRead = sessions.reduce((s, st) => s + st.turns.reduce((ts, t) => ts + t.cacheReadTokens, 0), 0);
  const totalTokens = totalInput + totalOutput + totalCacheWrite;
  const allInputForRate = totalInput + totalCacheWrite + totalCacheRead;
  const cacheHitRate = allInputForRate > 0 ? totalCacheRead / allInputForRate : 0;

  const allTurns = sessions.flatMap(s => s.turns.map(t => ({
    turnNumber: t.turnNumber,
    timestamp: t.timestamp,
    role: t.role || 'assistant',
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    cacheWrite: t.cacheWriteTokens,
    cacheRead: t.cacheReadTokens,
    totalTokens: t.totalTokens,
    model: t.model || 'claude-opus-4-6',
    contentTypes: [] as string[],
    userPromptPreview: t.userPromptPreview || '',
    cumulativeTokens: 0,
    costUsd: t.costUsd,
    sessionId: t.sessionId || s.sessionId,
  })));

  const opusTurns = allTurns.filter(t => t.model.includes('opus'));
  const longSessions = sessions.filter(s => s.messageCount > 30);
  const cwPct = totalTokens > 0 ? (totalCacheWrite / totalTokens * 100) : 0;

  const payload = {
    collectedAt: new Date().toISOString(),
    periodDays: days,
    source: 'claude-code' as const,
    agentName: 'promptreports-cli',
    agentVersion: '1.0.0',
    aggregate: {
      sessions: sessions.length,
      messages: allTurns.length,
      totalTokens,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheWrite: totalCacheWrite,
      cacheRead: totalCacheRead,
      cacheHitRate,
      estimatedCostUsd: totalCost,
    },
    sessions: sessions.map(s => ({
      sessionId: s.sessionId,
      startedAt: s.startTime || new Date().toISOString(),
      endedAt: s.endTime || new Date().toISOString(),
      messageCount: s.messageCount,
      totalTokens: s.totalTokens,
      model: s.turns[0]?.model || 'claude-opus-4-6',
      estimatedCostUsd: s.estimatedCostUsd,
      cacheHitRate: s.cacheHitRate,
    })),
    turns: allTurns.slice(0, 500),
    suggestions: [] as string[],
    patterns: {
      outputToInputRatio: totalInput > 0 ? totalOutput / totalInput : 0,
      cacheCreationPercent: cwPct,
      avgSessionLength: sessions.length > 0 ? allTurns.length / sessions.length : 0,
      opusPercent: allTurns.length > 0 ? (opusTurns.length / allTurns.length) * 100 : 0,
      longSessions: longSessions.length,
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'X-CLI-Version': '1.0.0',
  };

  console.log(`  Pushing ${allTurns.length} turns across ${sessions.length} sessions...`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string; details?: unknown };
    const detail = err.details ? ` — ${JSON.stringify(err.details)}` : '';
    throw new Error(`${res.status}: ${err.error || 'Unknown error'}${detail}`);
  }

  const result = (await res.json()) as { message?: string };

  // Push remaining turns in batches
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(allTurns.length / BATCH_SIZE);
  for (let i = 1; i < totalBatches; i++) {
    const batchTurns = allTurns.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    console.log(`  Sending batch ${i + 1}/${totalBatches} (${batchTurns.length} turns)...`);
    await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        turns: batchTurns,
        aggregate: { ...payload.aggregate, totalTokens: 0, estimatedCostUsd: 0, sessions: 0, messages: 0, inputTokens: 0, outputTokens: 0, cacheWrite: 0, cacheRead: 0, cacheHitRate: 0 },
        sessions: [],
        suggestions: [],
      }),
    });
  }

  return { message: `${result.message || 'success'} (${totalBatches} batch${totalBatches > 1 ? 'es' : ''}, ${allTurns.length} turns)` };
}
