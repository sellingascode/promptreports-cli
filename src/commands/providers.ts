/**
 * providers command — Scan all configured service providers and display costs.
 *
 * Uses the existing fetcher framework from tools/fetchers/ for discovery
 * and parallel cost fetching.
 */

import { resolve } from 'node:path';
import type { GlobalFlags } from '../cli';
import { discoverFromProject } from '../../fetchers/env-discovery';
import { runAllFetchers } from '../../fetchers/index';
import type { ProviderCost } from '../../fetchers/types';
import { colorize, formatCost, table, box, sectionHeader } from '../utils/format';

export async function providersCommand(flags: GlobalFlags): Promise<void> {
  const { days, json, quiet } = flags;
  const projectRoot = process.cwd();

  if (!quiet) {
    console.log('');
    console.log(colorize('  Scanning .env.local for provider keys...', 'dim'));
  }

  // Discover services from .env.local
  const { envVars, services } = discoverFromProject(projectRoot);
  const configuredCount = services.filter(s => s.configured).length;

  if (!quiet) {
    console.log(`  Found ${configuredCount}/${services.length} providers with API keys`);
    console.log('');
  }

  // Run all fetchers in parallel
  const startTime = Date.now();
  const results = await runAllFetchers(envVars, days);
  const elapsed = Date.now() - startTime;

  if (!quiet) {
    console.log(colorize(`  Done in ${(elapsed / 1000).toFixed(1)}s`, 'dim'));
  }

  // JSON output mode
  if (json) {
    const output = {
      scannedAt: new Date().toISOString(),
      periodDays: days,
      providers: results,
      totalCost: results.reduce((sum, r) => sum + r.cost.amount, 0),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Group by category
  const categories = new Map<string, ProviderCost[]>();
  const active = results.filter(r => r.status === 'ok');
  const errors = results.filter(r => r.status === 'error');
  const noKey = results.filter(r => r.status === 'no-key');

  for (const r of active) {
    const cat = r.category || 'other';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(r);
  }

  // Print active providers grouped by category
  let totalCost = 0;
  for (const [category, provs] of categories) {
    const rows = provs.map(r => {
      totalCost += r.cost.amount;
      const costStr = r.cost.amount > 0 ? formatCost(r.cost.amount) : colorize('active', 'dim');
      const usageStr = r.usage.primary.value > 0
        ? `${r.usage.primary.value.toLocaleString()} ${r.usage.primary.unit}`
        : '';
      return [r.provider, costStr, usageStr, colorize(r.status, 'green')];
    });

    sectionHeader(category.toUpperCase());
    table(['Provider', 'Cost', 'Usage', 'Status'], rows);

    const catCost = provs.reduce((sum, r) => sum + r.cost.amount, 0);
    if (catCost > 0) {
      console.log(colorize(`  Subtotal: ${formatCost(catCost)}`, 'dim'));
    }
  }

  // Errors
  if (errors.length > 0) {
    sectionHeader('ERRORS');
    const errRows = errors.map(r => [
      r.provider,
      colorize(r.error || 'Unknown error', 'red'),
    ]);
    table(['Provider', 'Error'], errRows);
  }

  // Skipped (no key)
  if (noKey.length > 0 && !quiet) {
    console.log('');
    console.log(colorize(`  Skipped ${noKey.length} providers (no API key): `, 'dim') +
      colorize(noKey.map(r => r.provider).join(', '), 'dim'));
  }

  // Total
  console.log('');
  box('TOTAL BURN RATE', `${colorize(formatCost(totalCost), 'bold')} / ${days} days\n${colorize(formatCost(totalCost / days * 30), 'bold')} / month (projected)`);
  console.log('');
}
