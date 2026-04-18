/**
 * Helicone fetcher — POST https://api.helicone.ai/v1/request/query
 * Returns LLM request logs, costs, and token usage from Helicone proxy.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchHeliconeUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('helicone', 'monitoring', 'requests', days);

  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const res = await fetchWithRetry('https://api.helicone.ai/v1/request/query', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          request: {
            created_at: { gte: since },
          },
        },
        offset: 0,
        limit: 1000,
      }),
    });

    if (!res.ok) {
      const hint = res.status === 401
        ? 'Auth failed. Ensure HELICONE_API_KEY is a valid API key from helicone.ai/dashboard.'
        : `API returned ${res.status}`;
      return { provider: 'helicone', category: 'monitoring', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'requests' } }, status: 'error', error: hint };
    }

    const data = await res.json();
    const requests = data.data ?? data ?? [];

    let totalCost = 0;
    let totalTokens = 0;
    let totalRequests = 0;
    const modelBreakdown: Record<string, number> = {};

    for (const req of (Array.isArray(requests) ? requests : [])) {
      totalRequests++;
      const cost = req.cost_usd ?? req.response?.cost ?? 0;
      totalCost += cost;
      const tokens = (req.total_tokens ?? req.response?.total_tokens ?? 0);
      totalTokens += tokens;
      const model = req.model ?? req.request_model ?? 'unknown';
      modelBreakdown[model] = (modelBreakdown[model] ?? 0) + cost;
    }

    return {
      provider: 'helicone',
      category: 'monitoring',
      period: makePeriod(days),
      cost: { amount: totalCost, currency: 'USD', breakdown: modelBreakdown },
      usage: {
        primary: { value: totalRequests, unit: 'requests' },
        secondary: { value: totalTokens, unit: 'tokens' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('helicone', 'monitoring', 'requests', days, err);
  }
}
