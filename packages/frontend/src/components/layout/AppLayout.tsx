import { useEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { SunIcon, MoonIcon, Cog6ToothIcon, HomeIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { TranslationConfirmDialog } from '@/components/common/TranslationConfirmDialog';
import { wsManager } from '@/services/WebSocketManager';

export function AppLayout() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useTranslation('navigation');

  // WS 连接生命周期绑定到 AppLayout（应用级单例，WS 强制开启）
  useEffect(() => {
    wsManager.connect();
    return () => {
      wsManager.disconnect();
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-card)] px-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-[var(--accent)]">
            {t('gameTitle')}
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
          >
            <HomeIcon className="h-4 w-4" />
            {t('mainMenu')}
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="rounded-md p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
            aria-label={t('toggleTheme')}
          >
            {resolvedTheme === 'dark' ? (
              <SunIcon className="h-5 w-5" />
            ) : (
              <MoonIcon className="h-5 w-5" />
            )}
          </button>
          <Link
            to="/settings"
            className="rounded-md p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
            aria-label={t('settings')}
          >
            <Cog6ToothIcon className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      <TranslationConfirmDialog />
    </div>
  );
}
