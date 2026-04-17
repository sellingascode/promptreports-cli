/**
 * Costs command — Cost attribution by model, commit, or feature
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { scanClaudeSessions, type SessionStats, type TurnRecord } from '../scanners/claude-sessions.js';
import { discoverFromProject } from '../scanners/env-discovery.js';

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}

interface ModelGroup {
  model: string;
  turns: number;
  cost: number;
  tokens: number;
  unitCost: number;
}

function costByModel(sessions: SessionStats[]): ModelGroup[] {
  const groups: Record<string, { turns: number; cost: number; tokens: number }> = {};

  for (const session of sessions) {
    for (const turn of session.turns) {
      const model = turn.model || 'unknown';
      if (!groups[model]) groups[model] = { turns: 0, cost: 0, tokens: 0 };
      groups[model].turns++;
      groups[model].cost += turn.costUsd;
      groups[model].tokens += turn.totalTokens;
    }
  }

  return Object.entries(groups)
    .map(([model, data]) => ({
      model,
      turns: data.turns,
      cost: data.cost,
      tokens: data.tokens,
      unitCost: data.turns > 0 ? data.cost / data.turns : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

interface CommitGroup {
  hash: string;
  message: string;
  date: string;
  cost: number;
  turns: number;
}

function costByCommit(sessions: SessionStats[], days: number, cwd: string): CommitGroup[] {
  // Get git commits
  let commits: Array<{ hash: string; message: string; date: string; timestamp: number }> = [];
  try {
    const log = execSync(
      `git log --format="%H|%s|%aI" --since="${days} days ago" 2>/dev/null`,
      { encoding: 'utf-8', cwd }
    ).trim();
    if (log) {
      commits = log.split('\n').filter(Boolean).map(line => {
        const [hash, message, date] = line.split('|');
        return { hash, message: message || '', date: date || '', timestamp: new Date(date).getTime() };
      });
    }
  } catch {
    return [];
  }

  if (commits.length === 0) return [];

  // Collect all turns with timestamps
  const allTurns: TurnRecord[] = sessions.flatMap(s => s.turns).filter(t => t.timestamp);
  allTurns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Sort commits by time
  commits.sort((a, b) => a.timestamp - b.timestamp);

  const results: CommitGroup[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const commitTime = commit.timestamp;
    const prevTime = i > 0 ? commits[i - 1].timestamp : commitTime - 24 * 60 * 60 * 1000;

    // Find turns between previous commit and this commit
    const matchingTurns = allTurns.filter(t => {
      const turnTime = new Date(t.timestamp).getTime();
      return turnTime > prevTime && turnTime <= commitTime;
    });

    const cost = matchingTurns.reduce((s, t) => s + t.costUsd, 0);
    results.push({
      hash: commit.hash.slice(0, 8),
      message: commit.message.slice(0, 50),
      date: commit.date.slice(0, 10),
      cost,
      turns: matchingTurns.length,
    });
  }

  return results.sort((a, b) => b.cost - a.cost);
}

interface FeatureGroup {
  name: string;
  category: string;
  configured: boolean;
}

function costByFeature(cwd: string): FeatureGroup[] {
  const discovery = discoverFromProject(cwd);
  return discovery.configured.map(svc => ({
    name: svc.name,
    category: svc.category,
    configured: true,
  }));
}

export async function costs(args: string[]): Promise<void> {
  const showJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  // Determine grouping mode
  const byIdx = args.indexOf('--by');
  const byMode = byIdx >= 0 ? (args[byIdx + 1] || 'model') : 'model';

  const cwd = process.cwd();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  COST ATTRIBUTION                                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const sessions = scanClaudeSessions(days);

  if (byMode === 'model') {
    if (sessions.length === 0) {
      console.log('  No Claude Code sessions found. Run some sessions first.');
      console.log('');
      return;
    }

    const groups = costByModel(sessions);
    const totalCost = groups.reduce((s, g) => s + g.cost, 0);
    const totalTurns = groups.reduce((s, g) => s + g.turns, 0);

    console.log(`  Grouping by: model  (${days}-day window, ${sessions.length} sessions)`);
    console.log('');

    // Table header
    const modelWidth = Math.min(40, Math.max(20, ...groups.map(g => g.model.length + 2)));
    console.log('┌' + '─'.repeat(modelWidth) + '┬──────────┬──────────┬────────────┬───────────┐');
    console.log('│' + ' Model'.padEnd(modelWidth) + '│ Turns    │ Cost     │ Tokens     │ $/turn    │');
    console.log('├' + '─'.repeat(modelWidth) + '┼──────────┼──────────┼────────────┼───────────┤');

    for (const group of groups) {
      const modelName = group.model.length > modelWidth - 2
        ? ' ' + group.model.slice(0, modelWidth - 4) + '… '
        : (' ' + group.model).padEnd(modelWidth);
      const pctOfCost = totalCost > 0 ? Math.round((group.cost / totalCost) * 100) : 0;
      console.log(
        '│' + modelName +
        '│ ' + String(group.turns).padStart(7) + ' ' +
        '│ ' + fmtCost(group.cost).padStart(7) + ' ' +
        '│ ' + fmtTokens(group.tokens).padStart(9) + ' ' +
        '│ ' + fmtCost(group.unitCost).padStart(8) + ' │'
      );
    }

    console.log('├' + '─'.repeat(modelWidth) + '┼──────────┼──────────┼────────────┼───────────┤');
    console.log(
      '│' + ' TOTAL'.padEnd(modelWidth) +
      '│ ' + String(totalTurns).padStart(7) + ' ' +
      '│ ' + fmtCost(totalCost).padStart(7) + ' ' +
      '│ ' + fmtTokens(groups.reduce((s, g) => s + g.tokens, 0)).padStart(9) + ' ' +
      '│ ' + fmtCost(totalTurns > 0 ? totalCost / totalTurns : 0).padStart(8) + ' │'
    );
    console.log('└' + '─'.repeat(modelWidth) + '┴──────────┴──────────┴────────────┴───────────┘');

    if (showJson) {
      const jsonPath = path.join(cwd, 'costs-report.json');
      const report = {
        timestamp: new Date().toISOString(),
        mode: 'model',
        days,
        sessions: sessions.length,
        totalCost,
        totalTurns,
        groups: groups.map(g => ({ model: g.model, turns: g.turns, cost: g.cost, tokens: g.tokens, unitCost: g.unitCost })),
      };
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log('');
      console.log(`  ✓ JSON report saved to ${jsonPath}`);
    }

  } else if (byMode === 'commit') {
    if (sessions.length === 0) {
      console.log('  No Claude Code sessions found. Run some sessions first.');
      console.log('');
      return;
    }

    const commitGroups = costByCommit(sessions, days, cwd);

    if (commitGroups.length === 0) {
      console.log('  No git commits found in the lookback window.');
      console.log('');
      return;
    }

    console.log(`  Grouping by: commit  (${days}-day window)`);
    console.log('');

    console.log('┌──────────┬──────────┬────────┬────────────────────────────────────────────┐');
    console.log('│ Hash     │ Cost     │ Turns  │ Message                                    │');
    console.log('├──────────┼──────────┼────────┼────────────────────────────────────────────┤');

    const shown = commitGroups.slice(0, 20);
    for (const commit of shown) {
      const msg = commit.message.length > 42 ? commit.message.slice(0, 39) + '…' : commit.message;
      console.log(
        '│ ' + commit.hash.padEnd(9) +
        '│ ' + fmtCost(commit.cost).padStart(7) + ' ' +
        '│ ' + String(commit.turns).padStart(5) + ' ' +
        '│ ' + msg.padEnd(43) + '│'
      );
    }

    if (commitGroups.length > 20) {
      console.log(`│ … and ${commitGroups.length - 20} more commits`.padEnd(99) + '│');
    }

    console.log('└──────────┴──────────┴────────┴────────────────────────────────────────────┘');

    const totalCommitCost = commitGroups.reduce((s, c) => s + c.cost, 0);
    const avgCostPerCommit = commitGroups.length > 0 ? totalCommitCost / commitGroups.length : 0;
    console.log('');
    console.log(`  Total: ${fmtCost(totalCommitCost)} across ${commitGroups.length} commits — avg ${fmtCost(avgCostPerCommit)}/commit`);

    if (showJson) {
      const jsonPath = path.join(cwd, 'costs-report.json');
      const report = {
        timestamp: new Date().toISOString(),
        mode: 'commit',
        days,
        totalCost: totalCommitCost,
        avgCostPerCommit,
        commits: commitGroups,
      };
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log(`  ✓ JSON report saved to ${jsonPath}`);
    }

  } else if (byMode === 'feature') {
    const features = costByFeature(cwd);

    if (features.length === 0) {
      console.log('  No configured services found in .env.local.');
      console.log('  Run from your project directory with a .env.local file.');
      console.log('');
      return;
    }

    console.log(`  Grouping by: feature/service  (from .env.local)`);
    console.log('');
    console.log('  Configured provider services:');
    console.log('');

    const categories: Record<string, FeatureGroup[]> = {};
    for (const feat of features) {
      if (!categories[feat.category]) categories[feat.category] = [];
      categories[feat.category].push(feat);
    }

    for (const [category, feats] of Object.entries(categories).sort()) {
      console.log(`  ${category}:`);
      for (const feat of feats) {
        console.log(`    ✓ ${feat.name}`);
      }
    }

    console.log('');
    console.log('  Note: Per-service cost breakdown requires provider API access.');
    console.log('  Use --by model for Claude Code costs, or --by commit for cost-per-commit.');

    if (showJson) {
      const jsonPath = path.join(cwd, 'costs-report.json');
      const report = {
        timestamp: new Date().toISOString(),
        mode: 'feature',
        services: features,
      };
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log('');
      console.log(`  ✓ JSON report saved to ${jsonPath}`);
    }

  } else {
    console.log(`  Unknown grouping: --by ${byMode}`);
    console.log('  Supported: --by model, --by commit, --by feature');
  }

  console.log('');
}
