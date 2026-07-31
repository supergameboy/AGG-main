import { useMemo, memo } from 'react';
import { cn } from '@/utils/cn';
import { resolveI18nKey } from '@/utils/i18nResolver';
import { formatItemStat, RARITY_COLORS, ITEM_TYPE_LABELS, ITEM_RARITY_LABELS } from '@/utils/entityMapper';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Divider } from '@/components/ui/Divider';
import { StatBlock } from '@/components/ui/StatBlock';
import { DEFAULT_EQUIPMENT_SLOTS } from '@/types';
import type { FrontendInventoryItem, EquipmentSlot, EquipmentSlotDefinition } from '@/types';

type EquippedItem = FrontendInventoryItem;

interface EquipmentPanelProps {
  equippedItems: FrontendInventoryItem[];
  onUnequip?: (itemId: string) => void;
  onItemDetail?: (item: EquippedItem) => void;
  equipmentSlotDefs?: EquipmentSlotDefinition[];
  className?: string;
}

/**
 * 构建槽位 → 物品数组映射（按 equippedIndex 升序）。
 * 同一槽位 capacity > 1 时，多个物品共存（如 accessory 槽位 2 个饰品）。
 */
function buildEquippedMap(equippedItems: FrontendInventoryItem[]): Map<EquipmentSlot, EquippedItem[]> {
  const map = new Map<EquipmentSlot, EquippedItem[]>();
  for (const item of equippedItems) {
    if (item.equipped && item.equippedSlot) {
      const list = map.get(item.equippedSlot) ?? [];
      list.push(item);
      map.set(item.equippedSlot, list);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.equippedIndex ?? 0) - (b.equippedIndex ?? 0));
  }
  return map;
}

function EquippedCard({
  item,
  slotDef,
  onUnequip,
  onItemDetail,
}: {
  item: EquippedItem | undefined;
  slotDef: EquipmentSlotDefinition;
  onUnequip?: (itemId: string) => void;
  onItemDetail?: (item: EquippedItem) => void;
}) {
  const rarityColor = item?.quality ? RARITY_COLORS[item.quality] : undefined;

  return (
    <Card
      variant="bordered"
      padding="sm"
      accentSide={item && rarityColor ? 'left' : 'none'}
      accentColor={rarityColor}
      className={cn(
        'rounded-lg flex items-center gap-2 transition-colors',
        item
          ? 'cursor-pointer hover:bg-[var(--bg-primary)]'
          : 'border-dashed bg-transparent'
      )}
      onClick={item ? () => onItemDetail?.(item) : undefined}
    >
      <span className="text-base leading-none">{slotDef.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Badge variant="default" size="sm">{resolveI18nKey(slotDef.name)}</Badge>
        </div>
        {item ? (
          <>
            <p
              className="text-xs font-medium truncate"
              style={rarityColor ? { color: rarityColor } : undefined}
            >
              {item.name}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {item.category && (
                <span className="text-[10px] text-[var(--text-muted)]">
                  {ITEM_TYPE_LABELS[item.category] || item.category}
                </span>
              )}
              {item.quality && (
                <span className="text-[10px]" style={rarityColor ? { color: rarityColor } : undefined}>
                  {ITEM_RARITY_LABELS[item.quality] || item.quality}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--text-muted)] italic">空</p>
        )}
        {item?.stats && Object.keys(item.stats).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {Object.entries(item.stats).map(([key, value]) => (
              <Badge key={key} variant="default" size="sm">
                {formatItemStat(key, value ?? 0)}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {item && onUnequip && (
        <Button
          variant="ghost"
          size="sm"
          hoverColor="var(--error, #ef4444)"
          onClick={(e) => {
            e.stopPropagation();
            onUnequip(item.id);
          }}
        >
          卸下
        </Button>
      )}
    </Card>
  );
}

export const EquipmentPanel = memo(function EquipmentPanel({ equippedItems, onUnequip, onItemDetail, equipmentSlotDefs, className }: EquipmentPanelProps) {
  const slots = equipmentSlotDefs ?? DEFAULT_EQUIPMENT_SLOTS;

  const equippedMap = useMemo(() => buildEquippedMap(equippedItems), [equippedItems]);

  const equippedCount = useMemo(
    () => equippedItems.filter((i) => i.equipped).length,
    [equippedItems],
  );

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="space-y-1.5">
        {slots.map((slotDef) => {
          const slotId = slotDef.id as EquipmentSlot;
          const items = equippedMap.get(slotId) ?? [];
          const capacity = slotDef.capacity && slotDef.capacity > 1 ? slotDef.capacity : 1;

          if (capacity === 1) {
            return (
              <EquippedCard
                key={slotId}
                item={items[0]}
                slotDef={slotDef}
                onUnequip={onUnequip}
                onItemDetail={onItemDetail}
              />
            );
          }

          return Array.from({ length: capacity }, (_, idx) => (
            <EquippedCard
              key={`${slotId}-${idx}`}
              item={items[idx]}
              slotDef={slotDef}
              onUnequip={onUnequip}
              onItemDetail={onItemDetail}
            />
          ));
        })}
      </div>

      {equippedItems.length > 0 && (
        <>
          <Divider />
          <StatBlock
            label="已装备"
            value={`${equippedCount}/${slots.reduce((sum, s) => sum + (s.capacity ?? 1), 0)}`}
          />
        </>
      )}
    </div>
  );
});
