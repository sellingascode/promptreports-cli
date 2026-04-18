/**
 * Standalone Fetcher Framework — Fetch Utilities
 *
 * Retry helper with AbortSignal.timeout, zero external dependencies.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

/**
 * fetch() wrapper with automatic retry + timeout.
 * Uses AbortSignal.timeout() — requires Node 18+.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error(`fetchWithRetry failed after ${retries + 1} attempts`);
}

/** Helper: build period object for the last N days */
export function makePeriod(days: number): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86_400_000);
  return {
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };
}

/** Helper: build a no-key result */
export function noKeyResult(
  provider: string,
  category: ProviderCostCategory,
  unit: string,
  days: number,
): import('./types.js').ProviderCost {
  return {
    provider,
    category,
    period: makePeriod(days),
    cost: { amount: 0, currency: 'USD' },
    usage: { primary: { value: 0, unit } },
    status: 'no-key',
  };
}

/** Helper: build an error result */
export function errorResult(
  provider: string,
  category: ProviderCostCategory,
  unit: string,
  days: number,
  error: unknown,
): import('./types.js').ProviderCost {
  return {
    provider,
    category,
    period: makePeriod(days),
    cost: { amount: 0, currency: 'USD' },
    usage: { primary: { value: 0, unit } },
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
  };
}

type ProviderCostCategory = import('./types.js').ProviderCost['category'];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
