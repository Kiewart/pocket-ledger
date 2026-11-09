import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { ensureCategories, ensureCurrencies, seedBundledRates } from './seed';
import { CURRENCY_CATALOG } from '../data/catalog';

/**
 * These guard an upgrade path, not just a first install.
 *
 * A user who installed before a currency was bundled must still receive it, and
 * a returning user must still receive newly added rate history. The original
 * implementations used `count() === 0` guards, which silently made both of those
 * impossible forever after the first launch.
 */
describe('currency catalogue upgrades', () => {
  beforeEach(async () => {
    await db.open();
    await db.currencies.clear();
    await db.categories.clear();
  });

  it('seeds the whole catalogue on a fresh database', async () => {
    const { added } = await ensureCurrencies();
    expect(added.length).toBe(CURRENCY_CATALOG.length);
    expect(await db.currencies.count()).toBe(CURRENCY_CATALOG.length);
  });

  it('adds a currency that was missing from an existing install', async () => {
    // Simulate an install created before GYD existed: everything except GYD.
    const now = Date.now();
    await db.currencies.bulkPut(
      CURRENCY_CATALOG.filter((currency) => currency.code !== 'GYD').map((currency) => ({
        ...currency,
        createdAt: now,
      })),
    );
    expect(await db.currencies.get('GYD')).toBeUndefined();

    const { added } = await ensureCurrencies();

    expect(added).toContain('GYD');
    const gyd = await db.currencies.get('GYD');
    expect(gyd).toBeDefined();
    expect(gyd!.exponent).toBe(2);
  });

  it('does not report or duplicate anything when already complete', async () => {
    await ensureCurrencies();
    const before = await db.currencies.count();

    const { added } = await ensureCurrencies();

    expect(added).toEqual([]);
    expect(await db.currencies.count()).toBe(before);
  });

  it('preserves a user-disabled currency instead of resetting it', async () => {
    await ensureCurrencies();
    const currency = await db.currencies.get('GYD');
    await db.currencies.put({ ...currency!, enabled: false });

    await ensureCurrencies();

    const after = await db.currencies.get('GYD');
    // An upsert of *missing* rows must never clobber an existing preference.
    expect(after!.enabled).toBe(false);
  });

  it('adds missing categories without touching existing ones', async () => {
    const { added } = await ensureCategories();
    expect(added.length).toBeGreaterThan(0);

    const category = await db.categories.get(added[0]!);
    await db.categories.put({ ...category!, name: 'Renamed by user' });

    const second = await ensureCategories();
    expect(second.added).toEqual([]);
    const after = await db.categories.get(added[0]!);
    expect(after!.name).toBe('Renamed by user');
  });
});

describe('bundled rate reconciliation', () => {
  beforeEach(async () => {
    await db.open();
    await db.rates.clear();
    // Clear the "already applied" markers so each test starts from a state
    // where the bundled datasets have not been imported yet.
    await db.meta.delete('appliedRateDatasets');
    await db.meta.delete('corruptRateCleanupAt');
  });

  it('loads GYD history with its own provider label', async () => {
    await seedBundledRates();
    const gydRows = await db.rates.where('quote').equals('GYD').toArray();
    expect(gydRows.length).toBeGreaterThan(300);

    // Provenance must stay accurate: this data is not ECB-sourced.
    const providers = new Set(gydRows.map((row) => row.provider));
    expect(providers.has('fawazahmed0')).toBe(true);
    expect(providers.has('frankfurter')).toBe(false);
  });

  it('is additive: rerunning does not duplicate rate rows', async () => {
    await seedBundledRates();
    const firstCount = await db.rates.count();

    await seedBundledRates();

    expect(await db.rates.count()).toBe(firstCount);
  });

  it('backfills a dataset added in a later release', async () => {
    // Simulate an install from before GYD shipped: only the ECB dataset was
    // ever applied, and no GYD rows exist.
    await seedBundledRates();
    await db.rates.where('quote').equals('GYD').delete();
    await db.meta.put({ key: 'appliedRateDatasets', value: ['ecb-frankfurter'] });
    expect(await db.rates.where('quote').equals('GYD').count()).toBe(0);

    await seedBundledRates();

    // The newly bundled dataset is imported for the existing install.
    expect(await db.rates.where('quote').equals('GYD').count()).toBeGreaterThan(300);
  });

  it('does not re-import an already applied dataset', async () => {
    await seedBundledRates();
    const first = await db.rates.count();

    // Startup must not pay the cost of re-importing ~9k rows every load.
    const importedAgain = await seedBundledRates();

    expect(importedAgain).toBe(0);
    expect(await db.rates.count()).toBe(first);
  });

  it('purges corrupt rows left by a bad generator run', async () => {
    // Regression: a generator bug once persisted rows under base
    // "[object Object]". They were unreachable by lookup but still counted in
    // the cache total, making a failed load look successful.
    await db.rates.put({
      id: '[object Object]~GYD~2026-01-01',
      base: '[object Object]',
      quote: 'GYD',
      date: '2026-01-01',
      rate: '209.1',
      source: 'seed',
      provider: 'fawazahmed0',
      fetchedAt: 0,
    });

    await seedBundledRates();

    expect(await db.rates.get('[object Object]~GYD~2026-01-01')).toBeUndefined();
    // The genuine rows are still present afterwards.
    expect(await db.rates.where('quote').equals('GYD').count()).toBeGreaterThan(300);
  });

  it('never overwrites a manual rate', async () => {
    await seedBundledRates();
    const existing = await db.rates.where('quote').equals('GYD').first();
    expect(existing).toBeDefined();

    await db.rates.put({
      ...existing!,
      rate: '999.5',
      source: 'manual',
      provider: 'manual',
      note: 'entered by the user',
    });

    await seedBundledRates();

    const after = await db.rates.get(existing!.id);
    expect(after!.source).toBe('manual');
    expect(after!.rate).toBe('999.5');
  });
});
