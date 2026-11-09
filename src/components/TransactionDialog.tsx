import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight, Info, RefreshCw } from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { TransactionRecord, TransactionType } from '../db/schema';
import { todayISO } from '../lib/dates';
import {
  normaliseTransaction,
  validateTransaction,
  type TransactionInput,
} from '../lib/transactions';
import { minorToDecimalString, tryParseAmountToMinor } from '../lib/money';
import { Badge, Button, Field, Input, Modal, Segmented, Select, Textarea, cn } from './ui';

export interface TransactionDialogProps {
  open: boolean;
  onClose: () => void;
  /** Existing record to edit; omit to create. */
  editing?: TransactionRecord | null;
  /** Prefill values for a new record. */
  defaults?: Partial<TransactionInput>;
}

const TYPE_OPTIONS: { value: TransactionType; label: string; icon: typeof ArrowUpRight }[] = [
  { value: 'expense', label: 'Expense', icon: ArrowUpRight },
  { value: 'income', label: 'Income', icon: ArrowDownLeft },
  { value: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
];

function emptyForm(defaults?: Partial<TransactionInput>): TransactionInput {
  return {
    type: defaults?.type ?? 'expense',
    amount: defaults?.amount ?? '',
    currency: defaults?.currency ?? '',
    accountId: defaults?.accountId ?? '',
    toAccountId: defaults?.toAccountId ?? '',
    categoryId: defaults?.categoryId ?? '',
    date: defaults?.date ?? todayISO(),
    payee: defaults?.payee ?? '',
    description: defaults?.description ?? '',
    notes: defaults?.notes ?? '',
    tags: defaults?.tags ?? [],
    status: defaults?.status ?? 'cleared',
  };
}

export function TransactionDialog({ open, onClose, editing, defaults }: TransactionDialogProps) {
  const {
    accounts,
    categories,
    currencies,
    settings,
    accountMap,
    currencyMap,
    createTransaction,
    saveTransaction,
    deleteTransaction,
    convertOnDate,
    formatReporting,
  } = useApp();

  const [form, setForm] = useState<TransactionInput>(() => emptyForm(defaults));
  const [submitted, setSubmitted] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    setTagInput('');
    if (editing) {
      setForm({
        id: editing.id,
        type: editing.type,
        amount: minorToDecimalString(BigInt(editing.amount), currencyMap.get(editing.currency)?.exponent ?? 2),
        currency: editing.currency,
        accountId: editing.accountId,
        toAccountId: editing.toAccountId ?? '',
        categoryId: editing.categoryId ?? '',
        date: editing.date,
        payee: editing.payee ?? '',
        description: editing.description ?? '',
        notes: editing.notes ?? '',
        tags: editing.tags ?? [],
        status: editing.status,
      });
    } else {
      const activeAccounts = accounts.filter((account) => !account.archived);
      const preferred =
        activeAccounts.find((account) => account.id === defaults?.accountId) ??
        activeAccounts[0];
      setForm({
        ...emptyForm(defaults),
        currency: defaults?.currency ?? preferred?.currency ?? settings.defaultCurrency,
        accountId: defaults?.accountId ?? preferred?.id ?? '',
      });
    }
  }, [open, editing, defaults, accounts, currencyMap, settings.defaultCurrency]);

  const activeAccounts = useMemo(() => accounts.filter((account) => !account.archived), [accounts]);
  const activeCurrencies = useMemo(
    () => currencies.filter((currency) => currency.enabled).sort((a, b) => a.code.localeCompare(b.code)),
    [currencies],
  );
  const visibleCategories = useMemo(
    () => categories.filter((category) => !category.archived && category.kind === form.type),
    [categories, form.type],
  );

  const validation = useMemo(() => {
    return validateTransaction(form, {
      availableCurrencies: new Set(activeCurrencies.map((currency) => currency.code)),
      accountIds: new Set(accounts.map((account) => account.id)),
      allowTransfers: accounts.length > 1,
    });
  }, [form, activeCurrencies, accounts]);

  const exponent = currencyMap.get(form.currency)?.exponent ?? 2;

  /** Live conversion preview using the rate for the selected date. */
  const preview = useMemo(() => {
    if (!form.currency || !form.date) return null;
    const minor = tryParseAmountToMinor(form.amount || '0', exponent);
    if (minor === null || minor === 0n) return null;
    if (form.currency === settings.defaultCurrency) return null;
    const converted = convertOnDate(minor, form.currency, settings.defaultCurrency, form.date);
    return {
      converted,
      formatted: converted === null ? null : formatReporting(converted),
    };
  }, [form.amount, form.currency, form.date, exponent, settings.defaultCurrency, convertOnDate, formatReporting]);

  const accountCurrency = accountMap.get(form.accountId)?.currency;
  const accountMismatch = Boolean(accountCurrency && accountCurrency !== form.currency);

  const set = <K extends keyof TransactionInput>(key: K, value: TransactionInput[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'accountId') {
        // Keep the amount currency in step with the chosen account unless the
        // user deliberately picked a different currency.
        const previousAccountCurrency = accountMap.get(current.accountId)?.currency;
        if (!current.currency || current.currency === previousAccountCurrency) {
          next.currency = accountMap.get(value as string)?.currency ?? current.currency;
        }
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    if (!validation.valid || validation.amountMinor === null) return;
    setSaving(true);
    try {
      if (editing) {
        const record = normaliseTransaction(form, validation.amountMinor, editing);
        await saveTransaction(record);
      } else {
        await createTransaction(form, validation.amountMinor);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    await deleteTransaction(editing.id);
    onClose();
  };

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    if (!form.tags?.includes(tag)) set('tags', [...(form.tags ?? []), tag]);
    setTagInput('');
  };

  const showErrors = submitted;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit transaction' : 'New transaction'}
      description={
        editing
          ? 'The original amount and currency are always preserved.'
          : 'Record an income, expense or transfer.'
      }
      size="lg"
      footer={
        <>
          {editing ? (
            <Button variant="ghost" className="mr-auto text-expense" onClick={() => void handleDelete()}>
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} loading={saving}>
            {editing ? 'Save changes' : 'Add transaction'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={form.type}
          onChange={(value) => {
            set('type', value);
            if (value === 'transfer') set('categoryId', '');
            else set('toAccountId', '');
          }}
          options={TYPE_OPTIONS.map((option) => ({
            value: option.value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <option.icon className="size-3.5" />
                {option.label}
              </span>
            ),
          }))}
          className="w-full [&>button]:flex-1"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Amount"
            required
            error={showErrors ? validation.errors.amount : undefined}
            hint={
              preview?.formatted
                ? `≈ ${preview.formatted} at the ${form.date} rate`
                : form.currency !== settings.defaultCurrency
                  ? 'Enter an amount to preview the conversion.'
                  : undefined
            }
          >
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={form.amount}
                onChange={(event) => set('amount', event.target.value)}
                invalid={showErrors && Boolean(validation.errors.amount)}
                className="flex-1 text-base font-medium"
                autoFocus
              />
              <Select
                value={form.currency}
                onChange={(event) => set('currency', event.target.value)}
                className="w-[116px]"
                aria-label="Transaction currency"
                invalid={showErrors && Boolean(validation.errors.currency)}
              >
                {activeCurrencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
                  </option>
                ))}
              </Select>
            </div>
          </Field>

          <Field
            label="Date"
            required
            error={showErrors ? validation.errors.date : undefined}
            hint="The historical rate for this date is used."
          >
            <Input
              type="date"
              value={form.date}
              onChange={(event) => set('date', event.target.value)}
              invalid={showErrors && Boolean(validation.errors.date)}
            />
          </Field>
        </div>

        {accountMismatch && form.currency !== accountCurrency ? (
          <div className="flex items-start gap-2 rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-[12.5px] text-info">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              This account is held in <strong>{accountCurrency}</strong>. The transaction stays in{' '}
              <strong>{form.currency}</strong> and is converted at the transaction date rate when
              the account balance is calculated.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={form.type === 'transfer' ? 'From account' : 'Account'} required error={showErrors ? validation.errors.accountId : undefined}>
            <Select
              value={form.accountId}
              onChange={(event) => set('accountId', event.target.value)}
              invalid={showErrors && Boolean(validation.errors.accountId)}
              aria-label="Transaction account"
            >
              <option value="">Select an account</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </Select>
          </Field>

          {form.type === 'transfer' ? (
            <Field label="To account" required error={showErrors ? validation.errors.toAccountId : undefined}>
              <Select
                value={form.toAccountId}
                onChange={(event) => set('toAccountId', event.target.value)}
                invalid={showErrors && Boolean(validation.errors.toAccountId)}
                aria-label="Transfer destination account"
              >
                <option value="">Select destination</option>
                {activeAccounts
                  .filter((account) => account.id !== form.accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </option>
                  ))}
              </Select>
            </Field>
          ) : (
            <Field label="Category" error={showErrors ? validation.errors.categoryId : undefined}>
              <Select
                value={form.categoryId ?? ''}
                onChange={(event) => set('categoryId', event.target.value)}
                aria-label="Transaction category"
              >
                <option value="">Uncategorised</option>
                {visibleCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={form.type === 'transfer' ? 'Reference' : 'Payee'}>
            <Input
              value={form.payee ?? ''}
              onChange={(event) => set('payee', event.target.value)}
              placeholder={form.type === 'transfer' ? 'e.g. Savings top-up' : 'e.g. Greenfield Market'}
            />
          </Field>
          <Field label="Description">
            <Input
              value={form.description ?? ''}
              onChange={(event) => set('description', event.target.value)}
              placeholder="Optional short note"
            />
          </Field>
        </div>

        <Field label="Tags">
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder="Add a tag and press Enter"
              className="flex-1"
            />
            <Button variant="secondary" onClick={addTag} type="button">
              Add
            </Button>
          </div>
          {form.tags && form.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {form.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => set('tags', (form.tags ?? []).filter((item) => item !== tag))}
                  className="group inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-1 text-[11.5px] font-medium text-text-soft transition-colors hover:bg-expense-soft hover:text-expense"
                >
                  {tag}
                  <span aria-hidden className="text-muted group-hover:text-expense">×</span>
                </button>
              ))}
            </div>
          ) : null}
        </Field>

        <Field label="Notes">
          <Textarea
            value={form.notes ?? ''}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Anything you want to remember about this transaction"
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted">Status</span>
            <Segmented
              value={form.status ?? 'cleared'}
              onChange={(value) => set('status', value)}
              options={[
                { value: 'cleared', label: 'Cleared' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
          </div>
          {preview?.converted === null ? (
            <Badge tone="warning" icon={<RefreshCw className="size-3" />}>
              No rate for {form.date}
            </Badge>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** Small helper so other screens can render a consistent original + converted pair. */
export function AmountCell({
  amount,
  converted,
  approximate,
  tone,
  className,
}: {
  amount: string;
  currency: string;
  converted?: string | null;
  approximate?: boolean;
  tone?: 'income' | 'expense' | 'neutral';
  className?: string;
}) {
  const toneClass =
    tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : 'text-text';
  return (
    <div className={cn('text-right', className)}>
      <p className={cn('pl-tabular text-sm font-semibold', toneClass)}>{amount}</p>
      {converted ? (
        <p className="pl-tabular mt-0.5 text-[11.5px] text-muted">
          {approximate ? '~' : ''}
          {converted}
        </p>
      ) : null}
    </div>
  );
}
