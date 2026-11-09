import { describe, expect, it } from 'vitest';
import type {
  AccountRecord,
  BudgetRecord,
  CategoryRecord,
  CurrencyRecord,
  TransactionRecord,
} from '../db/schema';
import { RateEngine } from './fx';
import { convertTransactions, type LedgerContext } from './ledger';
import { budgetTotals, buildAlerts, evaluateBudgets, transactionsInMonth } from './budgets';

const currencies = new Map<string, CurrencyRecord>([
  ['USD', { code: 'USD', name: 'US Dollar', symbol: '$', exponent: 2, locale: 'en-US', enabled: true, createdAt: 0 }],
  ['EUR', { code: 'EUR', name: 'Euro', symbol: '€', exponent: 2, locale: 'de-DE', enabled: true, createdAt: 0 }],
]);

const categories = new Map<string, CategoryRecord>([
  ['cat-food', { id: 'cat-food', name: 'Food', kind: 'expense', icon: 'X', color: '#f00', archived: false, createdAt: 0 }],
  ['cat-rent', { id: 'cat-rent', name: 'Rent', kind: 'expense', icon: 'X', color: '#00f', archived: false, createdAt: 0 }],
]);

const accounts: AccountRecord[] = [
  { id: 'acc', name: 'Checking', currency: 'USD', type: 'checking', openingBalance: 0, includeInTotal: true, archived: false, createdAt: 0 },
];

function tx(partial: Partial<TransactionRecord> & Pick<TransactionRecord, 'type' | 'amount' | 'currency'>): TransactionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: 'acc',
    date: '2026-01-15',
    status: 'cleared',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function budget(categoryId: string, amount: number, month = '2026-01', currency = 'USD'): BudgetRecord {
  return { id: `b-${categoryId}-${month}`, categoryId, month, amount, currency, rollover: false, createdAt: 0 };
}

function context(transactions: TransactionRecord[]): LedgerContext {
  return {
    transactions,
    accounts,
    currencies,
    engine: new RateEngine([
      { id: 'r1', base: 'USD', quote: 'EUR', date: '2026-01-31', rate: '0.9', source: 'seed', provider: 'test', fetchedAt: 0 },
    ]),
    reportingCurrency: 'USD',
    maxStalenessDays: 7,
    asOfDate: '2026-01-31',
  };
}

describe('evaluateBudgets', () => {
  it('computes spend, percent and remaining', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 30000, currency: 'USD', categoryId: 'cat-food' }),
    ]);
    const statuses = evaluateBudgets([budget('cat-food', 50000)], convertTransactions(ctx), categories, ctx, 80);
    const status = statuses[0]!;
    expect(status.spent).toBe(30000n);
    expect(status.budgetAmount).toBe(50000n);
    expect(status.percent).toBe(60);
    expect(status.remaining).toBe(20000n);
    expect(status.level).toBe('under');
  });

  it('warns at the alert threshold', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 42000, currency: 'USD', categoryId: 'cat-food' }),
    ]);
    const [status] = evaluateBudgets([budget('cat-food', 50000)], convertTransactions(ctx), categories, ctx, 80);
    expect(status!.percent).toBe(84);
    expect(status!.level).toBe('warning');
  });

  it('flags over budget and reports a negative remainder', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 60000, currency: 'USD', categoryId: 'cat-food' }),
    ]);
    const [status] = evaluateBudgets([budget('cat-food', 50000)], convertTransactions(ctx), categories, ctx, 80);
    expect(status!.level).toBe('over');
    expect(status!.remaining).toBe(-10000n);
  });

  it('ignores income when measuring budget usage', () => {
    const ctx = context([
      tx({ type: 'income', amount: 500000, currency: 'USD', categoryId: 'cat-food' }),
      tx({ type: 'expense', amount: 10000, currency: 'USD', categoryId: 'cat-food' }),
    ]);
    const [status] = evaluateBudgets([budget('cat-food', 50000)], convertTransactions(ctx), categories, ctx, 80);
    expect(status!.spent).toBe(10000n);
  });

  it('ignores transfers', () => {
    const ctx = context([
      tx({ type: 'transfer', amount: 90000, currency: 'USD', accountId: 'acc', toAccountId: 'acc', categoryId: 'cat-food' }),
    ]);
    const [status] = evaluateBudgets([budget('cat-food', 50000)], convertTransactions(ctx), categories, ctx, 80);
    expect(status!.spent).toBe(0n);
  });

  it('converts foreign-currency spending into the reporting currency', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 9000, currency: 'EUR', categoryId: 'cat-food', date: '2026-01-31' }),
    ]);
    const [status] = evaluateBudgets([budget('cat-food', 50000)], convertTransactions(ctx), categories, ctx, 80);
    // 90.00 EUR / 0.9 = 100.00 USD
    expect(status!.spent).toBe(10000n);
  });

  it('converts a budget set in another currency at month end', () => {
    const ctx = context([]);
    const [status] = evaluateBudgets(
      [budget('cat-food', 9000, '2026-01', 'EUR')],
      convertTransactions(ctx),
      categories,
      ctx,
      80,
    );
    // 90.00 EUR / 0.9 = 100.00 USD
    expect(status!.budgetAmount).toBe(10000n);
    expect(status!.rate?.rateDate).toBe('2026-01-31');
  });

  it('marks an unconvertible budget instead of guessing', () => {
    // No rates at all: the EUR budget cannot be valued in USD.
    const ctx: LedgerContext = { ...context([]), engine: new RateEngine([]) };
    const [status] = evaluateBudgets(
      [budget('cat-food', 9000, '2026-01', 'EUR')],
      convertTransactions(ctx),
      categories,
      ctx,
      80,
    );
    expect(status!.level).toBe('unconverted');
    expect(status!.budgetAmount).toBeNull();
    expect(status!.rate).toBeNull();
  });

  it('values a current-month budget at today, not at an unreachable month end', () => {
    // Regression: a month in progress used to be valued at its own last day,
    // which is in the future, so no rate could exist and every in-progress
    // budget reported as unconvertible.
    const ctx: LedgerContext = {
      ...context([]),
      asOfDate: '2026-01-15',
      engine: new RateEngine([
        { id: 'r', base: 'USD', quote: 'EUR', date: '2026-01-15', rate: '0.9', source: 'seed', provider: 'test', fetchedAt: 0 },
      ]),
    };
    const [status] = evaluateBudgets(
      [budget('cat-food', 9000, '2026-01', 'EUR')],
      convertTransactions(ctx),
      categories,
      ctx,
      80,
    );
    expect(status!.level).not.toBe('unconverted');
    // 90.00 EUR / 0.9 = 100.00 USD
    expect(status!.budgetAmount).toBe(10000n);
    expect(status!.rate?.rateDate).toBe('2026-01-15');
  });

  it('treats a zero budget with spending as 100% used', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 1000, currency: 'USD', categoryId: 'cat-food' }),
    ]);
    const [status] = evaluateBudgets([budget('cat-food', 0)], convertTransactions(ctx), categories, ctx, 80);
    expect(status!.percent).toBe(100);
  });

  it('handles a category with no spending', () => {
    const ctx = context([]);
    const [status] = evaluateBudgets([budget('cat-rent', 100000)], convertTransactions(ctx), categories, ctx, 80);
    expect(status!.spent).toBe(0n);
    expect(status!.percent).toBe(0);
    expect(status!.level).toBe('under');
  });
});

describe('budgetTotals', () => {
  it('sums budgeted and spent, counting unconverted separately', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 30000, currency: 'USD', categoryId: 'cat-food' }),
      tx({ type: 'expense', amount: 50000, currency: 'USD', categoryId: 'cat-rent' }),
    ]);
    const statuses = evaluateBudgets(
      [budget('cat-food', 50000), budget('cat-rent', 40000)],
      convertTransactions(ctx),
      categories,
      ctx,
      80,
    );
    const totals = budgetTotals(statuses);
    expect(totals.budgeted).toBe(90000n);
    expect(totals.spent).toBe(80000n);
    expect(totals.remaining).toBe(10000n);
    expect(totals.unconverted).toBe(0);
  });

  it('excludes unconverted budgets from the budgeted total', () => {
    const ctx: LedgerContext = { ...context([]), engine: new RateEngine([]) };
    const statuses = evaluateBudgets(
      [budget('cat-food', 50000), budget('cat-rent', 9000, '2026-05', 'EUR')],
      convertTransactions(ctx),
      categories,
      ctx,
      80,
    );
    const totals = budgetTotals(statuses);
    // Only the same-currency budget is countable.
    expect(totals.budgeted).toBe(50000n);
    expect(totals.unconverted).toBe(1);
  });
});

describe('buildAlerts', () => {
  const format = (value: bigint) => (Number(value) / 100).toFixed(2);

  it('produces over-budget and warning alerts', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 60000, currency: 'USD', categoryId: 'cat-food' }),
      tx({ type: 'expense', amount: 42000, currency: 'USD', categoryId: 'cat-rent' }),
    ]);
    const statuses = evaluateBudgets(
      [budget('cat-food', 50000), budget('cat-rent', 50000)],
      convertTransactions(ctx),
      categories,
      ctx,
      80,
    );
    const alerts = buildAlerts(statuses, 'USD', format);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.message).toContain('over budget');
  });

  it('stays quiet when everything is under budget', () => {
    const ctx = context([
      tx({ type: 'expense', amount: 10000, currency: 'USD', categoryId: 'cat-food' }),
    ]);
    const statuses = evaluateBudgets([budget('cat-food', 50000)], convertTransactions(ctx), categories, ctx, 80);
    expect(buildAlerts(statuses, 'USD', format)).toHaveLength(0);
  });

  it('reports an alert for an unconverted budget rather than a fake figure', () => {
    const ctx: LedgerContext = { ...context([]), engine: new RateEngine([]) };
    const statuses = evaluateBudgets(
      [budget('cat-food', 9000, '2026-01', 'EUR')],
      convertTransactions(ctx),
      categories,
      ctx,
      80,
    );
    const alerts = buildAlerts(statuses, 'USD', format);
    expect(alerts[0]!.message).toContain('could not be converted');
  });
});

describe('transactionsInMonth', () => {
  it('returns only transactions within the month', () => {
    const rows = [
      tx({ type: 'expense', amount: 100, currency: 'USD', date: '2026-01-01' }),
      tx({ type: 'expense', amount: 100, currency: 'USD', date: '2026-01-31' }),
      tx({ type: 'expense', amount: 100, currency: 'USD', date: '2026-02-01' }),
    ];
    expect(transactionsInMonth(rows, '2026-01')).toHaveLength(2);
  });
});
