import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomePage } from './pages/HomePage.tsx';
import './styles/global.css';
const PracticePage = lazy(() =>
  import('./pages/PracticePage.tsx').then((m) => ({ default: m.PracticePage })),
);
const TutorialPage = lazy(() =>
  import('./pages/TutorialPage.tsx').then((m) => ({ default: m.TutorialPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage.tsx').then((m) => ({ default: m.HistoryPage })),
);
const LobbyPage = lazy(() =>
  import('./pages/LobbyPage.tsx').then((m) => ({ default: m.LobbyPage })),
);
const LabPage = lazy(() => import('./pages/LabPage.tsx').then((m) => ({ default: m.LabPage })));
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main className="empty">
        <h1>畫面遇到問題</h1>
        <p role="alert">{this.state.error}</p>
        <a href={import.meta.env.BASE_URL}>回大廳</a>
      </main>
    ) : (
      this.props.children
    );
  }
}
function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return offline ? <div className="offline">目前離線，本地練習仍可使用</div> : null;
}
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
const Router = import.meta.env.BASE_URL === '/' ? BrowserRouter : HashRouter;
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <Router>
        <OfflineBanner />
        <Suspense
          fallback={
            <main className="empty">
              <span className="loader" />
              <p>正在準備牌桌…</p>
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/practice" element={<PracticePage />} />
            <Route path="/game/:gameId" element={<PracticePage />} />
            <Route path="/tutorial" element={<TutorialPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/lobby" element={<LobbyPage />} />
            <Route path="/room/:roomId" element={<LobbyPage />} />
            <Route path="/lab" element={<LabPage />} />
            <Route
              path="*"
              element={
                <main className="empty">
                  <h1>找不到這個頁面</h1>
                  <Link to="/">回大廳</Link>
                </main>
              }
            />
          </Routes>
        </Suspense>
      </Router>
    </QueryClientProvider>
  </ErrorBoundary>,
);
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* An unavailable SW never blocks play. */
    });
  });
