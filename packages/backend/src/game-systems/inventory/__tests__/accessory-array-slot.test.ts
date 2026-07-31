import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';
import type { InventoryItem } from '../types.js';

/**
 * 饰品槽数组化改造测试 — 覆盖三类输入（正确/错误/部分正确）
 *
 * 测试目标（实现效果）：
 * 1. 数组化槽位（accessory capacity=2）有空位时自动装入空位（追加到末尾）
 * 2. 数组化槽位无空位时堆栈替换（撤下 index 最大的，新装备 index=0，其余 +1）
 * 3. 卸下数组化槽位装备后索引前移填补空位（保持数组紧凑）
 * 4. 旧别名 accessory1/accessory2/ring1/ring2/amulet/necklace 自动映射到 accessory
 * 5. 单槽位行为不受影响（保持原有替换逻辑）
 */

function createRuleParserStub() {
  return {
    getInventoryRules: () => ({
      max_slots: 20,
      stack_sizes: {},
      equipment_slots: [
        { id: 'main_hand', accepted_item_types: ['weapon'] },
        { id: 'off_hand', accepted_item_types: ['weapon', 'accessory'] },
        { id: 'head', accepted_item_types: ['armor'] },
        { id: 'body', accepted_item_types: ['armor'] },
        { id: 'hands', accepted_item_types: ['armor'] },
        { id: 'feet', accepted_item_types: ['armor'] },
        { id: 'accessory', accepted_item_types: ['accessory'], capacity: 2 },
      ],
    }),
  } as any;
}

function makeAccessoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item_ring_1',
    saveId: 'save-a',
    itemId: 'ring-1',
    poolId: '',
    name: '戒指A',
    description: '',
    category: 'accessory',
    quantity: 1,
    quality: 'common',
    durability: 100,
    maxDurability: 100,
    inventorySlot: 1,
    equippedSlot: null,
    equipped: false,
    equippedIndex: null,
    weight: 1,
    maxStack: 1,
    stats: {},
    effects: [],
    value: {},
    tags: [],
    customData: {},
    ownerType: 'character',
    ownerId: 'char-1',
    visible: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as InventoryItem;
}

function makeWeaponItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    ...makeAccessoryItem(),
    id: 'item_sword_1',
    itemId: 'sword-1',
    name: '铁剑',
    category: 'weapon',
    ...overrides,
  } as InventoryItem;
}

function createService(repoMock: any, numericalMock?: any) {
  const characterServiceMock = {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char-1' }),
  };
  return new InventoryService(
    repoMock as any,
    {} as any,
    characterServiceMock as any,
    numericalMock ?? { recalculateDerivedAttributes: vi.fn().mockResolvedValue(null), recalculateNpcAttributes: vi.fn().mockResolvedValue(null) } as any,
    {} as any,
    { transaction: vi.fn((fn: any) => fn({})) } as any,
    createRuleParserStub(),
    null,
  );
}

describe('饰品槽数组化 - equipItem', () => {
  describe('正确输入', () => {
    it('数组化槽位有空位时应追加到末尾（index=0 为首件）', async () => {
      const item = makeAccessoryItem();
      const updateMock = vi.fn().mockResolvedValue(null);
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
        findEquippedBySlot: vi.fn().mockResolvedValue(null),
        findByEquippedSlotOrdered: vi.fn().mockResolvedValue([]), // 空数组 → 有空位
        update: updateMock,
        updateEquippedIndexBatch: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_1', 'accessory' as any);

      expect(result.success).toBe(true);
      expect(result.newSlot).toBe('accessory');
      expect(result.assignedIndex).toBe(0); // 空数组首件 index=0
      expect(result.replacedItems).toBeUndefined();
      expect(updateMock).toHaveBeenCalledWith(
        'item_ring_1',
        expect.objectContaining({
          equipped: true,
          equippedSlot: 'accessory',
          equippedIndex: 0,
        }),
        expect.anything(),
      );
    });

    it('数组化槽位有1件时应追加到 index=1', async () => {
      const item = makeAccessoryItem({ id: 'item_ring_2' });
      const existing = makeAccessoryItem({
        id: 'item_ring_1',
        equipped: true,
        equippedSlot: 'accessory',
        equippedIndex: 0,
      });
      const updateMock = vi.fn().mockResolvedValue(null);
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
        findEquippedBySlot: vi.fn().mockResolvedValue(null),
        findByEquippedSlotOrdered: vi.fn().mockResolvedValue([existing]),
        update: updateMock,
        updateEquippedIndexBatch: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_2', 'accessory' as any);

      expect(result.success).toBe(true);
      expect(result.assignedIndex).toBe(1); // 追加到末尾
      expect(result.replacedItems).toBeUndefined();
    });

    it('数组化槽位满时应堆栈替换：撤下 index 最大的，新装备 index=0', async () => {
      const item = makeAccessoryItem({ id: 'item_ring_3' });
      const existing1 = makeAccessoryItem({
        id: 'item_ring_1',
        equipped: true,
        equippedSlot: 'accessory',
        equippedIndex: 0,
      });
      const existing2 = makeAccessoryItem({
        id: 'item_ring_2',
        equipped: true,
        equippedSlot: 'accessory',
        equippedIndex: 1,
      });
      const updateMock = vi.fn().mockResolvedValue(null);
      const batchUpdateMock = vi.fn().mockResolvedValue(null);
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
        findEquippedBySlot: vi.fn().mockResolvedValue(null),
        findByEquippedSlotOrdered: vi.fn().mockResolvedValue([existing1, existing2]),
        update: updateMock,
        updateEquippedIndexBatch: batchUpdateMock,
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_3', 'accessory' as any);

      expect(result.success).toBe(true);
      expect(result.assignedIndex).toBe(0); // 新装备 index=0
      expect(result.replacedItems).toHaveLength(1);
      expect(result.replacedItems![0]).toEqual({ inventoryId: 'item_ring_2', previousIndex: 1 });

      // 撤下最旧装备（index=1 的）
      expect(updateMock).toHaveBeenCalledWith(
        'item_ring_2',
        expect.objectContaining({
          equipped: false,
          equippedSlot: null,
          equippedIndex: null,
        }),
        expect.anything(),
      );
      // 其余装备（index < 1 的，即 index=0 的）+1
      expect(batchUpdateMock).toHaveBeenCalledWith(
        'save-a', 'accessory', 1, { maxIndex: 0 },
        'character', 'char-1', expect.anything(),
      );
      // 新装备 index=0
      expect(updateMock).toHaveBeenCalledWith(
        'item_ring_3',
        expect.objectContaining({
          equipped: true,
          equippedSlot: 'accessory',
          equippedIndex: 0,
        }),
        expect.anything(),
      );
    });

    it('单槽位应保持原有替换逻辑（equippedIndex=null）', async () => {
      const item = makeWeaponItem({ id: 'item_sword_new' });
      const existing = makeWeaponItem({
        id: 'item_sword_old',
        equipped: true,
        equippedSlot: 'main_hand',
        equippedIndex: null,
      });
      const updateMock = vi.fn().mockResolvedValue(null);
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
        findEquippedBySlot: vi.fn().mockResolvedValue(existing),
        findByEquippedSlotOrdered: vi.fn().mockResolvedValue([]),
        update: updateMock,
        updateEquippedIndexBatch: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_sword_new', 'main_hand' as any);

      expect(result.success).toBe(true);
      expect(result.assignedIndex).toBeUndefined(); // 单槽位无 assignedIndex
      expect(result.replacedItems).toBeUndefined();
      expect(result.previousSlot).toBe('main_hand');
      expect(updateMock).toHaveBeenCalledWith(
        'item_sword_new',
        expect.objectContaining({
          equipped: true,
          equippedSlot: 'main_hand',
          equippedIndex: null,
        }),
        expect.anything(),
      );
    });
  });

  describe('部分正确输入（别名映射 + 自动选择）', () => {
    it('旧别名 accessory1 应映射到 accessory 并走数组化逻辑', async () => {
      const item = makeAccessoryItem();
      const updateMock = vi.fn().mockResolvedValue(null);
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
        findEquippedBySlot: vi.fn().mockResolvedValue(null),
        findByEquippedSlotOrdered: vi.fn().mockResolvedValue([]),
        update: updateMock,
        updateEquippedIndexBatch: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_1', 'accessory1' as any);

      expect(result.success).toBe(true);
      expect(result.newSlot).toBe('accessory');
      expect(result.requestedSlot).toBe('accessory1'); // 别名映射提示
      expect(result.assignedIndex).toBe(0);
    });

    it('旧别名 ring1 应映射到 accessory', async () => {
      const item = makeAccessoryItem();
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
        findEquippedBySlot: vi.fn().mockResolvedValue(null),
        findByEquippedSlotOrdered: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(null),
        updateEquippedIndexBatch: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_1', 'ring1' as any);

      expect(result.success).toBe(true);
      expect(result.newSlot).toBe('accessory');
      expect(result.requestedSlot).toBe('ring1');
    });

    it('不传 targetSlot 且 category=accessory 时应自动选择 accessory 槽位', async () => {
      const item = makeAccessoryItem();
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
        findEquippedBySlot: vi.fn().mockResolvedValue(null),
        findByEquippedSlotOrdered: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue(null),
        updateEquippedIndexBatch: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_1');

      expect(result.success).toBe(true);
      expect(result.newSlot).toBe('accessory');
      expect(result.assignedIndex).toBe(0);
    });

    it('已装备物品应返回 alreadyEquipped=true', async () => {
      const item = makeAccessoryItem({
        equipped: true,
        equippedSlot: 'accessory',
        equippedIndex: 0,
      });
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_1', 'accessory' as any);

      expect(result.success).toBe(true);
      expect(result.alreadyEquipped).toBe(true);
    });
  });

  describe('错误输入', () => {
    it('无效的槽位应返回失败', async () => {
      const item = makeAccessoryItem();
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      const result = await service.equipItem('save-a' as any, 'item_ring_1', 'invalid_slot' as any);

      expect(result.success).toBe(false);
      // resolveSlotAlias 对未知槽位返回 null → 进入 "No valid equipment slot for category" 分支
      expect(result.message).toContain('No valid equipment slot');
    });

    it('物品类型与槽位不匹配应返回失败', async () => {
      const item = makeAccessoryItem(); // category=accessory
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
      };

      const service = createService(repoMock);
      // accessory 类型物品不能装到 head 槽（head 只接受 armor）
      const result = await service.equipItem('save-a' as any, 'item_ring_1', 'head' as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not accept category');
    });
  });
});

describe('饰品槽数组化 - unequipItem', () => {
  describe('正确输入', () => {
    it('卸下数组化槽位装备后应索引前移填补空位', async () => {
      const item = makeAccessoryItem({
        id: 'item_ring_1',
        equipped: true,
        equippedSlot: 'accessory',
        equippedIndex: 0,
      });
      const updateMock = vi.fn().mockResolvedValue(null);
      const batchUpdateMock = vi.fn().mockResolvedValue(null);
      const repoMock = {
        // unequipItem 共 3 次 findById：validateOwnership + 主查找 + 末尾获取更新后对象
        findById: vi.fn()
          .mockResolvedValueOnce(item) // validateOwnership 校验
          .mockResolvedValueOnce(item) // 主查找
          .mockResolvedValueOnce({ ...item, equipped: false, equippedSlot: null, equippedIndex: null }), // 末尾获取
        update: updateMock,
        updateEquippedIndexBatch: batchUpdateMock,
      };

      const service = createService(repoMock);
      await service.unequipItem('save-a' as any, 'item_ring_1');

      // 应清空 equippedIndex
      expect(updateMock).toHaveBeenCalledWith(
        'item_ring_1',
        expect.objectContaining({
          equipped: false,
          equippedSlot: null,
          equippedIndex: null,
        }),
        expect.anything(),
      );
      // 应前移后续装备索引（index > 0 的 -1）
      expect(batchUpdateMock).toHaveBeenCalledWith(
        'save-a', 'accessory', -1, { minIndex: 1 },
        'character', 'char-1', expect.anything(),
      );
    });

    it('卸下单槽位装备不应触发索引前移', async () => {
      const item = makeWeaponItem({
        id: 'item_sword_1',
        equipped: true,
        equippedSlot: 'main_hand',
        equippedIndex: null,
      });
      const batchUpdateMock = vi.fn().mockResolvedValue(null);
      const repoMock = {
        // unequipItem 共 3 次 findById：validateOwnership + 主查找 + 末尾获取
        findById: vi.fn()
          .mockResolvedValueOnce(item) // validateOwnership 校验
          .mockResolvedValueOnce(item) // 主查找
          .mockResolvedValueOnce({ ...item, equipped: false, equippedSlot: null, equippedIndex: null }), // 末尾获取
        update: vi.fn().mockResolvedValue(null),
        updateEquippedIndexBatch: batchUpdateMock,
      };

      const service = createService(repoMock);
      await service.unequipItem('save-a' as any, 'item_sword_1');

      // 单槽位不应触发批量索引更新
      expect(batchUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe('错误输入', () => {
    it('卸下未装备的物品应抛错', async () => {
      const item = makeAccessoryItem({ equipped: false });
      const repoMock = {
        findById: vi.fn().mockResolvedValue(item),
        update: vi.fn(),
      };

      const service = createService(repoMock);
      await expect(service.unequipItem('save-a' as any, 'item_ring_1'))
        .rejects.toThrow('Item is not equipped');
    });
  });
});

describe('饰品槽数组化 - getEquipment', () => {
  it('数组化槽位应返回多个物品，按 equippedIndex 升序', async () => {
    const ring1 = makeAccessoryItem({
      id: 'item_ring_1',
      equipped: true,
      equippedSlot: 'accessory',
      equippedIndex: 0,
      updatedAt: 10,
    });
    const ring2 = makeAccessoryItem({
      id: 'item_ring_2',
      equipped: true,
      equippedSlot: 'accessory',
      equippedIndex: 1,
      updatedAt: 20,
    });
    const sword = makeWeaponItem({
      id: 'item_sword_1',
      equipped: true,
      equippedSlot: 'main_hand',
      equippedIndex: null,
      updatedAt: 5,
    });

    const repoMock = {
      findEquippedBySaveIdAndOwner: vi.fn().mockResolvedValue([sword, ring2, ring1]), // 乱序传入
      update: vi.fn(),
    };

    const service = createService(repoMock);
    const result = await service.getEquipment('save-a' as any, 'character', 'char-1');

    // 应按槽位 + equippedIndex 排序：main_hand 在前，accessory 按 index 升序
    const accessoryItems = result.equipment.filter(i => i.equippedSlot === 'accessory');
    expect(accessoryItems).toHaveLength(2);
    expect(accessoryItems[0].id).toBe('item_ring_1'); // index=0
    expect(accessoryItems[1].id).toBe('item_ring_2'); // index=1
  });
});
