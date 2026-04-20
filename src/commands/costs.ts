/**
 * costs command — Cost attribution by feature, model, and commit.
 *
 * `--push-to-app` sends the full session/turn/commit payload to the platform's
 * token-forensics ingest endpoint so Token Forensics / Cross-System Traces can
 * render the git → Claude Code → OpenRouter → cost chain without the operator
 * having to run a separate `push` command.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GlobalFlags } from '../cli';
import { scanProjectSessions, parseSession, analyzeSession, buildPayload, type SessionStats } from '../utils/session-scanner';
import { discoverFromProject } from '../../fetchers/env-discovery';
import { runAllFetchers } from '../../fetchers/index';
import { colorize, table, formatCost, sectionHeader } from '../utils/format';

interface CostEntry {
  name: string;
  cost: number;
  calls: number;
  unitCost: number;
  trend?: string;
}

function getCommits(days: number): Array<{ hash: string; date: string; subject: string; author: string }> {
  try {
    const log = execSync(`git log --format="%H|%aI|%s|%an" --since="${days} days ago"`, { encoding: 'utf-8' });
    return log.trim().split('\n').filter(Boolean).map(line => {
      const [hash, date, subject, author] = line.split('|');
      return { hash: hash.slice(0, 8), date, subject, author };
    });
  } catch {
    return [];
  }
}

export async function costsCommand(flags: GlobalFlags): Promise<void> {
  const { days, json } = flags;
  const groupBy = flags.args.includes('--by') ? flags.args[flags.args.indexOf('--by') + 1] : 'model';
  const pushToApp = flags.args.includes('--push-to-app');

  // Get session data
  const files = scanProjectSessions(days);
  const allStats = files.map(f => analyzeSession(parseSession(f), days)).filter(Boolean) as SessionStats[];
  const totalSessionCost = allStats.reduce((a, s) => a + s.estimatedCostUsd, 0);

  // ── Optional: push the full correlated payload to the platform ─────────────
  if (pushToApp) {
    await pushCostsToApp(allStats, days, flags);
    return;
  }

  // Get provider costs
  const { envVars } = discoverFromProject(process.cwd());
  let providerResults: any[] = [];
  try {
    providerResults = await runAllFetchers(envVars, days);
  } catch { /* */ }
  const providerCosts = providerResults.filter(r => r.status === 'ok');
  const totalProviderCost = providerCosts.reduce((a, r) => a + r.cost.amount, 0);

  if (groupBy === 'model') {
    // Group Claude Code costs by model
    const modelCosts: Record<string, { cost: number; turns: number; tokens: number }> = {};
    for (const stats of allStats) {
      for (const turn of stats.turns) {
        const model = turn.model || 'unknown';
        if (!modelCosts[model]) modelCosts[model] = { cost: 0, turns: 0, tokens: 0 };
        modelCosts[model].cost += turn.costUsd;
        modelCosts[model].turns += 1;
        modelCosts[model].tokens += turn.totalTokens;
      }
    }

    const entries = Object.entries(modelCosts)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([model, data]) => ({
        name: model.replace('claude-', '').slice(0, 25),
        cost: data.cost,
        calls: data.turns,
        unitCost: data.turns > 0 ? data.cost / data.turns : 0,
      }));

    if (json) {
      console.log(JSON.stringify({ groupBy, entries, totalSessionCost, totalProviderCost }, null, 2));
      return;
    }

    sectionHeader('Cost by Model (Claude Code)');
    const rows = entries.map(e => [
      e.name,
      formatCost(e.cost),
      String(e.calls) + ' turns',
      formatCost(e.unitCost) + '/turn',
      ((e.cost / Math.max(0.01, totalSessionCost)) * 100).toFixed(0) + '%',
    ]);
    if (rows.length > 0) table(['Model', 'Cost', 'Turns', 'Unit Cost', '%'], rows);
  }

  if (groupBy === 'commit') {
    const commits = getCommits(days);
    // Correlate commits with sessions by timestamp
    const commitCosts: Array<{ hash: string; subject: string; cost: number }> = [];

    for (const commit of commits.slice(0, 20)) {
      const commitTime = new Date(commit.date).getTime();
      // Find sessions active around commit time (within 1 hour)
      let cost = 0;
      for (const stats of allStats) {
        const sessionStart = new Date(stats.startedAt).getTime();
        const sessionEnd = new Date(stats.endedAt).getTime();
        if (commitTime >= sessionStart - 3600000 && commitTime <= sessionEnd + 3600000) {
          // Estimate: this session's cost contributed to this commit
          cost += stats.estimatedCostUsd / Math.max(1, commits.filter(c => {
            const ct = new Date(c.date).getTime();
            return ct >= sessionStart - 3600000 && ct <= sessionEnd + 3600000;
          }).length);
        }
      }
      commitCosts.push({ hash: commit.hash, subject: commit.subject.slice(0, 50), cost });
    }

    if (json) {
      console.log(JSON.stringify({ groupBy, commitCosts, totalSessionCost }, null, 2));
      return;
    }

    sectionHeader('Cost by Commit');
    const rows = commitCosts.map(c => [
      colorize(c.hash, 'dim'),
      c.subject,
      c.cost > 0 ? formatCost(c.cost) : colorize('$0.00', 'dim'),
    ]);
    if (rows.length > 0) table(['Hash', 'Message', 'Est. Cost'], rows);
  }

  if (groupBy === 'feature') {
    // Group provider costs by provider as proxy for feature
    if (json) {
      console.log(JSON.stringify({ groupBy, providerCosts: providerCosts.map(p => ({ provider: p.provider, cost: p.cost.amount, usage: p.usage })), totalProviderCost }, null, 2));
      return;
    }

    sectionHeader('Cost by Provider');
    const rows = providerCosts
      .sort((a, b) => b.cost.amount - a.cost.amount)
      .map(p => [
        p.provider,
        p.category,
        formatCost(p.cost.amount),
        `${p.usage.primary.value} ${p.usage.primary.unit}`,
      ]);
    if (rows.length > 0) table(['Provider', 'Category', 'Cost', 'Usage'], rows);
  }

  // Summary
  console.log('');
  console.log(`  ${colorize('Total Claude Code:', 'bold')} ${formatCost(totalSessionCost)} (${allStats.length} sessions, ${days}d)`);
  console.log(`  ${colorize('Total Providers:', 'bold')}   ${formatCost(totalProviderCost)} (${providerCosts.length} services, ${days}d)`);
  console.log(`  ${colorize('Total Burn Rate:', 'bold')}   ${formatCost(totalSessionCost + totalProviderCost)}`);
  console.log('');
}

// ─── --push-to-app implementation ───────────────────────────────────────────

async function pushCostsToApp(stats: SessionStats[], days: number, flags: GlobalFlags): Promise<void> {
  loadEnvLocal();

  const apiKey = process.env['PROMPTREPORTS_API_KEY'];
  const url = process.env['PROMPTREPORTS_URL'] || 'https://www.promptreports.ai';

  if (!apiKey) {
    console.error(colorize('  --push-to-app: PROMPTREPORTS_API_KEY not set in .env.local or environment.', 'red'));
    process.exit(1);
  }

  if (stats.length === 0) {
    console.log(colorize(`  No sessions in the last ${days} days — nothing to push.`, 'yellow'));
    return;
  }

  const payload = buildPayload(stats, days);
  payload.source = 'promptreports-cli';

  if (!flags.quiet) {
    console.log('');
    console.log(colorize('  Pushing cost payload to Token Forensics...', 'bold'));
    console.log(`  Sessions:  ${payload.sessions.length}`);
    console.log(`  Turns:     ${payload.turns.length}`);
    console.log(`  Commits:   ${payload.commits?.length || 0}`);
    console.log(`  Cost:      ${formatCost(payload.aggregate.estimatedCostUsd)}`);
  }

  if (flags.dryRun) {
    console.log('');
    console.log(colorize('  --dry-run: skipping network call.', 'yellow'));
    return;
  }

  try {
    const res = await fetch(`${url}/api/token-forensics/cli-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${errBody.slice(0, 200)}`);
    }
    const result = await res.json() as Record<string, unknown>;
    console.log('');
    console.log(colorize(`  Pushed: ${result.message || 'ok'}`, 'green'));
    console.log('');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(colorize(`  Push failed: ${msg}`, 'red'));
    process.exit(1);
  }
}

function loadEnvLocal(): void {
  try {
    const envPath = join(process.cwd(), '.env.local');
    if (!existsSync(envPath)) return;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* noop */ }
}
