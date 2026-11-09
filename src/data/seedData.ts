/**
 * Default categories, starter accounts and a deterministic demo dataset.
 *
 * The demo dataset is clearly-labelled sample data that the user can wipe at
 * any time from Settings → Data. It exists so the app is explorable on first
 * launch, and it uses only currencies covered by the bundled real rate
 * history.
 */

import type { AccountRecord, CategoryRecord, TransactionRecord } from '../db/schema';
import { addMonthsToKey, currentMonthKey, daysInMonth, todayISO } from '../lib/dates';

export const DEFAULT_CATEGORIES: Omit<CategoryRecord, 'createdAt'>[] = [
  { id: 'cat-salary', name: 'Salary', kind: 'income', icon: 'Banknote', color: '#10b981', archived: false },
  { id: 'cat-freelance', name: 'Freelance', kind: 'income', icon: 'Briefcase', color: '#14b8a6', archived: false },
  { id: 'cat-investments', name: 'Investments', kind: 'income', icon: 'TrendingUp', color: '#22c55e', archived: false },
  { id: 'cat-returns', name: 'Refunds & Returns', kind: 'income', icon: 'Undo2', color: '#84cc16', archived: false },
  { id: 'cat-housing', name: 'Rent & Housing', kind: 'expense', icon: 'Home', color: '#6366f1', archived: false },
  { id: 'cat-groceries', name: 'Groceries', kind: 'expense', icon: 'ShoppingCart', color: '#f59e0b', archived: false },
  { id: 'cat-dining', name: 'Dining Out', kind: 'expense', icon: 'UtensilsCrossed', color: '#f97316', archived: false },
  { id: 'cat-coffee', name: 'Coffee', kind: 'expense', icon: 'Coffee', color: '#a16207', archived: false },
  { id: 'cat-transport', name: 'Transport', kind: 'expense', icon: 'Car', color: '#0ea5e9', archived: false },
  { id: 'cat-utilities', name: 'Utilities', kind: 'expense', icon: 'Zap', color: '#eab308', archived: false },
  { id: 'cat-subscriptions', name: 'Subscriptions', kind: 'expense', icon: 'Repeat', color: '#8b5cf6', archived: false },
  { id: 'cat-health', name: 'Health', kind: 'expense', icon: 'HeartPulse', color: '#ef4444', archived: false },
  { id: 'cat-shopping', name: 'Shopping', kind: 'expense', icon: 'ShoppingBag', color: '#ec4899', archived: false },
  { id: 'cat-entertainment', name: 'Entertainment', kind: 'expense', icon: 'Film', color: '#d946ef', archived: false },
  { id: 'cat-travel', name: 'Travel', kind: 'expense', icon: 'Plane', color: '#06b6d4', archived: false },
  { id: 'cat-education', name: 'Education', kind: 'expense', icon: 'GraduationCap', color: '#3b82f6', archived: false },
  { id: 'cat-transfer', name: 'Transfer', kind: 'expense', icon: 'ArrowLeftRight', color: '#64748b', archived: false },
];

export const DEFAULT_ACCOUNTS: Omit<AccountRecord, 'createdAt'>[] = [
  {
    id: 'acc-checking',
    name: 'Everyday Checking',
    currency: 'USD',
    type: 'checking',
    openingBalance: 420000,
    includeInTotal: true,
    archived: false,
  },
  {
    id: 'acc-cash',
    name: 'Cash Wallet',
    currency: 'USD',
    type: 'cash',
    openingBalance: 21000,
    includeInTotal: true,
    archived: false,
  },
  {
    id: 'acc-savings',
    name: 'Savings Account',
    currency: 'USD',
    type: 'savings',
    openingBalance: 840000,
    includeInTotal: true,
    archived: false,
  },
  {
    id: 'acc-euro',
    name: 'Euro Travel',
    currency: 'EUR',
    type: 'checking',
    openingBalance: 45000,
    includeInTotal: true,
    archived: false,
  },
  {
    id: 'acc-gyd',
    name: 'Georgetown Checking',
    currency: 'GYD',
    type: 'checking',
    // G$620,000 ≈ US$2,960 at ~209 GYD/USD.
    openingBalance: 62000000,
    includeInTotal: true,
    archived: false,
  },
];

/** Deterministic PRNG so the demo dataset is identical on every install. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build a date inside `year/month`, clamped to the month's length **and** to
 * today.
 *
 * Clamping to today matters: sample data generated for the current month used
 * to produce dates later in the month than the current day (for example
 * 2026-11-27 while "today" was 2026-11-07). Those future-dated rows can never
 * have a historical rate, so they showed up permanently as "unconverted" and
 * made a correct engine look broken.
 */
function dayOf(year: number, month: number, day: number): string {
  const monthText = String(month).padStart(2, '0');
  const maxDay = daysInMonth(`${year}-${monthText}`);
  const clamped = Math.min(Math.max(1, Math.round(day)), maxDay);
  const candidate = `${year}-${monthText}-${String(clamped).padStart(2, '0')}`;
  const today = todayISO();
  return candidate > today ? today : candidate;
}

export interface DemoBundle {
  transactions: TransactionRecord[];
  budgets: { categoryId: string; month: string; amount: number; currency: string }[];
}

/**
 * Builds a realistic 14-month demo dataset in USD, EUR, JPY and GBP so the
 * currency engine, budgets, reports and charts all have something to show.
 */
export function buildDemoData(startMonth: string, endMonth: string): DemoBundle {
  const random = mulberry32(20260907);
  const transactions: TransactionRecord[] = [];
  const budgets: DemoBundle['budgets'] = [];
  let counter = 0;

  const push = (record: Omit<TransactionRecord, 'id' | 'createdAt' | 'updatedAt' | 'tags'>) => {
    const timestamp = Date.parse(`${record.date}T12:00:00Z`);
    counter += 1;
    transactions.push({
      ...record,
      id: `demo-${String(counter).padStart(4, '0')}`,
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  };

  const monthKeys: string[] = [];
  let cursor = startMonth;
  let guard = 0;
  while (cursor <= endMonth && guard < 60) {
    monthKeys.push(cursor);
    cursor = addMonthsToKey(cursor, 1);
    guard++;
  }

  for (const key of monthKeys) {
    const [year, month] = key.split('-').map(Number);
    const yearNum = year!;
    const monthNum = month!;

    // --- Income ---------------------------------------------------------
    push({
      type: 'income',
      amount: Math.round(between(random, 5150, 5320) * 100),
      currency: 'USD',
      accountId: 'acc-checking',
      categoryId: 'cat-salary',
      date: dayOf(yearNum, monthNum, 5),
      payee: 'Northwind Analytics',
      description: 'Monthly salary',
      status: 'cleared',
    });

    if (monthNum % 3 === 1) {
      push({
        type: 'income',
        amount: Math.round(between(random, 900, 1650) * 100),
        currency: 'EUR',
        accountId: 'acc-euro',
        categoryId: 'cat-freelance',
        date: dayOf(yearNum, monthNum, 18),
        payee: 'Lumen Studio',
        description: 'Consulting invoice',
        status: 'cleared',
      });
    }

    if (monthNum % 6 === 4) {
      push({
        type: 'income',
        amount: Math.round(between(random, 180, 640) * 100),
        currency: 'USD',
        accountId: 'acc-checking',
        categoryId: 'cat-investments',
        date: dayOf(yearNum, monthNum, 21),
        payee: 'Vanguard',
        description: 'Dividend payout',
        status: 'cleared',
      });
    }

    // --- Fixed costs ----------------------------------------------------
    push({
      type: 'expense',
      amount: 185000,
      currency: 'USD',
      accountId: 'acc-checking',
      categoryId: 'cat-housing',
      date: dayOf(yearNum, monthNum, 1),
      payee: 'Harbourview Properties',
      description: 'Monthly rent',
      status: 'cleared',
    });

    push({
      type: 'expense',
      amount: Math.round(between(random, 78, 165) * 100),
      currency: 'USD',
      accountId: 'acc-checking',
      categoryId: 'cat-utilities',
      date: dayOf(yearNum, monthNum, 12),
      payee: 'City Energy',
      description: 'Electricity & water',
      status: 'cleared',
    });

    push({
      type: 'expense',
      amount: 7499,
      currency: 'USD',
      accountId: 'acc-checking',
      categoryId: 'cat-utilities',
      date: dayOf(yearNum, monthNum, 8),
      payee: 'Fiberline Internet',
      description: 'Broadband',
      status: 'cleared',
    });

    // --- Subscriptions --------------------------------------------------
    push({
      type: 'expense',
      amount: 1499,
      currency: 'USD',
      accountId: 'acc-checking',
      categoryId: 'cat-subscriptions',
      date: dayOf(yearNum, monthNum, 3),
      payee: 'Streamwave',
      description: 'Video subscription',
      status: 'cleared',
    });

    push({
      type: 'expense',
      amount: 1099,
      currency: 'USD',
      accountId: 'acc-checking',
      categoryId: 'cat-subscriptions',
      date: dayOf(yearNum, monthNum, 9),
      payee: 'TuneStack',
      description: 'Music subscription',
      status: 'cleared',
    });

    push({
      type: 'expense',
      amount: 1299,
      currency: 'USD',
      accountId: 'acc-checking',
      categoryId: 'cat-subscriptions',
      date: dayOf(yearNum, monthNum, 15),
      payee: 'Cloudline Storage',
      description: 'Cloud storage',
      status: 'cleared',
    });

    // --- Variable spending ----------------------------------------------
    const groceryRuns = 5 + Math.floor(random() * 4);
    for (let i = 0; i < groceryRuns; i += 1) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 28, 168) * 100),
        currency: 'USD',
        accountId: random() > 0.25 ? 'acc-checking' : 'acc-cash',
        categoryId: 'cat-groceries',
        date: dayOf(yearNum, monthNum, 2 + Math.floor(random() * 26)),
        payee: pick(random, ['Greenfield Market', 'Corner Grocer', 'Wholesale Club', 'Naturia Foods']),
        description: 'Groceries',
        status: 'cleared',
      });
    }

    const diningRuns = 4 + Math.floor(random() * 7);
    for (let i = 0; i < diningRuns; i += 1) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 14, 96) * 100),
        currency: 'USD',
        accountId: random() > 0.4 ? 'acc-checking' : 'acc-cash',
        categoryId: 'cat-dining',
        date: dayOf(yearNum, monthNum, 1 + Math.floor(random() * 27)),
        payee: pick(random, ['Bella Cucina', 'Sushi Nine', 'The Grill Room', 'Pasta Verde', 'Noodle Bar']),
        description: 'Dining out',
        status: 'cleared',
      });
    }

    const coffeeRuns = 7 + Math.floor(random() * 8);
    for (let i = 0; i < coffeeRuns; i += 1) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 3.75, 9.5) * 100),
        currency: 'USD',
        accountId: 'acc-cash',
        categoryId: 'cat-coffee',
        date: dayOf(yearNum, monthNum, 1 + Math.floor(random() * 27)),
        payee: pick(random, ['Bean & Leaf', 'Roastery Nine', 'Daily Grind']),
        description: 'Coffee',
        status: 'cleared',
      });
    }

    const transportRuns = 2 + Math.floor(random() * 4);
    for (let i = 0; i < transportRuns; i += 1) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 2.75, 64) * 100),
        currency: 'USD',
        accountId: 'acc-cash',
        categoryId: 'cat-transport',
        date: dayOf(yearNum, monthNum, 1 + Math.floor(random() * 27)),
        payee: pick(random, ['Metro Transit', 'Rideshare Co', 'City Parking', 'Rail Europe']),
        description: 'Transport',
        status: 'cleared',
      });
    }

    const shoppingRuns = 2 + Math.floor(random() * 4);
    for (let i = 0; i < shoppingRuns; i += 1) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 22, 235) * 100),
        currency: 'USD',
        accountId: 'acc-checking',
        categoryId: 'cat-shopping',
        date: dayOf(yearNum, monthNum, 1 + Math.floor(random() * 27)),
        payee: pick(random, ['Northline Outfitters', 'Volt Electronics', 'Home & Co', 'Paper Route Books']),
        description: 'Shopping',
        status: 'cleared',
      });
    }

    if (random() > 0.35) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 25, 190) * 100),
        currency: 'USD',
        accountId: 'acc-checking',
        categoryId: 'cat-health',
        date: dayOf(yearNum, monthNum, 6 + Math.floor(random() * 20)),
        payee: pick(random, ['Lakeside Pharmacy', 'Bright Dental', 'FitLife Clinic']),
        description: 'Health',
        status: 'cleared',
      });
    }

    if (random() > 0.45) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 14, 78) * 100),
        currency: 'USD',
        accountId: 'acc-checking',
        categoryId: 'cat-entertainment',
        date: dayOf(yearNum, monthNum, 4 + Math.floor(random() * 22)),
        payee: pick(random, ['Cineplex Nine', 'Arcade Hall', 'Theatre Royal']),
        description: 'Entertainment',
        status: 'cleared',
      });
    }

    if (monthNum % 4 === 3) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 60, 240) * 100),
        currency: 'USD',
        accountId: 'acc-checking',
        categoryId: 'cat-education',
        date: dayOf(yearNum, monthNum, 16),
        payee: 'Online Academy',
        description: 'Course',
        status: 'cleared',
      });
    }

    // --- Transfers ------------------------------------------------------
    // Same-currency transfer: must not count as income or expense.
    push({
      type: 'transfer',
      amount: 50000,
      currency: 'USD',
      accountId: 'acc-checking',
      toAccountId: 'acc-savings',
      categoryId: 'cat-transfer',
      date: dayOf(yearNum, monthNum, 6),
      description: 'Monthly savings',
      status: 'cleared',
    });

    // Cross-currency transfer, every other month. Converted at the
    // transaction date rate, which is exactly what the engine is for.
    if (monthNum % 2 === 0) {
      push({
        type: 'transfer',
        amount: Math.round(between(random, 180, 380) * 100),
        currency: 'USD',
        accountId: 'acc-checking',
        toAccountId: 'acc-euro',
        categoryId: 'cat-transfer',
        date: dayOf(yearNum, monthNum, 10),
        description: 'Top up euro wallet',
        status: 'cleared',
      });
    }

    // Guyana-based spending, funded by a transfer from the USD account. The
    // transfer is converted at the transaction-date rate, so the GYD balance
    // grows from real cross-currency legs rather than a hand-kept number.
    if (monthNum % 2 === 1) {
      push({
        type: 'transfer',
        amount: Math.round(between(random, 120, 240) * 100),
        currency: 'USD',
        accountId: 'acc-checking',
        toAccountId: 'acc-gyd',
        categoryId: 'cat-transfer',
        date: dayOf(yearNum, monthNum, 4),
        description: 'Transfer to Georgetown account',
        status: 'cleared',
      });
    }

    const gydRuns = 2 + Math.floor(random() * 3);
    for (let i = 0; i < gydRuns; i += 1) {
      push({
        type: 'expense',
        amount: Math.round(between(random, 2400, 18500) * 100),
        currency: 'GYD',
        accountId: 'acc-gyd',
        categoryId: pick(random, ['cat-groceries', 'cat-dining', 'cat-transport', 'cat-shopping']),
        date: dayOf(yearNum, monthNum, 3 + Math.floor(random() * 24)),
        payee: pick(random, [
          'Stabroek Market',
          'Guyanese Delight',
          'Regent Street Grocers',
          'Bourda Taxi Service',
          'Giftland',
        ]),
        description: 'Local spending',
        status: 'cleared',
      });
    }

    // Cash top-up. Sized to cover the month's cash spending (groceries,
    // dining, coffee and transport paid from the wallet) so the cash account
    // stays positive, as a real wallet would.
    push({
      type: 'transfer',
      amount: 52000,
      currency: 'USD',
      accountId: 'acc-checking',
      toAccountId: 'acc-cash',
      categoryId: 'cat-transfer',
      date: dayOf(yearNum, monthNum, 1),
      description: 'Cash withdrawal',
      status: 'cleared',
    });
  }

  // --- International travel: EUR, JPY and GBP spending ------------------
  push({
    type: 'expense',
    amount: 4250,
    currency: 'EUR',
    accountId: 'acc-euro',
    categoryId: 'cat-travel',
    date: dayOf(2026, 3, 14),
    payee: 'Alpine Rail',
    description: 'Train tickets',
    status: 'cleared',
  });
  push({
    type: 'expense',
    amount: 6890,
    currency: 'EUR',
    accountId: 'acc-euro',
    categoryId: 'cat-dining',
    date: dayOf(2026, 3, 15),
    payee: 'Ristorante Sole',
    description: 'Dinner in Florence',
    status: 'cleared',
  });
  push({
    type: 'expense',
    amount: 118900,
    currency: 'JPY',
    accountId: 'acc-checking',
    categoryId: 'cat-travel',
    date: dayOf(2026, 7, 22),
    payee: 'Tokyo Metro',
    description: 'Transit passes, Tokyo',
    status: 'cleared',
  });
  push({
    type: 'expense',
    amount: 34200,
    currency: 'JPY',
    accountId: 'acc-checking',
    categoryId: 'cat-dining',
    date: dayOf(2026, 7, 23),
    payee: 'Sushi Dai',
    description: 'Dinner, Shibuya',
    status: 'cleared',
  });
  push({
    type: 'expense',
    amount: 15640,
    currency: 'GBP',
    accountId: 'acc-checking',
    categoryId: 'cat-travel',
    date: dayOf(2026, 9, 11),
    payee: 'Thames Clippers',
    description: 'Boat pass, London',
    status: 'cleared',
  });
  push({
    type: 'expense',
    amount: 8850,
    currency: 'GBP',
    accountId: 'acc-checking',
    categoryId: 'cat-shopping',
    date: dayOf(2026, 9, 12),
    payee: 'Camden Market',
    description: 'Shopping, London',
    status: 'cleared',
  });

  // --- Budgets for the last three months --------------------------------
  const budgetPlan: { categoryId: string; amount: number }[] = [
    { categoryId: 'cat-groceries', amount: 52000 },
    { categoryId: 'cat-dining', amount: 32000 },
    { categoryId: 'cat-transport', amount: 18000 },
    { categoryId: 'cat-shopping', amount: 25000 },
    { categoryId: 'cat-coffee', amount: 12000 },
  ];
  for (let i = 2; i >= 0; i -= 1) {
    const key = addMonthsToKey(endMonth, -i);
    for (const plan of budgetPlan) {
      budgets.push({
        categoryId: plan.categoryId,
        month: key,
        amount: plan.amount,
        currency: 'USD',
      });
    }
  }

  transactions.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt;
  });
  return { transactions, budgets };
}

export function demoMonthWindow(): { start: string; end: string } {
  const end = currentMonthKey();
  return { start: addMonthsToKey(end, -13), end };
}

export { round2 };
