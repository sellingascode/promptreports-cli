/**
 * Environment discovery — parse .env.local and detect connected services
 * Security: Only reads KNOWN service env var prefixes (allowlist)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DiscoveredService {
  id: string;
  name: string;
  category: string;
  envVar: string;
  configured: boolean;
}

// Allowlisted service env vars — ONLY these are read from .env.local
const SERVICE_MAP: Array<{ id: string; name: string; category: string; envVar: string }> = [
  // AI Models
  { id: 'openrouter', name: 'OpenRouter', category: 'AI', envVar: 'OPENROUTER_API_KEY' },
  { id: 'anthropic', name: 'Anthropic', category: 'AI', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', name: 'OpenAI', category: 'AI', envVar: 'OPENAI_API_KEY' },
  { id: 'google', name: 'Google AI', category: 'AI', envVar: 'GOOGLE_AI_API_KEY' },
  { id: 'mistral', name: 'Mistral', category: 'AI', envVar: 'MISTRAL_API_KEY' },
  { id: 'cohere', name: 'Cohere', category: 'AI', envVar: 'COHERE_API_KEY' },
  // Infrastructure
  { id: 'vercel', name: 'Vercel', category: 'Infra', envVar: 'VERCEL_TOKEN' },
  { id: 'railway', name: 'Railway', category: 'Infra', envVar: 'RAILWAY_TOKEN' },
  { id: 'supabase', name: 'Supabase', category: 'Infra', envVar: 'SUPABASE_SERVICE_KEY' },
  { id: 'upstash', name: 'Upstash', category: 'Infra', envVar: 'UPSTASH_REST_TOKEN' },
  { id: 'inngest', name: 'Inngest', category: 'Infra', envVar: 'INNGEST_SIGNING_KEY' },
  // DevTools
  { id: 'github', name: 'GitHub', category: 'DevTools', envVar: 'GITHUB_TOKEN' },
  { id: 'sentry', name: 'Sentry', category: 'DevTools', envVar: 'SENTRY_AUTH_TOKEN' },
  { id: 'posthog', name: 'PostHog', category: 'DevTools', envVar: 'NEXT_PUBLIC_POSTHOG_KEY' },
  // Billing
  { id: 'stripe', name: 'Stripe', category: 'Billing', envVar: 'STRIPE_SECRET_KEY' },
  // Data & Search
  { id: 'pinecone', name: 'Pinecone', category: 'Data', envVar: 'PINECONE_API_KEY' },
  { id: 'serper', name: 'Serper', category: 'Data', envVar: 'SERPER_API_KEY' },
  { id: 'tavily', name: 'Tavily', category: 'Data', envVar: 'TAVILY_API_KEY' },
  { id: 'zenrows', name: 'ZenRows', category: 'Data', envVar: 'ZENROWS_API_KEY' },
  { id: 'jina', name: 'Jina', category: 'Data', envVar: 'JINA_API_KEY' },
  // Communications
  { id: 'sendgrid', name: 'SendGrid', category: 'Comms', envVar: 'SENDGRID_API_KEY' },
  { id: 'elevenlabs', name: 'ElevenLabs', category: 'Comms', envVar: 'ELEVENLABS_API_KEY' },
  // Media
  { id: 'cloudinary', name: 'Cloudinary', category: 'Media', envVar: 'CLOUDINARY_API_KEY' },
  { id: 'firecrawl', name: 'Firecrawl', category: 'Data', envVar: 'FIRECRAWL_API_KEY' },
  // Database
  { id: 'neo4j', name: 'Neo4j', category: 'Database', envVar: 'NEO4J_URI' },
  { id: 'influxdb', name: 'InfluxDB', category: 'Database', envVar: 'INFLUXDB_TOKEN' },
];

export function parseEnvLocal(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return vars;

  const allowedKeys = new Set(SERVICE_MAP.map(s => s.envVar));

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      // Only capture allowlisted keys
      if (key && val && allowedKeys.has(key)) {
        vars[key] = val;
      }
    }
  } catch {}

  return vars;
}

export function discoverServices(envVars: Record<string, string>): {
  configured: DiscoveredService[];
  unconfigured: DiscoveredService[];
  total: number;
} {
  const configured: DiscoveredService[] = [];
  const unconfigured: DiscoveredService[] = [];

  for (const svc of SERVICE_MAP) {
    const isConfigured = !!envVars[svc.envVar];
    const discovered: DiscoveredService = {
      id: svc.id,
      name: svc.name,
      category: svc.category,
      envVar: svc.envVar,
      configured: isConfigured,
    };
    if (isConfigured) {
      configured.push(discovered);
    } else {
      unconfigured.push(discovered);
    }
  }

  return { configured, unconfigured, total: SERVICE_MAP.length };
}

export function discoverFromProject(projectDir: string): ReturnType<typeof discoverServices> {
  const envPath = path.join(projectDir, '.env.local');
  const envVars = parseEnvLocal(envPath);
  return discoverServices(envVars);
}
