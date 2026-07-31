/**
 * Inventory 系统规格说明验证测试（重写版）
 *
 * 验证 docs/help/inventory-skill-methods.md 第二章 inventory_service 10 个方法：
 * - 正确输入：各方法在合规输入下达到说明期望的功能效果
 * - 错误输入：各方法在违规输入下正确抛错或拒绝
 * - 部分正确输入：边界场景（name/id 兼容、通配符与精确混合、归属不匹配）
 *
 * 覆盖修复点：
 * - unequipItem 归属校验（与 validateOwnership 统一，遵循架构规范 13.3）
 */
import { describe, it, expect, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';
import type { InventoryItem } from '../types.js';

// ============================================================================
// 工厂函数：创建测试数据与 mock 依赖
// ============================================================================

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

function createRuleParserStub() {
  return {
    getInventoryRules: () => ({
      max_slots: 20,
      stack_sizes: {},
      equipment_slots: [
        { id: 'weapon', accepted_item_types: ['weapon'] },
        { id: 'armor', accepted_item_types: ['armor'] },
      ],
    }),
  } as any;
}

function createCharacterServiceMock(charInfo: any = { characterId: 'char-1', currency: { gold: 100 } }) {
  return {
    getCharacterBasicInfo: vi.fn().mockResolvedValue(charInfo),
    getCharacterLevel: vi.fn().mockResolvedValue(5),
    modifyHealth: vi.fn().mockResolvedValue({ previous: 80, current: 100, max: 100 }),
    modifyMana: vi.fn().mockResolvedValue({ previous: 30, current: 50, max: 50 }),
    modifyStamina: vi.fn().mockResolvedValue({ previous: 80, current: 100, max: 100 }),
    modifyCurrency: vi.fn().mockResolvedValue({ previous: 100, current: 90, max: 999999 }),
  } as any;
}

function createNpcServiceMock(resolveResult: string = 'npc-001') {
  return {
    resolveNpcId: vi.fn().mockResolvedValue(resolveResult),
    getNpcResources: vi.fn().mockResolvedValue({ hp: 50, mp: 30, stamina: 100, currency: { gold: 50 } }),
    modifyNpcResource: vi.fn().mockResolvedValue({ previous: 50, current: 70, max: 100 }),
    modifyNpcHealth: vi.fn().mockResolvedValue({ previous: 100, current: 70, max: 100 }),
  } as any;
}

function createNumericalServiceMock() {
  return {
    recalculateDerivedAttributes: vi.fn().mockResolvedValue(undefined),
    recalculateNpcAttributes: vi.fn().mockResolvedValue(undefined),
  } as any;
}

interface RepoMockConfig {
  items?: InventoryItem[];
  findByIdResult?: InventoryItem | null;
  findAllByNameResult?: InventoryItem[];
  findEquippedBySaveIdResult?: InventoryItem[];
  findEquippedByOwnerResult?: InventoryItem[];
  // addItem 走 insert 路径需 findByNameAndSaveIdAndOwner 返回 null（避免误触发 dedup 增量更新）
  findByNameAndSaveIdAndOwnerResult?: InventoryItem | null;
}

function createInventoryRepoMock(config: RepoMockConfig = {}) {
  const defaultItem = createInventoryItem();
  const findByIdResult = config.findByIdResult !== undefined ? config.findByIdResult : defaultItem;
  // 默认 null：addItem 期望"无同名物品"走 insert 路径，避免误触发 dedup 走 update 路径
  const findByNameAndSaveIdAndOwnerResult = config.findByNameAndSaveIdAndOwnerResult !== undefined
    ? config.findByNameAndSaveIdAndOwnerResult
    : null;
  return {
    findBySaveId: vi.fn().mockResolvedValue(config.items ?? [defaultItem]),
    findById: vi.fn().mockResolvedValue(findByIdResult),
    findBySaveIdAndItemId: vi.fn().mockResolvedValue(null),
    findBySaveIdAndOwner: vi.fn().mockResolvedValue(config.items ?? [defaultItem]),
    findBySaveIdAndOwnerType: vi.fn().mockResolvedValue(config.items ?? [defaultItem]),
    findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(findByNameAndSaveIdAndOwnerResult),
    findEquippedBySaveIdAndOwner: vi.fn().mockResolvedValue(config.findEquippedByOwnerResult ?? []),
    findEquippedBySaveId: vi.fn().mockResolvedValue(config.findEquippedBySaveIdResult ?? []),
    findAllByNameAndSaveId: vi.fn().mockResolvedValue(config.findAllByNameResult ?? []),
    findEquippedBySlot: vi.fn().mockResolvedValue(null),
    findOccupiedSlots: vi.fn().mockResolvedValue([]),
    findStackableItem: vi.fn().mockResolvedValue(null),
    sumQuantityBySaveIdAndItemId: vi.fn().mockResolvedValue(1),
    insert: vi.fn().mockResolvedValue(defaultItem),
    update: vi.fn().mockResolvedValue(defaultItem),
    delete: vi.fn().mockResolvedValue(true),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
    countBySaveId: vi.fn().mockResolvedValue(1),
    sumWeightBySaveId: vi.fn().mockResolvedValue(1),
  } as any;
}

function createService(
  repoConfig: RepoMockConfig = {},
  options: {
    characterService?: any;
    npcService?: any;
    numericalService?: any;
  } = {},
) {
  const inventoryRepo = createInventoryRepoMock(repoConfig);
  const characterService = options.characterService ?? createCharacterServiceMock();
  const npcService = options.npcService ?? createNpcServiceMock();
  const numericalService = options.numericalService ?? createNumericalServiceMock();

  const service = new InventoryService(
    inventoryRepo,
    {} as any,  // itemPoolRepo
    characterService,
    numericalService,
    {} as any,  // saveRepo
    { transaction: vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any)) } as any,
    createRuleParserStub(),
    null,
    npcService,
  );

  return { service, inventoryRepo, characterService, npcService, numericalService };
}

// ============================================================================
// 测试用例
// ============================================================================

describe('Inventory 系统规格说明验证', () => {
  // ==========================================================================
  // 一、正确输入（合规输入达到期望功能效果）
  // ==========================================================================
  describe('一、正确输入', () => {

    // ---- resolveOwnerId 自动注入（文档 1.3 / 1.4）----
    describe('resolveOwnerId 自动注入', () => {
      it('1.1 ownerType 空 → 自动调用 characterService.getCharacterBasicInfo 解析 characterId', async () => {
        const { service, characterService } = createService();

        await service.listInventory('save-1', undefined, 'all', 'character');

        expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', undefined);
      });

      it('1.2 ownerType="character" → 同样自动解析，LLM 不需要传 ownerId', async () => {
        const { service, characterService } = createService();

        await service.listInventory('save-1', undefined, 'all', 'character');

        expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', undefined);
      });

      it('1.3 ownerType="npc" → 调用 npcService.resolveNpcId 解析名称为 ID', async () => {
        const { service, npcService } = createService();

        await service.listInventory('save-1', undefined, 'all', 'npc', '村长艾德温');

        expect(npcService.resolveNpcId).toHaveBeenCalledWith('save-1', '村长艾德温', undefined);
      });
    });

    // ---- 查询类通配符支持（文档 2.1 / 5.1）----
    describe('查询类通配符', () => {
      it('1.4 list_inventory ownerType 空 → 返回所有 owner 的 inventory', async () => {
        const items = [
          createInventoryItem({ id: 'item-1', ownerType: 'character', ownerId: 'char-1' }),
          createInventoryItem({ id: 'item-2', ownerType: 'npc', ownerId: 'npc-001', name: 'NPC药水' }),
        ];
        const { service, inventoryRepo } = createService({ items });

        const result = await service.listInventory('save-1');

        expect(inventoryRepo.findBySaveId).toHaveBeenCalledWith('save-1', undefined);
        expect(result.items).toHaveLength(2);
      });

      it('1.5 list_inventory ownerType="all" → 同样返回所有 owner', async () => {
        const items = [
          createInventoryItem({ id: 'item-1', ownerType: 'character' }),
          createInventoryItem({ id: 'item-2', ownerType: 'npc', name: 'NPC物品' }),
        ];
        const { service } = createService({ items });

        const result = await service.listInventory('save-1', undefined, 'all', 'all');

        expect(result.items).toHaveLength(2);
      });

      it('1.6 list_inventory ownerType 精确 → 按 owner 过滤', async () => {
        const { service, inventoryRepo } = createService({
          items: [createInventoryItem({ ownerType: 'character', ownerId: 'char-1' })],
        });

        await service.listInventory('save-1', undefined, 'all', 'character');

        expect(inventoryRepo.findBySaveIdAndOwner).toHaveBeenCalledWith('save-1', 'character', 'char-1', undefined);
      });

      it('1.7 get_item ownerType 空 + 按名称查 → 返回数组（所有 owner 的同名物品）', async () => {
        const items = [
          createInventoryItem({ id: 'item-1', name: '治疗药水', ownerType: 'character', ownerId: 'char-1' }),
          createInventoryItem({ id: 'item-2', name: '治疗药水', ownerType: 'npc', ownerId: 'npc-001' }),
        ];
        const { service, inventoryRepo } = createService({
          findAllByNameResult: items,
          findByIdResult: null,
        });

        const result = await service.getItem('save-1', '治疗药水');

        expect(inventoryRepo.findAllByNameAndSaveId).toHaveBeenCalledWith('save-1', '治疗药水');
        expect(Array.isArray(result)).toBe(true);
        expect(result as InventoryItem[]).toHaveLength(2);
      });

      it('1.8 get_item ownerType 空 + 按 ID 查 → 返回单元素数组', async () => {
        const item = createInventoryItem({ id: 'item-1' });
        const { service } = createService({ findByIdResult: item });

        const result = await service.getItem('save-1', 'item-1');

        expect(Array.isArray(result)).toBe(true);
        expect(result as InventoryItem[]).toHaveLength(1);
      });

      it('1.9 get_equipment ownerType="all" → 返回所有 owner 的已装备物品', async () => {
        const equipped = [
          createInventoryItem({ id: 'w1', equipped: true, equippedSlot: 'weapon', ownerType: 'character' }),
          createInventoryItem({ id: 'w2', equipped: true, equippedSlot: 'weapon', ownerType: 'npc', ownerId: 'npc-001' }),
        ];
        const { service, inventoryRepo } = createService({ findEquippedBySaveIdResult: equipped });

        const result = await service.getEquipment('save-1', 'all');

        expect(inventoryRepo.findEquippedBySaveId).toHaveBeenCalledWith('save-1');
        expect(result.equipment).toHaveLength(2);
      });

      it('1.10 get_equipment ownerType 精确 → 按 owner 过滤', async () => {
        const { service, inventoryRepo } = createService({
          findEquippedByOwnerResult: [createInventoryItem({ equipped: true })],
        });

        await service.getEquipment('save-1', 'character');

        expect(inventoryRepo.findEquippedBySaveIdAndOwner).toHaveBeenCalledWith('save-1', 'character', 'char-1');
      });
    });

    // ---- 写入类默认 character（文档 2.2）----
    describe('写入类默认 character', () => {
      it('1.11 add_item ownerType 空 → 默认 character，自动注入 characterId', async () => {
        const { service, characterService, inventoryRepo } = createService();

        await service.addItem({ saveId: 'save-1', name: '长剑', category: 'weapon' });

        expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', undefined);
        expect(inventoryRepo.insert).toHaveBeenCalledWith(
          expect.objectContaining({ ownerType: 'character', ownerId: 'char-1' }),
          undefined,
        );
      });

      it('1.12 add_item ownerType="npc" → 调用 resolveNpcId 解析', async () => {
        const { service, npcService, inventoryRepo } = createService();

        await service.addItem({
          saveId: 'save-1', name: 'NPC武器', category: 'weapon',
          ownerType: 'npc', ownerId: '哥布林队长',
        });

        expect(npcService.resolveNpcId).toHaveBeenCalledWith('save-1', '哥布林队长', undefined);
        expect(inventoryRepo.insert).toHaveBeenCalledWith(
          expect.objectContaining({ ownerType: 'npc', ownerId: 'npc-001' }),
          undefined,
        );
      });

      it('1.13 remove_item 删除前校验归属（validateOwnership）', async () => {
        const item = createInventoryItem({ ownerType: 'character', ownerId: 'char-1' });
        const { service, inventoryRepo } = createService({ findByIdResult: item });

        await service.removeItem('save-1', 'item-1', undefined, undefined, 'character', 'char-1');

        expect(inventoryRepo.findById).toHaveBeenCalled();
      });

      it('1.14 update_item patch 包含 ownerType/ownerId（从 item 真实归属读取）', async () => {
        const item = createInventoryItem({ ownerType: 'npc', ownerId: 'npc-001' });
        const { service, inventoryRepo } = createService({ findByIdResult: item });

        await service.updateItem({
          saveId: 'save-1', inventoryId: 'item-1', quantity: 5,
          ownerType: 'npc', ownerId: 'npc-001',
        });

        expect(inventoryRepo.update).toHaveBeenCalledWith(
          'item-1',
          expect.objectContaining({ ownerType: 'npc', ownerId: 'npc-001', quantity: 5 }),
          undefined,
        );
      });
    });

    // ---- NPC 支持（文档 2.2 equip/unequip/use/trade / 4.3 / 4.4）----
    describe('NPC 支持', () => {
      it('1.15 equip_item NPC 物品 → 调用 recalculateNpcAttributes', async () => {
        const item = createInventoryItem({
          equipped: false, ownerType: 'npc', ownerId: 'npc-001',
          category: 'weapon', equippedSlot: null,
        });
        const { service, numericalService } = createService({ findByIdResult: item });

        await service.equipItem('save-1', 'item-1', undefined, 'npc', 'npc-001');

        expect(numericalService.recalculateNpcAttributes).toHaveBeenCalled();
        expect(numericalService.recalculateDerivedAttributes).not.toHaveBeenCalled();
      });

      it('1.16 unequip_item NPC 物品 → 调用 recalculateNpcAttributes', async () => {
        const item = createInventoryItem({
          equipped: true, equippedSlot: 'weapon', ownerType: 'npc', ownerId: 'npc-001',
        });
        const { service, numericalService } = createService({ findByIdResult: item });

        await service.unequipItem('save-1', 'item-1', 'npc', 'npc-001');

        expect(numericalService.recalculateNpcAttributes).toHaveBeenCalledWith('save-1', 'npc-001', expect.anything());
        expect(numericalService.recalculateDerivedAttributes).not.toHaveBeenCalled();
      });

      it('1.17 unequip_item character 物品 → 调用 recalculateDerivedAttributes', async () => {
        const item = createInventoryItem({
          equipped: true, equippedSlot: 'weapon', ownerType: 'character', ownerId: 'char-1',
        });
        const { service, numericalService } = createService({ findByIdResult: item });

        await service.unequipItem('save-1', 'item-1');

        expect(numericalService.recalculateDerivedAttributes).toHaveBeenCalledWith('save-1', expect.anything());
        expect(numericalService.recalculateNpcAttributes).not.toHaveBeenCalled();
      });

      it('1.18 use_item NPC heal → 调用 npcService.modifyNpcResource(saveId, npcId, "hp", value)', async () => {
        const item = createInventoryItem({
          ownerType: 'npc', ownerId: 'npc-001',
          effects: [{ type: 'heal', value: 20 }],
        });
        const npcService = createNpcServiceMock('npc-001');
        const { service, characterService } = createService({ findByIdResult: item }, { npcService });

        await service.useItem('save-1', 'item-1', 'npc', 'npc-001');

        expect(npcService.modifyNpcResource).toHaveBeenCalledWith('save-1', 'npc-001', 'hp', 20, expect.anything());
        expect(characterService.modifyHealth).not.toHaveBeenCalled();
      });

      it('1.19 use_item character heal → 调用 characterService.modifyHealth', async () => {
        const item = createInventoryItem({
          ownerType: 'character', ownerId: 'char-1',
          effects: [{ type: 'heal', value: 20 }],
        });
        const { service, characterService, npcService } = createService({ findByIdResult: item });

        await service.useItem('save-1', 'item-1');

        expect(characterService.modifyHealth).toHaveBeenCalledWith('save-1', 20, expect.anything());
        expect(npcService.modifyNpcResource).not.toHaveBeenCalled();
      });

      it('1.20 trade_items NPC → 金币查询用 npcService.getNpcResources', async () => {
        const item = createInventoryItem({
          ownerType: 'npc', ownerId: 'npc-001', value: { sell: 10 },
        });
        const { service, npcService, characterService } = createService({
          findByIdResult: item, items: [item],
        });

        await service.tradeItems('save-1', {
          sellItems: [{ inventoryId: 'item-1', quantity: 1 }],
          buyItems: [], goldDelta: 10,
          ownerType: 'npc', ownerId: 'npc-001',
        });

        expect(npcService.getNpcResources).toHaveBeenCalledWith('save-1', 'npc-001', expect.anything());
        expect(characterService.getCharacterBasicInfo).not.toHaveBeenCalledWith('save-1', expect.anything());
      });

      it('1.21 trade_items NPC → 金币修改用 npcService.modifyNpcResource(saveId, npcId, "currency", delta)', async () => {
        const item = createInventoryItem({
          ownerType: 'npc', ownerId: 'npc-001', value: { sell: 10 },
        });
        const { service, npcService } = createService({
          findByIdResult: item, items: [item],
        });

        await service.tradeItems('save-1', {
          sellItems: [{ inventoryId: 'item-1', quantity: 1 }],
          buyItems: [], goldDelta: 10,
          ownerType: 'npc', ownerId: 'npc-001',
        });

        expect(npcService.modifyNpcResource).toHaveBeenCalledWith('save-1', 'npc-001', 'currency', 10, expect.anything());
      });

      it('1.22 trade_items character → 金币修改用 characterService.modifyCurrency', async () => {
        const item = createInventoryItem({
          ownerType: 'character', ownerId: 'char-1', value: { sell: 10 },
        });
        const { service, characterService } = createService({
          findByIdResult: item, items: [item],
        });

        await service.tradeItems('save-1', {
          sellItems: [{ inventoryId: 'item-1', quantity: 1 }],
          buyItems: [], goldDelta: 10,
        });

        expect(characterService.modifyCurrency).toHaveBeenCalledWith('save-1', 'gold', 10, expect.anything());
      });
    });
  });

  // ==========================================================================
  // 二、错误输入（违规输入正确抛错或拒绝）
  // ==========================================================================
  describe('二、错误输入', () => {

    describe('resolveOwnerId 错误', () => {
      it('2.1 ownerType="npc" 但 ownerId 为空 → 抛错', async () => {
        const { service } = createService();

        await expect(
          service.listInventory('save-1', undefined, 'all', 'npc'),
        ).rejects.toThrow('ownerId is required when ownerType is npc');
      });

      it('2.2 ownerType="all" 用于写入类 → 抛错（写入类不支持通配）', async () => {
        const { service } = createService();

        await expect(
          service.addItem({ saveId: 'save-1', name: 'test', category: 'weapon', ownerType: 'all' as any }),
        ).rejects.toThrow(/Invalid ownerType: all/);
      });

      it('2.3 ownerType 非法值 → 抛错', async () => {
        const { service } = createService();

        await expect(
          service.listInventory('save-1', undefined, 'all', 'invalid' as any),
        ).rejects.toThrow(/Invalid ownerType: invalid/);
      });
    });

    describe('写入类归属校验错误', () => {
      it('2.4 remove_item 归属不匹配 → 抛错（item 属于 npc，传 character 校验）', async () => {
        const item = createInventoryItem({ ownerType: 'npc', ownerId: 'npc-001' });
        const { service } = createService({ findByIdResult: item });

        await expect(
          service.removeItem('save-1', 'item-1', undefined, undefined, 'character', 'char-1'),
        ).rejects.toThrow(/does not belong to/);
      });

      it('2.5 update_item 归属不匹配 → 抛错', async () => {
        const item = createInventoryItem({ ownerType: 'npc', ownerId: 'npc-001' });
        const { service } = createService({ findByIdResult: item });

        await expect(
          service.updateItem({
            saveId: 'save-1', inventoryId: 'item-1', quantity: 5,
            ownerType: 'character',
          }),
        ).rejects.toThrow(/does not belong to/);
      });

      it('2.6 use_item 归属不匹配 → 抛错', async () => {
        const item = createInventoryItem({ ownerType: 'npc', ownerId: 'npc-001' });
        const { service } = createService({ findByIdResult: item });

        await expect(
          service.useItem('save-1', 'item-1', 'character', 'char-1'),
        ).rejects.toThrow(/does not belong to/);
      });

      it('2.7 unequip_item 归属不匹配 → 抛错（修复后与 validateOwnership 统一）', async () => {
        // 场景：LLM 传 ownerType="character"（或不传），但 item 实际归属 NPC
        const item = createInventoryItem({
          equipped: true, equippedSlot: 'weapon',
          ownerType: 'npc', ownerId: 'npc-001',
        });
        const { service } = createService({ findByIdResult: item });

        // 不传 ownerType（默认 character），但 item 是 NPC 的 → 应抛错
        await expect(
          service.unequipItem('save-1', 'item-1'),
        ).rejects.toThrow(/does not belong to/);
      });

      it('2.8 unequip_item ownerType="npc" + 错误 ownerId → 抛错', async () => {
        const item = createInventoryItem({
          equipped: true, equippedSlot: 'weapon',
          ownerType: 'npc', ownerId: 'npc-001',
        });
        // resolveNpcId 返回传入的错误 ownerId，模拟"NPC 名称解析出了一个不属于此 item 的 NPC ID"
        const npcService = createNpcServiceMock();
        (npcService.resolveNpcId as any).mockResolvedValue('npc-999');
        const { service } = createService({ findByIdResult: item }, { npcService });

        await expect(
          service.unequipItem('save-1', 'item-1', 'npc', 'npc-999'),
        ).rejects.toThrow(/does not belong to/);
      });

      it('2.9 unequip_item ownerType="npc" 但 ownerId 为空 → 抛错', async () => {
        const item = createInventoryItem({
          equipped: true, equippedSlot: 'weapon',
          ownerType: 'npc', ownerId: 'npc-001',
        });
        const { service } = createService({ findByIdResult: item });

        await expect(
          service.unequipItem('save-1', 'item-1', 'npc'),
        ).rejects.toThrow('ownerId is required when ownerType is npc');
      });
    });

    describe('查询类错误', () => {
      it('2.10 get_item 按名称查无匹配 → 抛错', async () => {
        const { service } = createService({
          findByIdResult: null,
          findAllByNameResult: [],
        });

        await expect(
          service.getItem('save-1', '不存在的物品'),
        ).rejects.toThrow(/Inventory item not found/);
      });

      it('2.11 get_item 按 ID 查无匹配 → 抛错', async () => {
        const { service } = createService({ findByIdResult: null });

        await expect(
          service.getItem('save-1', 'nonexistent-id'),
        ).rejects.toThrow(/Inventory item not found/);
      });
    });
  });

  // ==========================================================================
  // 三、部分正确输入（边界场景）
  // ==========================================================================
  describe('三、部分正确输入（边界场景）', () => {

    describe('name/id 双兼容（文档 1.3 / Q2）', () => {
      it('3.1 add_item ownerId 传 NPC 名称 → 自动 resolveNpcId 为 ID', async () => {
        const { service, npcService, inventoryRepo } = createService();

        await service.addItem({
          saveId: 'save-1', name: 'NPC药水', category: 'consumable',
          ownerType: 'npc', ownerId: '村长艾德温',
        });

        expect(npcService.resolveNpcId).toHaveBeenCalledWith('save-1', '村长艾德温', undefined);
        expect(inventoryRepo.insert).toHaveBeenCalledWith(
          expect.objectContaining({ ownerId: 'npc-001' }),
          undefined,
        );
      });

      it('3.2 add_item ownerId 传 NPC ID → 直接使用，仍调用 resolveNpcId（一致行为）', async () => {
        const { service, npcService, inventoryRepo } = createService();

        await service.addItem({
          saveId: 'save-1', name: 'NPC药水', category: 'consumable',
          ownerType: 'npc', ownerId: 'npc-001',
        });

        expect(npcService.resolveNpcId).toHaveBeenCalledWith('save-1', 'npc-001', undefined);
        expect(inventoryRepo.insert).toHaveBeenCalledWith(
          expect.objectContaining({ ownerId: 'npc-001' }),
          undefined,
        );
      });
    });

    describe('通配符与精确混合边界', () => {
      it('3.3 get_item ownerType 空 + 按 ID 查（id 唯一）→ 返回单元素数组', async () => {
        const item = createInventoryItem({ id: 'item-1' });
        const { service } = createService({ findByIdResult: item });

        const result = await service.getItem('save-1', 'item-1');

        expect(Array.isArray(result)).toBe(true);
        expect(result as InventoryItem[]).toHaveLength(1);
      });

      it('3.4 get_item ownerType 精确 → 返回单个对象（非数组）', async () => {
        const item = createInventoryItem({ id: 'item-1', ownerType: 'character', ownerId: 'char-1' });
        const { service } = createService({ findByIdResult: item });

        const result = await service.getItem('save-1', 'item-1', 'character');

        expect(Array.isArray(result)).toBe(false);
        expect((result as InventoryItem).id).toBe('item-1');
      });

      it('3.5 list_inventory 空背包 → 返回空数组', async () => {
        const { service } = createService({ items: [] });

        const result = await service.listInventory('save-1');

        expect(result.items).toHaveLength(0);
      });
    });

    describe('unequip_item 归属校验边界（修复后行为）', () => {
      it('3.6 unequip_item NPC 物品 + 正确 ownerType="npc" + ownerId → 成功卸下', async () => {
        const item = createInventoryItem({
          equipped: true, equippedSlot: 'weapon',
          ownerType: 'npc', ownerId: 'npc-001',
        });
        const { service, numericalService, inventoryRepo } = createService({ findByIdResult: item });

        await service.unequipItem('save-1', 'item-1', 'npc', 'npc-001');

        // NPC 物品走 recalculateNpcAttributes 分支
        expect(numericalService.recalculateNpcAttributes).toHaveBeenCalledWith('save-1', 'npc-001', expect.anything());
        // update 携带 owner 归属
        expect(inventoryRepo.update).toHaveBeenCalledWith(
          'item-1',
          expect.objectContaining({
            ownerType: 'npc', ownerId: 'npc-001',
            equipped: false, equippedSlot: null,
          }),
          expect.anything(),
        );
      });

      it('3.7 unequip_item character 物品 + 不传 ownerType → 成功卸下（默认 character 匹配）', async () => {
        const item = createInventoryItem({
          equipped: true, equippedSlot: 'weapon',
          ownerType: 'character', ownerId: 'char-1',
        });
        const { service, numericalService } = createService({ findByIdResult: item });

        await service.unequipItem('save-1', 'item-1');

        expect(numericalService.recalculateDerivedAttributes).toHaveBeenCalledWith('save-1', expect.anything());
        expect(numericalService.recalculateNpcAttributes).not.toHaveBeenCalled();
      });

      it('3.8 unequip_item 未装备的物品 → 抛错', async () => {
        const item = createInventoryItem({
          equipped: false, ownerType: 'character', ownerId: 'char-1',
        });
        const { service } = createService({ findByIdResult: item });

        await expect(
          service.unequipItem('save-1', 'item-1'),
        ).rejects.toThrow(/Item is not equipped/);
      });
    });

    describe('use_item 效果类型边界', () => {
      it('3.9 use_item NPC mana_restore → 调用 npcService.modifyNpcResource(saveId, npcId, "mp", value)', async () => {
        const item = createInventoryItem({
          ownerType: 'npc', ownerId: 'npc-001',
          effects: [{ type: 'mana_restore', value: 15 }],
        });
        const npcService = createNpcServiceMock('npc-001');
        const { service } = createService({ findByIdResult: item }, { npcService });

        await service.useItem('save-1', 'item-1', 'npc', 'npc-001');

        expect(npcService.modifyNpcResource).toHaveBeenCalledWith('save-1', 'npc-001', 'mp', 15, expect.anything());
      });

      it('3.10 use_item 非 consumable 类别 → 返回失败（不抛错）', async () => {
        const item = createInventoryItem({
          category: 'weapon', ownerType: 'character', ownerId: 'char-1',
        });
        const { service } = createService({ findByIdResult: item });

        const result = await service.useItem('save-1', 'item-1');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Cannot use non-consumable item/);
      });
    });
  });
});
