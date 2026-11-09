# Pocket Ledger

A local-first, multi-currency personal finance app. React + TypeScript + Tailwind CSS +
Recharts + IndexedDB (Dexie.js), with decimal-safe money arithmetic and a real
historical exchange-rate engine.

No account, no server, no telemetry. Data lives in your browser's IndexedDB until you
export it.

---

## Why this exists

Most personal finance apps get two things subtly wrong:

1. **Floating point money.** `0.1 + 0.2 !== 0.3` in JavaScript. Over a year of
   transactions that drift becomes real, and it silently corrupts every total.
2. **Historical rates.** When you log a €50 dinner from last March, it must be valued
   with *March's* rate. Quietly applying today's rate produces a number that looks
   plausible and is wrong. Worse, applying a rate from *after* the transaction date is
   meaningless.

Pocket Ledger is built so neither can happen silently.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

On first launch the app seeds a catalogue of 44 currencies, real ECB rate history, and a
14-month sample dataset so every screen has something to show. Wipe it any time from
**Settings → Data → Delete all data**.

```bash
npm run build        # type-check + production bundle (then postbuild SPA fallback copy)
npm run preview      # serve the production build
npm test             # run the test suite once
npm run test:watch   # watch mode
npm run test:coverage
npm run typecheck    # tsc only, no bundle
npm run lint
npm run rates:refresh  # re-download the bundled ECB rate history
npm run rates:refresh:gyd  # re-download the bundled GYD rate history
```

Requires Node 20+. Built and tested on Node 26.

### Running the production build on its own

`npm run build` writes a fully static site to `dist/`. It has no server-side component, so any
static file server works:

```bash
npm run build
npm run preview        # http://localhost:4173
# or, for the dist folder alone:
npx serve dist
```

The app uses history-based routing, so the host must fall back to `index.html` for unknown paths
or deep links such as `/transactions` will 404 on a hard refresh. The build handles this for you:

- `dist/_redirects` — rewrite rules for Netlify and Cloudflare Pages.
- `dist/404.html` — a copy of `index.html` for hosts that resolve unknown paths through a 404
  document (GitHub Pages, plain S3/nginx roots). Written by `scripts/postbuild.mjs`, which runs
  automatically after every `npm run build`.

All data lives in the browser's IndexedDB, so a hosted copy and a locally served copy keep
completely separate ledgers.


---

## The two numbers that matter

Pocket Ledger is deliberately explicit about the difference between them.

### Net cash flow

*Income you recorded minus expenses you recorded*, over a period. Transfers between your
own accounts are excluded from both sides, so moving $500 from checking to savings never
appears as $500 of income.

### Account balance

*Each account's opening balance + every recorded movement against that account*, held in
the account's own currency. A transfer creates two legs — an outflow from the source and
an inflow to the destination — so the money keeps its value and changes location without
ever being double counted.

These can legitimately disagree. A $0 net cash flow month can still see balances move
(you transferred money), and a healthy balance can hide a negative cash flow month (you
dipped into savings). **The app never presents cash flow as an account balance**, and the
Reports page says so in plain language.

The app also does not pretend to know your real bank balance: it is only as complete as
the transactions you enter. There is no bank connection.

---

## Decimal-safe money

Every monetary value is an integer count of **minor units** (cents, pence, yen) held in a
`bigint`:

```ts
type Minor = bigint;                     // 12.34 USD => 1234n
parseAmountToMinor('12.34', 2)           // 1234n
minorToDecimalString(1234n, 2)           // "12.34"
convertMinorWithRate(10000n, 2, 2, r)    // 100.00 USD * r
```

There is no `number` anywhere in the money path. Rates are stored as scaled `bigint`s with
12 decimal places (`RATE_SCALE = 10n ** 12n`), and the single rounding step in the entire
system is **half-up, away from zero**, applied once per conversion.

Currency precision is per-currency and not assumed to be two:

| Currency | Exponent | Example |
| --- | --- | --- |
| USD, EUR, GBP | 2 | `$12.34` |
| JPY, KRW, ISK, CLP, VND | 0 | `¥15,846` |
| KWD, BHD, OMR, JOD, TND | 3 | `KWD 1.234` |

Amounts larger than `Number.MAX_SAFE_INTEGER` remain exact.

---

## Historical rate engine

The engine resolves a rate for `from → to` on a specific date, in this order:

| # | Rule | Result kind |
| --- | --- | --- |
| 1 | Same currency | `identity` |
| 2 | Published rate for the exact date | `direct` |
| 3 | Inverse of a rate for the exact date | `inverse` |
| 4 | Two same-date rates combined via USD, EUR, GBP or CHF | `triangulated` |
| 5 | Newest rate **on or before** the date, within the carry-forward window | `stale` |
| 6 | Nothing qualifies | `null` → **unconverted** |

### Guarantees

- **Never forward-dated.** A rate published after the transaction date is never used. It
  cannot describe that date's value.
- **Never today's rate as a silent substitute.** If no rate qualifies, the amount is
  reported as unconverted and *excluded from converted totals* rather than guessed.
- **Carried-forward rates are labelled.** The UI shows a `1d`-style badge with a tooltip
  naming the real rate date and the day offset.
- **Every resolved rate carries provenance**: `source` (`manual` / `api` / `seed` /
  `import`), `provider`, `rateDate`, `daysStale`, and `via` for triangulation.

The carry-forward window defaults to 7 days (configurable 0–60) precisely so weekends and
bank holidays work without letting a months-old rate silently apply. A 0-day window means
"exact date only".

### Where rates come from

- **Bundled history (offline).** `src/data/seed-rates.json` holds ~8,500 real daily
  European Central Bank reference rates for 28 currencies covering ~14 months. Generated
  by `scripts/fetch-seed-rates.mjs` from `frankfurter.dev`; nothing in it is synthetic.
- **Guyanese dollar.** The ECB does not publish GYD, so it ships separately in
  `src/data/seed-rates-gyd.json` (~430 dated USD→GYD rates over the same window),
  generated by `scripts/fetch-gyd-rates.mjs`. Rows keep their own `fawazahmed0`
  provider label rather than being folded into the ECB set.
- **Manual rates.** Always win for the same pair and date, and are never overwritten by a
  sync.
- **Optional API sync.** Off by default. When enabled, fetches from Frankfurter (no key)
  or a custom endpoint using `{date}`, `{base}` and `{symbols}` placeholders, and caches
  into the same table. Disabled means zero network requests.

```bash
node scripts/fetch-seed-rates.mjs            # ECB reference rates (npm run rates:refresh)
node scripts/fetch-gyd-rates.mjs             # bundled GYD history
```

---

## Data model

IndexedDB via Dexie. Schema version **2**, with a real upgrade path (see below).

| Table | Key | Indexes | Purpose |
| --- | --- | --- | --- |
| `currencies` | `code` | `enabled` | ISO 4217 catalogue + minor-unit exponent |
| `categories` | `id` | `name`, `kind`, `archived` | Income/expense categories |
| `accounts` | `id` | `currency`, `archived` | Named accounts with opening balances |
| `transactions` | `id` | `date`, `type`, `categoryId`, `accountId`, `currency`, `[date+type]`, `[accountId+date]` | The ledger |
| `rates` | `id` = `BASE~QUOTE~DATE` | `base`, `quote`, `date`, `[base+quote+date]`, `[base+quote]`, `[quote+base]` | Rate cache with provenance |
| `budgets` | `id` | `month`, `categoryId`, `[month+categoryId]` | Monthly per-category limits |
| `settings` | `id` (`'app'`) | — | Single settings row |
| `meta` | `key` | — | Schema version, install marker |

A transaction stores `{ amount: number, currency: string }` where `amount` is an integer
minor-unit count. **The original amount and currency are never mutated.** Converted values
are derived at read time and never written back.

### Migrations

```ts
this.version(1).stores({ /* … */ });

this.version(2)
  .stores({
    budgets: '&id, month, categoryId, [month+categoryId]',
    transactions: '&id, date, type, …',
  })
  .upgrade(async (tx) => {
    // Backfill `tags` on rows written before it existed.
    await tx.table('transactions').toCollection().modify((t) => {
      if (!Array.isArray(t.tags)) t.tags = [];
    });
  });
```

Dexie applies pending versions in order on open, inside a transaction. `SCHEMA_VERSION` is
mirrored into `meta`, and backups carry it so a file from a *newer* app is refused rather
than partially imported.

---

## Screens

| Route | What it does |
| --- | --- |
| `/` Dashboard | Portfolio balance, month KPIs with deltas, income vs spending, category split, net cash-flow trend, budget health, recent activity, rate transparency strip |
| `/transactions` | Search, type/category/account/currency/date filters, five sort orders, date grouping with per-day net, pagination, CSV export, full CRUD |
| `/budgets` | Month navigation, per-category limits, warning/over states, budget-vs-actual chart, unbudgeted spending, copy last month |
| `/reports` | Monthly (day-by-day) and yearly (month-by-month) views, category/income splits, cumulative net, per-account, top payees, currency mix, year-over-year, CSV export |
| `/currencies` | Account balances in native currency + converted, rate history browser with inverses, manual rate entry, sync, live engine resolution readout |
| `/settings` | Theme, locale, date format, reporting currency, carry-forward window, API config, alert threshold, categories, JSON backup/restore, sample data, wipe |

Fully responsive: sidebar on desktop, drawer + bottom navigation + floating action button
on mobile. Account balances switch from a table to cards below `md`. Light, dark, and
system themes.

---

## Budgets and alerts

Budgets are per category per month, stored in any currency. A budget in EUR is compared
against spending using the rate at the **end of the budget month** — the value the budget
was meant to cover — and reported as unconverted if that rate is unavailable.

Statuses: `under`, `warning` (≥ configurable threshold, default 80%), `over`, and
`unconverted`. Alerts surface on the dashboard and are computed from the same
historical-rate conversions as the reports, so an alert never depends on today's rate.

---

## Backup, restore and privacy

**Settings → Data** exports a self-describing JSON snapshot:

```json
{
  "format": "pocket-ledger-backup",
  "schemaVersion": 2,
  "exportedAt": "2026-11-07T20:00:00.000Z",
  "counts": { "transactions": 590, "rates": 8512, "…": 0 },
  "data": { "currencies": [], "categories": [], "accounts": [],
            "transactions": [], "rates": [], "budgets": [], "settings": [] }
}
```

Restore supports **replace** (wipe then import) and **merge** (upsert by id). Amounts are
imported verbatim in their original currencies — nothing is re-converted on import, because
the rates that applied are already in the file.

Local by default: no network calls unless you explicitly enable rate fetching. There is no
analytics, and the only outbound requests possible are rate-provider fetches.

### Designed for future sync

The record shapes are already sync-friendly and this was a deliberate constraint:

- Every row has a globally unique string id, not a database-assigned integer.
- Every row that can change carries `createdAt` / `updatedAt` epoch-ms timestamps.
- The backup envelope is a complete, versioned, portable snapshot of all tables.
- Converted values are **derived, never stored**, so a synced client recomputes them from
  its own cached rates rather than trusting a peer's arithmetic.
- Currency/rate rows are content-addressed by `BASE~QUOTE~DATE`, making last-write-wins
  merges safe.

A sync layer would add a `deviceId`/`revision` field and a merge function; no schema
redesign is required. That is not implemented, and nothing in the UI claims it is.

---

## Testing

```bash
npm test
```

```
Test Files  10 passed (10)
Tests     196 passed (196)
```

Coverage focuses on financial correctness rather than snapshot rendering:

- `money.test.ts` — parsing, per-currency exponents, half-up rounding, float traps
  (`1.005 → 101`, `4.35 → 435`), values beyond `MAX_SAFE_INTEGER`, formatting/grouping.
- `fx.test.ts` — identity, direct, inverse, triangulation, carry-forward selection,
  **forward-dating rejection**, staleness windows, unparsable/zero-rate rejection.
- `ledger.test.ts` — sign handling, transfer exclusion from cash flow, per-account legs,
  **no double counting across a cross-currency transfer**, value preservation, cash flow vs
  balance divergence, unconverted exclusion.
- `budgets.test.ts` — thresholds, over-budget, income/transfer exclusion, cross-currency
  budgets, unconvertible budgets, alert text.
- `dates.test.ts` — month ranges, leap years, DST-safe parsing, invalid dates, day/month
  enumeration. Includes a guard that month ranges are timezone-independent.
- `db.test.ts` — real IndexedDB queries through Dexie. Guards a compound-index
  inclusivity bug that once made the rate browser report 0 rates.
- `backup.test.ts` — validation, round trip, schema-version refusal, restore; plus
  transaction validation and search.
- `csv.test.ts` — RFC 4180 quoting round-trip through a parser, custom delimiters.
- `gyd.test.ts` — Guyanese dollar: ISO precision, dataset provenance, conversion both
  directions, no-rate rejection, and a guard that the bundled file declares a valid
  base currency and resolves through the engine.
- `seed.test.ts` — upgrade paths: a currency added in a later release reaches existing
  installs, user preferences are preserved, bundled datasets import once, and manual
  rates are never overwritten.

---

## Project structure

```
src/
  lib/
    money.ts        BigInt minor units, rounding, formatting
    rates.ts        Pure scaled-rate arithmetic
    fx.ts           RateEngine: resolution order + provenance
    fxApi.ts        Provider fetch, parsing, cache writes
    ledger.ts       Conversion, account legs, balances, aggregations
    budgets.ts      Budget evaluation and alerts
    transactions.ts Validation, normalisation, search
    backup.ts       JSON snapshot export/import
    dates.ts        Zone-free calendar math
    csv.ts          CSV generation and download
  db/
    schema.ts       Record types + SCHEMA_VERSION
    db.ts           Dexie class, indexes, migrations
    seed.ts         Currency catalogue, first-run, sample data
  data/
    catalog.ts      44 ISO 4217 currencies with correct exponents
    seed-rates.json Real ECB history (generated)
    seedData.ts     Deterministic 14-month sample dataset
  components/       UI primitives, layout, transaction dialog/row, charts
  pages/            One module per route
  state/            AppContext: live Dexie queries → derived ledger state
scripts/
  fetch-seed-rates.mjs
```

The layering is deliberate: `lib/` is pure and framework-free, so the financial logic is
testable without React and reusable by a future server or CLI.

---

## Known scope limits

Stated plainly so nothing here is mistaken for a stub:

- **No bank connections / imports.** Balances reflect manual entry only.
- **No recurring transactions.** The sample data includes repeating items; the app does
  not auto-generate them.
- **No cloud sync.** Local-only by design; see the sync notes above.
- **No multi-user or auth.** One local ledger.
- **Rate coverage follows the bundled providers.** ECB-reference currencies plus GYD.
  Other currencies can be used with manual rates. Excel/OFX ingestion, splits, and
  attachments are not implemented.
- **Budgets rollover is recorded, not compounded.** The flag is stored and displayed; it
  does not currently add the previous month's remainder to the next month's limit.

---

## License

MIT.
