import { describe, expect, it } from 'vitest';
import { EntityCountsChecker } from '../program-checkers/index.js';
import type { AuditRequest } from '../../../../../shared/src/types/audit.js';
import type { AuditContext } from '../ProgramChecker.js';

/**
 * EntityCountsChecker 创建类操作精确匹配 - 回归测试
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-feedback-duplicate-creation.md
 * 章节：§2 EntityCountsChecker 修复效果（撤回过多检测，改为创建类操作精确匹配）
 *
 * 本测试聚焦于设计文档中明确列出的修复点：
 * 1. substring 匹配虚高 actualCount 的修复（核心回归点）
 * 2. 不引入 actualCount > expectedCount 检测（撤回验证）
 * 3. CREATE_METHODS 关键词覆盖完整性
 *
 * 与 EntityCountsChecker.test.ts 区别：
 * - EntityCountsChecker.test.ts 是完整行为测试（基础用例 + 边界用例）
 * - 本文件是修复点回归测试（专门验证 v4 设计文档中描述的修复行为）
 */

function buildRequest(
  expectedCounts: Record<string, number>,
  toolCalls: AuditRequest['actualOutput']['toolCalls'],
): AuditRequest {
  return {
    taskId: 'task-regression' as never,
    taskContract: {
      description: '回归测试任务',
      expected: { counts: expectedCounts },
    },
    actualOutput: {
      taskId: 'task-regression' as never,
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

describe('EntityCountsChecker 创建类操作精确匹配 - 回归测试', () => {
  describe('设计文档 §2 核心修复场景', () => {
    /**
     * 设计文档 §2 期望行为矩阵：
     * | expectedCount=2（npc），LLM 调用 create_npc × 1 + get_npc_relations × 2
     * | 当前行为（修复前）：actualCount=3（substring 匹配虚高），不报告
     * | 期望行为（修复后）：actualCount=1（仅创建类操作），报告 error "实体数量不足" |
     */
    it('回归1: create_npc × 1 + get_npc_relations × 2，expected=2 - 应报告数量不足', async () => {
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

      // 修复后：actualCount=1（仅 create_npc），expected=2，应报告 error
      expect(failures).toHaveLength(1);
      expect(failures[0].dimension).toBe('entity_counts');
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('npc 期望 2');
      expect(failures[0].reason).toContain('实际 1');
    });

    /**
     * 设计文档 §2 期望行为矩阵：
     * | expectedCount=5, actualCount=3（数量不足） | 报告 error | 保持报告 error |
     */
    it('回归2: expectedCount=5, actualCount=3 - 保持报告 error', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 5 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('npc 期望 5');
      expect(failures[0].reason).toContain('实际 3');
    });

    /**
     * 设计文档 §2 期望行为矩阵：
     * | expectedCount=5, actualCount=5（数量匹配） | 不报告 | 保持不报告 |
     */
    it('回归3: expectedCount=5, actualCount=5 - 保持不报告', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 5 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    /**
     * 设计文档 §2 期望行为矩阵：
     * | expectedCount=5, actualCount=7（LLM 合法扩展） | 不报告 | 保持不报告（不阻断合法扩展） |
     *
     * 关键验证点：撤回 actualCount > expectedCount 检测提议
     */
    it('回归4: expectedCount=5, actualCount=7（合法扩展） - 保持不报告（不阻断合法扩展）', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 5 },
        Array.from({ length: 7 }, () => ({
          tool: 'npc_service',
          method: 'create_npc',
          params: {},
          result: {},
        })),
      );

      const failures = await checker.check(request, mockCtx);

      // 不引入 actualCount > expectedCount 检测（撤回，避免反作用）
      expect(failures).toEqual([]);
    });
  });

  describe('substring 匹配虚高 - 各类非创建操作排除验证', () => {
    it('回归5: list 操作不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [
          { tool: 'npc_service', method: 'list_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'list', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('实际 0');
    });

    it('回归6: get 操作不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [
          { tool: 'npc_service', method: 'get_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'get_npc_relations', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('实际 0');
    });

    it('回归7: update 操作不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [{ tool: 'npc_service', method: 'update_npc', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('实际 0');
    });

    it('回归8: delete/remove 操作不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 1 },
        [
          { tool: 'npc_service', method: 'delete_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'remove_npc', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('实际 0');
    });

    it('回归9: 查询和更新混合，仅 create 计入', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { npc: 2 },
        [
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'list_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'get_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'update_npc', params: {}, result: {} },
          { tool: 'npc_service', method: 'remove_npc', params: {}, result: {} },
        ],
      );

      const failures = await checker.check(request, mockCtx);

      // actualCount=2（仅 2 个 create_npc），满足 expected=2，不报告
      expect(failures).toEqual([]);
    });
  });

  describe('CREATE_METHODS 关键词覆盖完整性', () => {
    /**
     * 设计文档 §2 实现方式：
     * const CREATE_METHODS = ['create', 'add', 'learn', 'insert', 'upsert'] as const;
     */
    it('回归10: create 关键词计入', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { custom: 1 },
        [{ tool: 'custom_service', method: 'create_custom', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('回归11: add 关键词计入', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { item: 1 },
        [{ tool: 'inventory_service', method: 'add_item', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('回归12: learn 关键词计入', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { skill: 1 },
        [{ tool: 'skill_service', method: 'learn_skill', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('回归13: insert 关键词计入', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { custom: 1 },
        [{ tool: 'custom_service', method: 'insert_custom', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('回归14: upsert 关键词计入', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { custom: 1 },
        [{ tool: 'custom_service', method: 'upsert_custom', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });
  });

  describe('bug-hunt-20260722: batch_create_ 前缀漏判修复', () => {
    /**
     * bug-hunt-20260722 根因：
     * `batch_create_locations` 方法名以 `batch_create_` 开头，
     * 不匹配 `create_` 前缀（因 `batch_create_locations`.startsWith('create_') === false），
     * 导致 EntityCountsChecker 统计 actualCount=0，audit_feedback 传递错误信息。
     *
     * 修复：isCreateOperation 增加 batch_create_ 前缀优先匹配
     */

    it('batch回归1: batch_create_locations 应被识别为创建类操作', async () => {
      const checker = new EntityCountsChecker();
      const locations = Array.from({ length: 11 }, (_, i) => ({ name: `地点${i}` }));
      const request = buildRequest(
        { locations: 14 },
        [{ tool: 'map_service', method: 'batch_create_locations', params: { locations }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：actualCount=11（batch_create_locations 被识别为创建操作，按数组长度计算）
      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('locations 期望 14');
      expect(failures[0].reason).toContain('实际 11');
    });

    it('batch回归2: batch_create_locations 满足数量时不报告', async () => {
      const checker = new EntityCountsChecker();
      const locations = Array.from({ length: 14 }, (_, i) => ({ name: `地点${i}` }));
      const request = buildRequest(
        { locations: 14 },
        [{ tool: 'map_service', method: 'batch_create_locations', params: { locations }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    it('batch回归3: batch_create_locations 合法扩展（超过 expected）不报告', async () => {
      const checker = new EntityCountsChecker();
      const locations = Array.from({ length: 16 }, (_, i) => ({ name: `地点${i}` }));
      const request = buildRequest(
        { locations: 14 },
        [{ tool: 'map_service', method: 'batch_create_locations', params: { locations }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // actualCount > expectedCount 不报告（不阻断 LLM 合法扩展）
      expect(failures).toEqual([]);
    });

    it('batch回归4: batch_create_npcs 应被识别为创建类操作', async () => {
      const checker = new EntityCountsChecker();
      const npcs = Array.from({ length: 3 }, (_, i) => ({ name: `NPC${i}` }));
      const request = buildRequest(
        { npcs: 4 },
        [{ tool: 'npc_service', method: 'batch_create_npcs', params: { npcs }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].severity).toBe('error');
      expect(failures[0].reason).toContain('npcs 期望 4');
      expect(failures[0].reason).toContain('实际 3');
    });

    it('batch回归5: batch_create_ 前缀不误判 batch_get_xxx 等非创建操作', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { locations: 1 },
        [{ tool: 'map_service', method: 'batch_get_locations', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // batch_get_ 不应被识别为创建操作
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('实际 0');
    });
  });

  describe('item 维度 substring 匹配修复', () => {
    /**
     * 设计文档 §2 问题说明：
     * entityType 为 'item' 时，会匹配到 itempool_remove、item_list 等非创建操作
     */
    it('回归15: item 维度 - item_list 不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { item: 1 },
        [{ tool: 'inventory_service', method: 'item_list', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      // 修复后：item_list 不属于 CREATE_METHODS，actualCount=0
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('item 期望 1');
      expect(failures[0].reason).toContain('实际 0');
    });

    it('回归16: item 维度 - itempool_remove 不计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { item: 1 },
        [{ tool: 'inventory_service', method: 'itempool_remove', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain('实际 0');
    });

    it('回归17: item 维度 - add_item 计入 actualCount', async () => {
      const checker = new EntityCountsChecker();
      const request = buildRequest(
        { item: 1 },
        [{ tool: 'inventory_service', method: 'add_item', params: {}, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });
  });

  describe('方案 2 修复：批量调用 actualCount 真实统计 + 精确前缀匹配', () => {
    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 add_item 调用，items=[9 个物品] | expected={ items: 8 } | actualCount=9 | 通过 |
     */
    it('批量回归1: 1 次 add_item 调用 items=[9] - actualCount=9（按数组长度计算，非 toolCall 数量）', async () => {
      const checker = new EntityCountsChecker();
      const items = Array.from({ length: 9 }, (_, i) => ({ name: `物品${i}` }));
      const request = buildRequest(
        { items: 8 },
        [{ tool: 'inventory_service', method: 'add_item', params: { items }, result: {} }],
      );

      const failures = await checker.check(request, mockCtx);

      expect(failures).toEqual([]);
    });

    /**
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 add_item 调用，items=[3 个物品] | expected={ items: 8 } | actualCount=3 | 报告 error |
     */
    it('批量回归2: 1 次 add_item 调用 items=[3] - actualCount=3，不足 expected=8 报告 error', async () => {
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
     * | 1 次 get_address 调用（不应被误判为创建） | expected={ addresses: 1 } | actualCount=0 | 报告 error |
     *
     * 关键验证点：substring `.includes('add')` 修复后，get_address 不再被识别为创建操作
     */
    it('批量回归3: get_address 调用 - actualCount=0（精确前缀匹配修复 substring 误匹配）', async () => {
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
     * 设计文档方案 2 期望行为矩阵：
     * | 1 次 list_inventory 调用（查询操作） | expected={ items: 1 } | actualCount=0 | 报告 error |
     */
    it('批量回归4: list_inventory 调用 - actualCount=0（非创建操作）', async () => {
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
  });
});
