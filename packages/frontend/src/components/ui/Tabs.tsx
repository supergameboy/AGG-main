import { cn } from '@/utils/cn';

export interface TabsProps {
  tabs: Array<{
    id: string;
    label: string;
    count?: number;
    icon?: React.ReactNode;
  }>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  variant?: 'default' | 'pill' | 'underline';
  size?: 'sm' | 'md';
  className?: string;
}

const variantStyles = {
  default: {
    container: 'flex gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg',
    tab: 'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    active: 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm',
    inactive: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
  },
  pill: {
    container: 'flex flex-wrap gap-1',
    tab: 'px-3 py-1 rounded-full text-xs font-medium transition-colors',
    active: 'bg-[var(--accent)]/15 text-[var(--accent)]',
    inactive: 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
  },
  underline: {
    container: 'flex gap-0 border-b border-[var(--border-primary)]',
    tab: 'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
    active: 'text-[var(--accent)] border-[var(--accent)]',
    inactive: 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]',
  },
};

const sizeStyles = {
  sm: {
    tab: 'px-2 py-1 text-xs',
  },
  md: {
    tab: '',
  },
};

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  variant = 'default',
  size = 'md',
  className,
}: TabsProps) {
  const styles = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <div className={cn(styles.container, className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            className={cn(
              styles.tab,
              sizeStyle.tab,
              isActive ? styles.active : styles.inactive,
              'cursor-pointer bg-transparent border-none outline-none',
            )}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="inline-flex items-center gap-1.5">
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'ml-0.5 px-1.5 py-0 rounded-full text-[10px] leading-none',
                    isActive
                      ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
