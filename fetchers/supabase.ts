/**
 * Supabase fetcher — GET https://api.supabase.com/v1/projects + billing/addons
 * Returns project count and estimated monthly cost from addon pricing.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchSupabaseUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('supabase', 'infra', 'projects', days);

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const res = await fetchWithRetry('https://api.supabase.com/v1/projects', { headers });

    if (!res.ok) {
      const hint = res.status === 401
        ? 'Auth failed. Requires a Personal Access Token from supabase.com/dashboard/account/tokens.'
        : `API returned ${res.status}`;
      return { provider: 'supabase', category: 'infra', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'projects' } }, status: 'error', error: hint };
    }

    const projects: Array<{ id: string; name: string; ref: string; status: string }> = await res.json();
    const active = projects.filter(p => p.status === 'ACTIVE_HEALTHY' || p.status === 'ACTIVE');

    let totalCost = 0;
    const breakdown: Record<string, number> = {};

    for (const proj of active.slice(0, 10)) {
      try {
        const addonsRes = await fetchWithRetry(
          `https://api.supabase.com/v1/projects/${proj.ref}/billing/addons`,
          { headers },
        );
        if (!addonsRes.ok) continue;
        const addons = await addonsRes.json();
        const cost = (addons.selected_addons?.reduce(
          (sum: number, a: { unit_amount?: number; price?: number }) => sum + (a.unit_amount ?? a.price ?? 0), 0,
        ) ?? 0) / 100;
        totalCost += cost;
        breakdown[proj.name || proj.ref] = cost;
      } catch { /* skip individual project errors */ }
    }

    return {
      provider: 'supabase',
      category: 'infra',
      period: makePeriod(days),
      cost: { amount: totalCost, currency: 'USD', breakdown },
      usage: {
        primary: { value: active.length, unit: 'active projects' },
        secondary: { value: projects.length, unit: 'total projects' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('supabase', 'infra', 'projects', days, err);
  }
}
