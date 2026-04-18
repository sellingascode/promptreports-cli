/**
 * models command — Model router tuner.
 * Analyzes model usage and suggests cost optimizations.
 */

import type { GlobalFlags } from '../cli';
import { scanProjectSessions, parseSession, analyzeSession, PRICING, type SessionStats } from '../utils/session-scanner';
import { colorize, box, table, formatCost, formatTokens, sectionHeader } from '../utils/format';

interface ModelUsage {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface DowngradeCandidate {
  file: string;
  currentModel: string;
  recommendedModel: string;
  reason: string;
  savingsPerCall: number;
  confidence: 'high' | 'medium' | 'low';
}

// Rough pricing per million tokens for different models
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'opus': { input: 15.0, output: 75.0 },
  'sonnet': { input: 3.0, output: 15.0 },
  'haiku': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

function categorizeModel(model: string): string {
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('gpt-4o-mini')) return 'gpt-4o-mini';
  if (model.includes('gpt-4')) return 'gpt-4o';
  return 'other';
}

function categorizeTurnTask(turn: any): 'search' | 'read' | 'write' | 'complex' {
  const preview = (turn.userPromptPreview || '').toLowerCase();
  const types = turn.contentTypes || [];

  if (preview.includes('grep') || preview.includes('search') || preview.includes('find') || preview.includes('glob')) return 'search';
  if (preview.includes('read') || preview.includes('cat') || preview.includes('show')) return 'read';
  if (preview.includes('edit') || preview.includes('write') || preview.includes('create') || preview.includes('fix')) return 'write';
  return 'complex';
}

export async function modelsCommand(flags: GlobalFlags): Promise<void> {
  const { days, json } = flags;
  const doOptimize = flags.args.includes('--optimize');
  const doCompare = flags.args.includes('--compare');
  const doSavings = flags.args.includes('--savings');

  // Analyze sessions
  const files = scanProjectSessions(days);
  const allStats = files.map(f => analyzeSession(parseSession(f), days)).filter(Boolean) as SessionStats[];

  // Group by model
  const modelUsage: Record<string, ModelUsage> = {};
  const taskDistribution: Record<string, Record<string, number>> = {};

  for (const stats of allStats) {
    for (const turn of stats.turns) {
      const model = turn.model || 'unknown';
      if (!modelUsage[model]) {
        modelUsage[model] = { model, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      }
      modelUsage[model].calls += 1;
      modelUsage[model].inputTokens += turn.inputTokens;
      modelUsage[model].outputTokens += turn.outputTokens;
      modelUsage[model].cost += turn.costUsd;

      // Task categorization
      const task = categorizeTurnTask(turn);
      if (!taskDistribution[model]) taskDistribution[model] = {};
      taskDistribution[model][task] = (taskDistribution[model][task] || 0) + 1;
    }
  }

  const sorted = Object.values(modelUsage).sort((a, b) => b.cost - a.cost);
  const totalCost = sorted.reduce((a, m) => a + m.cost, 0);

  // Calculate potential downgrades
  const candidates: DowngradeCandidate[] = [];
  for (const [model, tasks] of Object.entries(taskDistribution)) {
    const cat = categorizeModel(model);
    const total = Object.values(tasks).reduce((a, b) => a + b, 0);

    if (cat === 'opus') {
      const searchPct = (tasks.search || 0) / total;
      const readPct = (tasks.read || 0) / total;

      if (searchPct > 0.3) {
        const opusCost = MODEL_PRICING.opus;
        const sonnetCost = MODEL_PRICING.sonnet;
        const avgTokens = modelUsage[model].inputTokens / modelUsage[model].calls;
        const savings = ((avgTokens / 1e6) * (opusCost.input - sonnetCost.input));
        candidates.push({
          file: `${Math.round(searchPct * 100)}% of ${model} calls`,
          currentModel: model,
          recommendedModel: 'sonnet',
          reason: 'Search/grep tasks — sonnet handles equally well',
          savingsPerCall: savings,
          confidence: 'high',
        });
      }

      if (readPct > 0.2) {
        candidates.push({
          file: `${Math.round(readPct * 100)}% of ${model} calls`,
          currentModel: model,
          recommendedModel: 'haiku',
          reason: 'Simple file reads — haiku is sufficient',
          savingsPerCall: 0.01,
          confidence: 'medium',
        });
      }
    }
  }

  // Calculate total potential savings
  let weeklyTaskSavings = 0;
  for (const c of candidates) {
    const model = modelUsage[Object.keys(modelUsage).find(m => m.includes(categorizeModel(c.currentModel))) || ''];
    if (model) {
      const calls = model.calls * 0.3; // Estimate 30% of calls are downgradable
      weeklyTaskSavings += c.savingsPerCall * calls;
    }
  }

  if (json) {
    console.log(JSON.stringify({
      models: sorted,
      taskDistribution,
      downgradeCandidates: candidates,
      totalCost,
      potentialWeeklySavings: weeklyTaskSavings,
    }, null, 2));
    return;
  }

  // Print usage breakdown
  sectionHeader('Model Usage');
  const rows = sorted.map(m => [
    m.model.slice(0, 30),
    String(m.calls) + ' calls',
    formatTokens(m.inputTokens + m.outputTokens),
    formatCost(m.cost),
    ((m.cost / Math.max(0.01, totalCost)) * 100).toFixed(0) + '%',
  ]);
  if (rows.length > 0) table(['Model', 'Calls', 'Tokens', 'Cost', '%'], rows);

  // Task distribution
  if (Object.keys(taskDistribution).length > 0) {
    sectionHeader('Task Distribution');
    for (const [model, tasks] of Object.entries(taskDistribution)) {
      const total = Object.values(tasks).reduce((a, b) => a + b, 0);
      const parts = Object.entries(tasks)
        .sort((a, b) => b[1] - a[1])
        .map(([task, count]) => `${task}: ${Math.round((count / total) * 100)}%`)
        .join(', ');
      console.log(`  ${colorize(model.slice(0, 25), 'dim')}: ${parts}`);
    }
  }

  // Downgrade suggestions
  if (candidates.length > 0) {
    sectionHeader('Optimization Suggestions');
    for (const c of candidates) {
      console.log(`  ${colorize(c.file, 'bold')}`);
      console.log(`    ${c.currentModel} → ${colorize(c.recommendedModel, 'green')}`);
      console.log(`    ${colorize(c.reason, 'dim')}`);
      console.log(`    Confidence: ${c.confidence === 'high' ? colorize('high', 'green') : colorize(c.confidence, 'yellow')}`);
      console.log('');
    }

    if (weeklyTaskSavings > 0) {
      console.log(`  ${colorize('Estimated savings:', 'bold')} ${colorize(formatCost(weeklyTaskSavings) + '/week', 'green')} (${formatCost(weeklyTaskSavings * 4)}/month)`);
    }
  }

  console.log('');
  console.log(`  ${colorize('Total:', 'bold')} ${formatCost(totalCost)} across ${sorted.reduce((a, m) => a + m.calls, 0)} calls (${days}d)`);
  console.log('');
}
