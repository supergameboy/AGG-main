import { memo } from 'react';
import { CubeIcon, CheckIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatItemStat } from '@/utils/entityMapper';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface ItemCardProps {
  name: string;
  description?: string;
  quantity?: number;
  rarity?: ItemRarity;
  type?: string;
  equipped?: boolean;
  stats?: Record<string, number>;
  onClick?: () => void;
  onUse?: () => void;
  onEquip?: () => void;
  className?: string;
}

const rarityBorderColors: Record<ItemRarity, string> = {
  common: 'var(--common)',
  uncommon: 'var(--uncommon)',
  rare: 'var(--rare)',
  epic: 'var(--epic)',
  legendary: 'var(--legendary)',
};

const rarityBgLight: Record<ItemRarity, string> = {
  common: 'rgba(156, 163, 175, 0.15)',
  uncommon: 'rgba(34, 197, 94, 0.15)',
  rare: 'rgba(59, 130, 246, 0.15)',
  epic: 'rgba(168, 85, 247, 0.15)',
  legendary: 'rgba(245, 158, 11, 0.15)',
};

export const ItemCard = memo(function ItemCard({
  name,
  description,
  quantity,
  rarity = 'common',
  type,
  equipped = false,
  stats,
  onClick,
  onUse,
  onEquip,
  className,
}: ItemCardProps) {
  const borderColor = rarityBorderColors[rarity];
  const iconBg = rarityBgLight[rarity];
  const isLegendary = rarity === 'legendary';
  const hasActions = onUse || onEquip;

  return (
    <Card
      variant="bordered"
      padding="sm"
      hoverable
      borderColor={borderColor}
      className={cn(
        'relative flex flex-col items-center gap-2 group',
        isLegendary && '[box-shadow:0_0_12px_rgba(245,158,11,0.4),0_0_24px_rgba(245,158,11,0.2)]',
        className
      )}
      onClick={onClick}
    >
      {quantity !== undefined && quantity > 1 && (
        <span
          className={cn(
            'absolute top-1.5 right-1.5 min-w-[20px] h-5 px-1.5',
            'flex items-center justify-center',
            'bg-[var(--bg-secondary)] rounded text-xs font-medium text-[var(--text-secondary)]',
            'z-10'
          )}
        >
          {quantity}
        </span>
      )}

      {equipped && (
        <span
          className={cn(
            'absolute top-1.5 left-1.5 w-5 h-5',
            'flex items-center justify-center',
            'rounded-full text-white text-xs font-bold z-10'
          )}
          style={{ backgroundColor: borderColor }}
        >
          <CheckIcon className="w-3 h-3" />
        </span>
      )}

      <div
        className="w-12 h-12 flex items-center justify-center rounded-md shrink-0"
        style={{ backgroundColor: iconBg }}
      >
        <CubeIcon className="w-6 h-6" style={{ color: borderColor }} />
      </div>

      <div className="flex flex-col items-center gap-0.5 w-full min-w-0">
        <span
          className="text-sm font-medium text-center truncate w-full"
          style={{ color: borderColor }}
        >
          {name}
        </span>

        {type && (
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
            {type}
          </span>
        )}

        {description && (
          <span className="text-xs text-[var(--text-muted)] truncate w-full text-center">
            {description}
          </span>
        )}

        {stats && Object.keys(stats).length > 0 && (
          <div className="flex flex-wrap gap-1 justify-center mt-1">
            {Object.entries(stats).map(([key, value]) => (
              <Badge key={key} variant="default" size="sm">
                {formatItemStat(key, value)}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {hasActions && (
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 flex gap-1 p-1.5 rounded-b-xl',
            'bg-[var(--bg-card)] border-t-2 transition-opacity',
            'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          )}
          style={{ borderColor }}
        >
          {onUse && (
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onUse();
              }}
            >
              使用
            </Button>
          )}
          {onEquip && (
            <Button
              variant={equipped ? 'danger' : 'primary'}
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onEquip();
              }}
            >
              {equipped ? '卸下' : '装备'}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
});
