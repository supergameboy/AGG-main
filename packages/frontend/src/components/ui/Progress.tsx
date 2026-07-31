import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  variant?: 'default' | 'health' | 'mana' | 'experience' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  label?: string;
  icon?: React.ReactNode;
  labelRender?: (value: number, max: number) => React.ReactNode;
  animated?: boolean;
}

const sizeStyles = {
  sm: 'h-2',
  md: 'h-3',
  lg: 'h-4',
};

const variantStyles = {
  default: 'bg-[var(--accent)]',
  health: 'bg-gradient-to-r from-red-500 to-red-400',
  mana: 'bg-gradient-to-r from-blue-500 to-blue-400',
  experience: 'bg-gradient-to-r from-purple-500 to-purple-400',
  gold: 'bg-gradient-to-r from-amber-500 to-amber-400',
};

export function Progress({
  value,
  max = 100,
  variant = 'default',
  size = 'md',
  showLabel = false,
  label,
  icon,
  labelRender,
  animated = false,
  className,
  ...props
}: ProgressProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(Math.max((value / safeMax) * 100, 0), 100);

  return (
    <div className={cn('w-full', className)} {...props}>
      {(label || showLabel || icon || labelRender) && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1">
            {icon}
            {label}
          </span>
          {labelRender ? labelRender(value, max) : showLabel && (
            <span className="text-xs font-mono text-[var(--text-secondary)]">
              {value}/{max > 0 ? max : '?'}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]',
          sizeStyles[size]
        )}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <motion.div
          className={cn(
            'h-full rounded-full',
            variantStyles[variant],
            animated && 'relative overflow-hidden'
          )}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {animated && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2s_infinite]" />
          )}
        </motion.div>
      </div>
    </div>
  );
}
