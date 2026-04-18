/**
 * Standalone Fetcher Framework — Registry & Parallel Runner
 *
 * Zero dependencies on Next.js, Prisma, or any framework.
 * Uses raw fetch() + env vars. ESM-compatible with .js imports.
 *
 * Usage:
 *   import { runAllFetchers, discoverFromProject } from './index';
 *   const { envVars } = discoverFromProject('/path/to/project');
 *   const results = await runAllFetchers(envVars, 30);
 */

import type { ProviderCost, FetcherFn, DiscoveredService } from './types';
import { discoverServices, discoverFromProject, parseEnvFile } from './env-discovery';

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type { ProviderCost, FetcherFn, DiscoveredService } from './types';
export { discoverServices, discoverFromProject, parseEnvFile } from './env-discovery';
export { fetchWithRetry, makePeriod } from './fetch-utils';

// ─── Fetcher imports ────────────────────────────────────────────────────────

import { fetchOpenRouterUsage } from './openrouter';
import { fetchVercelUsage } from './vercel';
import { fetchSentryUsage } from './sentry';
import { fetchStripeBillingUsage } from './stripe-billing';
import { fetchPostHogUsage } from './posthog';
import { fetchGitHubUsage } from './github';
import { fetchRailwayUsage } from './railway';
import { fetchOpenAIUsage } from './openai';
import { fetchSupabaseUsage } from './supabase';
import { fetchUpstashUsage } from './upstash';
import { fetchPineconeUsage } from './pinecone';
import { fetchTavilyUsage } from './tavily';
import { fetchSerperUsage } from './serper';
import { fetchZenRowsUsage } from './zenrows';
import { fetchJinaUsage } from './jina';
import { fetchGoogleUsage } from './google';
import { fetchMistralUsage } from './mistral';
import { fetchCohereUsage } from './cohere';
import { fetchInngestUsage } from './inngest';
import { fetchCursorUsage } from './cursor-usage';
import { fetchCopilotUsage } from './copilot-usage';
import { fetchHeliconeUsage } from './helicone-usage';

// ─── Fetcher Registry ───────────────────────────────────────────────────────

interface FetcherEntry {
  id: string;
  envVar: string;
  fetcher: FetcherFn;
  priority: 'p0' | 'p1';
}

const FETCHER_REGISTRY: FetcherEntry[] = [
  // P0 — Core providers
  { id: 'openrouter', envVar: 'OPENROUTER_API_KEY', fetcher: fetchOpenRouterUsage, priority: 'p0' },
  { id: 'vercel', envVar: 'VERCEL_TOKEN', fetcher: fetchVercelUsage, priority: 'p0' },
  { id: 'sentry', envVar: 'SENTRY_AUTH_TOKEN', fetcher: fetchSentryUsage, priority: 'p0' },
  { id: 'stripe', envVar: 'STRIPE_SECRET_KEY', fetcher: fetchStripeBillingUsage, priority: 'p0' },
  { id: 'posthog', envVar: 'POSTHOG_PERSONAL_API_KEY', fetcher: fetchPostHogUsage, priority: 'p0' },
  { id: 'github', envVar: 'GITHUB_TOKEN', fetcher: fetchGitHubUsage, priority: 'p0' },
  { id: 'railway', envVar: 'RAILWAY_TOKEN', fetcher: fetchRailwayUsage, priority: 'p0' },
  { id: 'openai', envVar: 'OPENAI_API_KEY', fetcher: fetchOpenAIUsage, priority: 'p0' },
  // P0 — Competitor fetchers
  { id: 'cursor', envVar: 'CURSOR_API_KEY', fetcher: fetchCursorUsage, priority: 'p0' },
  { id: 'copilot', envVar: 'GITHUB_TOKEN', fetcher: fetchCopilotUsage, priority: 'p0' },
  { id: 'helicone', envVar: 'HELICONE_API_KEY', fetcher: fetchHeliconeUsage, priority: 'p0' },
  // P1 — Extended providers
  { id: 'supabase', envVar: 'SUPABASE_SERVICE_KEY', fetcher: fetchSupabaseUsage, priority: 'p1' },
  { id: 'upstash', envVar: 'UPSTASH_REDIS_REST_TOKEN', fetcher: fetchUpstashUsage, priority: 'p1' },
  { id: 'pinecone', envVar: 'PINECONE_API_KEY', fetcher: fetchPineconeUsage, priority: 'p1' },
  { id: 'tavily', envVar: 'TAVILY_API_KEY', fetcher: fetchTavilyUsage, priority: 'p1' },
  { id: 'serper', envVar: 'SERPER_API_KEY', fetcher: fetchSerperUsage, priority: 'p1' },
  { id: 'zenrows', envVar: 'ZENROWS_API_KEY', fetcher: fetchZenRowsUsage, priority: 'p1' },
  { id: 'jina', envVar: 'JINA_API_KEY', fetcher: fetchJinaUsage, priority: 'p1' },
  { id: 'google', envVar: 'GOOGLE_AI_API_KEY', fetcher: fetchGoogleUsage, priority: 'p1' },
  { id: 'mistral', envVar: 'MISTRAL_API_KEY', fetcher: fetchMistralUsage, priority: 'p1' },
  { id: 'cohere', envVar: 'COHERE_API_KEY', fetcher: fetchCohereUsage, priority: 'p1' },
  { id: 'inngest', envVar: 'INNGEST_SIGNING_KEY', fetcher: fetchInngestUsage, priority: 'p1' },
];

// ─── Parallel Runner ────────────────────────────────────────────────────────

/**
 * Run all configured fetchers in parallel using Promise.allSettled.
 * Skips providers without an API key (returns no-key status).
 *
 * @param envVars - Map of env var names to values (e.g. from parseEnvFile)
 * @param days - Lookback period in days (default 30)
 * @param priorityFilter - Optional: only run 'p0' or 'p1' fetchers
 */
export async function runAllFetchers(
  envVars: Record<string, string>,
  days: number = 30,
  priorityFilter?: 'p0' | 'p1',
): Promise<ProviderCost[]> {
  const entries = priorityFilter
    ? FETCHER_REGISTRY.filter(e => e.priority === priorityFilter)
    : FETCHER_REGISTRY;

  const results = await Promise.allSettled(
    entries.map(entry => {
      const apiKey = envVars[entry.envVar] || '';
      return entry.fetcher(apiKey, days);
    }),
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      provider: entries[i].id,
      category: 'ai' as const,
      period: { start: '', end: '' },
      cost: { amount: 0, currency: 'USD' as const },
      usage: { primary: { value: 0, unit: '' } },
      status: 'error' as const,
      error: result.reason?.message || 'Unknown error in fetcher',
    };
  });
}

/**
 * Run a single fetcher by provider ID.
 */
export async function runFetcher(
  providerId: string,
  apiKey: string,
  days: number = 30,
): Promise<ProviderCost> {
  const entry = FETCHER_REGISTRY.find(e => e.id === providerId);
  if (!entry) {
    return {
      provider: providerId,
      category: 'ai',
      period: { start: '', end: '' },
      cost: { amount: 0, currency: 'USD' },
      usage: { primary: { value: 0, unit: '' } },
      status: 'error',
      error: `Unknown provider: ${providerId}`,
    };
  }
  return entry.fetcher(apiKey, days);
}

/**
 * List all registered fetcher IDs and their env var requirements.
 */
export function listFetchers(): Array<{ id: string; envVar: string; priority: string }> {
  return FETCHER_REGISTRY.map(e => ({ id: e.id, envVar: e.envVar, priority: e.priority }));
}

// ─── Individual fetcher re-exports ──────────────────────────────────────────

export {
  fetchOpenRouterUsage,
  fetchVercelUsage,
  fetchSentryUsage,
  fetchStripeBillingUsage,
  fetchPostHogUsage,
  fetchGitHubUsage,
  fetchRailwayUsage,
  fetchOpenAIUsage,
  fetchSupabaseUsage,
  fetchUpstashUsage,
  fetchPineconeUsage,
  fetchTavilyUsage,
  fetchSerperUsage,
  fetchZenRowsUsage,
  fetchJinaUsage,
  fetchGoogleUsage,
  fetchMistralUsage,
  fetchCohereUsage,
  fetchInngestUsage,
  fetchCursorUsage,
  fetchCopilotUsage,
  fetchHeliconeUsage,
};
