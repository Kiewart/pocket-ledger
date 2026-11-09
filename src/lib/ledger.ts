/**
 * The ledger engine.
 *
 * Responsibilities:
 *  - Convert transactions into the single user-selected reporting currency
 *    using the historical rate of each transaction's own date.
 *  - Compute account balances in each account's own currency, from an
 *    explicit opening balance plus every leg of every transaction.
 *  - Compute *cash flow* (income − expense) separately from *balance*, and
 *    exclude transfers from cash flow so a transfer between two of the user's
 *    own accounts is never counted as income or as an expense.
 *
 * Nothing here mutates the original amount or currency of a transaction.
 */

import type {
  AccountRecord,
  CurrencyRecord,
  TransactionRecord,
} from '../db/schema';
import { RateEngine, type ResolvedRate } from './fx';
import { RATE_SCALE, type Minor } from './money';
import { convertMinorWithRate } from './rates';
import { monthKey } from './dates';

export interface LedgerContext {
  transactions: TransactionRecord[];
  accounts: AccountRecord[];
  currencies: Map<string, CurrencyRecord>;
  engine: RateEngine;
  /** The single reporting currency for all converted values. */
  reportingCurrency: string;
  maxStalenessDays: number;
  /** Date used to value current balances. */
  asOfDate: string;
}

export interface ConvertedTransaction {
  transaction: TransactionRecord;
  /** Amount converted into the reporting currency (absolute value). */
  convertedAmount: Minor | null;
  /** Signed cash-flow impact in the reporting currency. Zero for transfers. */
  signedConverted: Minor;
  /** True when a carried-forward (older) rate was used. */
  approximate: boolean;
  /** The rate used for the reporting-currency conversion. */
  rate: ResolvedRate | null;
  /** The transaction's own currency, untouched. */
  originalAmount: Minor;
}

export interface AccountLeg {
  accountId: string;
  delta: Minor | null;
  approximate: boolean;
}

export interface AccountBalance {
  account: AccountRecord;
  /** Opening balance in the account's native currency. */
  openingBalance: Minor;
  /** Sum of every leg in the account's native currency. */
  movement: Minor;
  /** opening + movement, in the account's native currency. */
  balance: Minor;
  /** Balance converted into the reporting currency at the as-of date. */
  convertedBalance: Minor | null;
  /** True when the balance conversion used a carried-forward rate. */
  approximate: boolean;
  /** Number of legs that could not be converted (missing rate). */
  unconvertedLegs: number;
  rate: ResolvedRate | null;
}

export interface CashFlowSummary {
  income: Minor;
  expense: Minor;
  net: Minor;
  /** Transactions excluded because no historical rate could be resolved. */
  unconvertedCount: number;
  /** Transactions that used a carried-forward rate. */
  approximateCount: number;
}

export interface CategoryTotal {
  categoryId: string | undefined;
  name: string;
  color: string;
  icon: string;
  total: Minor;
  count: number;
  share: number;
}

export interface MonthlyPoint {
  key: string;
  income: Minor;
  expense: Minor;
  net: Minor;
}

function signFor(type: TransactionRecord['type']): 1 | -1 | 0 {
  if (type === 'income') return 1;
  if (type === 'expense') return -1;
  return 0;
}

/** Look up a currency's decimal exponent, defaulting to 2 for unknown codes. */
export function exponentOf(currencies: Map<string, CurrencyRecord>, code: string): number {
  return currencies.get(code)?.exponent ?? 2;
}

/**
 * Convert a minor amount between two currencies using the rate that applies on
 * `date`. Returns null when no acceptable rate exists — the caller must then
 * report the amount as unconverted rather than guessing.
 */
export function convertOnDate(
  amount: Minor,
  from: string,
  to: string,
  date: string,
  ctx: LedgerContext,
): { amount: Minor | null; rate: ResolvedRate | null } {
  if (from === to) {
    return {
      amount: amount,
      rate: {
        from,
        to,
        rate: RATE_SCALE,
        kind: 'identity',
        requestedDate: date,
        rateDate: date,
        daysStale: 0,
        source: 'manual',
        provider: 'identity',
      },
    };
  }
  const rate = ctx.engine.resolve(from, to, date, {
    maxStalenessDays: ctx.maxStalenessDays,
  });
  if (!rate) return { amount: null, rate: null };
  const fromExp = exponentOf(ctx.currencies, from);
  const toExp = exponentOf(ctx.currencies, to);
  return {
    amount: convertMinorWithRate(amount, fromExp, toExp, rate.rate),
    rate,
  };
}

/** Convert every transaction into the reporting currency. */
export function convertTransactions(ctx: LedgerContext): ConvertedTransaction[] {
  return ctx.transactions.map((transaction) => {
    const originalAmount = BigInt(transaction.amount);
    const { amount, rate } = convertOnDate(
      originalAmount,
      transaction.currency,
      ctx.reportingCurrency,
      transaction.date,
      ctx,
    );
    const sign = signFor(transaction.type);
    return {
      transaction,
      convertedAmount: amount,
      signedConverted: amount === null ? 0n : amount * BigInt(sign),
      approximate: rate?.kind === 'stale',
      rate,
      originalAmount,
    };
  });
}

/**
 * Build the legs each transaction creates against accounts.
 * Income and expense touch one account. A transfer moves money between two.
 */
export function buildLegs(ctx: LedgerContext): Map<string, AccountLeg[]> {
  const legs = new Map<string, AccountLeg[]>();
  const push = (accountId: string, leg: AccountLeg) => {
    const list = legs.get(accountId) ?? [];
    list.push(leg);
    legs.set(accountId, list);
  };

  for (const transaction of ctx.transactions) {
    const original = BigInt(transaction.amount);
    const sign = signFor(transaction.type);

    if (transaction.type === 'transfer') {
      // Outflow from the source account.
      const source = convertOnDate(
        original,
        transaction.currency,
        accountCurrency(ctx, transaction.accountId),
        transaction.date,
        ctx,
      );
      push(transaction.accountId, {
        accountId: transaction.accountId,
        delta: source.amount === null ? null : -source.amount,
        approximate: source.rate?.kind === 'stale',
      });

      // Inflow into the destination account (the same money, converted into
      // the destination currency) — this is the leg that prevents a transfer
      // from being double counted.
      if (transaction.toAccountId) {
        const destination = convertOnDate(
          original,
          transaction.currency,
          accountCurrency(ctx, transaction.toAccountId),
          transaction.date,
          ctx,
        );
        push(transaction.toAccountId, {
          accountId: transaction.toAccountId,
          delta: destination.amount,
          approximate: destination.rate?.kind === 'stale',
        });
      }
      continue;
    }

    const converted = convertOnDate(
      original,
      transaction.currency,
      accountCurrency(ctx, transaction.accountId),
      transaction.date,
      ctx,
    );
    push(transaction.accountId, {
      accountId: transaction.accountId,
      delta: converted.amount === null ? null : converted.amount * BigInt(sign),
      approximate: converted.rate?.kind === 'stale',
    });
  }

  return legs;
}

function accountCurrency(ctx: LedgerContext, accountId: string): string {
  return ctx.accounts.find((account) => account.id === accountId)?.currency ?? ctx.reportingCurrency;
}

/** Compute the balance of every account in its own native currency. */
export function accountBalances(ctx: LedgerContext): AccountBalance[] {
  const legs = buildLegs(ctx);

  return ctx.accounts.map((account) => {
    const accountLegs = legs.get(account.id) ?? [];
    let movement = 0n;
    let unconvertedLegs = 0;
    for (const leg of accountLegs) {
      if (leg.delta === null) {
        unconvertedLegs += 1;
        continue;
      }
      movement += leg.delta;
    }
    const opening = BigInt(account.openingBalance);
    const balance = opening + movement;

    const { amount, rate } = convertOnDate(
      balance,
      account.currency,
      ctx.reportingCurrency,
      ctx.asOfDate,
      ctx,
    );

    return {
      account,
      openingBalance: opening,
      movement,
      balance,
      convertedBalance: amount,
      approximate: rate?.kind === 'stale',
      unconvertedLegs,
      rate,
    };
  });
}

/** Total portfolio value in the reporting currency. */
export function portfolioValue(balances: AccountBalance[]): {
  total: Minor;
  convertedCount: number;
  unconvertedCount: number;
  approximate: boolean;
} {
  let total = 0n;
  let convertedCount = 0;
  let unconvertedCount = 0;
  let approximate = false;
  for (const balance of balances) {
    if (!balance.account.includeInTotal) continue;
    if (balance.convertedBalance === null) {
      unconvertedCount += 1;
      continue;
    }
    total += balance.convertedBalance;
    convertedCount += 1;
    approximate = approximate || balance.approximate;
  }
  return { total, convertedCount, unconvertedCount, approximate };
}

/** Cash flow summary for a set of already-converted transactions. */
export function summariseCashFlow(converted: ConvertedTransaction[]): CashFlowSummary {
  let income = 0n;
  let expense = 0n;
  let unconvertedCount = 0;
  let approximateCount = 0;

  for (const item of converted) {
    if (item.transaction.type === 'transfer') continue;
    if (item.convertedAmount === null) {
      unconvertedCount += 1;
      continue;
    }
    if (item.approximate) approximateCount += 1;
    if (item.transaction.type === 'income') income += item.convertedAmount;
    else expense += item.convertedAmount;
  }

  return {
    income,
    expense,
    net: income - expense,
    unconvertedCount,
    approximateCount,
  };
}

/** Group converted transactions by month key. */
export function monthlySeries(converted: ConvertedTransaction[]): MonthlyPoint[] {
  const buckets = new Map<string, { income: Minor; expense: Minor }>();
  for (const item of converted) {
    if (item.transaction.type === 'transfer') continue;
    if (item.convertedAmount === null) continue;
    const key = monthKey(item.transaction.date);
    const bucket = buckets.get(key) ?? { income: 0n, expense: 0n };
    if (item.transaction.type === 'income') bucket.income += item.convertedAmount;
    else bucket.expense += item.convertedAmount;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => ({
      key,
      income: value.income,
      expense: value.expense,
      net: value.income - value.expense,
    }));
}

/** Group converted transactions by category for one kind (income/expense). */
export function categoryTotals(
  converted: ConvertedTransaction[],
  kind: 'income' | 'expense',
  categories: Map<string, { name: string; color: string; icon: string }>,
): CategoryTotal[] {
  const buckets = new Map<string, { total: Minor; count: number }>();
  let grandTotal = 0n;

  for (const item of converted) {
    if (item.transaction.type !== kind) continue;
    if (item.convertedAmount === null) continue;
    const key = item.transaction.categoryId ?? '__uncategorised__';
    const bucket = buckets.get(key) ?? { total: 0n, count: 0 };
    bucket.total += item.convertedAmount;
    bucket.count += 1;
    buckets.set(key, bucket);
    grandTotal += item.convertedAmount;
  }

  const totals: CategoryTotal[] = [];
  for (const [categoryId, bucket] of buckets) {
    const meta =
      categoryId === '__uncategorised__'
        ? { name: 'Uncategorised', color: '#94a3b8', icon: 'HelpCircle' }
        : categories.get(categoryId) ?? {
            name: 'Unknown category',
            color: '#94a3b8',
            icon: 'HelpCircle',
          };
    totals.push({
      categoryId: categoryId === '__uncategorised__' ? undefined : categoryId,
      name: meta.name,
      color: meta.color,
      icon: meta.icon,
      total: bucket.total,
      count: bucket.count,
      share: grandTotal === 0n ? 0 : Number((bucket.total * 10000n) / grandTotal) / 100,
    });
  }

  return totals.sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

/** Group converted transactions by account (converted into reporting currency). */
export function accountTotals(
  converted: ConvertedTransaction[],
  accounts: Map<string, AccountRecord>,
): { accountId: string; name: string; income: Minor; expense: Minor; net: Minor }[] {
  const buckets = new Map<string, { income: Minor; expense: Minor }>();
  for (const item of converted) {
    if (item.transaction.type === 'transfer') continue;
    if (item.convertedAmount === null) continue;
    const bucket = buckets.get(item.transaction.accountId) ?? { income: 0n, expense: 0n };
    if (item.transaction.type === 'income') bucket.income += item.convertedAmount;
    else bucket.expense += item.convertedAmount;
    buckets.set(item.transaction.accountId, bucket);
  }
  return [...buckets.entries()].map(([accountId, value]) => ({
    accountId,
    name: accounts.get(accountId)?.name ?? 'Unknown account',
    income: value.income,
    expense: value.expense,
    net: value.income - value.expense,
  }));
}
