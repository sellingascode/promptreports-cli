/**
 * OpenAI fetcher — GET /v1/usage?date=YYYY-MM-DD
 * Returns token counts and per-model breakdown.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchOpenAIUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('openai', 'ai', 'tokens', days);

  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const res = await fetchWithRetry(`https://api.openai.com/v1/usage?date=${dateStr}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const hint = res.status === 403
        ? 'OpenAI usage API requires Organization-level access. Check API key permissions.'
        : `API returned ${res.status}`;
      return { provider: 'openai', category: 'ai', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'tokens' } }, status: 'error', error: hint };
    }

    const data = await res.json();
    const items = data.data || [];
    let totalTokens = 0;
    let totalRequests = 0;
    const modelMap = new Map<string, number>();

    for (const entry of items) {
      const model = entry.snapshot_id || entry.model || 'unknown';
      const tokens = (entry.n_context_tokens_total ?? 0) + (entry.n_generated_tokens_total ?? 0);
      totalTokens += tokens;
      totalRequests += entry.n_requests ?? 0;
      modelMap.set(model, (modelMap.get(model) || 0) + tokens);
    }

    const breakdown: Record<string, number> = {};
    for (const [model, tokens] of modelMap) {
      breakdown[model] = tokens;
    }

    return {
      provider: 'openai',
      category: 'ai',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD', breakdown },
      usage: {
        primary: { value: totalTokens, unit: 'tokens' },
        secondary: { value: totalRequests, unit: 'requests' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('openai', 'ai', 'tokens', days, err);
  }
}
