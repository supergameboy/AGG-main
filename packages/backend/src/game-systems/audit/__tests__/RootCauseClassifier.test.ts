import { describe, expect, it, vi } from 'vitest';
import { RootCauseClassifierImpl } from '../RootCauseClassifier.js';
import type { AuditFailure, AuditRequest, AuditRootCause } from '../../../../../shared/src/types/audit.js';
import type { AuditContext } from '../ProgramChecker.js';

/**
 * RootCauseClassifier 4 类根因分类测试
 *
 * 设计文档：docs/design/fractal-design-20260716-entity-graph-simplification/
 *           fractal-design-20260716-entity-graph-simplification-模块5-提示词与配置清理.md
 * 章节：L2-3 + L3-1 + L3-2（删除 graph_structure_issue 后的 4 类根因分类）
 *
 * 验证点：
 * 1. AuditRootCause 类型仅 4 类（无 graph_structure_issue）
 * 2. context_injection_error：actualOutput 为空 + 程序审有失败
 * 3. data_missing：npc_location/item_ownership 失败 + savePool 数据为空
 * 4. llm_understanding_error：LLM 审 content_quality 失败 或 程序审 content_quality warning
 * 5. tool_execution_failure：actualOutput.error 存在
 * 6. 默认兜底：undefined（方案 3 修复：无明确根因时不分类，避免误分类为 llm_understanding_error）
 * 7. 已删除 graph_structure_issue：即使有 graph_consistency 维度失败也不分类为 graph_structure_issue
 *
 * 设计原则（architecture-standards 14.5 第6条）：
 * - 仅 content_quality 维度 warning 分类为 llm_understanding_error
 * - 禁止所有 warning 统一分类为 llm_understanding_error（导致错误修复建议）
 */

// === 测试辅助构造函数 ===

function buildRequest(overrides: Partial<AuditRequest> = {}): AuditRequest {
  return {
    taskId: 'task-1' as never,
    taskContract: { description: '测试任务' },
    actualOutput: {
      taskId: 'task-1' as never,
      agentType: 'NPC',
      output: '已完成任务',
      toolCalls: [],
      success: true,
    },
    auditMode: 'both',
    ...overrides,
  };
}

function buildFailure(overrides: Partial<AuditFailure> & { dimension: AuditFailure['dimension'] }): AuditFailure {
  return {
    expected: 'expected',
    actual: 'actual',
    reason: '测试失败',
    severity: 'error',
    ...overrides,
  };
}

function buildMockCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    saveId: 'save-1' as never,
    templateId: 'tpl-1' as never,
    db: {} as never,
    dataProviders: {
      savePoolProvider: {
        listNpcs: vi.fn().mockResolvedValue([]),
        listItems: vi.fn().mockResolvedValue([]),
      },
    },
    auditProviders: {} as never,
    ...overrides,
  };
}

// === 测试用例 ===

describe('RootCauseClassifier - L2-3 4 类根因分类（删除 graph_structure_issue）', () => {
  const classifier = new RootCauseClassifierImpl();

  describe('AuditRootCause 类型缩减验证（L3-1）', () => {
    it('AuditRootCause 类型仅包含 4 类根因（无 graph_structure_issue）', () => {
      // 编译期验证：TypeScript 联合类型已缩减为 4 类
      // 若尝试赋值 'graph_structure_issue' 会触发编译错误
      const validCauses: AuditRootCause[] = [
        'context_injection_error',
        'llm_understanding_error',
        'data_missing',
        'tool_execution_failure',
      ];
      expect(validCauses).toHaveLength(4);
      expect(validCauses).not.toContain('graph_structure_issue');
    });
  });

  describe('context_injection_error 分类', () => {
    it('actualOutput 为空字符串 + 程序审有失败 → context_injection_error', async () => {
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '',
          toolCalls: [],
          success: false,
        },
      });
      const programFailures = [buildFailure({ dimension: 'entity_counts' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('context_injection_error');
    });

    it('actualOutput 为空白 + 程序审有失败 → context_injection_error', async () => {
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '   ',
          toolCalls: [],
          success: false,
        },
      });
      const programFailures = [buildFailure({ dimension: 'entity_counts' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('context_injection_error');
    });

    it('actualOutput 为空但程序审无失败 → 不返回 context_injection_error', async () => {
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '',
          toolCalls: [],
          success: false,
        },
      });
      const ctx = buildMockCtx();

      const result = await classifier.classify([], [], request, ctx);

      // 应跳过 context_injection_error（actualOutput 非空），进入后续分类（方案 3 修复后默认返回 undefined）
      expect(result).not.toBe('context_injection_error');
    });
  });

  describe('data_missing 分类', () => {
    it('npc_location 失败 + savePool NPCs 和 Items 都为空 → data_missing', async () => {
      const request = buildRequest();
      const programFailures = [buildFailure({ dimension: 'npc_location' })];
      const ctx = buildMockCtx({
        dataProviders: {
          savePoolProvider: {
            listNpcs: vi.fn().mockResolvedValue([]),
            listItems: vi.fn().mockResolvedValue([]),
          },
        } as never,
      });

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('data_missing');
    });

    it('item_ownership 失败 + savePool 为空 → data_missing', async () => {
      const request = buildRequest();
      const programFailures = [buildFailure({ dimension: 'item_ownership' })];
      const ctx = buildMockCtx({
        dataProviders: {
          savePoolProvider: {
            listNpcs: vi.fn().mockResolvedValue([]),
            listItems: vi.fn().mockResolvedValue([]),
          },
        } as never,
      });

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('data_missing');
    });

    it('npc_location 失败但 savePool 有数据 → 不分类为 data_missing', async () => {
      const request = buildRequest();
      const programFailures = [buildFailure({ dimension: 'npc_location' })];
      const ctx = buildMockCtx({
        dataProviders: {
          savePoolProvider: {
            listNpcs: vi.fn().mockResolvedValue([{ id: 'npc-1' }]),
            listItems: vi.fn().mockResolvedValue([]),
          },
        } as never,
      });

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).not.toBe('data_missing');
    });
  });

  describe('llm_understanding_error 分类（L3-2 设计原则）', () => {
    it('LLM 审 content_quality 失败 → llm_understanding_error', async () => {
      const request = buildRequest();
      const llmFailures = [buildFailure({ dimension: 'content_quality', severity: 'error' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify([], llmFailures, request, ctx);

      expect(result).toBe('llm_understanding_error');
    });

    it('程序审 content_quality warning → llm_understanding_error', async () => {
      const request = buildRequest();
      const programFailures = [buildFailure({ dimension: 'content_quality', severity: 'warning' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('llm_understanding_error');
    });

    it('非 content_quality 维度 warning + actualOutput.error → tool_execution_failure（非 llm_understanding_error）（§14.5 第6条）', async () => {
      // 场景：entity_counts warning（非 content_quality）+ actualOutput.error 存在
      // 设计原则：禁止所有 warning 统一分类为 llm_understanding_error
      // 期望：跳过 llm_understanding_error 分类（步骤 3），进入 tool_execution_failure 分类（步骤 4）
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '部分输出',
          toolCalls: [],
          success: false,
          error: '工具异常',
        },
      });
      const programFailures = [buildFailure({ dimension: 'entity_counts', severity: 'warning' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      // 不应分类为 llm_understanding_error（仅 content_quality 维度 warning 才分类）
      // 应分类为 tool_execution_failure（因为 actualOutput.error 存在）
      expect(result).not.toBe('llm_understanding_error');
      expect(result).toBe('tool_execution_failure');
    });
  });

  describe('tool_execution_failure 分类', () => {
    it('actualOutput.error 存在 + 非 content_quality 程序审失败 → tool_execution_failure', async () => {
      // 场景：actualOutput.error 存在 + 程序审有失败（但非 content_quality，跳过 llm_understanding_error）
      // 期望：跳过 context_injection_error（output 非空）→ 跳过 data_missing（非 npc_location/item_ownership）
      //      → 跳过 llm_understanding_error（非 content_quality）→ 命中 tool_execution_failure
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '部分输出',
          toolCalls: [],
          success: false,
          error: '工具调用异常',
        },
      });
      const programFailures = [buildFailure({ dimension: 'entity_counts', severity: 'error' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('tool_execution_failure');
    });

    it('无任何 failures + actualOutput.error 存在 → 返回 undefined（无审核数据可分类）', async () => {
      // 边界场景：工具调用异常但无审核失败报告，无法分类根因
      // 分类器 L27: allFailures.length === 0 → early return undefined
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '部分输出',
          toolCalls: [],
          success: false,
          error: '工具调用异常',
        },
      });
      const ctx = buildMockCtx();

      const result = await classifier.classify([], [], request, ctx);

      expect(result).toBeUndefined();
    });
  });

  describe('默认兜底', () => {
    it('无明确根因时默认返回 undefined（方案 3 修复：不再返回 llm_understanding_error）', async () => {
      // 场景：entity_counts error 无明确根因（非 content_quality、非 actualOutput.error、非 actualOutput 空）
      const request = buildRequest();
      const programFailures = [buildFailure({ dimension: 'entity_counts', severity: 'error' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      // 修复（方案 3）：默认分支返回 undefined，不再误分类为 'llm_understanding_error'
      expect(result).toBeUndefined();
    });

    it('无任何失败时返回 undefined', async () => {
      const request = buildRequest();
      const ctx = buildMockCtx();

      const result = await classifier.classify([], [], request, ctx);

      expect(result).toBeUndefined();
    });
  });

  describe('L3-2 已删除 graph_structure_issue 验证', () => {
    it('即使 programFailures 包含 graph_consistency 维度，也不分类为 graph_structure_issue（方案 3：默认返回 undefined）', async () => {
      // 场景：假设有 graph_consistency 维度失败（模块2 应已删除该 dimension，但验证兜底）
      const request = buildRequest();
      const programFailures = [buildFailure({ dimension: 'graph_consistency' as AuditFailure['dimension'] })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      // 不应返回已删除的 'graph_structure_issue'
      expect(result).not.toBe('graph_structure_issue');
      // 修复（方案 3）：默认分支返回 undefined，不再误分类为 'llm_understanding_error'
      expect(result).toBeUndefined();
    });

    it('即使 programFailures 包含 orphan_node 维度，也不分类为 graph_structure_issue', async () => {
      const request = buildRequest();
      const programFailures = [buildFailure({ dimension: 'orphan_node' as AuditFailure['dimension'] })];
      const ctx = buildMockCtx();

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).not.toBe('graph_structure_issue');
    });
  });

  describe('分类优先级验证', () => {
    it('context_injection_error 优先于 data_missing', async () => {
      // 场景：actualOutput 为空 + npc_location 失败 + savePool 为空
      // 期望：先命中 context_injection_error（步骤 1）
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '',
          toolCalls: [],
          success: false,
        },
      });
      const programFailures = [
        buildFailure({ dimension: 'npc_location' }),
        buildFailure({ dimension: 'entity_counts' }),
      ];
      const ctx = buildMockCtx({
        dataProviders: {
          savePoolProvider: {
            listNpcs: vi.fn().mockResolvedValue([]),
            listItems: vi.fn().mockResolvedValue([]),
          },
        } as never,
      });

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('context_injection_error');
    });

    it('data_missing 优先于 llm_understanding_error', async () => {
      // 场景：npc_location 失败 + savePool 为空 + content_quality warning
      // 期望：先命中 data_missing（步骤 2）
      const request = buildRequest();
      const programFailures = [
        buildFailure({ dimension: 'npc_location' }),
        buildFailure({ dimension: 'content_quality', severity: 'warning' }),
      ];
      const ctx = buildMockCtx({
        dataProviders: {
          savePoolProvider: {
            listNpcs: vi.fn().mockResolvedValue([]),
            listItems: vi.fn().mockResolvedValue([]),
          },
        } as never,
      });

      const result = await classifier.classify(programFailures, [], request, ctx);

      expect(result).toBe('data_missing');
    });

    it('llm_understanding_error 优先于 tool_execution_failure', async () => {
      // 场景：content_quality 失败 + actualOutput.error 存在
      // 期望：先命中 llm_understanding_error（步骤 3）
      const request = buildRequest({
        actualOutput: {
          taskId: 'task-1' as never,
          agentType: 'NPC',
          output: '部分输出',
          toolCalls: [],
          success: false,
          error: '工具异常',
        },
      });
      const llmFailures = [buildFailure({ dimension: 'content_quality', severity: 'error' })];
      const ctx = buildMockCtx();

      const result = await classifier.classify([], llmFailures, request, ctx);

      expect(result).toBe('llm_understanding_error');
    });
  });
});
