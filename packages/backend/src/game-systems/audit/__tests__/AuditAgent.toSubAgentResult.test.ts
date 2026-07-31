import { describe, expect, it, vi } from 'vitest';
import { AuditAgent } from '../AuditAgent.js';
import type { TaskContent, SubAgentResult } from '../../../../../shared/src/types/audit.js';
import type { ProgramChecker, LLMChecker, RootCauseClassifier, AuditContext } from '../ProgramChecker.js';

/**
 * AuditAgent.toSubAgentResult 字段映射 adapter 测试
 *
 * 验证点：
 * 1. ToolResult._meta.* → SubAgentResult.toolCalls[i].* 字段映射正确
 * 2. _meta 缺失时抛错暴露（符合 architecture-standards 13.3 数据保守处理）
 * 3. result 字段优先取 writeOperation.result，回退取 data
 * 4. 边界场景：null/undefined/非字符串/非布尔值的 fallback 处理
 *
 * 测试方式：通过 TestAgent 类型访问私有方法 toSubAgentResult，
 * 避免通过 auditForReport 间接调用（需构造完整 AuditContext mock，过于复杂）。
 */

type TestAgent = {
  toSubAgentResult: (taskContent: TaskContent, result: unknown) => SubAgentResult;
};

function createAuditAgent(): TestAgent {
  const mockProgramChecker: ProgramChecker = {
    dimension: 'entity_counts',
    check: vi.fn().mockResolvedValue([]),
  };
  const mockLLMChecker: LLMChecker = {
    check: vi.fn().mockResolvedValue([]),
  };
  const mockRootCauseClassifier: RootCauseClassifier = {
    classify: vi.fn().mockResolvedValue(undefined),
  };

  const agent = new AuditAgent(
    [mockProgramChecker],
    mockLLMChecker,
    mockRootCauseClassifier,
  );
  return agent as unknown as TestAgent;
}

const baseTaskContent: TaskContent = {
  description: '测试任务',
  action: 'create',
  agentType: 'NPC',
  agentRunId: 'run-1',
};

describe('AuditAgent.toSubAgentResult 字段映射 adapter', () => {
  it('用例1: 正常路径 - 完整 ToolResult 含 _meta + writeOperation', () => {
    const agent = createAuditAgent();
    const result = {
      content: '任务完成',
      iterations: 3,
      success: true,
      toolCalls: [
        {
          id: 'tc_1',
          toolCallId: 'tc_1',
          success: true,
          data: {},
          timestamp: 0,
          _meta: { toolType: 'npc_service', method: 'create_npc', params: { name: '商人' } },
          writeOperation: { toolType: 'npc_service', method: 'create_npc', params: {}, result: { id: 'npc_1' }, timestamp: 0 },
        },
      ],
    };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.toolCalls).toEqual([
      {
        tool: 'npc_service',
        method: 'create_npc',
        params: { name: '商人' },
        result: { id: 'npc_1' },
      },
    ]);
  });

  it('用例2: data 回退 - ToolResult 含 _meta 但无 writeOperation', () => {
    const agent = createAuditAgent();
    const result = {
      content: '完成',
      toolCalls: [
        {
          _meta: { toolType: 'map_service', method: 'get_location', params: {} },
          data: { id: 'loc_1' },
        },
      ],
    };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.toolCalls).toEqual([
      {
        tool: 'map_service',
        method: 'get_location',
        params: {},
        result: { id: 'loc_1' },
      },
    ]);
  });

  it('用例3: result undefined - _meta 存在但 data 和 writeOperation 都缺失', () => {
    const agent = createAuditAgent();
    const result = {
      content: '完成',
      toolCalls: [
        {
          _meta: { toolType: 'quest_service', method: 'list_quests', params: {} },
          success: true,
        },
      ],
    };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.toolCalls).toEqual([
      {
        tool: 'quest_service',
        method: 'list_quests',
        params: {},
        result: undefined,
      },
    ]);
  });

  it('用例4: _meta 缺失抛错 - 符合 13.3 数据保守处理', () => {
    const agent = createAuditAgent();
    const result = {
      content: '完成',
      toolCalls: [
        {
          data: {},
          toolCallId: 'tc_1',
          success: true,
        },
      ],
    };

    expect(() => agent.toSubAgentResult(baseTaskContent, result)).toThrow(
      /ToolResult missing _meta field, toolCallId=tc_1/,
    );
  });

  it('用例4.1: _meta 缺失且 toolCallId 也缺失 - 错误信息含 unknown', () => {
    const agent = createAuditAgent();
    const result = {
      content: '完成',
      toolCalls: [
        {
          data: {},
          success: true,
        },
      ],
    };

    expect(() => agent.toSubAgentResult(baseTaskContent, result)).toThrow(
      /ToolResult missing _meta field, toolCallId=unknown/,
    );
  });

  it('用例5: 多个 toolCalls 全部正确映射', () => {
    const agent = createAuditAgent();
    const result = {
      content: '完成',
      toolCalls: [
        { _meta: { toolType: 'npc_service', method: 'create_npc', params: {} }, data: {} },
        { _meta: { toolType: 'map_service', method: 'create_location', params: {} }, data: {} },
      ],
    };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.toolCalls).toEqual([
      { tool: 'npc_service', method: 'create_npc', params: {}, result: {} },
      { tool: 'map_service', method: 'create_location', params: {}, result: {} },
    ]);
  });

  it('用例6: 空 toolCalls 数组', () => {
    const agent = createAuditAgent();
    const result = { content: '完成', toolCalls: [] };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.toolCalls).toEqual([]);
  });

  it('用例7: 无 toolCalls 字段', () => {
    const agent = createAuditAgent();
    const result = { content: '完成' };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.toolCalls).toBeUndefined();
  });

  it('用例8: result 为 null', () => {
    const agent = createAuditAgent();

    const sub = agent.toSubAgentResult(baseTaskContent, null);

    expect(sub.output).toBe('');
    expect(sub.toolCalls).toBeUndefined();
    expect(sub.success).toBe(true);
  });

  it('用例9: result 为 undefined', () => {
    const agent = createAuditAgent();

    const sub = agent.toSubAgentResult(baseTaskContent, undefined);

    expect(sub.output).toBe('');
    expect(sub.toolCalls).toBeUndefined();
    expect(sub.success).toBe(true);
  });

  it('用例10: content 字段非字符串（数字）', () => {
    const agent = createAuditAgent();
    const result = { content: 123, toolCalls: [] };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.output).toBe('');
  });

  it('用例11: content 字段缺失', () => {
    const agent = createAuditAgent();
    const result = { toolCalls: [] };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.output).toBe('');
  });

  it('用例12: success 字段非布尔值', () => {
    const agent = createAuditAgent();
    const result = { content: 'ok', toolCalls: [], success: 'yes' as unknown as boolean };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.success).toBe(true);
  });

  it('用例13: success 字段缺失', () => {
    const agent = createAuditAgent();
    const result = { content: 'ok', toolCalls: [] };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.success).toBe(true);
  });

  it('用例14: success 显式为 false', () => {
    const agent = createAuditAgent();
    const result = { content: 'err', toolCalls: [], success: false };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    expect(sub.success).toBe(false);
  });

  it('用例15: 回归验证 - 修复前 bug 场景（修复后 EntityCountsChecker 能正常工作）', () => {
    const agent = createAuditAgent();
    const result = {
      content: '完成',
      toolCalls: [
        { _meta: { toolType: 'npc_service', method: 'create_npc', params: {} }, data: {} },
      ],
    };

    const sub = agent.toSubAgentResult(baseTaskContent, result);

    // 修复后：tc.tool 是真实字符串，调用 includes() 不会抛错
    expect(sub.toolCalls?.[0].tool).toBe('npc_service');
    expect(sub.toolCalls?.[0].tool.includes('npc')).toBe(true);
    expect(sub.toolCalls?.[0].method.includes('npc')).toBe(true);
  });

  it('补充: taskId 和 agentType 从 taskContent 提取', () => {
    const agent = createAuditAgent();
    const taskContent: TaskContent = {
      description: '描述',
      action: 'act',
      agentType: 'Quest',
      agentRunId: 'run-2',
    };

    const sub = agent.toSubAgentResult(taskContent, { content: '' });

    expect(sub.taskId).toBe('run-2');
    expect(sub.agentType).toBe('Quest');
  });
});
