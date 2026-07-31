/**
 * 测试：consumable effects 自动应用机制
 *
 * 验证 useItem 对确定性 effect（heal/mana_restore/damage）自动应用到角色，
 * 语义性 effect（buff/debuff）不自动应用。
 */
import { describe, it, expect, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';
import type { InventoryItem } from '../types.js';

function createInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-1',
    saveId: 'save-1',
    itemId: 'potion-1',
    poolId: '',
    name: '治疗药水',
    description: '',
    category: 'consumable',
    quantity: 3,
    quality: 'common',
    durability: 10,
    maxDurability: 100,
    inventorySlot: 1,
    equippedSlot: null,
    equipped: false,
    equippedIndex: null,
    weight: 1,
    maxStack: 99,
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
  };
}

function createInventoryRepoMock(item: InventoryItem) {
  return {
    findById: vi.fn().mockResolvedValue(item),
    update: vi.fn().mockResolvedValue(item),
    delete: vi.fn().mockResolvedValue(true),
  };
}

function createCharacterServiceMock() {
  return {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char-1' }),
    modifyHealth: vi.fn().mockResolvedValue({ previous: 80, current: 100, max: 100 }),
    modifyMana: vi.fn().mockResolvedValue({ previous: 30, current: 50, max: 50 }),
  } as any;
}

function createNpcServiceMock() {
  return {
    resolveNpcId: vi.fn().mockResolvedValue('npc-1'),
    modifyNpcResource: vi.fn().mockResolvedValue({ previous: 50, current: 70, max: 100 }),
  } as any;
}

function createRuleParserStub() {
  return {
    getInventoryRules: () => ({
      max_slots: 20,
      stack_sizes: {},
      equipment_slots: [],
    }),
  } as any;
}

function createService(item: InventoryItem, characterService: any = createCharacterServiceMock(), npcService: any = null) {
  const inventoryRepo = createInventoryRepoMock(item);
  const service = new InventoryService(
    inventoryRepo as any,
    {} as any,
    characterService,
    {} as any,
    {} as any,
    { transaction: vi.fn((fn: any) => fn({})) } as any,
    createRuleParserStub(),
    null,           // templatePoolService
    npcService,     // npcService（第 9 个参数）
  );
  return { service, inventoryRepo, characterService };
}

describe('consumable effects 自动应用', () => {
  it('heal effect 自动应用到角色 HP', async () => {
    const item = createInventoryItem({
      effects: [
        { type: 'heal', value: 20 },
        { type: 'buff', value: 2, duration: 3 },
      ],
    });
    const { service, characterService } = createService(item);

    const result = await service.useItem('save-1', 'item-1');

    expect(result.success).toBe(true);
    expect(result.appliedEffects).toHaveLength(1);
    expect(result.appliedEffects[0].type).toBe('heal');
    expect(result.appliedEffects[0].value).toBe(20);
    expect(result.appliedEffects[0].current).toBe(100);
    expect(characterService.modifyHealth).toHaveBeenCalledWith('save-1', 20, expect.anything());
  });

  it('buff effect 不自动应用', async () => {
    const item = createInventoryItem({
      effects: [{ type: 'buff', value: 2, duration: 3 }],
    });
    const { service, characterService } = createService(item);

    const result = await service.useItem('save-1', 'item-1');

    expect(result.appliedEffects).toHaveLength(0);
    expect(characterService.modifyHealth).not.toHaveBeenCalled();
  });

  it('mana_restore effect 自动应用到角色 MP', async () => {
    const item = createInventoryItem({
      id: 'item-2',
      itemId: 'mana-potion',
      name: '法力药水',
      quantity: 2,
      effects: [{ type: 'mana_restore', value: 20 }],
    });
    const { service, characterService } = createService(item);

    const result = await service.useItem('save-1', 'item-2');

    expect(result.appliedEffects).toHaveLength(1);
    expect(result.appliedEffects[0].type).toBe('mana_restore');
    expect(characterService.modifyMana).toHaveBeenCalledWith('save-1', 20, expect.anything());
  });

  it('damage effect 自动应用到角色 HP（负值）', async () => {
    const item = createInventoryItem({
      id: 'item-3',
      itemId: 'poison',
      name: '毒药',
      quantity: 1,
      effects: [{ type: 'damage', value: 30 }],
    });
    const { service, characterService } = createService(item);

    const result = await service.useItem('save-1', 'item-3');

    expect(result.appliedEffects).toHaveLength(1);
    expect(result.appliedEffects[0].type).toBe('damage');
    expect(characterService.modifyHealth).toHaveBeenCalledWith('save-1', -30, expect.anything());
  });

  it('NPC 拥有者也自动应用效果（M11: character 和 npc 都支持）', async () => {
    const item = createInventoryItem({
      id: 'item-4',
      itemId: 'npc-potion',
      name: 'NPC药水',
      ownerType: 'npc',
      ownerId: 'npc-1',
      effects: [{ type: 'heal', value: 20 }],
    });
    const npcService = createNpcServiceMock();
    const { service, characterService } = createService(item, createCharacterServiceMock(), npcService);

    const result = await service.useItem('save-1', 'item-4', 'npc', 'npc-1');

    // M11: NPC 也自动应用确定性效果（通过 npcService.modifyNpcResource）
    expect(result.appliedEffects).toHaveLength(1);
    expect(result.appliedEffects[0].type).toBe('heal');
    expect(npcService.modifyNpcResource).toHaveBeenCalledWith('save-1', 'npc-1', 'hp', 20, expect.anything());
    // characterService.modifyHealth 不应被调用（NPC 走 npcService 分支）
    expect(characterService.modifyHealth).not.toHaveBeenCalled();
  });

  it('applyDeterministicEffect 异常时不阻塞使用', async () => {
    const item = createInventoryItem({
      effects: [{ type: 'heal', value: 20 }],
    });
    const failCharService = {
      getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char-1' }),
      modifyHealth: vi.fn().mockRejectedValue(new Error('DB error')),
    } as any;
    const { service } = createService(item, failCharService);

    const result = await service.useItem('save-1', 'item-1');

    expect(result.success).toBe(true);
    expect(result.appliedEffects).toHaveLength(0);
  });
});
