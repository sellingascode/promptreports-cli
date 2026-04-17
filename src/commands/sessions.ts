/**
 * Sessions command — Session replay, search, and history
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanClaudeSessions, type SessionStats } from '../scanners/claude-sessions.js';

function fmtCost(n: number): string {
  return '$' + n.toFixed(2);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.substring(0, len - 3) + '...';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().split('T')[0] + ' ' + d.toISOString().split('T')[1].substring(0, 5);
  } catch {
    return iso.substring(0, 16);
  }
}

function listSessions(sessions: SessionStats[], showJson: boolean): void {
  if (sessions.length === 0) {
    console.log('  No sessions found.');
    return;
  }

  if (showJson) {
    const outPath = path.join(process.cwd(), 'sessions.json');
    const data = sessions.map(s => ({
      id: s.sessionId,
      date: s.startTime,
      turns: s.turns.length,
      cost: s.estimatedCostUsd,
      tokens: s.totalTokens,
      firstPrompt: s.turns[0]?.userPromptPreview || '',
    }));
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ JSON exported to ${outPath}`);
    return;
  }

  console.log('  ┌──────────┬──────────────────┬───────┬──────────┬──────────────────────────────┐');
  console.log('  │ ID       │ Date             │ Turns │ Cost     │ First Prompt                 │');
  console.log('  ├──────────┼──────────────────┼───────┼──────────┼──────────────────────────────┤');

  for (const s of sessions) {
    const id = s.sessionId.substring(0, 8);
    const date = formatDate(s.startTime);
    const turns = String(s.turns.length).padStart(5);
    const cost = fmtCost(s.estimatedCostUsd).padStart(8);
    const firstPrompt = truncate(s.turns[0]?.userPromptPreview || '(no prompt)', 28);
    console.log(`  │ ${id} │ ${date} │ ${turns} │ ${cost} │ ${firstPrompt.padEnd(28)} │`);
  }

  console.log('  └──────────┴──────────────────┴───────┴──────────┴──────────────────────────────┘');
  console.log('');
  console.log(`  ${sessions.length} sessions total`);
}

function replaySession(sessions: SessionStats[], id: string): void {
  const session = sessions.find(s => s.sessionId.startsWith(id));
  if (!session) {
    console.log(`  Session matching "${id}" not found.`);
    console.log('  Use --list to see available sessions.');
    return;
  }

  console.log(`  Session: ${session.sessionId}`);
  console.log(`  Period:  ${formatDate(session.startTime)} → ${formatDate(session.endTime)}`);
  console.log(`  Cost:    ${fmtCost(session.estimatedCostUsd)}  (${fmtTokens(session.totalTokens)} tokens)`);
  console.log('');
  console.log('  ────────────────────────────────────────────────────────────');

  for (const turn of session.turns) {
    const icon = turn.role === 'user' ? '▸' : '◂';
    const role = turn.role === 'user' ? 'USER' : 'ASST';
    const model = turn.model ? ` [${turn.model}]` : '';
    const cost = turn.costUsd > 0 ? `  ${fmtCost(turn.costUsd)}` : '';

    console.log('');
    console.log(`  ${icon} ${role}${model}${cost}  (${fmtTokens(turn.totalTokens)} tokens)`);
    if (turn.userPromptPreview) {
      console.log(`    ${truncate(turn.userPromptPreview, 76)}`);
    }
  }

  console.log('');
  console.log('  ────────────────────────────────────────────────────────────');
}

function searchSessions(sessions: SessionStats[], term: string, showJson: boolean): void {
  const lowerTerm = term.toLowerCase();
  const matches: Array<{ session: SessionStats; turn: number; preview: string }> = [];

  for (const s of sessions) {
    for (const t of s.turns) {
      if (t.userPromptPreview.toLowerCase().includes(lowerTerm)) {
        matches.push({
          session: s,
          turn: t.turnNumber,
          preview: t.userPromptPreview,
        });
      }
    }
  }

  if (matches.length === 0) {
    console.log(`  No results for "${term}".`);
    return;
  }

  if (showJson) {
    const outPath = path.join(process.cwd(), 'sessions-search.json');
    fs.writeFileSync(outPath, JSON.stringify(matches.map(m => ({
      sessionId: m.session.sessionId,
      turn: m.turn,
      preview: m.preview,
    })), null, 2));
    console.log(`  ✓ JSON exported to ${outPath}`);
    return;
  }

  console.log(`  Found ${matches.length} matches for "${term}":`);
  console.log('');

  for (const m of matches.slice(0, 30)) {
    console.log(`  ✓ ${m.session.sessionId.substring(0, 8)} turn #${m.turn}`);
    console.log(`    ${truncate(m.preview, 72)}`);
  }
  if (matches.length > 30) {
    console.log(`  ... and ${matches.length - 30} more`);
  }
}

function extractPatterns(sessions: SessionStats[]): void {
  if (sessions.length === 0) {
    console.log('  No sessions to analyze.');
    return;
  }

  // Keyword frequency from user prompts
  const wordCounts = new Map<string, number>();
  const stopWords = new Set(['the', 'a', 'an', 'is', 'it', 'to', 'and', 'or', 'of', 'in', 'for', 'on', 'with', 'this', 'that', 'i', 'me', 'my', 'we', 'you', 'can', 'do', 'be', 'at', 'as', 'by', 'from', 'not', 'but', 'if', 'so', 'no', 'up']);

  let totalTurns = 0;
  let totalCost = 0;
  let totalTokens = 0;

  for (const s of sessions) {
    totalTurns += s.turns.length;
    totalCost += s.estimatedCostUsd;
    totalTokens += s.totalTokens;

    for (const t of s.turns) {
      if (t.role !== 'user') continue;
      const words = t.userPromptPreview.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
      for (const w of words) {
        if (w.length < 3 || stopWords.has(w)) continue;
        wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      }
    }
  }

  const topWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const avgTurns = totalTurns / sessions.length;
  const avgCost = totalCost / sessions.length;
  const avgTokens = totalTokens / sessions.length;

  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  SESSION PATTERNS'.padEnd(60) + '│');
  console.log('  ├─────────────────────────────────────────────────────────┤');
  console.log(`  │  Sessions:    ${sessions.length}`.padEnd(60) + '│');
  console.log(`  │  Avg turns:   ${avgTurns.toFixed(1)}`.padEnd(60) + '│');
  console.log(`  │  Avg cost:    ${fmtCost(avgCost)}`.padEnd(60) + '│');
  console.log(`  │  Avg tokens:  ${fmtTokens(Math.round(avgTokens))}`.padEnd(60) + '│');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('');

  if (topWords.length > 0) {
    console.log('  Top keywords:');
    for (const [word, count] of topWords) {
      const bar = '█'.repeat(Math.min(30, Math.round(count / topWords[0][1] * 30)));
      console.log(`    ${word.padEnd(15)} ${String(count).padStart(4)}  ${bar}`);
    }
  }
}

function exportSession(sessions: SessionStats[], id: string): void {
  const session = sessions.find(s => s.sessionId.startsWith(id));
  if (!session) {
    console.log(`  Session matching "${id}" not found.`);
    return;
  }

  const lines: string[] = [];
  lines.push(`# Session ${session.sessionId}`);
  lines.push('');
  lines.push(`**Date:** ${formatDate(session.startTime)} - ${formatDate(session.endTime)}`);
  lines.push(`**Turns:** ${session.turns.length}`);
  lines.push(`**Cost:** ${fmtCost(session.estimatedCostUsd)}`);
  lines.push(`**Tokens:** ${fmtTokens(session.totalTokens)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const turn of session.turns) {
    const role = turn.role === 'user' ? 'User' : 'Assistant';
    const model = turn.model ? ` (${turn.model})` : '';
    lines.push(`### Turn ${turn.turnNumber} — ${role}${model}`);
    lines.push('');
    if (turn.userPromptPreview) {
      lines.push(`> ${turn.userPromptPreview}`);
    }
    lines.push('');
    lines.push(`Tokens: ${fmtTokens(turn.totalTokens)} | Cost: ${fmtCost(turn.costUsd)}`);
    lines.push('');
  }

  const filename = `session-${session.sessionId.substring(0, 8)}.md`;
  const outPath = path.join(process.cwd(), filename);
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`  ✓ Exported to ${outPath}`);
}

export async function sessions(args: string[]): Promise<void> {
  const showJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  const doReplay = args.includes('--replay');
  const replayIdx = args.indexOf('--replay');
  const replayId = replayIdx >= 0 ? args[replayIdx + 1] : null;

  const doSearch = args.includes('--search');
  const searchIdx = args.indexOf('--search');
  const searchTerm = searchIdx >= 0 ? args[searchIdx + 1] : null;

  const doPatterns = args.includes('--extract-patterns');

  const doExport = args.includes('--export');
  const exportIdx = args.indexOf('--export');
  const exportId = exportIdx >= 0 ? args[exportIdx + 1] : null;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION HISTORY                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const allSessions = scanClaudeSessions(days);
  if (allSessions.length === 0) {
    console.log('  No Claude Code sessions found in the last ' + days + ' days.');
    console.log('  Try: --days 30');
    return;
  }

  console.log(`  Found ${allSessions.length} sessions (last ${days} days)`);
  console.log('');

  if (doReplay && replayId) {
    replaySession(allSessions, replayId);
  } else if (doSearch && searchTerm) {
    searchSessions(allSessions, searchTerm, showJson);
  } else if (doPatterns) {
    extractPatterns(allSessions);
  } else if (doExport && exportId) {
    exportSession(allSessions, exportId);
  } else {
    listSessions(allSessions, showJson);
  }

  console.log('');
}
