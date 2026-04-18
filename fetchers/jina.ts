/**
 * Jina fetcher — GET https://api.jina.ai/v1/usage (fallback: /v1/models key validation)
 * Jina charges per-request; usage endpoint may not be available on all plans.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchJinaUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('jina', 'data', 'requests', days);

  try {
    // Try usage endpoint first
    let res = await fetchWithRetry('https://api.jina.ai/v1/usage', {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      const totalTokens = data.total_tokens ?? data.usage?.total_tokens ?? 0;
      return {
        provider: 'jina',
        category: 'data',
        period: makePeriod(days),
        cost: { amount: data.total_cost ?? 0, currency: 'USD' },
        usage: {
          primary: { value: totalTokens, unit: 'tokens' },
          secondary: { value: data.total_requests ?? 0, unit: 'requests' },
        },
        status: 'ok',
      };
    }

    // Fallback: validate key via models endpoint
    res = await fetchWithRetry('https://api.jina.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      return { provider: 'jina', category: 'data', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'requests' } }, status: 'error', error: `API returned ${res.status}. Check your API key.` };
    }

    return {
      provider: 'jina',
      category: 'data',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD' },
      usage: { primary: { value: 0, unit: 'requests' } },
      status: 'ok',
      error: 'Jina does not expose a usage API. Costs tracked per-request. Key is valid.',
    };
  } catch (err) {
    return errorResult('jina', 'data', 'requests', days, err);
  }
}
