import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';

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
        { id: 'accessory1', accepted_item_types: ['accessory'] },
        { id: 'accessory2', accepted_item_types: ['accessory'] },
      ],
    }),
  } as any;
}

describe('InventoryService', () => {
  it('getEquipment 应对同槽位重复装备执行自修复，仅保留最新一件', async () => {
    const oldItem = {
      id: 'item_old',
      saveId: 'save-a',
      itemId: 'old-accessory',
      poolId: '',
      name: '旧饰品',
      description: '',
      category: 'accessory',
      quantity: 1,
      quality: 'common',
      durability: 100,
      maxDurability: 100,
      inventorySlot: 1,
      equippedSlot: 'accessory1',
      equipped: true,
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
      updatedAt: 10,
    };

    const newItem = {
      ...oldItem,
      id: 'item_new',
      itemId: 'new-accessory',
      name: '新饰品',
      quality: 'rare',
      inventorySlot: 2,
      createdAt: 2,
      updatedAt: 20,
    };

    const updateMock = vi.fn().mockResolvedValue(null);

    const inventoryRepoMock = {
      findEquippedBySaveIdAndOwner: vi.fn().mockResolvedValue([oldItem, newItem]),
      update: updateMock,
    };

    const characterServiceMock = {
      getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char-1' }),
    };

    // getEquipment 自修复路径包事务执行多 duplicate.update，需提供 txManager.transaction mock
    const txManagerMock = {
      transaction: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb({})),
    };

    const service = new InventoryService(
      inventoryRepoMock as any,
      {} as any,
      characterServiceMock as any,
      {} as any,
      {} as any,
      txManagerMock as any,
      createRuleParserStub(),
      null,
    );

    const result = await service.getEquipment('save-a' as any, 'character', 'char-1');

    expect(result.equipment.map((item) => item.id)).toEqual(['item_new']);
    // 自修复包事务执行 update(id, patch, trx)，第三个参数是 trx
    expect(updateMock).toHaveBeenCalledWith(
      'item_old',
      expect.objectContaining({
        equipped: false,
        equippedSlot: null,
      }),
      expect.anything(),
    );
  });

  it('updateItem 将 equipped 设为 false 时应同步清空 equipped_slot', async () => {
    const item = {
      id: 'item_iron_sword',
      saveId: 'save-a',
      itemId: 'iron-sword',
      poolId: '',
      name: '铁剑',
      description: '',
      category: 'weapon',
      quantity: 1,
      quality: 'common',
      durability: 100,
      maxDurability: 100,
      inventorySlot: 1,
      equippedSlot: 'main_hand',
      equipped: true,
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
      updatedAt: 2,
    };

    const updateMock = vi.fn().mockResolvedValue(item);

    const inventoryRepoMock = {
      findById: vi.fn().mockResolvedValue(item),
      update: updateMock,
    };

    const service = new InventoryService(
      inventoryRepoMock as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      createRuleParserStub(),
      null,
    );

    (service as any).resolveInventoryId = vi.fn().mockResolvedValue('item_iron_sword');
    (service as any).validateOwnership = vi.fn().mockResolvedValue(undefined);

    await service.updateItem({
      saveId: 'save-a' as any,
      inventoryId: 'item_iron_sword' as any,
      equipped: false,
      ownerType: 'character',
      ownerId: 'char-1',
    });

    expect(updateMock).toHaveBeenCalledWith(
      'item_iron_sword',
      expect.objectContaining({
        equipped: false,
        equippedSlot: null,
      }),
      undefined,
    );
  });
});
