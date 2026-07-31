/**
 * Inventory 系统方法说明扩展合规测试
 *
 * 本测试文件基于 docs/help/inventory-skill-methods.md 文档说明 + 子Agent独立审查报告，
 * 覆盖现有 owner-autowire-methods.test.ts 未覆盖的多种情况：
 *
 * 1. equip_item NPC 派生属性重算（文档 2.2 equip_item 特殊行为）
 * 2. equip_item 数据归属到 patch（文档 2.2 EntityGraph）
 * 3. equip_item ownerType/ownerId 禁止 fallback character（审查发现 P1，违反 13.3）
 * 4. use_item NPC damage 效果（文档 2.2 use_item 效果类型）
 * 5. unequip_item 使用 item.ownerType 判断分支（文档 2.2 unequip_item）
 * 6. trade_items NPC 金币从 NPC 自身扣除（文档 Q4）
 * 7. use_item NPC stamina 效果（文档 4.4 NPC 资源修改）
 */
import { describe, it, expect, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';
import type { InventoryItem } from '../types.js';

// ============================================================================
// 工厂函数
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
    modifyHealth: vi.fn().mockResolvedValue({ previous: 80, current: 100, max: 100 }),
    modifyMana: vi.fn().mockResolvedValue({ previous: 30, current: 50, max: 50 }),
    modifyStamina: vi.fn().mockResolvedValue({ previous: 80, current: 100, max: 100 }),
    modifyCurrency: vi.fn().mockResolvedValue({ previous: 100, current: 90, max: 999999 }),
  } as any;
}

function createNpcServiceMock(resolveResult: string = 'npc-001') {
  return {
    resolveNpcId: vi.fn().mockResolvedValue(resolveResult),
    getNpcResources: vi.fn().mockResolvedValue({
      currentHp: 50, currentMp: 30, currentStamina: 100, currency: { gold: 50 },
    }),
    modifyNpcResource: vi.fn().mockResolvedValue({ previous: 50, current: 70, max: 100 }),
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
  findEquippedBySlotResult?: InventoryItem | null;
  findByNameAndSaveIdAndOwnerResult?: InventoryItem;
}

function createInventoryRepoMock(config: RepoMockConfig = {}) {
  const defaultItem = createInventoryItem();
  // 注意：使用 in 操作符判断属性是否存在，支持 null 值（findByIdResult 可能故意为 null）
  const hasFindById = 'findByIdResult' in config;
  const hasFindByName = 'findByNameAndSaveIdAndOwnerResult' in config;
  return {
    findBySaveId: vi.fn().mockResolvedValue(config.items ?? [defaultItem]),
    findById: vi.fn().mockResolvedValue(hasFindById ? config.findByIdResult : defaultItem),
    findBySaveIdAndItemId: vi.fn().mockResolvedValue(null),
    findBySaveIdAndOwner: vi.fn().mockResolvedValue(config.items ?? [defaultItem]),
    findBySaveIdAndOwnerType: vi.fn().mockResolvedValue(config.items ?? [defaultItem]),
    findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(hasFindByName ? config.findByNameAndSaveIdAndOwnerResult : defaultItem),
    findEquippedBySaveIdAndOwner: vi.fn().mockResolvedValue(config.findEquippedByOwnerResult ?? []),
    findEquippedBySaveId: vi.fn().mockResolvedValue(config.findEquippedBySaveIdResult ?? []),
    findAllByNameAndSaveId: vi.fn().mockResolvedValue(config.findAllByNameResult ?? []),
    findEquippedBySlot: vi.fn().mockResolvedValue(config.findEquippedBySlotResult ?? null),
    findOccupiedSlots: vi.fn().mockResolvedValue([]),
    findStackableItem: vi.fn().mockResolvedValue(null),
    findNextAvailableSlot: vi.fn().mockResolvedValue(1),
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

describe('Inventory 系统方法说明扩展合规测试', () => {

  // ==========================================================================
  // 一、equip_item NPC 派生属性重算（文档 2.2 equip_item 特殊行为）
  // ==========================================================================
  describe('一、equip_item NPC 派生属性重算', () => {

    it('1.1 NPC 装备物品 → 调用 recalculateNpcAttributes（非 recalculateDerivedAttributes）', async () => {
      const item = createInventoryItem({
        id: 'npc-weapon-1',
        name: '哥布林大剑',
        category: 'weapon',
        equipped: false,
        ownerType: 'npc',
        ownerId: 'npc-001',
      });
      const { service, numericalService } = createService({
        findByIdResult: item,
        findEquippedBySlotResult: null,
      });

      const result = await service.equipItem('save-1', 'npc-weapon-1', undefined, 'npc', 'npc-001');

      expect(result.success).toBe(true);
      expect(numericalService.recalculateNpcAttributes).toHaveBeenCalledWith(
        'save-1', 'npc-001', expect.anything(),
      );
      expect(numericalService.recalculateDerivedAttributes).not.toHaveBeenCalled();
    });

    it('1.2 character 装备物品 → 调用 recalculateDerivedAttributes', async () => {
      const item = createInventoryItem({
        id: 'char-weapon-1',
        name: '长剑',
        category: 'weapon',
        equipped: false,
        ownerType: 'character',
        ownerId: 'char-1',
      });
      const { service, numericalService } = createService({
        findByIdResult: item,
        findEquippedBySlotResult: null,
      });

      const result = await service.equipItem('save-1', 'char-weapon-1');

      expect(result.success).toBe(true);
      expect(numericalService.recalculateDerivedAttributes).toHaveBeenCalledWith('save-1', expect.anything());
      expect(numericalService.recalculateNpcAttributes).not.toHaveBeenCalled();
    });

    it('1.3 equip_item update 携带 owner_type/owner_id 到 patch（供 EntityGraph 构建）', async () => {
      const item = createInventoryItem({
        id: 'npc-weapon-1',
        name: '哥布林大剑',
        category: 'weapon',
        ownerType: 'npc',
        ownerId: 'npc-001',
      });
      const { service, inventoryRepo } = createService({
        findByIdResult: item,
        findEquippedBySlotResult: null,
      });

      await service.equipItem('save-1', 'npc-weapon-1', undefined, 'npc', 'npc-001');

      // update 应携带 owner 归属
      expect(inventoryRepo.update).toHaveBeenCalledWith(
        'npc-weapon-1',
        expect.objectContaining({
          ownerType: 'npc',
          ownerId: 'npc-001',
          equipped: true,
          equippedSlot: 'weapon',
        }),
        expect.anything(),
      );
    });

    it('1.4 equip_item 替换已装备物品 → 旧物品 update 也携带 owner 归属', async () => {
      const newItem = createInventoryItem({
        id: 'new-weapon',
        name: '新大剑',
        category: 'weapon',
        ownerType: 'npc',
        ownerId: 'npc-001',
      });
      const oldEquipped = createInventoryItem({
        id: 'old-weapon',
        name: '旧大剑',
        category: 'weapon',
        equipped: true,
        equippedSlot: 'weapon',
        ownerType: 'npc',
        ownerId: 'npc-001',
      });
      const { service, inventoryRepo } = createService({
        findByIdResult: newItem,
        findEquippedBySlotResult: oldEquipped,
      });

      await service.equipItem('save-1', 'new-weapon', undefined, 'npc', 'npc-001');

      // 旧物品的 update（卸下）也应携带 owner 归属
      const oldUpdateCall = inventoryRepo.update.mock.calls.find(
        (call: any[]) => call[0] === 'old-weapon'
      );
      expect(oldUpdateCall).toBeDefined();
      expect(oldUpdateCall![1]).toEqual(expect.objectContaining({
        ownerType: 'npc',
        ownerId: 'npc-001',
        equipped: false,
        equippedSlot: null,
      }));
    });
  });

  // ==========================================================================
  // 二、equip_item ownerType/ownerId 禁止 fallback character（审查 P1 / 13.3）
  // 审查发现: InventoryService.ts:946, 950
  //   const finalOwnerType = resolvedOwnerType || item.ownerType || 'character';
  //   let resolvedOwnerId = item.ownerId || '';
  // ==========================================================================
  describe('二、equip_item ownerType/ownerId 禁止 fallback（13.3）', () => {

    it('2.1 item.ownerType 缺失 → 不应 fallback 到 "character"（应暴露数据问题）', async () => {
      // 场景：数据库返回的 item 缺失 ownerType（数据不完整）
      const brokenItem = createInventoryItem({
        id: 'broken-item-1',
        name: '损坏的物品',
        category: 'weapon',
        ownerType: undefined as any,  // 故意缺失
        ownerId: undefined as any,    // 故意缺失
      });
      const { service, numericalService } = createService({
        findByIdResult: brokenItem,
        findEquippedBySlotResult: null,
      });

      // 13.3 第1条：归属缺失即抛错，禁止 fallback 到 'character'
      // 期望：抛错（暴露数据问题），不应静默 fallback 到 character
      // 实际：代码会 fallback 到 character，调用 recalculateDerivedAttributes
      let fallbackOccurred = false;
      try {
        await service.equipItem('save-1', 'broken-item-1');
        // 如果没抛错，检查是否走了 character 分支
        if (numericalService.recalculateDerivedAttributes.mock.calls.length > 0) {
          fallbackOccurred = true;
        }
      } catch (e) {
        // 抛错是正确的行为
      }

      // 期望：不应该 fallback 到 character
      expect(fallbackOccurred).toBe(false);
    });

    it('2.2 NPC item ownerId 缺失 → 应抛错（不应 fallback 到空字符串）', async () => {
      const brokenNpcItem = createInventoryItem({
        id: 'broken-npc-item',
        name: 'NPC 损坏物品',
        category: 'weapon',
        ownerType: 'npc',
        ownerId: '',  // 故意缺失
      });
      const { service } = createService({
        findByIdResult: brokenNpcItem,
        findEquippedBySlotResult: null,
      });

      // 13.3：NPC owner_id 缺失应抛错
      // 代码 L980 已有 if (!resolvedOwnerId) throw new Error('NPC item missing owner_id')
      // 但 L950 let resolvedOwnerId = item.ownerId || '' 会先 fallback 到 ''
      // 所以最终会抛错（被 L980 拦截）
      await expect(
        service.equipItem('save-1', 'broken-npc-item', undefined, 'npc'),
      ).rejects.toThrow(/owner_id|ownerId/i);
    });
  });

  // ==========================================================================
  // 三、unequip_item 使用 item.ownerType 判断分支（文档 2.2 unequip_item）
  // ==========================================================================
  describe('三、unequip_item 使用 item.ownerType 判断分支', () => {

    it('3.1 unequip NPC 物品 → update 携带 owner 归属', async () => {
      const item = createInventoryItem({
        id: 'npc-weapon-1',
        equipped: true,
        equippedSlot: 'weapon',
        ownerType: 'npc',
        ownerId: 'npc-001',
      });
      const { service, inventoryRepo } = createService({ findByIdResult: item });

      await service.unequipItem('save-1', 'npc-weapon-1', 'npc', 'npc-001');

      expect(inventoryRepo.update).toHaveBeenCalledWith(
        'npc-weapon-1',
        expect.objectContaining({
          ownerType: 'npc',
          ownerId: 'npc-001',
          equipped: false,
          equippedSlot: null,
        }),
        expect.anything(),
      );
    });

    it('3.2 unequip character 物品 → update 携带 owner 归属', async () => {
      const item = createInventoryItem({
        id: 'char-weapon-1',
        equipped: true,
        equippedSlot: 'weapon',
        ownerType: 'character',
        ownerId: 'char-1',
      });
      const { service, inventoryRepo } = createService({ findByIdResult: item });

      await service.unequipItem('save-1', 'char-weapon-1');

      expect(inventoryRepo.update).toHaveBeenCalledWith(
        'char-weapon-1',
        expect.objectContaining({
          ownerType: 'character',
          ownerId: 'char-1',
          equipped: false,
          equippedSlot: null,
        }),
        expect.anything(),
      );
    });
  });

  // ==========================================================================
  // 四、use_item 效果类型覆盖（文档 2.2 use_item 效果类型）
  // heal / mana_restore / damage 三种效果
  // ==========================================================================
  describe('四、use_item 效果类型覆盖', () => {

    it('4.1 use_item NPC damage 效果 → 调用 npcService.modifyNpcResource(saveId, npcId, "hp", -value)', async () => {
      const item = createInventoryItem({
        ownerType: 'npc',
        ownerId: 'npc-001',
        effects: [{ type: 'damage', value: 15 }],
      });
      const npcService = createNpcServiceMock('npc-001');
      const { service, npcService: npcSvc } = createService(
        { findByIdResult: item },
        { npcService },
      );

      await service.useItem('save-1', 'item-1', 'npc', 'npc-001');

      // damage 对 NPC 应调用 modifyNpcResource('hp', -15)
      expect(npcSvc.modifyNpcResource).toHaveBeenCalledWith(
        'save-1', 'npc-001', 'hp', -15, expect.anything(),
      );
    });

    it('4.2 use_item character damage 效果 → 调用 characterService.modifyHealth(saveId, -value)', async () => {
      const item = createInventoryItem({
        ownerType: 'character',
        ownerId: 'char-1',
        effects: [{ type: 'damage', value: 15 }],
      });
      const { service, characterService } = createService({ findByIdResult: item });

      await service.useItem('save-1', 'item-1');

      expect(characterService.modifyHealth).toHaveBeenCalledWith('save-1', -15, expect.anything());
    });

    it('4.3 use_item character mana_restore 效果 → 调用 characterService.modifyMana', async () => {
      const item = createInventoryItem({
        ownerType: 'character',
        ownerId: 'char-1',
        effects: [{ type: 'mana_restore', value: 15 }],
      });
      const { service, characterService } = createService({ findByIdResult: item });

      await service.useItem('save-1', 'item-1');

      expect(characterService.modifyMana).toHaveBeenCalledWith('save-1', 15, expect.anything());
    });
  });

  // ==========================================================================
  // 五、trade_items NPC 金币从 NPC 自身扣除（文档 Q4）
  // ==========================================================================
  describe('五、trade_items NPC 金币从 NPC 自身扣除', () => {

    it('5.1 NPC 卖出物品 → 金币加到 NPC 自身（modifyNpcResource currency）', async () => {
      const item = createInventoryItem({
        ownerType: 'npc',
        ownerId: 'npc-001',
        value: { sell: 30 },
      });
      const { service, npcService, characterService } = createService({
        findByIdResult: item,
        items: [item],
      });

      await service.tradeItems('save-1', {
        sellItems: [{ inventoryId: 'item-1', quantity: 1 }],
        buyItems: [],
        goldDelta: 30,
        ownerType: 'npc',
        ownerId: 'npc-001',
      });

      // 金币修改应调用 npcService.modifyNpcResource('currency', 30)
      expect(npcService.modifyNpcResource).toHaveBeenCalledWith(
        'save-1', 'npc-001', 'currency', 30, expect.anything(),
      );
      // 不应调用 character 的 modifyCurrency
      expect(characterService.modifyCurrency).not.toHaveBeenCalled();
    });

    it('5.2 NPC 买入物品 → 金币从 NPC 自身扣除（modifyNpcResource currency 负值）', async () => {
      const sellItem = createInventoryItem({
        ownerType: 'npc',
        ownerId: 'npc-001',
        value: { sell: 100 },
      });
      const { service, npcService, characterService } = createService({
        findByIdResult: sellItem,
        items: [sellItem],
      });

      await service.tradeItems('save-1', {
        sellItems: [{ inventoryId: 'item-1', quantity: 1 }],
        buyItems: [],
        goldDelta: -50,  // 买入花费
        ownerType: 'npc',
        ownerId: 'npc-001',
      });

      expect(npcService.modifyNpcResource).toHaveBeenCalledWith(
        'save-1', 'npc-001', 'currency', -50, expect.anything(),
      );
      expect(characterService.modifyCurrency).not.toHaveBeenCalled();
    });

    it('5.3 NPC 金币不足 → 返回失败（不 fallback 到 character 金币）', async () => {
      const item = createInventoryItem({
        ownerType: 'npc',
        ownerId: 'npc-001',
        value: { sell: 10 },
      });
      const npcService = createNpcServiceMock('npc-001');
      // NPC 金币只有 5，但需要花费 50
      npcService.getNpcResources = vi.fn().mockResolvedValue({
        currentHp: 50, currentMp: 30, currentStamina: 100, currency: { gold: 5 },
      });
      const { service, characterService } = createService(
        { findByIdResult: item, items: [item] },
        { npcService },
      );

      const result = await service.tradeItems('save-1', {
        sellItems: [],
        buyItems: [],
        goldDelta: -50,
        ownerType: 'npc',
        ownerId: 'npc-001',
      });

      // 金币不足应返回失败
      expect(result.success).toBe(false);
      // 不应 fallback 到 character 的 modifyCurrency
      expect(characterService.modifyCurrency).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 六、trade_items 金币查询按 ownerType 分支（文档 4.4）
  // ==========================================================================
  describe('六、trade_items 金币查询按 ownerType 分支', () => {

    it('6.1 character 交易 → 金币查询用 characterService.getCharacterBasicInfo', async () => {
      const item = createInventoryItem({
        ownerType: 'character',
        ownerId: 'char-1',
        value: { sell: 10 },
      });
      const { service, characterService, npcService } = createService({
        findByIdResult: item,
        items: [item],
      });

      await service.tradeItems('save-1', {
        sellItems: [{ inventoryId: 'item-1', quantity: 1 }],
        buyItems: [],
        goldDelta: 10,
      });

      expect(characterService.getCharacterBasicInfo).toHaveBeenCalledWith('save-1', expect.anything());
      expect(npcService.getNpcResources).not.toHaveBeenCalled();
    });

    it('6.2 NPC 交易 → 金币查询用 npcService.getNpcResources', async () => {
      const item = createInventoryItem({
        ownerType: 'npc',
        ownerId: 'npc-001',
        value: { sell: 10 },
      });
      const { service, npcService } = createService({
        findByIdResult: item,
        items: [item],
      });

      await service.tradeItems('save-1', {
        sellItems: [{ inventoryId: 'item-1', quantity: 1 }],
        buyItems: [],
        goldDelta: 10,
        ownerType: 'npc',
        ownerId: 'npc-001',
      });

      expect(npcService.getNpcResources).toHaveBeenCalledWith('save-1', 'npc-001', expect.anything());
      // 不应查询 character 的金币（除非用于其他目的）
      // 注意：characterService.getCharacterBasicInfo 可能被 resolveOwnerId 调用，但不应被用于金币查询
    });
  });

  // ==========================================================================
  // 七、remove_item 归属校验（文档 2.2 remove_item 注意事项）
  // ==========================================================================
  describe('七、remove_item 归属校验', () => {

    it('7.1 remove_item character 物品时传 character owner → 通过校验', async () => {
      const item = createInventoryItem({
        ownerType: 'character',
        ownerId: 'char-1',
      });
      const { service, inventoryRepo } = createService({ findByIdResult: item });

      await service.removeItem('save-1', 'item-1', undefined, undefined, 'character', 'char-1');

      // delete 应被调用
      expect(inventoryRepo.delete).toHaveBeenCalled();
    });

    it('7.2 remove_item NPC 物品时传 NPC owner → 通过校验', async () => {
      const item = createInventoryItem({
        ownerType: 'npc',
        ownerId: 'npc-001',
      });
      const npcService = createNpcServiceMock('npc-001');
      const { service, inventoryRepo } = createService(
        { findByIdResult: item },
        { npcService },
      );

      await service.removeItem('save-1', 'item-1', undefined, undefined, 'npc', 'npc-001');

      expect(inventoryRepo.delete).toHaveBeenCalled();
    });

    it('7.3 remove_item 归属不匹配 → 抛错（不删除）', async () => {
      const item = createInventoryItem({
        ownerType: 'npc',
        ownerId: 'npc-001',
      });
      const { service, inventoryRepo } = createService({ findByIdResult: item });

      // item 属于 npc-001，但传入 character 校验
      await expect(
        service.removeItem('save-1', 'item-1', undefined, undefined, 'character', 'char-1'),
      ).rejects.toThrow(/does not belong to/);

      // 不应执行删除
      expect(inventoryRepo.delete).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 八、通配符查询返回类型规则（文档 5.2）
  // ==========================================================================
  describe('八、通配符查询返回类型规则', () => {

    it('8.1 get_item 通配 + 同名物品被多个 owner 持有 → 返回数组包含所有匹配记录', async () => {
      const items = [
        createInventoryItem({ id: 'item-1', name: '治疗药水', ownerType: 'character', ownerId: 'char-1' }),
        createInventoryItem({ id: 'item-2', name: '治疗药水', ownerType: 'npc', ownerId: 'npc-001' }),
        createInventoryItem({ id: 'item-3', name: '治疗药水', ownerType: 'npc', ownerId: 'npc-002' }),
      ];
      const { service, inventoryRepo } = createService({
        findAllByNameResult: items,
        findByIdResult: null,  // 按 ID 查不到，走名称查询路径
      });

      const result = await service.getItem('save-1', '治疗药水');

      expect(inventoryRepo.findAllByNameAndSaveId).toHaveBeenCalledWith('save-1', '治疗药水');
      expect(Array.isArray(result)).toBe(true);
      expect(result as InventoryItem[]).toHaveLength(3);
    });

    it('8.2 get_item 精确 owner → 返回单个对象', async () => {
      const item = createInventoryItem({
        id: 'item-1',
        name: '治疗药水',
        ownerType: 'character',
        ownerId: 'char-1',
      });
      const { service } = createService({ findByIdResult: item });

      const result = await service.getItem('save-1', 'item-1', 'character', 'char-1');

      // 精确 owner 查询返回单个对象
      expect(Array.isArray(result)).toBe(false);
    });

    it('8.3 list_inventory 始终返回 { items: [] } 结构', async () => {
      const { service } = createService({
        items: [createInventoryItem({ ownerType: 'character' })],
      });

      const result = await service.listInventory('save-1');

      expect(result).toHaveProperty('items');
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('8.4 get_equipment 始终返回 { equipment: [] } 结构', async () => {
      const { service } = createService({
        findEquippedBySaveIdResult: [createInventoryItem({ equipped: true })],
      });

      const result = await service.getEquipment('save-1');

      expect(result).toHaveProperty('equipment');
      expect(Array.isArray(result.equipment)).toBe(true);
    });
  });
});
