/**
 * CoordinatorServiceTool batch_spawn_agents 统一面板变更推送机制测试
 *
 * 验证路径 B 修复点 1+2：
 * - 修复点 1：子 Agent writeOperation 透传给 GM Agent（data.writeOperations）
 * - 修复点 2：handler 完成后主动补推 mergedPanelUpdates（保险推送）
 *
 * 覆盖场景：
 * 1. 成功子 Agent 的 writeOperation 与 panelUpdates 被收集并主动补推
 * 2. 部分子 Agent 失败时仅收集成功子 Agent 数据
 * 3. 子 Agent 未返回 panelUpdates 时跳过主动补推但 writeOperations 仍透传
 * 4. 多次调用 handler 的 pushPanelUpdates 调用相互独立
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { ID, Timestamp } from '@ai-rpg/shared/types/core';
import type {
  AgentResponse,
  AgentType,
  ToolType,
  WriteOperation,
} from '@ai-rpg/shared/types/agent';
import type { IPanelUpdateBroadcaster } from '@ai-rpg/shared/messaging';
import type {
  IRequestScope,
  ToolContext,
} from '@ai-rpg/shared/types/tool';
import { registerTimeoutConfig } from '@ai-rpg/shared/tool-core';
import type { ContextInjector } from '../../services/context-injector.js';
import type { BaseAgent } from '../BaseAgent.js';
import { CoordinatorServiceTool } from '../tools/coordinator-service.js';

// 注册 timeout config，避免 BaseTool.execute 内部 withTimeout 抛错
// （packages/backend/src/utils/timeout.ts 模块加载时自动注册，但测试不触发该加载链）
beforeAll(() => {
  registerTimeoutConfig(() => ({
    chat: 30000,
    directMessage: 30000,
    llmProvider: 30000,
    agentProcessing: 30000,
    dagNode: 30000,
    toolExecution: 30000,
    reactIteration: 30000,
    reactMaxTokens: 30000,
    wsHeartbeat: 30000,
    wsMaxMissedHeartbeats: 3,
  }));
});

// === Mock 工厂 ===

function createMockContextInjector(): ContextInjector {
  return {
    // v1 rules 路径直接返回空 context，跳过实际数据加载
    injectForAgentDetailed: vi.fn().mockResolvedValue({
      context: '',
      injectedMethods: [],
    }),
    injectForAgentWithManifest: vi.fn(),
    getDefaultManifest: vi.fn().mockReturnValue(null),
  } as unknown as ContextInjector;
}

function createMockBaseAgent(response: AgentResponse): BaseAgent {
  const agent: Record<string, unknown> = {
    processMessage: vi.fn().mockResolvedValue(response),
    applyRequestScope: vi.fn(),
    canSpawnAgent: true,
    configuredTools: [],
  };
  // createRequestScopedCopy 必须返回 mock 自身，否则后续 applyRequestScope 调用失败
  agent.createRequestScopedCopy = vi.fn().mockReturnValue(agent);
  return agent as unknown as BaseAgent;
}

function createMockPanelBroadcaster(): IPanelUpdateBroadcaster {
  return {
    pushPanelUpdates: vi.fn(),
    pushPanelUpdate: vi.fn(),
  } as unknown as IPanelUpdateBroadcaster;
}

function createMockRequestScope(): IRequestScope {
  return {
    getOrCompute: vi.fn((_key, factory) => factory()),
    getDb: vi.fn(),
  } as unknown as IRequestScope;
}

function createMockContext(): ToolContext {
  return {
    saveId: 'save-1' as ID,
    agentType: 'gamemaster',
    timestamp: Date.now() as Timestamp,
    requestScope: createMockRequestScope(),
    // agentDepth=0，通过递归深度检查
    traceIds: { agentRunId: 'run-1', agentDepth: 0 },
  } as unknown as ToolContext;
}

function makeWriteOperation(
  toolType: string,
  method: string,
): WriteOperation {
  return {
    toolType: toolType as WriteOperation['toolType'],
    method,
    params: {},
    result: { ok: true },
    timestamp: Date.now() as Timestamp,
  };
}

function makeToolResult(
  id: string,
  writeOp: WriteOperation | undefined,
  success = true,
) {
  return {
    id: id as ID,
    toolCallId: id,
    success,
    timestamp: Date.now() as Timestamp,
    ...(writeOp ? { writeOperation: writeOp } : {}),
  };
}

/** 构造已配置好的 CoordinatorServiceTool 实例（含 registry + broadcaster + permission） */
function setupTool(
  registry: Map<AgentType, BaseAgent>,
  broadcaster: IPanelUpdateBroadcaster,
): CoordinatorServiceTool {
  const injector = createMockContextInjector();
  const tool = new CoordinatorServiceTool(injector);
  tool.setAgentRegistry(registry);
  tool.setPanelUpdateBroadcaster(broadcaster);
  tool.setPermission({
    toolType: 'coordinator_service' as ToolType,
    agentType: 'gamemaster',
    readAllowed: true,
    writeAllowed: true,
  });
  return tool;
}

// === 测试 ===

describe('CoordinatorServiceTool batch_spawn_agents 统一面板变更推送机制', () => {
  it('成功子 Agent 的 writeOperation 与 panelUpdates 被收集并主动补推', async () => {
    // 子 Agent 1：返回 character 面板 + inventory_service writeOp
    const agent1Response: AgentResponse = {
      success: true,
      data: { panelUpdates: { character: { currentHP: 100 } } },
      toolCalls: [
        makeToolResult('tc-1', makeWriteOperation('inventory_service', 'add_item')),
      ],
    };
    // 子 Agent 2：返回 inventory 面板 + map_service writeOp
    const agent2Response: AgentResponse = {
      success: true,
      data: { panelUpdates: { inventory: { added: [] } } },
      toolCalls: [
        makeToolResult('tc-2', makeWriteOperation('map_service', 'create_location')),
      ],
    };

    const mockBroadcaster = createMockPanelBroadcaster();
    const tool = setupTool(
      new Map<AgentType, BaseAgent>([
        ['inventory' as AgentType, createMockBaseAgent(agent1Response)],
        ['map' as AgentType, createMockBaseAgent(agent2Response)],
      ]),
      mockBroadcaster,
    );

    const response = await tool.execute(
      'batch_spawn_agents',
      {
        agents: [
          { agent_type: 'inventory', task: '添加物品' },
          { agent_type: 'map', task: '创建地点' },
        ],
      },
      createMockContext(),
    );

    // 整体成功
    expect(response.success).toBe(true);

    // 主动补推被调用一次
    expect(mockBroadcaster.pushPanelUpdates).toHaveBeenCalledTimes(1);
    const [saveId, panelUpdates, source, triggeredOps] =
      mockBroadcaster.pushPanelUpdates.mock.calls[0];
    expect(saveId).toBe('save-1');
    // panelUpdates 合并两个子 Agent 的数据
    expect(panelUpdates).toEqual({
      character: { currentHP: 100 },
      inventory: { added: [] },
    });
    // source 标记为 tool_side_effect
    expect(source).toBe('tool_side_effect');
    // triggeredOps 含两个子 Agent 的 toolType+method
    expect(triggeredOps).toEqual([
      { toolType: 'inventory_service', method: 'add_item' },
      { toolType: 'map_service', method: 'create_location' },
    ]);

    // writeOperations 透传给 GM Agent
    const data = response.data as { writeOperations: WriteOperation[] };
    expect(data.writeOperations).toHaveLength(2);
    expect(data.writeOperations.map(op => op.toolType)).toContain('inventory_service');
    expect(data.writeOperations.map(op => op.toolType)).toContain('map_service');
  });

  it('部分子 Agent 失败时仅收集成功子 Agent 的 writeOperation 与 panelUpdates', async () => {
    // 成功子 Agent
    const successResponse: AgentResponse = {
      success: true,
      data: { panelUpdates: { character: { currentHP: 100 } } },
      toolCalls: [
        makeToolResult('tc-1', makeWriteOperation('inventory_service', 'add_item')),
      ],
    };
    // 失败子 Agent：data 与 toolCalls 中也有数据，但按设计不应被收集
    const failureResponse: AgentResponse = {
      success: false,
      error: '子 Agent 执行失败',
      data: { panelUpdates: { inventory: { added: [] } } },
      toolCalls: [
        makeToolResult('tc-2', makeWriteOperation('map_service', 'create_location'), false),
      ],
    };

    const mockBroadcaster = createMockPanelBroadcaster();
    const tool = setupTool(
      new Map<AgentType, BaseAgent>([
        ['inventory' as AgentType, createMockBaseAgent(successResponse)],
        ['map' as AgentType, createMockBaseAgent(failureResponse)],
      ]),
      mockBroadcaster,
    );

    const response = await tool.execute(
      'batch_spawn_agents',
      {
        agents: [
          { agent_type: 'inventory', task: '添加物品' },
          { agent_type: 'map', task: '创建地点' },
        ],
      },
      createMockContext(),
    );

    // 主动补推只含成功子 Agent 的 panelUpdates
    expect(mockBroadcaster.pushPanelUpdates).toHaveBeenCalledTimes(1);
    const [, panelUpdates, , triggeredOps] =
      mockBroadcaster.pushPanelUpdates.mock.calls[0];
    expect(panelUpdates).toEqual({ character: { currentHP: 100 } });
    // triggeredOps 只含成功子 Agent 的 writeOp
    expect(triggeredOps).toEqual([
      { toolType: 'inventory_service', method: 'add_item' },
    ]);

    // summary 统计：1 成功 1 失败
    // EG-OUT-6: summary 包含 degradedCount 字段（统计 context injection 降级的子 Agent 数量）
    const data = response.data as {
      summary: { total: number; succeeded: number; failed: number; fallback: number; degradedCount: number; waves: number };
      writeOperations: WriteOperation[];
    };
    expect(data.summary).toEqual({ total: 2, succeeded: 1, failed: 1, fallback: 0, degradedCount: 0, waves: 1 });
    // writeOperations 只含成功子 Agent 的 writeOp
    expect(data.writeOperations).toHaveLength(1);
    expect(data.writeOperations[0].toolType).toBe('inventory_service');
  });

  it('子 Agent 未返回 panelUpdates 时跳过主动补推但 writeOperations 仍透传', async () => {
    // 两个成功子 Agent，但 data 都不含 panelUpdates 字段
    const response1: AgentResponse = {
      success: true,
      data: { /* 无 panelUpdates */ },
      toolCalls: [
        makeToolResult('tc-1', makeWriteOperation('inventory_service', 'add_item')),
      ],
    };
    const response2: AgentResponse = {
      success: true,
      data: { /* 无 panelUpdates */ },
      toolCalls: [
        makeToolResult('tc-2', makeWriteOperation('map_service', 'create_location')),
      ],
    };

    const mockBroadcaster = createMockPanelBroadcaster();
    const tool = setupTool(
      new Map<AgentType, BaseAgent>([
        ['inventory' as AgentType, createMockBaseAgent(response1)],
        ['map' as AgentType, createMockBaseAgent(response2)],
      ]),
      mockBroadcaster,
    );

    const response = await tool.execute(
      'batch_spawn_agents',
      {
        agents: [
          { agent_type: 'inventory', task: '添加物品' },
          { agent_type: 'map', task: '创建地点' },
        ],
      },
      createMockContext(),
    );

    // mergedPanelUpdates 为空 → 不主动补推
    expect(mockBroadcaster.pushPanelUpdates).not.toHaveBeenCalled();
    // writeOperations 仍透传
    const data = response.data as { writeOperations: WriteOperation[] };
    expect(data.writeOperations).toHaveLength(2);
  });

  it('多次调用 handler 的 pushPanelUpdates 调用相互独立', async () => {
    // 第一次调用的响应
    const firstResponse: AgentResponse = {
      success: true,
      data: { panelUpdates: { character: { currentHP: 100 } } },
      toolCalls: [
        makeToolResult('tc-1', makeWriteOperation('inventory_service', 'add_item')),
      ],
    };
    // 第二次调用的响应
    const secondResponse: AgentResponse = {
      success: true,
      data: { panelUpdates: { inventory: { added: [] } } },
      toolCalls: [
        makeToolResult('tc-2', makeWriteOperation('map_service', 'create_location')),
      ],
    };

    // 直接构造 mock agent，processMessage 按调用顺序返回不同响应
    const mockAgent: Record<string, unknown> = {
      processMessage: vi.fn()
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse),
      applyRequestScope: vi.fn(),
      canSpawnAgent: true,
      configuredTools: [],
    };
    mockAgent.createRequestScopedCopy = vi.fn().mockReturnValue(mockAgent);

    const mockBroadcaster = createMockPanelBroadcaster();
    const tool = setupTool(
      new Map<AgentType, BaseAgent>([
        ['inventory' as AgentType, mockAgent as unknown as BaseAgent],
      ]),
      mockBroadcaster,
    );

    // 第一次调用
    await tool.execute(
      'batch_spawn_agents',
      { agents: [{ agent_type: 'inventory', task: '第一次' }] },
      createMockContext(),
    );
    // 第二次调用
    await tool.execute(
      'batch_spawn_agents',
      { agents: [{ agent_type: 'inventory', task: '第二次' }] },
      createMockContext(),
    );

    // 两次 pushPanelUpdates 调用独立
    expect(mockBroadcaster.pushPanelUpdates).toHaveBeenCalledTimes(2);
    const firstCall = mockBroadcaster.pushPanelUpdates.mock.calls[0];
    const secondCall = mockBroadcaster.pushPanelUpdates.mock.calls[1];
    // 第一次只含 character（不合并第二次的 inventory）
    expect(firstCall[1]).toEqual({ character: { currentHP: 100 } });
    // 第二次只含 inventory（不合并第一次的 character）
    expect(secondCall[1]).toEqual({ inventory: { added: [] } });
  });
});
