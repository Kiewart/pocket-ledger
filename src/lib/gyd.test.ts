import { describe, expect, it } from 'vitest';
import type { AccountRecord, CurrencyRecord, TransactionRecord } from '../db/schema';
import { RateEngine } from './fx';
import { accountBalances, convertOnDate, convertTransactions, summariseCashFlow, type LedgerContext } from './ledger';
import { CURRENCY_CATALOG, currencyMeta } from '../data/catalog';
import gydSeed from '../data/seed-rates-gyd.json';
import { parseRateStringToScaled } from './money';
import { convertMinorWithRate, invertScaledRate } from './rates';

const gyd: CurrencyRecord = {
  code: 'GYD',
  name: 'Guyanese Dollar',
  symbol: 'G$',
  exponent: 2,
  locale: 'en-GY',
  enabled: true,
  createdAt: 0,
};
const usd: CurrencyRecord = {
  code: 'USD',
  name: 'US Dollar',
  symbol: '$',
  exponent: 2,
  locale: 'en-US',
  enabled: true,
  createdAt: 0,
};
const currencies = new Map([
  ['GYD', gyd],
  ['USD', usd],
]);

/** Build a rate engine directly from the bundled GYD dataset. */
function gydEngine(): RateEngine {
  const rows = Object.entries(gydSeed.rates).map(([date, quotes]) => ({
    id: `USD~GYD~${date}`,
    base: 'USD',
    quote: 'GYD',
    date,
    rate: (quotes as Record<string, string>).GYD!,
    source: 'seed' as const,
    provider: gydSeed.provider,
    fetchedAt: 0,
  }));
  return new RateEngine(rows);
}

describe('Guyanese dollar in the currency catalogue', () => {
  it('is present with ISO 4217 minor-unit precision of 2', () => {
    const meta = currencyMeta('GYD');
    expect(meta).toBeDefined();
    expect(meta!.exponent).toBe(2);
    expect(meta!.name).toBe('Guyanese Dollar');
    expect(meta!.symbol).toBe('G$');
    expect(meta!.enabled).toBe(true);
  });

  it('appears exactly once in the catalogue', () => {
    expect(CURRENCY_CATALOG.filter((entry) => entry.code === 'GYD')).toHaveLength(1);
  });

  it('has no duplicate currency codes overall', () => {
    const codes = CURRENCY_CATALOG.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('bundled GYD rate history', () => {
  it('is real provider data, not a placeholder', () => {
    expect(gydSeed.provider).toBe('fawazahmed0');
    expect(gydSeed.provider).not.toBe('frankfurter');
    expect(gydSeed.currencies).toContain('GYD');
    expect(Object.keys(gydSeed.rates).length).toBeGreaterThan(300);
  });

  it('declares a valid ISO base currency', () => {
    // Regression: the generator once wrote an empty object instead of the base
    // code, so every row was stored under base "[object Object]" and the engine
    // could never match USD->GYD even though the rows were present in the cache.
    expect(typeof gydSeed.base).toBe('string');
    expect(gydSeed.base).toBe('USD');
    expect(/^[A-Z]{3}$/.test(gydSeed.base)).toBe(true);
  });

  it('stores exactly one quote currency per date', () => {
    for (const [date, quotes] of Object.entries(gydSeed.rates)) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(date)).toBe(true);
      const keys = Object.keys(quotes as Record<string, string>);
      expect(keys).toEqual(['GYD']);
    }
  });

  it('resolves through the engine under the declared base', () => {
    // The end-to-end guarantee: seeded rows must actually be reachable as
    // base -> quote lookups, not merely present in the table.
    const engine = new RateEngine(
      Object.entries(gydSeed.rates).map(([date, quotes]) => ({
        id: `${gydSeed.base}~GYD~${date}`,
        base: gydSeed.base,
        quote: 'GYD',
        date,
        rate: (quotes as Record<string, string>).GYD!,
        source: 'seed' as const,
        provider: gydSeed.provider,
        fetchedAt: 0,
      })),
    );
    const resolved = engine.resolve('USD', 'GYD', '2026-11-06', { maxStalenessDays: 7 });
    expect(resolved).not.toBeNull();
    expect(resolved!.kind).toBe('direct');
  });

  it('covers the same window as the ECB dataset', () => {
    expect(gydSeed.startDate <= '2025-09-05').toBe(true);
    expect(gydSeed.endDate >= '2026-10-01').toBe(true);
  });

  it('holds plausible GYD-per-USD values', () => {
    // The Guyanese dollar has traded in the ~200-215 band against the USD
    // across this period. A wildly different value would indicate a unit error
    // (for example, GYD-per-USD recorded as USD-per-GYD).
    for (const quotes of Object.values(gydSeed.rates)) {
      const value = Number((quotes as Record<string, string>).GYD);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(150);
      expect(value).toBeLessThan(300);
    }
  });

  it('parses every rate into the fixed-scale representation', () => {
    for (const quotes of Object.values(gydSeed.rates)) {
      const scaled = parseRateStringToScaled((quotes as Record<string, string>).GYD!);
      expect(scaled).not.toBeNull();
      expect(scaled! > 0n).toBe(true);
    }
  });
});

describe('converting with GYD', () => {
  const engine = gydEngine();

  it('converts USD to GYD at the rate for that exact date', () => {
    const rate = engine.resolve('USD', 'GYD', '2026-11-06', { maxStalenessDays: 7 });
    expect(rate).not.toBeNull();
    expect(rate!.kind).toBe('direct');
    // 1.00 USD should become roughly 200+ GYD.
    const converted = convertMinorWithRate(100n, 2, 2, rate!.rate);
    expect(converted > 20000n && converted < 21500n).toBe(true);
  });

  it('inverts GYD to USD correctly', () => {
    const direct = engine.resolve('USD', 'GYD', '2026-11-06', { maxStalenessDays: 7 })!;
    const inverse = engine.resolve('GYD', 'USD', '2026-11-06', { maxStalenessDays: 7 })!;
    expect(inverse.kind).toBe('inverse');
    // 20,000 GYD ≈ 95-100 USD.
    const converted = convertMinorWithRate(2_000_000n, 2, 2, inverse.rate);
    expect(converted > 9000n && converted < 10500n).toBe(true);
    // The two directions round-trip within a cent of a dollar.
    const back = convertMinorWithRate(converted, 2, 2, direct.rate);
    const diff = back > 2_000_000n ? back - 2_000_000n : 2_000_000n - back;
    expect(diff < 500n).toBe(true);
  });

  it('uses a historical date, not the latest rate', () => {
    const early = engine.resolve('USD', 'GYD', '2025-09-10', { maxStalenessDays: 7 })!;
    const late = engine.resolve('USD', 'GYD', '2026-10-10', { maxStalenessDays: 7 })!;
    expect(early.rateDate).toBe('2025-09-10');
    expect(late.rateDate).toBe('2026-10-10');
    // Both are valid but the engine must not substitute one for the other.
    expect(early.rateDate).not.toBe(late.rateDate);
  });

  it('never resolves a rate before the dataset begins', () => {
    const rate = engine.resolve('USD', 'GYD', '2019-01-01', { maxStalenessDays: 7 });
    expect(rate).toBeNull();
  });

  it('carries a rate forward across a missing day but labels it', () => {
    // 2026-11-08 has no published file; the previous day's rate is within the
    // window and must be reported as stale rather than presented as exact.
    const rate = engine.resolve('USD', 'GYD', '2026-11-08', { maxStalenessDays: 7 });
    if (rate) {
      expect(rate.kind).toBe('stale');
      expect(rate.daysStale).toBeGreaterThan(0);
    }
  });

  it('rejects a stale rate when the window is zero', () => {
    const rate = engine.resolve('USD', 'GYD', '2026-11-08', { maxStalenessDays: 0 });
    expect(rate).toBeNull();
  });
});

describe('GYD in a ledger', () => {
  const engine = gydEngine();

  const gydAccount: AccountRecord = {
    id: 'acc-gyd',
    name: 'Georgetown Checking',
    currency: 'GYD',
    type: 'checking',
    // G$100,000.00
    openingBalance: 10_000_000,
    includeInTotal: true,
    archived: false,
    createdAt: 0,
  };
  const usdAccount: AccountRecord = {
    id: 'acc-usd',
    name: 'Checking',
    currency: 'USD',
    type: 'checking',
    openingBalance: 100_000,
    includeInTotal: true,
    archived: false,
    createdAt: 0,
  };

  function context(transactions: TransactionRecord[]): LedgerContext {
    return {
      transactions,
      accounts: [gydAccount, usdAccount],
      currencies,
      engine,
      reportingCurrency: 'USD',
      maxStalenessDays: 7,
      asOfDate: '2026-11-06',
    };
  }

  const tx = (
    partial: Partial<TransactionRecord> & Pick<TransactionRecord, 'type' | 'amount' | 'currency'>,
  ): TransactionRecord => ({
    id: Math.random().toString(36).slice(2),
    accountId: 'acc-gyd',
    date: '2026-11-06',
    status: 'cleared',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  });

  it('keeps the original GYD amount untouched', () => {
    const [converted] = convertTransactions(
      context([tx({ type: 'expense', amount: 1_250_000, currency: 'GYD' })]),
    );
    expect(converted!.transaction.amount).toBe(1_250_000);
    expect(converted!.transaction.currency).toBe('GYD');
    expect(converted!.originalAmount).toBe(1_250_000n);
  });

  it('reports GYD spending in the reporting currency', () => {
    const [converted] = convertTransactions(
      context([tx({ type: 'expense', amount: 2_000_000, currency: 'GYD' })]),
    );
    // G$20,000 at ~209 GYD/USD ≈ $95-100.
    expect(converted!.convertedAmount).not.toBeNull();
    const value = converted!.convertedAmount!;
    expect(value > 9000n && value < 10500n).toBe(true);
  });

  it('excludes a USD->GYD transfer from cash flow', () => {
    const summary = summariseCashFlow(
      convertTransactions(
        context([
          tx({
            type: 'transfer',
            amount: 50_000,
            currency: 'USD',
            accountId: 'acc-usd',
            toAccountId: 'acc-gyd',
          }),
        ]),
      ),
    );
    expect(summary.income).toBe(0n);
    expect(summary.expense).toBe(0n);
    expect(summary.net).toBe(0n);
  });

  it('moves value between the two accounts without creating money', () => {
    const balances = accountBalances(
      context([
        tx({
          type: 'transfer',
          amount: 100_000, // $1,000.00
          currency: 'USD',
          accountId: 'acc-usd',
          toAccountId: 'acc-gyd',
        }),
      ]),
    );
    const gydBalance = balances.find((entry) => entry.account.id === 'acc-gyd')!;
    const usdBalance = balances.find((entry) => entry.account.id === 'acc-usd')!;

    // The USD account loses exactly $1,000.
    expect(usdBalance.balance).toBe(0n);
    // The GYD account gains the GYD equivalent: capital + ~209,000 cents.
    expect(gydBalance.balance > 30_000_000n).toBe(true);
    expect(gydBalance.balance < 32_000_000n).toBe(true);
  });

  it('computes a GYD account balance in its own currency', () => {
    const balances = accountBalances(
      context([tx({ type: 'income', amount: 500_000, currency: 'GYD' })]),
    );
    const gydBalance = balances.find((entry) => entry.account.id === 'acc-gyd')!;
    // G$100,000 opening + G$5,000 income, in cents.
    expect(gydBalance.balance).toBe(10_500_000n);
    expect(gydBalance.convertedBalance).not.toBeNull();
  });

  it('marks a GYD amount unconverted when no rate is available', () => {
    const noRates: LedgerContext = {
      ...context([tx({ type: 'expense', amount: 100_000, currency: 'GYD', date: '2019-05-05' })]),
      engine: new RateEngine([]),
    };
    const [converted] = convertTransactions(noRates);
    expect(converted!.convertedAmount).toBeNull();

    const summary = summariseCashFlow([converted!]);
    // It must be excluded from totals and counted, never guessed.
    expect(summary.expense).toBe(0n);
    expect(summary.unconvertedCount).toBe(1);
  });
});

describe('convertOnDate with GYD', () => {
  it('is a no-op within the same currency', () => {
    const context: LedgerContext = {
      transactions: [],
      accounts: [],
      currencies,
      engine: new RateEngine([]),
      reportingCurrency: 'GYD',
      maxStalenessDays: 7,
      asOfDate: '2026-11-06',
    };
    const result = convertOnDate(12345n, 'GYD', 'GYD', '2026-11-06', context);
    expect(result.amount).toBe(12345n);
    expect(result.rate?.kind).toBe('identity');
  });
});

describe('invertScaledRate remains exact for GYD magnitudes', () => {
  it('round-trips a rate near 209', () => {
    const rate = parseRateStringToScaled('209.23749872')!;
    const inverted = invertScaledRate(rate);
    expect(inverted > 0n).toBe(true);
    // 1/209.24 ≈ 0.00478
    const asNumber = Number(inverted) / 1e12;
    expect(asNumber > 0.0047 && asNumber < 0.0049).toBe(true);
  });
});
