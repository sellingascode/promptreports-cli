/**
 * ZenRows fetcher — GET https://api.zenrows.com/v1/account?apikey=...
 * Returns credit usage, remaining, and plan info.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchZenRowsUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('zenrows', 'data', 'credits', days);

  try {
    const res = await fetchWithRetry(
      `https://api.zenrows.com/v1/account?apikey=${encodeURIComponent(apiKey)}`,
      { headers: { 'Content-Type': 'application/json' } },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { provider: 'zenrows', category: 'data', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'credits' } }, status: 'error', error: `API returned ${res.status}: ${text || res.statusText}` };
    }

    const data = await res.json();
    const used = data.usage?.used ?? 0;
    const remaining = data.usage?.remaining ?? 0;
    const limit = data.usage?.limit ?? (used + remaining);

    return {
      provider: 'zenrows',
      category: 'data',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD', breakdown: { 'api-credits': used } },
      usage: {
        primary: { value: used, unit: 'credits used' },
        secondary: { value: remaining, unit: 'credits remaining' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('zenrows', 'data', 'credits', days, err);
  }
}
