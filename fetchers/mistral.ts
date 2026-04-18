/**
 * Mistral fetcher — GET https://api.mistral.ai/v1/models
 * Validates key and lists available models. Per-request costs tracked via OpenRouter.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchMistralUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('mistral', 'ai', 'tokens', days);

  try {
    const res = await fetchWithRetry('https://api.mistral.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { provider: 'mistral', category: 'ai', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'tokens' } }, status: 'error', error: `Key validation failed (${res.status}): ${body.slice(0, 200)}` };
    }

    const data = await res.json().catch(() => ({ data: [] }));
    const models = (data?.data ?? []).map((m: { id: string }) => m.id);

    return {
      provider: 'mistral',
      category: 'ai',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD' },
      usage: { primary: { value: models.length, unit: 'available models' } },
      status: 'ok',
      error: `Per-request costs tracked via OpenRouter. ${models.length} models available.`,
    };
  } catch (err) {
    return errorResult('mistral', 'ai', 'tokens', days, err);
  }
}
