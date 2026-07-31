import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { NPCServiceTool } from '../NPCServiceTool.js';
import type { ToolContext, IRequestScope } from '@ai-rpg/shared/types/tool';
import type { ID } from '@ai-rpg/shared';
import type { NpcInitStatus, NpcInitUpdate } from '../types.js';

/**
 * P0-1 端到端测试（ServiceTool 层）。
 *
 * v1.2 新增：覆盖 LLM → NPCServiceTool.handleCall（BaseTool.execute）→ handler 路径。
 * v1.1.1 单元测试只覆盖 NPCService.batchMarkInitialized 内部逻辑，未覆盖 BaseTool
 * batch 配置导致的 handler 收不到 params.updates 数组的 BUG。本测试弥补该盲区。
 *
 * 4 场景：
 * - T1 正常批量标记：LLM 传 `{updates: [...]}` → handler 收到完整数组
 * - T2 空数组边界：LLM 传 `{updates: []}` → handler 不抛错
 * - T3 参数缺失错误路径：LLM 传 `{}` → 不抛 `Cannot read properties of undefined`
 * - T4 batch_check_init_status 端到端：验证两个工具设计模式一致
 *
 * Mock 策略：
 * - mock MapServiceTool / CharacterServiceTool 构造参数（不参与调用路径）
 * - override createNPCService 返回 mock NPCService（断言 handler 调用入参）
 * - 不 mock BaseTool.execute（保留端到端调用路径，验证 BaseTool 不拆分数组）
 */

const SAVE_ID = 'save-e2e-tool' as ID;

describe('NPCServiceTool — P0-1 端到端（ServiceTool 层）', () => {
  let tool: NPCServiceTool;
  let db: Knex;
  let mockRequestScope: IRequestScope;
  let mockService: { batchMarkInitialized: ReturnType<typeof vi.fn>; batchCheckInitStatus: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });

    // NPCServiceTool 构造需要 MapServiceTool 和 CharacterServiceTool，
    // 但本测试不通过这两个工具，mock 为最小桩对象即可。
    const mockMapServiceTool = { createMapService: vi.fn() } as unknown as ConstructorParameters<typeof NPCServiceTool>[0];
    const mockCharacterServiceTool = { createCharacterService: vi.fn() } as unknown as ConstructorParameters<typeof NPCServiceTool>[1];

    tool = new NPCServiceTool(mockMapServiceTool, mockCharacterServiceTool);

    // 不注入 templateProvider，因为 createNPCService 被 mock 后不会触发 buildNPCService
    // 但需要避免构造时的依赖问题（NPCServiceTool 构造时不调用 setTemplateService，仅 set 字段为 null）

    mockService = {
      batchMarkInitialized: vi.fn().mockResolvedValue(undefined),
      batchCheckInitStatus: vi.fn().mockResolvedValue([]),
    };

    // override createNPCService（避免触发 buildNPCService 链路）
    // 注：直接覆盖实例方法比修改原型更隔离，不会污染其他测试
    (tool as unknown as { createNPCService: () => Promise<typeof mockService> }).createNPCService =
      vi.fn().mockResolvedValue(mockService);

    // 设置权限：gamemaster 读写皆允许（base-tool.checkPermission 在 execute 入口校验）
    tool.setPermission({
      toolType: 'npc_service' as const,
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
    mockService.batchMarkInitialized.mockClear();
    mockService.batchCheckInitStatus.mockClear();
  });

  const buildContext = (): ToolContext => ({
    saveId: SAVE_ID,
    agentType: 'gamemaster',
    timestamp: Date.now() as unknown as import('@ai-rpg/shared').Timestamp,
    requestScope: mockRequestScope,
  });

  // ===========================================================================
  // T1: 正常批量标记 attr
  // ===========================================================================

  describe('T1: 正常批量标记 attr', () => {
    it('LLM 传 {updates: [...]} → handler 正确收到完整 params.updates 数组', async () => {
      const params = {
        updates: [
          { npcId: 'npc-1', attrInitialized: true },
          { npcId: 'npc-2', attrInitialized: true },
        ],
      };

      const response = await tool.execute('batch_mark_initialized', params, buildContext());

      // 1. 返回成功
      expect(response.success).toBe(true);
      expect(response.error).toBeUndefined();

      // 2. service.batchMarkInitialized 被调用一次
      expect(mockService.batchMarkInitialized).toHaveBeenCalledTimes(1);

      // 3. 入参 saveId 正确
      const [calledSaveId, calledUpdates] = mockService.batchMarkInitialized.mock.calls[0];
      expect(calledSaveId).toBe(SAVE_ID);

      // 4. 入参 updates 是完整数组（不是 BaseTool 拆分后的单 item）
      //    这是 v1.2 修复的核心断言：移除 batch: { param: 'updates' } 配置后，
      //    handler 收到的是完整 params.updates 数组（而非 undefined 或单 item 字段）
      expect(calledUpdates).toEqual([
        { npcId: 'npc-1', attrInitialized: true },
        { npcId: 'npc-2', attrInitialized: true },
      ]);
      expect(Array.isArray(calledUpdates)).toBe(true);
      expect(calledUpdates.length).toBe(2);

      // 5. 返回数据包含 message
      expect(response.data).toEqual({
        message: `批量标记 2 个 NPC 初始化状态完成`,
      });
    });

    it('LLM 传 4 NPC 完整三类 init flag → handler 正确处理', async () => {
      const updates: NpcInitUpdate[] = [
        { npcId: 'npc-1', attrInitialized: true, invInitialized: true, skillInitialized: true },
        { npcId: 'npc-2', attrInitialized: true, invInitialized: true, skillInitialized: true },
        { npcId: 'npc-3', attrInitialized: true, invInitialized: true, skillInitialized: true },
        { npcId: 'npc-4', attrInitialized: true, invInitialized: true, skillInitialized: true },
      ];

      const response = await tool.execute('batch_mark_initialized', { updates }, buildContext());

      expect(response.success).toBe(true);
      expect(mockService.batchMarkInitialized).toHaveBeenCalledTimes(1);

      const [, calledUpdates] = mockService.batchMarkInitialized.mock.calls[0];
      expect(calledUpdates).toEqual(updates);
      expect(calledUpdates.length).toBe(4);
    });
  });

  // ===========================================================================
  // T2: 空数组边界
  // ===========================================================================

  describe('T2: 空数组边界', () => {
    it('LLM 传 {updates: []} → handler 调用 service.batchMarkInitialized(saveId, [])', async () => {
      const response = await tool.execute('batch_mark_initialized', { updates: [] }, buildContext());

      // handler 不抛错（service.batchMarkInitialized 内部空数组早退）
      expect(response.success).toBe(true);
      expect(mockService.batchMarkInitialized).toHaveBeenCalledTimes(1);

      const [, calledUpdates] = mockService.batchMarkInitialized.mock.calls[0];
      expect(calledUpdates).toEqual([]);
      expect(calledUpdates.length).toBe(0);

      // 返回 message 显示 0 个
      expect(response.data).toEqual({
        message: `批量标记 0 个 NPC 初始化状态完成`,
      });
    });
  });

  // ===========================================================================
  // T3: 参数缺失错误路径
  // ===========================================================================

  describe('T3: 参数缺失错误路径', () => {
    it('LLM 传 {} → handler 返回明确错误（不再抛 "Cannot read properties of undefined"）', async () => {
      // v1.2 修复前：batch 配置存在时，BaseTool 在 line 141-143 会返回
      //   "参数 'updates' 必须是非空数组" 错误，不会进入 handler
      // v1.2 修复后：无 batch 配置，handler 直接被调用，validateRequired
      //   返回明确错误 "Missing required parameters: updates"
      //   这是 handler 端的明确校验，不再是 v1.0 的 undefined.length 隐式错误

      const response = await tool.execute('batch_mark_initialized', {}, buildContext());

      // 期望：handler 主动校验返回明确错误
      expect(response.success).toBe(false);
      expect(response.error).toBeTruthy();

      // 关键回归断言：错误信息是明确的参数缺失错误，不再是 v1.0 实测的
      //   "Cannot read properties of undefined (reading 'length')"
      expect(response.error).toContain('updates');
      expect(response.error).not.toContain('Cannot read properties of undefined');

      // service.batchMarkInitialized 不应被调用（handler 在调用前就返回错误）
      expect(mockService.batchMarkInitialized).not.toHaveBeenCalled();
    });

    it('LLM 传 {updates: null} → handler 同样返回明确错误', async () => {
      const response = await tool.execute('batch_mark_initialized', { updates: null }, buildContext());

      expect(response.success).toBe(false);
      expect(response.error).toContain('updates');
      expect(response.error).not.toContain('Cannot read properties of undefined');
      expect(mockService.batchMarkInitialized).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // T4: batch_check_init_status 端到端
  // ===========================================================================

  describe('T4: batch_check_init_status 端到端', () => {
    it('LLM 传 {npcIds: [...]} → handler 正确收到完整 params.npcIds 数组', async () => {
      // 准备 mock 返回值
      const mockResults: NpcInitStatus[] = [
        { npcId: 'npc-1', attrNeedsInit: true, invNeedsInit: false, skillNeedsInit: true },
        { npcId: 'npc-2', attrNeedsInit: false, invNeedsInit: true, skillNeedsInit: false },
      ];
      mockService.batchCheckInitStatus.mockResolvedValueOnce(mockResults);

      const params = { npcIds: ['npc-1', 'npc-2'] };

      const response = await tool.execute('batch_check_init_status', params, buildContext());

      // 1. 返回成功
      expect(response.success).toBe(true);
      expect(response.error).toBeUndefined();

      // 2. service.batchCheckInitStatus 被调用一次
      expect(mockService.batchCheckInitStatus).toHaveBeenCalledTimes(1);

      // 3. 入参 saveId 正确
      const [calledSaveId, calledNpcIds] = mockService.batchCheckInitStatus.mock.calls[0];
      expect(calledSaveId).toBe(SAVE_ID);

      // 4. 入参 npcIds 是完整数组
      expect(calledNpcIds).toEqual(['npc-1', 'npc-2']);
      expect(Array.isArray(calledNpcIds)).toBe(true);
      expect(calledNpcIds.length).toBe(2);

      // 5. 返回 results 数组
      expect(response.data).toEqual({ results: mockResults });
    });

    it('LLM 传空 npcIds 数组 → handler 调用 service.batchCheckInitStatus(saveId, [])', async () => {
      mockService.batchCheckInitStatus.mockResolvedValueOnce([]);

      const response = await tool.execute('batch_check_init_status', { npcIds: [] }, buildContext());

      expect(response.success).toBe(true);
      expect(mockService.batchCheckInitStatus).toHaveBeenCalledTimes(1);

      const [, calledNpcIds] = mockService.batchCheckInitStatus.mock.calls[0];
      expect(calledNpcIds).toEqual([]);
      expect(response.data).toEqual({ results: [] });
    });
  });

  // ===========================================================================
  // 关键回归：v1.0 BUG 不再复现
  // ===========================================================================

  describe('回归: v1.0 batch 配置误用 BUG 不再复现', () => {
    it('batch_mark_initialized 不再配置 batch: { param: updates }', () => {
      // 通过反查 BaseTool.methods.get('batch_mark_initialized').batch 应为 undefined
      // BaseTool 的 methods 是 protected Map，但可通过反射访问
      const methods = (tool as unknown as { methods: Map<string, { batch?: unknown }> }).methods;
      const method = methods.get('batch_mark_initialized');
      expect(method).toBeDefined();
      expect(method!.batch).toBeUndefined();
    });

    it('batch_check_init_status 也不配置 batch（设计一致性）', () => {
      const methods = (tool as unknown as { methods: Map<string, { batch?: unknown }> }).methods;
      const method = methods.get('batch_check_init_status');
      expect(method).toBeDefined();
      expect(method!.batch).toBeUndefined();
    });
  });
});
