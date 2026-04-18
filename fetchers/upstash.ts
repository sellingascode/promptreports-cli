/**
 * Upstash fetcher — GET https://api.upstash.com/v2/redis + stats
 * Requires UPSTASH_EMAIL + UPSTASH_API_KEY for Basic auth management API.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchUpstashUsage(apiKey: string, days: number = 30, email?: string): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('upstash', 'infra', 'commands', days);

  try {
    // Upstash management API uses Basic auth: email:apiKey
    const authHeader = email
      ? `Basic ${Buffer.from(`${email}:${apiKey}`).toString('base64')}`
      : `Bearer ${apiKey}`;

    const res = await fetchWithRetry('https://api.upstash.com/v2/redis', {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      const hint = res.status === 401
        ? 'Auth failed. Needs UPSTASH_EMAIL + UPSTASH_API_KEY from console.upstash.com > Account > Management API.'
        : `API returned ${res.status}`;
      return { provider: 'upstash', category: 'infra', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'commands' } }, status: 'error', error: hint };
    }

    const databases: Array<{ database_id: string; database_name: string }> = await res.json();
    let totalCost = 0;
    let totalCommands = 0;
    const breakdown: Record<string, number> = {};

    for (const db of databases.slice(0, 10)) {
      try {
        const statsRes = await fetchWithRetry(
          `https://api.upstash.com/v2/redis/stats/${db.database_id}`,
          { headers: { Authorization: authHeader } },
        );
        if (!statsRes.ok) continue;
        const stats = await statsRes.json();
        const monthly = stats.monthly_billing ?? stats.current_month_cost ?? 0;
        const cmds = stats.total_monthly_commands ?? stats.monthly_request_count ?? 0;
        totalCost += monthly;
        totalCommands += cmds;
        breakdown[db.database_name || db.database_id] = monthly;
      } catch { /* skip individual db errors */ }
    }

    return {
      provider: 'upstash',
      category: 'infra',
      period: makePeriod(days),
      cost: { amount: totalCost, currency: 'USD', breakdown },
      usage: {
        primary: { value: databases.length, unit: 'databases' },
        secondary: { value: totalCommands, unit: 'commands' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('upstash', 'infra', 'commands', days, err);
  }
}
