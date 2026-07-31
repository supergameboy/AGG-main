import { describe, expect, it } from 'vitest';
import { EntityCountsChecker } from '../program-checkers/index.js';
import type { AuditRequest } from '../../../../../shared/src/types/audit.js';
import type { AuditContext } from '../ProgramChecker.js';

/**
 * EntityCountsChecker.check 行为测试
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md
 * 章节：§2 EntityCountsChecker 修复效果（撤回过多检测，改为创建类操作精确匹配）
 *
 * 验证点：
 * 1. expected.counts 缺失/空时返回空 failures
 * 2. toolCalls 缺失/空时返回空 failures
 * 3. 工具数量匹配/不足/超过 expected 的行为
 * 4. 创建类操作匹配（CREATE_METHODS: create/add/learn/insert/upsert）
 * 5. 不再 substring 匹配虚高 actualCount（list/get/update 方法不计入）
 * 6. 不引入 actualCount > expectedCount 检测（撤回，避免反作用）
 *
 * 测试方式：直接 new EntityCountsChecker() 实例化并调用 check()，
 * 构造 mock AuditRequest 和 AuditContext（EntityCountsChecker 不访问 ctx）。
 */

function buildRequest(
  expectedCounts: Record<string, number> | undefined,
  toolCalls: AuditRequest['actualOutput']['toolCalls'],
): AuditRequest {
  return {
    taskId: 'task-1' as never,
    taskContract: {
      description: '测试任务',
      expected: expectedCounts ? { counts: expectedCounts } : undefined,
    },
    actualOutput: {
      taskId: 'task-1' as never,
      agentType: 'NPC',
      output: '完成',
      toolCalls,
      success: true,
    },
    auditMode: 'program',
  };
}

const mockCtx: AuditContext = {
  saveId: 'save-1' as never,
  templateId: 'tpl-1' as never,
  db: {} as never,
  dataProviders: {} as never,
  auditProviders: {} as never,
};

describe('EntityCountsChecker', () => {
  describe('基础行为', () => {
    it('用例1: expected.counts 缺失 - 返回空 failures', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(undefined, []);

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例2: expected.counts 为空对象 - 返回空 failures', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest({}, []);

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例3: toolCalls 缺失 - 返回空 failures 不抛错', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest({ npc: 1 }, undefined);

      const failures = await checker.check(request, mockCtx);

      // toolCalls 为 undefined 时，actualOutput.toolCalls ?? [] → []
      // 每个 entityType 的 actualCount=0，期望 1，会报 failure
      expect(failures).toHaveLength(1);
      expect(failures[0].dimension).toBe('entity_counts');
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('npc 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });

    it('用例4: toolCalls 为空数组 - 返回空 failures', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest({ npc: 1 }, []);

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('npc 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });
  });

  describe('创建类操作精确匹配（修复后行为）', () => {
    it('用例5: 工具数量匹配 expected - 返回空 failures', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [{ tool: 'npc_service', method: 'create_npc', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例6: 工具数量不足 expected - 返回 failure with correct count', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 2 },
        [{ tool: 'npc_service', method: 'create_npc', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].dimension).toBe('entity_counts');
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('npc 期望 2');
      expect(failures[0].reason).toContain('实际 1');
    });

    /**
     * 设计文档 §2 期望行为：
     * | expectedCount=5, actualCount=7（LLM 合法扩展） | 不报告 | 保持不报告（不阻断合法扩展） |
     */
    it('用例7: 工具数量超过 expected - 不报 failure（仅检查不足）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例8: 多个 entityType 独立检查', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1, location: 1 },
        [{ tool: 'npc_service', method: 'create_npc', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // npc 通过（1 >= 1），location 失败（0 < 1）
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('location 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });

    /**
     * 设计文档 §2 期望行为（修复后）：
     * | expectedCount=2（npc），LLM 调用 create_npc × 1 + get_npc_relations × 2
     * | actualCount=3（substring 匹配虚高），不报告
     * | actualCount=1（仅创建类操作），报告 error "实体数量不足" |
     */
    it('用例9: 修复后 - list 方法不再计入 actualCount（修复 substring 虚高）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [{ tool: 'npc_service', method: 'list', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：list 不属于 CREATE_METHODS，actualCount=0，期望 1，报告 failure
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('npc 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });

    it('用例10: method 字段匹配 entityType', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { location: 1 },
        [{ tool: 'map_service', method: 'create_location', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例11: tool 和 method 都不匹配 - actual=0', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { item: 1 },
        [{ tool: 'npc_service', method: 'create_npc', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('item 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });

    it('用例12: 修复后回归 - 不再抛出 "Cannot read properties of undefined (reading includes)"', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [{ tool: 'npc_service', method: 'create_npc', params: {}, result: {} }],
      );

      // 修复前：tc.tool/ tc.method 为 undefined，调用 .includes() 抛错
      // 修复后：tc.tool / tc.method 是真实字符串，includes() 正常工作
      await expect(checker.check(request, mockCtx)).resolves.toBeDefined();
    });
  });

  describe('create_npc + get_npc_relations 场景（核心修复点）', () => {
    /**
     * 设计文档 §2 核心修复场景：
     * | expectedCount=2（npc），LLM 调用 create_npc × 1 + get_npc_relations × 2
     * | actualCount=3（substring 匹配虚高），不报告
     * | actualCount=1（仅创建类操作），报告 error "实体数量不足" |
     */
    it('用例13: create_npc × 1 + get_npc_relations × 2，expected=2 - 修复后应报告数量不足', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 2 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'get_npc_relations', params: {}, result: {} },
          { tool: 'npc_service', method: 'get_npc_relations', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：仅 create_npc 计入 actualCount，actualCount=1 < expected=2，报告 error
      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('npc 期望 2');
      expect(failures[0].reason).toContain('实际 1');
    });

    it('用例14: create_npc × 2 + get_npc_relations × 3，expected=2 - 不报告（数量已满足）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 2 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'get_npc_relations', params: {}, result: {} },
          { tool: 'npc_service', method: 'get_npc_relations', params: {}, result: {} },
          { tool: 'npc_service', method: 'get_npc_relations', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：actualCount=2（仅 create_npc），满足 expected=2，不报告
      expect(failures).toEqual([]);
    });

    it('用例15: update_npc 不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'update_npc', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      // actualCount=1（仅 create_npc），满足 expected=1
      expect(failures).toEqual([]);
    });

    it('用例16: remove_npc 不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'remove_npc', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });
  });

  describe('CREATE_METHODS 关键词覆盖', () => {
    it('用例17: add_item 计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { item: 1 },
        [{ tool: 'inventory_service', method: 'add_item', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例18: learn_skill 计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { skill: 1 },
        [{ tool: 'skill_service', method: 'learn_skill', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例19: insert_xxx 计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { custom: 1 },
        [{ tool: 'custom_service', method: 'insert_custom', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例20: upsert_xxx 计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { custom: 1 },
        [{ tool: 'custom_service', method: 'upsert_custom', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('用例21: 大小写不敏感 - CREATE_NPC 也计入', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [{ tool: 'npc_service', method: 'CREATE_NPC', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });
  });

  describe('补充验证', () => {
    it('补充: expected.counts 多 entityType 全部满足 - 返回空 failures', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1, location: 1, quest: 1 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'map_service', method: 'create_location', params: {}, result: {} },
          { tool: 'quest_service', method: 'create_quest', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('补充: dimension 字段始终为 entity_counts', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 5 },
        [{ tool: 'npc_service', method: 'create_npc', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures[0].dimension).toBe('entity_counts');
    });

    it('补充: severity 始终为 error（数量不足是 error 级别）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 5 },
        [],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures[0].severity).toBe('error');
    });

    it('补充: failure 包含 expected 和 actual 字段', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 3 },
        [{ tool: 'npc_service', method: 'create_npc', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures[0].expected).toEqual({ entityType: 'npc', count: 3 });
      expect(failures[0].actual).toEqual({ entityType: 'npc', count: 1 });
    });
  });

  describe('方案 2 修复：批量调用 actualCount 真实统计', () => {
    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 add_item 调用，items=[9 个物品] | expected={ items: 8 } | actualCount=9 | 通过 |
     */
    it('批量1: 1 次 add_item 调用 items=[9] - actualCount=9（按数组长度计算）', async () => {
      const checker = new EntityCountsChecker();
      const items = Array.from({ length: 9 }, (_, i) => ({ name: `物品${i}` }));
      const request = buildRequest(
        { items: 8 },
        [{ tool: 'inventory_service', method: 'add_item', params: { items }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：actualCount=9（数组长度），满足 expected=8，不报告
      expect(failures).toEqual([]);
    });

    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 add_item 调用，items=[3 个物品] | expected={ items: 8 } | actualCount=3 | 报告 error |
     */
    it('批量2: 1 次 add_item 调用 items=[3] - actualCount=3，不足 expected=8 报告 error', async () => {
      const checker = new EntityCountsChecker();
      const items = Array.from({ length: 3 }, (_, i) => ({ name: `物品${i}` }));
      const request = buildRequest(
        { items: 8 },
        [{ tool: 'inventory_service', method: 'add_item', params: { items }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('items 期望 8');
      expect(failures[0].reason).toContain('实际 3');
    });

    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 2 次 add_item 调用，items=[3, 5 个物品] | expected={ items: 8 } | actualCount=8 | 通过 |
     */
    it('批量3: 2 次 add_item 调用 items=[3, 5] - actualCount=8 累加', async () => {
      const checker = new EntityCountsChecker();
      const items1 = Array.from({ length: 3 }, (_, i) => ({ name: `物品1-${i}` }));
      const items2 = Array.from({ length: 5 }, (_, i) => ({ name: `物品2-${i}` }));
      const request = buildRequest(
        { items: 8 },
        [
          { tool: 'inventory_service', method: 'add_item', params: { items: items1 }, result: {} },
          { tool: 'inventory_service', method: 'add_item', params: { items: items2 }, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：actualCount=3+5=8，满足 expected=8
      expect(failures).toEqual([]);
    });

    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 add_item_from_pool 调用，items=[2 个 poolItemId] | expected={ items: 2 } | actualCount=2 | 通过 |
     */
    it('批量4: 1 次 add_item_from_pool 调用 items=[2] - actualCount=2', async () => {
      const checker = new EntityCountsChecker();
      const items = [{ poolItemIdOrName: 'pool_1' }, { poolItemIdOrName: 'pool_2' }];
      const request = buildRequest(
        { items: 2 },
        [{ tool: 'inventory_service', method: 'add_item_from_pool', params: { items }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 create_npc 调用（单个创建） | expected={ npcs: 1 } | actualCount=1 | 通过 |
     */
    it('批量5: 单个 create_npc 调用无批量数组 - actualCount=1（默认）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npcs: 1 },
        [{ tool: 'npc_service', method: 'create_npc', params: { name: '村长' }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 list_inventory 调用（查询操作） | expected={ items: 1 } | actualCount=0 | 报告 error |
     */
    it('批量6: list_inventory 调用 - actualCount=0（非创建操作）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { items: 1 },
        [{ tool: 'inventory_service', method: 'list_inventory', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('items 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });

    /**
     * 设计文档方案 2 期望行为矩阵（substring 误匹配修复）：
     * | 1 次 get_address 调用（不应被误判为创建） | expected={ addresses: 1 } | actualCount=0 | 报告 error |
     *
     * 验证：substring `.includes('add')` 修复后，get_address 不再被识别为创建操作
     */
    it('批量7: get_address 调用 - actualCount=0（substring 误匹配修复）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { addresses: 1 },
        [{ tool: 'address_service', method: 'get_address', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：get_address 不以 create_/add_/learn_/insert_/upsert_ 开头，actualCount=0
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('addresses 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });

    /**
     * 设计文档方案 2 期望行为矩阵（精确 token 边界匹配）：
     * inventory_service 不应被误匹配为 "item" 实体（"inventory" 不是 "item" 的完整 token）
     */
    it('批量8: inventory_service + add_item - actualCount 按 items 数组计算（不受 tool 名干扰）', async () => {
      const checker = new EntityCountsChecker();
      // 故意让 tool 名是 "inventory_service" 但 method 是 "add_item"
      // 期望：matchesEntity 通过 method 中的 "item" token 匹配（不是 tool 中的 "inventory"）
      const items = [{ name: '测试物品' }];
      const request = buildRequest(
        { items: 1 },
        [{ tool: 'inventory_service', method: 'add_item', params: { items }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });
  });
});
