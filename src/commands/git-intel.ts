/**
 * git-intel command — Git intelligence and pattern analysis.
 */

import { execSync } from 'node:child_process';
import type { GlobalFlags } from '../cli';
import { colorize, box, table, sectionHeader } from '../utils/format';

function exec(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim(); } catch { return ''; }
}

export async function gitIntelCommand(flags: GlobalFlags): Promise<void> {
  const { days, json } = flags;
  const showAll = !flags.args.some(a => a.startsWith('--') && !['--json', '--quiet', '--days'].includes(a));
  const showHotspots = flags.args.includes('--hotspots') || showAll;
  const showVelocity = flags.args.includes('--velocity') || showAll;
  const showDebt = flags.args.includes('--debt') || showAll;
  const showPatterns = flags.args.includes('--patterns') || showAll;
  const showChangelog = flags.args.includes('--changelog');

  const results: any = {};

  // Hotspots — files changed most often
  if (showHotspots) {
    const log = exec(`git log --format="" --name-only --since="${days} days ago"`);
    const fileCounts: Record<string, number> = {};
    for (const file of log.split('\n').filter(Boolean)) {
      fileCounts[file] = (fileCounts[file] || 0) + 1;
    }
    results.hotspots = Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([file, count]) => ({ file, changes: count }));
  }

  // Velocity — commits per day
  if (showVelocity) {
    const log = exec(`git log --format="%aI" --since="${days} days ago"`);
    const dates = log.split('\n').filter(Boolean).map(d => d.slice(0, 10));
    const perDay: Record<string, number> = {};
    for (const d of dates) perDay[d] = (perDay[d] || 0) + 1;
    const totalCommits = dates.length;
    const activeDays = Object.keys(perDay).length;

    // Avg files per commit
    const filesLog = exec(`git log --format="" --name-only --since="${days} days ago"`);
    const commitBoundaries = exec(`git log --format="---" --since="${days} days ago"`);
    const avgFiles = totalCommits > 0 ? filesLog.split('\n').filter(Boolean).length / totalCommits : 0;

    results.velocity = {
      totalCommits,
      activeDays,
      commitsPerDay: activeDays > 0 ? (totalCommits / activeDays).toFixed(1) : '0',
      avgFilesPerCommit: avgFiles.toFixed(1),
      perDay,
    };
  }

  // Tech debt — files with most "fix:" commits
  if (showDebt) {
    const log = exec(`git log --format="%s|%H" --since="${days} days ago"`);
    const fixFiles: Record<string, number> = {};
    for (const line of log.split('\n').filter(Boolean)) {
      const [subject, hash] = line.split('|');
      if (subject?.toLowerCase().startsWith('fix')) {
        const files = exec(`git show --format="" --name-only ${hash}`);
        for (const file of files.split('\n').filter(Boolean)) {
          fixFiles[file] = (fixFiles[file] || 0) + 1;
        }
      }
    }
    results.debt = Object.entries(fixFiles)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, fixes]) => ({ file, fixes }));
  }

  // Coding patterns
  if (showPatterns) {
    const log = exec(`git log --format="%aI|%s" --since="${days} days ago"`);
    const entries = log.split('\n').filter(Boolean);

    // Time of day
    const hourCounts: Record<number, number> = {};
    const dayCounts: Record<string, number> = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let fixCount = 0, featCount = 0;

    for (const entry of entries) {
      const [dateStr, subject] = entry.split('|');
      if (!dateStr) continue;
      const date = new Date(dateStr);
      const hour = date.getHours();
      const day = dayNames[date.getDay()];
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      dayCounts[day] = (dayCounts[day] || 0) + 1;

      const sub = (subject || '').toLowerCase();
      if (sub.startsWith('fix')) fixCount++;
      if (sub.startsWith('feat') || sub.startsWith('add') || sub.startsWith('build') || sub.startsWith('implement')) featCount++;
    }

    // Peak hours
    const peakHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([h]) => `${h}:00`);

    // Most productive day
    const bestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];

    results.patterns = {
      peakHours,
      mostProductiveDay: bestDay ? `${bestDay[0]} (${bestDay[1]} commits)` : 'N/A',
      fixToFeatureRatio: featCount > 0 ? `${(fixCount / featCount).toFixed(1)}:1` : `${fixCount} fixes, ${featCount} features`,
      totalCommits: entries.length,
    };
  }

  // Changelog
  if (showChangelog) {
    const log = exec(`git log --format="- %s" --since="${days} days ago"`);
    results.changelog = log.split('\n').filter(Boolean);
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Print
  if (results.hotspots?.length > 0) {
    sectionHeader('Hotspot Files');
    const rows = results.hotspots.map((h: any) => [h.file, String(h.changes) + ' changes']);
    table(['File', 'Changes'], rows);
  }

  if (results.velocity) {
    sectionHeader('Velocity');
    const v = results.velocity;
    console.log(`  Total commits:      ${colorize(String(v.totalCommits), 'bold')}`);
    console.log(`  Active days:        ${v.activeDays}/${days}`);
    console.log(`  Commits/day:        ${v.commitsPerDay}`);
    console.log(`  Avg files/commit:   ${v.avgFilesPerCommit}`);
  }

  if (results.debt?.length > 0) {
    sectionHeader('Tech Debt Indicators');
    for (const d of results.debt) {
      console.log(`  ${colorize(d.file, 'yellow')} — ${d.fixes} fix commits`);
    }
  }

  if (results.patterns) {
    sectionHeader('Coding Patterns');
    const p = results.patterns;
    console.log(`  Peak hours:         ${p.peakHours.join(', ')}`);
    console.log(`  Best day:           ${p.mostProductiveDay}`);
    console.log(`  Fix:feature ratio:  ${p.fixToFeatureRatio}`);
  }

  if (results.changelog) {
    sectionHeader('Changelog');
    for (const line of results.changelog.slice(0, 20)) {
      console.log(`  ${line}`);
    }
    if (results.changelog.length > 20) {
      console.log(colorize(`  ... and ${results.changelog.length - 20} more`, 'dim'));
    }
  }
}
