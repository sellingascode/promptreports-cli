/**
 * Vercel fetcher — GET /v6/deployments + /v9/projects
 * Returns deployment count and project count for the period.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchVercelUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('vercel', 'infra', 'deployments', days);

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const since = Date.now() - days * 86_400_000;

    const [deploymentsRes, projectsRes] = await Promise.all([
      fetchWithRetry(`https://api.vercel.com/v6/deployments?limit=100&since=${since}`, { headers }),
      fetchWithRetry('https://api.vercel.com/v9/projects?limit=50', { headers }),
    ]);

    if (!deploymentsRes.ok) {
      return { provider: 'vercel', category: 'infra', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'deployments' } }, status: 'error', error: `API returned ${deploymentsRes.status}` };
    }

    const deployData = await deploymentsRes.json();
    const deployments = deployData.deployments || [];
    const recentDeploys = deployments.filter((d: { created: number }) => d.created >= since);

    let projectCount = 0;
    if (projectsRes.ok) {
      const projData = await projectsRes.json();
      projectCount = (projData.projects || []).length;
    }

    return {
      provider: 'vercel',
      category: 'infra',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD', breakdown: { deployments: 0, projects: 0 } },
      usage: {
        primary: { value: recentDeploys.length, unit: 'deployments' },
        secondary: { value: projectCount, unit: 'projects' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('vercel', 'infra', 'deployments', days, err);
  }
}
