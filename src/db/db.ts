import Dexie, { type Table } from 'dexie';
import type {
  AccountRecord,
  BudgetRecord,
  CategoryRecord,
  CurrencyRecord,
  MetaRecord,
  RateRecord,
  SettingsRecord,
  TransactionRecord,
} from './schema';

export class PocketLedgerDB extends Dexie {
  currencies!: Table<CurrencyRecord, string>;
  categories!: Table<CategoryRecord, string>;
  accounts!: Table<AccountRecord, string>;
  transactions!: Table<TransactionRecord, string>;
  rates!: Table<RateRecord, string>;
  budgets!: Table<BudgetRecord, string>;
  settings!: Table<SettingsRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name = 'pocket-ledger') {
    super(name);

    // v1 — initial schema.
    this.version(1).stores({
      currencies: '&code, enabled',
      categories: '&id, name, kind, archived',
      accounts: '&id, currency, archived',
      transactions:
        '&id, date, type, categoryId, accountId, currency, [date+type], [accountId+date]',
      rates: '&id, base, quote, date, [base+quote+date], [base+quote], [quote+base]',
      settings: '&id',
      meta: '&key',
    });

    // v2 — budgets, plus a data backfill for records written before the
    // `tags` array existed.
    this.version(2)
      .stores({
        budgets: '&id, month, categoryId, [month+categoryId]',
        transactions:
          '&id, date, type, categoryId, accountId, currency, [date+type], [accountId+date]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('transactions')
          .toCollection()
          .modify((transaction: TransactionRecord) => {
            if (!Array.isArray(transaction.tags)) transaction.tags = [];
          });
      });
  }
}

export const db = new PocketLedgerDB();

/** Composite id helper for rate rows. */
export function rateId(base: string, quote: string, date: string): string {
  return `${base}~${quote}~${date}`;
}

export async function getSettings(): Promise<SettingsRecord | undefined> {
  return db.settings.get('app');
}
