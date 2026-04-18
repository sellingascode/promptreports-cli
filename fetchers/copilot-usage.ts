/**
 * GitHub Copilot fetcher — GET /orgs/{org}/copilot/usage
 * Returns Copilot seat and usage metrics for an organization.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchCopilotUsage(apiKey: string, days: number = 30, org?: string): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('copilot', 'devtools', 'suggestions', days);

  try {
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.github+json' };

    // If no org provided, try to discover it from the authenticated user
    let orgSlug = org;
    if (!orgSlug) {
      const userRes = await fetchWithRetry('https://api.github.com/user/orgs', { headers });
      if (userRes.ok) {
        const orgs = await userRes.json();
        if (orgs.length > 0) orgSlug = orgs[0].login;
      }
    }

    if (!orgSlug) {
      return {
        provider: 'copilot', category: 'devtools', period: makePeriod(days),
        cost: { amount: 0, currency: 'USD' },
        usage: { primary: { value: 0, unit: 'suggestions' } },
        status: 'error',
        error: 'No organization found. Copilot usage API requires an organization account.',
      };
    }

    const res = await fetchWithRetry(
      `https://api.github.com/orgs/${orgSlug}/copilot/usage`,
      { headers },
    );

    if (!res.ok) {
      const hint = res.status === 404
        ? `Copilot usage API not available for org "${orgSlug}". Requires Copilot Business/Enterprise.`
        : `API returned ${res.status}`;
      return { provider: 'copilot', category: 'devtools', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'suggestions' } }, status: 'error', error: hint };
    }

    const data = await res.json();
    const entries = data.data ?? data ?? [];

    let totalSuggestions = 0;
    let totalAcceptances = 0;
    let activeUsers = 0;

    for (const entry of (Array.isArray(entries) ? entries : [])) {
      totalSuggestions += entry.total_suggestions_count ?? 0;
      totalAcceptances += entry.total_acceptances_count ?? 0;
      activeUsers = Math.max(activeUsers, entry.total_active_users ?? 0);
    }

    // Copilot Business: $19/user/month
    const estimatedCost = activeUsers * 19;

    return {
      provider: 'copilot',
      category: 'devtools',
      period: makePeriod(days),
      cost: {
        amount: estimatedCost,
        currency: 'USD',
        breakdown: { 'seat-cost': estimatedCost },
      },
      usage: {
        primary: { value: totalSuggestions, unit: 'suggestions' },
        secondary: { value: totalAcceptances, unit: 'acceptances' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('copilot', 'devtools', 'suggestions', days, err);
  }
}
