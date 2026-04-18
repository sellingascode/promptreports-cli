/**
 * Cohere fetcher — POST https://api.cohere.com/v1/check-api-key
 * Validates the API key. Per-request costs tracked via OpenRouter.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchCohereUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('cohere', 'ai', 'tokens', days);

  try {
    const res = await fetchWithRetry('https://api.cohere.com/v1/check-api-key', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { provider: 'cohere', category: 'ai', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'tokens' } }, status: 'error', error: `Key validation failed (${res.status}): ${body.slice(0, 200)}` };
    }

    return {
      provider: 'cohere',
      category: 'ai',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD' },
      usage: { primary: { value: 0, unit: 'tokens' } },
      status: 'ok',
      error: 'Per-request costs tracked via OpenRouter. Key is valid.',
    };
  } catch (err) {
    return errorResult('cohere', 'ai', 'tokens', days, err);
  }
}
