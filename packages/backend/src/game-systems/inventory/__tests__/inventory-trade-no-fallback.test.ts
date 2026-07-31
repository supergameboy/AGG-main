/**
 * 铁律修复测试：trade_items 删除 fallback 创建 misc 占位物品
 *
 * 偏差背景：
 * - InventoryService.tradeItems L1146-1162 处理买入物品时
 * - 先尝试 addItemFromPool，catch 失败后 addItem 创建 category='misc' 占位物品
 * - 违反「禁止 fallback 掩盖主逻辑缺陷」铁律
 * - 掩盖了「物品ID 不存在」的真实错误
 *
 * 修复方案：删除 catch fallback，让 addItemFromPool 失败时直接 throw 明确错误
 *
 * 测试场景：
 * - T1: buyItems 物品存在时正常交易（回归保护）
 * - T2: buyItems 物品不存在时抛明确错误，不创建 misc 占位物品
 * - T3: 验证 addItem 不被以 category='misc' 调用（fallback 已删除）
 */
import { describe, it, expect, vi } from 'vitest';
import { InventoryService } from '../InventoryService.js';
import type { InventoryItem } from '../types.js';

function createRuleParserStub() {
  return {
    getInventoryRules: () => ({
      max_slots: 20,
      stack_sizes: {},
      equipment_slots: [],
    }),
  } as any;
}

function createInventoryRepoMock(sellItem?: InventoryItem) {
  return {
    findById: vi.fn().mockResolvedValue(sellItem ?? null),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    insert: vi.fn().mockResolvedValue(undefined),
    findStackableItem: vi.fn().mockResolvedValue(null),
    findNextAvailableSlot: vi.fn().mockResolvedValue(1),
    findBySaveId: vi.fn().mockResolvedValue([]),
  } as any;
}

function createCharacterServiceMock(gold: number = 1000) {
  return {
    getCharacterBasicInfo: vi.fn().mockResolvedValue({
      characterId: 'char-1',
      currency: { gold },
    }),
    modifyCurrency: vi.fn().mockResolvedValue({ newBalance: gold }),
  } as any;
}

function createTxManagerMock() {
  // 事务直接执行 callback，传入 mock trx
  return {
    transaction: vi.fn(async (cb: (trx: any) => Promise<any>) => cb({} as any)),
  } as any;
}

function createService(overrides: {
  sellItem?: InventoryItem;
  addItemFromPoolImpl?: (saveId: any, itemId: string, quantity: number) => Promise<InventoryItem>;
  characterGold?: number;
} = {}) {
  const inventoryRepo = createInventoryRepoMock(overrides.sellItem);
  const characterService = createCharacterServiceMock(overrides.characterGold);
  const service = new InventoryService(
    inventoryRepo,
    {} as any,
    characterService,
    {} as any,
    {} as any,
    createTxManagerMock(),
    createRuleParserStub(),
    null,
  );

  // spy/override addItemFromPool（tradeItems 内部调用此方法）
  // 默认实现：找不到物品时抛错（修复后行为）
  if (overrides.addItemFromPoolImpl) {
    service.addItemFromPool = overrides.addItemFromPoolImpl as any;
  } else {
    // 默认 mock：传入 'potion-1' 成功，其他抛错
    service.addItemFromPool = vi.fn(async (_saveId, itemId: string) => {
      if (itemId === 'potion-1') {
        return {
          id: 'inv-1', saveId: 'save-1', itemId: 'potion-1', poolId: '',
          name: '治疗药水', description: '', category: 'consumable',
          quantity: 1, quality: 'common', durability: 10, maxDurability: 100,
          inventorySlot: 1, equippedSlot: null, equipped: false, equippedIndex: null, weight: 1,
          maxStack: 99, stats: {}, effects: [], value: {}, tags: [], customData: {},
          ownerType: 'character', ownerId: 'char-1', visible: true, createdAt: 1, updatedAt: 1,
        } as InventoryItem;
      }
      throw new Error(`物品池无匹配物品: ${itemId}`);
    }) as any;
  }

  // spy addItem（验证不被以 misc 调用）
  const addItemSpy = vi.fn(async () => {
    throw new Error('addItem 不应被调用（fallback 已删除）');
  });
  (service as any).addItem = addItemSpy;

  return { service, inventoryRepo, characterService, addItemSpy };
}

describe('铁律修复：trade_items 删除 fallback 创建 misc', () => {
  const SELL_ITEM: InventoryItem = {
    id: 'inv-sell-1', saveId: 'save-1', itemId: 'sword-1', poolId: '',
    name: '铁剑', description: '', category: 'weapon',
    quantity: 5, quality: 'common', durability: 100, maxDurability: 100,
    inventorySlot: 1, equippedSlot: null, equipped: false, equippedIndex: null, weight: 5,
    maxStack: 1, stats: {}, effects: [], value: { sell: 50, buy: 100 }, tags: [], customData: {},
    ownerType: 'character', ownerId: 'char-1', visible: true, createdAt: 1, updatedAt: 1,
  };

  describe('T1: buyItems 物品存在时正常交易（回归保护）', () => {
    it('所有 buyItem 都在物品池中 → 正常完成交易', async () => {
      const { service } = createService({ sellItem: SELL_ITEM });

      const result = await service.tradeItems('save-1', {
        sellItems: [{ inventoryId: 'inv-sell-1', quantity: 2 }],
        buyItems: [{ inventoryId: 'potion-1', quantity: 3 }],
        goldDelta: -30,
        ownerType: 'character',
        ownerId: 'char-1',
      });

      expect(result.success).toBe(true);
      expect(result.sold.length).toBe(1);
      expect(result.bought.length).toBe(1);
      expect(result.bought[0].name).toBe('治疗药水');
    });
  });

  describe('T2: buyItems 物品不存在时抛明确错误', () => {
    it('buyItem 不在物品池 → throw 错误，错误信息含物品ID', async () => {
      const { service, addItemSpy } = createService({ sellItem: SELL_ITEM });

      await expect(
        service.tradeItems('save-1', {
          sellItems: [{ inventoryId: 'inv-sell-1', quantity: 2 }],
          buyItems: [{ inventoryId: 'not-exist-item', quantity: 1 }],
          goldDelta: 100,
          ownerType: 'character',
          ownerId: 'char-1',
        })
      ).rejects.toThrow(/not-exist-item|物品池无匹配/);

      // 验证：addItem 没被调用（fallback 已删除）
      expect(addItemSpy).not.toHaveBeenCalled();
    });
  });

  describe('T3: 验证 fallback 创建 misc 已删除', () => {
    it('addItem 不被以 category=misc 调用', async () => {
      const { service, addItemSpy } = createService({ sellItem: SELL_ITEM });

      await expect(
        service.tradeItems('save-1', {
          sellItems: [{ inventoryId: 'inv-sell-1', quantity: 1 }],
          buyItems: [{ inventoryId: 'unknown-item', quantity: 1 }],
          goldDelta: 0,
          ownerType: 'character',
          ownerId: 'char-1',
        })
      ).rejects.toThrow();

      // 关键断言：addItem 不应被调用（修复前会被以 category='misc' 调用创建占位物品）
      expect(addItemSpy).not.toHaveBeenCalled();
    });

    it('多个 buyItem 中部分不存在 → 第一个不存在的立即抛错', async () => {
      const { service, addItemSpy } = createService({ sellItem: SELL_ITEM });

      await expect(
        service.tradeItems('save-1', {
          sellItems: [{ inventoryId: 'inv-sell-1', quantity: 1 }],
          buyItems: [
            { inventoryId: 'potion-1', quantity: 1 },        // 存在
            { inventoryId: 'unknown-1', quantity: 1 },        // 不存在 → 抛错
            { inventoryId: 'potion-1', quantity: 1 },        // 不会执行到这
          ],
          goldDelta: 0,
          ownerType: 'character',
          ownerId: 'char-1',
        })
      ).rejects.toThrow(/unknown-1|物品池无匹配/);

      // addItem 不被调用
      expect(addItemSpy).not.toHaveBeenCalled();
    });
  });
});
