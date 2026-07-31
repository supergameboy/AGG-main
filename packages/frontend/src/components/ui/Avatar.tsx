import { cn } from '@/utils/cn';

export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  shape?: 'circle' | 'square';
  className?: string;
}

const sizeStyles = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
};

export function Avatar({
  name,
  src,
  size = 'md',
  color,
  shape = 'circle',
  className,
}: AvatarProps) {
  const initial = name.charAt(0).toUpperCase();
  const shapeStyle = shape === 'circle' ? 'rounded-full' : 'rounded-lg';

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(
          sizeStyles[size],
          shapeStyle,
          'object-cover shrink-0',
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        sizeStyles[size],
        shapeStyle,
        'flex items-center justify-center shrink-0 font-bold text-white select-none',
        className
      )}
      style={{
        backgroundColor: color ?? 'var(--accent)',
      }}
    >
      {initial}
    </div>
  );
}
