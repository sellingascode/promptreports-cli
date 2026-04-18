/**
 * Railway fetcher — POST https://backboard.railway.app/graphql/v2
 * Returns project and service counts via GraphQL.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

const PROJECTS_QUERY = `query {
  me {
    projects {
      edges {
        node {
          name
          updatedAt
          services {
            edges {
              node {
                name
              }
            }
          }
        }
      }
    }
  }
}`;

async function railwayGQL(apiKey: string, query: string): Promise<Record<string, unknown>> {
  const res = await fetchWithRetry('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables: {} }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${body.slice(0, 100)}`);
  }

  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

export async function fetchRailwayUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('railway', 'infra', 'projects', days);

  try {
    const data = await railwayGQL(apiKey, PROJECTS_QUERY);
    const edges = (data as any)?.me?.projects?.edges || [];

    let totalServices = 0;
    const breakdown: Record<string, number> = {};
    for (const e of edges) {
      const serviceCount = e.node.services?.edges?.length ?? 0;
      totalServices += serviceCount;
      breakdown[e.node.name] = serviceCount;
    }

    return {
      provider: 'railway',
      category: 'infra',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD', breakdown },
      usage: {
        primary: { value: edges.length, unit: 'projects' },
        secondary: { value: totalServices, unit: 'services' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('railway', 'infra', 'projects', days, err);
  }
}
