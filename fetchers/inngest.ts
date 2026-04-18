/**
 * Inngest fetcher — GET https://api.inngest.com/v1/events?limit=100
 * Returns recent event counts as a usage proxy.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchInngestUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('inngest', 'infra', 'function-runs', days);

  try {
    const res = await fetchWithRetry('https://api.inngest.com/v1/events?limit=100', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const hint = res.status === 401
        ? 'Auth failed. Inngest API requires a signing key or API key.'
        : `API returned ${res.status}. The events API may not be available on your plan.`;
      return { provider: 'inngest', category: 'infra', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'function-runs' } }, status: 'error', error: hint };
    }

    const data = await res.json();
    const events = Array.isArray(data) ? data : (data.data ?? data.events ?? []);
    const eventCount = events.length;

    // Count unique event names
    const nameCounts: Record<string, number> = {};
    for (const evt of events) {
      const name = evt.name ?? evt.event_name ?? 'unknown';
      nameCounts[name] = (nameCounts[name] ?? 0) + 1;
    }

    return {
      provider: 'inngest',
      category: 'infra',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD', breakdown: nameCounts },
      usage: { primary: { value: eventCount, unit: 'recent events' } },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('inngest', 'infra', 'function-runs', days, err);
  }
}
