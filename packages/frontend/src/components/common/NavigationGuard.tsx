import { type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';

interface NavigationGuardProps {
  children: ReactNode;
}

export function NavigationGuard({ children }: NavigationGuardProps) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => {
      return currentLocation.pathname.startsWith('/game') && !nextLocation.pathname.startsWith('/game');
    }
  );

  return (
    <>
      {children}
      <Modal
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="离开游戏"
        description="确定要离开游戏吗？未保存的进度可能会丢失。"
        size="sm"
        footer={
          <>
            <button
              onClick={() => blocker.reset?.()}
              className="rounded-md border border-[var(--border-primary)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
            >
              继续游戏
            </button>
            <button
              onClick={() => blocker.proceed?.()}
              className="rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            >
              离开
            </button>
          </>
        }
      />
    </>
  );
}
