import { describe, expect, it } from 'vitest';
import type {
  AccountRecord,
  CategoryRecord,
  CurrencyRecord,
  TransactionRecord,
} from '../db/schema';
import { RateEngine } from './fx';
import {
  accountBalances,
  accountTotals,
  categoryTotals,
  convertOnDate,
  convertTransactions,
  monthlySeries,
  portfolioValue,
  summariseCashFlow,
  type LedgerContext,
} from './ledger';

const currencies = new Map<string, CurrencyRecord>([
  ['USD', { code: 'USD', name: 'US Dollar', symbol: '$', exponent: 2, locale: 'en-US', enabled: true, createdAt: 0 }],
  ['EUR', { code: 'EUR', name: 'Euro', symbol: '€', exponent: 2, locale: 'de-DE', enabled: true, createdAt: 0 }],
  ['JPY', { code: 'JPY', name: 'Yen', symbol: '¥', exponent: 0, locale: 'ja-JP', enabled: true, createdAt: 0 }],
]);

const accounts: AccountRecord[] = [
  {
    id: 'acc-usd',
    name: 'Checking',
    currency: 'USD',
    type: 'checking',
    openingBalance: 100000, // 1,000.00
    includeInTotal: true,
    archived: false,
    createdAt: 0,
  },
  {
    id: 'acc-eur',
    name: 'Euro',
    currency: 'EUR',
    type: 'checking',
    openingBalance: 50000, // 500.00
    includeInTotal: true,
    archived: false,
    createdAt: 0,
  },
  {
    id: 'acc-jpy',
    name: 'Yen',
    currency: 'JPY',
    type: 'cash',
    openingBalance: 100000, // 100,000 yen
    includeInTotal: true,
    archived: false,
    createdAt: 0,
  },
];

function tx(partial: Partial<TransactionRecord> & Pick<TransactionRecord, 'type' | 'amount' | 'currency'>): TransactionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: 'acc-usd',
    date: '2026-01-15',
    status: 'cleared',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

/**
 * The engine used across these tests. Rates are deliberately round numbers so
 * expected values can be verified by hand:
 *   USD -> EUR 0.90, USD -> JPY 150
 */
function makeContext(
  transactions: TransactionRecord[],
  overrides: Partial<LedgerContext> = {},
): LedgerContext {
  const engine = new RateEngine([
    { id: '1', base: 'USD', quote: 'EUR', date: '2026-01-15', rate: '0.9', source: 'seed', provider: 'test', fetchedAt: 0 },
    { id: '2', base: 'USD', quote: 'JPY', date: '2026-01-15', rate: '150', source: 'seed', provider: 'test', fetchedAt: 0 },
  ]);
  return {
    transactions,
    accounts,
    currencies,
    engine,
    reportingCurrency: 'USD',
    maxStalenessDays: 7,
    asOfDate: '2026-01-15',
    ...overrides,
  };
}

describe('convertTransactions', () => {
  it('keeps the original amount and currency untouched', () => {
    const context = makeContext([tx({ type: 'expense', amount: 1000, currency: 'EUR' })]);
    const [converted] = convertTransactions(context);
    expect(converted!.transaction.amount).toBe(1000);
    expect(converted!.transaction.currency).toBe('EUR');
    expect(converted!.originalAmount).toBe(1000n);
  });

  it('converts using the historical rate for the transaction date', () => {
    // 10.00 EUR -> USD using the inverse of 0.90 => 11.111... USD => 11.11
    const context = makeContext([tx({ type: 'expense', amount: 1000, currency: 'EUR' })]);
    const [converted] = convertTransactions(context);
    expect(converted!.convertedAmount).toBe(1111n);
    expect(converted!.rate?.kind).toBe('inverse');
  });

  it('converts JPY into USD with correct decimals', () => {
    // 15,000 JPY / 150 = 100.00 USD
    const context = makeContext([
      tx({ type: 'expense', amount: 15000, currency: 'JPY', accountId: 'acc-jpy' }),
    ]);
    const [converted] = convertTransactions(context);
    expect(converted!.convertedAmount).toBe(10000n);
  });

  it('leaves same-currency amounts untouched', () => {
    const context = makeContext([tx({ type: 'expense', amount: 12345, currency: 'USD' })]);
    const [converted] = convertTransactions(context);
    expect(converted!.convertedAmount).toBe(12345n);
    expect(converted!.rate?.kind).toBe('identity');
  });

  it('reports null instead of guessing when no rate exists', () => {
    const context = makeContext(
      [tx({ type: 'expense', amount: 1000, currency: 'EUR', date: '2020-01-01' })],
      { maxStalenessDays: 7 },
    );
    const [converted] = convertTransactions(context);
    expect(converted!.convertedAmount).toBeNull();
    expect(converted!.signedConverted).toBe(0n);
  });

  it('flags carried-forward rates as approximate', () => {
    const context = makeContext([
      tx({ type: 'expense', amount: 1000, currency: 'EUR', date: '2026-01-20' }),
    ]);
    const [converted] = convertTransactions(context);
    expect(converted!.approximate).toBe(true);
    expect(converted!.rate?.rateDate).toBe('2026-01-15');
  });

  it('never substitutes today\'s rate for a transaction in the past', () => {
    const engine = new RateEngine([
      { id: 'a', base: 'USD', quote: 'EUR', date: '2026-01-15', rate: '0.9', source: 'seed', provider: 't', fetchedAt: 0 },
      { id: 'b', base: 'USD', quote: 'EUR', date: '2026-06-15', rate: '0.5', source: 'seed', provider: 't', fetchedAt: 0 },
    ]);
    const context: LedgerContext = {
      ...makeContext([]),
      engine,
      transactions: [tx({ type: 'expense', amount: 1000, currency: 'EUR', date: '2026-01-15' })],
    };
    const [converted] = convertTransactions(context);
    // 10 EUR / 0.9 = 11.11 USD, not 10 / 0.5 = 20.00.
    expect(converted!.convertedAmount).toBe(1111n);
  });
});

describe('signs and direction', () => {
  it('adds income and subtracts expenses', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 500000, currency: 'USD' }),
      tx({ type: 'expense', amount: 200000, currency: 'USD' }),
    ]);
    const converted = convertTransactions(context);
    expect(converted[0]!.signedConverted).toBe(500000n);
    expect(converted[1]!.signedConverted).toBe(-200000n);
  });

  it('gives transfers a zero cash-flow impact', () => {
    const context = makeContext([
      tx({
        type: 'transfer',
        amount: 50000,
        currency: 'USD',
        accountId: 'acc-usd',
        toAccountId: 'acc-eur',
      }),
    ]);
    const [converted] = convertTransactions(context);
    expect(converted!.signedConverted).toBe(0n);
  });
});

describe('summariseCashFlow', () => {
  it('separates income and expenses and nets them', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 300000, currency: 'USD' }),
      tx({ type: 'expense', amount: 125000, currency: 'USD' }),
      tx({ type: 'expense', amount: 25000, currency: 'USD' }),
    ]);
    const summary = summariseCashFlow(convertTransactions(context));
    expect(summary.income).toBe(300000n);
    expect(summary.expense).toBe(150000n);
    expect(summary.net).toBe(150000n);
    expect(summary.unconvertedCount).toBe(0);
  });

  it('excludes transfers so an internal movement is never counted as income or expense', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 100000, currency: 'USD' }),
      tx({
        type: 'transfer',
        amount: 50000,
        currency: 'USD',
        accountId: 'acc-usd',
        toAccountId: 'acc-eur',
      }),
    ]);
    const summary = summariseCashFlow(convertTransactions(context));
    expect(summary.income).toBe(100000n);
    expect(summary.expense).toBe(0n);
    expect(summary.net).toBe(100000n);
  });

  it('excludes unconvertible transactions from totals and counts them', () => {
    const context = makeContext([
      tx({ type: 'expense', amount: 10000, currency: 'USD' }),
      tx({ type: 'expense', amount: 5000, currency: 'EUR', date: '2019-01-01' }),
    ]);
    const summary = summariseCashFlow(convertTransactions(context));
    expect(summary.expense).toBe(10000n);
    expect(summary.unconvertedCount).toBe(1);
  });

  it('counts approximate conversions without altering the math', () => {
    const context = makeContext([
      tx({ type: 'expense', amount: 1000, currency: 'EUR', date: '2026-01-18' }),
    ]);
    const summary = summariseCashFlow(convertTransactions(context));
    expect(summary.approximateCount).toBe(1);
    expect(summary.expense).toBe(1111n);
  });
});

describe('accountBalances', () => {
  it('computes opening balance plus movements in the native currency', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 50000, currency: 'USD' }),
      tx({ type: 'expense', amount: 20000, currency: 'USD' }),
    ]);
    const balances = accountBalances(context);
    const usd = balances.find((balance) => balance.account.id === 'acc-usd')!;
    expect(usd.openingBalance).toBe(100000n);
    expect(usd.movement).toBe(30000n);
    expect(usd.balance).toBe(130000n);
  });

  it('does not double count a same-currency transfer', () => {
    const context = makeContext([
      tx({
        type: 'transfer',
        amount: 25000,
        currency: 'USD',
        accountId: 'acc-usd',
        toAccountId: 'acc-eur',
      }),
    ]);
    const balances = accountBalances(context);
    const usd = balances.find((balance) => balance.account.id === 'acc-usd')!;
    const eur = balances.find((balance) => balance.account.id === 'acc-eur')!;

    // The USD account loses 250.00.
    expect(usd.balance).toBe(75000n);
    // The EUR account receives the equivalent: 250 USD * 0.9 = 225.00 EUR.
    expect(eur.movement).toBe(22500n);
    expect(eur.balance).toBe(72500n);
  });

  it('preserves total value across a cross-currency transfer', () => {
    const context = makeContext([
      tx({
        type: 'transfer',
        amount: 100000,
        currency: 'USD',
        accountId: 'acc-usd',
        toAccountId: 'acc-eur',
      }),
    ]);
    const balances = accountBalances(context);
    const total = portfolioValue(balances);
    // Opening: 1000 USD + 500 EUR + 100,000 JPY
    // In USD at 0.9 EUR/USD and 150 JPY/USD: 1000 + 500/0.9 + 100000/150
    // = 1000 + 555.56 + 666.67 = 2222.23
    expect(total.total).toBe(222223n);
  });

  it('converts each balance into the reporting currency', () => {
    const context = makeContext([]);
    const balances = accountBalances(context);
    const eur = balances.find((balance) => balance.account.id === 'acc-eur')!;
    // 500 EUR / 0.9 = 555.56 USD
    expect(eur.convertedBalance).toBe(55556n);
  });

  it('marks a balance unconverted rather than guessing', () => {
    const context = makeContext([], { asOfDate: '2020-01-01' });
    const balances = accountBalances(context);
    const eur = balances.find((balance) => balance.account.id === 'acc-eur')!;
    expect(eur.convertedBalance).toBeNull();
  });

  it('excludes accounts flagged includeInTotal from the portfolio', () => {
    const context = makeContext([]);
    context.accounts = accounts.map((account) =>
      account.id === 'acc-eur' ? { ...account, includeInTotal: false } : account,
    );
    const total = portfolioValue(accountBalances(context));
    // 1000 USD + 666.67 USD (100,000 JPY / 150)
    expect(total.total).toBe(166667n);
  });
});

describe('net cash flow versus account balance', () => {
  it('distinguishes the two: cash flow is zero for a pure transfer, balances move', () => {
    const context = makeContext([
      tx({
        type: 'transfer',
        amount: 100000,
        currency: 'USD',
        accountId: 'acc-usd',
        toAccountId: 'acc-eur',
      }),
    ]);
    const converted = convertTransactions(context);
    const summary = summariseCashFlow(converted);
    expect(summary.net).toBe(0n);

    const balances = accountBalances(context);
    const usd = balances.find((balance) => balance.account.id === 'acc-usd')!;
    expect(usd.balance).toBe(0n);
    // Total value is unchanged by an internal transfer, only its location.
    expect(portfolioValue(balances).total).toBe(222223n);
  });

  it('recognises the opening balance makes balances differ from cash flow', () => {
    const context = makeContext([]);
    const balances = accountBalances(context);
    const total = portfolioValue(balances);
    // No transactions at all, yet the portfolio is non-zero.
    expect(total.total).toBe(222223n);
    expect(summariseCashFlow([]).net).toBe(0n);
  });

  it('does not count a transfer as income even when the destination is a different currency', () => {
    const context = makeContext([
      tx({
        type: 'transfer',
        amount: 100000,
        currency: 'EUR',
        accountId: 'acc-eur',
        toAccountId: 'acc-usd',
      }),
    ]);
    const summary = summariseCashFlow(convertTransactions(context));
    expect(summary.income).toBe(0n);
    expect(summary.expense).toBe(0n);
    expect(summary.net).toBe(0n);
  });
});

describe('monthlySeries', () => {
  it('buckets by month and excludes transfers', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 100000, currency: 'USD', date: '2026-01-05' }),
      tx({ type: 'expense', amount: 25000, currency: 'USD', date: '2026-01-20' }),
      tx({ type: 'income', amount: 200000, currency: 'USD', date: '2026-02-05' }),
      tx({ type: 'transfer', amount: 50000, currency: 'USD', accountId: 'acc-usd', toAccountId: 'acc-eur', date: '2026-02-10' }),
    ]);
    const series = monthlySeries(convertTransactions(context));
    expect(series).toHaveLength(2);
    expect(series[0]!.key).toBe('2026-01');
    expect(series[0]!.income).toBe(100000n);
    expect(series[0]!.expense).toBe(25000n);
    expect(series[0]!.net).toBe(75000n);
    expect(series[1]!.net).toBe(200000n);
  });

  it('is sorted chronologically', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 100, currency: 'USD', date: '2026-03-01' }),
      tx({ type: 'income', amount: 100, currency: 'USD', date: '2026-01-01' }),
      tx({ type: 'income', amount: 100, currency: 'USD', date: '2026-02-01' }),
    ]);
    const series = monthlySeries(convertTransactions(context));
    expect(series.map((point) => point.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('categoryTotals', () => {
  const categories = new Map<string, CategoryRecord>([
    ['cat-food', { id: 'cat-food', name: 'Food', kind: 'expense', icon: 'X', color: '#f00', archived: false, createdAt: 0 }],
    ['cat-pay', { id: 'cat-pay', name: 'Pay', kind: 'income', icon: 'X', color: '#0f0', archived: false, createdAt: 0 }],
  ]);

  it('groups by category with shares that sum to 100', () => {
    const context = makeContext([
      tx({ type: 'expense', amount: 30000, currency: 'USD', categoryId: 'cat-food' }),
      tx({ type: 'expense', amount: 10000, currency: 'USD', categoryId: undefined }),
    ]);
    const totals = categoryTotals(convertTransactions(context), 'expense', categories);
    expect(totals).toHaveLength(2);
    expect(totals[0]!.total).toBe(30000n);
    const share = totals.reduce((total, item) => total + item.share, 0);
    expect(Math.round(share)).toBe(100);
  });

  it('labels uncategorised transactions', () => {
    const context = makeContext([tx({ type: 'expense', amount: 5000, currency: 'USD' })]);
    const totals = categoryTotals(convertTransactions(context), 'expense', categories);
    expect(totals[0]!.name).toBe('Uncategorised');
    expect(totals[0]!.categoryId).toBeUndefined();
  });

  it('filters by kind', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 100000, currency: 'USD', categoryId: 'cat-pay' }),
      tx({ type: 'expense', amount: 10000, currency: 'USD', categoryId: 'cat-food' }),
    ]);
    const converted = convertTransactions(context);
    expect(categoryTotals(converted, 'income', categories)).toHaveLength(1);
    expect(categoryTotals(converted, 'expense', categories)).toHaveLength(1);
  });

  it('sorts largest first', () => {
    const context = makeContext([
      tx({ type: 'expense', amount: 1000, currency: 'USD', categoryId: 'cat-food' }),
      tx({ type: 'expense', amount: 50000, currency: 'USD', categoryId: 'cat-pay' }),
    ]);
    const totals = categoryTotals(convertTransactions(context), 'expense', categories);
    expect(totals[0]!.total).toBe(50000n);
  });
});

describe('accountTotals', () => {
  it('aggregates income and expenses per account', () => {
    const context = makeContext([
      tx({ type: 'income', amount: 100000, currency: 'USD', accountId: 'acc-usd' }),
      tx({ type: 'expense', amount: 20000, currency: 'USD', accountId: 'acc-usd' }),
      tx({ type: 'expense', amount: 9000, currency: 'EUR', accountId: 'acc-eur' }),
    ]);
    const map = new Map(accounts.map((account) => [account.id, account]));
    const totals = accountTotals(convertTransactions(context), map);
    const usd = totals.find((entry) => entry.accountId === 'acc-usd')!;
    expect(usd.income).toBe(100000n);
    expect(usd.expense).toBe(20000n);
    expect(usd.net).toBe(80000n);
  });
});

describe('convertOnDate', () => {
  it('is a no-op for the same currency', () => {
    const context = makeContext([]);
    const result = convertOnDate(12345n, 'USD', 'USD', '2026-01-15', context);
    expect(result.amount).toBe(12345n);
    expect(result.rate?.kind).toBe('identity');
  });

  it('applies the exponent difference correctly', () => {
    const context = makeContext([]);
    const result = convertOnDate(10000n, 'USD', 'JPY', '2026-01-15', context);
    // 100.00 USD * 150 = 15,000 JPY (0 decimals)
    expect(result.amount).toBe(15000n);
  });
});
