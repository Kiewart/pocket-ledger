import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { bootstrap, DEFAULT_SETTINGS, seedBundledRates } from '../db/seed';
import type {
  AccountRecord,
  BudgetRecord,
  CategoryRecord,
  CurrencyRecord,
  RateRecord,
  SettingsRecord,
  TransactionRecord,
} from '../db/schema';
import { RateEngine } from '../lib/fx';
import { formatMoney, type Minor } from '../lib/money';
import {
  accountBalances,
  convertTransactions,
  portfolioValue,
  type AccountBalance,
  type ConvertedTransaction,
  type LedgerContext,
} from '../lib/ledger';
import { todayISO } from '../lib/dates';
import { normaliseTransaction, registerExponentLookup } from '../lib/transactions';

export interface AppState {
  ready: boolean;
  settings: SettingsRecord;
  currencies: CurrencyRecord[];
  currencyMap: Map<string, CurrencyRecord>;
  categories: CategoryRecord[];
  categoryMap: Map<string, CategoryRecord>;
  accounts: AccountRecord[];
  accountMap: Map<string, AccountRecord>;
  transactions: TransactionRecord[];
  budgets: BudgetRecord[];
  rates: RateRecord[];
  engine: RateEngine;
  ledger: LedgerContext;
  converted: ConvertedTransaction[];
  balances: AccountBalance[];
  portfolio: ReturnType<typeof portfolioValue>;
  reportingCurrency: CurrencyRecord | undefined;
  /** Format an amount in the reporting currency. */
  formatReporting: (minor: Minor, options?: { showSign?: boolean }) => string;
  /** Format an amount in a specific currency. */
  formatIn: (minor: Minor, code: string, options?: { showSign?: boolean }) => string;
  /** Convert an amount between currencies at a given date. */
  convertOnDate: (minor: Minor, from: string, to: string, date: string) => Minor | null;
  updateSettings: (patch: Partial<SettingsRecord>) => Promise<void>;
  saveTransaction: (record: TransactionRecord) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  saveAccount: (record: AccountRecord) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  saveCategory: (record: CategoryRecord) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  saveBudget: (record: BudgetRecord) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  createTransaction: (
    input: Parameters<typeof normaliseTransaction>[0],
    amountMinor: bigint,
  ) => Promise<void>;
}

// Stable empty references shared by every render before live data arrives.
const EMPTY_CURRENCIES: CurrencyRecord[] = [];
const EMPTY_CATEGORIES: CategoryRecord[] = [];
const EMPTY_ACCOUNTS: AccountRecord[] = [];
const EMPTY_TRANSACTIONS: TransactionRecord[] = [];
const EMPTY_BUDGETS: BudgetRecord[] = [];
const EMPTY_RATES: RateRecord[] = [];

// A single stable settings object for the very first render, before the live
// query resolves. Recreating this literal every render would invalidate the
// ledger memo below.
const FALLBACK_SETTINGS: SettingsRecord = { ...DEFAULT_SETTINGS, updatedAt: 0 };

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const bootstrapped = useRef(false);

  const settingsRow = useLiveQuery(() => db.settings.get('app'), []);
  // `useLiveQuery` returns `undefined` on its first render. Falling back to a
  // fresh `[]` literal would create a new reference every render, invalidating
  // every downstream memo and recomputing the whole ledger on each paint, so
  // use a single frozen empty array instead.
  const currencies = useLiveQuery(() => db.currencies.toArray(), []) ?? EMPTY_CURRENCIES;
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? EMPTY_CATEGORIES;
  const accounts = useLiveQuery(() => db.accounts.toArray(), []) ?? EMPTY_ACCOUNTS;
  const transactions = useLiveQuery(() => db.transactions.toArray(), []) ?? EMPTY_TRANSACTIONS;
  const budgets = useLiveQuery(() => db.budgets.toArray(), []) ?? EMPTY_BUDGETS;
  const rates = useLiveQuery(() => db.rates.toArray(), []) ?? EMPTY_RATES;

  const settings = settingsRow ?? FALLBACK_SETTINGS;

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      try {
        await bootstrap({ loadSampleOnFirstRun: true });
        // Always reconcile the bundled history. `seedBundledRates` only inserts
        // rows that are absent, so this backfills datasets added in a later
        // release for users who already have a populated database, while
        // leaving manual overrides untouched.
        try {
          await seedBundledRates();
        } catch {
          // A missing bundled dataset must never block the app from starting.
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const currencyMap = useMemo(
    () => new Map(currencies.map((currency) => [currency.code, currency])),
    [currencies],
  );
  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  useEffect(() => {
    registerExponentLookup((code) => currencyMap.get(code)?.exponent ?? 2);
  }, [currencyMap]);

  const engine = useMemo(() => new RateEngine(rates), [rates]);

  const ledger = useMemo<LedgerContext>(() => {
    return {
      transactions,
      accounts,
      currencies: currencyMap,
      engine,
      reportingCurrency: settings.defaultCurrency,
      maxStalenessDays: settings.rateMaxStalenessDays,
      asOfDate: todayISO(),
    };
  }, [transactions, accounts, currencyMap, engine, settings.defaultCurrency, settings.rateMaxStalenessDays]);

  const converted = useMemo(() => convertTransactions(ledger), [ledger]);
  const balances = useMemo(() => accountBalances(ledger), [ledger]);
  const portfolio = useMemo(() => portfolioValue(balances), [balances]);

  const reportingCurrency = currencyMap.get(settings.defaultCurrency);

  const formatReporting = useCallback(
    (minor: Minor, options?: { showSign?: boolean }) =>
      formatMoney(minor, {
        exponent: reportingCurrency?.exponent ?? 2,
        currency: settings.defaultCurrency,
        locale: settings.locale,
        showSign: options?.showSign,
      }),
    [reportingCurrency, settings.defaultCurrency, settings.locale],
  );

  const formatIn = useCallback(
    (minor: Minor, code: string, options?: { showSign?: boolean }) => {
      const currency = currencyMap.get(code);
      return formatMoney(minor, {
        exponent: currency?.exponent ?? 2,
        currency: code,
        locale: settings.locale,
        showSign: options?.showSign,
      });
    },
    [currencyMap, settings.locale],
  );

  const convertOnDate = useCallback(
    (minor: Minor, from: string, to: string, date: string): Minor | null => {
      if (from === to) return minor;
      const rate = engine.resolve(from, to, date, {
        maxStalenessDays: settings.rateMaxStalenessDays,
      });
      if (!rate) return null;
      const fromExp = currencyMap.get(from)?.exponent ?? 2;
      const toExp = currencyMap.get(to)?.exponent ?? 2;
      const numerator = minor * rate.rate * 10n ** BigInt(toExp);
      const denominator = 10n ** 12n * 10n ** BigInt(fromExp);
      const negative = numerator < 0n !== denominator < 0n;
      const absNumerator = numerator < 0n ? -numerator : numerator;
      const quotient = absNumerator / denominator;
      const remainder = absNumerator % denominator;
      const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
      return negative ? -rounded : rounded;
    },
    [engine, settings.rateMaxStalenessDays, currencyMap],
  );

  const updateSettings = useCallback(async (patch: Partial<SettingsRecord>) => {
    const current = (await db.settings.get('app')) ?? {
      ...DEFAULT_SETTINGS,
      updatedAt: Date.now(),
    };
    await db.settings.put({ ...current, ...patch, id: 'app', updatedAt: Date.now() });
  }, []);

  const saveTransaction = useCallback(async (record: TransactionRecord) => {
    await db.transactions.put(record);
  }, []);

  const deleteTransaction = useCallback(async (id: string) => {
    await db.transactions.delete(id);
  }, []);

  const createTransaction = useCallback(
    async (input: Parameters<typeof normaliseTransaction>[0], amountMinor: bigint) => {
      const record = normaliseTransaction(input, amountMinor);
      await db.transactions.put(record);
    },
    [],
  );

  const saveAccount = useCallback(async (record: AccountRecord) => {
    await db.accounts.put(record);
  }, []);

  const deleteAccount = useCallback(async (id: string) => {
    await db.accounts.delete(id);
  }, []);

  const saveCategory = useCallback(async (record: CategoryRecord) => {
    await db.categories.put(record);
  }, []);

  const deleteCategory = useCallback(async (id: string) => {
    await db.categories.delete(id);
  }, []);

  const saveBudget = useCallback(async (record: BudgetRecord) => {
    await db.budgets.put(record);
  }, []);

  const deleteBudget = useCallback(async (id: string) => {
    await db.budgets.delete(id);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      settings,
      currencies,
      currencyMap,
      categories,
      categoryMap,
      accounts,
      accountMap,
      transactions,
      budgets,
      rates,
      engine,
      ledger,
      converted,
      balances,
      portfolio,
      reportingCurrency,
      formatReporting,
      formatIn,
      convertOnDate,
      updateSettings,
      saveTransaction,
      deleteTransaction,
      createTransaction,
      saveAccount,
      deleteAccount,
      saveCategory,
      deleteCategory,
      saveBudget,
      deleteBudget,
    }),
    [
      ready,
      settings,
      currencies,
      currencyMap,
      categories,
      categoryMap,
      accounts,
      accountMap,
      transactions,
      budgets,
      rates,
      engine,
      ledger,
      converted,
      balances,
      portfolio,
      reportingCurrency,
      formatReporting,
      formatIn,
      convertOnDate,
      updateSettings,
      saveTransaction,
      deleteTransaction,
      createTransaction,
      saveAccount,
      deleteAccount,
      saveCategory,
      deleteCategory,
      saveBudget,
      deleteBudget,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside <AppProvider>');
  return context;
}
