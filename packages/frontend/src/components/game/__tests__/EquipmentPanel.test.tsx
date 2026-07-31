import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EquipmentPanel } from '../EquipmentPanel';
import type { FrontendInventoryItem, EquipmentSlotDefinition } from '@/types';

/**
 * 构造测试用 FrontendInventoryItem，仅覆盖必要字段，其余使用默认值。
 * 默认构造一个已装备在 accessory 槽位 index=0 的饰品。
 */
function makeItem(overrides: Partial<FrontendInventoryItem>): FrontendInventoryItem {
  return {
    id: 'item-1',
    saveId: 'save-1',
    itemId: 'item-id-1',
    poolId: '',
    name: '测试物品',
    description: '',
    category: 'accessory',
    quantity: 1,
    quality: 'common',
    durability: 0,
    maxDurability: 0,
    inventorySlot: 1,
    equippedSlot: 'accessory',
    equippedIndex: 0,
    equipped: true,
    weight: 0,
    maxStack: 1,
    stats: {},
    effects: [],
    value: {},
    tags: [],
    customData: {},
    visible: true,
    ownerType: 'character',
    ownerId: 'char-1',
    ...overrides,
  };
}

describe('EquipmentPanel - 数组化槽位渲染', () => {
  it('空 equippedItems 时不应渲染 StatBlock 计数', () => {
    const markup = renderToStaticMarkup(<EquipmentPanel equippedItems={[]} />);

    expect(markup).not.toContain('已装备');
  });

  it('单槽位装备（main_hand）应渲染装备名并显示 1/8 计数', () => {
    const markup = renderToStaticMarkup(
      <EquipmentPanel
        equippedItems={[
          makeItem({
            id: 'weapon-1',
            name: '铁剑',
            category: 'weapon',
            equippedSlot: 'main_hand',
            equippedIndex: null,
          }),
        ]}
      />,
    );

    expect(markup).toContain('铁剑');
    expect(markup).toContain('1/8');
  });

  it('accessory 单饰品应渲染饰品并显示 1/8 计数', () => {
    const markup = renderToStaticMarkup(
      <EquipmentPanel
        equippedItems={[
          makeItem({
            id: 'accessory-1',
            name: '力量戒指',
            equippedSlot: 'accessory',
            equippedIndex: 0,
          }),
        ]}
      />,
    );

    expect(markup).toContain('力量戒指');
    expect(markup).toContain('1/8');
  });

  it('accessory 双饰品应同时渲染两个饰品并显示 2/8 计数', () => {
    const markup = renderToStaticMarkup(
      <EquipmentPanel
        equippedItems={[
          makeItem({
            id: 'accessory-1',
            name: '力量戒指',
            equippedSlot: 'accessory',
            equippedIndex: 0,
          }),
          makeItem({
            id: 'accessory-2',
            name: '智慧项链',
            equippedSlot: 'accessory',
            equippedIndex: 1,
          }),
        ]}
      />,
    );

    // 核心断言：两个饰品都应渲染（修复前 BUG：只渲染第一个）
    expect(markup).toContain('力量戒指');
    expect(markup).toContain('智慧项链');
    expect(markup).toContain('2/8');
  });

  it('accessory 双饰品乱序时应按 equippedIndex 升序渲染', () => {
    // 传入顺序：index=1 在前，index=0 在后；渲染时应按 index 升序排列
    const markup = renderToStaticMarkup(
      <EquipmentPanel
        equippedItems={[
          makeItem({
            id: 'accessory-old',
            name: '旧饰品',
            equippedSlot: 'accessory',
            equippedIndex: 1,
          }),
          makeItem({
            id: 'accessory-new',
            name: '新饰品',
            equippedSlot: 'accessory',
            equippedIndex: 0,
          }),
        ]}
      />,
    );

    expect(markup).toContain('旧饰品');
    expect(markup).toContain('新饰品');

    // 验证顺序：新饰品（index=0）应在旧饰品（index=1）之前
    const newIdx = markup.indexOf('新饰品');
    const oldIdx = markup.indexOf('旧饰品');
    expect(newIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('未装备的物品不应渲染在槽位中但仍计入 equippedItems.length 触发 StatBlock', () => {
    const markup = renderToStaticMarkup(
      <EquipmentPanel
        equippedItems={[
          makeItem({
            id: 'accessory-1',
            name: '已装备饰品',
            equippedSlot: 'accessory',
            equippedIndex: 0,
            equipped: true,
          }),
          makeItem({
            id: 'accessory-2',
            name: '未装备饰品',
            equippedSlot: null,
            equippedIndex: null,
            equipped: false,
          }),
        ]}
      />,
    );

    expect(markup).toContain('已装备饰品');
    expect(markup).not.toContain('未装备饰品');
    // equippedCount 仅统计 equipped=true，所以是 1/8
    expect(markup).toContain('1/8');
  });

  it('混合槽位装备应正确统计计数', () => {
    const markup = renderToStaticMarkup(
      <EquipmentPanel
        equippedItems={[
          makeItem({
            id: 'weapon-1',
            name: '铁剑',
            category: 'weapon',
            equippedSlot: 'main_hand',
            equippedIndex: null,
          }),
          makeItem({
            id: 'armor-1',
            name: '皮甲',
            category: 'armor',
            equippedSlot: 'body',
            equippedIndex: null,
          }),
          makeItem({
            id: 'accessory-1',
            name: '力量戒指',
            equippedSlot: 'accessory',
            equippedIndex: 0,
          }),
          makeItem({
            id: 'accessory-2',
            name: '智慧项链',
            equippedSlot: 'accessory',
            equippedIndex: 1,
          }),
        ]}
      />,
    );

    expect(markup).toContain('铁剑');
    expect(markup).toContain('皮甲');
    expect(markup).toContain('力量戒指');
    expect(markup).toContain('智慧项链');
    // 4 件装备全部已装备，计数为 4/8
    expect(markup).toContain('4/8');
  });

  it('自定义 equipmentSlotDefs 应使用自定义槽位定义而非默认', () => {
    const customSlots: EquipmentSlotDefinition[] = [
      { id: 'ring', name: '戒指槽', icon: '💍', accepted_item_types: ['accessory'], capacity: 3 },
    ];

    const markup = renderToStaticMarkup(
      <EquipmentPanel
        equippedItems={[
          makeItem({
            id: 'ring-1',
            name: '红宝石戒指',
            equippedSlot: 'ring' as FrontendInventoryItem['equippedSlot'],
            equippedIndex: 0,
          }),
        ]}
        equipmentSlotDefs={customSlots}
      />,
    );

    expect(markup).toContain('红宝石戒指');
    // 自定义槽位总容量 = 3，已装备 1，计数为 1/3
    expect(markup).toContain('1/3');
    // capacity=3，1 个有装备 + 2 个空位
    const emptyOccurrences = (markup.match(/空/g) ?? []).length;
    expect(emptyOccurrences).toBe(2);
  });
});
