import { useMemo, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../state/AppContext';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Segmented,
  Select,
  cn,
} from '../components/ui';
import { ChartTooltip } from '../components/charts';
import { accountTotals, categoryTotals, summariseCashFlow } from '../lib/ledger';
import {
  addMonthsToKey,
  currentMonthKey,
  formatMonthKey,
  monthKey,
  monthKeysBetween,
  monthRange,
  yearRange,
} from '../lib/dates';
import { downloadTextFile, toCsv } from '../lib/csv';

type View = 'monthly' | 'yearly';

/**
 * The calendar year, captured once at module load.
 *
 * Calling `new Date()` during render makes output depend on an impure value:
 * two renders can disagree, and React may render a component more often than
 * it mounts. A module constant is stable for the session and is recomputed on
 * the next page load.
 */
const CURRENT_YEAR = new Date().getFullYear();

export function ReportsPage() {
  const {
    converted,
    settings,
    formatReporting,
    categoryMap,
    accountMap,
    transactions,
    currencyMap,
    reportingCurrency,
  } = useApp();

  const [view, setView] = useState<View>('monthly');
  const [month, setMonth] = useState(() => currentMonthKey());
  const [year, setYear] = useState(() => new Date().getFullYear());

  const range = useMemo(
    () => (view === 'monthly' ? monthRange(month) : yearRange(year)),
    [view, month, year],
  );

  const scopedConverted = useMemo(
    () =>
      converted.filter(
        (item) => item.transaction.date >= range.start && item.transaction.date <= range.end,
      ),
    [converted, range],
  );

  const summary = useMemo(() => summariseCashFlow(scopedConverted), [scopedConverted]);
  const savingsRate =
    summary.income === 0n ? 0 : Number((summary.net * 10000n) / summary.income) / 100;

  const expenseByCategory = useMemo(
    () => categoryTotals(scopedConverted, 'expense', categoryMap),
    [scopedConverted, categoryMap],
  );
  const incomeByCategory = useMemo(
    () => categoryTotals(scopedConverted, 'income', categoryMap),
    [scopedConverted, categoryMap],
  );
  const byAccount = useMemo(
    () => accountTotals(scopedConverted, accountMap),
    [scopedConverted, accountMap],
  );

  /**
   * Monthly view charts day by day; yearly view charts month by month.
   * Buckets are built from the calendar so empty days/months still appear.
   */
  const seriesForScope = useMemo(() => {
    const buckets = new Map<string, { income: bigint; expense: bigint }>();

    if (view === 'monthly') {
      const days = Number(range.end.slice(8, 10));
      for (let day = 1; day <= days; day += 1) {
        buckets.set(`${month}-${String(day).padStart(2, '0')}`, { income: 0n, expense: 0n });
      }
    } else {
      for (const key of monthKeysBetween(range.start, range.end)) {
        buckets.set(key, { income: 0n, expense: 0n });
      }
    }

    for (const item of scopedConverted) {
      if (item.transaction.type === 'transfer') continue;
      if (item.convertedAmount === null) continue;
      const key =
        view === 'monthly' ? item.transaction.date : monthKey(item.transaction.date);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      if (item.transaction.type === 'income') bucket.income += item.convertedAmount;
      else bucket.expense += item.convertedAmount;
    }

    return [...buckets.entries()].map(([key, bucket]) => {
      const label =
        view === 'monthly'
          ? String(Number(key.slice(8, 10)))
          : formatMonthKey(key, 'MMM');
      return {
        key,
        label,
        fullLabel: view === 'monthly' ? key : formatMonthKey(key, 'MMMM yyyy'),
        income: Number(bucket.income) / 100,
        expense: Number(bucket.expense) / 100,
        net: Number(bucket.income - bucket.expense) / 100,
        rawIncome: bucket.income,
        rawExpense: bucket.expense,
        rawNet: bucket.income - bucket.expense,
      };
    });
  }, [scopedConverted, view, month, range]);

  const cumulative = useMemo(() => {
    let running = 0;
    return seriesForScope.map((point) => {
      running += Number(point.rawNet) / 100;
      return { ...point, cumulative: running };
    });
  }, [seriesForScope]);

  const yearlyComparison = useMemo(() => {
    const byYear = new Map<number, { income: bigint; expense: bigint }>();
    for (const item of converted) {
      if (item.transaction.type === 'transfer') continue;
      if (item.convertedAmount === null) continue;
      const y = Number(item.transaction.date.slice(0, 4));
      const bucket = byYear.get(y) ?? { income: 0n, expense: 0n };
      if (item.transaction.type === 'income') bucket.income += item.convertedAmount;
      else bucket.expense += item.convertedAmount;
      byYear.set(y, bucket);
    }
    return [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([y, bucket]) => ({
        year: y,
        income: Number(bucket.income) / 100,
        expense: Number(bucket.expense) / 100,
        net: Number(bucket.income - bucket.expense) / 100,
        rawIncome: bucket.income,
        rawExpense: bucket.expense,
      }));
  }, [converted]);

  const topPayees = useMemo(() => {
    const map = new Map<string, { total: bigint; count: number }>();
    for (const item of scopedConverted) {
      if (item.transaction.type !== 'expense') continue;
      if (item.convertedAmount === null) continue;
      const key = item.transaction.payee?.trim() || 'Unknown';
      const bucket = map.get(key) ?? { total: 0n, count: 0 };
      bucket.total += item.convertedAmount;
      bucket.count += 1;
      map.set(key, bucket);
    }
    return [...map.entries()]
      .map(([payee, value]) => ({ payee, ...value }))
      .sort((a, b) => Number(b.total - a.total))
      .slice(0, 8);
  }, [scopedConverted]);

  const currencyBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; original: bigint }>();
    for (const item of scopedConverted) {
      const code = item.transaction.currency;
      const bucket = map.get(code) ?? { count: 0, original: 0n };
      bucket.count += 1;
      bucket.original += BigInt(item.transaction.amount);
      map.set(code, bucket);
    }
    return [...map.entries()]
      .map(([code, value]) => ({ code, ...value }))
      .sort((a, b) => b.count - a.count);
  }, [scopedConverted]);

  const exportReportCsv = () => {
    const rangeLabel = view === 'monthly' ? month : String(year);
    const rows: (string | number)[][] = [
      ['Pocket Ledger report', rangeLabel],
      ['Reporting currency', settings.defaultCurrency],
      ['Generated', new Date().toISOString()],
      [],
      ['Metric', `Amount (${settings.defaultCurrency})`],
      ['Income', minorString(summary.income, reportingCurrency?.exponent ?? 2)],
      ['Expenses', minorString(summary.expense, reportingCurrency?.exponent ?? 2)],
      ['Net cash flow', minorString(summary.net, reportingCurrency?.exponent ?? 2)],
      ['Savings rate (%)', savingsRate.toFixed(2)],
      [],
      ['Category', 'Type', `Amount (${settings.defaultCurrency})`, 'Transactions'],
      ...expenseByCategory.map((item) => [
        item.name,
        'expense',
        minorString(item.total, reportingCurrency?.exponent ?? 2),
        item.count,
      ]),
      ...incomeByCategory.map((item) => [
        item.name,
        'income',
        minorString(item.total, reportingCurrency?.exponent ?? 2),
        item.count,
      ]),
      [],
      ['Month', 'Income', 'Expenses', 'Net'],
      ...seriesForScope.map((point) => [
        point.key,
        (Number(point.rawIncome) / 100).toFixed(2),
        (Number(point.rawExpense) / 100).toFixed(2),
        (Number(point.rawNet) / 100).toFixed(2),
      ]),
      [],
      ['Note', 'Net cash flow is recorded income minus recorded expenses. It is not an account balance.'],
    ];
    downloadTextFile(
      `pocket-ledger-report-${rangeLabel}.csv`,
      toCsv(rows),
    );
  };

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const transaction of transactions) years.add(Number(transaction.date.slice(0, 4)));
    years.add(CURRENT_YEAR);
    return [...years].sort((a, b) => b - a);
  }, [transactions]);

  const hasData = scopedConverted.length > 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly' },
          ]}
        />

        {view === 'monthly' ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth((current) => addMonthsToKey(current, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[132px] text-center text-sm font-semibold text-text">
              {formatMonthKey(month, 'MMMM yyyy')}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() => setMonth((current) => addMonthsToKey(current, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : (
          <Field label="" className="w-[132px]">
            <Select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {yearOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!hasData ? null : (
            <Badge tone="neutral">
              {scopedConverted.length} transaction{scopedConverted.length === 1 ? '' : 's'}
            </Badge>
          )}
          <Button variant="secondary" size="sm" onClick={exportReportCsv} disabled={!hasData}>
            <Download className="size-3.5" />
            Export report
          </Button>
        </div>
      </Card>

      {!hasData ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="size-6" />}
            title={`No activity in ${view === 'monthly' ? formatMonthKey(month, 'MMMM yyyy') : year}`}
            description="Pick another period, or add transactions to build this report."
          />
        </Card>
      ) : (
        <>
          {/* Headline metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Income"
              value={formatReporting(summary.income)}
              tone="income"
              sub={`${incomeByCategory.length} source${incomeByCategory.length === 1 ? '' : 's'}`}
              icon={<TrendingUp className="size-4" />}
            />
            <MetricCard
              label="Expenses"
              value={formatReporting(summary.expense)}
              tone="expense"
              sub={`${expenseByCategory.length} categor${expenseByCategory.length === 1 ? 'y' : 'ies'}`}
              icon={<TrendingDown className="size-4" />}
            />
            <MetricCard
              label="Net cash flow"
              value={formatReporting(summary.net, { showSign: true })}
              tone={summary.net >= 0n ? 'income' : 'expense'}
              sub="Recorded income − expenses"
            />
            <MetricCard
              label="Savings rate"
              value={`${savingsRate.toFixed(1)}%`}
              tone={savingsRate >= 0 ? 'income' : 'expense'}
              sub="Of income kept"
            />
          </div>

          {(summary.approximateCount > 0 || summary.unconvertedCount > 0) ? (
            <div className="rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-[12.5px] text-text-soft">
              {summary.approximateCount > 0 ? (
                <p>
                  {summary.approximateCount} transaction
                  {summary.approximateCount === 1 ? '' : 's'} used a carried-forward rate because no
                  rate was published on the exact date.
                </p>
              ) : null}
              {summary.unconvertedCount > 0 ? (
                <p className="text-warning">
                  {summary.unconvertedCount} transaction
                  {summary.unconvertedCount === 1 ? '' : 's'} had no available historical rate and
                  {summary.unconvertedCount === 1 ? ' is' : ' are'} excluded from these totals.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Trend chart */}
          <Card>
            <CardHeader
              title={view === 'monthly' ? 'Daily cash flow' : 'Monthly cash flow'}
              subtitle={`All values in ${settings.defaultCurrency}, converted at each transaction's historical rate`}
              action={
                <div className="flex items-center gap-3 text-[11.5px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-income" /> Income
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-expense" /> Expenses
                  </span>
                </div>
              }
            />
            <div className="h-[300px] px-2 pt-4 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={seriesForScope} barGap={4} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--pl-border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--pl-muted)', fontSize: 11.5 }}
                    dy={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--pl-muted)', fontSize: 11.5 }}
                    width={58}
                    tickFormatter={(value) => compact(value)}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(value) => currencyShort(value, settings.defaultCurrency)}
                      />
                    }
                    cursor={{ fill: 'var(--pl-surface-2)' }}
                  />
                  <Bar dataKey="income" name="Income" fill="var(--pl-income)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="expense" name="Expenses" fill="var(--pl-expense)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Expense split */}
            <Card>
              <CardHeader title="Spending breakdown" subtitle="Expenses by category" />
              {expenseByCategory.length === 0 ? (
                <EmptyState className="py-10" title="No expenses" description="Nothing recorded for this period." />
              ) : (
                <>
                  <div className="h-[200px] px-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={expenseByCategory.map((item) => ({
                            name: item.name,
                            value: Number(item.total) / 100,
                          }))}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={78}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {expenseByCategory.map((item) => (
                            <Cell key={item.categoryId ?? item.name} fill={item.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={
                            <ChartTooltip
                              formatter={(value) => currencyShort(value, settings.defaultCurrency)}
                            />
                          }
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="divide-y divide-border">
                    {expenseByCategory.slice(0, 8).map((item) => (
                      <li key={item.categoryId ?? item.name} className="flex items-center gap-2.5 px-4 py-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-soft">
                          {item.name}
                        </span>
                        <span className="pl-tabular text-[11px] text-muted">{item.share.toFixed(0)}%</span>
                        <span className="pl-tabular w-[92px] text-right text-[12.5px] font-medium text-text">
                          {formatReporting(item.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            {/* Income split */}
            <Card>
              <CardHeader title="Income breakdown" subtitle="Where the money came from" />
              {incomeByCategory.length === 0 ? (
                <EmptyState className="py-10" title="No income" description="Nothing recorded for this period." />
              ) : (
                <ul className="divide-y divide-border">
                  {incomeByCategory.map((item) => (
                    <li key={item.categoryId ?? item.name} className="flex items-center gap-2.5 px-4 py-2.5">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-text-soft">{item.name}</p>
                        <p className="text-[11px] text-muted">
                          {item.count} {item.count === 1 ? 'transaction' : 'transactions'}
                        </p>
                      </div>
                      <span className="pl-tabular text-[13px] font-medium text-income">
                        {formatReporting(item.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Cumulative */}
            <Card>
              <CardHeader
                title="Cumulative net cash flow"
                subtitle="Running total of recorded income minus expenses"
              />
              <div className="h-[250px] px-2 pt-4 pb-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cumulative} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pl-border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--pl-muted)', fontSize: 11.5 }}
                      dy={6}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--pl-muted)', fontSize: 11.5 }}
                      width={58}
                      tickFormatter={(value) => compact(value)}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          formatter={(value) => currencyShort(value, settings.defaultCurrency)}
                        />
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulative"
                      name="Cumulative net"
                      stroke="var(--pl-primary)"
                      strokeWidth={2.25}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Accounts */}
            <Card>
              <CardHeader
                title="By account"
                subtitle="Recorded income and expenses per account. Transfers are excluded, so an account funded mainly by transfers can show a negative net while its balance is healthy."
              />
              {byAccount.length === 0 ? (
                <EmptyState className="py-10" title="No activity" description="No transactions in this period." />
              ) : (
                <ul className="divide-y divide-border">
                  {byAccount.map((entry) => (
                    <li key={entry.accountId} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-medium text-text">{entry.name}</p>
                        <p
                          className={cn(
                            'pl-tabular text-[13px] font-semibold',
                            entry.net >= 0n ? 'text-income' : 'text-expense',
                          )}
                        >
                          {formatReporting(entry.net, { showSign: true })}
                        </p>
                      </div>
                      <div className="mt-1 flex gap-4 text-[11.5px] text-muted">
                        <span>In {formatReporting(entry.income)}</span>
                        <span>Out {formatReporting(entry.expense)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Top payees */}
            <Card>
              <CardHeader title="Top payees" subtitle="Largest expense recipients" />
              {topPayees.length === 0 ? (
                <EmptyState className="py-10" title="No expenses" description="Nothing to rank." />
              ) : (
                <ul className="divide-y divide-border">
                  {topPayees.map((entry, index) => (
                    <li key={entry.payee} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="pl-tabular w-5 text-[12px] text-muted">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-text-soft">
                        {entry.payee}
                      </span>
                      <span className="text-[11px] text-muted">{entry.count}×</span>
                      <span className="pl-tabular text-[13px] font-medium text-text">
                        {formatReporting(entry.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Currency mix */}
            <Card>
              <CardHeader
                title="Currency mix"
                subtitle="Original denominations — never collapsed silently"
              />
              <ul className="divide-y divide-border">
                {currencyBreakdown.map((entry) => (
                  <li key={entry.code} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-surface-3 text-[11px] font-semibold text-text-soft">
                      {entry.code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-text-soft">
                        {formatMoneyExact(entry.original, currencyMap.get(entry.code)?.exponent ?? 2)}
                      </p>
                      <p className="text-[11px] text-muted">
                        {entry.count} transaction{entry.count === 1 ? '' : 's'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Yearly comparison (yearly view) */}
          {view === 'yearly' && yearlyComparison.length > 1 ? (
            <Card>
              <CardHeader title="Year over year" subtitle="All recorded years" />
              <div className="h-[280px] px-2 pt-4 pb-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearlyComparison} barGap={5} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--pl-border)" vertical={false} />
                    <XAxis
                      dataKey="year"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--pl-muted)', fontSize: 11.5 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--pl-muted)', fontSize: 11.5 }}
                      width={58}
                      tickFormatter={(value) => compact(value)}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          formatter={(value) => currencyShort(value, settings.defaultCurrency)}
                        />
                      }
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12, color: 'var(--pl-muted)', paddingTop: 8 }}
                    />
                    <Bar dataKey="income" name="Income" fill="var(--pl-income)" radius={[4, 4, 0, 0]} maxBarSize={44} />
                    <Bar dataKey="expense" name="Expenses" fill="var(--pl-expense)" radius={[4, 4, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}

          <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3">
            <FileJson className="mt-0.5 size-3.5 shrink-0 text-muted" />
            <p className="text-[11.5px] leading-relaxed text-muted">
              <strong className="font-medium text-text-soft">Net cash flow ≠ account balance.</strong>{' '}
              These figures are the income and expenses you recorded in this period. Your actual
              account balance also depends on opening balances, transfers between your own accounts
              and any activity you have not entered. See the Accounts section for balances computed
              from opening balances plus every recorded movement.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'income' | 'expense';
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium tracking-wide text-muted uppercase">{label}</span>
        {icon ? (
          <span
            className={cn(
              'flex size-7 items-center justify-center rounded-lg',
              tone === 'income' ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense',
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="pl-tabular mt-2 text-[22px] leading-none font-semibold text-text">{value}</p>
      <p className="mt-1.5 text-[11.5px] text-muted">{sub}</p>
    </Card>
  );
}

function compact(value: number | undefined): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toFixed(0)}k`;
  return String(Math.round(numeric));
}

function currencyShort(value: number | undefined, currency: string): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(numeric);
}

function minorString(amount: bigint, exponent: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const scale = 10n ** BigInt(exponent);
  const whole = (abs / scale).toString();
  const fraction = exponent > 0 ? `.${(abs % scale).toString().padStart(exponent, '0')}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function formatMoneyExact(amount: bigint, exponent: number): string {
  return minorString(amount, exponent);
}
