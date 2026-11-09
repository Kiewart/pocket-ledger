/**
 * Historical foreign-exchange resolution.
 *
 * Design rules (these are the correctness contract of the app):
 *
 *  1. A transaction is converted with the rate that applied **on its own
 *     date**. The original amount and currency are never overwritten.
 *  2. A missing historical rate is **never** silently replaced with today's
 *     rate. Only rates dated on or *before* the transaction date are
 *     considered, and a carried-forward rate is reported as `stale` together
 *     with the date it actually came from and how many days old it is.
 *  3. If no rate at all can be found, the conversion fails explicitly and the
 *     amount is excluded from converted totals instead of being guessed.
 *  4. Every resolved rate carries its source (`manual`, `api`, `seed`,
 *     `import`) and provider so the UI can show where the number came from.
 */

import type { RateRecord, RateSource } from '../db/schema';
import { RATE_SCALE, type Minor } from './money';
import {
  convertMinorWithRate,
  daysBetween,
  invertScaledRate,
  multiplyScaledRates,
  scaledRateFromString,
} from './rates';

export type RateMatchKind =
  /** from === to */
  | 'identity'
  /** A rate published for exactly the requested date. */
  | 'direct'
  /** The inverse of a rate published for exactly the requested date. */
  | 'inverse'
  /** Two same-date rates combined through a pivot currency. */
  | 'triangulated'
  /** The newest rate dated on or before the requested date. */
  | 'stale';

export interface ResolvedRate {
  from: string;
  to: string;
  /** Scaled by RATE_SCALE (1.0 == RATE_SCALE). */
  rate: bigint;
  kind: RateMatchKind;
  /** Date the caller asked for. */
  requestedDate: string;
  /** Date the underlying rate was actually published for. */
  rateDate: string;
  /** 0 for exact matches. */
  daysStale: number;
  source: RateSource;
  provider: string;
  /** Pivot currency used for a triangulated rate. */
  via?: string;
}

export interface ResolveOptions {
  /**
   * Maximum number of days a rate may be carried backwards. A rate older
   * than this is rejected rather than used.
   */
  maxStalenessDays: number;
  /** Pivot currencies used for triangulation. */
  pivots?: string[];
}

export const DEFAULT_PIVOTS = ['USD', 'EUR', 'GBP', 'CHF'];

interface SeriesEntry {
  date: string;
  rate: bigint;
  source: RateSource;
  provider: string;
}

interface PairSeries {
  base: string;
  quote: string;
  entries: SeriesEntry[];
}

/** A resolved single-leg rate (base -> quote) with its provenance. */
interface Leg {
  rate: bigint;
  kind: 'direct' | 'inverse';
  date: string;
  source: RateSource;
  provider: string;
}

function pairKey(base: string, quote: string): string {
  return `${base}|${quote}`;
}

/**
 * In-memory rate resolver. Rates are loaded once and queried in memory so
 * that converting hundreds of transactions stays fast.
 */
export class RateEngine {
  private readonly series = new Map<string, PairSeries>();

  constructor(rows: RateRecord[]) {
    for (const row of rows) {
      let scaled: bigint;
      try {
        scaled = scaledRateFromString(row.rate);
      } catch {
        continue; // Ignore rows with unparsable rates.
      }
      if (scaled <= 0n) continue;
      const key = pairKey(row.base, row.quote);
      let entry = this.series.get(key);
      if (!entry) {
        entry = { base: row.base, quote: row.quote, entries: [] };
        this.series.set(key, entry);
      }
      entry.entries.push({
        date: row.date,
        rate: scaled,
        source: row.source,
        provider: row.provider,
      });
    }
    for (const entry of this.series.values()) {
      entry.entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
  }

  get size(): number {
    let total = 0;
    for (const entry of this.series.values()) total += entry.entries.length;
    return total;
  }

  /** Exact-date lookup inside one pair series. */
  private exact(base: string, quote: string, date: string): SeriesEntry | undefined {
    const entry = this.series.get(pairKey(base, quote));
    if (!entry) return undefined;
    const found = entry.entries.find((item) => item.date === date);
    return found;
  }

  /** Newest entry dated on or before `date`. */
  private newestBefore(base: string, quote: string, date: string): SeriesEntry | undefined {
    const entry = this.series.get(pairKey(base, quote));
    if (!entry || entry.entries.length === 0) return undefined;
    let low = 0;
    let high = entry.entries.length - 1;
    let result: SeriesEntry | undefined;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const candidate = entry.entries[mid]!;
      if (candidate.date <= date) {
        result = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  /** Resolve one base->quote leg on an exact date (direct or inverted). */
  private exactLeg(base: string, quote: string, date: string): Leg | undefined {
    const direct = this.exact(base, quote, date);
    if (direct) {
      return {
        rate: direct.rate,
        kind: 'direct',
        date: direct.date,
        source: direct.source,
        provider: direct.provider,
      };
    }
    const inverse = this.exact(quote, base, date);
    if (inverse) {
      return {
        rate: invertScaledRate(inverse.rate),
        kind: 'inverse',
        date: inverse.date,
        source: inverse.source,
        provider: inverse.provider,
      };
    }
    return undefined;
  }

  /** Resolve one base->quote leg, allowing a carried-forward rate. */
  private leg(
    base: string,
    quote: string,
    date: string,
    maxStalenessDays: number,
  ): (Leg & { daysStale: number }) | undefined {
    const exactLeg = this.exactLeg(base, quote, date);
    if (exactLeg) return { ...exactLeg, daysStale: 0 };

    const candidates: (SeriesEntry & { inverted: boolean })[] = [];
    const directStale = this.newestBefore(base, quote, date);
    if (directStale) candidates.push({ ...directStale, inverted: false });
    const inverseStale = this.newestBefore(quote, base, date);
    if (inverseStale) candidates.push({ ...inverseStale, inverted: true });

    let best: (Leg & { daysStale: number }) | undefined;
    for (const candidate of candidates) {
      const daysStale = daysBetween(candidate.date, date);
      if (daysStale > maxStalenessDays) continue;
      const leg: Leg & { daysStale: number } = {
        rate: candidate.inverted ? invertScaledRate(candidate.rate) : candidate.rate,
        kind: candidate.inverted ? 'inverse' : 'direct',
        date: candidate.date,
        source: candidate.source,
        provider: candidate.provider,
        daysStale,
      };
      if (!best || leg.daysStale < best.daysStale) best = leg;
    }
    return best;
  }

  /**
   * Resolve the rate to use for `from` -> `to` on `date`.
   * Returns null when no acceptable rate exists.
   */
  resolve(from: string, to: string, date: string, options: ResolveOptions): ResolvedRate | null {
    if (!from || !to || !date) return null;

    if (from === to) {
      return {
        from,
        to,
        rate: RATE_SCALE,
        kind: 'identity',
        requestedDate: date,
        rateDate: date,
        daysStale: 0,
        source: 'manual',
        provider: 'identity',
      };
    }

    const pivots = (options.pivots ?? DEFAULT_PIVOTS).filter(
      (pivot) => pivot !== from && pivot !== to,
    );

    // 1. Exact-date direct rate.
    const direct = this.exact(from, to, date);
    if (direct) {
      return {
        from,
        to,
        rate: direct.rate,
        kind: 'direct',
        requestedDate: date,
        rateDate: direct.date,
        daysStale: 0,
        source: direct.source,
        provider: direct.provider,
      };
    }

    // 2. Exact-date inverse rate.
    const inverse = this.exact(to, from, date);
    if (inverse) {
      return {
        from,
        to,
        rate: invertScaledRate(inverse.rate),
        kind: 'inverse',
        requestedDate: date,
        rateDate: inverse.date,
        daysStale: 0,
        source: inverse.source,
        provider: inverse.provider,
      };
    }

    // 3. Exact-date triangulation through a pivot currency.
    for (const pivot of pivots) {
      const first = this.exactLeg(from, pivot, date);
      const second = this.exactLeg(pivot, to, date);
      if (first && second) {
        return {
          from,
          to,
          rate: multiplyScaledRates(first.rate, second.rate),
          kind: 'triangulated',
          requestedDate: date,
          rateDate: date,
          daysStale: 0,
          source: first.source === second.source ? first.source : 'api',
          provider: first.provider === second.provider ? first.provider : 'mixed',
          via: pivot,
        };
      }
    }

    // 4. Carried-forward rates. Never look forward in time: a rate published
    //    after the transaction date cannot describe that date's value.
    const staleDirect = this.leg(from, to, date, options.maxStalenessDays);
    if (staleDirect) {
      return {
        from,
        to,
        rate: staleDirect.rate,
        kind: 'stale',
        requestedDate: date,
        rateDate: staleDirect.date,
        daysStale: staleDirect.daysStale,
        source: staleDirect.source,
        provider: staleDirect.provider,
      };
    }

    for (const pivot of pivots) {
      const first = this.leg(from, pivot, date, options.maxStalenessDays);
      const second = this.leg(pivot, to, date, options.maxStalenessDays);
      if (first && second) {
        return {
          from,
          to,
          rate: multiplyScaledRates(first.rate, second.rate),
          kind: 'stale',
          requestedDate: date,
          rateDate: first.daysStale >= second.daysStale ? first.date : second.date,
          daysStale: Math.max(first.daysStale, second.daysStale),
          source: first.source === second.source ? first.source : 'api',
          provider: first.provider === second.provider ? first.provider : 'mixed',
          via: pivot,
        };
      }
    }

    return null;
  }
}

export interface ConversionOutcome {
  /** Converted amount in minor units of the target currency, or null. */
  amount: Minor | null;
  rate: ResolvedRate | null;
  /** True when a rate was found but it was carried forward. */
  approximate: boolean;
}

/** Convert a minor amount between currencies using the resolved historical rate. */
export function convertWithRate(
  amount: Minor,
  fromExponent: number,
  toExponent: number,
  rate: ResolvedRate | null,
): ConversionOutcome {
  if (!rate) return { amount: null, rate: null, approximate: false };
  return {
    amount: convertMinorWithRate(amount, fromExponent, toExponent, rate.rate),
    rate,
    approximate: rate.kind === 'stale',
  };
}
