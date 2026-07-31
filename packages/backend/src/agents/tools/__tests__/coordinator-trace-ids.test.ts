import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentType, LLMMessage, ToolType } from '../../../../../shared/src/types/agent.js';
import type { ID, Timestamp } from '../../../../../shared/src/types/core.js';
import type { ExecutionTraceIds } from '../../../../../shared/src/types/execution-trace.js';
import { BaseAgent } from '../../BaseAgent.js';
import { CoordinatorServiceTool } from '../coordinator-service.js';
import type { AgentResponse, LLMOptions, LLMResponse } from '../../types.js';
import type { ToolContext } from '@ai-rpg/shared/types/tool';
import { RequestScope } from '../../../services/RequestScope.js';
import type { Knex } from 'knex';

import type { AgentRuntimeSnapshot } from '../../runtime/agent-runtime-snapshot.js';

class TraceCapturingAgent extends BaseAgent {
  private readonly capturedPayloads: Array<Record<string, unknown>>;

  constructor(
    config: { type: AgentType; name: string; systemPrompt: string },
    capturedPayloads: Array<Record<string, unknown>>,
    private readonly scopedTools: string[] = [],
  ) {
    super(config);
    this.capturedPayloads = capturedPayloads;
  }

  // 模拟 AgentRuntime 生产行为：parentAgent（gamemaster）允许 spawn 子 Agent
  override get canSpawnAgent(): boolean {
    return true;
  }

  override get configuredTools(): string[] {
    return this.scopedTools;
  }

  async processMessage(message: AgentMessage): Promise<AgentResponse> {
    const payloadData = (message.payload?.data as Record<string, unknown>) || {};
    this.capturedPayloads.push(payloadData);
    return { success: true, data: { ok: true } };
  }

  async callLLM(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
    return { success: true, content: 'ok' };
  }
}

function createRuntimeSnapshot(): AgentRuntimeSnapshot {
  return {
    requestId: 'req-parent',
    sessionId: 'save-1',
    agentKey: 'gamemaster',
    parentAgentRunId: undefined,
    createdAt: 1,
    modelSnapshot: { providerId: 'openai', model: 'gpt-parent', temperature: 0.2, maxTokens: 2048 },
    permissionSnapshot: { configuredTools: ['event_service'], defaultDeny: true },
    ruleSnapshot: [],
    skillSnapshot: [],
    helpSnapshot: [{ tool: 'event_service', method: 'get_event_snapshot' }],
    toolVisibilitySnapshot: {
      allowedToolTypes: ['event_service'],
      allowedFunctionNames: ['event_service__get_event_snapshot'],
    },
    promptSnapshot: { systemPrompt: 'gm system prompt', userPrompt: 'gm user prompt' },
    contextSnapshot: { language: 'zh-CN', templateId: 'template-parent' },
    debugSnapshot: { source: 'parent-runtime' },
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

describe('CoordinatorServiceTool — parentAgentRunId propagation', () => {
  it('spawn_agent passes parentAgentRunId to sub-Agent message', async () => {
    const capturedPayloads: Array<Record<string, unknown>> = [];
    const eventAgent = new TraceCapturingAgent({
      type: 'event' as AgentType,
      name: 'Event Agent',
      systemPrompt: 'event prompt',
    }, capturedPayloads, ['event_service']);

    const tool = new CoordinatorServiceTool({
      injectForAgentDetailed: async () => ({
        context: '',
        injectedMethods: [],
      }),
      // batch_spawn_agents handler 在 try-catch 外调用 getDefaultManifest，必须 mock
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

    const parentTraceIds: Partial<ExecutionTraceIds> = {
      requestId: 'req-001',
      sessionId: 'sess-001',
      agentRunId: 'gamemaster:run-parent-001',
    };

    const response = await tool.execute('spawn_agent', {
      agent_type: 'event',
      task: 'prepare storm encounter',
    }, createToolContext({
      runtimeSnapshot: createRuntimeSnapshot(),
      traceIds: parentTraceIds,
    }));

    expect(response.success).toBe(true);
    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0].traceIds).toBeDefined();

    const subTraceIds = capturedPayloads[0].traceIds as Partial<ExecutionTraceIds>;
    expect(subTraceIds.parentAgentRunId).toBe('gamemaster:run-parent-001');
    expect(subTraceIds.requestId).toBe('req-001');
    expect(subTraceIds.sessionId).toBe('sess-001');
  });

  it('batch_spawn_agents passes parentAgentRunId to each sub-Agent', async () => {
    const eventPayloads: Array<Record<string, unknown>> = [];
    const mapPayloads: Array<Record<string, unknown>> = [];
    const eventAgent = new TraceCapturingAgent({
      type: 'event' as AgentType,
      name: 'Event Agent',
      systemPrompt: 'event prompt',
    }, eventPayloads, ['event_service']);

    const mapAgent = new TraceCapturingAgent({
      type: 'map' as AgentType,
      name: 'Map Agent',
      systemPrompt: 'map prompt',
    }, mapPayloads, ['map_service']);

    const tool = new CoordinatorServiceTool({
      injectForAgentDetailed: async () => ({
        context: '',
        injectedMethods: [],
      }),
      // batch_spawn_agents handler 在 try-catch 外调用 getDefaultManifest，必须 mock
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

    const parentTraceIds: Partial<ExecutionTraceIds> = {
      requestId: 'req-batch',
      sessionId: 'sess-batch',
      agentRunId: 'gamemaster:run-batch-001',
    };

    const response = await tool.execute('batch_spawn_agents', {
      agents: [
        { agent_type: 'event', task: 'check events' },
        { agent_type: 'map', task: 'check map' },
      ],
    }, createToolContext({
      runtimeSnapshot: createRuntimeSnapshot(),
      traceIds: parentTraceIds,
    }));

    expect(response.success).toBe(true);

    const eventTraceIds = eventPayloads[0].traceIds as Partial<ExecutionTraceIds>;
    expect(eventTraceIds.parentAgentRunId).toBe('gamemaster:run-batch-001');

    const mapTraceIds = mapPayloads[0].traceIds as Partial<ExecutionTraceIds>;
    expect(mapTraceIds.parentAgentRunId).toBe('gamemaster:run-batch-001');
  });

  it('does not crash when traceIds is undefined in ToolContext', async () => {
    const capturedPayloads: Array<Record<string, unknown>> = [];
    const eventAgent = new TraceCapturingAgent({
      type: 'event' as AgentType,
      name: 'Event Agent',
      systemPrompt: 'event prompt',
    }, capturedPayloads, ['event_service']);

    const tool = new CoordinatorServiceTool({
      injectForAgentDetailed: async () => ({
        context: '',
        injectedMethods: [],
      }),
      // batch_spawn_agents handler 在 try-catch 外调用 getDefaultManifest，必须 mock
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

    const response = await tool.execute('spawn_agent', {
      agent_type: 'event',
      task: 'check events',
    }, createToolContext({
      runtimeSnapshot: createRuntimeSnapshot(),
      // No traceIds
    }));

    expect(response.success).toBe(true);
    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0].traceIds).toBeUndefined();
  });
});
