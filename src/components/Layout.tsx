import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Coins,
  LayoutDashboard,
  Menu,
  Moon,
  Plus,
  Receipt,
  Settings as SettingsIcon,
  Sun,
  Target,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../state/AppContext';
import { Button, cn } from './ui';
import { TransactionDialog } from './TransactionDialog';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  mobile: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, mobile: true },
  { to: '/transactions', label: 'Transactions', icon: Receipt, mobile: true },
  { to: '/budgets', label: 'Budgets', icon: Target, mobile: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, mobile: false },
  { to: '/currencies', label: 'Currencies', icon: Coins, mobile: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, mobile: true },
];

function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex size-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30',
        className,
      )}
    >
      <Wallet className="size-[18px]" />
    </div>
  );
}

function ThemeToggle() {
  const { settings, updateSettings } = useApp();
  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => void updateSettings({ theme: isDark ? 'light' : 'dark' })}
    >
      {isDark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
  );
}

function CurrencyPicker() {
  const { currencies, settings, updateSettings } = useApp();
  const enabled = useMemo(
    () => currencies.filter((currency) => currency.enabled).sort((a, b) => a.code.localeCompare(b.code)),
    [currencies],
  );

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Reporting currency</span>
      <select
        value={settings.defaultCurrency}
        onChange={(event) => void updateSettings({ defaultCurrency: event.target.value })}
        className="h-9 appearance-none rounded-lg border border-border bg-surface py-0 pr-8 pl-3 pr-8 text-[13px] font-medium text-text transition-colors hover:bg-surface-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      >
        {enabled.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.code} · {currency.name}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 size-3.5 text-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const location = useLocation();
  const { settings } = useApp();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      root.classList.toggle('dark', dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme]);

  const activeItem = NAV_ITEMS.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to),
  );

  const navLinkClass = (isActive: boolean) =>
    cn(
      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      isActive
        ? 'bg-primary-soft text-primary'
        : 'text-text-soft hover:bg-surface-2 hover:text-text',
    );

  return (
    <div className="min-h-dvh bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <BrandMark />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-tight text-text">
              Pocket Ledger
            </p>
            <p className="truncate text-[11.5px] text-muted">Personal finance</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => navLinkClass(isActive)}
            >
              <item.icon className="size-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-border p-4">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
              Reporting currency
            </p>
            <div className="mt-2">
              <CurrencyPicker />
            </div>
          </div>
          <Button className="w-full" onClick={() => setComposerOpen(true)}>
            <Plus className="size-4" />
            Add transaction
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[272px] flex-col bg-surface shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <BrandMark />
                <p className="text-[15px] font-semibold tracking-tight">Pocket Ledger</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </Button>
            </div>
            <nav className="flex-1 space-y-1 px-3">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  <item.icon className="size-[18px] shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-border p-4">
              <CurrencyPicker />
            </div>
          </div>
        </div>
      ) : null}

      <div className="lg:pl-[248px]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-text">
              {activeItem?.label ?? 'Pocket Ledger'}
            </h1>
          </div>

          <div className="lg:hidden">
            <CurrencyPicker />
          </div>
          <ThemeToggle />
          <Button
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => setComposerOpen(true)}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </header>

        <main className="mx-auto w-full max-w-[1360px] px-4 pt-5 pb-24 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="grid grid-cols-4">
          {NAV_ITEMS.filter((item) => item.mobile).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted',
                )
              }
            >
              <item.icon className="size-[19px]" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Floating add button on mobile */}
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        aria-label="Add transaction"
        className="fixed right-4 bottom-[76px] z-30 flex size-13 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30 transition-transform active:scale-95 lg:hidden"
      >
        <Plus className="size-5" />
      </button>

      <TransactionDialog open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  );
}
