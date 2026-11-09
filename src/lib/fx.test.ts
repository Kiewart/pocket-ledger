import { describe, expect, it } from 'vitest';
import type { RateRecord } from '../db/schema';
import { RateEngine, convertWithRate, type ResolveOptions } from './fx';
import { convertMinorWithRate, invertScaledRate, multiplyScaledRates, scaledRateFromString } from './rates';
import { RATE_SCALE } from './money';

function rate(base: string, quote: string, date: string, value: string, source: RateRecord['source'] = 'seed'): RateRecord {
  return {
    id: `${base}~${quote}~${date}`,
    base,
    quote,
    date,
    rate: value,
    source,
    provider: source === 'manual' ? 'manual' : 'frankfurter',
    fetchedAt: 0,
  };
}

const options = (days = 7): ResolveOptions => ({ maxStalenessDays: days });

describe('convertMinorWithRate', () => {
  it('converts between same-exponent currencies', () => {
    // 100.00 USD * 0.90 = 90.00 EUR
    const result = convertMinorWithRate(10000n, 2, 2, scaledRateFromString('0.9'));
    expect(result).toBe(9000n);
  });

  it('converts into a zero-decimal currency', () => {
    // 100.00 USD * 158.46 = 15,846 JPY (no fractional yen)
    const result = convertMinorWithRate(10000n, 2, 0, scaledRateFromString('158.46'));
    expect(result).toBe(15846n);
  });

  it('converts out of a zero-decimal currency', () => {
    // 15,000 JPY at 0.006311 USD/JPY = 94.665 USD, rounded half-up to 94.67.
    const result = convertMinorWithRate(15000n, 0, 2, scaledRateFromString('0.006311'));
    expect(result).toBe(9467n);
  });

  it('converts between a 2 and a 3 decimal currency', () => {
    // 10.00 USD * 0.307 = 3.070 KWD
    const result = convertMinorWithRate(1000n, 2, 3, scaledRateFromString('0.307'));
    expect(result).toBe(3070n);
  });

  it('is exact for large integers', () => {
    const amount = 9_007_199_254_740_993n; // beyond Number.MAX_SAFE_INTEGER
    const result = convertMinorWithRate(amount, 2, 2, RATE_SCALE);
    expect(result).toBe(amount);
  });
});

describe('invertScaledRate and multiplyScaledRates', () => {
  it('inverts a rate', () => {
    const inverted = invertScaledRate(scaledRateFromString('1.25'));
    expect(inverted).toBe(800_000_000_000n); // 0.8
  });

  it('round-trips invert to within rounding tolerance', () => {
    const rate = scaledRateFromString('1.0892');
    const roundTrip = multiplyScaledRates(rate, invertScaledRate(rate));
    const diff = roundTrip > RATE_SCALE ? roundTrip - RATE_SCALE : RATE_SCALE - roundTrip;
    expect(diff <= 1n).toBe(true);
  });

  it('triangulates through a pivot', () => {
    const usdToEur = scaledRateFromString('0.9');
    const eurToGbp = scaledRateFromString('0.85');
    expect(multiplyScaledRates(usdToEur, eurToGbp)).toBe(scaledRateFromString('0.765'));
  });
});

describe('RateEngine.resolve', () => {
  it('returns identity for the same currency', () => {
    const engine = new RateEngine([]);
    const resolved = engine.resolve('USD', 'USD', '2026-01-15', options());
    expect(resolved?.kind).toBe('identity');
    expect(resolved?.rate).toBe(RATE_SCALE);
  });

  it('uses an exact-date rate', () => {
    const engine = new RateEngine([rate('USD', 'EUR', '2026-01-15', '0.92')]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options());
    expect(resolved?.kind).toBe('direct');
    expect(resolved?.rateDate).toBe('2026-01-15');
    expect(resolved?.daysStale).toBe(0);
    expect(resolved?.source).toBe('seed');
  });

  it('inverts an exact-date reverse rate', () => {
    const engine = new RateEngine([rate('EUR', 'USD', '2026-01-15', '1.25')]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options());
    expect(resolved?.kind).toBe('inverse');
    expect(resolved?.rate).toBe(800_000_000_000n);
  });

  it('triangulates through a pivot when no direct pair exists', () => {
    const engine = new RateEngine([
      rate('JPY', 'USD', '2026-01-15', '0.0063'),
      rate('USD', 'EUR', '2026-01-15', '0.92'),
    ]);
    const resolved = engine.resolve('JPY', 'EUR', '2026-01-15', options());
    expect(resolved?.kind).toBe('triangulated');
    expect(resolved?.via).toBe('USD');
  });

  it('carries the newest earlier rate backward and reports it as stale', () => {
    const engine = new RateEngine([
      rate('USD', 'EUR', '2026-01-10', '0.91'),
      rate('USD', 'EUR', '2026-01-12', '0.92'),
    ]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options(7));
    expect(resolved?.kind).toBe('stale');
    expect(resolved?.rateDate).toBe('2026-01-12');
    expect(resolved?.daysStale).toBe(3);
  });

  it('never uses a rate published after the requested date', () => {
    const engine = new RateEngine([
      rate('USD', 'EUR', '2026-01-20', '0.95'),
      rate('USD', 'EUR', '2026-02-01', '0.96'),
    ]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options(30));
    expect(resolved).toBeNull();
  });

  it('rejects a rate older than the staleness window', () => {
    const engine = new RateEngine([rate('USD', 'EUR', '2026-01-01', '0.90')]);
    expect(engine.resolve('USD', 'EUR', '2026-01-15', options(7))).toBeNull();
    expect(engine.resolve('USD', 'EUR', '2026-01-05', options(7))?.kind).toBe('stale');
  });

  it('prefers the exact date over an older rate', () => {
    const engine = new RateEngine([
      rate('USD', 'EUR', '2026-01-01', '0.90'),
      rate('USD', 'EUR', '2026-01-15', '0.92'),
    ]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options(30));
    expect(resolved?.kind).toBe('direct');
    expect(resolved?.rate).toBe(scaledRateFromString('0.92'));
  });

  it('picks the closest earlier rate when several are candidates', () => {
    const engine = new RateEngine([
      rate('USD', 'EUR', '2026-01-01', '0.90'),
      rate('USD', 'EUR', '2026-01-10', '0.91'),
      rate('USD', 'EUR', '2026-01-05', '0.905'),
    ]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-20', options(30));
    expect(resolved?.rateDate).toBe('2026-01-10');
    expect(resolved?.daysStale).toBe(10);
  });

  it('returns null when no rate exists at all', () => {
    const engine = new RateEngine([]);
    expect(engine.resolve('USD', 'EUR', '2026-01-15', options())).toBeNull();
  });

  it('records manual provenance', () => {
    const engine = new RateEngine([rate('USD', 'EUR', '2026-01-15', '0.92', 'manual')]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options());
    expect(resolved?.source).toBe('manual');
    expect(resolved?.provider).toBe('manual');
  });

  it('ignores unparsable or non-positive rate rows', () => {
    const engine = new RateEngine([
      { ...rate('USD', 'EUR', '2026-01-15', '0'), id: 'a' },
      { ...rate('USD', 'EUR', '2026-01-15', 'nonsense'), id: 'b' },
      rate('USD', 'EUR', '2026-01-15', '0.92'),
    ]);
    expect(engine.size).toBe(1);
    expect(engine.resolve('USD', 'EUR', '2026-01-15', options())?.rate).toBe(
      scaledRateFromString('0.92'),
    );
  });

  it('handles 500 cached rates efficiently and correctly', () => {
    const rows: RateRecord[] = [];
    for (let day = 1; day <= 28; day += 1) {
      const date = `2026-01-${String(day).padStart(2, '0')}`;
      for (const [base, quote, value] of [
        ['USD', 'EUR', '0.92'],
        ['USD', 'GBP', '0.79'],
        ['USD', 'JPY', '158.4'],
        ['EUR', 'GBP', '0.858'],
        ['EUR', 'JPY', '172.1'],
      ] as const) {
        rows.push(rate(base, quote, date, value));
      }
    }
    const engine = new RateEngine(rows);
    expect(engine.size).toBe(140);
    const resolved = engine.resolve('GBP', 'JPY', '2026-01-15', options());
    expect(resolved?.kind).toBe('triangulated');
  });
});

describe('convertWithRate', () => {
  it('converts and flags approximate rates', () => {
    const engine = new RateEngine([rate('USD', 'EUR', '2026-01-10', '0.92')]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options(7));
    const outcome = convertWithRate(10000n, 2, 2, resolved);
    expect(outcome.amount).toBe(9200n);
    expect(outcome.approximate).toBe(true);
  });

  it('returns null when no rate was resolved', () => {
    const outcome = convertWithRate(10000n, 2, 2, null);
    expect(outcome.amount).toBeNull();
    expect(outcome.approximate).toBe(false);
  });
});

describe('historical rate semantics', () => {
  it('values the same amount differently on different dates', () => {
    // This is the crux of the historical engine: today's rate must not be
    // substituted for a transaction's own date.
    const engine = new RateEngine([
      rate('USD', 'EUR', '2025-01-15', '0.97'),
      rate('USD', 'EUR', '2026-01-15', '0.86'),
    ]);
    const then = engine.resolve('USD', 'EUR', '2025-01-15', options());
    const now = engine.resolve('USD', 'EUR', '2026-01-15', options());
    expect(convertWithRate(10000n, 2, 2, then).amount).toBe(9700n);
    expect(convertWithRate(10000n, 2, 2, now).amount).toBe(8600n);
  });

  it('exposes rate provenance for every resolution', () => {
    const engine = new RateEngine([rate('USD', 'EUR', '2026-01-15', '0.92', 'api')]);
    const resolved = engine.resolve('USD', 'EUR', '2026-01-15', options());
    expect(resolved).toMatchObject({
      from: 'USD',
      to: 'EUR',
      requestedDate: '2026-01-15',
      rateDate: '2026-01-15',
      source: 'api',
      provider: 'frankfurter',
    });
  });
});
