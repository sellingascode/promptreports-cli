/**
 * Optimize command — AI optimization recommendations
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanClaudeSessions, type SessionStats } from '../scanners/claude-sessions.js';

export async function optimize(args: string[]): Promise<void> {
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  AI OPTIMIZATION RECOMMENDATIONS                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const sessions = scanClaudeSessions(days);
  if (sessions.length === 0) {
    console.log('  No Claude Code sessions found. Run some sessions first.');
    return;
  }

  const recs: Array<{ title: string; savings: number; effort: string; desc: string }> = [];

  // 1. Long sessions
  const longSessions = sessions.filter(s => s.messageCount > 20);
  if (longSessions.length > 0) {
    recs.push({
      title: 'Restart sessions at message 20',
      savings: 67,
      effort: 'low',
      desc: `${longSessions.length} sessions exceeded 20 messages — context bloat wastes tokens`
    });
  }

  // 2. Model mix
  const opusTurns = sessions.reduce((sum, s) => sum + s.turns.filter(t => t.model?.includes('opus')).length, 0);
  const totalTurns = sessions.reduce((sum, s) => sum + s.turns.length, 0);
  if (totalTurns > 0 && (opusTurns / totalTurns) > 0.7) {
    recs.push({
      title: 'Use /fast for simple tasks',
      savings: 128,
      effort: 'low',
      desc: `${Math.round((opusTurns / totalTurns) * 100)}% Opus usage — simple tasks should use /fast`
    });
  }

  // 3. CLAUDE.md size
  const claudeMd = path.join(process.cwd(), 'CLAUDE.md');
  if (fs.existsSync(claudeMd)) {
    const words = fs.readFileSync(claudeMd, 'utf-8').split(/\s+/).length;
    if (words > 2500) {
      recs.push({
        title: `Trim CLAUDE.md (${words.toLocaleString()} → 2,000 words)`,
        savings: 42,
        effort: 'medium',
        desc: 'CLAUDE.md loads every message — large files cost tokens on every turn'
      });
    }
  }

  // 4. Skills count
  const skillsDir = path.join(process.cwd(), '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      const dirs = fs.readdirSync(skillsDir).filter(d => {
        try { return fs.statSync(path.join(skillsDir, d)).isDirectory(); } catch { return false; }
      });
      if (dirs.length > 15) {
        recs.push({
          title: `Review ${dirs.length} installed skills`,
          savings: 15,
          effort: 'low',
          desc: 'Each skill increases context size — remove unused skills to save tokens'
        });
      }
    } catch {}
  }

  // Always add general recs
  recs.push({
    title: 'Consolidate search APIs',
    savings: 18,
    effort: 'low',
    desc: 'If using both Serper and Tavily, consolidate to one'
  });

  recs.push({
    title: 'Cache frequently-used API responses',
    savings: 23,
    effort: 'medium',
    desc: 'Add caching to high-frequency API routes to reduce compute costs'
  });

  let totalSavings = 0;
  for (const rec of recs) {
    totalSavings += rec.savings;
    const icon = rec.effort === 'low' ? '✓' : '◐';
    console.log(`  ${icon}  -$${rec.savings}/mo  ${rec.title}`);
    console.log(`     ${rec.desc}`);
    console.log('');
  }

  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log(`│  TOTAL POTENTIAL SAVINGS:  $${totalSavings}/mo`.padEnd(62) + '│');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Push to dashboard for tracking: npx @promptreports/cli push');
  console.log('');
}
