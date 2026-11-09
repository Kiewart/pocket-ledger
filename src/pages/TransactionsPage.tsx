import { useMemo, useState } from 'react';
import { Download, Filter, Plus, Receipt, Search, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../state/AppContext';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Segmented,
  Select,
  cn,
} from '../components/ui';
import { TransactionDialog } from '../components/TransactionDialog';
import { TransactionRow } from '../components/TransactionRow';
import { summariseCashFlow } from '../lib/ledger';
import { matchesSearch } from '../lib/transactions';
import { downloadTextFile, toCsv } from '../lib/csv';
import { addMonthsToKey, currentMonthKey, monthRange } from '../lib/dates';
import type { TransactionType } from '../db/schema';

type SortKey = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'payee-asc';
type TypeFilter = 'all' | TransactionType;

export function TransactionsPage() {
  const {
    converted,
    categories,
    accounts,
    settings,
    formatReporting,
    currencyMap,
    categoryMap,
    reportingCurrency,
    transactions,
  } = useApp();

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [showFilters, setShowFilters] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const activeCurrencies = useMemo(() => {
    const codes = new Set(transactions.map((transaction) => transaction.currency));
    return [...codes].sort();
  }, [transactions]);

  const activeFilterCount = [
    typeFilter !== 'all',
    categoryFilter !== 'all',
    accountFilter !== 'all',
    currencyFilter !== 'all',
    fromDate !== '',
    toDate !== '',
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    const result = converted.filter((item) => {
      const transaction = item.transaction;
      if (!matchesSearch(transaction, query)) return false;
      if (typeFilter !== 'all' && transaction.type !== typeFilter) return false;
      if (categoryFilter !== 'all') {
        if (categoryFilter === '__none__') {
          if (transaction.categoryId) return false;
        } else if (transaction.categoryId !== categoryFilter) {
          return false;
        }
      }
      if (accountFilter !== 'all') {
        if (transaction.accountId !== accountFilter && transaction.toAccountId !== accountFilter) {
          return false;
        }
      }
      if (currencyFilter !== 'all' && transaction.currency !== currencyFilter) return false;
      if (fromDate && transaction.date < fromDate) return false;
      if (toDate && transaction.date > toDate) return false;
      return true;
    });

    const compare = (a: (typeof result)[number], b: (typeof result)[number]) => {
      switch (sort) {
        case 'date-asc':
          return a.transaction.date < b.transaction.date ? -1 : a.transaction.date > b.transaction.date ? 1 : 0;
        case 'amount-asc':
          return Number(b.transaction.amount - a.transaction.amount);
        case 'amount-desc':
          return Number(a.transaction.amount - b.transaction.amount);
        case 'payee-asc': {
          const left = (a.transaction.payee ?? a.transaction.description ?? '').toLowerCase();
          const right = (b.transaction.payee ?? b.transaction.description ?? '').toLowerCase();
          return left.localeCompare(right);
        }
        case 'date-desc':
        default: {
          if (a.transaction.date !== b.transaction.date) {
            return a.transaction.date < b.transaction.date ? 1 : -1;
          }
          return b.transaction.createdAt - a.transaction.createdAt;
        }
      }
    };

    return [...result].sort(compare);
  }, [converted, query, typeFilter, categoryFilter, accountFilter, currencyFilter, fromDate, toDate, sort]);

  const summary = useMemo(() => summariseCashFlow(filtered), [filtered]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const item of filtered.slice(page * pageSize, page * pageSize + pageSize)) {
      const key = item.transaction.date;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const resetFilters = () => {
    setTypeFilter('all');
    setCategoryFilter('all');
    setAccountFilter('all');
    setCurrencyFilter('all');
    setFromDate('');
    setToDate('');
    setPage(0);
  };

  const exportCsv = () => {
    const header = [
      'Date',
      'Type',
      `Amount (${'original'})`,
      'Currency',
      `Amount (${settings.defaultCurrency})`,
      'Rate date',
      'Rate',
      'Rate source',
      'Category',
      'Account',
      'To account',
      'Payee',
      'Description',
      'Tags',
      'Status',
    ];
    const rows = filtered.map((item) => {
      const transaction = item.transaction;
      return [
        transaction.date,
        transaction.type,
        minorString(transaction.amount, currencyMap.get(transaction.currency)?.exponent ?? 2),
        transaction.currency,
        item.convertedAmount === null
          ? ''
          : minorString(item.convertedAmount, reportingCurrency?.exponent ?? 2),
        item.rate?.rateDate ?? '',
        item.rate ? scaledRateText(item.rate.rate) : '',
        item.rate ? `${item.rate.source}/${item.rate.provider}` : 'unavailable',
        categoryMap.get(transaction.categoryId ?? '')?.name ?? '',
        accountMapName(accounts, transaction.accountId),
        transaction.toAccountId ? accountMapName(accounts, transaction.toAccountId) : '',
        transaction.payee ?? '',
        transaction.description ?? '',
        (transaction.tags ?? []).join('|'),
        transaction.status,
      ];
    });
    downloadTextFile(
      `pocket-ledger-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([header, ...rows]),
    );
  };

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">Showing</p>
          <p className="pl-tabular mt-1 text-xl font-semibold text-text">{filtered.length}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            of {transactions.length} transaction{transactions.length === 1 ? '' : 's'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">Income</p>
          <p className="pl-tabular mt-1 text-xl font-semibold text-income">
            {formatReporting(summary.income)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">Excludes transfers</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">Expenses</p>
          <p className="pl-tabular mt-1 text-xl font-semibold text-expense">
            {formatReporting(summary.expense)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">Excludes transfers</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">
            Net cash flow
          </p>
          <p
            className={cn(
              'pl-tabular mt-1 text-xl font-semibold',
              summary.net >= 0n ? 'text-text' : 'text-expense',
            )}
          >
            {formatReporting(summary.net, { showSign: true })}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {summary.unconvertedCount > 0
              ? `${summary.unconvertedCount} unconverted excluded`
              : 'Recorded cash flow only'}
          </p>
        </Card>
      </div>

      <Card>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search payee, description, tags…"
              className="pl-9"
              aria-label="Search transactions"
            />
          </div>

          <Segmented
            value={typeFilter}
            onChange={(value) => {
              setTypeFilter(value);
              setPage(0);
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
            className="hidden sm:inline-flex"
          />

          <Button
            variant="secondary"
            onClick={() => setShowFilters((current) => !current)}
            className="relative"
          >
            <SlidersHorizontal className="size-4" />
            Filters
            {activeFilterCount > 0 ? (
              <span className="ml-0.5 inline-flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>

          <Button variant="secondary" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="size-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>

          <Button onClick={() => setComposerOpen(true)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </div>

        {/* Mobile type filter */}
        <div className="border-b border-border px-4 py-2 sm:hidden">
          <Segmented
            value={typeFilter}
            onChange={(value) => {
              setTypeFilter(value);
              setPage(0);
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
            className="w-full [&>button]:flex-1"
          />
        </div>

        {/* Filter panel */}
        {showFilters ? (
          <div className="border-b border-border bg-surface-2 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Category">
                <Select
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All categories</option>
                  <option value="__none__">Uncategorised</option>
                  {categories
                    .filter((category) => !category.archived)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Account">
                <Select
                  value={accountFilter}
                  onChange={(event) => {
                    setAccountFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All accounts</option>
                  {accounts
                    .filter((account) => !account.archived)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Currency">
                <Select
                  value={currencyFilter}
                  onChange={(event) => {
                    setCurrencyFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All currencies</option>
                  {activeCurrencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From date">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    setFromDate(event.target.value);
                    setPage(0);
                  }}
                />
              </Field>
              <Field label="To date">
                <Input
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    setToDate(event.target.value);
                    setPage(0);
                  }}
                />
              </Field>
              <Field label="Sort by">
                <Select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="amount-desc">Largest amount</option>
                  <option value="amount-asc">Smallest amount</option>
                  <option value="payee-asc">Payee A–Z</option>
                </Select>
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <X className="size-3.5" />
                Clear filters
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {monthShortcuts().map((shortcut) => (
                  <button
                    key={shortcut.label}
                    type="button"
                    onClick={() => {
                      setFromDate(shortcut.from);
                      setToDate(shortcut.to);
                      setPage(0);
                    }}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-[11.5px] font-medium text-text-soft hover:bg-surface-3"
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Active chips */}
        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
            <Filter className="size-3 text-muted" />
            {typeFilter !== 'all' ? (
              <Chip label={`Type: ${typeFilter}`} onClear={() => setTypeFilter('all')} />
            ) : null}
            {categoryFilter !== 'all' ? (
              <Chip
                label={`Category: ${categoryFilter === '__none__' ? 'Uncategorised' : categoryMap.get(categoryFilter)?.name ?? 'Unknown'}`}
                onClear={() => setCategoryFilter('all')}
              />
            ) : null}
            {accountFilter !== 'all' ? (
              <Chip
                label={`Account: ${accounts.find((account) => account.id === accountFilter)?.name ?? 'Unknown'}`}
                onClear={() => setAccountFilter('all')}
              />
            ) : null}
            {currencyFilter !== 'all' ? (
              <Chip label={`Currency: ${currencyFilter}`} onClear={() => setCurrencyFilter('all')} />
            ) : null}
            {fromDate ? <Chip label={`From ${fromDate}`} onClear={() => setFromDate('')} /> : null}
            {toDate ? <Chip label={`To ${toDate}`} onClear={() => setToDate('')} /> : null}
          </div>
        ) : null}

        {/* List */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title={transactions.length === 0 ? 'No transactions yet' : 'No matches'}
            description={
              transactions.length === 0
                ? 'Add your first income or expense to get started.'
                : 'Try clearing the search or filters to see more transactions.'
            }
            action={
              transactions.length === 0 ? (
                <Button onClick={() => setComposerOpen(true)}>
                  <Plus className="size-4" />
                  Add transaction
                </Button>
              ) : (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div>
            {grouped.map(([date, items]) => (
              <section key={date}>
                <header className="sticky top-16 z-10 flex items-center justify-between border-y border-border bg-surface-2/95 px-4 py-1.5 backdrop-blur-sm">
                  <span className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                    {formatGroupDate(date)}
                  </span>
                  <span className="pl-tabular text-[11.5px] text-muted">
                    {formatReporting(
                      items.reduce((total, item) => total + item.signedConverted, 0n),
                      { showSign: true },
                    )}
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {items.map((item) => (
                    <TransactionRow key={item.transaction.id} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* Pagination */}
        {filtered.length > pageSize ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-[12px] text-muted">
              Showing {page * pageSize + 1}–
              {Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </Button>
              <span className="text-[12px] text-muted">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <p className="px-1 text-[11.5px] leading-relaxed text-muted">
        Every amount is kept in its original currency. Reporting values use the exchange rate
        published on or before each transaction's own date — never today's rate as a silent
        substitute. Transfers between your own accounts are excluded from income and expenses.
      </p>

      <TransactionDialog open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11.5px] font-medium text-text-soft">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="text-muted hover:text-text"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

function formatGroupDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function minorString(amount: number | bigint, exponent: number): string {
  const value = typeof amount === 'bigint' ? amount : BigInt(Math.trunc(amount));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(exponent);
  const whole = (abs / scale).toString();
  const fraction = exponent > 0 ? `.${(abs % scale).toString().padStart(exponent, '0')}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function scaledRateText(scaled: bigint): string {
  const whole = scaled / 10n ** 12n;
  const fraction = (scaled % 10n ** 12n).toString().padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function accountMapName(
  accounts: { id: string; name: string }[],
  id: string,
): string {
  return accounts.find((account) => account.id === id)?.name ?? '';
}

function monthShortcuts(): { label: string; from: string; to: string }[] {
  const current = currentMonthKey();
  const result = [];
  for (let i = 0; i < 3; i++) {
    const key = addMonthsToKey(current, -i);
    const range = monthRange(key);
    const label = i === 0 ? 'This month' : i === 1 ? 'Last month' : 'Two months ago';
    result.push({ label, from: range.start, to: range.end });
  }
  return result;
}
