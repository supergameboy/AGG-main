import { useState, useCallback } from 'react';
import { useTemplateStore } from '@/stores/templateStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { generateId } from '@/types';
import type { ItemDefinition, ItemEffect, ItemValue } from '@/types';

const ITEM_CATEGORY_OPTIONS = [
  { value: 'weapon', label: '武器' },
  { value: 'armor', label: '护甲' },
  { value: 'consumable', label: '消耗品' },
  { value: 'accessory', label: '饰品' },
  { value: 'tool', label: '工具' },
  { value: 'quest_item', label: '任务物品' },
  { value: 'misc', label: '杂项' },
];

const ITEM_QUALITY_OPTIONS = [
  { value: 'common', label: '普通' },
  { value: 'uncommon', label: '优秀' },
  { value: 'rare', label: '稀有' },
  { value: 'epic', label: '史诗' },
  { value: 'legendary', label: '传说' },
];

const selectClass =
  'h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

const tagInputClass =
  'h-8 w-24 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none';

const QUALITY_COLORS: Record<string, string> = {
  common: 'text-[var(--text-muted)]',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  epic: 'text-purple-400',
  legendary: 'text-orange-400',
};

function createDefaultItem(): ItemDefinition {
  return {
    id: generateId('item'),
    name: '',
    description: '',
    category: 'misc',
    quality: 'common',
    stats: {},
    effects: [],
    value: { buy: 0, sell: 0, currency: 'gold' },
    quantity: 1,
    custom_data: {},
  };
}

export function ItemsEditor() {
  const editingTemplate = useTemplateStore((s) => s.editingTemplate);
  const updateNestedField = useTemplateStore((s) => s.updateNestedField);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const items: ItemDefinition[] = editingTemplate?.items ?? [];

  const updateItems = useCallback(
    (newItems: ItemDefinition[]) => {
      updateNestedField('items', newItems);
    },
    [updateNestedField],
  );

  const handleAdd = useCallback(() => {
    const item = createDefaultItem();
    updateItems([...items, item]);
    setExpandedIdx(items.length);
  }, [items, updateItems]);

  const updateItem = useCallback(
    (index: number, updates: Partial<ItemDefinition>) => {
      const newItems = items.map((item, i) => (i === index ? { ...item, ...updates } : item));
      updateItems(newItems);
    },
    [items, updateItems],
  );

  const updateItemValue = useCallback(
    (index: number, updates: Partial<ItemValue>) => {
      const item = items[index];
      if (!item) return;
      updateItem(index, { value: { ...item.value, ...updates } });
    },
    [items, updateItem],
  );

  const handleAddEffect = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      const newEffect: ItemEffect = { type: '', value: 0 };
      updateItem(index, { effects: [...item.effects, newEffect] });
    },
    [items, updateItem],
  );

  const updateEffect = useCallback(
    (itemIndex: number, effectIndex: number, updates: Partial<ItemEffect>) => {
      const item = items[itemIndex];
      if (!item) return;
      const effects = item.effects.map((e, i) => (i === effectIndex ? { ...e, ...updates } : e));
      updateItem(itemIndex, { effects });
    },
    [items, updateItem],
  );

  const removeEffect = useCallback(
    (itemIndex: number, effectIndex: number) => {
      const item = items[itemIndex];
      if (!item) return;
      updateItem(itemIndex, { effects: item.effects.filter((_, i) => i !== effectIndex) });
    },
    [items, updateItem],
  );

  if (!editingTemplate) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">物品定义</h3>
        <Button size="sm" onClick={handleAdd}>
          添加物品
        </Button>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        定义模板中可用的物品。物品将在游戏中供角色获取和使用。
      </p>

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">暂无物品，点击"添加物品"开始定义</p>
        </div>
      )}

      {items.map((item, index) => {
        const isExpanded = expandedIdx === index;
        return (
          <div
            key={item.id}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] overflow-hidden"
          >
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : index)}
              className="flex w-full items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${QUALITY_COLORS[item.quality] ?? 'text-[var(--text-primary)]'}`}>
                  {item.name || `物品 #${index + 1}`}
                </span>
                {item.category && (
                  <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]">
                    {ITEM_CATEGORY_OPTIONS.find((o) => o.value === item.category)?.label ?? item.category}
                  </span>
                )}
                {item.quality && (
                  <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                    {ITEM_QUALITY_OPTIONS.find((o) => o.value === item.quality)?.label ?? item.quality}
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--text-muted)]">{isExpanded ? '收起' : '展开'}</span>
            </button>

            {isExpanded && (
              <div className="border-t border-[var(--border-primary)] p-4 space-y-3">
                <div className="flex justify-end">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      updateItems(items.filter((_, i) => i !== index));
                      setExpandedIdx(null);
                    }}
                  >
                    删除
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="名称"
                    value={item.name}
                    onChange={(e) => updateItem(index, { name: e.target.value })}
                    placeholder="物品名称"
                  />
                  <Input
                    label="图标"
                    value={item.icon ?? ''}
                    onChange={(e) => updateItem(index, { icon: e.target.value })}
                    placeholder="图标标识"
                  />
                </div>

                <Input
                  label="描述"
                  value={item.description}
                  onChange={(e) => updateItem(index, { description: e.target.value })}
                  placeholder="物品描述"
                />

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">类型</label>
                    <select
                      value={item.category}
                      onChange={(e) => updateItem(index, { category: e.target.value })}
                      className={selectClass}
                    >
                      {ITEM_CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Input
                    label="子类型"
                    value={item.subtype ?? ''}
                    onChange={(e) => updateItem(index, { subtype: e.target.value })}
                    placeholder="如 长剑、轻甲"
                  />
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">稀有度</label>
                    <select
                      value={item.quality}
                      onChange={(e) => updateItem(index, { quality: e.target.value })}
                      className={selectClass}
                    >
                      {ITEM_QUALITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">可堆叠</label>
                    <label className="flex h-10 items-center gap-2 text-sm text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={item.stackable ?? false}
                        onChange={(e) => updateItem(index, { stackable: e.target.checked })}
                        className="h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--accent)] focus:ring-[var(--accent)]"
                      />
                      启用
                    </label>
                  </div>
                  {(item.stackable) && (
                    <Input
                      label="最大堆叠数"
                      type="number"
                      min={1}
                      value={item.max_stack ?? 99}
                      onChange={(e) => updateItem(index, { max_stack: Number(e.target.value) || 99 })}
                    />
                  )}
                </div>

                <div className="flex flex-col">
                  <label className="mb-1.5 text-sm font-medium text-[var(--text-secondary)]">属性加成</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Object.entries(item.stats).map(([key, val]) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-xs text-[var(--text-primary)]"
                      >
                        {key}: {val}
                        <button
                          type="button"
                          onClick={() => {
                            const newStats = { ...item.stats };
                            delete newStats[key];
                            updateItem(index, { stats: newStats });
                          }}
                          className="text-[var(--text-muted)] hover:text-[var(--error)]"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input className={tagInputClass} placeholder="属性名" id={`item-stat-key-${index}`} />
                    <input className={tagInputClass} placeholder="数值" type="number" id={`item-stat-val-${index}`} />
                    <button
                      type="button"
                      onClick={() => {
                        const keyEl = document.getElementById(`item-stat-key-${index}`) as HTMLInputElement;
                        const valEl = document.getElementById(`item-stat-val-${index}`) as HTMLInputElement;
                        if (keyEl?.value.trim()) {
                          updateItem(index, { stats: { ...item.stats, [keyEl.value.trim()]: Number(valEl?.value) || 0 } });
                          keyEl.value = '';
                          valEl.value = '';
                        }
                      }}
                      className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white hover:bg-[var(--accent-hover)]"
                    >
                      添加
                    </button>
                  </div>
                </div>

                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-[var(--text-secondary)]">效果</label>
                    <Button size="sm" variant="outline" onClick={() => handleAddEffect(index)}>
                      添加效果
                    </Button>
                  </div>
                  {item.effects.length === 0 && (
                    <p className="text-xs text-[var(--text-muted)]">暂无效果</p>
                  )}
                  {item.effects.map((eff, effIdx) => (
                    <div
                      key={effIdx}
                      className="flex items-center gap-2 rounded bg-[var(--bg-secondary)] px-2 py-1.5 mb-1.5"
                    >
                      <input
                        className={tagInputClass}
                        placeholder="效果类型"
                        value={eff.type}
                        onChange={(e) => updateEffect(index, effIdx, { type: e.target.value })}
                      />
                      <input
                        className={tagInputClass}
                        placeholder="数值"
                        type="number"
                        value={eff.value}
                        onChange={(e) => updateEffect(index, effIdx, { value: Number(e.target.value) || 0 })}
                      />
                      <input
                        className={tagInputClass}
                        placeholder="持续回合"
                        type="number"
                        min={0}
                        value={eff.duration ?? 0}
                        onChange={(e) => updateEffect(index, effIdx, { duration: Number(e.target.value) || 0 })}
                      />
                      <button
                        type="button"
                        onClick={() => removeEffect(index, effIdx)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--error)]"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>

                <h4 className="text-sm font-medium text-[var(--text-secondary)] pt-2">价值</h4>
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    label="买入价"
                    type="number"
                    min={0}
                    value={item.value.buy}
                    onChange={(e) => updateItemValue(index, { buy: Number(e.target.value) || 0 })}
                  />
                  <Input
                    label="卖出价"
                    type="number"
                    min={0}
                    value={item.value.sell}
                    onChange={(e) => updateItemValue(index, { sell: Number(e.target.value) || 0 })}
                  />
                  <Input
                    label="货币"
                    value={item.value.currency}
                    onChange={(e) => updateItemValue(index, { currency: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
