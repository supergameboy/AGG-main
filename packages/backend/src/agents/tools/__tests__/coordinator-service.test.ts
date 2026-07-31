import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentType, LLMMessage, ToolType } from '../../../../../shared/src/types/agent.js';
import type { ID, Timestamp } from '../../../../../shared/src/types/core.js';
import { BaseAgent } from '../../BaseAgent.js';
import { CoordinatorServiceTool } from '../coordinator-service.js';
import type { AgentResponse, LLMOptions, LLMResponse } from '../../types.js';
import type { ToolContext } from '@ai-rpg/shared/types/tool';
import { StagingPool } from '../../../services/StagingPool.js';
import type { ShadowStateLayer } from '../../../services/ShadowStateLayer.js';
import type { AgentRuntimeSnapshot } from '../../runtime/agent-runtime-snapshot.js';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import { RequestScope } from '../../../services/RequestScope.js';
import type { Knex } from 'knex';
import { deriveChildRuntimeSnapshot } from '../../runtime/derive-child-runtime-snapshot.js';

// AP-L1: StagingPool 构造函数注入 IDevTraceHook，测试提供最小 mock
const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

type CapturedScope = {
  injectedContext: string | null;
  injectedMethods: Array<{ source: string; method: string }>;
  templateContext: string | null;
  storyDirective: unknown;
  stagingPool: StagingPool | undefined;
  shadowState: ShadowStateLayer | undefined;
  templateId: string | undefined;
  runtimeSnapshot: AgentRuntimeSnapshot | null;
};

class TrackingAgent extends BaseAgent {
  constructor(
    config: { type: AgentType; name: string; systemPrompt: string },
    private readonly capturedScopes: CapturedScope[],
    private readonly scopedTools: string[] = [],
  ) {
    super(config);
  }

  override get configuredTools(): string[] {
    return this.scopedTools;
  }

  async processMessage(_message: AgentMessage): Promise<AgentResponse> {
    this.capturedScopes.push({
      injectedContext: this.currentInjectedContext,
      injectedMethods: structuredClone(this.currentInjectedMethods),
      templateContext: this.currentTemplateContext,
      storyDirective: structuredClone(this.currentStoryDirective),
      stagingPool: this.currentStagingPool,
      shadowState: this.currentShadowState,
      templateId: this.currentTemplateId,
      runtimeSnapshot: this.getRuntimeSnapshot(),
    });
    return { success: true, data: { ok: true } };
  }

  async callLLM(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
    return { success: true, content: 'ok' };
  }
}

function createRuntimeSnapshot(overrides: Partial<AgentRuntimeSnapshot> = {}): AgentRuntimeSnapshot {
  return {
    requestId: 'req-parent',
    sessionId: 'save-1',
    agentKey: 'gamemaster',
    parentAgentRunId: 'agent-run-parent',
    createdAt: 1,
    modelSnapshot: {
      providerId: 'openai',
      model: 'gpt-parent',
      temperature: 0.2,
      maxTokens: 2048,
    },
    permissionSnapshot: {
      configuredTools: ['event_service', 'map_service', 'inventory_service'],
      defaultDeny: true,
    },
    ruleSnapshot: [
      { name: 'gm-rule', source: 'alwaysApply' },
    ],
    skillSnapshot: [
      { name: 'gm-skill', source: 'matched' },
    ],
    helpSnapshot: [
      { tool: 'event_service', method: 'get_event_snapshot' },
      { tool: 'map_service', method: 'describe_area' },
      { tool: 'inventory_service', method: 'list_inventory' },
    ],
    toolVisibilitySnapshot: {
      allowedToolTypes: ['event_service', 'map_service', 'inventory_service'],
      allowedFunctionNames: [
        'event_service__get_event_snapshot',
        'map_service__describe_area',
        'inventory_service__list_inventory',
      ],
      deferredFunctionNames: [],
      toolExposureBudget: undefined,
    },
    promptSnapshot: {
      systemPrompt: 'gm system prompt',
      userPrompt: 'gm user prompt',
    },
    contextSnapshot: {
      language: 'zh-CN',
      templateId: 'template-parent',
    },
    debugSnapshot: {
      source: 'parent-runtime',
    },
    ...overrides,
  };
}

function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    saveId: 'save-1' as ID,
    agentType: 'gamemaster',
    timestamp: Date.now() as Timestamp,
    requestScope: new RequestScope({} as unknown as Knex),
    ...overrides,
  };
}

describe('CoordinatorServiceTool request scope binding', () => {
  it('spawn_agent 应注入事件模板上下文与请求期运行时资源', async () => {
    const capturedScopes: CapturedScope[] = [];
    const eventAgent = new TrackingAgent({
      type: 'event' as AgentType,
      name: 'Event Agent',
      systemPrompt: 'event prompt',
    }, capturedScopes, ['event_service']);

    const tool = new CoordinatorServiceTool({
      injectForAgentDetailed: async () => ({
        context: 'injected:event',
        injectedMethods: [{ source: 'ctx', method: 'event_snapshot' }],
      }),
    } as never);
    tool.setPermission({
      toolType: 'coordinator_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });
    tool.setAgentRegistry(new Map([
      ['event' as AgentType, eventAgent],
    ]));

    const stagingPool = new StagingPool(mockDevTraceHook);
    const shadowState = { layer: 'shadow' } as unknown as ShadowStateLayer;
    // L4.1 修复：storyDirective 仅提取 storyGoal 字段子集传递给子 Agent
    const storyDirective = {
      storyGoal: 'keep tension',
      events: { trigger: 'storm-warning' },
    };
    const runtimeSnapshot = createRuntimeSnapshot();

    const response = await tool.execute('spawn_agent', {
      agent_type: 'event',
      task: 'prepare storm encounter',
      context: { location: 'harbor' },
    }, createToolContext({
      templateId: 'template-1',
      storyDirective,
      stagingPool,
      shadowState,
      runtimeSnapshot,
    }));

    expect(response.success).toBe(true);
    expect(capturedScopes).toHaveLength(1);
    // L4.2 修复：deriveChildRuntimeSnapshot 重置 GM-only 字段（modelSnapshot/promptSnapshot/ruleSnapshot/skillSnapshot 等）
    // 测试期望通过 deriveChildRuntimeSnapshot 生成，确保与代码行为一致
    const expectedChildSnapshot = deriveChildRuntimeSnapshot(runtimeSnapshot, {
      agentKey: 'event',
      configuredTools: ['event_service'],
      templateId: 'template-1',
    });
    expect(capturedScopes[0]).toEqual({
      injectedContext: 'injected:event',
      injectedMethods: [{ source: 'ctx', method: 'event_snapshot' }],
      templateContext: JSON.stringify({
        location: 'harbor',
        eventDirective: { trigger: 'storm-warning' },
      }),
      storyDirective: { storyGoal: 'keep tension' },
      stagingPool,
      shadowState,
      templateId: 'template-1',
      runtimeSnapshot: {
        ...expectedChildSnapshot,
        createdAt: expect.any(Number),
      },
    });
  });

  it('batch_spawn_agents 应为不同子 Agent 生成相互隔离的请求态', async () => {
    const eventScopes: CapturedScope[] = [];
    const mapScopes: CapturedScope[] = [];
    const eventAgent = new TrackingAgent({
      type: 'event' as AgentType,
      name: 'Event Agent',
      systemPrompt: 'event prompt',
    }, eventScopes, ['event_service']);
    const mapAgent = new TrackingAgent({
      type: 'map' as AgentType,
      name: 'Map Agent',
      systemPrompt: 'map prompt',
    }, mapScopes, ['map_service']);

    const tool = new CoordinatorServiceTool({
      injectForAgentDetailed: async (agentType: string) => ({
        context: `injected:${agentType}`,
        injectedMethods: [{ source: agentType, method: `${agentType}_snapshot` }],
      }),
      // batch_spawn_agents manifest 路径需要 getDefaultManifest，返回 null 走 v1 rules 路径
      getDefaultManifest: () => null,
    } as never);
    tool.setPermission({
      toolType: 'coordinator_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });
    tool.setAgentRegistry(new Map([
      ['event' as AgentType, eventAgent],
      ['map' as AgentType, mapAgent],
    ]));

    const stagingPool = new StagingPool(mockDevTraceHook);
    const shadowState = { layer: 'shadow' } as unknown as ShadowStateLayer;
    // L4.1 修复：storyDirective 仅提取 storyGoal 字段子集传递给子 Agent
    const storyDirective = {
      storyGoal: 'split flows',
      events: { trigger: 'eclipse' },
    };
    const runtimeSnapshot = createRuntimeSnapshot();

    const response = await tool.execute('batch_spawn_agents', {
      agents: [
        { agent_type: 'event', task: 'trigger scene', context: { lane: 'event' } },
        { agent_type: 'map', task: 'describe area', context: { lane: 'map' } },
      ],
    }, createToolContext({
      templateId: 'template-2',
      storyDirective,
      stagingPool,
      shadowState,
      runtimeSnapshot,
    }));

    expect(response.success).toBe(true);
    expect(eventScopes).toHaveLength(1);
    expect(mapScopes).toHaveLength(1);

    // L4.2 修复：deriveChildRuntimeSnapshot 重置 GM-only 字段
    const expectedEventSnapshot = deriveChildRuntimeSnapshot(runtimeSnapshot, {
      agentKey: 'event',
      configuredTools: ['event_service'],
      templateId: 'template-2',
    });
    const expectedMapSnapshot = deriveChildRuntimeSnapshot(runtimeSnapshot, {
      agentKey: 'map',
      configuredTools: ['map_service'],
      templateId: 'template-2',
    });
    expect(eventScopes[0]).toEqual({
      injectedContext: 'injected:event',
      injectedMethods: [{ source: 'event', method: 'event_snapshot' }],
      templateContext: JSON.stringify({
        lane: 'event',
        eventDirective: { trigger: 'eclipse' },
      }),
      storyDirective: { storyGoal: 'split flows' },
      stagingPool,
      shadowState,
      templateId: 'template-2',
      runtimeSnapshot: {
        ...expectedEventSnapshot,
        createdAt: expect.any(Number),
      },
    });
    expect(mapScopes[0]).toEqual({
      injectedContext: 'injected:map',
      injectedMethods: [{ source: 'map', method: 'map_snapshot' }],
      templateContext: JSON.stringify({ lane: 'map' }),
      storyDirective: { storyGoal: 'split flows' },
      stagingPool,
      shadowState,
      templateId: 'template-2',
      runtimeSnapshot: {
        ...expectedMapSnapshot,
        createdAt: expect.any(Number),
      },
    });
  });

  it('spawn_agent 在子Agent缺失时应返回主Agent兜底follow-up而非硬失败', async () => {
    const tool = new CoordinatorServiceTool({} as never);
    tool.setPermission({
      toolType: 'coordinator_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });
    tool.setAgentRegistry(new Map());

    const response = await tool.execute('spawn_agent', {
      agent_type: 'event',
      task: '检查并触发场景事件',
      action: 'check_and_roll_events',
    }, createToolContext());

    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.data).toEqual({
      agent_type: 'event',
      fallback_to_main_agent: true,
      result: {
        data: {
          taskStatus: {
            completed: false,
            needsFollowUp: true,
            summary: 'event 子Agent不可用，切换为主Agent直接执行',
            failureReason: 'sub-agent unavailable',
            followUpDescription: expect.stringContaining('ServiceTool'),
          },
          actions: [],
          results: {},
        },
      },
    });
  });

  it('batch_spawn_agents 在部分子Agent缺失时应返回可继续执行的fallback结果', async () => {
    const eventScopes: CapturedScope[] = [];
    const eventAgent = new TrackingAgent({
      type: 'event' as AgentType,
      name: 'Event Agent',
      systemPrompt: 'event prompt',
    }, eventScopes);

    const tool = new CoordinatorServiceTool({
      injectForAgentDetailed: async (agentType: string) => ({
        context: `injected:${agentType}`,
        injectedMethods: [{ source: agentType, method: `${agentType}_snapshot` }],
      }),
      // batch_spawn_agents manifest 路径需要 getDefaultManifest，返回 null 走 v1 rules 路径
      getDefaultManifest: () => null,
    } as never);
    tool.setPermission({
      toolType: 'coordinator_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });
    tool.setAgentRegistry(new Map([
      ['event' as AgentType, eventAgent],
    ]));

    const response = await tool.execute('batch_spawn_agents', {
      agents: [
        { agent_type: 'event', task: '检查事件', action: 'check_and_roll_events' },
        { agent_type: 'output', task: '生成环境叙事', action: 'narrate_environment' },
      ],
    }, createToolContext());

    expect(response.success).toBe(true);
    expect(response.data).toEqual({
      results: [
        {
          agent_type: 'event',
          success: true,
          result: { ok: true },
        },
        {
          agent_type: 'output',
          success: true,
          fallback_to_main_agent: true,
          result: {
            data: {
              taskStatus: {
                completed: false,
                needsFollowUp: true,
                summary: 'output 子Agent不可用，切换为主Agent直接执行',
                failureReason: 'sub-agent unavailable',
                followUpDescription: expect.stringContaining('ServiceTool'),
              },
              actions: [],
              results: {},
            },
          },
        },
      ],
      summary: {
        total: 2,
        succeeded: 2,
        failed: 0,
        fallback: 1,
        degradedCount: 0,
        waves: 1,
      },
      // 统一面板变更推送机制：batch_spawn_agents 透传子 Agent writeOperations（无写入时为空数组）
      writeOperations: [],
      // 嵌套子 Agent 结构化摘要：每个子 Agent 的 taskReport + 文本 summary + 完成状态
      agentSummaries: [
        {
          agent_type: 'event',
          success: true,
          taskCompleted: false,
          summary: '',
          taskReport: undefined,
        },
        {
          agent_type: 'output',
          success: true,
          taskCompleted: false,
          summary: '',
          taskReport: undefined,
        },
      ],
    });
  });
});
