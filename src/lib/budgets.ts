/**
 * Monthly budget evaluation.
 *
 * A budget is stored in its own currency. To compare it against actual
 * spending it is converted into the reporting currency using the rate of the
 * **last day of the budget month** — the value the budget is meant to cover.
 * If that rate cannot be resolved, the budget is reported as unconverted
 * rather than compared against a guessed figure.
 */

import type { BudgetRecord, CategoryRecord, TransactionRecord } from '../db/schema';
import type { ResolvedRate } from './fx';
import { monthRange } from './dates';
import type { ConvertedTransaction, LedgerContext } from './ledger';
import { convertOnDate } from './ledger';
import type { Minor } from './money';

export type BudgetStatusLevel = 'under' | 'warning' | 'over' | 'unconverted';

export interface BudgetStatus {
  budget: BudgetRecord;
  category: CategoryRecord | undefined;
  /** Budget amount converted into the reporting currency. */
  budgetAmount: Minor | null;
  /** Actual spending in the reporting currency. */
  spent: Minor;
  /** Percentage of the budget used (0–∞). */
  percent: number;
  level: BudgetStatusLevel;
  /** The rate used to convert the budget amount, if any. */
  rate: ResolvedRate | null;
  /** Remaining budget in the reporting currency. */
  remaining: Minor | null;
}

export interface BudgetAlert {
  status: BudgetStatus;
  message: string;
}

/**
 * Convert a budget amount into the reporting currency.
 *
 * A closed month is valued at its last day — the moment the budget was meant to
 * cover. A **current or future** month cannot use its own end date: the rate for
 * a future date does not exist by definition, so every in-progress budget would
 * report as unconvertible. For those months, value at today instead.
 */
export function convertBudgetAmount(
  budget: BudgetRecord,
  ctx: LedgerContext,
): { amount: Minor | null; rate: ResolvedRate | null } {
  const { end } = monthRange(budget.month);
  const valuationDate = end <= ctx.asOfDate ? end : ctx.asOfDate;
  return convertOnDate(
    BigInt(budget.amount),
    budget.currency,
    ctx.reportingCurrency,
    valuationDate,
    ctx,
  );
}

/** Evaluate every budget for a month against actual spending. */
export function evaluateBudgets(
  budgets: BudgetRecord[],
  converted: ConvertedTransaction[],
  categories: Map<string, CategoryRecord>,
  ctx: LedgerContext,
  alertThreshold: number,
): BudgetStatus[] {
  const spendByCategory = new Map<string, Minor>();
  for (const item of converted) {
    if (item.transaction.type !== 'expense') continue;
    if (item.convertedAmount === null) continue;
    const key = item.transaction.categoryId ?? '__none__';
    spendByCategory.set(key, (spendByCategory.get(key) ?? 0n) + item.convertedAmount);
  }

  return budgets.map((budget) => {
    const { amount, rate } = convertBudgetAmount(budget, ctx);
    const spent = spendByCategory.get(budget.categoryId) ?? 0n;

    if (amount === null) {
      return {
        budget,
        category: categories.get(budget.categoryId),
        budgetAmount: null,
        spent,
        percent: 0,
        level: 'unconverted' as const,
        rate: null,
        remaining: null,
      };
    }

    const percent =
      amount === 0n ? (spent > 0n ? 100 : 0) : Number((spent * 10000n) / amount) / 100;

    let level: BudgetStatusLevel = 'under';
    if (spent > amount) level = 'over';
    else if (percent >= alertThreshold) level = 'warning';

    return {
      budget,
      category: categories.get(budget.categoryId),
      budgetAmount: amount,
      spent,
      percent,
      level,
      rate,
      remaining: amount - spent,
    };
  });
}

/** Human readable alerts for budgets that need attention. */
/**
 * Build the alerts shown on the dashboard.
 *
 * `formatAmount` is expected to return a fully formatted amount including its
 * currency (e.g. "$226.26"), so no currency code is appended here.
 */
export function buildAlerts(
  statuses: BudgetStatus[],
  currencyLabel: string,
  formatAmount: (value: Minor) => string,
): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  for (const status of statuses) {
    const name = status.category?.name ?? 'Category';
    if (status.level === 'over') {
      alerts.push({
        status,
        message: `${name} is over budget by ${formatAmount(-(status.remaining ?? 0n))}`,
      });
    } else if (status.level === 'warning') {
      alerts.push({
        status,
        message: `${name} has used ${status.percent.toFixed(0)}% of its budget`,
      });
    } else if (status.level === 'unconverted') {
      alerts.push({
        status,
        message: `${name} budget could not be converted to ${currencyLabel}`,
      });
    }
  }
  return alerts.sort((a, b) => (b.status.percent > a.status.percent ? 1 : -1));
}

/** Total budgeted vs total spent for a set of statuses. */
export function budgetTotals(statuses: BudgetStatus[]): {
  budgeted: Minor;
  spent: Minor;
  remaining: Minor | null;
  unconverted: number;
} {
  let budgeted = 0n;
  let spent = 0n;
  let remaining = 0n;
  let unconverted = 0;
  for (const status of statuses) {
    spent += status.spent;
    if (status.budgetAmount === null) {
      unconverted += 1;
      continue;
    }
    budgeted += status.budgetAmount;
    remaining += status.remaining ?? 0n;
  }
  return { budgeted, spent, remaining, unconverted };
}

/** All transactions inside a month, used by the budget page filters. */
export function transactionsInMonth(
  transactions: TransactionRecord[],
  month: string,
): TransactionRecord[] {
  const { start, end } = monthRange(month);
  return transactions.filter(
    (transaction) => transaction.date >= start && transaction.date <= end,
  );
}
