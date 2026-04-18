/**
 * GitHub fetcher — GET /user + /orgs/{org}/settings/billing/actions
 * Returns Actions minutes, paid minutes, and repo count.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchGitHubUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('github', 'devtools', 'minutes', days);

  try {
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.github+json' };

    const userRes = await fetchWithRetry('https://api.github.com/user', { headers });
    if (!userRes.ok) {
      return { provider: 'github', category: 'devtools', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'minutes' } }, status: 'error', error: `API returned ${userRes.status}` };
    }

    const user = await userRes.json();

    // Try org billing for Actions minutes
    if (user.type === 'Organization') {
      const billingRes = await fetchWithRetry(
        `https://api.github.com/orgs/${user.login}/settings/billing/actions`,
        { headers },
      );
      if (billingRes.ok) {
        const billing = await billingRes.json();
        const minutesUsed = billing.total_minutes_used || 0;
        const paidMinutes = billing.total_paid_minutes_used || 0;

        return {
          provider: 'github',
          category: 'devtools',
          period: makePeriod(days),
          cost: {
            amount: paidMinutes * 0.008,
            currency: 'USD',
            breakdown: { 'actions-minutes': 0, 'paid-minutes': paidMinutes * 0.008 },
          },
          usage: {
            primary: { value: minutesUsed, unit: 'minutes' },
            secondary: { value: paidMinutes, unit: 'paid minutes' },
          },
          status: 'ok',
        };
      }
    }

    // Personal account — no billing API
    return {
      provider: 'github',
      category: 'devtools',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD' },
      usage: { primary: { value: user.public_repos || 0, unit: 'repos' } },
      status: 'ok',
      error: `Authenticated as ${user.login}. Billing API requires organization account.`,
    };
  } catch (err) {
    return errorResult('github', 'devtools', 'minutes', days, err);
  }
}
