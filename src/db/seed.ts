/**
 * First-run seeding and demo data loading.
 *
 * The bundled rate history is *real* published data: daily European Central
 * Bank reference rates downloaded from frankfurter.dev by
 * `scripts/fetch-seed-rates.mjs`. It is loaded lazily so it never bloats the
 * main application bundle.
 */

import { db } from './db';
import { SCHEMA_VERSION } from './schema';
import type { BudgetRecord, CurrencyRecord, SettingsRecord } from './schema';
import { CURRENCY_CATALOG } from '../data/catalog';
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, buildDemoData, demoMonthWindow } from '../data/seedData';
import { rateId } from './db';

export const DEFAULT_SETTINGS: Omit<SettingsRecord, 'updatedAt'> = {
  id: 'app',
  defaultCurrency: 'USD',
  theme: 'system',
  locale: 'en-US',
  dateFormat: 'dd MMM yyyy',
  startOfWeek: 1,
  rateProvider: 'frankfurter',
  rateApiEnabled: false,
  rateApiBaseUrl: 'https://api.frankfurter.dev/v1',
  rateApiKey: '',
  rateMaxStalenessDays: 7,
  showConvertedAmounts: true,
  hideZeroAmounts: false,
  budgetAlertThreshold: 80,
  onboardingComplete: false,
};

/**
 * Ensure every catalogue currency exists.
 *
 * This is an *upsert of missing entries*, not an all-or-nothing seed: a user
 * who installed before a currency was added must still receive it on the next
 * launch. Existing rows are never overwritten, so a user's `enabled` choice
 * survives. (An earlier version returned early whenever the table was
 * non-empty, which meant newly shipped currencies such as GYD never reached
 * existing installs.)
 */
export async function ensureCurrencies(): Promise<{ added: string[] }> {
  const now = Date.now();
  const existing = await db.currencies.toArray();
  const known = new Set(existing.map((currency) => currency.code));

  const missing = CURRENCY_CATALOG.filter((currency) => !known.has(currency.code)).map(
    (currency) => ({ ...currency, createdAt: now }),
  );

  if (missing.length > 0) await db.currencies.bulkPut(missing as CurrencyRecord[]);
  return { added: missing.map((currency) => currency.code) };
}

export async function ensureCategories(): Promise<{ added: string[] }> {
  const now = Date.now();
  const existing = await db.categories.toArray();
  const known = new Set(existing.map((category) => category.id));

  const missing = DEFAULT_CATEGORIES.filter((category) => !known.has(category.id)).map(
    (category) => ({ ...category, createdAt: now }),
  );

  if (missing.length > 0) await db.categories.bulkPut(missing);
  return { added: missing.map((category) => category.id) };
}

export async function ensureSettings(): Promise<SettingsRecord> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  const record: SettingsRecord = { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
  await db.settings.put(record);
  return record;
}

interface SeedRateFile {
  provider: string;
  providerLabel: string;
  sourceUrl: string;
  fetchedAt: string;
  base: string;
  startDate: string;
  endDate: string;
  tradingDays: number;
  rates: Record<string, Record<string, string>>;
}

/**
 * Bundled rate datasets.
 *
 * Factored as a list rather than a single import so each provider keeps its own
 * provenance. The ECB reference set covers most currencies; the Guyanese dollar
 * is not published by the ECB, so it ships from a separate source and must keep
 * its own `provider` label — relabelling it as ECB data would be a lie in the
 * exact place the app promises transparency.
 */
const BUNDLED_DATASETS: {
  /** Stable key used to record that this dataset has been applied. */
  id: string;
  label: string;
  load: () => Promise<{ default: unknown }>;
}[] = [
  {
    id: 'ecb-frankfurter',
    label: 'ECB reference rates',
    load: () => import('../data/seed-rates.json'),
  },
  {
    id: 'gyd-fawazahmed0',
    label: 'GYD rates',
    load: () => import('../data/seed-rates-gyd.json'),
  },
];

/** meta key holding the list of datasets already applied to this database. */
const APPLIED_DATASETS_KEY = 'appliedRateDatasets';
/** meta key marking the one-time removal of malformed rate rows. */
const CORRUPT_CLEANUP_KEY = 'corruptRateCleanupAt';

/**
 * Load every bundled rate history into the local rate cache.
 *
 * Runs on every launch, not only the first: a dataset added in a later release
 * (a newly bundled currency, or backfilled history) must reach existing
 * installs. `seedOneDataset` skips rows that already exist, so this is a cheap
 * additive sync and a user-supplied manual rate always wins. The previous
 * `count() === 0` guard meant a returning user never received new history.
 */
export async function seedBundledRates(): Promise<number> {
  await removeCorruptRates();

  // Datasets are applied once and recorded in `meta`. Re-importing ~9,000 rows
  // on every page load made startup visibly slow for no benefit; the marker
  // keeps first run authoritative while leaving later launches instant.
  const appliedRow = await db.meta.get(APPLIED_DATASETS_KEY);
  const applied = new Set<string>(
    Array.isArray(appliedRow?.value) ? (appliedRow!.value as string[]) : [],
  );

  let total = 0;
  for (const dataset of BUNDLED_DATASETS) {
    if (applied.has(dataset.id)) continue;
    try {
      total += await seedOneDataset(dataset.load);
      applied.add(dataset.id);
    } catch {
      // A missing or corrupt optional dataset must not block startup. It is not
      // marked applied, so a later launch retries it.
    }
  }

  await db.meta.put({ key: APPLIED_DATASETS_KEY, value: [...applied] });
  return total;
}

/**
 * Delete rate rows whose currency codes are not valid ISO-4217-shaped strings.
 *
 * Guards against a real regression: json de-duplication produced rows persisted
 * under base `"[object Object]"`. Those rows are unreachable through any normal
 * lookup, but they inflate the cache, appear in the rate browser, and would keep
 * a user permanently convinced the data was loaded. Removing them is safe —
 * every legitimate row has a three-letter base and quote.
 */
async function removeCorruptRates(): Promise<number> {
  // Guarded by a marker: this is a whole-table filter, and running it on every
  // launch made startup visibly slow (~9k rows) for a cleanup that only needs
  // to happen once per database.
  const marker = await db.meta.get(CORRUPT_CLEANUP_KEY);
  if (marker) return 0;

  const CODE = /^[A-Z]{3}$/;
  const corruptIds = await db.rates
    .filter((row) => !CODE.test(row.base) || !CODE.test(row.quote) || !row.date)
    .primaryKeys();
  if (corruptIds.length > 0) await db.rates.bulkDelete(corruptIds);

  await db.meta.put({ key: CORRUPT_CLEANUP_KEY, value: Date.now() });
  return corruptIds.length;
}

async function seedOneDataset(load: () => Promise<{ default: unknown }>): Promise<number> {
  const module = await load();
  const file = module.default as unknown as SeedRateFile;
  const fetchedAt = Date.parse(file.fetchedAt) || Date.now();

  const rows = [];
  for (const [date, quotes] of Object.entries(file.rates)) {
    for (const [quote, rate] of Object.entries(quotes)) {
      rows.push({
        id: rateId(file.base, quote, date),
        base: file.base,
        quote,
        date,
        rate,
        source: 'seed' as const,
        provider: file.provider,
        fetchedAt,
        note: `${file.providerLabel} (${file.sourceUrl})`,
      });
    }
  }

  // Chunked to keep each IndexedDB transaction comfortably small. Existing
  // rows are never overwritten: a manual or freshly fetched rate wins.
  const chunkSize = 1000;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const ids = chunk.map((row) => row.id);
    const existingIds = new Set(
      await db.rates.bulkGet(ids).then((found) =>
        found
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
          .map((row) => row.id),
      ),
    );
    const fresh = chunk.filter((row) => !existingIds.has(row.id));
    if (fresh.length) await db.rates.bulkPut(fresh);
  }

  return rows.length;
}

/** Load the sample transaction set, budgets and starter accounts. */
export async function loadDemoData(): Promise<void> {
  const now = Date.now();
  await ensureCategories();

  const existingAccounts = await db.accounts.toArray();
  if (existingAccounts.length === 0) {
    await db.accounts.bulkPut(
      DEFAULT_ACCOUNTS.map((account) => ({ ...account, createdAt: now })),
    );
  }

  const { start, end } = demoMonthWindow();
  const bundle = buildDemoData(start, end);

  await db.transactions.bulkPut(bundle.transactions);

  const budgetRows: BudgetRecord[] = bundle.budgets.map((budget, index) => ({
    id: `demo-budget-${String(index).padStart(3, '0')}`,
    categoryId: budget.categoryId,
    month: budget.month,
    amount: budget.amount,
    currency: budget.currency,
    rollover: false,
    createdAt: now,
  }));
  await db.budgets.bulkPut(budgetRows);

  const settings = await ensureSettings();
  await db.settings.put({ ...settings, onboardingComplete: true, updatedAt: now });
}

/** Meta flag recording that this browser has been initialised once. */
const INSTALL_MARKER = 'installedAt';

export interface BootstrapOptions {
  /**
   * Load the sample dataset on the very first launch so the app is
   * immediately explorable. Skipped on every later launch, and after the user
   * deliberately clears their data.
   */
  loadSampleOnFirstRun?: boolean;
}

/**
 * Prepare the database: currencies, categories, settings, and optionally the
 * sample dataset. Returns what happened so the UI can tell the user.
 */
export async function bootstrap(
  options: BootstrapOptions = {},
): Promise<{ firstRun: boolean; demoLoaded: boolean }> {
  await ensureCurrencies();
  await ensureCategories();
  await ensureSettings();
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });

  const installed = await db.meta.get(INSTALL_MARKER);
  if (installed) return { firstRun: false, demoLoaded: false };

  await db.meta.put({ key: INSTALL_MARKER, value: Date.now() });

  const transactionCount = await db.transactions.count();
  if (!options.loadSampleOnFirstRun || transactionCount > 0) {
    return { firstRun: true, demoLoaded: false };
  }

  try {
    await loadDemoData();
    return { firstRun: true, demoLoaded: true };
  } catch {
    // Sample data is a convenience only; never block startup on it.
    return { firstRun: true, demoLoaded: false };
  }
}

/**
 * Mark the database as installed so a subsequent bootstrap does not resurrect
 * the sample data after the user has cleared everything.
 */
export async function markInstalled(): Promise<void> {
  await db.meta.put({ key: INSTALL_MARKER, value: Date.now() });
}
