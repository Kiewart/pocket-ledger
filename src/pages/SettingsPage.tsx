import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Download,
  HardDriveDownload,
  Info,
  Moon,
  Palette,
  Plus,
  Sun,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
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
import { CategoryIcon, ICON_NAMES } from '../components/CategoryIcon';
import type { CategoryRecord, ThemeMode } from '../db/schema';
import {
  BackupError,
  clearAllData,
  createBackup,
  parseBackup,
  readFileAsText,
  restoreBackup,
  serializeBackup,
} from '../lib/backup';
import { downloadTextFile } from '../lib/csv';
import { db } from '../db/db';
import { loadDemoData, seedBundledRates } from '../db/seed';
import { bootstrap } from '../db/seed';

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#f59e0b', '#84cc16', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#64748b', '#a16207', '#d946ef',
];

export function SettingsPage() {
  const {
    settings,
    updateSettings,
    categories,
    saveCategory,
    transactions,
    accounts,
    rates,
    budgets,
    currencies,
  } = useApp();
  const confirm = useConfirm();

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>(null);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const [restorePreview, setRestorePreview] = useState<ReturnType<typeof parseBackup> | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const dbStats = useMemo(
    () => ({
      transactions: transactions.length,
      accounts: accounts.length,
      categories: categories.length,
      budgets: budgets.length,
      rates: rates.length,
      currencies: currencies.length,
    }),
    [transactions, accounts, categories, budgets, rates, currencies],
  );

  const handleExport = async () => {
    setBusy('backup');
    try {
      const backup = await createBackup();
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        `pocket-ledger-backup-${date}.json`,
        serializeBackup(backup),
        'application/json',
      );
      setMessage({
        tone: 'ok',
        text: `Backup downloaded with ${backup.counts.transactions ?? 0} transactions and ${backup.counts.rates ?? 0} rates.`,
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Backup failed.' });
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const backup = parseBackup(text);
      setRestorePreview(backup);
      setMessage(null);
    } catch (error) {
      setRestorePreview(null);
      setMessage({
        tone: 'error',
        text: error instanceof BackupError ? error.message : 'Could not read that backup file.',
      });
    }
  };

  const handleRestore = async () => {
    if (!restorePreview) return;
    setBusy('restore');
    try {
      await restoreBackup(restorePreview, restoreMode);
      setRestorePreview(null);
      setMessage({
        tone: 'ok',
        text: `Restore complete (${restoreMode === 'replace' ? 'replaced all data' : 'merged'}).`,
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Restore failed.' });
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    const ok = await confirm({
      title: 'Delete all data?',
      description:
        'This permanently removes every transaction, account, budget, category and cached rate from this browser, and resets settings. Export a backup first if you may want it back.',
      confirmLabel: 'Delete everything',
      destructive: true,
    });
    if (!ok) return;
    setBusy('clear');
    try {
      await clearAllData();
      // Re-establish the base catalogues without resurrecting sample data.
      await bootstrap({ loadSampleOnFirstRun: false });
      window.location.reload();
    } finally {
      setBusy(null);
    }
  };

  const handleLoadDemo = async () => {
    const ok = await confirm({
      title: 'Load sample data?',
      description:
        'Adds a realistic 14-month demo dataset with budgets to your existing records. You can delete everything afterwards from this page.',
      confirmLabel: 'Load sample data',
    });
    if (!ok) return;
    setBusy('demo');
    try {
      await loadDemoData();
      await seedBundledRates();
      setMessage({ tone: 'ok', text: 'Sample data loaded.' });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not load sample data.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleReseedRates = async () => {
    setBusy('rates');
    try {
      // Force a full re-import: clear the applied markers first so a user who
      // believes their history is missing can recover it from Settings.
      await db.meta.delete('appliedRateDatasets');
      await seedBundledRates();
      const available = await db.rates.count();
      setMessage({
        tone: 'ok',
        text: `Bundled rate history restored — ${available.toLocaleString()} rates available.`,
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not load bundled rates.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteCategory = async (category: CategoryRecord) => {
    const used = transactions.filter((transaction) => transaction.categoryId === category.id).length;
    const ok = await confirm({
      title: 'Delete category?',
      description: used
        ? `${used} transaction${used === 1 ? '' : 's'} use this category. They will become uncategorised but keep their amounts and dates.`
        : 'This category is not used by any transaction.',
      confirmLabel: 'Delete category',
      destructive: true,
    });
    if (ok) await db.categories.delete(category.id);
  };

  return (
    <div className="space-y-4">
      {message ? (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl border px-4 py-3 text-[12.5px]',
            message.tone === 'ok'
              ? 'border-income/30 bg-income-soft text-income'
              : 'border-expense/30 bg-expense-soft text-expense',
          )}
        >
          {message.tone === 'ok' ? (
            <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          <p className="flex-1">{message.text}</p>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="rounded px-1 text-current/70 hover:text-current"
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Appearance */}
        <Card>
          <CardHeader title="Appearance" subtitle="Theme applies instantly" />
          <div className="space-y-4 p-4">
            <div>
              <p className="mb-2 text-[13px] font-medium text-text-soft">Theme</p>
              <div className="grid grid-cols-3 gap-2">
                {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void updateSettings({ theme: mode })}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-[12.5px] font-medium transition-colors',
                      settings.theme === mode
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-border text-text-soft hover:bg-surface-2',
                    )}
                  >
                    {mode === 'light' ? (
                      <Sun className="size-4" />
                    ) : mode === 'dark' ? (
                      <Moon className="size-4" />
                    ) : (
                      <Palette className="size-4" />
                    )}
                    <span className="capitalize">{mode}</span>
                  </button>
                ))}
              </div>
            </div>

            <Field label="Locale" hint="Used for number, currency and date formatting.">
              <Select
                value={settings.locale}
                onChange={(event) => void updateSettings({ locale: event.target.value })}
              >
                <option value="en-US">English (United States)</option>
                <option value="en-GB">English (United Kingdom)</option>
                <option value="de-DE">Deutsch (Deutschland)</option>
                <option value="fr-FR">Français (France)</option>
                <option value="es-ES">Español (España)</option>
                <option value="it-IT">Italiano (Italia)</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="ja-JP">日本語 (日本)</option>
                <option value="zh-CN">中文 (中国)</option>
                <option value="ko-KR">한국어 (대한민국)</option>
                <option value="hi-IN">हिन्दी (भारत)</option>
              </Select>
            </Field>

            <Field label="Date format">
              <Select
                value={settings.dateFormat}
                onChange={(event) => void updateSettings({ dateFormat: event.target.value })}
              >
                <option value="dd MMM yyyy">14 Mar 2026</option>
                <option value="yyyy-MM-dd">2026-03-14</option>
                <option value="MM/dd/yyyy">03/14/2026</option>
                <option value="dd/MM/yyyy">14/03/2026</option>
              </Select>
            </Field>

            <Toggle
              checked={settings.showConvertedAmounts}
              onChange={(value) => void updateSettings({ showConvertedAmounts: value })}
              label="Show converted amounts"
              description="Display the reporting-currency value beneath each original amount."
            />
          </div>
        </Card>

        {/* Currency preferences */}
        <Card>
          <CardHeader title="Currency & rates" subtitle="One reporting currency for all totals" />
          <div className="space-y-4 p-4">
            <Field
              label="Reporting currency"
              hint="Every converted total, chart and report is expressed in this currency. Original transaction amounts are never changed."
            >
              <Select
                value={settings.defaultCurrency}
                onChange={(event) => void updateSettings({ defaultCurrency: event.target.value })}
              >
                {currencies
                  .filter((currency) => currency.enabled)
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} · {currency.name}
                    </option>
                  ))}
              </Select>
            </Field>

            <Field
              label="Rate carry-forward window"
              hint="How many days a rate may be carried forward before an amount is treated as unconvertible."
            >
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
                  className="w-24"
                />
                <span className="text-[12.5px] text-muted">days</span>
              </div>
            </Field>

            <div className="rounded-xl border border-border p-3">
              <Toggle
                checked={settings.rateApiEnabled}
                onChange={(value) => void updateSettings({ rateApiEnabled: value })}
                label="Allow network rate fetching"
                description="Off by default — Pocket Ledger stays fully local unless you enable this."
              />
            </div>

            {settings.rateApiEnabled ? (
              <div className="space-y-3 rounded-xl bg-surface-2 p-3">
                <Field label="Provider">
                  <Select
                    value={settings.rateProvider}
                    onChange={(event) =>
                      void updateSettings({
                        rateProvider: event.target.value as 'frankfurter' | 'custom',
                      })
                    }
                  >
                    <option value="frankfurter">Frankfurter (ECB reference rates)</option>
                    <option value="custom">Custom endpoint</option>
                  </Select>
                </Field>
                <Field
                  label="Base URL"
                  hint={
                    settings.rateProvider === 'frankfurter'
                      ? 'Frankfurter serves {date} directly, no key required.'
                      : 'Use {date}, {base} and {symbols} placeholders. {date} may be a YYYY-MM-DD date or a start..end range.'
                  }
                >
                  <Input
                    value={settings.rateApiBaseUrl}
                    onChange={(event) => void updateSettings({ rateApiBaseUrl: event.target.value })}
                    placeholder="https://api.frankfurter.dev/v1"
                  />
                </Field>
                {settings.rateProvider === 'custom' ? (
                  <Field label="API key (optional, stored locally)">
                    <Input
                      type="password"
                      value={settings.rateApiKey}
                      onChange={(event) => void updateSettings({ rateApiKey: event.target.value })}
                      placeholder="Bearer token"
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleReseedRates()} loading={busy === 'rates'}>
                <HardDriveDownload className="size-3.5" />
                Restore bundled history
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Budgets */}
        <Card>
          <CardHeader title="Alerts" subtitle="When Pocket Ledger warns you" />
          <div className="space-y-4 p-4">
            <Field
              label={`Warning threshold — ${settings.budgetAlertThreshold}%`}
              hint="Budgets show a warning once spending passes this share of the limit."
            >
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={settings.budgetAlertThreshold}
                onChange={(event) =>
                  void updateSettings({ budgetAlertThreshold: Number(event.target.value) })
                }
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[var(--pl-primary)]"
              />
            </Field>
            <div className="flex justify-between text-[11.5px] text-muted">
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
            <div className="rounded-xl bg-surface-2 p-3 text-[12px] leading-relaxed text-text-soft">
              Alerts appear on the dashboard when a budget crosses the warning threshold or goes
              over. They are computed from the same historical-rate conversions as the reports, so
              a warning never relies on today's rate.
            </div>
          </div>
        </Card>

        {/* Categories */}
        <Card>
          <CardHeader
            title="Categories"
            subtitle={`${categories.filter((category) => !category.archived).length} active`}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingCategory(null);
                  setCategoryDialogOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            }
          />
          {categories.length === 0 ? (
            <EmptyState className="py-10" title="No categories" description="Add categories to organise spending." />
          ) : (
            <ul className="max-h-[320px] divide-y divide-border overflow-y-auto">
              {categories
                .slice()
                .sort((a, b) => {
                  if (a.kind !== b.kind) return a.kind === 'income' ? -1 : 1;
                  return a.name.localeCompare(b.name);
                })
                .map((category) => (
                  <li key={category.id} className="flex items-center gap-2.5 px-4 py-2">
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${category.color}1a`, color: category.color }}
                    >
                      <CategoryIcon name={category.icon} className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text-soft">
                      {category.name}
                    </span>
                    <Badge tone={category.kind === 'income' ? 'income' : 'neutral'}>
                      {category.kind}
                    </Badge>
                    {category.archived ? <Badge tone="neutral">Archived</Badge> : null}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory(category);
                        setCategoryDialogOpen(true);
                      }}
                      className="rounded-lg p-1 text-muted hover:bg-surface-3 hover:text-text"
                      aria-label={`Edit ${category.name}`}
                    >
                      <Wand2 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCategory(category)}
                      className="rounded-lg p-1 text-muted hover:bg-expense-soft hover:text-expense"
                      aria-label={`Delete ${category.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Data */}
      <Card>
        <CardHeader
          title="Data"
          subtitle="Everything is stored locally in this browser's IndexedDB"
          action={
            <Badge tone="info" icon={<Info className="size-2.5" />}>
              Local only
            </Badge>
          }
        />
        <div className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(dbStats).map(([key, value]) => (
            <div key={key} className="rounded-xl bg-surface-2 px-3 py-2.5">
              <p className="pl-tabular text-lg font-semibold text-text">{value.toLocaleString()}</p>
              <p className="text-[11.5px] text-muted capitalize">{key}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
          <div>
            <p className="text-[13px] font-medium text-text">Backup</p>
            <p className="mt-0.5 text-[12px] text-muted">
              Export a complete JSON snapshot including rates and settings.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleExport()} loading={busy === 'backup'}>
                <Download className="size-3.5" />
                Export backup
              </Button>
              <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" />
                Import backup
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                  event.target.value = '';
                }}
              />
            </div>
          </div>

          <div>
            <p className="text-[13px] font-medium text-text">Sample data</p>
            <p className="mt-0.5 text-[12px] text-muted">
              Load a realistic dataset to explore the app, or start from a clean slate.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleLoadDemo()} loading={busy === 'demo'}>
                <Wand2 className="size-3.5" />
                Load sample data
              </Button>
              <Button variant="ghost" size="sm" className="text-expense" onClick={() => void handleClear()} loading={busy === 'clear'}>
                <Trash2 className="size-3.5" />
                Delete all data
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <p className="text-[11.5px] leading-relaxed text-muted">
            Backup files are versioned JSON (<code>schemaVersion</code>). Importing a backup from a
            newer schema is refused rather than risking silent data loss. Restoring replaces or
            merges records by id.
          </p>
        </div>
      </Card>

      {/* About */}
      <Card>
        <CardHeader title="About Pocket Ledger" subtitle="Version 1.0" />
        <div className="space-y-3 p-4 text-[12.5px] leading-relaxed text-text-soft">
          <p>
            Pocket Ledger stores money as integer minor units (cents, yen) and performs all
            arithmetic with exact bigints, so no balance ever drifts through floating point error.
          </p>
          <p>
            Each transaction keeps its original amount and currency forever. Converted values use
            the exchange rate published on or before that transaction's own date — never today's
            rate as a silent replacement.
          </p>
          <p>
            <strong className="font-medium text-text">Net cash flow is not a bank balance.</strong>{' '}
            Cash flow is the income and expenses you recorded. Account balances are opening balances
            plus every recorded movement, which can still differ from a real bank statement if some
            activity is unrecorded.
          </p>
          <p className="flex items-center gap-1.5 text-muted">
            <BadgeCheck className="size-3.5 text-income" />
            Data stays in this browser unless you explicitly enable rate fetching or export a
            backup. The schema is versioned and migrates forward automatically.
          </p>
        </div>
      </Card>

      <CategoryDialog
        open={categoryDialogOpen}
        category={editingCategory}
        onClose={() => {
          setCategoryDialogOpen(false);
          setEditingCategory(null);
        }}
        onSave={saveCategory}
      />

      {/* Restore confirmation */}
      <Modal
        open={restorePreview !== null}
        onClose={() => setRestorePreview(null)}
        title="Restore backup"
        description={restorePreview ? `Created ${new Date(restorePreview.exportedAt).toLocaleString()}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestorePreview(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRestore()} loading={busy === 'restore'}>
              Restore {restoreMode === 'replace' ? 'and replace' : 'and merge'}
            </Button>
          </>
        }
      >
        {restorePreview ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(restorePreview.counts).map(([key, value]) => (
                <div key={key} className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="pl-tabular text-base font-semibold text-text">{value}</p>
                  <p className="text-[11px] text-muted capitalize">{key}</p>
                </div>
              ))}
            </div>
            <p className="text-[12.5px] text-text-soft">
              Schema version {restorePreview.schemaVersion}. The backup contains amounts in their
              original currencies; nothing is re-converted on import.
            </p>
            <div>
              <p className="mb-2 text-[13px] font-medium text-text-soft">Restore mode</p>
              <Segmented
                value={restoreMode}
                onChange={setRestoreMode}
                options={[
                  { value: 'replace', label: 'Replace all' },
                  { value: 'merge', label: 'Merge' },
                ]}
              />
              <p className="mt-2 text-[11.5px] text-muted">
                {restoreMode === 'replace'
                  ? 'Every existing record is deleted first. This cannot be undone without another backup.'
                  : 'Existing records with the same id are overwritten; other data is kept.'}
              </p>
            </div>
            {restoreMode === 'replace' ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-[12px] text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Your current data will be replaced. Export a backup first if you are unsure.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CategoryDialog({
  open,
  category,
  onClose,
  onSave,
}: {
  open: boolean;
  category: CategoryRecord | null;
  onClose: () => void;
  onSave: (record: CategoryRecord) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [icon, setIcon] = useState('ShoppingCart');
  const [color, setColor] = useState(COLOR_PRESETS[0]!);
  const [error, setError] = useState<string | null>(null);

  // Reset the form when the dialog opens or the target category changes.
  // This belongs in an effect: it is a reaction to props changing, not a
  // derived value, and running it inside useMemo executed setState during
  // render.
  useEffect(() => {
    if (!open) return;
    if (category) {
      setName(category.name);
      setKind(category.kind);
      setIcon(category.icon);
      setColor(category.color);
    } else {
      setName('');
      setKind('expense');
      setIcon('ShoppingCart');
      setColor(COLOR_PRESETS[0]!);
    }
    setError(null);
  }, [open, category]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Give the category a name.');
      return;
    }
    await onSave({
      id: category?.id ?? crypto.randomUUID(),
      name: name.trim(),
      kind,
      icon,
      color,
      archived: false,
      createdAt: category?.createdAt ?? Date.now(),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? 'Edit category' : 'New category'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()}>Save category</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required error={error ?? undefined}>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Groceries" />
        </Field>
        <Field label="Type">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
            className="w-full [&>button]:flex-1"
          />
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                aria-label={`Use colour ${preset}`}
                className={cn(
                  'size-7 rounded-lg transition-transform',
                  color === preset && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
                )}
                style={{ backgroundColor: preset }}
              />
            ))}
          </div>
        </Field>
        <Field label="Icon">
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-border p-2">
            {ICON_NAMES.map((iconName) => (
              <button
                key={iconName}
                type="button"
                onClick={() => setIcon(iconName)}
                aria-label={`Use icon ${iconName}`}
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg border transition-colors',
                  icon === iconName
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-transparent text-text-soft hover:bg-surface-2',
                )}
              >
                <CategoryIcon name={iconName} className="size-4" />
              </button>
            ))}
          </div>
        </Field>
        <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
          <span
            className="flex size-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${color}1a`, color }}
          >
            <CategoryIcon name={icon} className="size-4" />
          </span>
          <span className="text-[13px] font-medium text-text">{name || 'Preview'}</span>
        </div>
      </div>
    </Modal>
  );
}
