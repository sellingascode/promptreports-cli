/**
 * Cursor usage fetcher — GET https://www.cursor.com/api/usage
 * Returns daily spend and request counts from Cursor API.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchCursorUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('cursor', 'devtools', 'requests', days);

  try {
    const res = await fetchWithRetry('https://www.cursor.com/api/usage', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const hint = res.status === 401
        ? 'Auth failed. Cursor usage API requires a valid session token or API key.'
        : `API returned ${res.status}`;
      return { provider: 'cursor', category: 'devtools', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'requests' } }, status: 'error', error: hint };
    }

    const data = await res.json();

    // Cursor usage response shape varies — handle common formats
    const totalSpend = data.total_spend ?? data.usage?.total_cost ?? data.total_cost ?? 0;
    const totalRequests = data.total_requests ?? data.usage?.total_requests ?? data.num_requests ?? 0;
    const premiumRequests = data.premium_requests ?? data.usage?.premium_requests ?? 0;

    const breakdown: Record<string, number> = {};
    if (premiumRequests > 0) breakdown['premium-requests'] = premiumRequests;
    if (data.fast_requests) breakdown['fast-requests'] = data.fast_requests;
    if (data.slow_requests) breakdown['slow-requests'] = data.slow_requests;

    return {
      provider: 'cursor',
      category: 'devtools',
      period: makePeriod(days),
      cost: { amount: totalSpend, currency: 'USD', breakdown },
      usage: {
        primary: { value: totalRequests, unit: 'requests' },
        secondary: premiumRequests > 0 ? { value: premiumRequests, unit: 'premium requests' } : undefined,
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('cursor', 'devtools', 'requests', days, err);
  }
}
