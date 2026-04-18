/**
 * Standalone Fetcher Framework — Type Definitions
 *
 * Portable types with ZERO dependencies on Next.js, Prisma, or any framework.
 * All fetchers return ProviderCost; env-discovery returns DiscoveredService[].
 */

export interface ProviderCost {
  provider: string;
  category: 'ai' | 'infra' | 'monitoring' | 'data' | 'devtools' | 'payments';
  period: { start: string; end: string };
  cost: { amount: number; currency: 'USD'; breakdown?: Record<string, number> };
  usage: { primary: { value: number; unit: string }; secondary?: { value: number; unit: string } };
  status: 'ok' | 'error' | 'no-key';
  error?: string;
}

export interface DiscoveredService {
  id: string;
  name: string;
  category: string;
  envVar: string;
  configured: boolean;
}

/** Signature every fetcher must implement */
export type FetcherFn = (apiKey: string, days?: number) => Promise<ProviderCost>;
