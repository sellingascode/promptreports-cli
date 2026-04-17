/**
 * Scan command — Full scan: tokens + providers + logs
 */

import { scanClaudeSessions } from '../scanners/claude-sessions.js';
import { discoverFromProject } from '../scanners/env-discovery.js';
import { printTerminalSummary } from '../output/terminal.js';

export async function scan(args: string[]): Promise<void> {
  const doAll = args.includes('--all');
  const doProviders = args.includes('--providers');
  const doLogs = args.includes('--logs');
  const doBilling = args.includes('--billing');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PROMPTREPORTS SCAN — Full Stack Analysis                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Discover services from .env.local
  const discovery = discoverFromProject(process.cwd());
  console.log(`  Scanning your environment...`);
  console.log(`  ✓ ${discovery.configured.length} services configured (of ${discovery.total} known)`);

  // 2. Scan Claude Code sessions
  const sessions = scanClaudeSessions(days);
  if (sessions.length > 0) {
    console.log(`  ✓ Claude Code detected — ${sessions.length} sessions found`);
  } else {
    console.log('  ○ No Claude Code sessions found');
  }

  // 3. Check git repo
  try {
    const { execSync } = await import('node:child_process');
    const commits = execSync('git log --oneline --since="' + days + ' days ago" 2>/dev/null', { encoding: 'utf-8' }).trim().split('\n').filter(Boolean).length;
    console.log(`  ✓ Git repo detected — ${commits} commits in last ${days} days`);
  } catch {
    console.log('  ○ No git repo detected');
  }

  console.log('');

  // 4. Print session summary if available
  if (sessions.length > 0) {
    printTerminalSummary(sessions, { showTurns: false, showCommits: false, showFix: false, showJson: false, days });
  }

  // 5. Provider scanning (placeholder — will use fetchers when available)
  if (doAll || doProviders || doBilling) {
    console.log('');
    console.log('  Provider scanning requires API keys in .env.local.');
    console.log(`  Found ${discovery.configured.length} configured services.`);
    console.log('');
    for (const svc of discovery.configured) {
      console.log(`    ✓ ${svc.name} (${svc.category})`);
    }
    if (discovery.unconfigured.length > 0) {
      console.log('');
      console.log(`  ${discovery.unconfigured.length} additional services available. Run: npx @promptreports/cli doctor`);
    }
  }

  console.log('');
  console.log('  Push to dashboard: npx @promptreports/cli push');
  console.log('');
}
