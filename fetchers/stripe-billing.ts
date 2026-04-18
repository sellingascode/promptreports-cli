/**
 * Stripe billing fetcher — GET /v1/balance + /v1/charges
 * Returns revenue, processing fees, and available balance.
 */
import type { ProviderCost } from './types';
import { fetchWithRetry, makePeriod, noKeyResult, errorResult } from './fetch-utils';

export async function fetchStripeBillingUsage(apiKey: string, days: number = 30): Promise<ProviderCost> {
  if (!apiKey) return noKeyResult('stripe', 'payments', 'USD', days);

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const sinceUnix = Math.floor((Date.now() - days * 86_400_000) / 1000);

    const [balanceRes, chargesRes] = await Promise.all([
      fetchWithRetry('https://api.stripe.com/v1/balance', { headers }),
      fetchWithRetry(`https://api.stripe.com/v1/charges?created[gte]=${sinceUnix}&limit=100`, { headers }),
    ]);

    if (!balanceRes.ok) {
      return { provider: 'stripe', category: 'payments', period: makePeriod(days), cost: { amount: 0, currency: 'USD' }, usage: { primary: { value: 0, unit: 'USD' } }, status: 'error', error: `API returned ${balanceRes.status}` };
    }

    const balance = await balanceRes.json();
    const availableBalance = (balance.available || [])
      .reduce((sum: number, b: { amount: number }) => sum + b.amount, 0) / 100;

    let totalRevenue = 0;
    let chargeCount = 0;

    if (chargesRes.ok) {
      const charges = await chargesRes.json();
      for (const charge of charges.data || []) {
        if (charge.paid) {
          totalRevenue += (charge.amount || 0) / 100;
          chargeCount++;
        }
      }
    }

    // Estimate Stripe processing fees (~2.9% + $0.30 per txn)
    const estimatedFees = chargeCount * 0.30 + totalRevenue * 0.029;

    return {
      provider: 'stripe',
      category: 'payments',
      period: makePeriod(days),
      cost: {
        amount: estimatedFees,
        currency: 'USD',
        breakdown: { revenue: totalRevenue, 'processing-fees': estimatedFees, 'available-balance': availableBalance },
      },
      usage: {
        primary: { value: totalRevenue, unit: 'USD revenue' },
        secondary: { value: chargeCount, unit: 'transactions' },
      },
      status: 'ok',
    };
  } catch (err) {
    return errorResult('stripe', 'payments', 'USD', days, err);
  }
}
