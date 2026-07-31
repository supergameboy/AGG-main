import { cn } from '@/utils/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'unique';
  size?: 'sm' | 'md';
  dot?: boolean;
  customColor?: string;
}

const variantStyles = {
  default: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]',
  primary: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  success: 'bg-[var(--success)]/15 text-[var(--success)]',
  warning: 'bg-[var(--warning)]/15 text-[var(--warning)]',
  error: 'bg-[var(--error)]/15 text-[var(--error)]',
  info: 'bg-[var(--info)]/15 text-[var(--info)]',
};

const rarityStyles = {
  common: 'bg-[var(--common)]/15 text-[var(--common)]',
  uncommon: 'bg-[var(--uncommon)]/15 text-[var(--uncommon)]',
  rare: 'bg-[var(--rare)]/15 text-[var(--rare)]',
  epic: 'bg-[var(--epic)]/15 text-[var(--epic)]',
  legendary: 'bg-[var(--legendary)]/15 text-[var(--legendary)]',
  unique: 'bg-[var(--unique)]/15 text-[var(--unique)]',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

const dotColorMap: Record<string, string> = {
  default: 'bg-[var(--text-secondary)]',
  primary: 'bg-[var(--accent)]',
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  error: 'bg-[var(--error)]',
  info: 'bg-[var(--info)]',
  common: 'bg-[var(--common)]',
  uncommon: 'bg-[var(--uncommon)]',
  rare: 'bg-[var(--rare)]',
  epic: 'bg-[var(--epic)]',
  legendary: 'bg-[var(--legendary)]',
  unique: 'bg-[var(--unique)]',
};

export function Badge({
  variant = 'default',
  rarity,
  size = 'sm',
  dot = false,
  customColor,
  className,
  children,
  ...props
}: BadgeProps) {
  const activeStyle = rarity ? rarityStyles[rarity] : variantStyles[variant];
  const dotColor = rarity ? dotColorMap[rarity] : dotColorMap[variant];

  if (customColor) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 font-medium rounded-full',
          sizeStyles[size],
          className
        )}
        style={{
          backgroundColor: `color-mix(in srgb, ${customColor} 15%, transparent)`,
          color: customColor,
        }}
        {...props}
      >
        {dot && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: customColor }}
          />
        )}
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium rounded-full',
        activeStyle,
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotColor)} />
      )}
      {children}
    </span>
  );
}
