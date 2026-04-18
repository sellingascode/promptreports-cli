/**
 * Serper fetcher — GET https://google.serper.dev/account
 * Returns search credit usage and remaining balance.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchSerperUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('serper', 'data', 'credits', days);

  try {
    const res = await fetchWithRetry('https://google.serper.dev/account', {
      headers: { 'X-API-KEY': apiKey },
    });

    if (!res.ok) {
      return { provider: 'serper', category: 'data', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'credits' } }, status: 'error', error: `API returned ${res.status}` };
    }

    const data = await res.json();
    const creditsUsed = data.credits?.used ?? data.creditUsed ?? 0;
    const creditsRemaining = data.credits?.remaining ?? data.creditRemaining ?? 0;

    return {
      provider: 'serper',
      category: 'data',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD', breakdown: { 'credits-used': creditsUsed, 'credits-remaining': creditsRemaining } },
      usage: {
        primary: { value: creditsUsed, unit: 'credits used' },
        secondary: { value: creditsRemaining, unit: 'credits remaining' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('serper', 'data', 'credits', days, err);
  }
}
