/**
 * Historical rate provider integration and local rate cache.
 *
 * The `rates` table *is* the cache. Every row remembers where it came from
 * (`source` + `provider`) and when it was fetched, so the UI can always show
 * the provenance of a converted amount.
 *
 * Default provider: Frankfurter (https://frankfurter.dev), which republishes
 * the European Central Bank's daily reference rates and supports historical
 * dates without an API key.
 */

import { db, rateId } from '../db/db';
import type { RateRecord, RateSource } from '../db/schema';

export const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v1';

export interface FetchedRates {
  /** date -> quote currency -> decimal rate string */
  byDate: Map<string, Map<string, string>>;
  base: string;
  /** The date the provider actually served (providers shift to the last
   *  working day for weekends / holidays). */
  servedDate?: string;
  provider: string;
}

export interface RateProviderConfig {
  provider: 'frankfurter' | 'custom';
  baseUrl: string;
  apiKey: string;
}

/** Build the request URL for the configured provider. */
export function buildRateUrl(
  config: RateProviderConfig,
  dateOrRange: string,
  base: string,
  symbols: string[],
): string {
  const symbolParam = symbols.join(',');
  if (config.provider === 'frankfurter') {
    const base_ = config.baseUrl || FRANKFURTER_BASE_URL;
    return `${base_}/${dateOrRange}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbolParam)}`;
  }
  // Custom provider: the base URL may contain {date}, {base} and {symbols}.
  return config.baseUrl
    .replace('{date}', dateOrRange)
    .replace('{base}', encodeURIComponent(base))
    .replace('{symbols}', encodeURIComponent(symbolParam));
}

function normaliseNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return value.trim();
  }
  return null;
}

/** Parse a provider payload into date -> symbol -> rate. */
export function parseProviderPayload(payload: unknown): FetchedRates {
  const byDate = new Map<string, Map<string, string>>();
  if (!payload || typeof payload !== 'object') return { byDate, base: '', provider: 'unknown' };

  const record = payload as Record<string, unknown>;
  const base = typeof record.base === 'string' ? record.base : '';

  // Range shape: { start_date, end_date, rates: { "YYYY-MM-DD": { EUR: 1.08 } } }
  if (record.rates && typeof record.rates === 'object') {
    const rateMap = record.rates as Record<string, unknown>;
    const dateKeys = Object.keys(rateMap);
    const looksLikeRange = dateKeys.some((key) => /^\d{4}-\d{2}-\d{2}$/.test(key));
    if (looksLikeRange) {
      for (const [date, values] of Object.entries(rateMap)) {
        if (!values || typeof values !== 'object') continue;
        const map = new Map<string, string>();
        for (const [symbol, value] of Object.entries(values as Record<string, unknown>)) {
          const rate = normaliseNumber(value);
          if (rate) map.set(symbol, rate);
        }
        byDate.set(date, map);
      }
      return { byDate, base, provider: 'frankfurter' };
    }
    // Single-date shape: { date, rates: { EUR: 1.08 } }
    const date = typeof record.date === 'string' ? record.date : '';
    const map = new Map<string, string>();
    for (const [symbol, value] of Object.entries(record.rates as Record<string, unknown>)) {
      const rate = normaliseNumber(value);
      if (rate) map.set(symbol, rate);
    }
    if (date) byDate.set(date, map);
    return { byDate, base, servedDate: date, provider: 'frankfurter' };
  }

  return { byDate, base, provider: 'unknown' };
}

/** Fetch rates for a single date or a `start..end` range. */
export async function fetchRates(
  config: RateProviderConfig,
  dateOrRange: string,
  base: string,
  symbols: string[],
): Promise<FetchedRates> {
  if (symbols.length === 0) throw new Error('Select at least one currency to fetch.');
  const url = buildRateUrl(config, dateOrRange, base, symbols);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Rate provider responded with ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const parsed = parseProviderPayload(payload);
  return { ...parsed, base: parsed.base || base };
}

export interface SaveRatesOptions {
  source: RateSource;
  provider: string;
  /** Manual rows are never overwritten by automated fetches. */
  respectManualOverrides?: boolean;
  note?: string;
}

/** Persist fetched rates into the cache, skipping manual overrides. */
export async function saveRates(
  fetched: FetchedRates,
  options: SaveRatesOptions,
): Promise<number> {
  const fetchedAt = Date.now();
  const rows: RateRecord[] = [];

  for (const [date, quotes] of fetched.byDate) {
    for (const [quote, rate] of quotes) {
      if (quote === fetched.base) continue;
      const id = rateId(fetched.base, quote, date);
      if (options.respectManualOverrides !== false) {
        const existing = await db.rates.get(id);
        if (existing && existing.source === 'manual') continue;
      }
      rows.push({
        id,
        base: fetched.base,
        quote,
        date,
        rate,
        source: options.source,
        provider: options.provider,
        fetchedAt,
        note: options.note,
      });
    }
  }

  if (rows.length > 0) await db.rates.bulkPut(rows);
  return rows.length;
}

/** Fetch and cache rates in one step. */
export async function syncRates(
  config: RateProviderConfig,
  dateOrRange: string,
  base: string,
  symbols: string[],
  source: RateSource = 'api',
): Promise<{ fetched: number; saved: number; dates: string[] }> {
  const fetched = await fetchRates(config, dateOrRange, base, symbols);
  const saved = await saveRates(fetched, {
    source,
    provider: config.provider === 'frankfurter' ? 'frankfurter' : 'custom',
  });
  return { fetched: fetched.byDate.size, saved, dates: [...fetched.byDate.keys()] };
}

/** Insert or replace a single manual rate. */
export async function saveManualRate(input: {
  base: string;
  quote: string;
  date: string;
  rate: string;
  note?: string;
}): Promise<RateRecord> {
  const record: RateRecord = {
    id: rateId(input.base, input.quote, input.date),
    base: input.base,
    quote: input.quote,
    date: input.date,
    rate: input.rate,
    source: 'manual',
    provider: 'manual',
    fetchedAt: Date.now(),
    note: input.note,
  };
  await db.rates.put(record);
  return record;
}

export async function deleteRate(id: string): Promise<void> {
  await db.rates.delete(id);
}

/** Cached-rate coverage for a currency pair. */
export async function getRateCoverage(
  base: string,
  quote: string,
): Promise<{ count: number; first?: string; last?: string }> {
  const dates = await rateDatesForPair(base, quote);
  return { count: dates.length, first: dates[0], last: dates[dates.length - 1] };
}

/**
 * Every cached rate for one pair, newest first.
 *
 * IndexedDB ranges are half-open: `between([b, q], [b, q])` matches nothing
 * because the lower and upper bound are identical. Pass `true` for
 * `includeUpper` so a single exact compound key is included. (Dexie's default
 * is `false`, which silently returned zero rows for every pair.)
 */
function ratesForPairQuery(base: string, quote: string) {
  return db.rates
    .where('[base+quote]')
    .between([base, quote], [base, quote], true, true);
}

async function rateDatesForPair(base: string, quote: string): Promise<string[]> {
  const rows = await ratesForPairQuery(base, quote).toArray();
  return rows.map((row) => row.date).sort();
}

export async function getRatesForPair(base: string, quote: string): Promise<RateRecord[]> {
  const rows = await ratesForPairQuery(base, quote).toArray();
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
