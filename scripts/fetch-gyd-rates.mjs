#!/usr/bin/env node
/**
 * Builds `src/data/seed-rates-gyd.json`: real daily USD → GYD rates for the
 * same window the ECB dataset covers.
 *
 * Why a separate file: the European Central Bank does not publish the Guyanese
 * dollar, so `frankfurter.dev` cannot supply it. These values instead come from
 * the open `@fawazahmed0/currency-api` dataset, which serves one dated file per
 * day. Every value is a published market rate for that date — nothing here is
 * interpolated or invented. Days the upstream set does not cover (weekends,
 * outages) are simply absent, and the rate engine's carry-forward rule handles
 * them at read time, exactly as it does for ECB weekends.
 *
 *   node scripts/fetch-gyd-rates.mjs [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../src/data/seed-rates-gyd.json');

function arg(name, fallback) {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? found.split('=')[1] : fallback;
}

const BASE = 'USD';
const QUOTE = 'gyd';
const CONCURRENCY = 12;

const from = arg('from', '2025-09-01');
const to = arg('to', new Date().toISOString().slice(0, 10));

const MIRRORS = [
  (date) =>
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`,
  (date) =>
    `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];

function eachDay(start, end) {
  const days = [];
  let [year, month, day] = start.split('-').map(Number);
  const endKey = end;
  let guard = 0;
  while (guard < 2000) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (key > endKey) break;
    days.push(key);
    day += 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day > lastDay) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    guard += 1;
  }
  return days;
}

async function fetchOne(date) {
  for (const mirror of MIRRORS) {
    try {
      const response = await fetch(mirror(date), {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const value = payload?.usd?.[QUOTE];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return { date, rate: String(value) };
      }
    } catch {
      // Try the next mirror.
    }
  }
  return null;
}

async function runPool(days) {
  const results = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < days.length) {
      const index = cursor;
      cursor += 1;
      const result = await fetchOne(days[index]);
      if (result) results.push(result);
      done += 1;
      if (done % 25 === 0 || done === days.length) {
        process.stdout.write(`  ${done}/${days.length}\r`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return results;
}

const days = eachDay(from, to);
console.log(`Fetching USD->GYD for ${days.length} days (${from} .. ${to})`);

const results = await runPool(days);
results.sort((a, b) => (a.date < b.date ? -1 : 1));
console.log(`\nReceived ${results.length} dated rates`);

if (results.length === 0) {
  throw new Error('No rates were returned; refusing to write an empty dataset.');
}

const rates = {};
for (const entry of results) rates[entry.date] = { GYD: entry.rate };

const output = {
  provider: 'fawazahmed0',
  providerLabel: 'Currency API (open exchange-rate dataset)',
  sourceUrl: 'https://github.com/fawazahmed0/exchange-api',
  fetchedAt: new Date().toISOString(),
  base: BASE,
  startDate: results[0].date,
  endDate: results[results.length - 1].date,
  tradingDays: results.length,
  currencies: ['GYD'],
  missingDays: days.length - results.length,
  rates,
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(output)}\n`, 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`Coverage ${output.startDate} .. ${output.endDate} (${output.missingDays} days absent)`);
