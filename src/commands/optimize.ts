/**
 * Optimize command — AI optimization recommendations
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanClaudeSessions, type SessionStats } from '../scanners/claude-sessions.js';
import { discoverFromProject } from '../scanners/env-discovery.js';

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

  // 1. Long sessions — based on actual session data
  const longSessions = sessions.filter(s => s.messageCount > 20);
  if (longSessions.length > 0) {
    const avgWasted = longSessions.reduce((sum, s) => sum + s.estimatedCostUsd * 0.3, 0);
    const monthlySavings = Math.max(10, Math.round(avgWasted * 30 / days));
    recs.push({
      title: 'Restart sessions at message 20',
      savings: monthlySavings,
      effort: 'low',
      desc: `${longSessions.length} sessions exceeded 20 messages — context bloat wastes tokens on re-reads`
    });
  }

  // 2. Model mix — based on actual turn data
  const opusTurns = sessions.reduce((sum, s) => sum + s.turns.filter(t => t.model?.includes('opus')).length, 0);
  const totalTurns = sessions.reduce((sum, s) => sum + s.turns.length, 0);
  const opusPercent = totalTurns > 0 ? (opusTurns / totalTurns) * 100 : 0;
  if (opusPercent > 70) {
    const opusCost = sessions.reduce((sum, s) => sum + s.turns.filter(t => t.model?.includes('opus')).reduce((a, t) => a + t.costUsd, 0), 0);
    const potentialSavings = Math.max(20, Math.round(opusCost * 0.4 * 30 / days));
    recs.push({
      title: 'Use /fast for simple tasks',
      savings: potentialSavings,
      effort: 'low',
      desc: `${Math.round(opusPercent)}% of turns use Opus — simple tasks (git, grep, formatting) should use /fast`
    });
  }

  // 3. CLAUDE.md size — based on actual file in cwd
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

  // 4. Skills count — based on actual installed skills
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

  // 5. Duplicate search APIs — based on actual .env.local
  const discovery = discoverFromProject(process.cwd());
  const searchServices = discovery.configured.filter(s =>
    ['serper', 'tavily', 'exa', 'serpapi'].includes(s.id)
  );
  if (searchServices.length > 1) {
    recs.push({
      title: `Consolidate ${searchServices.length} search APIs (${searchServices.map(s => s.name).join(', ')})`,
      savings: 18,
      effort: 'low',
      desc: 'Multiple search APIs serve the same purpose — consolidate to reduce duplicate costs'
    });
  }

  // 6. Cache hit rate — based on actual session data
  const avgCacheHit = sessions.reduce((s, st) => s + st.cacheHitRate, 0) / sessions.length;
  if (avgCacheHit < 50) {
    recs.push({
      title: 'Improve cache hit rate',
      savings: 23,
      effort: 'medium',
      desc: `Current avg cache hit: ${Math.round(avgCacheHit)}% — use consistent prompt structures and shorter sessions`
    });
  }

  if (recs.length === 0) {
    console.log('  Your usage looks efficient! No major optimization opportunities found.');
    console.log('');
    return;
  }

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
  console.log('  Push to dashboard for tracking: npx promptreports push');
  console.log('');
}
