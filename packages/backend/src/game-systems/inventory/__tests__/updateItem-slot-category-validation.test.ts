import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';
import type { ItemCategory, EquipmentSlot } from '../types.js';

const mockEquipmentSlots = [
  { id: 'main_hand', accepted_item_types: ['weapon'] },
  { id: 'off_hand', accepted_item_types: ['weapon', 'shield', 'accessory'] },
  { id: 'body', accepted_item_types: ['armor'] },
  { id: 'head', accepted_item_types: ['armor'] },
  { id: 'accessory1', accepted_item_types: ['accessory'] },
  { id: 'accessory2', accepted_item_types: ['accessory'] },
];

function createService(item: Record<string, unknown>) {
  const inventoryItem = {
    id: item.id as string,
    saveId: item.saveId as string,
    name: item.name as string,
    category: item.category as string,
    equipped: item.equipped as boolean,
    equippedSlot: item.equippedSlot as string | null,
    ownerType: item.ownerType as string,
    ownerId: item.ownerId as string,
  };

  const updateFn = vi.fn().mockResolvedValue(inventoryItem);

  const inventoryRepoMock = {
    findById: vi.fn().mockResolvedValue(inventoryItem),
    update: updateFn,
  };

  const ruleParserMock = {
    getInventoryRules: () => ({ equipment_slots: mockEquipmentSlots }),
  };

  const service = new InventoryService(
    inventoryRepoMock as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    ruleParserMock as any,
    null,
  );

  (service as any).resolveInventoryId = vi.fn().mockResolvedValue(item.id);
  (service as any).validateOwnership = vi.fn().mockResolvedValue(undefined);

  return { service, updateFn };
}

describe('InventoryService.updateItem — equippedSlot 类别合法性约束', () => {
  it('允许 weapon 类别装备到 main_hand 槽位', async () => {
    const { service } = createService({
      id: 'item_1', saveId: 'save1', name: '测试剑', category: 'weapon',
      equipped: false, equippedSlot: null, ownerType: 'character', ownerId: '',
    });

    const result = await service.updateItem({
      saveId: 'save1',
      inventoryId: 'item_1',
      equippedSlot: 'main_hand' as EquipmentSlot,
    });

    expect(result).toBeDefined();
  });

  it('禁止 weapon 类别装备到 body 槽位', async () => {
    const { service } = createService({
      id: 'item_1', saveId: 'save1', name: '测试剑', category: 'weapon',
      equipped: false, equippedSlot: null, ownerType: 'character', ownerId: '',
    });

    await expect(
      service.updateItem({
        saveId: 'save1',
        inventoryId: 'item_1',
        equippedSlot: 'body' as EquipmentSlot,
      })
    ).rejects.toThrow(/does not accept category/i);
  });

  it('禁止 armor 类别装备到 main_hand 槽位', async () => {
    const { service } = createService({
      id: 'item_2', saveId: 'save1', name: '铁甲', category: 'armor',
      equipped: false, equippedSlot: null, ownerType: 'character', ownerId: '',
    });

    await expect(
      service.updateItem({
        saveId: 'save1',
        inventoryId: 'item_2',
        equippedSlot: 'main_hand' as EquipmentSlot,
      })
    ).rejects.toThrow(/does not accept category/i);
  });

  it('允许 accessory 类别装备到 accessory1 槽位', async () => {
    const { service } = createService({
      id: 'item_3', saveId: 'save1', name: '戒指', category: 'accessory',
      equipped: false, equippedSlot: null, ownerType: 'character', ownerId: '',
    });

    const result = await service.updateItem({
      saveId: 'save1',
      inventoryId: 'item_3',
      equippedSlot: 'accessory1' as EquipmentSlot,
    });

    expect(result).toBeDefined();
  });

  it('同时设置 category 和 equippedSlot 时使用新 category 校验', async () => {
    const { service } = createService({
      id: 'item_4', saveId: 'save1', name: '变形物品', category: 'weapon',
      equipped: false, equippedSlot: null, ownerType: 'character', ownerId: '',
    });

    const result = await service.updateItem({
      saveId: 'save1',
      inventoryId: 'item_4',
      category: 'armor' as ItemCategory,
      equippedSlot: 'body' as EquipmentSlot,
    });

    expect(result).toBeDefined();
  });

  it('清空 equippedSlot 时不触发类别校验', async () => {
    const { service } = createService({
      id: 'item_5', saveId: 'save1', name: '测试剑', category: 'weapon',
      equipped: true, equippedSlot: 'main_hand', ownerType: 'character', ownerId: '',
    });

    const result = await service.updateItem({
      saveId: 'save1',
      inventoryId: 'item_5',
      equippedSlot: null as any,
    });

    expect(result).toBeDefined();
  });

  it('无效的槽位 ID 应被拒绝', async () => {
    const { service } = createService({
      id: 'item_6', saveId: 'save1', name: '测试剑', category: 'weapon',
      equipped: false, equippedSlot: null, ownerType: 'character', ownerId: '',
    });

    await expect(
      service.updateItem({
        saveId: 'save1',
        inventoryId: 'item_6',
        equippedSlot: 'nonexistent_slot' as EquipmentSlot,
      })
    ).rejects.toThrow(/invalid equipment slot/i);
  });
});
