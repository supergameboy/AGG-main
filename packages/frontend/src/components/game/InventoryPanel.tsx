import { useState, useMemo, useRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CurrencyDollarIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { cn } from '@/utils/cn';
import { formatItemStat, RARITY_COLORS } from '@/utils/entityMapper';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import type { FrontendInventoryItem } from '@/types';
import { resolveItemDisplay } from '@/utils/customDataResolver';

type InventoryItem = FrontendInventoryItem;

interface InventoryPanelProps {
  items: InventoryItem[];
  gold?: number;
  maxSlots?: number;
  onItemUse?: (itemId: string) => void;
  onItemEquip?: (itemId: string) => void;
  onItemDrop?: (itemId: string) => void;
  onItemDetail?: (item: InventoryItem) => void;
  className?: string;
}

type CategoryKey = 'all' | 'weapon' | 'armor' | 'consumable' | 'material' | 'quest' | 'other';
type SortKey = 'rarity' | 'name' | 'type';

const CATEGORY_KEYS: CategoryKey[] = ['all', 'weapon', 'armor', 'consumable', 'material', 'quest', 'other'];

const RARITY_ORDER: Record<string, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

const CATEGORY_MAP: Record<string, CategoryKey> = {
  weapon: 'weapon',
  armor: 'armor',
  consumable: 'consumable',
  material: 'material',
  quest: 'quest',
  other: 'other',
};

function mapCategory(item: InventoryItem): CategoryKey {
  if (item.category && item.category in CATEGORY_MAP) {
    return CATEGORY_MAP[item.category];
  }
  return 'other';
}

const InventoryCard = memo(function InventoryCard({
  item,
  onUse,
  onEquip,
  onDetail,
}: {
  item: InventoryItem;
  onUse?: () => void;
  onEquip?: () => void;
  onDetail?: () => void;
}) {
  const { t } = useTranslation('game');
  const rarityColor = RARITY_COLORS[item.quality ?? 'common'];
  const hasActions = onUse || onEquip;
  const displayData = resolveItemDisplay(item);

  return (
    <Card
      variant="default"
      padding="sm"
      className="flex flex-col gap-2 hover:border-[var(--border-secondary)]"
      onClick={onDetail}
    >
      <div className="flex items-start gap-3">
        <Avatar
          name={item.name ?? ''}
          shape="square"
          color={rarityColor}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <Tooltip content={item.name} multiline>
              <span className="text-sm font-semibold truncate" style={{ color: rarityColor }}>
                {item.name}
              </span>
            </Tooltip>
            {item.equipped && (
              <Badge customColor={rarityColor} size="sm">{t('inventory.equipped')}</Badge>
            )}
            {item.category && (
              <Badge variant="default" size="sm">
                {displayData.displayType || t(`inventory.type.${item.category}`) || item.category}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3 mb-1">
            {item.quantity > 1 && (
              <span className="font-mono text-xs font-medium text-[var(--text-secondary)]">
                x{item.quantity}
              </span>
            )}
            {(() => {
              const displayStats = displayData.displayStats;
              if (displayStats && displayStats.length > 0) {
                return (
                  <div className="flex items-center gap-1">
                    {displayStats.slice(0, 2).map((s) => (
                      <Badge key={s.key} variant="default" size="sm">
                        {s.label}{s.value}
                      </Badge>
                    ))}
                    {displayStats.length > 2 && (
                      <Tooltip
                        multiline
                        content={
                          <div className="flex flex-col gap-0.5">
                            {displayStats.map((s) => (
                              <span key={s.key}>{s.label}{s.value}</span>
                            ))}
                          </div>
                        }
                      >
                        <Badge variant="default" size="sm">+{displayStats.length - 2}</Badge>
                      </Tooltip>
                    )}
                  </div>
                );
              }
              if (item.stats && Object.keys(item.stats).length > 0) {
                return (
                  <div className="flex items-center gap-1">
                    {Object.entries(item.stats).slice(0, 2).map(([key, value]) => (
                      <Badge key={key} variant="default" size="sm">
                        {formatItemStat(key, value ?? 0)}
                      </Badge>
                    ))}
                    {Object.keys(item.stats).length > 2 && (
                      <Tooltip
                        multiline
                        content={
                          <div className="flex flex-col gap-0.5">
                            {Object.entries(item.stats).map(([key, value]) => (
                              <span key={key}>{formatItemStat(key, value ?? 0)}</span>
                            ))}
                          </div>
                        }
                      >
                        <Badge variant="default" size="sm">+{Object.keys(item.stats).length - 2}</Badge>
                      </Tooltip>
                    )}
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {(() => { const desc = displayData.displayDescription || item.description; return desc && (
            <Tooltip content={desc} multiline>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2">
                {desc}
              </p>
            </Tooltip>
          ); })()}
        </div>
      </div>

      {hasActions && (
        <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[var(--border-primary)]">
          {onUse && (
            <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onUse(); }}>{t('inventory.useItem')}</Button>
          )}
          {onEquip && (
            <Button variant={item.equipped ? 'danger' : 'primary'} size="sm" onClick={(e) => { e.stopPropagation(); onEquip(); }}>
              {item.equipped ? t('inventory.unequipItem') : t('inventory.equipItem')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
});

export const InventoryPanel = memo(function InventoryPanel({
  items,
  gold,
  maxSlots = 30,
  onItemUse,
  onItemEquip,
  onItemDrop,
  onItemDetail,
  className,
}: InventoryPanelProps) {
  const { t } = useTranslation('game');
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('rarity');
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);

  const filteredItems = useMemo(() => {
    let result = items;

    if (activeCategory !== 'all') {
      result = result.filter((item) => mapCategory(item) === activeCategory);
    }

    return [...result].sort((a, b) => {
      switch (sortKey) {
        case 'rarity':
          return (RARITY_ORDER[a.quality ?? 'common'] ?? 4) - (RARITY_ORDER[b.quality ?? 'common'] ?? 4);
        case 'name':
          return (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN');
        case 'type':
          return (a.category ?? '').localeCompare(b.category ?? '', 'zh-CN');
        default:
          return 0;
      }
    });
  }, [items, activeCategory, sortKey]);

  const listParentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 88,
    overscan: 5,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 88,
  });

  const handleItemClick = (item: InventoryItem) => {
    if (onItemDetail) {
      onItemDetail(item);
    } else {
      setDetailItem(item);
    }
  };

  const handleDetailClose = () => {
    setDetailItem(null);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center justify-end gap-3">
        {gold !== undefined && (
          <div className="flex items-center gap-1.5">
            <CurrencyDollarIcon className="h-4 w-4" style={{ color: 'var(--gold, #f59e0b)' }} />
            <span className="font-mono text-sm font-semibold" style={{ color: 'var(--gold, #f59e0b)' }}>
              {gold.toLocaleString()}
            </span>
          </div>
        )}
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {items.length}/{maxSlots}
        </span>
      </div>

      <Tabs
        tabs={CATEGORY_KEYS.map((key) => ({ id: key, label: t(`inventory.category.${key}`) }))}
        activeTab={activeCategory}
        onTabChange={(id) => setActiveCategory(id as CategoryKey)}
        variant="pill"
        size="sm"
      />

      <div className="flex items-center gap-2">
        <FunnelIcon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        <Tabs
          tabs={[
            { id: 'rarity', label: t('inventory.sortByRarity') },
            { id: 'name', label: t('inventory.sortByName') },
            { id: 'type', label: t('inventory.sortByType') },
          ]}
          activeTab={sortKey}
          onTabChange={(id) => setSortKey(id as SortKey)}
          variant="pill"
          size="sm"
        />
      </div>

      <div ref={listParentRef} className="overflow-y-auto" style={{ height: '100%' }}>
        {filteredItems.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-[var(--text-muted)]">
            {t('inventory.noMatch')}
          </div>
        )}

        {filteredItems.length > 0 && (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = filteredItems[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div style={{ padding: '4px 0' }}>
                    <InventoryCard
                      item={item}
                      onUse={onItemUse ? () => onItemUse(item.id) : undefined}
                      onEquip={onItemEquip ? () => onItemEquip(item.id) : undefined}
                      onDetail={() => handleItemClick(item)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detailItem && !onItemDetail && (
        <Modal
          open={true}
          onClose={handleDetailClose}
          title={detailItem.name}
          size="md"
          footer={
            <div className="flex gap-2 w-full">
              {onItemUse && (
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={() => {
                    onItemUse(detailItem.id);
                    handleDetailClose();
                  }}
                >
                  {t('inventory.useItem')}
                </Button>
              )}
              {onItemEquip && (
                <Button
                  variant={detailItem.equipped ? 'danger' : 'primary'}
                  size="sm"
                  fullWidth
                  onClick={() => {
                    onItemEquip(detailItem.id);
                    handleDetailClose();
                  }}
                >
                  {detailItem.equipped ? t('inventory.unequipItem') : t('inventory.equipItem')}
                </Button>
              )}
              {onItemDrop && (
                <Button
                  variant="outline"
                  size="sm"
                  fullWidth
                  hoverColor="var(--error, #ef4444)"
                  onClick={() => {
                    onItemDrop(detailItem.id);
                    handleDetailClose();
                  }}
                >
                  {t('inventory.dropItem')}
                </Button>
              )}
            </div>
          }
        >
          {detailItem.equipped && (
            <div className="mb-2">
              <Badge rarity={detailItem.quality ?? 'common'} size="sm">{t('inventory.equipped')}</Badge>
            </div>
          )}
          {detailItem.category && (
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
              {(() => { const dd = resolveItemDisplay(detailItem); return dd.displayType || t(`inventory.type.${detailItem.category}`) || detailItem.category; })()}
            </p>
          )}
          {detailItem.quality && (
            <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: RARITY_COLORS[detailItem.quality] }}>
              {(() => { const dd = resolveItemDisplay(detailItem); return dd.displayRarity || t(`inventory.rarity.${detailItem.quality}`) || detailItem.quality; })()}
            </p>
          )}
          {(() => { const dd = resolveItemDisplay(detailItem); const desc = dd.displayDescription || detailItem.description; return desc && (
            <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
              {desc}
            </p>
          ); })()}
          {detailItem.quantity > 1 && (
            <p className="text-xs text-[var(--text-muted)] mb-2">
              {t('inventory.quantity')}: {detailItem.quantity}
            </p>
          )}
          {(() => {
            const dd = resolveItemDisplay(detailItem);
            const displayStats = dd.displayStats;
            if (displayStats && displayStats.length > 0) {
              return (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {displayStats.map((s) => (
                    <Badge key={s.key} variant="default" size="sm">
                      {s.label}{s.value}
                    </Badge>
                  ))}
                </div>
              );
            }
            if (detailItem.stats && Object.keys(detailItem.stats).length > 0) {
              return (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {Object.entries(detailItem.stats).map(([key, value]) => (
                    <Badge key={key} variant="default" size="sm">
                      {formatItemStat(key, value ?? 0)}
                    </Badge>
                  ))}
                </div>
              );
            }
            return null;
          })()}
          {(() => {
            const dd = resolveItemDisplay(detailItem);
            return dd.displayEffects && dd.displayEffects.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {dd.displayEffects.map((effect, i) => (
                  <Badge key={i} variant="default" size="sm">
                    {effect}
                  </Badge>
                ))}
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
});
