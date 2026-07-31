import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { InventoryServiceTool } from '../InventoryServiceTool.js';
import type { ToolContext, IRequestScope } from '@ai-rpg/shared/types/tool';
import type { ID } from '@ai-rpg/shared';

/**
 * P0-1 端到端测试（InventoryServiceTool 层）。
 *
 * 覆盖 add_item_from_pool 和 equip_item 的 batch 配置端到端路径。
 * 修复前：两个方法都是单点，LLM 必须为每个 NPC 单独调用（npc_party iter 11 调 5 次）
 * 修复后：两个方法都配置了 batch，LLM 一次传入 items 数组即可
 *
 * 4 场景：
 * - T1 add_item_from_pool 批量：LLM 传 {items: [...]} → handler 多次调用
 * - T2 equip_item 批量：LLM 传 {items: [...]} → handler 多次调用
 * - T3 空数组边界
 * - T4 回归：batch 配置存在
 */

const SAVE_ID = 'save-inv-batch-tool' as ID;

describe('InventoryServiceTool — P0-1 batch 端到端', () => {
  let tool: InventoryServiceTool;
  let db: Knex;
  let mockRequestScope: IRequestScope;
  let mockService: {
    addItemFromPool: ReturnType<typeof vi.fn>;
    equipItem: ReturnType<typeof vi.fn>;
  };

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });

    tool = new InventoryServiceTool(
      { createCharacterService: vi.fn() } as unknown as ConstructorParameters<typeof InventoryServiceTool>[0],
      null,
    );

    mockService = {
      addItemFromPool: vi.fn().mockResolvedValue({ id: 'item-1', name: '治疗药水' }),
      equipItem: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    };

    // override createInventoryService（避免触发 buildInventoryService 链路）
    (tool as unknown as { createInventoryService: () => Promise<typeof mockService> }).createInventoryService =
      vi.fn().mockResolvedValue(mockService);

    tool.setPermission({
      toolType: 'inventory_service' as const,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });

    mockRequestScope = {
      getDb: vi.fn().mockReturnValue(db),
      getOrCompute: vi.fn(<T>(_key: string, factory: () => Promise<T>) => factory()),
    };
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    mockService.addItemFromPool.mockClear();
    mockService.equipItem.mockClear();
  });

  const buildContext = (): ToolContext => ({
    saveId: SAVE_ID,
    agentType: 'gamemaster',
    timestamp: Date.now(),
    requestScope: mockRequestScope,
  });

  it('T1: add_item_from_pool 批量调用 — handler 多次调用 service.addItemFromPool', async () => {
    const items = [
      { name: '治疗药水', quantity: 3, ownerType: 'npc', ownerId: '村长' },
      { name: '治疗药水', quantity: 2, ownerType: 'npc', ownerId: '铁匠' },
      { name: '魔力药水', quantity: 1, ownerType: 'npc', ownerId: '店主' },
    ];

    const response = await tool.execute('add_item_from_pool', { items }, buildContext());

    expect(response.success).toBe(true);
    // handler 应被调用 3 次（BaseTool.executeBatch 循环）
    expect(mockService.addItemFromPool).toHaveBeenCalledTimes(3);
    // 第一次调用应收到第一个 item 的字段（BaseTool.buildSingleParams 展开到顶层）
    const [firstCall] = mockService.addItemFromPool.mock.calls[0];
    expect(firstCall).toBe(SAVE_ID);
    const [, name, qty, ownerType, ownerId] = mockService.addItemFromPool.mock.calls[0];
    expect(name).toBe('治疗药水');
    expect(qty).toBe(3);
    expect(ownerType).toBe('npc');
    expect(ownerId).toBe('村长');
  });

  it('T2: equip_item 批量调用 — handler 多次调用 service.equipItem', async () => {
    const items = [
      { inventoryId: 'item-1', targetSlot: 'weapon', ownerType: 'npc' },
      { inventoryId: 'item-2', targetSlot: 'armor', ownerType: 'npc' },
    ];

    const response = await tool.execute('equip_item', { items }, buildContext());

    expect(response.success).toBe(true);
    expect(mockService.equipItem).toHaveBeenCalledTimes(2);
    // 验证 BaseTool 展开了 item 字段到顶层
    const [saveId, inventoryId, targetSlot, ownerType] = mockService.equipItem.mock.calls[0];
    expect(saveId).toBe(SAVE_ID);
    expect(inventoryId).toBe('item-1');
    expect(targetSlot).toBe('weapon');
    expect(ownerType).toBe('npc');
  });

  it('T3: 空数组边界 — 返回失败但不抛错', async () => {
    const response = await tool.execute('add_item_from_pool', { items: [] }, buildContext());

    expect(response.success).toBe(false);
    expect(response.error).toContain('非空数组');
    expect(mockService.addItemFromPool).not.toHaveBeenCalled();
  });

  it('T4 回归: add_item_from_pool 和 equip_item 都配置了 batch', () => {
    const addMethod = (tool as unknown as { getMethodDefinition: (n: string) => { batch?: { param: string } } })
      .getMethodDefinition('add_item_from_pool');
    const equipMethod = (tool as unknown as { getMethodDefinition: (n: string) => { batch?: { param: string } } })
      .getMethodDefinition('equip_item');

    expect(addMethod?.batch?.param).toBe('items');
    expect(equipMethod?.batch?.param).toBe('items');
  });
});
