import { cn } from '@/utils/cn';

export interface StatBlockProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  color?: string;
  layout?: 'horizontal' | 'vertical';
  className?: string;
}

export function StatBlock({
  label,
  value,
  icon,
  color,
  layout = 'horizontal',
  className,
}: StatBlockProps) {
  if (layout === 'vertical') {
    return (
      <div className={cn('flex flex-col items-center gap-0.5', className)}>
        {icon && <span className="text-base">{icon}</span>}
        <span
          className="text-sm font-semibold"
          style={color ? { color } : undefined}
        >
          {value}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-between py-1', className)}>
      <span className="text-xs text-[var(--text-secondary)] inline-flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span
        className="text-sm font-semibold"
        style={color ? { color } : { color: 'var(--text-primary)' }}
      >
        {value}
      </span>
    </div>
  );
}
