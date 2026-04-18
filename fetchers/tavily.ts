/**
 * Tavily fetcher — GET https://api.tavily.com/usage
 * Returns credit usage, remaining credits, and cost estimate.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

const COST_PER_CREDIT = 0.008; // PAYG rate

export async function fetchTavilyUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('tavily', 'data', 'credits', days);

  try {
    const res = await fetchWithRetry('https://api.tavily.com/usage', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { provider: 'tavily', category: 'data', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'credits' } }, status: 'error', error: `API returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = await res.json();
    const totalCredits = data.total_credits_used ?? data.credits_used ?? 0;
    const limit = data.credit_limit ?? data.total_credits ?? 0;
    const remaining = data.remaining_credits ?? (limit ? limit - totalCredits : 0);
    const totalCost = totalCredits * COST_PER_CREDIT;

    const breakdown: Record<string, number> = {};
    if (data.search_credits) breakdown['search'] = data.search_credits * COST_PER_CREDIT;
    if (data.extract_credits) breakdown['extract'] = data.extract_credits * COST_PER_CREDIT;
    if (data.crawl_credits) breakdown['crawl'] = data.crawl_credits * COST_PER_CREDIT;

    return {
      provider: 'tavily',
      category: 'data',
      period: makePeriod(days),
      cost: { amount: totalCost, currency: 'USD', breakdown },
      usage: {
        primary: { value: totalCredits, unit: 'credits used' },
        secondary: { value: remaining, unit: 'credits remaining' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('tavily', 'data', 'credits', days, err);
  }
}
