/**
 * Sentry fetcher — GET /api/0/organizations/ + /api/0/organizations/{org}/stats_v2/
 * Returns error event count over the period.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchSentryUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('sentry', 'monitoring', 'events', days);

  // Sentry accepts both "Bearer <token>" and raw token
  const authVariants = [
    { Authorization: `Bearer ${apiKey}` },
    { Authorization: apiKey },
  ];

  for (const headers of authVariants) {
    try {
      const orgsRes = await fetchWithRetry('https://sentry.io/api/0/organizations/', { headers });
      if (!orgsRes.ok) continue;

      const orgs = await orgsRes.json();
      if (!orgs.length) {
        return { provider: 'sentry', category: 'monitoring', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'events' } }, status: 'error', error: 'No Sentry organizations found' };
      }

      const orgSlug = orgs[0].slug;
      const statsUrl = new URL(`https://sentry.io/api/0/organizations/${orgSlug}/stats_v2/`);
      statsUrl.searchParams.set('field', 'sum(quantity)');
      statsUrl.searchParams.set('category', 'error');
      statsUrl.searchParams.set('interval', '1d');
      statsUrl.searchParams.set('statsPeriod', `${days}d`);

      const statsRes = await fetchWithRetry(statsUrl.toString(), { headers });
      if (!statsRes.ok) {
        return { provider: 'sentry', category: 'monitoring', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'events' } }, status: 'error', error: `Stats API returned ${statsRes.status}` };
      }

      const stats = await statsRes.json();
      let totalErrors = 0;
      for (const group of stats.groups || []) {
        const series = group.series?.['sum(quantity)'] || [];
        totalErrors += series.reduce((sum: number, v: number) => sum + v, 0);
      }

      return {
        provider: 'sentry',
        category: 'monitoring',
        period: makePeriod(days),
        cost: { amount: 0, currency: 'USD', breakdown: { 'error-events': 0 } },
        usage: { primary: { value: totalErrors, unit: 'events' } },
        status: 'ok',
      };
    } catch {
      continue;
    }
  }

  return {
    provider: 'sentry', category: 'monitoring', period: makePeriod(days),
    cost: { amount: 0, currency: 'USD' },
    usage: { primary: { value: 0, unit: 'events' } },
    status: 'error',
    error: 'Authentication failed — ensure SENTRY_AUTH_TOKEN is an org auth token',
  };
}
