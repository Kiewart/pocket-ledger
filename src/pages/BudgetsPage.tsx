import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Pencil,
  PiggyBank,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { BudgetRecord } from '../db/schema';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Progress,
  Select,
  Toggle,
  cn,
  useConfirm,
} from '../components/ui';
import { CategoryIcon } from '../components/CategoryIcon';
import { addMonthsToKey, currentMonthKey, formatMonthKey, monthRange } from '../lib/dates';
import { budgetTotals, evaluateBudgets, type BudgetStatus } from '../lib/budgets';
import { minorToDecimalString, tryParseAmountToMinor } from '../lib/money';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartTooltip } from '../components/charts';

export function BudgetsPage() {
  const {
    budgets,
    categoryMap,
    converted,
    currencyMap,
    settings,
    ledger,
    formatReporting,
    saveBudget,
    deleteBudget,
    formatIn,
  } = useApp();

  const [month, setMonth] = useState(() => currentMonthKey());
  const [editing, setEditing] = useState<BudgetRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

  const monthConverted = useMemo(() => {
    const { start, end } = monthRange(month);
    return converted.filter((item) => item.transaction.date >= start && item.transaction.date <= end);
  }, [converted, month]);

  const monthBudgets = useMemo(
    () => budgets.filter((budget) => budget.month === month),
    [budgets, month],
  );

  const statuses = useMemo(
    () => evaluateBudgets(monthBudgets, monthConverted, categoryMap, ledger, settings.budgetAlertThreshold),
    [monthBudgets, monthConverted, categoryMap, ledger, settings.budgetAlertThreshold],
  );

  const totals = useMemo(() => budgetTotals(statuses), [statuses]);
  const overallPercent =
    totals.budgeted === 0n ? 0 : Number((totals.spent * 10000n) / totals.budgeted) / 100;

  const copyableMonths = useMemo(() => {
    const previous = addMonthsToKey(month, -1);
    const previousBudgets = budgets.filter((budget) => budget.month === previous);
    return previousBudgets.length > 0 ? previousBudgets : [];
  }, [budgets, month]);

  const handleCopyPrevious = async () => {
    if (copyableMonths.length === 0) return;
    for (const budget of copyableMonths) {
      if (monthBudgets.some((existing) => existing.categoryId === budget.categoryId)) continue;
      await saveBudget({
        ...budget,
        id: crypto.randomUUID(),
        month,
        createdAt: Date.now(),
      });
    }
  };

  const handleDelete = async (status: BudgetStatus) => {
    const ok = await confirm({
      title: 'Delete budget?',
      description: `Stop tracking the ${status.category?.name ?? 'selected'} budget for ${formatMonthKey(month, 'MMMM yyyy')}. Existing transactions are not affected.`,
      confirmLabel: 'Delete budget',
      destructive: true,
    });
    if (ok) await deleteBudget(status.budget.id);
  };

  const spentWithoutBudget = useMemo(() => {
    const budgetedCategories = new Set(monthBudgets.map((budget) => budget.categoryId));
    const spendByCategory = new Map<string, bigint>();
    for (const item of monthConverted) {
      if (item.transaction.type !== 'expense') continue;
      if (item.convertedAmount === null) continue;
      const key = item.transaction.categoryId ?? '__none__';
      if (budgetedCategories.has(key)) continue;
      spendByCategory.set(key, (spendByCategory.get(key) ?? 0n) + item.convertedAmount);
    }
    return [...spendByCategory.entries()]
      .map(([categoryId, total]) => ({
        categoryId,
        name: categoryMap.get(categoryId)?.name ?? 'Uncategorised',
        color: categoryMap.get(categoryId)?.color ?? '#94a3b8',
        total,
      }))
      .sort((a, b) => Number(b.total - a.total))
      .slice(0, 5);
  }, [monthConverted, monthBudgets, categoryMap]);

  const chartData = useMemo(
    () =>
      statuses
        .filter((status) => status.budgetAmount !== null)
        .map((status) => ({
          name: status.category?.name ?? 'Category',
          color: status.category?.color ?? '#94a3b8',
          spent: Number(status.spent) / 100,
          budget: Number(status.budgetAmount ?? 0n) / 100,
          level: status.level,
        }))
        .sort((a, b) => b.spent - a.spent),
    [statuses],
  );

  const exponent = currencyMap.get(settings.defaultCurrency)?.exponent ?? 2;

  return (
    <div className="space-y-4">
      {/* Month header */}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth((current) => addMonthsToKey(current, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-[140px] text-center">
            <p className="text-sm font-semibold text-text">{formatMonthKey(month, 'MMMM yyyy')}</p>
            <p className="text-[11.5px] text-muted">{monthBudgets.length} budgets</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setMonth((current) => addMonthsToKey(current, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {copyableMonths.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => void handleCopyPrevious()}>
              <RefreshCw className="size-3.5" />
              Copy last month
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New budget
          </Button>
        </div>
      </Card>

      {/* Summary */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">
                Total budgeted
              </p>
              <p className="pl-tabular mt-1 text-[28px] leading-none font-semibold text-text">
                {formatReporting(totals.budgeted)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">Spent</p>
              <p
                className={cn(
                  'pl-tabular mt-1 text-[20px] leading-none font-semibold',
                  totals.spent > totals.budgeted ? 'text-expense' : 'text-text',
                )}
              >
                {formatReporting(totals.spent)}
              </p>
            </div>
          </div>
          <Progress
            className="mt-4 h-2.5"
            value={overallPercent}
            tone={overallPercent > 100 ? 'expense' : overallPercent >= settings.budgetAlertThreshold ? 'warning' : 'primary'}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="text-muted">{overallPercent.toFixed(0)}% of budget used</span>
            <span
              className={cn(
                'pl-tabular font-medium',
                (totals.remaining ?? 0n) < 0n ? 'text-expense' : 'text-income',
              )}
            >
              {(totals.remaining ?? 0n) < 0n ? 'Over by ' : 'Remaining '}
              {formatReporting((totals.remaining ?? 0n) < 0n ? -(totals.remaining ?? 0n) : (totals.remaining ?? 0n))}
            </span>
          </div>
          {totals.unconverted > 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-warning">
              <AlertTriangle className="size-3.5" />
              {totals.unconverted} budget{totals.unconverted === 1 ? '' : 's'} could not be
              converted and {totals.unconverted === 1 ? 'is' : 'are'} excluded from the total.
            </p>
          ) : null}
        </Card>

        <Card className="p-5">
          <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">
            Alert threshold
          </p>
          <p className="mt-1 flex items-baseline gap-1">
            <span className="text-[28px] leading-none font-semibold text-text">
              {settings.budgetAlertThreshold}
            </span>
            <span className="text-sm text-muted">%</span>
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Budgets warn once spending passes this share. Treats{' '}
            {statuses.filter((status) => status.level === 'warning').length} as warning and{' '}
            {statuses.filter((status) => status.level === 'over').length} as over.
          </p>
        </Card>
      </div>

      {/* Per-budget list */}
      <Card>
        <CardHeader
          title="Budgets"
          subtitle="Spending counted in your reporting currency at each transaction's historical rate"
        />
        {statuses.length === 0 ? (
          <EmptyState
            icon={<PiggyBank className="size-6" />}
            title="No budgets for this month"
            description="Set a monthly limit per category to track spending and get alerts before you overspend."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Create budget
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {statuses
              .slice()
              .sort((a, b) => b.percent - a.percent)
              .map((status) => (
                <BudgetRow
                  key={status.budget.id}
                  status={status}
                  currency={settings.defaultCurrency}
                  formatReporting={formatReporting}
                  formatIn={formatIn}
                  onEdit={() => setEditing(status.budget)}
                  onDelete={() => void handleDelete(status)}
                />
              ))}
          </ul>
        )}
      </Card>

      {/* Chart + unbudgeted */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Budget vs actual" subtitle={formatMonthKey(month, 'MMMM yyyy')} />
          {chartData.length === 0 ? (
            <EmptyState className="py-10" title="Nothing to chart" description="Add a budget to compare planned vs actual spending." />
          ) : (
            <div className="h-[280px] px-2 pt-4 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                  barGap={3}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--pl-border)" horizontal={false} />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--pl-muted)', fontSize: 11 }}
                    tickFormatter={(value) => compactNumber(value)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    width={92}
                    tick={{ fill: 'var(--pl-text-soft)', fontSize: 11.5 }}
                  />
                  <Tooltip content={<ChartTooltip formatter={(value) => compactNumber(value)} />} />
                  <Bar dataKey="budget" name="Budget" fill="var(--pl-surface-3)" radius={[0, 4, 4, 0]} maxBarSize={9} />
                  <Bar dataKey="spent" name="Spent" radius={[0, 4, 4, 0]} maxBarSize={9}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`${entry.name}-${index}`}
                        fill={
                          entry.level === 'over'
                            ? 'var(--pl-expense)'
                            : entry.level === 'warning'
                              ? 'var(--pl-warning)'
                              : 'var(--pl-primary)'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Unbudgeted spending"
            subtitle="Categories with activity but no budget this month"
          />
          {spentWithoutBudget.length === 0 ? (
            <EmptyState
              className="py-10"
              icon={<TrendingUp className="size-5" />}
              title="Everything is covered"
              description="Every spending category with activity has a budget."
            />
          ) : (
            <ul className="divide-y divide-border">
              {spentWithoutBudget.map((entry) => (
                <li key={entry.categoryId} className="flex items-center gap-2.5 px-4 py-2.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-soft">
                    {entry.name}
                  </span>
                  <span className="pl-tabular text-[13px] font-medium text-text">
                    {formatReporting(entry.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <BudgetDialog
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        budget={editing}
        month={month}
        exponent={exponent}
      />
    </div>
  );
}

function BudgetRow({
  status,
  currency,
  formatReporting,
  formatIn,
  onEdit,
  onDelete,
}: {
  status: BudgetStatus;
  currency: string;
  formatReporting: (value: bigint) => string;
  formatIn: (value: bigint, code: string) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { budget, category } = status;
  const tone =
    status.level === 'over' ? 'expense' : status.level === 'warning' ? 'warning' : 'income';

  return (
    <li className="group px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${category?.color ?? '#94a3b8'}1a`, color: category?.color ?? '#94a3b8' }}
        >
          <CategoryIcon name={category?.icon} className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-medium text-text">
              {category?.name ?? 'Unknown category'}
            </p>
            {status.level === 'over' ? <Badge tone="expense">Over</Badge> : null}
            {status.level === 'warning' ? <Badge tone="warning">Near limit</Badge> : null}
            {status.level === 'unconverted' ? (
              <Badge tone="warning" icon={<AlertTriangle className="size-2.5" />}>
                No rate
              </Badge>
            ) : null}
            {budget.rollover ? <Badge tone="neutral">Rollover</Badge> : null}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Progress
              className="h-1.5 max-w-[280px] flex-1"
              value={status.percent}
              tone={tone}
            />
            <span className="pl-tabular shrink-0 text-[11.5px] text-muted">
              {status.percent.toFixed(0)}%
            </span>
          </div>
          {budget.currency !== currency ? (
            <p className="mt-1 text-[11px] text-muted">
              Budget set in {formatIn(BigInt(budget.amount), budget.currency)}
              {status.budgetAmount !== null ? ` ≈ ${formatReporting(status.budgetAmount)}` : ''}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <p className="pl-tabular text-[13px] font-semibold text-text">
            {formatReporting(status.spent)}
          </p>
          <p className="pl-tabular text-[11px] text-muted">
            of {status.budgetAmount === null ? '—' : formatReporting(status.budgetAmount)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit budget"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-text"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete budget"
            className="rounded-lg p-1.5 text-muted hover:bg-expense-soft hover:text-expense"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function BudgetDialog({
  open,
  onClose,
  budget,
  month,
  exponent,
}: {
  open: boolean;
  onClose: () => void;
  budget: BudgetRecord | null;
  month: string;
  exponent: number;
}) {
  const { categories, currencies, settings, saveBudget, budgets, currencyMap } = useApp();
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(settings.defaultCurrency);
  const [rollover, setRollover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (budget) {
      setCategoryId(budget.categoryId);
      setAmount(
        minorToDecimalString(
          BigInt(budget.amount),
          currencyMap.get(budget.currency)?.exponent ?? 2,
        ),
      );
      setCurrency(budget.currency);
      setRollover(budget.rollover);
    } else {
      const used = new Set(
        budgets.filter((item) => item.month === month).map((item) => item.categoryId),
      );
      const available = categories.find(
        (category) => category.kind === 'expense' && !category.archived && !used.has(category.id),
      );
      setCategoryId(available?.id ?? '');
      setAmount('');
      setCurrency(settings.defaultCurrency);
      setRollover(false);
    }
  }, [open, budget, month, budgets, categories, settings.defaultCurrency, currencyMap]);

  const usedCategories = useMemo(
    () =>
      new Set(
        budgets
          .filter((item) => item.month === month && item.id !== budget?.id)
          .map((item) => item.categoryId),
      ),
    [budgets, month, budget],
  );

  const handleSave = async () => {
    setError(null);
    const exp = currencyMap.get(currency)?.exponent ?? 2;
    const minor = tryParseAmountToMinor(amount, exp);
    if (!categoryId) {
      setError('Choose a category.');
      return;
    }
    if (minor === null || minor <= 0n) {
      setError('Enter a budget amount greater than zero.');
      return;
    }
    setSaving(true);
    try {
      await saveBudget({
        id: budget?.id ?? crypto.randomUUID(),
        categoryId,
        month,
        amount: Number(minor),
        currency,
        rollover,
        createdAt: budget?.createdAt ?? Date.now(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const existing = budgets.find(
    (item) => item.month === month && item.categoryId === categoryId && item.id !== budget?.id,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={budget ? 'Edit budget' : 'New budget'}
      description={formatMonthKey(month, 'MMMM yyyy')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {budget ? 'Save budget' : 'Create budget'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Category" required error={error && !categoryId ? error : undefined}>
          <Select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            disabled={Boolean(budget)}
          >
            <option value="">Select a category</option>
            {categories
              .filter((category) => category.kind === 'expense' && !category.archived)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((category) => (
                <option
                  key={category.id}
                  value={category.id}
                  disabled={usedCategories.has(category.id)}
                >
                  {category.name}
                  {usedCategories.has(category.id) ? ' (already budgeted)' : ''}
                </option>
              ))}
          </Select>
          {existing ? (
            <p className="mt-1.5 text-[12px] text-warning">
              This category already has a budget for this month.
            </p>
          ) : null}
        </Field>

        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Field label="Budget amount" required error={error && !amount ? error : undefined}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {currencies
                .filter((item) => item.enabled)
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        {error && amount ? (
          <p className="text-[12.5px] font-medium text-expense">{error}</p>
        ) : null}

        {currency !== settings.defaultCurrency ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-[12px] text-text-soft">
            This budget is denominated in {currency}. It is compared against spending using the
            exchange rate at the end of {formatMonthKey(month, 'MMMM yyyy')}.
          </p>
        ) : null}

        <div className="rounded-xl border border-border p-3">
          <Toggle
            checked={rollover}
            onChange={setRollover}
            label="Carry over unspent amount"
            description="Records the intent to roll leftover budget into next month."
          />
        </div>

        <p className="text-[11.5px] text-muted">
          Minor units: this currency uses {exponent} decimal place{exponent === 1 ? '' : 's'}.
        </p>
      </div>
    </Modal>
  );
}

function compactNumber(value: number | undefined): string {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toFixed(0)}k`;
  return String(Math.round(numeric));
}
