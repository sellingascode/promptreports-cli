/**
 * Google AI fetcher — GET https://generativelanguage.googleapis.com/v1/models?key=...
 * Validates the API key. Per-request costs tracked via OpenRouter.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchGoogleUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('google', 'ai', 'tokens', days);

  try {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`,
      {},
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { provider: 'google', category: 'ai', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'tokens' } }, status: 'error', error: `Key validation failed (${res.status}): ${body.slice(0, 200)}` };
    }

    return {
      provider: 'google',
      category: 'ai',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD' },
      usage: { primary: { value: 0, unit: 'tokens' } },
      status: 'ok',
      error: 'Per-request costs tracked via OpenRouter. Key is valid.',
    };
  } catch (err) {
    return errorResult('google', 'ai', 'tokens', days, err);
  }
}
