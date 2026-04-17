/**
 * Context command — Context window optimizer
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanClaudeSessions, type SessionStats } from '../scanners/claude-sessions.js';

const CONTEXT_BUDGET = 200_000;
const SYSTEM_PROMPT_TOKENS = 6_200;
const SKILL_TOKENS_ESTIMATE = 300;

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return Math.round((n / total) * 100) + '%';
}

function countSkills(cwd: string): { count: number; names: string[] } {
  const skillsDir = path.join(cwd, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return { count: 0, names: [] };

  try {
    const dirs = fs.readdirSync(skillsDir).filter(d => {
      try { return fs.statSync(path.join(skillsDir, d)).isDirectory(); } catch { return false; }
    });
    return { count: dirs.length, names: dirs };
  } catch {
    return { count: 0, names: [] };
  }
}

function countMemoryFiles(): { count: number; totalTokens: number } {
  const memoryDir = path.join(os.homedir(), '.claude', 'memory');
  if (!fs.existsSync(memoryDir)) return { count: 0, totalTokens: 0 };

  try {
    const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    let totalChars = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(memoryDir, file));
        totalChars += stat.size;
      } catch {}
    }
    return { count: files.length, totalTokens: charsToTokens(totalChars) };
  } catch {
    return { count: 0, totalTokens: 0 };
  }
}

function getClaudeMdTokens(cwd: string): number {
  const claudeMd = path.join(cwd, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) return 0;
  try {
    const content = fs.readFileSync(claudeMd, 'utf-8');
    return charsToTokens(content.length);
  } catch {
    return 0;
  }
}

function findCompactionEvents(sessions: SessionStats[]): Array<{ sessionId: string; turnNumber: number; dropPercent: number; timestamp: string }> {
  const events: Array<{ sessionId: string; turnNumber: number; dropPercent: number; timestamp: string }> = [];

  for (const session of sessions) {
    let runningTotal = 0;
    let peakTotal = 0;

    for (const turn of session.turns) {
      runningTotal += turn.totalTokens;
      if (runningTotal > peakTotal) peakTotal = runningTotal;

      // Detect compaction: cumulative tokens drop significantly from peak
      // A compaction resets the context, so input tokens will drop sharply
      if (turn.inputTokens > 0 && peakTotal > 50000) {
        // If this turn's input is less than 60% of peak, likely a compaction
        if (turn.inputTokens < peakTotal * 0.6 && peakTotal > 100000) {
          const dropPercent = Math.round((1 - turn.inputTokens / peakTotal) * 100);
          if (dropPercent >= 40) {
            events.push({
              sessionId: session.sessionId,
              turnNumber: turn.turnNumber,
              dropPercent,
              timestamp: turn.timestamp,
            });
            // Reset peak after compaction
            peakTotal = turn.inputTokens;
            runningTotal = turn.inputTokens;
          }
        }
      }
    }
  }

  return events;
}

function findUnusedSkills(sessions: SessionStats[], skillNames: string[]): string[] {
  if (skillNames.length === 0) return [];

  // Collect all user prompt text from sessions
  const allText = sessions
    .flatMap(s => s.turns)
    .filter(t => t.userPromptPreview)
    .map(t => t.userPromptPreview.toLowerCase())
    .join(' ');

  return skillNames.filter(name => {
    const lower = name.toLowerCase().replace(/-/g, ' ');
    const kebab = name.toLowerCase();
    return !allText.includes(lower) && !allText.includes(kebab);
  });
}

export async function context(args: string[]): Promise<void> {
  const showJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  const cwd = process.cwd();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  CONTEXT WINDOW OPTIMIZER                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. CLAUDE.md size
  const claudeMdTokens = getClaudeMdTokens(cwd);

  // 2. Skills count
  const skills = countSkills(cwd);
  const skillsTokens = skills.count * SKILL_TOKENS_ESTIMATE;

  // 3. Memory files
  const memory = countMemoryFiles();

  // 4. System prompt
  const systemTokens = SYSTEM_PROMPT_TOKENS;

  // 5. Total startup cost
  const startupTokens = claudeMdTokens + skillsTokens + memory.totalTokens + systemTokens;
  const remainingTokens = CONTEXT_BUDGET - startupTokens;
  const usedPercent = Math.round((startupTokens / CONTEXT_BUDGET) * 100);

  // Display budget
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│  CONTEXT BUDGET (200K tokens)                               │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│  System prompt:       ${fmtTokens(systemTokens).padStart(8)}  tokens`.padEnd(62) + '│');
  console.log(`│  CLAUDE.md:           ${fmtTokens(claudeMdTokens).padStart(8)}  tokens`.padEnd(62) + '│');
  console.log(`│  Skills (${skills.count}):`.padEnd(24) + `${fmtTokens(skillsTokens).padStart(8)}  tokens  (~${SKILL_TOKENS_ESTIMATE}/skill)`.padEnd(38) + '│');
  console.log(`│  Memory files (${memory.count}):`.padEnd(24) + `${fmtTokens(memory.totalTokens).padStart(8)}  tokens`.padEnd(38) + '│');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│  Startup cost:        ${fmtTokens(startupTokens).padStart(8)}  tokens  (${usedPercent}% of budget)`.padEnd(62) + '│');
  console.log(`│  Available for work:  ${fmtTokens(remainingTokens).padStart(8)}  tokens  (${100 - usedPercent}% remaining)`.padEnd(62) + '│');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');

  // 6. Scan sessions for compaction events
  const sessions = scanClaudeSessions(days);

  if (sessions.length > 0) {
    const compactions = findCompactionEvents(sessions);
    if (compactions.length > 0) {
      console.log(`  ◐ ${compactions.length} compaction events detected in last ${days} days`);
      console.log('    Compaction means context hit the limit — sessions were truncated');
      for (const evt of compactions.slice(0, 5)) {
        const sessionShort = evt.sessionId.slice(0, 8);
        const date = evt.timestamp ? new Date(evt.timestamp).toLocaleDateString() : 'unknown';
        console.log(`    → Session ${sessionShort}… turn ${evt.turnNumber} — ${evt.dropPercent}% drop (${date})`);
      }
      if (compactions.length > 5) {
        console.log(`    … and ${compactions.length - 5} more`);
      }
    } else {
      console.log(`  ✓ No compaction events detected in last ${days} days`);
    }

    // 7. Find unused skills
    const unused = findUnusedSkills(sessions, skills.names);
    if (unused.length > 0) {
      console.log('');
      console.log(`  ◐ ${unused.length} skills not referenced in recent sessions:`);
      for (const name of unused.slice(0, 10)) {
        console.log(`    ○ ${name}  (~${SKILL_TOKENS_ESTIMATE} tokens saved if removed)`);
      }
      if (unused.length > 10) {
        console.log(`    … and ${unused.length - 10} more`);
      }
      const savingsTokens = unused.length * SKILL_TOKENS_ESTIMATE;
      console.log(`    Total potential savings: ${fmtTokens(savingsTokens)} tokens/turn`);
    } else if (skills.count > 0) {
      console.log(`  ✓ All ${skills.count} skills were referenced in recent sessions`);
    }
  } else {
    console.log('  ○ No sessions found — skipping compaction and usage analysis');
  }

  console.log('');

  // Recommendations
  const recs: string[] = [];
  if (claudeMdTokens > 5000) {
    recs.push(`Trim CLAUDE.md (${fmtTokens(claudeMdTokens)} → ~2K tokens) — it loads every turn`);
  }
  if (skills.count > 20) {
    recs.push(`Review ${skills.count} skills — remove unused ones to free context`);
  }
  if (usedPercent > 15) {
    recs.push(`Startup uses ${usedPercent}% of context — consider reducing to <10%`);
  }

  if (recs.length > 0) {
    console.log('  Recommendations:');
    for (const rec of recs) {
      console.log(`    → ${rec}`);
    }
    console.log('');
  }

  // JSON output
  if (showJson) {
    const jsonPath = path.join(cwd, 'context-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      budget: CONTEXT_BUDGET,
      startup: {
        systemPrompt: systemTokens,
        claudeMd: claudeMdTokens,
        skills: { count: skills.count, tokens: skillsTokens },
        memory: { count: memory.count, tokens: memory.totalTokens },
        total: startupTokens,
        percentUsed: usedPercent,
      },
      remaining: remainingTokens,
      compactionEvents: sessions.length > 0 ? findCompactionEvents(sessions).length : null,
      unusedSkills: sessions.length > 0 ? findUnusedSkills(sessions, skills.names) : null,
      recommendations: recs,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`  ✓ JSON report saved to ${jsonPath}`);
    console.log('');
  }
}
