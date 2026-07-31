import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

export interface CardProps {
  id?: string;
  variant?: 'default' | 'bordered' | 'elevated' | 'ghost';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  borderColor?: string;
  accentSide?: 'left' | 'top' | 'none';
  accentColor?: string;
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}

const variantStyles = {
  default: 'bg-[var(--bg-card)] border border-[var(--border-primary)] shadow-[var(--shadow-sm)]',
  bordered: 'bg-[var(--bg-card)] border-2 border-[var(--border-secondary)]',
  elevated: 'bg-[var(--bg-card)] shadow-[var(--shadow-md)]',
  ghost: 'bg-transparent',
};

const paddingStyles = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export function Card({
  id,
  variant = 'default',
  padding = 'md',
  hoverable = false,
  header,
  footer,
  borderColor,
  accentSide = 'none',
  accentColor,
  className,
  children,
  onClick,
}: CardProps) {
  const borderStyle = borderColor
    ? { borderColor }
    : undefined;
  const accentStyle = accentColor && accentSide !== 'none'
    ? { [accentSide === 'left' ? 'borderLeftColor' : 'borderTopColor']: accentColor }
    : undefined;
  const accentCls = accentSide === 'left'
    ? 'border-l-4'
    : accentSide === 'top'
      ? 'border-t-4'
      : '';
  const inner = (
    <>
      {header && (
        <div className="border-b border-[var(--border-primary)] pb-3 mb-3">
          {header}
        </div>
      )}
      {children}
      {footer && (
        <div className="border-t border-[var(--border-primary)] pt-3 mt-3">
          {footer}
        </div>
      )}
    </>
  );

  if (hoverable) {
    return (
      <motion.div
        id={id}
        className={cn(
          'rounded-xl cursor-pointer',
          accentCls,
          variantStyles[variant],
          paddingStyles[padding],
          className
        )}
        style={{ ...borderStyle, ...accentStyle }}
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        onClick={onClick}
      >
        {inner}
      </motion.div>
    );
  }

  return (
    <div
      id={id}
      className={cn(
        'rounded-xl',
        accentCls,
        variantStyles[variant],
        paddingStyles[padding],
        className
      )}
      style={{ ...borderStyle, ...accentStyle }}
      onClick={onClick}
    >
      {inner}
    </div>
  );
}
