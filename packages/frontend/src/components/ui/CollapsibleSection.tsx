import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

export interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  count,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onToggle,
  children,
  className,
}: CollapsibleSectionProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const handleToggle = onToggle ?? (() => setInternalExpanded(v => !v));

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1 w-full text-left text-[10px] font-medium text-[var(--accent)]/70 hover:text-[var(--accent)] transition-colors"
      >
        {isExpanded ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0" />
        )}
        <span>{title}</span>
        {count !== undefined && (
          <span className="text-[var(--text-tertiary)]">({count})</span>
        )}
      </button>
      {isExpanded && <div className="mt-1">{children}</div>}
    </div>
  );
}
