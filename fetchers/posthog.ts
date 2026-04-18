/**
 * PostHog fetcher — uses project-scoped API endpoints.
 * Returns event counts, recordings, and feature flag evaluations.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchPostHogUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('posthog', 'devtools', 'events', days);

  if (!apiKey.startsWith('phx_')) {
    return errorResult('posthog', 'devtools', 'events', days,
      'PostHog key must be a personal API key (starts with phx_), not a project key (phc_)');
  }

  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  const projectId = process.env.POSTHOG_PROJECT_ID || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_ID || '';
  const headers = { Authorization: `Bearer ${apiKey}` };

  // Try project-scoped endpoint first (works with project-scoped keys),
  // then fall back to org endpoint (works with unscoped keys)
  const endpoints = [
    ...(projectId ? [`${host}/api/projects/${projectId}/`] : []),
    `${host}/api/organizations/@current/`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithRetry(endpoint, { headers });
      if (!res.ok) continue;

      const data = await res.json();
      const usage = data.usage || {};
      const events = usage.events?.usage || 0;
      const eventsLimit = usage.events?.limit || 0;
      const recordings = usage.recordings?.usage || 0;

      return {
        provider: 'posthog',
        category: 'devtools',
        period: makePeriod(days),
        cost: { amount: 0, currency: 'USD', breakdown: { events: 0, recordings: 0, 'feature-flags': 0 } },
        usage: {
          primary: { value: events, unit: 'events' },
          secondary: { value: recordings, unit: 'recordings' },
        },
        status: eventsLimit > 0 && events >= eventsLimit * 0.8 ? 'error' : 'ok',
        error: eventsLimit > 0 && events >= eventsLimit * 0.8 ? 'Approaching event limit' : undefined,
      };
    } catch {
      continue;
    }
  }

  return {
    provider: 'posthog', category: 'devtools', period: makePeriod(days),
    cost: { amount: 0, currency: 'USD' },
    usage: { primary: { value: 0, unit: 'events' } },
    status: 'error',
    error: 'Authentication failed — ensure POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID are set',
  };
}
