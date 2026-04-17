/**
 * Default command — Token usage summary
 * Migrated from tools/model-token-tracker.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanClaudeSessions, type SessionStats } from '../scanners/claude-sessions.js';
import { printTerminalSummary } from '../output/terminal.js';

export async function summary(args: string[]): Promise<void> {
  const showTips = args.includes('--tips');
  const showTurns = args.includes('--turns');
  const showJson = args.includes('--json');
  const showFix = args.includes('--fix');
  const showCommits = args.includes('--commits');
  const todayOnly = args.includes('--today');
  const daysIdx = args.indexOf('--days');
  const days = todayOnly ? 1 : daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  if (showTips) {
    printTips();
    return;
  }

  printHeader();

  const sessions = scanClaudeSessions(days);
  if (sessions.length === 0) {
    console.log('  No Claude Code sessions found in ~/.claude/projects/');
    console.log('  Make sure you have Claude Code installed and have run at least one session.');
    return;
  }

  console.log(`  Scanning ${sessions.length} session files...`);
  console.log('');

  printTerminalSummary(sessions, { showTurns, showCommits, showFix, showJson, days });
}

function printHeader(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PROMPTREPORTS — Vibe Coding Stack Optimizer                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

function printTips(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  TOKEN REDUCTION TIPS                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  1. Restart sessions at ~20 messages (context bloat wastes tokens)');
  console.log('  2. Use /fast for simple tasks (grep, git, formatting)');
  console.log('  3. Keep CLAUDE.md under 2,000 words (loads every message)');
  console.log('  4. Move detailed instructions to .claude/skills/ files');
  console.log('  5. Use specific file paths instead of "find the file"');
  console.log('  6. Avoid pasting large files — use Read tool instead');
  console.log('  7. Chain commands with && to reduce round trips');
  console.log('  8. Use subagents for parallel research tasks');
  console.log('');
}
