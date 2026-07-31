import { forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  hoverColor?: string;
}

const variantStyles = {
  primary:
    'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] active:bg-[var(--accent-hover)] shadow-sm',
  secondary:
    'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-primary)] active:bg-[var(--bg-primary)]',
  outline:
    'border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] active:bg-[var(--bg-secondary)]',
  ghost:
    'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] active:bg-[var(--bg-secondary)]',
  danger:
    'bg-[var(--error)] text-white hover:opacity-90 active:opacity-90 shadow-sm',
};

const sizeStyles = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'left',
      fullWidth = false,
      hoverColor,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          (variant === 'primary' || variant === 'secondary') &&
            'hover:-translate-y-px active:translate-y-0',
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && 'w-full',
          loading && 'pointer-events-none',
          className
        )}
        style={hoverColor ? { '--btn-hover-color': hoverColor } as React.CSSProperties : undefined}
        onMouseEnter={(e) => {
          if (hoverColor && !disabled && !loading) {
            e.currentTarget.style.color = hoverColor;
            if (variant === 'outline' || variant === 'ghost') {
              e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${hoverColor} 10%, transparent)`;
              e.currentTarget.style.borderColor = hoverColor;
            }
          }
        }}
        onMouseLeave={(e) => {
          if (hoverColor) {
            e.currentTarget.style.color = '';
            e.currentTarget.style.backgroundColor = '';
            e.currentTarget.style.borderColor = '';
          }
        }}
        {...props}
      >
        {loading && (
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {!loading && icon && iconPosition === 'left' && icon}
        {children}
        {!loading && icon && iconPosition === 'right' && icon}
      </button>
    );
  }
);

Button.displayName = 'Button';
