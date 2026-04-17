/**
 * Models command — Model router tuner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanClaudeSessions, type SessionStats, type TurnRecord } from '../scanners/claude-sessions.js';

// Pricing per 1M tokens (input/output)
const MODEL_PRICING: Record<string, { input: number; output: number; tier: string }> = {
  opus:   { input: 15,    output: 75,    tier: 'premium' },
  sonnet: { input: 3,     output: 15,    tier: 'mid' },
  haiku:  { input: 0.25,  output: 1.25,  tier: 'fast' },
};

type TaskCategory = 'search' | 'read' | 'write' | 'complex';

interface ModelUsage {
  model: string;
  tier: string;
  turns: number;
  cost: number;
  tasks: Record<TaskCategory, number>;
}

interface DowngradeRecommendation {
  from: string;
  to: string;
  taskType: TaskCategory;
  turns: number;
  currentCost: number;
  projectedCost: number;
  savings: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}

function getModelTier(model: string | undefined): string {
  if (!model) return 'unknown';
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'unknown';
}

function categorizeTask(turn: TurnRecord): TaskCategory {
  const preview = (turn.userPromptPreview || '').toLowerCase();

  // Search tasks: grep, find, search, glob, rg
  if (/\b(grep|find|search|glob|rg|locate|where is|look for)\b/.test(preview)) {
    return 'search';
  }

  // Read tasks: read, cat, show, display, look at, check file
  if (/\b(read|cat|show me|display|look at|check file|view|what does.*say|contents of)\b/.test(preview)) {
    return 'read';
  }

  // Write tasks: edit, write, create, add, update, fix, change, modify, rename
  if (/\b(edit|write|create|add|update|fix|change|modify|rename|replace|insert|delete|remove)\b/.test(preview)) {
    return 'write';
  }

  // Default: complex (architecture, debugging, multi-step, planning)
  return 'complex';
}

function calculateTurnCost(turn: TurnRecord, tier: string): number {
  const pricing = MODEL_PRICING[tier];
  if (!pricing) return turn.costUsd;
  return (turn.inputTokens * pricing.input / 1_000_000) + (turn.outputTokens * pricing.output / 1_000_000);
}

export async function models(args: string[]): Promise<void> {
  const showJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

  const cwd = process.cwd();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  MODEL ROUTER TUNER                                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const sessions = scanClaudeSessions(days);
  if (sessions.length === 0) {
    console.log('  No Claude Code sessions found. Run some sessions first.');
    console.log('');
    return;
  }

  // Group turns by model tier and categorize tasks
  const usage: Record<string, ModelUsage> = {};

  for (const session of sessions) {
    for (const turn of session.turns) {
      const tier = getModelTier(turn.model);
      if (!usage[tier]) {
        usage[tier] = {
          model: turn.model || tier,
          tier,
          turns: 0,
          cost: 0,
          tasks: { search: 0, read: 0, write: 0, complex: 0 },
        };
      }
      usage[tier].turns++;
      usage[tier].cost += turn.costUsd;

      const task = categorizeTask(turn);
      usage[tier].tasks[task]++;
    }
  }

  // Display current model usage
  const totalTurns = Object.values(usage).reduce((s, u) => s + u.turns, 0);
  const totalCost = Object.values(usage).reduce((s, u) => s + u.cost, 0);

  console.log(`  Analyzing ${totalTurns} turns across ${sessions.length} sessions (${days}-day window)`);
  console.log('');

  console.log('┌──────────────────────┬────────┬──────────┬─────────┬─────────┬─────────┬─────────┐');
  console.log('│ Model Tier           │ Turns  │ Cost     │ Search  │ Read    │ Write   │ Complex │');
  console.log('├──────────────────────┼────────┼──────────┼─────────┼─────────┼─────────┼─────────┤');

  for (const [tier, data] of Object.entries(usage).sort((a, b) => b[1].cost - a[1].cost)) {
    const pct = totalTurns > 0 ? Math.round((data.turns / totalTurns) * 100) : 0;
    console.log(
      '│ ' + (tier + ` (${pct}%)`).padEnd(21) +
      '│ ' + String(data.turns).padStart(5) + ' ' +
      '│ ' + fmtCost(data.cost).padStart(7) + ' ' +
      '│ ' + String(data.tasks.search).padStart(6) + ' ' +
      '│ ' + String(data.tasks.read).padStart(6) + ' ' +
      '│ ' + String(data.tasks.write).padStart(6) + ' ' +
      '│ ' + String(data.tasks.complex).padStart(6) + ' │'
    );
  }

  console.log('└──────────────────────┴────────┴──────────┴─────────┴─────────┴─────────┴─────────┘');
  console.log('');

  // Generate downgrade recommendations
  const recommendations: DowngradeRecommendation[] = [];

  // Opus search tasks → sonnet
  const opusUsage = usage['opus'];
  if (opusUsage && opusUsage.tasks.search > 0) {
    const searchTurns = sessions.flatMap(s => s.turns).filter(t =>
      getModelTier(t.model) === 'opus' && categorizeTask(t) === 'search'
    );
    const currentCost = searchTurns.reduce((s, t) => s + t.costUsd, 0);
    const projectedCost = searchTurns.reduce((s, t) => s + calculateTurnCost(t, 'sonnet'), 0);
    if (currentCost > projectedCost) {
      recommendations.push({
        from: 'opus',
        to: 'sonnet',
        taskType: 'search',
        turns: searchTurns.length,
        currentCost,
        projectedCost,
        savings: currentCost - projectedCost,
      });
    }
  }

  // Opus read tasks → haiku
  if (opusUsage && opusUsage.tasks.read > 0) {
    const readTurns = sessions.flatMap(s => s.turns).filter(t =>
      getModelTier(t.model) === 'opus' && categorizeTask(t) === 'read'
    );
    const currentCost = readTurns.reduce((s, t) => s + t.costUsd, 0);
    const projectedCost = readTurns.reduce((s, t) => s + calculateTurnCost(t, 'haiku'), 0);
    if (currentCost > projectedCost) {
      recommendations.push({
        from: 'opus',
        to: 'haiku',
        taskType: 'read',
        turns: readTurns.length,
        currentCost,
        projectedCost,
        savings: currentCost - projectedCost,
      });
    }
  }

  // Sonnet search tasks → haiku
  const sonnetUsage = usage['sonnet'];
  if (sonnetUsage && sonnetUsage.tasks.search > 0) {
    const searchTurns = sessions.flatMap(s => s.turns).filter(t =>
      getModelTier(t.model) === 'sonnet' && categorizeTask(t) === 'search'
    );
    const currentCost = searchTurns.reduce((s, t) => s + t.costUsd, 0);
    const projectedCost = searchTurns.reduce((s, t) => s + calculateTurnCost(t, 'haiku'), 0);
    if (currentCost > projectedCost) {
      recommendations.push({
        from: 'sonnet',
        to: 'haiku',
        taskType: 'search',
        turns: searchTurns.length,
        currentCost,
        projectedCost,
        savings: currentCost - projectedCost,
      });
    }
  }

  // Sonnet read tasks → haiku
  if (sonnetUsage && sonnetUsage.tasks.read > 0) {
    const readTurns = sessions.flatMap(s => s.turns).filter(t =>
      getModelTier(t.model) === 'sonnet' && categorizeTask(t) === 'read'
    );
    const currentCost = readTurns.reduce((s, t) => s + t.costUsd, 0);
    const projectedCost = readTurns.reduce((s, t) => s + calculateTurnCost(t, 'haiku'), 0);
    if (currentCost > projectedCost) {
      recommendations.push({
        from: 'sonnet',
        to: 'haiku',
        taskType: 'read',
        turns: readTurns.length,
        currentCost,
        projectedCost,
        savings: currentCost - projectedCost,
      });
    }
  }

  // Display recommendations
  if (recommendations.length > 0) {
    const totalSavings = recommendations.reduce((s, r) => s + r.savings, 0);
    const monthlyProjected = totalSavings * 30 / days;

    console.log('  DOWNGRADE RECOMMENDATIONS');
    console.log('  ─────────────────────────');
    console.log('');

    for (const rec of recommendations.sort((a, b) => b.savings - a.savings)) {
      const savingsPct = rec.currentCost > 0 ? Math.round((rec.savings / rec.currentCost) * 100) : 0;
      console.log(`  → ${rec.from} ${rec.taskType} → ${rec.to}`);
      console.log(`    ${rec.turns} turns: ${fmtCost(rec.currentCost)} → ${fmtCost(rec.projectedCost)} (save ${fmtCost(rec.savings)}, ${savingsPct}%)`);
      console.log('');
    }

    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log(`│  CURRENT ${days}-DAY COST:     ${fmtCost(totalCost)}`.padEnd(62) + '│');
    console.log(`│  PROJECTED SAVINGS:      ${fmtCost(totalSavings)} (${Math.round((totalSavings / totalCost) * 100)}%)`.padEnd(62) + '│');
    console.log(`│  MONTHLY SAVINGS:       ~${fmtCost(monthlyProjected)}`.padEnd(62) + '│');
    console.log('└─────────────────────────────────────────────────────────────┘');
  } else {
    console.log('  ✓ No downgrade opportunities found — model routing looks optimal');
  }

  console.log('');

  // Pricing reference
  console.log('  Model pricing reference (per 1M tokens):');
  console.log('    Opus:   $15.00 input / $75.00 output');
  console.log('    Sonnet:  $3.00 input / $15.00 output');
  console.log('    Haiku:   $0.25 input /  $1.25 output');
  console.log('');

  // JSON output
  if (showJson) {
    const jsonPath = path.join(cwd, 'models-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      days,
      sessions: sessions.length,
      totalTurns,
      totalCost,
      usage: Object.values(usage).map(u => ({
        model: u.model,
        tier: u.tier,
        turns: u.turns,
        cost: u.cost,
        tasks: u.tasks,
      })),
      recommendations: recommendations.map(r => ({
        from: r.from,
        to: r.to,
        taskType: r.taskType,
        turns: r.turns,
        currentCost: r.currentCost,
        projectedCost: r.projectedCost,
        savings: r.savings,
      })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`  ✓ JSON report saved to ${jsonPath}`);
    console.log('');
  }
}
