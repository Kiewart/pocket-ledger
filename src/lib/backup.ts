/**
 * JSON backup and restore.
 *
 * The backup is a complete, self-describing snapshot of the local database.
 * It is intentionally plain JSON so it can be inspected, diffed and version
 * controlled by the user, and so a future cloud-sync layer can exchange the
 * same payload.
 */

import { db } from '../db/db';
import { SCHEMA_VERSION } from '../db/schema';
import type {
  AccountRecord,
  BudgetRecord,
  CategoryRecord,
  CurrencyRecord,
  RateRecord,
  SettingsRecord,
  TransactionRecord,
} from '../db/schema';

export const BACKUP_FORMAT = 'pocket-ledger-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
  data: {
    currencies: CurrencyRecord[];
    categories: CategoryRecord[];
    accounts: AccountRecord[];
    transactions: TransactionRecord[];
    rates: RateRecord[];
    budgets: BudgetRecord[];
    settings: SettingsRecord[];
  };
}

export async function createBackup(): Promise<BackupFile> {
  const [currencies, categories, accounts, transactions, rates, budgets, settings] =
    await Promise.all([
      db.currencies.toArray(),
      db.categories.toArray(),
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.rates.toArray(),
      db.budgets.toArray(),
      db.settings.toArray(),
    ]);

  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      currencies: currencies.length,
      categories: categories.length,
      accounts: accounts.length,
      transactions: transactions.length,
      rates: rates.length,
      budgets: budgets.length,
      settings: settings.length,
    },
    data: { currencies, categories, accounts, transactions, rates, budgets, settings },
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

export class BackupError extends Error {}

/** Validate a parsed backup payload before touching the database. */
export function parseBackup(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('That file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BackupError('That file does not contain a Pocket Ledger backup.');
  }
  const backup = parsed as Partial<BackupFile>;
  if (backup.format !== BACKUP_FORMAT) {
    throw new BackupError('That file is not a Pocket Ledger backup.');
  }
  if (!backup.data || typeof backup.data !== 'object') {
    throw new BackupError('The backup is missing its data section.');
  }
  if (typeof backup.schemaVersion !== 'number') {
    throw new BackupError('The backup is missing its schema version.');
  }
  if (backup.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      `The backup was written by a newer version of Pocket Ledger (schema ${backup.schemaVersion}). Update the app before restoring it.`,
    );
  }
  const data = backup.data;
  for (const key of ['currencies', 'categories', 'accounts', 'transactions', 'rates', 'budgets', 'settings'] as const) {
    if (!Array.isArray(data[key])) {
      throw new BackupError(`The backup is missing its "${key}" collection.`);
    }
  }
  return backup as BackupFile;
}

export type RestoreMode = 'replace' | 'merge';

/** Restore a backup into the local database. */
export async function restoreBackup(
  backup: BackupFile,
  mode: RestoreMode = 'replace',
): Promise<void> {
  const { data } = backup;

  await db.transaction(
    'rw',
    [db.currencies, db.categories, db.accounts, db.transactions, db.rates, db.budgets, db.settings],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.currencies.clear(),
          db.categories.clear(),
          db.accounts.clear(),
          db.transactions.clear(),
          db.rates.clear(),
          db.budgets.clear(),
          db.settings.clear(),
        ]);
      }
      if (data.currencies.length) await db.currencies.bulkPut(data.currencies);
      if (data.categories.length) await db.categories.bulkPut(data.categories);
      if (data.accounts.length) await db.accounts.bulkPut(data.accounts);
      if (data.transactions.length) await db.transactions.bulkPut(data.transactions);
      if (data.rates.length) await db.rates.bulkPut(data.rates);
      if (data.budgets.length) await db.budgets.bulkPut(data.budgets);
      if (data.settings.length) await db.settings.bulkPut(data.settings);
    },
  );
}

/** Remove every record from every table. */
export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.currencies, db.categories, db.accounts, db.transactions, db.rates, db.budgets, db.settings, db.meta],
    async () => {
      await Promise.all([
        db.currencies.clear(),
        db.categories.clear(),
        db.accounts.clear(),
        db.transactions.clear(),
        db.rates.clear(),
        db.budgets.clear(),
        db.settings.clear(),
        db.meta.clear(),
      ]);
    },
  );
}

/** Read a File object as UTF-8 text. */
export async function readFileAsText(file: File): Promise<string> {
  return await file.text();
}
