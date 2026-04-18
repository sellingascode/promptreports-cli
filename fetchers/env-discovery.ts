/**
 * Standalone Fetcher Framework — Environment Variable Discovery
 *
 * Parses .env.local with regex (NO dotenv dependency).
 * Uses an ALLOWLIST of known service prefixes — never exposes unknown vars.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DiscoveredService } from './types';

// ─── Allowlist of known service env vars ────────────────────────────────────

interface ServiceMapping {
  id: string;
  name: string;
  category: string;
  envVar: string;
}

const SERVICE_ALLOWLIST: ServiceMapping[] = [
  // AI / LLM
  { id: 'openrouter', name: 'OpenRouter', category: 'ai', envVar: 'OPENROUTER_API_KEY' },
  { id: 'openai', name: 'OpenAI', category: 'ai', envVar: 'OPENAI_API_KEY' },
  { id: 'google', name: 'Google AI', category: 'ai', envVar: 'GOOGLE_AI_API_KEY' },
  { id: 'mistral', name: 'Mistral', category: 'ai', envVar: 'MISTRAL_API_KEY' },
  { id: 'cohere', name: 'Cohere', category: 'ai', envVar: 'COHERE_API_KEY' },
  // Infrastructure
  { id: 'vercel', name: 'Vercel', category: 'infra', envVar: 'VERCEL_TOKEN' },
  { id: 'railway', name: 'Railway', category: 'infra', envVar: 'RAILWAY_TOKEN' },
  { id: 'supabase', name: 'Supabase', category: 'infra', envVar: 'SUPABASE_SERVICE_KEY' },
  { id: 'upstash', name: 'Upstash', category: 'infra', envVar: 'UPSTASH_REDIS_REST_TOKEN' },
  { id: 'inngest', name: 'Inngest', category: 'infra', envVar: 'INNGEST_SIGNING_KEY' },
  { id: 'stripe', name: 'Stripe', category: 'payments', envVar: 'STRIPE_SECRET_KEY' },
  // DevTools
  { id: 'github', name: 'GitHub', category: 'devtools', envVar: 'GITHUB_TOKEN' },
  { id: 'sentry', name: 'Sentry', category: 'devtools', envVar: 'SENTRY_AUTH_TOKEN' },
  { id: 'posthog', name: 'PostHog', category: 'devtools', envVar: 'POSTHOG_PERSONAL_API_KEY' },
  // Data / Search
  { id: 'pinecone', name: 'Pinecone', category: 'data', envVar: 'PINECONE_API_KEY' },
  { id: 'serper', name: 'Serper', category: 'data', envVar: 'SERPER_API_KEY' },
  { id: 'tavily', name: 'Tavily', category: 'data', envVar: 'TAVILY_API_KEY' },
  { id: 'zenrows', name: 'ZenRows', category: 'data', envVar: 'ZENROWS_API_KEY' },
  { id: 'jina', name: 'Jina', category: 'data', envVar: 'JINA_API_KEY' },
  // Competitor / DevAI tools
  { id: 'cursor', name: 'Cursor', category: 'devtools', envVar: 'CURSOR_API_KEY' },
  { id: 'copilot', name: 'GitHub Copilot', category: 'devtools', envVar: 'GITHUB_TOKEN' },
  { id: 'helicone', name: 'Helicone', category: 'monitoring', envVar: 'HELICONE_API_KEY' },
];

// ─── .env parser ────────────────────────────────────────────────────────────

const ENV_LINE_RE = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(?:"([^"]*?)"|'([^']*?)'|([^\s#]*))/;

/**
 * Parse a .env file into a Record<string, string>.
 * Only returns values for vars in the SERVICE_ALLOWLIST.
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return {};
  }

  const allowedVarNames = new Set(SERVICE_ALLOWLIST.map(s => s.envVar));
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const match = line.match(ENV_LINE_RE);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (allowedVarNames.has(key) && value) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Discover which services are configured based on env vars.
 * Checks both the provided envVars dict AND process.env.
 */
export function discoverServices(envVars: Record<string, string> = {}): DiscoveredService[] {
  return SERVICE_ALLOWLIST.map(svc => ({
    id: svc.id,
    name: svc.name,
    category: svc.category,
    envVar: svc.envVar,
    configured: Boolean(envVars[svc.envVar] || process.env[svc.envVar]),
  }));
}

/**
 * Convenience: parse .env.local from a project root and discover services.
 */
export function discoverFromProject(projectRoot: string): {
  envVars: Record<string, string>;
  services: DiscoveredService[];
} {
  const envVars = parseEnvFile(resolve(projectRoot, '.env.local'));
  return { envVars, services: discoverServices(envVars) };
}
