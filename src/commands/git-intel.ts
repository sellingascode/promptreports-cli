/**
 * Git Intel command — Git intelligence: hotspots, velocity, debt, patterns
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface FileHotspot {
  file: string;
  changes: number;
}

interface VelocityStats {
  totalCommits: number;
  days: number;
  commitsPerDay: number;
  avgFilesPerCommit: number;
  totalFilesChanged: number;
}

interface DebtFile {
  file: string;
  fixCommits: number;
  totalCommits: number;
  fixRatio: number;
}

interface PatternStats {
  hourDistribution: Record<number, number>;
  dayDistribution: Record<string, number>;
  mostProductiveHour: number;
  mostProductiveDay: string;
  fixCount: number;
  featCount: number;
  fixFeatRatio: string;
}

interface ChangelogEntry {
  hash: string;
  message: string;
  date: string;
}

function gitExec(cmd: string, days: number): string {
  try {
    return execSync(
      `git ${cmd} --since="${days} days ago" 2>/dev/null`,
      { encoding: 'utf-8', cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }
    ).trim();
  } catch {
    return '';
  }
}

function getHotspots(days: number, limit: number): FileHotspot[] {
  const output = gitExec('log --name-only --format=""', days);
  if (!output) return [];

  const counts = new Map<string, number>();
  for (const line of output.split('\n')) {
    const file = line.trim();
    if (!file || file.startsWith('commit ')) continue;
    counts.set(file, (counts.get(file) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([file, changes]) => ({ file, changes }));
}

function getVelocity(days: number): VelocityStats {
  const commitOutput = gitExec('log --oneline', days);
  const commits = commitOutput ? commitOutput.split('\n').filter(Boolean) : [];

  const fileOutput = gitExec('log --name-only --format=""', days);
  const files = fileOutput ? fileOutput.split('\n').filter(Boolean) : [];

  const totalCommits = commits.length;
  const totalFilesChanged = new Set(files).size;
  const avgFilesPerCommit = totalCommits > 0 ? files.length / totalCommits : 0;
  const commitsPerDay = totalCommits / Math.max(1, days);

  return {
    totalCommits,
    days,
    commitsPerDay,
    avgFilesPerCommit,
    totalFilesChanged,
  };
}

function getDebt(days: number): DebtFile[] {
  // Get all fix commits with files
  const fixOutput = gitExec('log --grep="fix" -i --name-only --format=""', days);
  const fixFiles = new Map<string, number>();
  if (fixOutput) {
    for (const line of fixOutput.split('\n')) {
      const file = line.trim();
      if (!file) continue;
      fixFiles.set(file, (fixFiles.get(file) || 0) + 1);
    }
  }

  // Get total commits per file
  const allOutput = gitExec('log --name-only --format=""', days);
  const allFiles = new Map<string, number>();
  if (allOutput) {
    for (const line of allOutput.split('\n')) {
      const file = line.trim();
      if (!file) continue;
      allFiles.set(file, (allFiles.get(file) || 0) + 1);
    }
  }

  const results: DebtFile[] = [];
  for (const [file, fixCount] of fixFiles) {
    const totalCount = allFiles.get(file) || fixCount;
    results.push({
      file,
      fixCommits: fixCount,
      totalCommits: totalCount,
      fixRatio: totalCount > 0 ? fixCount / totalCount : 0,
    });
  }

  return results.sort((a, b) => b.fixCommits - a.fixCommits).slice(0, 15);
}

function getPatterns(days: number): PatternStats {
  const output = gitExec('log --format="%aI %s"', days);
  if (!output) {
    return {
      hourDistribution: {},
      dayDistribution: {},
      mostProductiveHour: 0,
      mostProductiveDay: 'N/A',
      fixCount: 0,
      featCount: 0,
      fixFeatRatio: 'N/A',
    };
  }

  const hourDist: Record<number, number> = {};
  const dayDist: Record<string, number> = {};
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let fixCount = 0;
  let featCount = 0;

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx < 0) continue;

    const dateStr = line.substring(0, spaceIdx);
    const message = line.substring(spaceIdx + 1).toLowerCase();

    try {
      const date = new Date(dateStr);
      const hour = date.getHours();
      const day = dayNames[date.getDay()];

      hourDist[hour] = (hourDist[hour] || 0) + 1;
      dayDist[day] = (dayDist[day] || 0) + 1;
    } catch {
      // skip bad dates
    }

    if (message.startsWith('fix') || message.includes('fix:') || message.includes('bugfix')) {
      fixCount++;
    }
    if (message.startsWith('feat') || message.includes('feat:') || message.includes('feature')) {
      featCount++;
    }
  }

  const mostProductiveHour = Object.entries(hourDist)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '0';
  const mostProductiveDay = Object.entries(dayDist)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  const ratio = featCount > 0 ? `${(fixCount / featCount).toFixed(2)}:1` : (fixCount > 0 ? 'all fixes' : 'N/A');

  return {
    hourDistribution: hourDist,
    dayDistribution: dayDist,
    mostProductiveHour: parseInt(mostProductiveHour),
    mostProductiveDay,
    fixCount,
    featCount,
    fixFeatRatio: ratio,
  };
}

function getChangelog(days: number): ChangelogEntry[] {
  const output = gitExec('log --format="%h|%aI|%s"', days);
  if (!output) return [];

  return output.split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    return {
      hash: parts[0] || '',
      date: (parts[1] || '').split('T')[0],
      message: parts.slice(2).join('|'),
    };
  });
}

export async function gitIntel(args: string[]): Promise<void> {
  const doHotspots = args.includes('--hotspots');
  const doVelocity = args.includes('--velocity');
  const doDebt = args.includes('--debt');
  const doPatterns = args.includes('--patterns');
  const doChangelog = args.includes('--changelog');
  const showJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 30 : 30;
  const showAll = !doHotspots && !doVelocity && !doDebt && !doPatterns && !doChangelog;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  GIT INTELLIGENCE                                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Verify git repo
  try {
    execSync('git rev-parse --git-dir 2>/dev/null', { encoding: 'utf-8', cwd: process.cwd() });
  } catch {
    console.log('  ✗ Not a git repository. Run this from a git repo.');
    return;
  }

  console.log(`  Analyzing last ${days} days of git history...`);
  console.log('');

  const jsonOutput: Record<string, unknown> = {};

  // 1. Hotspots
  if (showAll || doHotspots) {
    const hotspots = getHotspots(days, 15);

    if (hotspots.length > 0) {
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log('  │  HOTSPOTS (most frequently changed files)'.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      const maxChanges = hotspots[0].changes;
      for (const h of hotspots) {
        const bar = '█'.repeat(Math.min(20, Math.round(h.changes / maxChanges * 20)));
        const fileStr = h.file.length > 40 ? '...' + h.file.slice(-37) : h.file;
        console.log(`  │  ${String(h.changes).padStart(4)}  ${bar.padEnd(20)}  ${fileStr}`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ○ No commits found in the last ' + days + ' days');
    }
    console.log('');
    jsonOutput.hotspots = hotspots;
  }

  // 2. Velocity
  if (showAll || doVelocity) {
    const velocity = getVelocity(days);

    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log('  │  VELOCITY'.padEnd(60) + '│');
    console.log('  ├─────────────────────────────────────────────────────────┤');
    console.log(`  │  Total commits:      ${velocity.totalCommits}`.padEnd(60) + '│');
    console.log(`  │  Commits/day:        ${velocity.commitsPerDay.toFixed(1)}`.padEnd(60) + '│');
    console.log(`  │  Avg files/commit:   ${velocity.avgFilesPerCommit.toFixed(1)}`.padEnd(60) + '│');
    console.log(`  │  Unique files:       ${velocity.totalFilesChanged}`.padEnd(60) + '│');
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log('');
    jsonOutput.velocity = velocity;
  }

  // 3. Debt
  if (showAll || doDebt) {
    const debt = getDebt(days);

    if (debt.length > 0) {
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log('  │  TECH DEBT (files with most fix: commits)'.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const d of debt.slice(0, 10)) {
        const fileStr = d.file.length > 35 ? '...' + d.file.slice(-32) : d.file;
        const ratio = Math.round(d.fixRatio * 100);
        console.log(`  │  ${String(d.fixCommits).padStart(3)} fixes  (${String(ratio).padStart(3)}%)  ${fileStr}`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    } else {
      console.log('  ✓ No fix: commits found');
    }
    console.log('');
    jsonOutput.debt = debt;
  }

  // 4. Patterns
  if (showAll || doPatterns) {
    const patterns = getPatterns(days);

    console.log('  ┌─────────────────────────────────────────────────────────┐');
    console.log('  │  PATTERNS'.padEnd(60) + '│');
    console.log('  ├─────────────────────────────────────────────────────────┤');
    console.log(`  │  Most productive hour: ${String(patterns.mostProductiveHour).padStart(2)}:00`.padEnd(60) + '│');
    console.log(`  │  Most productive day:  ${patterns.mostProductiveDay}`.padEnd(60) + '│');
    console.log(`  │  Fix commits:          ${patterns.fixCount}`.padEnd(60) + '│');
    console.log(`  │  Feature commits:      ${patterns.featCount}`.padEnd(60) + '│');
    console.log(`  │  Fix:Feature ratio:    ${patterns.fixFeatRatio}`.padEnd(60) + '│');
    console.log('  ├─────────────────────────────────────────────────────────┤');

    // Hour-of-day sparkline
    const hours = Object.entries(patterns.hourDistribution).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    if (hours.length > 0) {
      const maxH = Math.max(...hours.map(h => h[1]));
      let sparkline = '  │  ';
      for (let h = 0; h < 24; h++) {
        const count = patterns.hourDistribution[h] || 0;
        const height = maxH > 0 ? Math.round(count / maxH * 4) : 0;
        const chars = [' ', '▁', '▂', '▃', '▄'];
        sparkline += chars[height];
      }
      console.log((sparkline + '  ').padEnd(60) + '│');
      console.log('  │  0h      6h      12h     18h     24h'.padEnd(60) + '│');
    }
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log('');
    jsonOutput.patterns = patterns;
  }

  // 5. Changelog
  if (doChangelog) {
    const changelog = getChangelog(days);

    if (changelog.length > 0) {
      console.log('  ┌─────────────────────────────────────────────────────────┐');
      console.log(`  │  CHANGELOG (${changelog.length} commits)`.padEnd(60) + '│');
      console.log('  ├─────────────────────────────────────────────────────────┤');
      for (const entry of changelog.slice(0, 30)) {
        const msg = entry.message.length > 45 ? entry.message.substring(0, 42) + '...' : entry.message;
        console.log(`  │  ${entry.hash} ${entry.date} ${msg}`.padEnd(60) + '│');
      }
      if (changelog.length > 30) {
        console.log(`  │  ... and ${changelog.length - 30} more`.padEnd(60) + '│');
      }
      console.log('  └─────────────────────────────────────────────────────────┘');
    }
    console.log('');
    jsonOutput.changelog = changelog;
  }

  if (showJson) {
    const outPath = path.join(process.cwd(), 'git-intel.json');
    fs.writeFileSync(outPath, JSON.stringify(jsonOutput, null, 2));
    console.log(`  ✓ JSON exported to ${outPath}`);
    console.log('');
  }
}
