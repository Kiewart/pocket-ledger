import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './state/AppContext';
import { ConfirmProvider, Spinner } from './components/ui';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { ReportsPage } from './pages/ReportsPage';
import { CurrenciesPage } from './pages/CurrenciesPage';
import { SettingsPage } from './pages/SettingsPage';

function BootGate({ children }: { children: React.ReactNode }) {
  const { ready } = useApp();
  if (!ready) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/25">
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
            <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
          </svg>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner />
          Preparing your ledger…
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AppProvider>
      <ConfirmProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <BootGate>
            <Layout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/budgets" element={<BudgetsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/currencies" element={<CurrenciesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </BootGate>
        </BrowserRouter>
      </ConfirmProvider>
    </AppProvider>
  );
}
