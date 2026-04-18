/**
 * sessions command — Session replay and history.
 */

import { writeFileSync } from 'node:fs';
import type { GlobalFlags } from '../cli';
import { scanProjectSessions, parseSession, analyzeSession, type SessionStats } from '../utils/session-scanner';
import { colorize, box, table, formatCost, formatTokens, sectionHeader } from '../utils/format';

export async function sessionsCommand(flags: GlobalFlags): Promise<void> {
  const { days, json } = flags;
  const doList = !flags.args.length || flags.args.includes('--list');
  const replayId = flags.args.includes('--replay') ? flags.args[flags.args.indexOf('--replay') + 1] : '';
  const searchTerm = flags.args.includes('--search') ? flags.args[flags.args.indexOf('--search') + 1] : '';
  const doPatterns = flags.args.includes('--extract-patterns');
  const exportId = flags.args.includes('--export') ? flags.args[flags.args.indexOf('--export') + 1] : '';

  // Load all sessions
  const files = scanProjectSessions(days);
  const allStats = files.map(f => analyzeSession(parseSession(f), days)).filter(Boolean) as SessionStats[];
  allStats.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  if (replayId) {
    const session = allStats.find(s => s.sessionId.startsWith(replayId));
    if (!session) {
      console.log(colorize(`  Session ${replayId} not found.`, 'red'));
      return;
    }

    if (json) { console.log(JSON.stringify(session, null, 2)); return; }

    sectionHeader(`Session ${session.sessionId.slice(0, 8)} — ${new Date(session.startedAt).toLocaleDateString()}`);
    console.log(`  Duration: ${session.sessionDurationMinutes}m | Turns: ${session.turns.length} | Cost: ${formatCost(session.estimatedCostUsd)}`);
    console.log('');

    for (const turn of session.turns.slice(0, 50)) {
      const timeStr = new Date(turn.timestamp).toLocaleTimeString();
      console.log(
        `  ${colorize(`#${String(turn.turnNumber).padStart(3)}`, 'dim')} ${timeStr}  ` +
        `${formatTokens(turn.totalTokens).padStart(7)}  ${formatCost(turn.costUsd).padStart(7)}  ` +
        `${colorize(turn.userPromptPreview.slice(0, 60), 'dim')}`
      );
    }
    if (session.turns.length > 50) console.log(colorize(`  ... and ${session.turns.length - 50} more turns`, 'dim'));
    return;
  }

  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    const matches = allStats.filter(s =>
      s.turns.some(t => t.userPromptPreview.toLowerCase().includes(lower))
    );

    if (json) { console.log(JSON.stringify({ search: searchTerm, results: matches.length, sessions: matches.map(s => ({ id: s.sessionId.slice(0, 8), date: s.startedAt, cost: s.estimatedCostUsd })) }, null, 2)); return; }

    sectionHeader(`Search: "${searchTerm}"`);
    if (matches.length === 0) {
      console.log(colorize(`  No sessions found matching "${searchTerm}"`, 'yellow'));
      return;
    }
    const rows = matches.slice(0, 15).map(s => [
      colorize(s.sessionId.slice(0, 8), 'dim'),
      new Date(s.startedAt).toLocaleDateString(),
      String(s.turns.length),
      formatCost(s.estimatedCostUsd),
      s.turns.find(t => t.userPromptPreview.toLowerCase().includes(lower))?.userPromptPreview.slice(0, 50) || '',
    ]);
    table(['ID', 'Date', 'Turns', 'Cost', 'Match'], rows);
    return;
  }

  if (doPatterns) {
    // Extract recurring patterns
    const wordFreq: Record<string, number> = {};
    const fileReads: Record<string, number> = {};
    let totalTurns = 0;
    let totalCost = 0;

    for (const s of allStats) {
      totalTurns += s.turns.length;
      totalCost += s.estimatedCostUsd;
      for (const t of s.turns) {
        const words = t.userPromptPreview.toLowerCase().split(/\s+/);
        for (const w of words) {
          if (w.length > 4) wordFreq[w] = (wordFreq[w] || 0) + 1;
        }
      }
    }

    const topWords = Object.entries(wordFreq)
      .filter(([, c]) => c > 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (json) { console.log(JSON.stringify({ sessions: allStats.length, totalTurns, totalCost, avgTurns: totalTurns / Math.max(1, allStats.length), avgCost: totalCost / Math.max(1, allStats.length), topKeywords: topWords }, null, 2)); return; }

    const lines: string[] = [];
    lines.push(`Sessions: ${allStats.length} | Turns: ${totalTurns} | Total cost: ${formatCost(totalCost)}`);
    lines.push(`Avg session: ${Math.round(totalTurns / Math.max(1, allStats.length))} turns, ${formatCost(totalCost / Math.max(1, allStats.length))}`);
    lines.push('');
    lines.push(colorize('TOP KEYWORDS (recurring tasks):', 'bold'));
    for (const [word, count] of topWords) {
      lines.push(`  ${word.padEnd(25)} ${count} occurrences`);
    }

    box('Session Patterns', lines.join('\n'));
    return;
  }

  if (exportId) {
    const session = allStats.find(s => s.sessionId.startsWith(exportId));
    if (!session) { console.log(colorize(`  Session ${exportId} not found.`, 'red')); return; }

    const md = [
      `# Session ${session.sessionId.slice(0, 8)}`,
      `Date: ${new Date(session.startedAt).toLocaleString()}`,
      `Duration: ${session.sessionDurationMinutes}m | Cost: ${formatCost(session.estimatedCostUsd)} | Model: ${session.model}`,
      '',
      '## Turns',
      '',
      ...session.turns.map(t => `### Turn ${t.turnNumber}\n${t.userPromptPreview}\n> Tokens: ${formatTokens(t.totalTokens)} | Cost: ${formatCost(t.costUsd)}\n`),
    ].join('\n');

    const outPath = `session-${exportId}.md`;
    writeFileSync(outPath, md);
    console.log(colorize(`  Exported to ${outPath}`, 'green'));
    return;
  }

  // Default: list sessions
  if (json) {
    console.log(JSON.stringify(allStats.map(s => ({
      id: s.sessionId.slice(0, 8),
      date: s.startedAt,
      turns: s.turns.length,
      cost: s.estimatedCostUsd,
      model: s.model,
      summary: s.turns[0]?.userPromptPreview.slice(0, 60) || '',
    })), null, 2));
    return;
  }

  if (allStats.length === 0) {
    console.log(colorize(`  No sessions found in the last ${days} days.`, 'yellow'));
    return;
  }

  const rows = allStats.slice(0, 20).map(s => [
    colorize(s.sessionId.slice(0, 8), 'dim'),
    new Date(s.startedAt).toLocaleDateString(),
    String(s.turns.length),
    formatCost(s.estimatedCostUsd),
    (s.turns[0]?.userPromptPreview || '').slice(0, 50),
  ]);

  table(['ID', 'Date', 'Turns', 'Cost', 'Summary'], rows);
  if (allStats.length > 20) console.log(colorize(`  ... and ${allStats.length - 20} more sessions`, 'dim'));
}
