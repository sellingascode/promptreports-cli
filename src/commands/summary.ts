/**
 * summary command — Default `npx promptreports-cli` output.
 *
 * Matches the hero section on promptreports.ai: scans Claude Code sessions
 * AND configured service providers, then renders a combined stack + quick-wins
 * report using the same layout and color palette shown on the homepage so the
 * hero preview is a faithful representation of what users actually get.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GlobalFlags } from '../cli';
import {
  scanProjectSessions,
  parseSession,
  analyzeSession,
  type SessionStats,
} from '../utils/session-scanner';
import { colorize, formatCost, formatTokens, type Color } from '../utils/format';
import { discoverFromProject } from '../../fetchers/env-discovery';
import { runAllFetchers } from '../../fetchers/index';
import type { ProviderCost } from '../../fetchers/types';

// Inner width of the box (between the two vertical bars). Matches hero.
const BOX_WIDTH = 52;
const FREE_MAX_DAYS = 7;

interface QuickWin {
  text: string;
  savingsMonthly: number;
}

export async function summaryCommand(flags: GlobalFlags): Promise<void> {
  const { json, quiet } = flags;
  let { days } = flags;

  // Free tier caps lookback at 7 days; signed-in users get longer windows.
  const hasApiKey = !!process.env['PROMPTREPORTS_API_KEY'];
  let dayCapNotice: string | null = null;
  if (days > FREE_MAX_DAYS && !hasApiKey) {
    dayCapNotice = `  --days capped at ${FREE_MAX_DAYS} on the free tier. Sign in to unlock up to 90 days.`;
    days = FREE_MAX_DAYS;
  }

  // ── Scan Claude sessions ────────────────────────────────────────────────
  const jsonlFiles = scanProjectSessions(days);
  const allStats: SessionStats[] = [];
  for (const file of jsonlFiles) {
    const entries = parseSession(file);
    const stats = analyzeSession(entries, days);
    if (stats) allStats.push(stats);
  }

  const sessTotals = allStats.reduce(
    (a, s) => ({
      input: a.input + s.totalInputTokens,
      output: a.output + s.totalOutputTokens,
      cw: a.cw + s.totalCacheCreation,
      cr: a.cr + s.totalCacheRead,
      msgs: a.msgs + s.messageCount,
      cost: a.cost + s.estimatedCostUsd,
    }),
    { input: 0, output: 0, cw: 0, cr: 0, msgs: 0, cost: 0 },
  );

  const allInput = sessTotals.input + sessTotals.cw + sessTotals.cr;
  const hitRate = allInput > 0 ? sessTotals.cr / allInput : 0;
  const totalTokens = sessTotals.input + sessTotals.output + sessTotals.cw;

  // ── JSON mode: keep backwards-compatible session payload ────────────────
  if (json) {
    const outDir = join(process.cwd(), '.claude', 'research');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `token-stats-${new Date().toISOString().split('T')[0]}.json`);
    const payload = buildJsonPayload(allStats, days);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    if (!quiet) console.error(`\n  Saved to: ${outPath}`);
    return;
  }

  // ── Hero header ─────────────────────────────────────────────────────────
  if (!quiet) {
    console.log('');
    console.log(`  ${colorize('$', 'green')} npx promptreports-cli`);
    console.log('');
    if (dayCapNotice) {
      console.log(colorize(dayCapNotice, 'yellow'));
      console.log('');
    }
    console.log(colorize('  Scanning your environment...', 'gray'));
    console.log('');
  }

  // ── Scan providers ──────────────────────────────────────────────────────
  const { envVars } = discoverFromProject(process.cwd());
  const providerResults = await runAllFetchers(envVars, days);
  const active = providerResults.filter(r => r.status === 'ok');

  const byCategory = (cats: string[]): ProviderCost[] =>
    active.filter(r => cats.includes(r.category));

  const ai = byCategory(['ai']);
  const infra = byCategory(['infra']);
  const data = byCategory(['data']);
  const devtools = byCategory(['devtools', 'monitoring']);

  // Scale everything to monthly so `/mo` labels are honest regardless of --days.
  const toMonthly = 30 / Math.max(days, 1);
  const sumCost = (rs: ProviderCost[]) => rs.reduce((s, r) => s + r.cost.amount, 0);
  const sessMonthly = sessTotals.cost * toMonthly;
  const aiMonthly = sumCost(ai) * toMonthly + sessMonthly;
  const infraMonthly = sumCost(infra) * toMonthly;
  const dataMonthly = sumCost(data) * toMonthly;
  const devMonthly = sumCost(devtools) * toMonthly;
  const burn = aiMonthly + infraMonthly + dataMonthly + devMonthly;

  // Claude Code sessions count as one "provider" in the AI bucket when present.
  const aiCount = ai.length + (sessTotals.cost > 0 ? 1 : 0);

  // Revenue from Stripe (scale period revenue to monthly)
  const stripe = providerResults.find(r => r.provider === 'stripe' && r.status === 'ok');
  const periodRevenue = stripe ? Number(stripe.cost.breakdown?.revenue ?? 0) : 0;
  const mrr = periodRevenue > 0 ? periodRevenue * toMonthly : 0;
  const margin = mrr > 0 ? ((mrr - burn) / mrr) * 100 : null;

  // ── Quick wins from session data ────────────────────────────────────────
  const wins = computeQuickWins(allStats, sessTotals, days);
  const totalSavings = wins.reduce((s, w) => s + w.savingsMonthly, 0);
  const savingsPct = burn > 0 ? (totalSavings / burn) * 100 : 0;

  // ── Summary lines ───────────────────────────────────────────────────────
  if (!quiet) {
    const dot = colorize('\u00B7', 'gray');
    const chk = colorize('\u2713', 'green');
    console.log(
      `  ${chk} ${colorize(`${allStats.length} sessions`, 'white')} ${dot} ` +
        `${colorize(formatCost(sessTotals.cost), 'green')} ${dot} ` +
        `${colorize(`${(hitRate * 100).toFixed(0)}% cache hit`, 'cyan')}`,
    );
    console.log(
      `  ${chk} ${colorize(`${active.length} services`, 'white')} ${dot} ` +
        `${colorize(`${formatCost(burn)}/mo burn rate`, 'yellow')}`,
    );
    console.log(
      `  ${chk} ${colorize(`${wins.length} quick wins`, 'white')} ${dot} ` +
        `saves ${colorize(`${formatCost(totalSavings)}/mo`, 'green')}`,
    );
    console.log('');
  }

  // ── CLAUDE SESSIONS box (skipped when no sessions found) ───────────────
  if (allStats.length > 0) {
    printClaudeBox({
      sessions: allStats.length,
      messages: sessTotals.msgs,
      totalTokens,
      inputTokens: sessTotals.input,
      outputTokens: sessTotals.output,
      cacheWrite: sessTotals.cw,
      cacheRead: sessTotals.cr,
      hitRate,
      cost: sessTotals.cost,
      days,
    });

    printTopConsumers(allStats);
  }

  // ── Main box (YOUR STACK + QUICK WINS) ──────────────────────────────────
  printHeroBox({
    stack: [
      { label: 'AI Models',      cost: aiMonthly,    count: aiCount,         color: 'magenta' },
      { label: 'Infrastructure', cost: infraMonthly, count: infra.length,    color: 'green'   },
      { label: 'Data & Search',  cost: dataMonthly,  count: data.length,     color: 'yellow'  },
      { label: 'DevTools',       cost: devMonthly,   count: devtools.length, color: 'cyan'    },
    ],
    burn,
    mrr,
    margin,
    wins,
    totalSavings,
    savingsPct,
  });

  // ── CTA footer ─────────────────────────────────────────────────────────
  if (!quiet) {
    const arrow = colorize('\u2192', 'gray');
    console.log(colorize('  Next steps', 'white'));
    console.log(`    ${arrow} Track this over time  ${colorize('promptreports.ai/swarm/model-token-tracker', 'cyan')}`);
    console.log(`    ${arrow} Push your data        ${colorize('npx promptreports-cli push', 'white')}`);
    console.log(`    ${arrow} Team rollup & alerts  ${colorize('promptreports.ai/pricing', 'cyan')}`);
    console.log('');
  }
}

// ─── Claude sessions summary box ──────────────────────────────────────────

interface ClaudeBoxData {
  sessions: number;
  messages: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheWrite: number;
  cacheRead: number;
  hitRate: number;
  cost: number;
  days: number;
}

function printClaudeBox(d: ClaudeBoxData): void {
  const horiz = '\u2500'.repeat(BOX_WIDTH);
  const top = colorize(`  \u250C${horiz}\u2510`, 'gray');
  const sep = colorize(`  \u251C${horiz}\u2524`, 'gray');
  const bot = colorize(`  \u2514${horiz}\u2518`, 'gray');

  const title = `CLAUDE CODE \u00B7 LAST ${d.days} DAY${d.days === 1 ? '' : 'S'}`;
  const cacheSavings = (d.cacheRead / 1e6) * (15 - 1.5); // Opus input - cache read pricing delta

  console.log(top);
  console.log(renderTitle(title));
  console.log(sep);
  console.log(renderKV('Sessions', String(d.sessions), 'white'));
  console.log(renderKV('Turns', d.messages.toLocaleString(), 'white'));
  console.log(renderKV('Tokens', formatTokens(d.totalTokens), 'white'));
  console.log(renderSubKV('Input', formatTokens(d.inputTokens), 'blue'));
  console.log(renderSubKV('Output', formatTokens(d.outputTokens), 'magenta'));
  console.log(renderSubKV('Cache W', formatTokens(d.cacheWrite), 'yellow'));
  console.log(renderSubKVSplit('Cache R', formatTokens(d.cacheRead), `(saved ${formatCost(cacheSavings)})`));
  console.log(renderKV('Cache Hit', `${(d.hitRate * 100).toFixed(1)}%`, 'green'));
  console.log(renderKV('Est. Cost', formatCost(d.cost), 'green'));
  console.log(bot);
  console.log('');
}

// ─── Top token consumers ──────────────────────────────────────────────────

function printTopConsumers(stats: SessionStats[]): void {
  const sorted = [...stats].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd).slice(0, 5);
  if (sorted.length === 0) return;

  const horiz = '\u2500'.repeat(BOX_WIDTH);
  const top = colorize(`  \u250C${horiz}\u2510`, 'gray');
  const sep = colorize(`  \u251C${horiz}\u2524`, 'gray');
  const bot = colorize(`  \u2514${horiz}\u2518`, 'gray');

  console.log(top);
  console.log(renderTitle('TOP SESSIONS BY COST'));
  console.log(sep);

  for (const s of sorted) {
    const day = new Date(s.startedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    const tokens = formatTokens(s.totalTokens);
    const msgs = `${s.messageCount} msgs`;
    const cost = formatCost(s.estimatedCostUsd);
    console.log(renderConsumerRow(day, tokens, msgs, cost));
  }

  console.log(bot);
  console.log('');
}

// ─── Quick-win heuristics ──────────────────────────────────────────────────

function computeQuickWins(
  stats: SessionStats[],
  t: { input: number; output: number; cw: number; cr: number; msgs: number; cost: number },
  days: number,
): QuickWin[] {
  const wins: QuickWin[] = [];
  const monthlyScale = 30 / Math.max(days, 1);

  // Opus overuse → /fast
  const opusSessions = stats.filter(s => s.model.includes('opus'));
  if (opusSessions.length > stats.length * 0.5 && stats.length > 2) {
    const opusCost = opusSessions.reduce((s, o) => s + o.estimatedCostUsd, 0);
    const savings = opusCost * 0.3 * 0.8 * monthlyScale; // 30% shiftable, 80% cheaper
    if (savings > 1) wins.push({ text: 'Use /fast for simple tasks', savingsMonthly: savings });
  }

  // Long sessions → restart
  const longSessions = stats.filter(s => s.messageCount > 30);
  if (longSessions.length > 0) {
    const wasted = longSessions.reduce((s, l) => s + l.estimatedCostUsd * 0.25, 0);
    const savings = wasted * monthlyScale;
    if (savings > 1) wins.push({ text: 'Restart sessions at msg 20', savingsMonthly: savings });
  }

  // Cache inefficiency → trim CLAUDE.md
  const grand = t.output + t.input + t.cw;
  const cwPct = grand > 0 ? t.cw / grand : 0;
  const allInput = t.input + t.cw + t.cr;
  const hitRate = allInput > 0 ? t.cr / allInput : 0;
  if (cwPct > 0.5 || hitRate < 0.4) {
    const savings = t.cost * 0.15 * monthlyScale;
    if (savings > 1) wins.push({ text: 'Trim CLAUDE.md to 2K words', savingsMonthly: savings });
  }

  // Always surface at least one suggestion
  if (wins.length === 0 && t.cost > 0) {
    wins.push({ text: 'Enable prompt caching everywhere', savingsMonthly: t.cost * 0.1 * monthlyScale });
  }

  return wins.slice(0, 3);
}

// ─── Box renderer ──────────────────────────────────────────────────────────

interface HeroBoxData {
  stack: Array<{ label: string; cost: number; count: number; color: Color }>;
  burn: number;
  mrr: number;
  margin: number | null;
  wins: QuickWin[];
  totalSavings: number;
  savingsPct: number;
}

function printHeroBox(d: HeroBoxData): void {
  const horiz = '\u2500'.repeat(BOX_WIDTH);
  const top = colorize(`  \u250C${horiz}\u2510`, 'gray');
  const sep = colorize(`  \u251C${horiz}\u2524`, 'gray');
  const bot = colorize(`  \u2514${horiz}\u2518`, 'gray');

  console.log(top);
  console.log(renderTitle('YOUR STACK'));
  console.log(sep);

  for (const row of d.stack) {
    console.log(renderStackRow(row.label, row.cost, row.count, row.color));
  }

  // Inner divider before totals
  console.log(renderRaw([['  ', undefined], ['\u2500'.repeat(BOX_WIDTH - 4), 'gray']]));

  console.log(renderTotalRow('BURN RATE', `${formatCost(d.burn)}/mo`, 'yellow', ''));
  if (d.mrr > 0) {
    console.log(renderTotalRow('REVENUE', `${formatCost(d.mrr)}/mo`, 'green', '   MRR from Stripe'));
  } else {
    console.log(renderTotalRow('REVENUE', '\u2014', 'gray', '   (connect Stripe)'));
  }
  if (d.margin !== null) {
    const marginColor: Color = d.margin >= 0 ? 'green' : 'red';
    console.log(renderTotalRow('MARGIN', `${d.margin.toFixed(1)}%`, marginColor, ''));
  } else {
    console.log(renderTotalRow('MARGIN', '\u2014', 'gray', ''));
  }

  console.log(sep);
  console.log(renderTitle('QUICK WINS'));

  for (const w of d.wins) {
    console.log(renderQuickWin(w));
  }

  console.log(renderRaw([])); // blank interior line

  console.log(
    renderRaw([
      ['  POTENTIAL SAVINGS  ', 'white'],
      [`${formatCost(d.totalSavings)}/mo`, 'green'],
      [' ', undefined],
      [`(${d.savingsPct.toFixed(1)}%)`, 'gray'],
    ]),
  );

  console.log(bot);
  console.log('');
}

/** Render a row consisting of [text, color] segments with box borders. */
function renderRaw(segments: Array<[string, Color | undefined]>): string {
  const bar = colorize('\u2502', 'gray');
  const plain = segments.map(([t]) => t).join('');
  const colored = segments.map(([t, c]) => (c ? colorize(t, c) : colorize(t, 'gray'))).join('');
  const pad = Math.max(0, BOX_WIDTH - plain.length);
  return `  ${bar}${colored}${colorize(' '.repeat(pad), 'gray')}${bar}`;
}

function renderTitle(title: string): string {
  return renderRaw([
    ['  ', undefined],
    [title, 'white'],
  ]);
}

function renderStackRow(label: string, cost: number, count: number, costColor: Color): string {
  const labelCol = label.padEnd(15);
  const costStr = `${formatCost(cost)}/mo`;
  const costPad = ' '.repeat(Math.max(0, 13 - costStr.length));
  const countStr = count === 0 ? '0 providers' : `${count} provider${count === 1 ? '' : 's'}`;
  return renderRaw([
    ['  ', undefined],
    [labelCol, 'gray'],
    [costStr, costColor],
    [costPad, undefined],
    [countStr, 'gray'],
  ]);
}

function renderTotalRow(label: string, value: string, valueColor: Color, suffix: string): string {
  const labelCol = label.padEnd(15);
  return renderRaw([
    ['  ', undefined],
    [labelCol, 'white'],
    [value, valueColor],
    [suffix, 'gray'],
  ]);
}

function renderQuickWin(w: QuickWin): string {
  const textCol = w.text.length > 32 ? `${w.text.slice(0, 29)}...` : w.text.padEnd(32);
  const savings = `-${formatCost(w.savingsMonthly)}/mo`;
  return renderRaw([
    ['  ', undefined],
    ['\u2192', 'gray'],
    [' ', undefined],
    [textCol, 'gray'],
    ['  ', undefined],
    [savings, 'green'],
  ]);
}

function renderKV(label: string, value: string, valueColor: Color): string {
  return renderRaw([
    ['  ', undefined],
    [label.padEnd(12), 'gray'],
    [value, valueColor],
  ]);
}

function renderSubKV(label: string, value: string, valueColor: Color = 'gray'): string {
  return renderRaw([
    ['  ', undefined],
    ['\u2514\u2500 ', 'gray'],
    [label.padEnd(9), 'gray'],
    [value, valueColor],
  ]);
}

function renderSubKVSplit(label: string, value: string, suffix: string): string {
  return renderRaw([
    ['  ', undefined],
    ['\u2514\u2500 ', 'gray'],
    [label.padEnd(9), 'gray'],
    [value, 'green'],
    [' ', undefined],
    [suffix, 'gray'],
  ]);
}

function renderConsumerRow(day: string, tokens: string, msgs: string, cost: string): string {
  const sep = colorize(' \u2502 ', 'gray');
  return renderRaw([
    ['  ', undefined],
    [day.padEnd(10), 'cyan'],
    [sep, undefined],
    [tokens.padEnd(7), 'magenta'],
    [sep, undefined],
    [msgs.padEnd(10), 'gray'],
    [sep, undefined],
    [cost, 'green'],
  ]);
}

// ─── JSON payload (preserved for --json) ──────────────────────────────────

function buildJsonPayload(stats: SessionStats[], days: number): Record<string, unknown> {
  const t = stats.reduce(
    (a, s) => ({
      input: a.input + s.totalInputTokens,
      output: a.output + s.totalOutputTokens,
      cw: a.cw + s.totalCacheCreation,
      cr: a.cr + s.totalCacheRead,
      msgs: a.msgs + s.messageCount,
      cost: a.cost + s.estimatedCostUsd,
    }),
    { input: 0, output: 0, cw: 0, cr: 0, msgs: 0, cost: 0 },
  );
  const total = t.input + t.output + t.cw;
  const allInput = t.input + t.cw + t.cr;
  return {
    collectedAt: new Date().toISOString(),
    periodDays: days,
    aggregate: {
      sessions: stats.length,
      messages: t.msgs,
      totalTokens: total,
      inputTokens: t.input,
      outputTokens: t.output,
      cacheWrite: t.cw,
      cacheRead: t.cr,
      cacheHitRate: allInput > 0 ? t.cr / allInput : 0,
      estimatedCostUsd: t.cost,
    },
    sessions: stats.map(s => ({
      sessionId: s.sessionId,
      project: s.project,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      messageCount: s.messageCount,
      totalTokens: s.totalTokens,
      model: s.model,
      estimatedCostUsd: s.estimatedCostUsd,
      cacheHitRate: s.cacheHitRate,
    })),
  };
}
