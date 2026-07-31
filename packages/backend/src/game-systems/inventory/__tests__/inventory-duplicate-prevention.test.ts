/**
 * InventoryService 去重防护测试（addItem 堆叠合并 + addPoolItem 去重）
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md §3
 *
 * 期望效果：
 * 1. addItem 堆叠合并（设计文档 §3 addItem 矩阵）：
 *    - 同 saveId+itemId+owner 已存在 → 增量合并 quantity + 返回 alreadyExists=true + warnings
 *    - warnings 格式："物品 'xxx' 已存在，quantity: 1 → 3（增量合并 +2）"
 *    - maxStack 不足 → 部分堆叠 + 部分新建，warnings 明确告知堆叠量 + 新建量
 *    - 不同 owner → 不算重复（无 alreadyExists）
 *
 * 2. addPoolItem 去重防护（设计文档 §3 矩阵 #3）：
 *    - 同 saveId+name 已存在 → 增量更新非黑名单字段 + alreadyExists=true + warnings
 *    - 黑名单字段：id、saveId、itemId、createdAt
 */
import { describe, it, expect, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';
import type { InventoryItem, ItemPoolEntry } from '../types.js';

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
      weight_system: false, // 关闭负重系统避免 mock 复杂
    }),
  } as any;
}

function createExistingInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'inv_木制法杖_1',
    saveId: 'save-001',
    itemId: 'item_木制法杖',
    poolId: '',
    name: '木制法杖',
    description: '一把简单的木制法杖',
    category: 'weapon',
    quantity: 1,
    quality: 'common',
    durability: 100,
    maxDurability: 100,
    inventorySlot: 1,
    equippedSlot: null,
    equipped: false,
    weight: 1,
    maxStack: 99,
    stats: {},
    effects: [],
    value: {},
    tags: [],
    customData: {},
    ownerType: 'character',
    ownerId: 'char_1',
    visible: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as InventoryItem;
}

function createExistingPoolItem(overrides: Partial<ItemPoolEntry> = {}): ItemPoolEntry {
  return {
    id: 'pool_木制法杖_1',
    saveId: 'save-001',
    name: '木制法杖',
    description: '一把简单的木制法杖',
    category: 'weapon',
    quality: 'common',
    stats: { attack: 5 },
    effects: [],
    value: { gold: 10 },
    tags: [],
    weight: 1,
    maxStack: 99,
    equippedSlot: null,
    durability: 100,
    maxDurability: 100,
    taken: false,
    customData: {},
    recommendedClasses: ['mage'],
    ...overrides,
  } as ItemPoolEntry;
}

function createInventoryRepoMock(existingItem: InventoryItem | null = null) {
  return {
    findStackableItem: vi.fn().mockResolvedValue(existingItem),
    findById: vi.fn().mockResolvedValue(existingItem),
    insert: vi.fn().mockResolvedValue(existingItem),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    findEquippedBySaveIdAndOwner: vi.fn().mockResolvedValue([]),
    findOccupiedSlots: vi.fn().mockResolvedValue([]),
    findBySaveIdAndItemId: vi.fn().mockResolvedValue(null),
    findByNameAndSaveIdAndOwner: vi.fn().mockResolvedValue(null),
    findBySaveId: vi.fn().mockResolvedValue(existingItem ? [existingItem] : []),
  } as any;
}

function createItemPoolRepoMock(existingPool: ItemPoolEntry | null = null) {
  return {
    findBySaveIdAndName: vi.fn().mockResolvedValue(existingPool),
    findById: vi.fn().mockResolvedValue(existingPool),
    insert: vi.fn().mockResolvedValue(existingPool),
    update: vi.fn().mockResolvedValue(undefined),
    findBySaveId: vi.fn().mockResolvedValue(existingPool ? [existingPool] : []),
    delete: vi.fn().mockResolvedValue(true),
  } as any;
}

function createCharacterServiceMock() {
  return {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({ characterId: 'char_1', attributes: { endurance: 10 }, currency: { gold: 0 } }),
  } as any;
}

function createSaveRepoMock() {
  return {
    getTemplateIdBySaveId: vi.fn().mockResolvedValue(null),
  } as any;
}

function createTxManagerMock() {
  const transaction = vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any));
  return { transaction } as any;
}

function createNpcServiceMock() {
  return {
    resolveNpcId: vi.fn().mockImplementation(async (_saveId: string, npcIdOrName: string) => {
      // 测试简化：NPC 名称/ID 直接透传，验证 npc ownerType 路径可达正常创建流程
      return npcIdOrName;
    }),
  } as any;
}

function createInventoryService(
  existingItem: InventoryItem | null = null,
  existingPool: ItemPoolEntry | null = null,
  options: { npcService?: any } = {},
) {
  const inventoryRepo = createInventoryRepoMock(existingItem);
  const itemPoolRepo = createItemPoolRepoMock(existingPool);
  const characterService = createCharacterServiceMock();
  const numericalService = {} as any;
  const saveRepo = createSaveRepoMock();
  const txManager = createTxManagerMock();
  const ruleParser = createRuleParserStub();
  const templatePoolService = null;
  const npcService = options.npcService ?? undefined;

  const service = new InventoryService(
    inventoryRepo,
    itemPoolRepo,
    characterService,
    numericalService,
    saveRepo,
    txManager,
    ruleParser,
    templatePoolService,
    npcService,
  );
  return { service, inventoryRepo, itemPoolRepo, characterService };
}

describe('InventoryService 去重防护', () => {
  describe('addItem 堆叠合并：设计文档 §3 addItem 矩阵', () => {
    it('同 itemId+owner 已存在 → 增量合并 quantity + alreadyExists + warnings 含字段级 diff', async () => {
      const existing = createExistingInventoryItem({ quantity: 1, maxStack: 99 });
      const { service, inventoryRepo } = createInventoryService(existing);

      // addItem 2 个，existing quantity=1, maxStack=99 → 合并后 quantity=3
      const updated = { ...existing, quantity: 3 };
      inventoryRepo.findById.mockResolvedValue(updated);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        itemId: 'item_木制法杖',
        quantity: 2,
        ownerType: 'character',
        ownerId: 'char_1',
        category: 'weapon',
      });

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      // 设计文档格式："物品 '木制法杖' 已存在，quantity: 1 → 3（增量合并 +2）"
      expect(result.warnings!.join(' ')).toContain("物品 '木制法杖' 已存在");
      expect(result.warnings!.join(' ')).toContain('quantity: 1 → 3');
      expect(result.warnings!.join(' ')).toContain('增量合并 +2');
      // 应调用 update 更新 quantity（第 3 个参数 trx 为 undefined，因为 addItem 未传 trx）
      expect(inventoryRepo.update).toHaveBeenCalledWith(
        existing.id,
        expect.objectContaining({ quantity: 3 }),
        undefined,
      );
    });

    it('maxStack 不足 → 部分堆叠 + 部分新建，warnings 明确告知', async () => {
      // existing quantity=8, maxStack=10, addItem 5 → 堆叠 +2 达到 maxStack, 新建 3
      const existing = createExistingInventoryItem({ quantity: 8, maxStack: 10 });
      const { service, inventoryRepo } = createInventoryService(existing);

      const updated = { ...existing, quantity: 10 };
      inventoryRepo.findById.mockResolvedValue(updated);

      // 新建的溢出物品
      const overflowItem = createExistingInventoryItem({
        id: 'inv_木制法杖_2',
        quantity: 3,
      });
      inventoryRepo.insert.mockResolvedValue(overflowItem);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        itemId: 'item_木制法杖',
        quantity: 5,
        ownerType: 'character',
        ownerId: 'char_1',
        category: 'weapon',
        maxStack: 10,
      });

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      const warningsText = result.warnings!.join(' ');
      // 设计文档格式："quantity: 8 → 10（堆叠 +2 达到 maxStack），新建物品 quantity=3"
      expect(warningsText).toContain('quantity: 8 → 10');
      expect(warningsText).toContain('堆叠 +2 达到 maxStack');
      expect(warningsText).toContain('新建物品 quantity=3');
    });

    it('不同 owner → 不算重复，正常创建（无 alreadyExists）', async () => {
      const existing = createExistingInventoryItem({
        ownerType: 'character',
        ownerId: 'char_1',
        quantity: 1,
      });
      const { service, inventoryRepo } = createInventoryService(existing);

      // addItem 给不同的 owner（char_2），不应堆叠
      const newItem = createExistingInventoryItem({
        id: 'inv_木制法杖_2',
        ownerType: 'character',
        ownerId: 'char_2',
        quantity: 2,
      });
      inventoryRepo.findStackableItem.mockResolvedValue(null); // 不同 owner 查不到
      inventoryRepo.insert.mockResolvedValue(newItem);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        itemId: 'item_木制法杖',
        quantity: 2,
        ownerType: 'character',
        ownerId: 'char_2',
        category: 'weapon',
      });

      expect(result.alreadyExists).toBeUndefined();
      expect(inventoryRepo.insert).toHaveBeenCalled();
    });

    it('不存在同 itemId+owner 物品 → 正常创建，无 alreadyExists', async () => {
      const { service, inventoryRepo } = createInventoryService(null);

      const newItem = createExistingInventoryItem({ id: 'inv_new_1', quantity: 1 });
      inventoryRepo.insert.mockResolvedValue(newItem);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '新物品',
        itemId: 'item_new',
        quantity: 1,
        ownerType: 'character',
        ownerId: 'char_1',
        category: 'misc',
      });

      expect(result.alreadyExists).toBeUndefined();
      expect(inventoryRepo.insert).toHaveBeenCalled();
    });
  });

  describe('addItem name 维度去重：设计文档方案 1（同 saveId+name+owner 增量更新）', () => {
    it('同 saveId+name+owner 已存在 → 增量更新非黑名单字段 + alreadyExists + warnings 含字段级 diff', async () => {
      const existing = createExistingInventoryItem({
        description: '旧描述',
        stats: { attack: 5 },
        quality: 'common',
        quantity: 1,
      });
      const { service, inventoryRepo } = createInventoryService(null);
      // 模拟 findByNameAndSaveIdAndOwner 命中已存在物品
      inventoryRepo.findByNameAndSaveIdAndOwner.mockResolvedValue(existing);
      const updated = { ...existing, description: '新描述', stats: { attack: 10 }, quality: 'rare' };
      inventoryRepo.findById.mockResolvedValue(updated);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        description: '新描述',
        stats: { attack: 10 },
        quality: 'rare',
        category: 'weapon',
        ownerType: 'character',
        ownerId: 'char_1',
      });

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain("物品 '木制法杖' 已存在");
      expect(warningsText).toContain('description: 旧描述 → 新描述');
      expect(warningsText).toContain('quality: common → rare');
      // 应调用 update 更新字段（非 insert 创建新物品）
      expect(inventoryRepo.update).toHaveBeenCalled();
      expect(inventoryRepo.insert).not.toHaveBeenCalled();
    });

    it('同 name+owner + quantity 增量（maxStack>1）→ 合并 quantity + warnings 含增量合并提示', async () => {
      const existing = createExistingInventoryItem({
        quantity: 1,
        maxStack: 99,
        equipped: false,
      });
      const { service, inventoryRepo } = createInventoryService(null);
      inventoryRepo.findByNameAndSaveIdAndOwner.mockResolvedValue(existing);
      const updated = { ...existing, quantity: 3 };
      inventoryRepo.findById.mockResolvedValue(updated);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        quantity: 2,
        ownerType: 'character',
        ownerId: 'char_1',
        category: 'weapon',
      });

      expect(result.alreadyExists).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain("物品 '木制法杖' 已存在");
      expect(warningsText).toContain('quantity: 1 → 3');
      expect(warningsText).toContain('增量合并 +2');
    });

    it('同 name+owner + 字段相同 → warnings 提示"无字段变化"', async () => {
      // maxStack=1（装备类）避免 quantity 增量合并遮盖"无字段变化"提示
      const existing = createExistingInventoryItem({
        description: '不变',
        stats: { attack: 5 },
        quality: 'common',
        quantity: 1,
        maxStack: 1,
      });
      const { service, inventoryRepo } = createInventoryService(null);
      inventoryRepo.findByNameAndSaveIdAndOwner.mockResolvedValue(existing);
      inventoryRepo.findById.mockResolvedValue(existing);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        description: '不变',
        stats: { attack: 5 },
        quality: 'common',
        category: 'weapon',
        ownerType: 'character',
        ownerId: 'char_1',
      });

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('无字段变化');
      // 无字段变化时不应调用 update
      expect(inventoryRepo.update).not.toHaveBeenCalled();
    });

    it('同 name+owner + 试图覆盖黑名单字段 itemId → warnings 含 blockedFields 提示', async () => {
      // maxStack=1（装备类）避免 quantity 增量合并遮盖黑名单字段提示
      const existing = createExistingInventoryItem({
        itemId: 'item_木制法杖_original',
        maxStack: 1,
      });
      const { service, inventoryRepo } = createInventoryService(null);
      inventoryRepo.findByNameAndSaveIdAndOwner.mockResolvedValue(existing);
      inventoryRepo.findById.mockResolvedValue(existing);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        itemId: 'custom_id_hack', // 试图覆盖黑名单字段
        category: 'weapon',
        ownerType: 'character',
        ownerId: 'char_1',
      });

      expect(result.alreadyExists).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('黑名单字段');
      expect(warningsText).toContain('itemId');
      expect(warningsText).toContain('custom_id_hack');
      // 黑名单字段应保留原值
      expect(result.itemId).toBe('item_木制法杖_original');
    });

    it('不同 owner → findByNameAndSaveIdAndOwner 返回 null，走正常创建流程', async () => {
      // 注入 NPCService mock：npc ownerType 路径需要 resolveNpcId 解析
      const npcService = createNpcServiceMock();
      const { service, inventoryRepo } = createInventoryService(null, null, { npcService });
      // findByNameAndSaveIdAndOwner 默认返回 null
      const newItem = createExistingInventoryItem({
        id: 'inv_new_1',
        ownerType: 'npc',
        ownerId: 'npc_001',
        quantity: 1,
      });
      inventoryRepo.insert.mockResolvedValue(newItem);

      const result = await service.addItem({
        saveId: 'save-001' as any,
        name: '木制法杖',
        ownerType: 'npc',
        ownerId: 'npc_001',
        category: 'weapon',
      });

      expect(result.alreadyExists).toBeUndefined();
      expect(inventoryRepo.insert).toHaveBeenCalled();
    });
  });

  describe('addPoolItem 去重防护：设计文档 §3 矩阵 #3', () => {
    it('同 saveId+name 已存在 → 增量更新非黑名单字段 + alreadyExists + warnings', async () => {
      const existing = createExistingPoolItem({
        description: '旧描述',
        stats: { attack: 5 },
        quality: 'common',
      });
      const { service, itemPoolRepo } = createInventoryService(null, existing);

      const updated = { ...existing, description: '新描述', stats: { attack: 10 }, quality: 'rare' };
      itemPoolRepo.findById.mockResolvedValue(updated);

      const result = await service.addPoolItem('save-001' as any, {
        saveId: 'save-001' as any,
        name: '木制法杖',
        description: '新描述',
        stats: { attack: 10 },
        quality: 'rare',
        category: 'weapon',
      } as any);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings).toBeDefined();
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain("物品池 '木制法杖' 已存在");
      expect(warningsText).toContain('description: 旧描述 → 新描述');
      expect(warningsText).toContain('quality: common → rare');
    });

    it('增量更新 stats + description + quality 多字段', async () => {
      const existing = createExistingPoolItem({
        description: '旧',
        stats: { attack: 5 },
        quality: 'common',
        weight: 1,
      });
      const { service, itemPoolRepo } = createInventoryService(null, existing);

      const updated = { ...existing, description: '新', stats: { attack: 15 }, quality: 'epic', weight: 2 };
      itemPoolRepo.findById.mockResolvedValue(updated);

      const result = await service.addPoolItem('save-001' as any, {
        saveId: 'save-001' as any,
        name: '木制法杖',
        description: '新',
        stats: { attack: 15 },
        quality: 'epic',
        weight: 2,
        category: 'weapon',
      } as any);

      expect(result.alreadyExists).toBe(true);
      const warningsText = result.warnings!.join(' ');
      expect(warningsText).toContain('description: 旧 → 新');
      expect(warningsText).toContain('quality: common → epic');
      expect(warningsText).toContain('weight: 1 → 2');
    });

    it('无字段变化 → warnings 提示"无字段变化"', async () => {
      const existing = createExistingPoolItem({
        description: '不变',
        stats: { attack: 5 },
        quality: 'common',
      });
      const { service, itemPoolRepo } = createInventoryService(null, existing);

      const updated = { ...existing };
      itemPoolRepo.findById.mockResolvedValue(updated);

      const result = await service.addPoolItem('save-001' as any, {
        saveId: 'save-001' as any,
        name: '木制法杖',
        description: '不变',
        stats: { attack: 5 },
        quality: 'common',
        category: 'weapon',
      } as any);

      expect(result.alreadyExists).toBe(true);
      expect(result.warnings!.join(' ')).toContain('无字段变化');
      // 无字段变化时不应调用 update
      expect(itemPoolRepo.update).not.toHaveBeenCalled();
    });

    it('不存在 → 正常创建流程，无 alreadyExists', async () => {
      const { service, itemPoolRepo } = createInventoryService(null, null);

      const newPoolItem = createExistingPoolItem({ id: 'pool_new_1', name: '新物品' });
      itemPoolRepo.insert.mockResolvedValue(newPoolItem);

      const result = await service.addPoolItem('save-001' as any, {
        saveId: 'save-001' as any,
        name: '新物品',
        description: '全新物品',
        category: 'misc',
      } as any);

      expect(result.alreadyExists).toBeUndefined();
      expect(itemPoolRepo.insert).toHaveBeenCalled();
    });
  });
});
