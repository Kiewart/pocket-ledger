import { beforeEach, describe, expect, it } from 'vitest';
import { db, rateId } from './db';
import type { RateRecord } from './schema';
import { getRateCoverage, getRatesForPair } from '../lib/fxApi';

function row(base: string, quote: string, date: string, rate = '0.9'): RateRecord {
  return {
    id: rateId(base, quote, date),
    base,
    quote,
    date,
    rate,
    source: 'seed',
    provider: 'test',
    fetchedAt: 0,
  };
}

/**
 * These exercise the real IndexedDB layer (via fake-indexeddb) through the same
 * shared database instance the app uses. The bug they guard against was a query
 * semantics mistake in `getRatesForPair`/`getRateCoverage`, not a pure-function
 * error, so a stubbed repository would not have caught it.
 */
describe('rate queries against the real IndexedDB schema', () => {
  beforeEach(async () => {
    await db.open();
    await db.rates.clear();
  });

  it('finds rows for an exact compound key', async () => {
    // Regression: `between([b,q],[b,q])` excludes the upper bound by default,
    // which made every pair report zero cached rates while the rate engine
    // (which reads the whole table) still resolved them correctly.
    await db.rates.bulkPut([
      row('USD', 'EUR', '2026-01-01'),
      row('USD', 'EUR', '2026-01-02'),
      row('USD', 'GBP', '2026-01-01'),
    ]);
    const found = await db.rates
      .where('[base+quote]')
      .between(['USD', 'EUR'], ['USD', 'EUR'], true, true)
      .toArray();
    expect(found).toHaveLength(2);
  });

  it('returns pair rates newest first', async () => {
    await db.rates.bulkPut([
      row('USD', 'EUR', '2026-01-01'),
      row('USD', 'EUR', '2026-03-01'),
      row('USD', 'EUR', '2026-02-01'),
    ]);
    const rows = await getRatesForPair('USD', 'EUR');
    expect(rows.map((entry) => entry.date)).toEqual([
      '2026-03-01',
      '2026-02-01',
      '2026-01-01',
    ]);
  });

  it('reports coverage for a populated pair', async () => {
    await db.rates.bulkPut([
      row('USD', 'EUR', '2026-01-01'),
      row('USD', 'EUR', '2026-01-05'),
    ]);
    const coverage = await getRateCoverage('USD', 'EUR');
    expect(coverage.count).toBe(2);
    expect(coverage.first).toBe('2026-01-01');
    expect(coverage.last).toBe('2026-01-05');
  });

  it('reports empty coverage for an unknown pair', async () => {
    await db.rates.bulkPut([row('USD', 'EUR', '2026-01-01')]);
    const coverage = await getRateCoverage('USD', 'JPY');
    expect(coverage.count).toBe(0);
    expect(coverage.first).toBeUndefined();
  });

  it('does not mix pairs that share a base currency', async () => {
    await db.rates.bulkPut([
      row('USD', 'EUR', '2026-01-01'),
      row('USD', 'GBP', '2026-01-01'),
      row('EUR', 'USD', '2026-01-01'),
    ]);
    expect(await getRatesForPair('USD', 'EUR')).toHaveLength(1);
    expect(await getRatesForPair('USD', 'GBP')).toHaveLength(1);
    expect(await getRatesForPair('EUR', 'USD')).toHaveLength(1);
  });
});
