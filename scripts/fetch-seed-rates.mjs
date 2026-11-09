#!/usr/bin/env node
/**
 * Rebuilds `src/data/seed-rates.json` from the live Frankfurter API
 * (European Central Bank daily reference rates).
 *
 * The bundled dataset gives Pocket Ledger a working offline rate history on
 * first run. Every value in the file is a real published ECB reference rate —
 * nothing here is synthetic or hand-written.
 *
 *   node scripts/fetch-seed-rates.mjs [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../src/data/seed-rates.json');

function arg(name, fallback) {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
}

const BASE = 'USD';
const SYMBOLS = [
  'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY', 'INR', 'KRW',
  'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BRL',
  'MXN', 'ZAR', 'TRY', 'ILS', 'THB', 'MYR', 'IDR', 'PHP', 'CLP', 'ARS',
  'COP', 'PEN',
];

const from = arg('from', '2025-09-01');
const to = arg('to', new Date().toISOString().slice(0, 10));

const url = `https://api.frankfurter.dev/v1/${from}..${to}?base=${BASE}&symbols=${SYMBOLS.join(',')}`;
console.log(`Fetching ${url}`);

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Frankfurter responded ${response.status} ${response.statusText}`);
}
const payload = await response.json();
const rates = payload.rates ?? {};

const dates = Object.keys(rates).sort();
console.log(`Received ${dates.length} trading days (${dates[0]} .. ${dates[dates.length - 1]})`);

const clean = {};
for (const date of dates) {
  const entry = {};
  for (const symbol of SYMBOLS) {
    const value = rates[date][symbol];
    if (typeof value === 'number' && Number.isFinite(value)) entry[symbol] = String(value);
  }
  clean[date] = entry;
}

const output = {
  provider: 'frankfurter',
  providerLabel: 'Frankfurter (European Central Bank reference rates)',
  sourceUrl: 'https://frankfurter.dev',
  fetchedAt: new Date().toISOString(),
  base: BASE,
  startDate: dates[0],
  endDate: dates[dates.length - 1],
  tradingDays: dates.length,
  currencies: SYMBOLS.filter((symbol) => dates.some((date) => clean[date][symbol] !== undefined)),
  rates: clean,
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(output)}\n`, 'utf8');
console.log(`Wrote ${outFile}`);
