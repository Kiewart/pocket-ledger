import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CircleDollarSign,
  Coins,
  PiggyBank,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../state/AppContext';
import { Badge, Button, Card, CardHeader, EmptyState, Progress, cn } from '../components/ui';
import { TransactionDialog } from '../components/TransactionDialog';
import { TransactionRow } from '../components/TransactionRow';
import {
  categoryTotals,
  monthlySeries,
  summariseCashFlow,
} from '../lib/ledger';
import { addMonthsToKey, currentMonthKey, formatMonthKey, lastMonthKeys, monthRange } from '../lib/dates';
import { buildAlerts, evaluateBudgets, budgetTotals } from '../lib/budgets';
import { ChartTooltip } from '../components/charts';

export function DashboardPage() {
  const {
    converted,
    transactions,
    settings,
    formatReporting,
    reportingCurrency,
    portfolio,
    balances,
    categoryMap,
    budgets,
    ledger,
    currencyMap,
    engine,
  } = useApp();

  const [composerOpen, setComposerOpen] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);

  const currentMonth = currentMonthKey();
  const previousMonth = addMonthsToKey(currentMonth, -1);

  const thisMonthConverted = useMemo(() => {
    const { start, end } = monthRange(currentMonth);
    return converted.filter((item) => item.transaction.date >= start && item.transaction.date <= end);
  }, [converted, currentMonth]);

  const previousMonthConverted = useMemo(() => {
    const { start, end } = monthRange(previousMonth);
    return converted.filter((item) => item.transaction.date >= start && item.transaction.date <= end);
  }, [converted, previousMonth]);

  const thisMonth = useMemo(() => summariseCashFlow(thisMonthConverted), [thisMonthConverted]);
  const previous = useMemo(() => summariseCashFlow(previousMonthConverted), [previousMonthConverted]);

  const savingsRate = thisMonth.income === 0n
    ? 0
    : Number(((thisMonth.net * 10000n) / thisMonth.income)) / 100;

  const trend = useMemo(() => {
    const keys = lastMonthKeys(currentMonth, 6);
    const series = monthlySeries(converted);
    const map = new Map(series.map((point) => [point.key, point]));
    return keys.map((key) => {
      const point = map.get(key);
      return {
        key,
        label: formatMonthKey(key, 'MMM'),
        fullLabel: formatMonthKey(key, 'MMMM yyyy'),
        income: Number(point?.income ?? 0n) / 100,
        expense: Number(point?.expense ?? 0n) / 100,
        net: Number(point?.net ?? 0n) / 100,
        rawIncome: point?.income ?? 0n,
        rawExpense: point?.expense ?? 0n,
      };
    });
  }, [converted, currentMonth]);

  const expenseCategories = useMemo(
    () =>
      categoryTotals(thisMonthConverted, 'expense', categoryMap)
        .slice(0, 6)
        .map((item) => ({
          ...item,
          value: Number(item.total) / 10 ** (reportingCurrency?.exponent ?? 2),
        })),
    [thisMonthConverted, categoryMap, reportingCurrency],
  );

  const monthBudgets = useMemo(
    () => budgets.filter((budget) => budget.month === currentMonth),
    [budgets, currentMonth],
  );

  const budgetStatuses = useMemo(
    () => evaluateBudgets(monthBudgets, thisMonthConverted, categoryMap, ledger, settings.budgetAlertThreshold),
    [monthBudgets, thisMonthConverted, categoryMap, ledger, settings.budgetAlertThreshold],
  );

  const budgetSummary = useMemo(() => budgetTotals(budgetStatuses), [budgetStatuses]);

  const alerts = useMemo(
    () =>
      buildAlerts(budgetStatuses, settings.defaultCurrency, (value) => formatReporting(value)),
    [budgetStatuses, settings.defaultCurrency, formatReporting],
  );

  const recentTransactions = useMemo(() => {
    // The store returns rows in primary-key order, not date order, so sort
    // explicitly. Newest date first, then most recently created.
    return [...converted]
      .sort((a, b) => {
        if (a.transaction.date !== b.transaction.date) {
          return a.transaction.date < b.transaction.date ? 1 : -1;
        }
        return b.transaction.createdAt - a.transaction.createdAt;
      })
      .slice(0, 7);
  }, [converted]);

  const topAccounts = useMemo(
    () =>
      [...balances]
        .filter((balance) => !balance.account.archived && balance.account.includeInTotal)
        .sort((a, b) => Number((b.convertedBalance ?? 0n) - (a.convertedBalance ?? 0n)))
        .slice(0, 4),
    [balances],
  );

  const approximateCount = thisMonth.approximateCount;
  const unconvertedCount = thisMonth.unconvertedCount;

  const incomeDelta = percentChange(thisMonth.income, previous.income);
  const expenseDelta = percentChange(thisMonth.expense, previous.expense);

  const hasData = transactions.length > 0;

  return (
    <div className="space-y-5">
      {/* Alerts */}
      {alerts.length > 0 && !alertDismissed ? (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-warning">
              {alerts.length === 1 ? '1 budget needs attention' : `${alerts.length} budgets need attention`}
            </p>
            <p className="mt-0.5 text-[12.5px] text-text-soft">
              {alerts.slice(0, 2).map((alert) => alert.message).join(' · ')}
              {alerts.length > 2 ? ` · and ${alerts.length - 2} more` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link to="/budgets">
              <Button variant="ghost" size="sm" className="text-warning hover:bg-warning/10">
                Review
              </Button>
            </Link>
            <button
              type="button"
              onClick={() => setAlertDismissed(true)}
              className="rounded-lg px-2 py-1 text-[12px] text-warning/80 hover:bg-warning/10"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Net worth + KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card className="relative col-span-2 overflow-hidden p-4 sm:col-span-3 sm:p-5">
          <div className="absolute -top-16 -right-14 size-40 rounded-full bg-primary/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium tracking-wide text-muted uppercase">
                Portfolio balance
              </span>
              {portfolio.approximate ? (
                <Badge tone="warning" icon={<RefreshCw className="size-2.5" />}>
                  Approx.
                </Badge>
              ) : null}
            </div>
            <p className="pl-tabular mt-2 text-[28px] leading-none font-semibold tracking-tight text-text">
              {formatReporting(portfolio.total)}
            </p>
            <p className="mt-2 text-[12px] text-muted">
              {portfolio.convertedCount} account{portfolio.convertedCount === 1 ? '' : 's'} in{' '}
              {settings.defaultCurrency}
              {portfolio.unconvertedCount > 0
                ? ` · ${portfolio.unconvertedCount} not convertible`
                : ''}
            </p>
            <Link
              to="/currencies"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              Account balances
              <ChevronRight className="size-3" />
            </Link>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <KpiCard
          label="Income this month"
          value={formatReporting(thisMonth.income)}
          delta={incomeDelta}
          deltaLabel="vs last month"
          tone="income"
          icon={<ArrowDownLeft className="size-4" />}
        />
        <KpiCard
          label="Spending this month"
          value={formatReporting(thisMonth.expense)}
          delta={expenseDelta}
          deltaLabel="vs last month"
          tone="expense"
          invertDelta
          icon={<ArrowUpRight className="size-4" />}
        />
        <KpiCard
          className="col-span-2 lg:col-span-1"
          label="Net cash flow"
          value={formatReporting(thisMonth.net, { showSign: true })}
          hint={
            thisMonth.income > 0n
              ? `${savingsRate.toFixed(0)}% of income kept`
              : 'No income recorded this month'
          }
          tone={thisMonth.net >= 0n ? 'income' : 'expense'}
          icon={<PiggyBank className="size-4" />}
        />
      </div>

      {(approximateCount > 0 || unconvertedCount > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-[12.5px] text-text-soft">
          <span className="inline-flex items-center gap-1.5 font-medium text-text">
            <Sparkles className="size-3.5 text-info" />
            Rate transparency
          </span>
          {approximateCount > 0 ? (
            <span>
              {approximateCount} transaction{approximateCount === 1 ? '' : 's'} converted with the
              most recent earlier rate (no rate published on the exact date).
            </span>
          ) : null}
          {unconvertedCount > 0 ? (
            <span className="text-warning">
              {unconvertedCount} transaction{unconvertedCount === 1 ? '' : 's'} could not be
              converted and {unconvertedCount === 1 ? 'is' : 'are'} excluded from totals.
            </span>
          ) : null}
          <Link to="/currencies" className="ml-auto font-medium text-primary hover:underline">
            Manage rates
          </Link>
        </div>
      )}

      {!hasData ? (
        <Card>
          <EmptyState
            icon={<CircleDollarSign className="size-6" />}
            title="No transactions yet"
            description="Add your first income or expense to see your cash flow, budgets and reports come to life."
            action={
              <Button onClick={() => setComposerOpen(true)}>
                <Plus className="size-4" />
                Add transaction
              </Button>
            }
          />
        </Card>
      ) : null}

      {/* Charts */}
      {hasData ? (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Income vs spending"
              subtitle="Last 6 months, converted to your reporting currency"
              action={
                <div className="flex items-center gap-3 text-[11.5px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-income" /> Income
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-expense" /> Spending
                  </span>
                </div>
              }
            />
            <div className="h-[264px] px-2 pt-4 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} barGap={5} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
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
                    width={56}
                    tickFormatter={(value) => compact(value)}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(value) => formatCompactCurrency(value, settings.defaultCurrency)}
                      />
                    }
                    cursor={{ fill: 'var(--pl-surface-2)' }}
                  />
                  <Bar dataKey="income" name="Income" fill="var(--pl-income)" radius={[5, 5, 0, 0]} maxBarSize={30} />
                  <Bar dataKey="expense" name="Spending" fill="var(--pl-expense)" radius={[5, 5, 0, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader title="Spending by category" subtitle={formatMonthKey(currentMonth, 'MMMM yyyy')} />
            {expenseCategories.length === 0 ? (
              <EmptyState
                className="py-10"
                icon={<Coins className="size-5" />}
                title="No spending recorded"
                description="Expenses for this month will appear here."
              />
            ) : (
              <>
                <div className="h-[186px] px-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expenseCategories}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={72}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {expenseCategories.map((entry) => (
                          <Cell key={entry.categoryId ?? entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={
                          <ChartTooltip
                            formatter={(value) => formatCompactCurrency(value, settings.defaultCurrency)}
                          />
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-1.5 px-4 pb-4">
                  {expenseCategories.slice(0, 4).map((category) => (
                    <li key={category.categoryId ?? category.name} className="flex items-center gap-2 text-[12.5px]">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-text-soft">{category.name}</span>
                      <span className="pl-tabular font-medium text-text">
                        {formatReporting(category.total)}
                      </span>
                      <span className="pl-tabular w-10 text-right text-muted">
                        {category.share.toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      ) : null}

      {/* Cash flow area + budgets */}
      {hasData ? (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Net cash flow trend"
              subtitle="Recorded income minus recorded expenses — not an account balance"
              action={
                <Link to="/reports">
                  <Button variant="ghost" size="sm">
                    Reports
                    <ChevronRight className="size-3.5" />
                  </Button>
                </Link>
              }
            />
            <div className="h-[220px] px-2 pt-4 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="netGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--pl-primary)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--pl-primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
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
                    width={56}
                    tickFormatter={(value) => compact(value)}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(value) => formatCompactCurrency(value, settings.defaultCurrency)}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="net"
                    name="Net"
                    stroke="var(--pl-primary)"
                    strokeWidth={2.25}
                    fill="url(#netGradient)"
                    dot={{ r: 2.5, fill: 'var(--pl-primary)', strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Budget health"
              subtitle={formatMonthKey(currentMonth, 'MMMM yyyy')}
              action={
                <Link to="/budgets">
                  <Button variant="ghost" size="sm">
                    Manage
                    <ChevronRight className="size-3.5" />
                  </Button>
                </Link>
              }
            />
            <div className="space-y-3 p-4">
              {monthBudgets.length === 0 ? (
                <EmptyState
                  className="py-8"
                  icon={<PiggyBank className="size-5" />}
                  title="No budgets set"
                  description="Create monthly budgets to get spending alerts."
                  action={
                    <Link to="/budgets">
                      <Button size="sm" variant="secondary">
                        Create a budget
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <>
                  <div className="rounded-xl bg-surface-2 p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12px] font-medium text-muted">Total spent</span>
                      <span className="pl-tabular text-sm font-semibold text-text">
                        {formatReporting(budgetSummary.spent)}
                        <span className="ml-1 text-[11.5px] font-normal text-muted">
                          / {formatReporting(budgetSummary.budgeted)}
                        </span>
                      </span>
                    </div>
                    <Progress
                      className="mt-2"
                      value={
                        budgetSummary.budgeted === 0n
                          ? 0
                          : Number((budgetSummary.spent * 10000n) / budgetSummary.budgeted) / 100
                      }
                      tone={
                        budgetSummary.spent > budgetSummary.budgeted ? 'expense' : 'primary'
                      }
                    />
                  </div>
                  <ul className="space-y-2.5">
                    {budgetStatuses
                      .slice()
                      .sort((a, b) => b.percent - a.percent)
                      .slice(0, 4)
                      .map((status) => (
                        <li key={status.budget.id}>
                          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                            <span className="truncate font-medium text-text-soft">
                              {status.category?.name ?? 'Category'}
                            </span>
                            <span
                              className={cn(
                                'pl-tabular shrink-0 font-medium',
                                status.level === 'over'
                                  ? 'text-expense'
                                  : status.level === 'warning'
                                    ? 'text-warning'
                                    : 'text-text',
                              )}
                            >
                              {status.percent.toFixed(0)}%
                            </span>
                          </div>
                          <Progress
                            className="mt-1 h-1.5"
                            value={status.percent}
                            tone={
                              status.level === 'over'
                                ? 'expense'
                                : status.level === 'warning'
                                  ? 'warning'
                                  : 'income'
                            }
                          />
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {/* Recent + accounts */}
      {hasData ? (
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Recent transactions"
              subtitle="Original currency and converted value"
              action={
                <Link to="/transactions">
                  <Button variant="ghost" size="sm">
                    View all
                    <ChevronRight className="size-3.5" />
                  </Button>
                </Link>
              }
            />
            {recentTransactions.length === 0 ? (
              <EmptyState
                icon={<CircleDollarSign className="size-5" />}
                title="Nothing recorded yet"
                description="Your latest activity will show up here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentTransactions.map((item) => (
                  <TransactionRow key={item.transaction.id} item={item} compact />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Accounts"
              subtitle={`Balances in their own currency, totalled in ${settings.defaultCurrency}`}
            />
            <div className="divide-y divide-border">
              {topAccounts.length === 0 ? (
                <EmptyState
                  className="py-8"
                  icon={<Wallet className="size-5" />}
                  title="No accounts"
                  description="Add an account to track balances."
                />
              ) : (
                topAccounts.map((balance) => (
                  <div key={balance.account.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-text-soft">
                      <Wallet className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-text">
                        {balance.account.name}
                      </p>
                      <p className="text-[11.5px] text-muted">
                        {balance.account.currency} · {balance.account.type}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="pl-tabular text-[13px] font-semibold text-text">
                        {formatReporting(balance.convertedBalance ?? 0n)}
                      </p>
                      {balance.account.currency !== settings.defaultCurrency ? (
                        <p className="pl-tabular text-[11px] text-muted">
                          {formatInCurrency(balance.balance, balance.account.currency, currencyMap)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted">
                  Rates cached: {engine.size.toLocaleString()} · {currencyMap.size} currencies
                </span>
                <Link to="/currencies" className="font-medium text-primary hover:underline">
                  Manage
                </Link>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <TransactionDialog open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  hint,
  tone,
  invertDelta,
  icon,
  className,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  hint?: string;
  tone: 'income' | 'expense';
  invertDelta?: boolean;
  icon: React.ReactNode;
  className?: string;
}) {
  const positive = (delta ?? 0) >= 0;
  const good = invertDelta ? !positive : positive;
  return (
    <Card className={cn('p-3.5 sm:p-5', className)}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10.5px] font-medium tracking-wide text-muted uppercase sm:text-[12px]">
          {label}
        </span>
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-lg',
            tone === 'income' ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense',
          )}
        >
          {icon}
        </span>
      </div>
      <p
        className={cn(
          'pl-tabular mt-2 text-[17px] leading-none font-semibold tracking-tight break-words sm:text-[22px]',
          tone === 'income' ? 'text-text' : 'text-text',
        )}
      >
        {value}
      </p>
      {delta !== null && delta !== undefined ? (
        <p className="mt-2 flex items-center gap-1 text-[12px]">
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              good ? 'text-income' : 'text-expense',
            )}
          >
            {positive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
          <span className="text-muted">{deltaLabel}</span>
        </p>
      ) : hint ? (
        <p className="mt-2 text-[12px] text-muted">{hint}</p>
      ) : null}
    </Card>
  );
}

function percentChange(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  const diff = current - previous;
  return Number((diff * 10000n) / (previous < 0n ? -previous : previous)) / 100;
}

function compact(value: number | undefined): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toFixed(0)}k`;
  return String(Math.round(numeric));
}

function formatCompactCurrency(value: number | undefined, currency: string): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatInCurrency(
  minor: bigint,
  currency: string,
  map: Map<string, { exponent: number }>,
): string {
  const exponent = map.get(currency)?.exponent ?? 2;
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(exponent);
  const whole = (abs / scale).toLocaleString('en-US');
  const fraction = exponent > 0 ? `.${(abs % scale).toString().padStart(exponent, '0')}` : '';
  return `${negative ? '-' : ''}${whole}${fraction} ${currency}`;
}

