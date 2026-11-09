import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import type { SettingsRecord, TransactionRecord } from '../db/schema';
import { BackupError, createBackup, parseBackup, restoreBackup, serializeBackup } from './backup';
import { validateTransaction } from './transactions';
import { registerExponentLookup } from './transactions';
import { matchesSearch } from './transactions';

const context = {
  availableCurrencies: new Set(['USD', 'EUR', 'JPY']),
  accountIds: new Set(['acc-1', 'acc-2']),
  allowTransfers: true,
};

beforeEach(() => {
  registerExponentLookup((code) => (code === 'JPY' ? 0 : 2));
});

describe('validateTransaction', () => {
  const base = {
    type: 'expense' as const,
    amount: '12.50',
    currency: 'USD',
    accountId: 'acc-1',
    date: '2026-01-15',
  };

  it('accepts a well-formed expense', () => {
    const result = validateTransaction(base, context);
    expect(result.valid).toBe(true);
    expect(result.amountMinor).toBe(1250n);
    expect(result.errors).toEqual({});
  });

  it('requires a positive amount', () => {
    expect(validateTransaction({ ...base, amount: '0' }, context).errors.amount).toMatch(
      /greater than zero/,
    );
    expect(validateTransaction({ ...base, amount: '-5' }, context).errors.amount).toMatch(
      /greater than zero/,
    );
    expect(validateTransaction({ ...base, amount: '' }, context).errors.amount).toMatch(/Enter/);
  });

  it('rejects malformed amounts', () => {
    expect(validateTransaction({ ...base, amount: 'abc' }, context).errors.amount).toMatch(
      /valid amount/,
    );
    expect(validateTransaction({ ...base, amount: '1,000' }, context).errors.amount).toMatch(
      /valid amount/,
    );
  });

  it('respects the currency exponent', () => {
    const result = validateTransaction(
      { ...base, amount: '1500', currency: 'JPY' },
      context,
    );
    expect(result.valid).toBe(true);
    expect(result.amountMinor).toBe(1500n);
  });

  it('rejects an unknown currency', () => {
    const result = validateTransaction({ ...base, currency: 'XYZ' }, context);
    expect(result.valid).toBe(false);
    expect(result.errors.currency).toMatch(/not available/);
  });

  it('rejects an invalid date', () => {
    expect(validateTransaction({ ...base, date: '2026-02-30' }, context).errors.date).toBeDefined();
    expect(validateTransaction({ ...base, date: '' }, context).errors.date).toBeDefined();
  });

  it('rejects a missing account', () => {
    expect(validateTransaction({ ...base, accountId: '' }, context).errors.accountId).toBeDefined();
    expect(
      validateTransaction({ ...base, accountId: 'nope' }, context).errors.accountId,
    ).toMatch(/no longer exists/);
  });

  it('requires a distinct destination account for transfers', () => {
    const transfer = { ...base, type: 'transfer' as const, toAccountId: '' };
    expect(validateTransaction(transfer, context).errors.toAccountId).toMatch(/destination/);

    const same = { ...transfer, toAccountId: 'acc-1' };
    expect(validateTransaction(same, context).errors.toAccountId).toMatch(/must differ/);

    const good = { ...transfer, toAccountId: 'acc-2' };
    expect(validateTransaction(good, context).valid).toBe(true);
  });

  it('forbids a category on a transfer', () => {
    const transfer = {
      ...base,
      type: 'transfer' as const,
      toAccountId: 'acc-2',
      categoryId: 'cat-1',
    };
    expect(validateTransaction(transfer, context).errors.categoryId).toBeDefined();
  });

  it('blocks transfers when they are not allowed', () => {
    const result = validateTransaction(
      { ...base, type: 'transfer', toAccountId: 'acc-2' },
      { ...context, allowTransfers: false },
    );
    expect(result.valid).toBe(false);
  });
});

describe('matchesSearch', () => {
  const transaction: TransactionRecord = {
    id: 't1',
    type: 'expense',
    amount: 1250,
    currency: 'EUR',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    date: '2026-01-15',
    payee: 'Greenfield Market',
    description: 'Weekly groceries',
    notes: 'Used the loyalty card',
    tags: ['food', 'weekly'],
    status: 'cleared',
    createdAt: 0,
    updatedAt: 0,
  };

  it('matches everything when the query is empty', () => {
    expect(matchesSearch(transaction, '')).toBe(true);
    expect(matchesSearch(transaction, '   ')).toBe(true);
  });

  it('searches payee, description, notes and tags', () => {
    expect(matchesSearch(transaction, 'greenfield')).toBe(true);
    expect(matchesSearch(transaction, 'groceries')).toBe(true);
    expect(matchesSearch(transaction, 'loyalty')).toBe(true);
    expect(matchesSearch(transaction, 'weekly')).toBe(true);
    expect(matchesSearch(transaction, 'eur')).toBe(true);
  });

  it('is case insensitive and returns false for misses', () => {
    expect(matchesSearch(transaction, 'GREENFIELD')).toBe(true);
    expect(matchesSearch(transaction, 'restaurant')).toBe(false);
  });
});

describe('backup round trip', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([
      db.transactions.clear(),
      db.settings.clear(),
      db.rates.clear(),
    ]);
  });

  it('exports and parses a backup', async () => {
    const settings: SettingsRecord = {
      id: 'app',
      defaultCurrency: 'EUR',
      theme: 'dark',
      locale: 'en-GB',
      dateFormat: 'dd/MM/yyyy',
      startOfWeek: 1,
      rateProvider: 'frankfurter',
      rateApiEnabled: false,
      rateApiBaseUrl: '',
      rateApiKey: '',
      rateMaxStalenessDays: 7,
      showConvertedAmounts: true,
      hideZeroAmounts: false,
      budgetAlertThreshold: 85,
      onboardingComplete: true,
      updatedAt: 1,
    };
    await db.settings.put(settings);
    await db.transactions.put({
      id: 'tx-1',
      type: 'income',
      amount: 500000,
      currency: 'EUR',
      accountId: 'acc-1',
      date: '2026-01-15',
      tags: ['bonus'],
      status: 'cleared',
      createdAt: 1,
      updatedAt: 1,
    });

    const backup = await createBackup();
    expect(backup.format).toBe('pocket-ledger-backup');
    expect(backup.counts.transactions).toBe(1);

    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed.data.transactions[0]!.currency).toBe('EUR');
    expect(parsed.data.transactions[0]!.amount).toBe(500000);
    expect(parsed.data.settings[0]!.defaultCurrency).toBe('EUR');
  });

  it('restores a backup into an empty database', async () => {
    const backup = {
      format: 'pocket-ledger-backup' as const,
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      counts: {},
      data: {
        currencies: [],
        categories: [],
        accounts: [],
        transactions: [
          {
            id: 'restored-1',
            type: 'expense' as const,
            amount: 1234,
            currency: 'USD',
            accountId: 'acc-1',
            date: '2026-02-01',
            tags: [],
            status: 'cleared' as const,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        rates: [],
        budgets: [],
        settings: [],
      },
    };
    await restoreBackup(backup, 'replace');
    const rows = await db.transactions.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('restored-1');
    // The original currency and integer amount survive the round trip.
    expect(rows[0]!.currency).toBe('USD');
    expect(rows[0]!.amount).toBe(1234);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
  });

  it('rejects a foreign file format', () => {
    expect(() => parseBackup(JSON.stringify({ format: 'other', data: {} }))).toThrow(
      /not a Pocket Ledger backup/,
    );
  });

  it('refuses a backup from a newer schema', () => {
    expect(() =>
      parseBackup(
        JSON.stringify({
          format: 'pocket-ledger-backup',
          schemaVersion: 999,
          data: {
            currencies: [],
            categories: [],
            accounts: [],
            transactions: [],
            rates: [],
            budgets: [],
            settings: [],
          },
        }),
      ),
    ).toThrow(/newer version/);
  });
});
