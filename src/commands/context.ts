/**
 * context command — Context window optimizer.
 * Analyzes what's consuming Claude Code's context budget across sessions.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { GlobalFlags } from '../cli';
import { scanProjectSessions, parseSession, analyzeSession } from '../utils/session-scanner';
import { colorize, box, formatTokens, formatCost, progressBar } from '../utils/format';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getClaudeMdSize(cwd: string): number {
  const path = join(cwd, 'CLAUDE.md');
  try { return estimateTokens(readFileSync(path, 'utf-8')); } catch { return 0; }
}

function getSkillCount(cwd: string): { count: number; totalTokens: number; names: string[] } {
  const dir = join(cwd, '.claude', 'skills');
  if (!existsSync(dir)) return { count: 0, totalTokens: 0, names: [] };
  const names: string[] = [];
  let totalTokens = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillPath = join(dir, entry.name, 'SKILL.md');
        if (existsSync(skillPath)) {
          names.push(entry.name);
          totalTokens += estimateTokens(readFileSync(skillPath, 'utf-8'));
        }
      }
    }
  } catch { /* */ }
  return { count: names.length, totalTokens, names };
}

function getMemoryFiles(cwd: string): { count: number; totalTokens: number } {
  // Check both project-level and global memory
  const dirs = [
    join(cwd, '.claude', 'memory'),
    join(homedir(), '.claude', 'memory'),
  ];
  let count = 0, totalTokens = 0;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.md')) {
          count++;
          totalTokens += estimateTokens(readFileSync(join(dir, f), 'utf-8'));
        }
      }
    } catch { /* */ }
  }
  return { count, totalTokens };
}

interface GhostFinding {
  kind: 'duplicate-tool-result' | 'oversize-tool-schema' | 'post-compaction-waste' | 'unused-skill' | 'stale-claude-md';
  severity: 'high' | 'medium' | 'low';
  description: string;
  tokensWasted: number;
  evidence: string;
}

function ghostScan(cwd: string, days: number): { findings: GhostFinding[]; totalWaste: number; sessionsScanned: number } {
  const files = scanProjectSessions(days);
  const findings: GhostFinding[] = [];

  // 1. Unused skills (reuses existing logic, rebuilt here for isolation)
  const skills = getSkillCount(cwd);
  const sessionTexts: string[] = [];
  const toolResultHashes = new Map<string, { count: number; size: number }>();
  const toolSchemaSizes = new Map<string, number>();
  let postCompactionLines = 0;

  for (const file of files) {
    let raw: string;
    try { raw = readFileSync(file, 'utf-8'); } catch { continue; }
    sessionTexts.push(raw);

    const lines = raw.split('\n');
    let prevCumulativeSize = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: any;
      try { entry = JSON.parse(line); } catch { continue; }

      // Tool results — dedupe by content hash
      if (entry.type === 'user' && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          if (block.type === 'tool_result') {
            const txt = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('')
                : '';
            if (txt.length < 200) continue;
            // Cheap content fingerprint: length + first/last 60 chars
            const hash = `${txt.length}:${txt.slice(0, 60)}:${txt.slice(-60)}`;
            const cur = toolResultHashes.get(hash) || { count: 0, size: estimateTokens(txt) };
            cur.count++;
            toolResultHashes.set(hash, cur);
          }
        }
      }

      // Tool schema size (assistant messages with tool_use)
      if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          if (block.type === 'tool_use' && block.name) {
            const existing = toolSchemaSizes.get(block.name) || 0;
            const inputSize = JSON.stringify(block.input || {}).length;
            toolSchemaSizes.set(block.name, Math.max(existing, inputSize));
          }
        }
      }

      // Post-compaction waste heuristic: sudden token drops signal compaction;
      // count how much content is preserved that could have been dropped further
      const cumulative = entry.message?.usage?.input_tokens || 0;
      if (prevCumulativeSize > 10000 && cumulative < prevCumulativeSize * 0.5 && cumulative > 3000) {
        postCompactionLines += Math.floor((cumulative - 3000) / 4); // rough token est
      }
      if (cumulative > 0) prevCumulativeSize = cumulative;
    }
  }

  // Convert duplicates to findings
  let totalDupeWaste = 0;
  let dupeCount = 0;
  for (const [hash, info] of toolResultHashes) {
    if (info.count >= 3) {
      const wasted = info.size * (info.count - 1);
      totalDupeWaste += wasted;
      dupeCount++;
    }
  }
  if (dupeCount > 0) {
    findings.push({
      kind: 'duplicate-tool-result',
      severity: totalDupeWaste > 5000 ? 'high' : 'medium',
      description: `${dupeCount} tool results repeated 3+ times across sessions`,
      tokensWasted: totalDupeWaste,
      evidence: `Same large tool output (file reads, API responses) appearing repeatedly. Cache these results or reference them by path.`,
    });
  }

  // Oversize tool schemas
  const largeSchemas = Array.from(toolSchemaSizes.entries()).filter(([, size]) => size > 4000);
  if (largeSchemas.length > 0) {
    const totalSchemaWaste = largeSchemas.reduce((a, [, s]) => a + Math.floor(s / 4 * 0.3), 0);
    findings.push({
      kind: 'oversize-tool-schema',
      severity: 'medium',
      description: `${largeSchemas.length} tool(s) with oversized input payloads`,
      tokensWasted: totalSchemaWaste,
      evidence: `Tools: ${largeSchemas.slice(0, 3).map(([n]) => n).join(', ')}${largeSchemas.length > 3 ? '…' : ''}. Long inputs suggest agents are pasting content that could be referenced.`,
    });
  }

  // Post-compaction waste
  if (postCompactionLines > 500) {
    findings.push({
      kind: 'post-compaction-waste',
      severity: 'medium',
      description: `Post-compaction residue across sessions`,
      tokensWasted: postCompactionLines,
      evidence: `Compaction events kept more than necessary. Break sessions earlier (turn 15-18) to avoid compacting in the first place.`,
    });
  }

  // Unused skills
  const combinedText = sessionTexts.join(' ').toLowerCase();
  const unusedSkills: string[] = [];
  for (const name of skills.names) {
    if (!combinedText.includes(name.toLowerCase()) && !combinedText.includes('/' + name.toLowerCase())) {
      unusedSkills.push(name);
    }
  }
  if (unusedSkills.length > 0) {
    const skillWaste = unusedSkills.length * 300;
    findings.push({
      kind: 'unused-skill',
      severity: unusedSkills.length >= 5 ? 'medium' : 'low',
      description: `${unusedSkills.length} skill(s) loaded but never invoked in last ${days} days`,
      tokensWasted: skillWaste,
      evidence: `Never referenced: ${unusedSkills.slice(0, 4).join(', ')}${unusedSkills.length > 4 ? '…' : ''}. Each costs ~300 tokens/session.`,
    });
  }

  // Stale CLAUDE.md content
  const claudeMd = getClaudeMdSize(cwd);
  if (claudeMd > 2000) {
    findings.push({
      kind: 'stale-claude-md',
      severity: claudeMd > 5000 ? 'high' : 'low',
      description: `CLAUDE.md is ${claudeMd} tokens — loaded on every turn`,
      tokensWasted: Math.max(0, claudeMd - 1500),
      evidence: `Deep analysis available via: promptreports audit claude-md`,
    });
  }

  const totalWaste = findings.reduce((a, f) => a + f.tokensWasted, 0);
  return { findings, totalWaste, sessionsScanned: files.length };
}

export async function contextCommand(flags: GlobalFlags): Promise<void> {
  const cwd = process.cwd();
  const { days } = flags;

  if (flags.args.includes('--ghosts')) {
    const { findings, totalWaste, sessionsScanned } = ghostScan(cwd, days);
    const dailyWaste = totalWaste / Math.max(1, days);
    const costPerSession = (totalWaste / 1e6) * 15; // input pricing
    const monthlyCost = costPerSession * (sessionsScanned / Math.max(1, days)) * 30;

    if (flags.json) {
      console.log(JSON.stringify({ findings, totalWaste, dailyWaste, sessionsScanned, estimatedMonthlyCost: monthlyCost }, null, 2));
      return;
    }

    box('Ghost Token Scan', [
      `Scanned:        ${sessionsScanned} session files (last ${days} days)`,
      `Total waste:    ${colorize(formatTokens(totalWaste) + ' tokens', totalWaste > 5000 ? 'red' : 'yellow')}`,
      `Daily avg:      ${formatTokens(Math.round(dailyWaste))} tokens/day of silent bloat`,
      `Est. cost:      ${colorize(formatCost(monthlyCost) + '/month', 'yellow')} just on ghosts`,
    ].join('\n'));

    if (findings.length === 0) {
      console.log(colorize('\n  No ghost tokens detected. Context is clean.', 'green'));
      return;
    }

    console.log('');
    const sorted = findings.slice().sort((a, b) => b.tokensWasted - a.tokensWasted);
    for (const f of sorted) {
      const sev = f.severity === 'high' ? colorize('HIGH  ', 'red')
        : f.severity === 'medium' ? colorize('MED   ', 'yellow')
        : colorize('LOW   ', 'dim');
      console.log(`  ${sev} ${colorize(f.description, 'bold')}  ${colorize(`~${formatTokens(f.tokensWasted)} tokens`, 'green')}`);
      console.log(`         ${colorize(f.evidence, 'dim')}`);
      console.log('');
    }
    return;
  }

  // Analyze static context consumers
  const claudeMdTokens = getClaudeMdSize(cwd);
  const skills = getSkillCount(cwd);
  const memory = getMemoryFiles(cwd);
  const systemPromptEstimate = 6200; // Approximate system prompt size

  const startupTokens = claudeMdTokens + skills.totalTokens + memory.totalTokens + systemPromptEstimate;
  const contextBudget = 200000;
  const startupPercent = (startupTokens / contextBudget) * 100;

  // Analyze sessions for usage patterns
  const files = scanProjectSessions(days);
  const allStats = files.map(f => analyzeSession(parseSession(f), days)).filter(Boolean) as any[];

  // Find compaction events (sudden token drops between consecutive turns)
  let compactionCount = 0;
  let firstCompactionTurn = 0;
  const fileReadCounts: Record<string, number> = {};

  for (const stats of allStats) {
    let prevCumulative = 0;
    for (const turn of stats.turns) {
      if (prevCumulative > 0 && turn.cumulativeTokens < prevCumulative * 0.6) {
        compactionCount++;
        if (firstCompactionTurn === 0) firstCompactionTurn = turn.turnNumber;
      }
      prevCumulative = turn.cumulativeTokens;

      // Track file reads from user prompt previews
      const preview = turn.userPromptPreview || '';
      const fileMatch = preview.match(/(?:Read|read|cat)\s+([^\s]+)/);
      if (fileMatch) {
        const file = fileMatch[1];
        fileReadCounts[file] = (fileReadCounts[file] || 0) + 1;
      }
    }
  }

  // Find skills that were never invoked (rough: check if skill name appears in session content)
  const unusedSkills: string[] = [];
  const sessionContent = allStats.map(s => s.turns.map((t: any) => t.userPromptPreview).join(' ')).join(' ').toLowerCase();
  for (const skillName of skills.names) {
    if (!sessionContent.includes(skillName.toLowerCase()) && !sessionContent.includes('/' + skillName.toLowerCase())) {
      unusedSkills.push(skillName);
    }
  }
  const unusedSkillTokens = unusedSkills.length * 300; // rough estimate

  // Average session metrics
  const avgTurns = allStats.length > 0 ? allStats.reduce((a: number, s: any) => a + s.turns.length, 0) / allStats.length : 0;
  const avgCost = allStats.length > 0 ? allStats.reduce((a: number, s: any) => a + s.estimatedCostUsd, 0) / allStats.length : 0;

  // Top file reads
  const topReads = Object.entries(fileReadCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (flags.json) {
    console.log(JSON.stringify({
      contextBudget,
      startupTokens,
      startupPercent,
      claudeMdTokens,
      skillTokens: skills.totalTokens,
      skillCount: skills.count,
      memoryTokens: memory.totalTokens,
      memoryCount: memory.count,
      systemPromptEstimate,
      unusedSkills,
      unusedSkillTokens,
      compactionCount,
      firstCompactionTurn,
      avgTurns,
      avgCost,
      topReads,
      sessions: allStats.length,
    }, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push(`${colorize('CONTEXT BUDGET:', 'bold')} ${formatTokens(contextBudget)} tokens`);
  lines.push(`${colorize('USED AT START:', 'bold')}  ${formatTokens(startupTokens)} tokens (${startupPercent.toFixed(1)}%)`);
  lines.push(`  ${progressBar(startupPercent, 40)}`);
  lines.push('');
  lines.push(colorize('BIGGEST CONSUMERS (at session start):', 'bold'));
  const consumers = [
    { name: 'CLAUDE.md', tokens: claudeMdTokens },
    { name: `Skills (${skills.count} loaded)`, tokens: skills.totalTokens },
    { name: 'System prompt', tokens: systemPromptEstimate },
    { name: `Memory files (${memory.count})`, tokens: memory.totalTokens },
  ].sort((a, b) => b.tokens - a.tokens);

  for (const c of consumers) {
    const pct = ((c.tokens / startupTokens) * 100).toFixed(0);
    lines.push(`  ${c.name.padEnd(28)} ${formatTokens(c.tokens).padStart(8)} (${pct}%)`);
  }

  if (unusedSkills.length > 0) {
    lines.push('');
    lines.push(colorize(`SKILLS NEVER INVOKED (last ${days} days):`, 'bold'));
    for (const s of unusedSkills.slice(0, 5)) {
      lines.push(`  ${colorize('-', 'dim')} ${s}`);
    }
    if (unusedSkills.length > 5) lines.push(colorize(`  ... and ${unusedSkills.length - 5} more`, 'dim'));
    lines.push(`  ${colorize(`Removing saves ~${formatTokens(unusedSkillTokens)} tokens/session`, 'yellow')}`);
  }

  if (topReads.length > 0) {
    lines.push('');
    lines.push(colorize(`FILES READ MOST OFTEN (across ${allStats.length} sessions):`, 'bold'));
    for (const [file, count] of topReads) {
      lines.push(`  ${file.padEnd(45)} ${count} reads`);
    }
  }

  if (compactionCount > 0) {
    lines.push('');
    lines.push(colorize('COMPACTION EVENTS:', 'bold'));
    lines.push(`  ${compactionCount} compactions across ${allStats.length} sessions`);
    if (firstCompactionTurn > 0) lines.push(`  First compaction at turn ${firstCompactionTurn}`);
    lines.push(`  ${colorize('Tip: break sessions at turn 15-18 to avoid context loss', 'yellow')}`);
  }

  if (avgCost > 0) {
    lines.push('');
    const savingsPerSession = (unusedSkillTokens / 1e6) * 15; // input pricing
    const dailySavings = savingsPerSession * (allStats.length / Math.max(1, days));
    lines.push(`Avg session: ${Math.round(avgTurns)} turns, ${formatCost(avgCost)}`);
    if (dailySavings > 0.01) lines.push(`Estimated savings: ${colorize(formatCost(dailySavings) + '/day', 'green')} if you apply optimizations`);
  }

  box('Context Window Analysis', lines.join('\n'));
}
