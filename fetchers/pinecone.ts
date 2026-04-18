/**
 * Pinecone fetcher — GET https://api.pinecone.io/indexes + describe_index_stats
 * Returns index count and total vector count.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchPineconeUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('pinecone', 'data', 'vectors', days);

  try {
    const headers = { 'Api-Key': apiKey };
    const indexRes = await fetchWithRetry('https://api.pinecone.io/indexes', { headers });

    if (!indexRes.ok) {
      return { provider: 'pinecone', category: 'data', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'vectors' } }, status: 'error', error: `API returned ${indexRes.status}` };
    }

    const data = await indexRes.json();
    const indexes = data.indexes || [];
    const breakdown: Record<string, number> = {};

    let totalVectors = 0;
    for (const idx of indexes) {
      breakdown[idx.name] = idx.dimension || 0;
      const host = idx.host;
      if (!host) continue;
      try {
        const statsRes = await fetchWithRetry(`https://${host}/describe_index_stats`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (statsRes.ok) {
          const stats = await statsRes.json();
          totalVectors += stats.totalVectorCount || 0;
        }
      } catch { /* skip unreachable indexes */ }
    }

    return {
      provider: 'pinecone',
      category: 'data',
      period: makePeriod(days),
      cost: { amount: 0, currency: 'USD', breakdown },
      usage: {
        primary: { value: totalVectors, unit: 'vectors' },
        secondary: { value: indexes.length, unit: 'indexes' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('pinecone', 'data', 'vectors', days, err);
  }
}
