import { Suspense, lazy, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { setUnauthenticatedHandler } from './api/client';
import { keys, useAuthStatus, useMe } from './api/hooks';
import { AppShell } from './components/AppShell';
import { ConfirmProvider, ErrorState, LoadingBlock, ToastProvider } from './components/ui';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { LoginPage } from './pages/Login';
const OverviewPage = lazy(() =>
  import('./pages/Overview').then((m) => ({ default: m.OverviewPage })),
);
const PracticePage = lazy(() =>
  import('./pages/Practice').then((m) => ({ default: m.PracticePage })),
);
const RunnerPage = lazy(() => import('./pages/Runner').then((m) => ({ default: m.RunnerPage })));
const ResultsPage = lazy(() => import('./pages/Results').then((m) => ({ default: m.ResultsPage })));
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.HistoryPage })));
const BankPage = lazy(() => import('./pages/Bank').then((m) => ({ default: m.BankPage })));
const QuestionEditorPage = lazy(() =>
  import('./pages/QuestionEditor').then((m) => ({ default: m.QuestionEditorPage })),
);
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })));
const LibraryPage = lazy(() => import('./pages/Library').then((m) => ({ default: m.LibraryPage })));
const InsightsPage = lazy(() =>
  import('./pages/Insights').then((m) => ({ default: m.InsightsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })),
);

function AuthenticatedApp() {
  const me = useMe();
  const themeRef = useRef(me.data?.preferences.theme ?? 'system');
  useEffect(() => {
    if (me.data) {
      themeRef.current = me.data.preferences.theme;
      applyTheme(me.data.preferences.theme);
    }
  }, [me.data]);
  useEffect(() => watchSystemTheme(() => themeRef.current), []);

  if (me.isPending) {
    return (
      <div className="center-screen">
        <div style={{ width: 320 }}>
          <LoadingBlock label="Loading your workspace" />
        </div>
      </div>
    );
  }
  if (me.isError || !me.data) {
    return (
      <div className="center-screen">
        <div className="card panel">
          <ErrorState error={me.error} onRetry={() => void me.refetch()} />
        </div>
      </div>
    );
  }
  return (
    <ConfirmProvider>
      <AppShell me={me.data}>
        <Suspense
          fallback={
            <div className="page card panel">
              <LoadingBlock rows={5} />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/practice" element={<PracticePage preferences={me.data.preferences} />} />
            <Route path="/session/:id" element={<RunnerPage />} />
            <Route path="/session/:id/results" element={<ResultsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/bank" element={<BankPage />} />
            <Route path="/bank/new" element={<QuestionEditorPage />} />
            <Route path="/bank/import" element={<ImportPage />} />
            <Route path="/bank/:id" element={<QuestionEditorPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/settings" element={<SettingsPage me={me.data} />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppShell>
    </ConfirmProvider>
  );
}

export function App() {
  const status = useAuthStatus();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      client.setQueryData(keys.status, (old: { ownerConfigured: boolean } | undefined) => ({
        ownerConfigured: old?.ownerConfigured ?? true,
        authenticated: false,
      }));
      client.removeQueries({ queryKey: keys.me });
    });
  }, [client]);

  useEffect(() => {
    if (status.data && !status.data.authenticated && location.pathname !== '/login') {
      void navigate(
        `/login${location.pathname !== '/' ? `?next=${encodeURIComponent(location.pathname)}` : ''}`,
        {
          replace: true,
        },
      );
    }
  }, [status.data, location.pathname, navigate]);

  let content;
  if (status.isPending) {
    content = (
      <div className="center-screen">
        <div style={{ width: 320 }}>
          <LoadingBlock label="Connecting" />
        </div>
      </div>
    );
  } else if (status.isError) {
    content = (
      <div className="center-screen">
        <div className="card panel" style={{ maxWidth: 480 }}>
          <ErrorState
            title="Cannot reach Recall Studio"
            error={status.error}
            onRetry={() => void status.refetch()}
          />
        </div>
      </div>
    );
  } else if (!status.data.authenticated) {
    content = (
      <Routes>
        <Route path="*" element={<LoginPage ownerConfigured={status.data.ownerConfigured} />} />
      </Routes>
    );
  } else {
    content = <AuthenticatedApp />;
  }
  return <ToastProvider>{content}</ToastProvider>;
}
