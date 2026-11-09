import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Coins,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { AccountRecord, AccountType, RateRecord } from '../db/schema';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Toggle,
  cn,
  useConfirm,
} from '../components/ui';
import { deleteRate, getRatesForPair, saveManualRate, syncRates } from '../lib/fxApi';
import { parseRateStringToScaled, scaledToRateString } from '../lib/money';
import { addMonthsToKey, monthKey, todayISO } from '../lib/dates';
import { invertScaledRate } from '../lib/rates';

type Tab = 'accounts' | 'rates';

export function CurrenciesPage() {
  const [tab, setTab] = useState<Tab>('accounts');
  return (
    <div className="space-y-4">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'accounts', label: 'Accounts & balances' },
          { value: 'rates', label: 'Exchange rates' },
        ]}
      />
      {tab === 'accounts' ? <AccountsPanel /> : <RatesPanel />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                   */
/* -------------------------------------------------------------------------- */

function AccountsPanel() {
  const {
    portfolio,
    settings,
    formatReporting,
    formatIn,
    accounts,
    balances: allBalances,
  } = useApp();
  const [editing, setEditing] = useState<AccountRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const active = useMemo(
    () => allBalances.filter((balance) => !balance.account.archived),
    [allBalances],
  );
  const archived = useMemo(
    () => allBalances.filter((balance) => balance.account.archived),
    [allBalances],
  );

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">
              Portfolio in {settings.defaultCurrency}
            </p>
            <p className="pl-tabular mt-1 text-[30px] leading-none font-semibold text-text">
              {formatReporting(portfolio.total)}
            </p>
            <p className="mt-2 max-w-lg text-[12px] leading-relaxed text-muted">
              Each balance is the account's own opening balance plus every recorded movement, held
              in the account's native currency and converted here at today's rate.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Add account
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Accounts"
          subtitle="Opening balance + recorded movements, in each account's own currency"
        />
        {active.length === 0 ? (
          <EmptyState
            icon={<Wallet className="size-6" />}
            title="No accounts yet"
            description="Add a checking, savings or cash account to track balances separately from cash flow."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Add account
              </Button>
            }
          />
        ) : (
          <>
          <div className="md:hidden divide-y divide-border">
            {/* Cards on small screens: a 6-column financial table is unreadable
                on a phone, and horizontal scrolling hides the balance. */}
            {active.map((balance) => (
              <div key={balance.account.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-[13.5px] font-medium text-text">
                        {balance.account.name}
                      </p>
                      {!balance.account.includeInTotal ? (
                        <Badge tone="neutral">Excluded</Badge>
                      ) : null}
                      {balance.unconvertedLegs > 0 ? (
                        <Badge tone="warning" icon={<AlertTriangle className="size-2.5" />}>
                          {balance.unconvertedLegs} unconverted
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[11.5px] capitalize text-muted">
                      {balance.account.type} · {balance.account.currency}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="pl-tabular text-[14px] font-semibold text-text">
                      {formatIn(balance.balance, balance.account.currency)}
                    </p>
                    <p className="pl-tabular text-[11px] text-muted">
                      {balance.convertedBalance === null
                        ? 'No rate'
                        : `${balance.approximate ? '~' : ''}${formatReporting(balance.convertedBalance)}`}
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
                  <span className="pl-tabular">
                    Opening {formatIn(balance.openingBalance, balance.account.currency)}
                  </span>
                  <span
                    className={cn(
                      'pl-tabular',
                      balance.movement >= 0n ? 'text-income' : 'text-expense',
                    )}
                  >
                    Movement {formatIn(balance.movement, balance.account.currency, { showSign: true })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(balance.account)}
                    className="ml-auto font-medium text-primary hover:underline"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block pl-scroll-x">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11.5px] tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium">Opening</th>
                  <th className="px-4 py-2.5 text-right font-medium">Movement</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    In {settings.defaultCurrency}
                  </th>
                  <th className="w-16 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {active.map((balance) => (
                  <tr key={balance.account.id} className="group hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-text">{balance.account.name}</p>
                        {!balance.account.includeInTotal ? (
                          <Badge tone="neutral">Excluded</Badge>
                        ) : null}
                        {balance.unconvertedLegs > 0 ? (
                          <Badge tone="warning" icon={<AlertTriangle className="size-2.5" />}>
                            {balance.unconvertedLegs} unconverted
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12.5px] capitalize text-text-soft">
                        {balance.account.type}
                      </span>
                      <span className="ml-2 text-[11.5px] text-muted">{balance.account.currency}</span>
                    </td>
                    <td className="pl-tabular px-4 py-3 text-right text-[12.5px] text-text-soft">
                      {formatIn(balance.openingBalance, balance.account.currency)}
                    </td>
                    <td
                      className={cn(
                        'pl-tabular px-4 py-3 text-right text-[12.5px]',
                        balance.movement >= 0n ? 'text-income' : 'text-expense',
                      )}
                    >
                      {formatIn(balance.movement, balance.account.currency, { showSign: true })}
                    </td>
                    <td className="pl-tabular px-4 py-3 text-right font-semibold text-text">
                      {formatIn(balance.balance, balance.account.currency)}
                    </td>
                    <td className="pl-tabular px-4 py-3 text-right text-[12.5px] text-text-soft">
                      {balance.convertedBalance === null ? (
                        <span className="text-warning">No rate</span>
                      ) : (
                        <>
                          {balance.approximate ? '~' : ''}
                          {formatReporting(balance.convertedBalance)}
                        </>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        onClick={() => setEditing(balance.account)}
                        aria-label={`Edit ${balance.account.name}`}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface-3 hover:text-text"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      {archived.length > 0 ? (
        <Card>
          <CardHeader title="Archived accounts" subtitle="Excluded from totals" />
          <ul className="divide-y divide-border">
            {archived.map((balance) => (
              <li key={balance.account.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {balance.account.name} · {balance.account.currency}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setEditing(balance.account)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <AccountDialog
        open={creating || editing !== null}
        account={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <p className="px-1 text-[11.5px] leading-relaxed text-muted">
        Balances here are only as complete as the transactions you record. Pocket Ledger does not
        connect to banks, so an untracked card payment or bank fee will not appear automatically.
        {accounts.length === 0 ? ' Add an account to begin.' : ''}
      </p>
    </div>
  );
}

function AccountDialog({
  open,
  account,
  onClose,
}: {
  open: boolean;
  account: AccountRecord | null;
  onClose: () => void;
}) {
  const { currencies, saveAccount, deleteAccount, currencyMap } = useApp();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [type, setType] = useState<AccountType>('checking');
  const [opening, setOpening] = useState('0');
  const [includeInTotal, setIncludeInTotal] = useState(true);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (account) {
      setName(account.name);
      setCurrency(account.currency);
      setType(account.type);
      const exp = currencyMap.get(account.currency)?.exponent ?? 2;
      setOpening(minorString(account.openingBalance, exp));
      setIncludeInTotal(account.includeInTotal);
      setArchived(account.archived);
    } else {
      setName('');
      setCurrency('USD');
      setType('checking');
      setOpening('0');
      setIncludeInTotal(true);
      setArchived(false);
    }
  }, [open, account, currencyMap]);

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Give the account a name.');
      return;
    }
    const exp = currencyMap.get(currency)?.exponent ?? 2;
    const parsed = parseSignedMinor(opening, exp);
    if (parsed === null) {
      setError('Enter a valid opening balance.');
      return;
    }
    setSaving(true);
    try {
      await saveAccount({
        id: account?.id ?? crypto.randomUUID(),
        name: name.trim(),
        currency,
        type,
        openingBalance: Number(parsed),
        includeInTotal,
        archived,
        createdAt: account?.createdAt ?? Date.now(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!account) return;
    const ok = await confirm({
      title: 'Delete account?',
      description:
        'Transactions recorded against this account will keep their account reference but will no longer appear under a known account. Archive instead if you want to keep the history tidy.',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (ok) {
      await deleteAccount(account.id);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account ? 'Edit account' : 'New account'}
      description="Balances use the account's own currency."
      footer={
        <>
          {account ? (
            <Button variant="ghost" className="mr-auto text-expense" onClick={() => void handleDelete()}>
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            Save account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Account name" required error={error && !name.trim() ? error : undefined}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Everyday Checking" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency">
            <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {currencies
                .filter((item) => item.enabled)
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} · {item.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(event) => setType(event.target.value as AccountType)}>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="cash">Cash</option>
              <option value="credit">Credit</option>
              <option value="investment">Investment</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Opening balance"
          error={error && name.trim() ? error : undefined}
          hint="The balance before the first transaction you record. Negative values are allowed for credit accounts."
        >
          <Input
            inputMode="decimal"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
            placeholder="0.00"
          />
        </Field>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <Toggle
            checked={includeInTotal}
            onChange={setIncludeInTotal}
            label="Include in portfolio total"
            description="Untick for accounts you do not want in the combined balance."
          />
          {account ? (
            <Toggle
              checked={archived}
              onChange={setArchived}
              label="Archived"
              description="Archived accounts are hidden from the active list but keep their history."
            />
          ) : null}
        </div>

        {currency !== 'USD' ? (
          <p className="text-[11.5px] text-muted">
            This account will be valued in USD using the cached rate for today. No rate is invented
            if none exists — the balance is then reported as unconverted.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Rates                                                                      */
/* -------------------------------------------------------------------------- */

function RatesPanel() {
  const { rates, settings, updateSettings, currencies, currencyMap, engine } = useApp();
  const [base, setBase] = useState(settings.defaultCurrency);
  const [quote, setQuote] = useState('EUR');
  const [pairRates, setPairRates] = useState<RateRecord[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [manualRate, setManualRate] = useState('');
  const [manualDate, setManualDate] = useState(todayISO());

  const loadPair = async () => {
    const rows = await getRatesForPair(base, quote);
    setPairRates(rows);
  };

  useEffect(() => {
    void loadPair();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, quote, rates.length]);

  const enabledCurrencies = useMemo(
    () => currencies.filter((currency) => currency.enabled).sort((a, b) => a.code.localeCompare(b.code)),
    [currencies],
  );

  const stats = useMemo(() => {
    const bySource = new Map<string, number>();
    let oldest: string | undefined;
    let newest: string | undefined;
    for (const row of rates) {
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
      if (!oldest || row.date < oldest) oldest = row.date;
      if (!newest || row.date > newest) newest = row.date;
    }
    return { bySource, oldest, newest };
  }, [rates]);

  /** Built-in inverse check: shows the engine resolves both directions. */
  const checkRate = useMemo(() => {
    const today = todayISO();
    return engine.resolve(base, quote, today, {
      maxStalenessDays: settings.rateMaxStalenessDays,
    });
  }, [engine, base, quote, settings.rateMaxStalenessDays]);

  const handleSync = async () => {
    setSyncError(null);
    setSyncMessage(null);
    if (!settings.rateApiEnabled) {
      setSyncError('Enable the rate API in Settings before syncing.');
      return;
    }
    if (quote === base) {
      setSyncError('Pick two different currencies.');
      return;
    }
    setSyncing(true);
    try {
      const today = todayISO();
      const from = addMonthsToKey(monthKey(today), -2);
      const result = await syncRates(
        {
          provider: settings.rateProvider,
          baseUrl: settings.rateApiBaseUrl,
          apiKey: settings.rateApiKey,
        },
        `${from}-01..${today}`,
        base,
        [quote],
      );
      setSyncMessage(
        `Fetched ${result.fetched} dates and cached ${result.saved} rates (${result.dates[0] ?? '—'} → ${result.dates[result.dates.length - 1] ?? '—'}).`,
      );
      await loadPair();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Could not fetch rates.');
    } finally {
      setSyncing(false);
    }
  };

  const handleManualSave = async () => {
    setSyncError(null);
    const scaled = parseRateStringToScaled(manualRate);
    if (scaled === null || scaled <= 0n) {
      setSyncError('Enter a rate greater than zero, e.g. 1.0892.');
      return;
    }
    if (base === quote) {
      setSyncError('A currency cannot be converted to itself.');
      return;
    }
    await saveManualRate({
      base,
      quote,
      date: manualDate,
      rate: scaledToRateString(scaled),
      note: 'Entered manually',
    });
    setManualOpen(false);
    setManualRate('');
    setSyncMessage(`Saved manual rate ${base}/${quote} for ${manualDate}.`);
    await loadPair();
  };

  const handleDelete = async (id: string) => {
    await deleteRate(id);
    await loadPair();
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-[210px]">
            <p className="text-[11.5px] font-medium tracking-wide text-muted uppercase">
              Rate history
            </p>
            <p className="mt-1 text-lg font-semibold text-text">
              {rates.length.toLocaleString()} cached rates
            </p>
            <p className="mt-1 text-[12px] text-muted">
              {stats.oldest && stats.newest ? `${stats.oldest} → ${stats.newest}` : 'No rates cached'}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[...stats.bySource.entries()].map(([source, count]) => (
                <Badge key={source} tone={source === 'manual' ? 'primary' : source === 'seed' ? 'neutral' : 'info'}>
                  {source}: {count.toLocaleString()}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Field label="Base">
              <Select value={base} onChange={(event) => setBase(event.target.value)} className="w-[96px]">
                {enabledCurrencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quote">
              <Select value={quote} onChange={(event) => setQuote(event.target.value)} className="w-[96px]">
                {enabledCurrencies
                  .filter((currency) => currency.code !== base)
                  .map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code}
                    </option>
                  ))}
              </Select>
            </Field>
            <Button variant="secondary" onClick={() => setManualOpen(true)}>
              <Plus className="size-4" />
              Manual rate
            </Button>
            <Button onClick={() => void handleSync()} loading={syncing} disabled={!settings.rateApiEnabled}>
              <RefreshCw className="size-4" />
              Sync
            </Button>
          </div>
        </div>

        {!settings.rateApiEnabled ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted">
            <ShieldCheck className="size-3.5" />
            Network rate fetching is off. You can still add rates manually, and the bundled ECB
            history is used offline.
          </p>
        ) : null}

        {syncMessage ? (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-income-soft px-3 py-2 text-[12px] text-income">
            <Check className="size-3.5" />
            {syncMessage}
          </p>
        ) : null}
        {syncError ? (
          <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-expense-soft px-3 py-2 text-[12px] text-expense">
            <AlertTriangle className="size-3.5" />
            {syncError}
          </p>
        ) : null}

        {checkRate ? (
          <div className="mt-4 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-[12px]">
            <p className="font-medium text-text">
              Today's resolution for {base} → {quote}:{' '}
              <span className="pl-tabular">
                {scaledToRateString(checkRate.rate)}
              </span>
            </p>
            <p className="mt-0.5 text-muted">
              Source: {checkRate.source} / {checkRate.provider} · rate date {checkRate.rateDate}
              {checkRate.kind === 'stale'
                ? ` (${checkRate.daysStale} ${checkRate.daysStale === 1 ? 'day' : 'days'} carried forward)`
                : ''}
              {checkRate.kind === 'triangulated' ? ` · via ${checkRate.via}` : ''}
              {checkRate.kind === 'inverse' ? ' · inverted' : ''}
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-warning-soft px-3.5 py-3 text-[12px] text-warning">
            No rate is available for {base} → {quote} within {settings.rateMaxStalenessDays} days of
            today. Amounts in {base} cannot be converted to {quote} until a rate is added.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`${base} → ${quote}`}
          subtitle={`${pairRates.length} cached rates, newest first`}
          action={
            <div className="flex items-center gap-2">
              <Badge tone="neutral">
                Max carry-forward {settings.rateMaxStalenessDays}d
              </Badge>
            </div>
          }
        />
        {pairRates.length === 0 ? (
          <EmptyState
            icon={<Coins className="size-6" />}
            title="No cached rates for this pair"
            description="Add a manual rate, sync from the provider, or pick a pair covered by the bundled ECB history."
            action={
              <Button variant="secondary" onClick={() => setManualOpen(true)}>
                <Plus className="size-4" />
                Add manual rate
              </Button>
            }
          />
        ) : (
          <div className="pl-scroll-x max-h-[420px] overflow-y-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-[11.5px] tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Rate</th>
                  <th className="px-4 py-2.5 font-medium">Inverse</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pairRates.slice(0, 200).map((row) => {
                  const scaled = parseRateStringToScaled(row.rate);
                  const inverse = scaled ? scaledToRateString(invertScaledRate(scaled)) : '—';
                  return (
                    <tr key={row.id} className="hover:bg-surface-2">
                      <td className="px-4 py-2 text-[12.5px] text-text-soft">{row.date}</td>
                      <td className="pl-tabular px-4 py-2 font-medium text-text">{row.rate}</td>
                      <td className="pl-tabular px-4 py-2 text-[12px] text-muted">{inverse}</td>
                      <td className="px-4 py-2">
                        <Badge
                          tone={
                            row.source === 'manual'
                              ? 'primary'
                              : row.source === 'seed'
                                ? 'neutral'
                                : 'info'
                          }
                        >
                          {row.source}
                        </Badge>
                        <span className="ml-1.5 text-[11px] text-muted">· {row.provider}</span>
                      </td>
                      <td className="px-2 py-2">
                        {row.source === 'manual' ? (
                          <button
                            type="button"
                            onClick={() => void handleDelete(row.id)}
                            aria-label={`Delete ${row.date} rate`}
                            className="rounded-lg p-1.5 text-muted hover:bg-expense-soft hover:text-expense"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Engine rules" subtitle="How Pocket Ledger resolves a rate" />
        <ol className="space-y-2.5 px-4 py-4 text-[12.5px] leading-relaxed text-text-soft">
          <li>
            <strong className="font-medium text-text">1. Exact date.</strong> A rate published for
            the transaction's own date is used first, directly or inverted.
          </li>
          <li>
            <strong className="font-medium text-text">2. Triangulation.</strong> If no direct rate
            exists, same-date rates through USD, EUR, GBP or CHF are combined and audited.
          </li>
          <li>
            <strong className="font-medium text-text">3. Carry forward.</strong> The newest rate on
            or before the date may be used, but only within{' '}
            <strong className="font-medium text-text">{settings.rateMaxStalenessDays} days</strong>,
            and it is labelled with its real rate date.
          </li>
          <li>
            <strong className="font-medium text-text">4. Never forward-dated.</strong> A rate
            published after the transaction date is never used as a stand-in for that date.
          </li>
          <li>
            <strong className="font-medium text-text">5. Never today's rate silently.</strong> If no
            rate qualifies, the amount is reported as unconverted and excluded from converted
            totals instead of being guessed.
          </li>
        </ol>
        <div className="border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-muted">
              Allow carrying a rate forward for up to
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={60}
                value={settings.rateMaxStalenessDays}
                onChange={(event) =>
                  void updateSettings({
                    rateMaxStalenessDays: Math.max(0, Math.min(60, Number(event.target.value) || 0)),
                  })
                }
                className="h-8 w-20 text-center"
              />
              <span className="text-[12px] text-muted">days</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3">
        <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" />
        <p className="text-[11.5px] leading-relaxed text-muted">
          Bundled history is real European Central Bank daily reference rates retrieved from
          frankfurter.dev. Manual rates always take precedence over fetched rates for the same pair
          and date, and are never overwritten by a sync.
          {currencyMap.get(base) ? ` ${currencyMap.get(base)?.name} uses ${currencyMap.get(base)?.exponent} decimal places.` : ''}
        </p>
      </div>

      <Modal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Add a manual rate"
        description={`${base} → ${quote}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleManualSave()}>Save rate</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Date" hint="The rate applies from this date onwards within the carry-forward window.">
            <Input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} />
          </Field>
          <Field label={`1 ${base} equals`} required>
            <div className="flex items-center gap-2">
              <Input
                inputMode="decimal"
                value={manualRate}
                onChange={(event) => setManualRate(event.target.value)}
                placeholder="1.0892"
              />
              <span className="text-sm font-medium text-text-soft">{quote}</span>
            </div>
          </Field>
          {syncError ? <p className="text-[12.5px] text-expense">{syncError}</p> : null}
          <p className="text-[11.5px] text-muted">
            Manual rates are stored locally with source <code>manual</code> and shown wherever the
            rate is used.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function minorString(amount: number, exponent: number): string {
  const negative = amount < 0;
  const abs = Math.abs(Math.trunc(amount));
  const scale = 10 ** exponent;
  const whole = Math.floor(abs / scale);
  const fraction = exponent > 0 ? `.${String(abs % scale).padStart(exponent, '0')}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function parseSignedMinor(value: string, exponent: number): bigint | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const keep = fraction.slice(0, exponent).padEnd(exponent, '0');
  const dropped = fraction.slice(exponent);
  let minor = BigInt((whole === '' ? '0' : whole) + keep);
  if (dropped.length > 0 && dropped[0] >= '5') minor += 1n;
  return negative ? -minor : minor;
}
