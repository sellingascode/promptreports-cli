/**
 * OpenRouter fetcher — GET /api/v1/auth/key + /api/v1/auth/key/usage
 * Returns spend, token breakdown by model, and limit status.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchOpenRouterUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('openrouter', 'ai', 'tokens', days);

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const [keyRes, usageRes] = await Promise.all([
      fetchWithRetry('https://openrouter.ai/api/v1/auth/key', { headers }),
      fetchWithRetry('https://openrouter.ai/api/v1/auth/key/usage', { headers }),
    ]);

    if (!keyRes.ok) {
      return { provider: 'openrouter', category: 'ai', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'tokens' } }, status: 'error', error: `API returned ${keyRes.status}` };
    }

    const keyData = await keyRes.json();
    const info = keyData.data || {};
    const totalCost = info.usage ?? 0;
    const limit = info.limit ?? null;

    let totalTokens = 0;
    const breakdown: Record<string, number> = {};

    if (usageRes.ok) {
      const usageData = await usageRes.json();
      for (const m of usageData.data || []) {
        const model = m.model ?? 'unknown';
        const tokens = m.tokens ?? 0;
        totalTokens += tokens;
        breakdown[model] = (breakdown[model] ?? 0) + (m.usage ?? 0);
      }
    }

    return {
      provider: 'openrouter',
      category: 'ai',
      period: makePeriod(days),
      cost: { amount: totalCost, currency: 'USD', breakdown },
      usage: {
        primary: { value: totalTokens, unit: 'tokens' },
        secondary: limit ? { value: limit - totalCost, unit: 'USD remaining' } : undefined,
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('openrouter', 'ai', 'tokens', days, err);
  }
}
