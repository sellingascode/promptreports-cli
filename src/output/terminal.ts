/**
 * Terminal output — pretty console display
 */

import type { SessionStats } from '../scanners/claude-sessions.js';

function fmt(n: number): string {
  return n.toLocaleString();
}

export function printTerminalSummary(
  sessions: SessionStats[],
  opts: { showTurns: boolean; showCommits: boolean; showFix: boolean; showJson: boolean; days: number }
): void {
  const totalTokens = sessions.reduce((s, st) => s + st.totalTokens, 0);
  const totalCost = sessions.reduce((s, st) => s + st.estimatedCostUsd, 0);
  const totalInput = sessions.reduce((s, st) => s + st.totalInputTokens, 0);
  const totalOutput = sessions.reduce((s, st) => s + st.totalOutputTokens, 0);
  const avgCacheHit = sessions.reduce((s, st) => s + st.cacheHitRate, 0) / sessions.length;
  const totalTurns = sessions.reduce((s, st) => s + st.turns.length, 0);

  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log(`│  ${opts.days}-DAY SUMMARY`.padEnd(62) + '│');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│  Sessions:    ${sessions.length}`.padEnd(62) + '│');
  console.log(`│  Turns:       ${fmt(totalTurns)}`.padEnd(62) + '│');
  console.log(`│  Tokens:      ${fmt(totalTokens)}`.padEnd(62) + '│');
  console.log(`│  Est. Cost:   $${totalCost.toFixed(2)}`.padEnd(62) + '│');
  console.log(`│  Cache Hit:   ${avgCacheHit.toFixed(1)}%`.padEnd(62) + '│');
  console.log(`│  Input:       ${fmt(totalInput)}  Output: ${fmt(totalOutput)}`.padEnd(62) + '│');
  console.log('└─────────────────────────────────────────────────────────────┘');

  // Top consumers
  if (sessions.length > 1) {
    console.log('');
    console.log('  Top sessions by cost:');
    for (const s of sessions.slice(0, 5)) {
      const pct = totalCost > 0 ? ((s.estimatedCostUsd / totalCost) * 100).toFixed(0) : '0';
      console.log(`    ${s.sessionId.slice(0, 20).padEnd(22)} $${s.estimatedCostUsd.toFixed(2).padEnd(8)} ${pct}%  ${s.messageCount} msgs`);
    }
  }

  console.log('');
}
