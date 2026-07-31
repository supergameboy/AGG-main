import { describe, expect, it } from 'vitest';
import { applyPanelUpdates, type MergeableState } from '../panelUpdateMerger';

function createState(): MergeableState {
  return {
    player: null,
    inventory: [],
    quests: [],
    skills: [],
    npcInfoList: [],
  };
}

const VALID_ITEM_ID = 'item_测试剑_1779785527271_0';

describe('panelUpdateMerger — inventory 映射与初始化映射统一', () => {
  it('mapInventoryItemDataToNew: stats/effects/value/tags/customData 为 JSON 字符串时应正确解析', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: VALID_ITEM_ID,
            itemId: 'test-sword',
            name: '测试剑',
            description: '一把测试用剑',
            quantity: 1,
            stats: '{"atk": 10, "def": 5}',
            effects: '[{"type": "burn", "value": 3}]',
            value: '{"buy": 100, "sell": 50}',
            tags: '["rare", "weapon"]',
            customData: '{"enchant": "fire"}',
            ownerType: 'character',
          },
        ],
      },
    } as any);

    const item = state.inventory[0];
    expect(item).toBeDefined();

    // JSON 字符串应被解析为对象/数组
    expect(item.stats).toEqual({ atk: 10, def: 5 });
    expect(item.effects).toEqual([{ type: 'burn', value: 3 }]);
    expect(item.value).toEqual({ buy: 100, sell: 50 });
    expect(item.tags).toEqual(['rare', 'weapon']);
    expect(item.customData).toEqual({ enchant: 'fire' });
  });

  it('mapInventoryItemDataToNew: stats/effects/value/tags/customData 为对象/数组时应直接使用', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: VALID_ITEM_ID,
            itemId: 'test-sword',
            name: '测试剑',
            description: '一把测试用剑',
            quantity: 1,
            stats: { atk: 10 },
            effects: [{ type: 'burn', value: 3 }],
            value: { buy: 100 },
            tags: ['rare'],
            customData: { enchant: 'fire' },
            ownerType: 'character',
          },
        ],
      },
    } as any);

    const item = state.inventory[0];
    expect(item.stats).toEqual({ atk: 10 });
    expect(item.effects).toEqual([{ type: 'burn', value: 3 }]);
    expect(item.value).toEqual({ buy: 100 });
    expect(item.tags).toEqual(['rare']);
    expect(item.customData).toEqual({ enchant: 'fire' });
  });

  it('mapInventoryItemDataToNew: stats/effects/value/tags/customData 为 null/undefined 时应使用默认值', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: VALID_ITEM_ID,
            itemId: 'test-sword',
            name: '测试剑',
            description: '一把测试用剑',
            quantity: 1,
            // stats/effects/value/tags/customData 全部缺失
            ownerType: 'character',
          },
        ],
      },
    } as any);

    const item = state.inventory[0];
    expect(item.stats).toEqual({});
    expect(item.effects).toEqual([]);
    expect(item.value).toEqual({});
    expect(item.tags).toEqual([]);
    expect(item.customData).toEqual({});
  });

  it('mapInventoryItemDataToNew: visible 应从 data.visible 读取而非硬编码 true', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: VALID_ITEM_ID,
            itemId: 'test-sword',
            name: '隐藏物品',
            description: '不可见',
            quantity: 1,
            visible: false,
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory[0].visible).toBe(false);
  });

  it('mapInventoryItemDataToNew: visible 未提供时默认为 true', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: VALID_ITEM_ID,
            itemId: 'test-sword',
            name: '普通物品',
            description: '可见',
            quantity: 1,
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory[0].visible).toBe(true);
  });

  it('mapInventoryItemDataToExisting: stats/effects/value/tags/customData 为 JSON 字符串时应正确解析', () => {
    const state = createState();
    state.inventory = [
      {
        id: VALID_ITEM_ID,
        saveId: 'save-1',
        itemId: 'test-sword',
        poolId: '',
        name: '测试剑',
        description: '一把测试用剑',
        category: 'weapon',
        quantity: 1,
        quality: 'common',
        durability: 0,
        maxDurability: 0,
        inventorySlot: null,
        equippedSlot: null,
        equipped: false,
        weight: 0,
        maxStack: 1,
        stats: {},
        effects: [],
        value: {},
        tags: [],
        customData: {},
        visible: true,
        ownerType: 'character',
        ownerId: '',
      } as any,
    ];

    applyPanelUpdates(state, {
      inventory: {
        updated: [
          {
            id: VALID_ITEM_ID,
            stats: '{"atk": 20}',
            effects: '[{"type": "ice", "value": 5}]',
            value: '{"buy": 200}',
            tags: '["legendary"]',
            customData: '{"refined": true}',
            ownerType: 'character',
          },
        ],
      },
    } as any);

    const item = state.inventory[0];
    expect(item.stats).toEqual({ atk: 20 });
    expect(item.effects).toEqual([{ type: 'ice', value: 5 }]);
    expect(item.value).toEqual({ buy: 200 });
    expect(item.tags).toEqual(['legendary']);
    expect(item.customData).toEqual({ refined: true });
  });

  it('mapInventoryItemDataToExisting: saveId 应被更新', () => {
    const state = createState();
    state.inventory = [
      {
        id: VALID_ITEM_ID,
        saveId: '',
        itemId: 'test-sword',
        poolId: '',
        name: '测试剑',
        description: '',
        category: 'weapon',
        quantity: 1,
        quality: 'common',
        durability: 0,
        maxDurability: 0,
        inventorySlot: null,
        equippedSlot: null,
        equipped: false,
        weight: 0,
        maxStack: 1,
        stats: {},
        effects: [],
        value: {},
        tags: [],
        customData: {},
        visible: true,
        ownerType: 'character',
        ownerId: '',
      } as any,
    ];

    applyPanelUpdates(state, {
      inventory: {
        updated: [
          {
            id: VALID_ITEM_ID,
            saveId: 'save-hero-123',
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory[0].saveId).toBe('save-hero-123');
  });

  it('mapInventoryItemDataToExisting: visible 应被更新', () => {
    const state = createState();
    state.inventory = [
      {
        id: VALID_ITEM_ID,
        saveId: 'save-1',
        itemId: 'test-sword',
        poolId: '',
        name: '测试剑',
        description: '',
        category: 'weapon',
        quantity: 1,
        quality: 'common',
        durability: 0,
        maxDurability: 0,
        inventorySlot: null,
        equippedSlot: null,
        equipped: false,
        weight: 0,
        maxStack: 1,
        stats: {},
        effects: [],
        value: {},
        tags: [],
        customData: {},
        visible: true,
        ownerType: 'character',
        ownerId: '',
      } as any,
    ];

    applyPanelUpdates(state, {
      inventory: {
        updated: [
          {
            id: VALID_ITEM_ID,
            visible: false,
            ownerType: 'character',
          },
        ],
      },
    } as any);

    expect(state.inventory[0].visible).toBe(false);
  });

  it('replace 路径: JSON 字符串字段应正确解析', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        replace: true,
        added: [
          {
            id: VALID_ITEM_ID,
            itemId: 'test-sword',
            name: '测试剑',
            description: '一把测试用剑',
            quantity: 1,
            stats: '{"atk": 15}',
            effects: '[{"type": "heal", "value": 10}]',
            value: '{"buy": 300, "sell": 150}',
            tags: '["epic", "sword"]',
            customData: '{"set": "dragon"}',
            visible: false,
            ownerType: 'character',
          },
        ],
      },
    } as any);

    const item = state.inventory[0];
    expect(item.stats).toEqual({ atk: 15 });
    expect(item.effects).toEqual([{ type: 'heal', value: 10 }]);
    expect(item.value).toEqual({ buy: 300, sell: 150 });
    expect(item.tags).toEqual(['epic', 'sword']);
    expect(item.customData).toEqual({ set: 'dragon' });
    expect(item.visible).toBe(false);
  });

  it('JSON 字符串解析失败时应使用默认值', () => {
    const state = createState();

    applyPanelUpdates(state, {
      inventory: {
        added: [
          {
            id: VALID_ITEM_ID,
            itemId: 'test-sword',
            name: '测试剑',
            description: '一把测试用剑',
            quantity: 1,
            stats: '{invalid json}',
            effects: 'not-json',
            value: 'broken',
            tags: '[invalid',
            customData: undefined,
            ownerType: 'character',
          },
        ],
      },
    } as any);

    const item = state.inventory[0];
    expect(item.stats).toEqual({});
    expect(item.effects).toEqual([]);
    expect(item.value).toEqual({});
    expect(item.tags).toEqual([]);
    expect(item.customData).toEqual({});
  });
});
