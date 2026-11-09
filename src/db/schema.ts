/**
 * Pocket Ledger data model.
 *
 * Every monetary amount is persisted as an integer number of minor units
 * (cents, pence, yen...) so that no value ever passes through a float.
 * Exchange rates are persisted as decimal strings for the same reason.
 */

export type TransactionType = 'income' | 'expense' | 'transfer';
export type AccountType = 'checking' | 'savings' | 'cash' | 'credit' | 'investment';
export type ThemeMode = 'light' | 'dark' | 'system';
export type RateSource = 'manual' | 'api' | 'seed' | 'import';

export interface CurrencyRecord {
  /** ISO 4217 code, e.g. "EUR". Primary key. */
  code: string;
  name: string;
  symbol: string;
  /** Number of decimal digits in the currency's minor unit. */
  exponent: number;
  /** Locale used to format this currency, e.g. "de-DE". */
  locale: string;
  /** Whether the currency can be picked for new transactions. */
  enabled: boolean;
  createdAt: number;
}

export interface CategoryRecord {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  /** Lucide icon name. */
  icon: string;
  /** Hex colour used for charts and badges. */
  color: string;
  archived: boolean;
  createdAt: number;
}

export interface AccountRecord {
  id: string;
  name: string;
  /** Native currency of the account. Balances are held in this currency. */
  currency: string;
  type: AccountType;
  /** Opening balance in minor units of the account's currency. */
  openingBalance: number;
  /** Whether the account is included in the portfolio total. */
  includeInTotal: boolean;
  archived: boolean;
  createdAt: number;
}

export interface TransactionRecord {
  id: string;
  type: TransactionType;
  /** Absolute amount in minor units of `currency`. */
  amount: number;
  /** The currency the money was actually denominated in. Never converted away. */
  currency: string;
  /** Account the money left (source account for transfers). */
  accountId: string;
  /** Destination account, transfers only. */
  toAccountId?: string;
  categoryId?: string;
  /** Transaction date, `YYYY-MM-DD`. The date the FX rate is looked up on. */
  date: string;
  payee?: string;
  description?: string;
  notes?: string;
  tags: string[];
  status: 'cleared' | 'pending';
  createdAt: number;
  updatedAt: number;
}

export interface RateRecord {
  /** `${base}~${quote}~${date}` */
  id: string;
  base: string;
  quote: string;
  /** Date the rate applies to, `YYYY-MM-DD`. */
  date: string;
  /** Decimal string, e.g. "1.0892". Parsed to a scaled bigint at runtime. */
  rate: string;
  source: RateSource;
  /** Provider identifier, e.g. "frankfurter" or "manual". */
  provider: string;
  fetchedAt: number;
  note?: string;
}

export interface BudgetRecord {
  id: string;
  categoryId: string;
  /** Budget month, `YYYY-MM`. */
  month: string;
  /** Amount in minor units of `currency`. */
  amount: number;
  currency: string;
  /** Carry the leftover amount into the following month. */
  rollover: boolean;
  createdAt: number;
}

export interface SettingsRecord {
  id: 'app';
  /** The single reporting currency all converted values are expressed in. */
  defaultCurrency: string;
  theme: ThemeMode;
  /** Locale used for number/date formatting. */
  locale: string;
  /** Date display pattern, e.g. "dd MMM yyyy". */
  dateFormat: string;
  /** 0 = Sunday, 1 = Monday. */
  startOfWeek: 0 | 1;
  rateProvider: 'frankfurter' | 'custom';
  /** Whether historical rates may be fetched from the network. */
  rateApiEnabled: boolean;
  /** Base URL for the `custom` provider. */
  rateApiBaseUrl: string;
  /** Optional API key, stored locally only. */
  rateApiKey: string;
  /** How many days a rate may be carried backwards before it is rejected. */
  rateMaxStalenessDays: number;
  /** Show the converted amount next to the original amount. */
  showConvertedAmounts: boolean;
  /** Hide transactions whose amount is zero. */
  hideZeroAmounts: boolean;
  /** Percentage of a budget that triggers a warning, e.g. 80. */
  budgetAlertThreshold: number;
  onboardingComplete: boolean;
  updatedAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

/** Bump when the persisted shape changes in a way the app must understand. */
export const SCHEMA_VERSION = 2;
