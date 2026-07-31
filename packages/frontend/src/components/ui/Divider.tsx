import { cn } from '@/utils/cn';

export interface DividerProps {
  variant?: 'solid' | 'dashed' | 'dotted';
  orientation?: 'horizontal' | 'vertical';
  color?: string;
  label?: string;
  className?: string;
}

const variantStyles = {
  solid: 'border-solid',
  dashed: 'border-dashed',
  dotted: 'border-dotted',
};

export function Divider({
  variant = 'solid',
  orientation = 'horizontal',
  color,
  label,
  className,
}: DividerProps) {
  const borderColor = color ?? 'var(--border-primary)';

  if (label && orientation === 'horizontal') {
    return (
      <div className={cn('flex items-center my-2', className)}>
        <div
          className={cn('flex-1 border-t', variantStyles[variant])}
          style={{ borderColor }}
        />
        <span className="px-3 text-xs text-[var(--text-muted)]">{label}</span>
        <div
          className={cn('flex-1 border-t', variantStyles[variant])}
          style={{ borderColor }}
        />
      </div>
    );
  }

  if (orientation === 'vertical') {
    return (
      <div
        className={cn('border-l self-stretch', variantStyles[variant], className)}
        style={{ borderColor }}
      />
    );
  }

  return (
    <hr
      className={cn('my-2 border-0 border-t', variantStyles[variant], className)}
      style={{ borderColor }}
    />
  );
}
