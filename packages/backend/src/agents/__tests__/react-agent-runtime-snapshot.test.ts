import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime.js';
import type { AgentType } from '../../../../shared/src/types/agent.js';
import {
  buildRuntimeSnapshotDevtoolsSummary,
  type AgentRuntimeSnapshot,
} from '../runtime/agent-runtime-snapshot.js';
import { RequestScope } from '../../services/RequestScope.js';
import type { Knex } from 'knex';

/**
 * 测试用 Agent 访问类型：暴露私有 deps/gmDeps/reactEngine 容器，便于测试通过容器注入 mock。
 */
type TestAgent = {
  deps: Record<string, unknown>;
  gmDeps: Record<string, unknown>;
  reactEngine: { execute: (...args: unknown[]) => Promise<unknown> };
  [key: string]: unknown;
};

/** 将 AgentRuntime 转为 TestAgent 视图，仅用于访问私有 deps/reactEngine 容器。 */
function testAccess(agent: AgentRuntime): TestAgent {
  return agent as unknown as TestAgent;
}

function createAgent(options: {
  agentKey: string;
  isSubAgent: boolean;
  tools?: string[];
}) {
  return new AgentRuntime(
    {
      llmService: {} as never,
      db: vi.fn() as never,
      promptModule: {
        build: vi.fn(),
        rules: { getAllRulesForAgent: vi.fn().mockReturnValue([]) },
        skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
      } as never,
      devTraceCollector: () => null,
      createTraceCollector: () => ({}) as never,
      createResponsePool: () => ({ stage: vi.fn(), flush: vi.fn().mockReturnValue({ uiDirective: undefined, uiIntensity: undefined, panelUpdates: {}, time: undefined }), hasUIDirective: vi.fn().mockReturnValue(false), hasPanelUpdates: vi.fn().mockReturnValue(false), clear: vi.fn() }) as never,
      createStagingPool: () => ({ stage: vi.fn(), hasWrites: vi.fn().mockReturnValue(false), flush: vi.fn(), writeCount: 0, rollbackFrom: vi.fn().mockReturnValue(0), getAllWrites: vi.fn().mockReturnValue([]), clear: vi.fn(), clearDirtyAfterFlush: vi.fn(), getFailedWrites: vi.fn().mockReturnValue([]), isDirtyAfterFlush: vi.fn().mockReturnValue(false), bindShadowState: vi.fn(), bindGraphUpdater: vi.fn(), adoptFrom: vi.fn() }) as never,
      createShadowStateLayer: () => ({ read: vi.fn().mockReturnValue(undefined), readOne: vi.fn().mockReturnValue(undefined), ensureSnapshot: vi.fn().mockResolvedValue(undefined) }) as never,
      createRequestScope: () => new RequestScope({} as unknown as Knex),
      npcServiceFactory: (() => Promise.resolve({} as never)) as never,
      // post-flush 事件处理：drainPendingEvents 返回空数组，不触发 bootstrapEventHandlers
      requestEventBridge: { drainPendingEvents: () => [] } as never,
    } as never,
    {
      name: options.agentKey,
      tools: options.tools ?? [],
      max_iterations: 4,
      force_structured_output: true,
      isSubAgent: options.isSubAgent,
    } as never,
    options.agentKey,
    'test system prompt',
  );
}

function createPromptBuildResult(options: {
  systemPrompt: string;
  userPrompt: string;
  toolType: string;
  methodName: string;
  ruleNames: string[];
  skillNames: string[];
}) {
  const functionName = `${options.toolType}__${options.methodName}`;
  return {
    systemPrompt: options.systemPrompt,
    userPrompt: options.userPrompt,
    apiTools: [
      {
        type: 'function',
        function: {
          name: functionName,
          description: 'test description',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ],
    allowedFunctionNames: new Set<string>([functionName]),
    systemPromptTrace: {
      content: options.systemPrompt,
      totalTokens: 1,
      layers: [
        {
          name: 'rules',
          order: 15,
          content: '<rules />',
          tokenCount: 1,
          metadata: {
            ruleNames: options.ruleNames,
          },
        },
        {
          name: 'skills',
          order: 16,
          content: '<skills />',
          tokenCount: 1,
          metadata: {
            skillNames: options.skillNames,
          },
        },
      ],
    },
    userPromptTrace: {
      content: options.userPrompt,
      totalTokens: 1,
      action: 'chat',
      intentHint: 'chat',
      blocks: [],
    },
    toolVisibilityTrace: [
      {
        toolType: options.toolType,
        methodNames: [options.methodName],
      },
    ],
  };
}

function createRuntimeSnapshot(overrides: Partial<AgentRuntimeSnapshot> = {}): AgentRuntimeSnapshot {
  return {
    requestId: 'req-1',
    sessionId: 'save-1',
    agentKey: 'gamemaster',
    createdAt: 1,
    modelSnapshot: {
      providerId: null,
      model: null,
      temperature: 0.7,
      maxTokens: 4096,
    },
    permissionSnapshot: {
      configuredTools: ['event_service'],
      defaultDeny: true,
    },
    ruleSnapshot: [],
    skillSnapshot: [],
    helpSnapshot: [],
    toolVisibilitySnapshot: {
      allowedToolTypes: ['event_service'],
      allowedFunctionNames: ['event_service__get_event_snapshot'],
    },
    promptSnapshot: {
      systemPrompt: 'system',
      userPrompt: 'user',
    },
    contextSnapshot: {
      language: 'zh-CN',
      templateId: 'template-1',
    },
    debugSnapshot: {
      source: 'unit-test',
    },
    ...overrides,
  };
}

describe('AgentRuntime runtime snapshot', () => {
  it('SubAgent 主链应在 prompt build 后绑定 runtime snapshot 并用快照驱动 ReAct context', async () => {
    const agent = createAgent({
      agentKey: 'event',
      isSubAgent: true,
      tools: ['event_service'],
    });
    agent.currentLanguage = 'zh-CN';
    agent.currentTemplateId = 'template-sub';

    const promptResult = createPromptBuildResult({
      systemPrompt: 'subagent system snapshot',
      userPrompt: 'subagent user snapshot',
      toolType: 'event_service',
      methodName: 'get_event_snapshot',
      ruleNames: ['event-rule'],
      skillNames: ['event-skill'],
    });

    testAccess(agent).deps.promptModule = {
      build: vi.fn().mockResolvedValue(promptResult),
      rules: { getAllRulesForAgent: vi.fn().mockReturnValue([{ name: 'event-rule' }]) },
      skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
    } as never;
    const executeSpy = vi.spyOn(
      testAccess(agent).reactEngine,
      'execute',
    ).mockResolvedValue({
      content: '{}',
      iterations: 1,
      toolCalls: [],
    });

    vi.spyOn(agent as never, 'ensureSaveId' as never).mockResolvedValue('save-1' as never);
    vi.spyOn(agent as never, 'parseSubAgentResponseWithRetry' as never).mockResolvedValue({ ok: true });

    const response = await (agent as unknown as {
      processSubAgentPath: (message: Record<string, unknown>) => Promise<{ success: boolean }>;
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).processSubAgentPath({
      id: 'req-sub',
      saveId: 'save-1',
      payload: {
        action: 'chat',
        intentHint: 'chat',
        data: {
          playerInput: '查看事件',
        },
      },
    });

    expect(response.success).toBe(true);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'subagent system snapshot',
        userMessage: 'subagent user snapshot',
        allowedFunctionNames: new Set(['event_service__get_event_snapshot']),
      }),
      expect.objectContaining({
        beforeToolCall: expect.any(Function),
        afterToolCall: expect.any(Function),
      }),
      expect.any(Function),
    );
    const actualSnapshot = (agent as unknown as {
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).getRuntimeSnapshot();
    expect(actualSnapshot).toMatchObject({
      requestId: 'req-sub',
      sessionId: 'save-1',
      agentKey: 'event',
      permissionSnapshot: {
        configuredTools: ['event_service'],
        defaultDeny: true,
      },
      ruleSnapshot: [{ name: 'event-rule', source: 'prompt-build' }],
      skillSnapshot: [{ name: 'event-skill', source: 'prompt-build' }],
      helpSnapshot: [],
      toolVisibilitySnapshot: {
        allowedToolTypes: ['event_service'],
        allowedFunctionNames: ['event_service__get_event_snapshot'],
      },
      promptSnapshot: {
        systemPrompt: 'subagent system snapshot',
        userPrompt: 'subagent user snapshot',
      },
      contextSnapshot: {
        language: 'zh-CN',
        templateId: 'template-sub',
      },
      debugSnapshot: {
        source: 'react-subagent',
      },
    });
  });

  it('GameMaster 主链应在 prompt build 后绑定 runtime snapshot 并让当前轮消费该快照', async () => {
    const agent = createAgent({
      agentKey: 'gamemaster',
      isSubAgent: false,
      tools: ['map_service'],
    });

    const promptResult = createPromptBuildResult({
      systemPrompt: 'gm system snapshot',
      userPrompt: 'gm user snapshot',
      toolType: 'map_service',
      methodName: 'describe_area',
      ruleNames: ['gm-rule'],
      skillNames: ['gm-skill'],
    });

    agent.currentTemplateId = 'template-gm';
    testAccess(agent).deps.promptModule = {
      build: vi.fn().mockResolvedValue(promptResult),
      rules: { getAllRulesForAgent: vi.fn().mockReturnValue([{ name: 'gm-rule' }]) },
      skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
    } as never;
    const executeSpy = vi.spyOn(
      testAccess(agent).reactEngine,
      'execute',
    ).mockResolvedValue({
      content: '{}',
      iterations: 1,
      toolCalls: [],
    });

    vi.spyOn(agent as never, 'executeContextInjection' as never).mockResolvedValue({
      context: 'injected context',
      injectedMethods: [],
    });
    vi.spyOn(testAccess(agent).toolExecutor as never, 'executeDeterministicActions' as never).mockResolvedValue([]);
    vi.spyOn(agent as never, 'buildGameMasterFinalResponse' as never).mockResolvedValue({
      success: true,
      data: {},
      messages: [],
    });

    const response = await (agent as unknown as {
      executeGameMasterReAct: (
        message: Record<string, unknown>,
        saveId: string,
        startTime: number,
        sceneNPCs: unknown[],
        validatedNpcIds: string[],
        invalidNpcIds: string[],
        inCombat: boolean,
        templateContext: string | null,
        requestLanguage: string | null,
        reqCtx: Record<string, unknown>,
      ) => Promise<{ success: boolean }>;
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).executeGameMasterReAct(
      {
        id: 'req-gm',
        saveId: 'save-1',
        payload: {
          action: 'chat',
          intentHint: 'chat',
          data: {
            playerInput: '观察周围',
          },
        },
      },
      'save-1',
      Date.now(),
      [],
      [],
      [],
      false,
      'template runtime',
      'zh-CN',
      { intentHint: 'chat' },
    );

    expect(response.success).toBe(true);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'gm system snapshot',
        userMessage: 'gm user snapshot',
        allowedFunctionNames: new Set(['map_service__describe_area']),
      }),
      expect.any(Object),
      expect.any(Function),
    );
    expect((agent as unknown as {
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).getRuntimeSnapshot()).toMatchObject({
      requestId: 'req-gm',
      sessionId: 'save-1',
      agentKey: 'gamemaster',
      permissionSnapshot: {
        configuredTools: ['map_service'],
        defaultDeny: true,
      },
      ruleSnapshot: [{ name: 'gm-rule', source: 'prompt-build' }],
      skillSnapshot: [{ name: 'gm-skill', source: 'prompt-build' }],
      helpSnapshot: [],
      toolVisibilitySnapshot: {
        allowedToolTypes: ['map_service'],
        allowedFunctionNames: ['map_service__describe_area'],
      },
      promptSnapshot: {
        systemPrompt: 'gm system snapshot',
        userPrompt: 'gm user snapshot',
      },
      contextSnapshot: {
        language: 'zh-CN',
        templateId: 'template-gm',
      },
      debugSnapshot: {
        source: 'react-gamemaster',
      },
    });
  });

  it('pendingRuntimeRefreshes 应在轮次边界应用最后一份 queued snapshot', () => {
    const agent = createAgent({
      agentKey: 'gamemaster',
      isSubAgent: false,
      tools: ['event_service'],
    });

    (agent as unknown as {
      queueRuntimeSnapshotRefresh: (snapshot: AgentRuntimeSnapshot) => void;
      applyPendingRuntimeRefreshes: () => AgentRuntimeSnapshot | null;
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
      pendingRuntimeRefreshes: AgentRuntimeSnapshot[];
    }).queueRuntimeSnapshotRefresh(createRuntimeSnapshot({
      requestId: 'req-old',
      promptSnapshot: {
        systemPrompt: 'old system',
        userPrompt: 'old user',
      },
    }));

    (agent as unknown as {
      queueRuntimeSnapshotRefresh: (snapshot: AgentRuntimeSnapshot) => void;
      applyPendingRuntimeRefreshes: () => AgentRuntimeSnapshot | null;
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
      pendingRuntimeRefreshes: AgentRuntimeSnapshot[];
    }).queueRuntimeSnapshotRefresh(createRuntimeSnapshot({
      requestId: 'req-new',
      promptSnapshot: {
        systemPrompt: 'new system',
        userPrompt: 'new user',
      },
    }));

    const applied = (agent as unknown as {
      queueRuntimeSnapshotRefresh: (snapshot: AgentRuntimeSnapshot) => void;
      applyPendingRuntimeRefreshes: () => AgentRuntimeSnapshot | null;
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
      pendingRuntimeRefreshes: AgentRuntimeSnapshot[];
    }).applyPendingRuntimeRefreshes();

    expect(applied?.requestId).toBe('req-new');
    expect((agent as unknown as {
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).getRuntimeSnapshot()?.requestId).toBe('req-new');
    // M3 状态收敛：pendingRuntimeRefreshes 已迁入 AgentRuntimeState
    expect((agent as unknown as {
      state: { pendingRuntimeRefreshes: AgentRuntimeSnapshot[] };
    }).state.pendingRuntimeRefreshes).toEqual([]);
  });

  it('runtime snapshot devtools summary 应包含 tool exposure budget 与 deferred tools', () => {
    const summary = buildRuntimeSnapshotDevtoolsSummary(createRuntimeSnapshot({
      toolVisibilitySnapshot: {
        allowedToolTypes: ['map_service'],
        allowedFunctionNames: ['map_service__get_current_top_location'],
        deferredFunctionNames: ['map_service__move_to'],
        toolExposureBudget: {
          maxVisibleTools: 1,
          usedVisibleTools: 1,
          maxVisibleHelpDocs: 1,
          usedVisibleHelpDocs: 1,
          maxToolSummaryTokens: 100,
          usedToolSummaryTokens: 20,
          maxHelpSummaryTokens: 100,
          usedHelpSummaryTokens: 20,
          maxOnDemandLoadsPerTurn: 2,
          usedOnDemandLoads: 1,
        },
      },
    }));

    expect(summary.permissions.visibleFunctionCount).toBe(1);
    expect(summary.permissions.deferredFunctionCount).toBe(1);
    expect(summary.toolExposureBudget?.usedOnDemandLoads).toBe(1);
    expect(summary.deferredTools).toEqual(['map_service__move_to']);
  });

  it('syncRuntimeSnapshotToolExposureState 应同步追加当前请求已注入的帮助方法', () => {
    const agent = createAgent({
      agentKey: 'gamemaster',
      isSubAgent: false,
      tools: ['map_service', 'help_service'],
    });
    agent.setRuntimeSnapshot(createRuntimeSnapshot({
      helpSnapshot: [],
      toolVisibilitySnapshot: {
        allowedToolTypes: ['map_service', 'help_service'],
        allowedFunctionNames: ['map_service__get_current_top_location', 'help_service__get_tool_help_detail'],
        deferredFunctionNames: [],
        toolExposureBudget: {
          maxVisibleTools: 2,
          usedVisibleTools: 2,
          maxVisibleHelpDocs: 1,
          usedVisibleHelpDocs: 1,
          maxToolSummaryTokens: 100,
          usedToolSummaryTokens: 20,
          maxHelpSummaryTokens: 100,
          usedHelpSummaryTokens: 20,
          maxOnDemandLoadsPerTurn: 2,
          usedOnDemandLoads: 0,
        },
      },
    }));
    (agent as unknown as {
      currentInjectedMethods: Array<{ source: string; method: string; level?: 'summary' | 'detail' }>;
      syncRuntimeSnapshotToolExposureState: (state: { maxOnDemandLoadsPerTurn: number; usedOnDemandLoads: number }) => void;
    }).currentInjectedMethods = [
      { source: 'map_service', method: 'move_to', level: 'detail' },
    ];

    (agent as unknown as {
      syncRuntimeSnapshotToolExposureState: (state: { maxOnDemandLoadsPerTurn: number; usedOnDemandLoads: number }) => void;
    }).syncRuntimeSnapshotToolExposureState({
      maxOnDemandLoadsPerTurn: 2,
      usedOnDemandLoads: 1,
    });

    expect((agent.getRuntimeSnapshot()?.helpSnapshot ?? [])).toEqual([
      { tool: 'map_service', method: 'move_to' },
    ]);
    expect(agent.getRuntimeSnapshot()?.toolVisibilitySnapshot.toolExposureBudget).toEqual(
      expect.objectContaining({
        usedOnDemandLoads: 1,
      }),
    );
  });

  it('AgentRuntime.callTool 应将当前 runtime snapshot 透传给 ToolContext', async () => {
    const agent = createAgent({
      agentKey: 'gamemaster',
      isSubAgent: false,
      tools: ['coordinator_service'],
    });
    const runtimeSnapshot = createRuntimeSnapshot({
      requestId: 'req-runtime',
      agentKey: 'gamemaster',
    });
    let capturedContext: { runtimeSnapshot?: AgentRuntimeSnapshot | null } | null = null;

    agent.setRuntimeSnapshot(runtimeSnapshot);
    (agent as unknown as {
      db: unknown;
      toolRegistry: {
        execute: (
          agentType: AgentType,
          toolType: string,
          method: string,
          params: Record<string, unknown>,
          context: { runtimeSnapshot?: AgentRuntimeSnapshot | null },
        ) => Promise<{ success: boolean; data: Record<string, unknown> }>;
      };
    }).db = {};
    (agent as unknown as {
      db: unknown;
      toolRegistry: {
        execute: (
          agentType: AgentType,
          toolType: string,
          method: string,
          params: Record<string, unknown>,
          context: { runtimeSnapshot?: AgentRuntimeSnapshot | null },
        ) => Promise<{ success: boolean; data: Record<string, unknown> }>;
      };
    }).toolRegistry = {
      execute: vi.fn(async (_agentType, _toolType, _method, _params, context) => {
        capturedContext = context;
        return { success: true, data: { ok: true } };
      }),
    };

    await (agent as unknown as {
      callTool: (
        toolType: string,
        method: string,
        params: Record<string, unknown>,
        saveId?: string,
        db?: unknown,
        reqCtx?: Record<string, unknown>,
      ) => Promise<{ success: boolean }>;
    }).callTool('coordinator_service', 'spawn_agent', {}, 'save-1', {} as never, { intentHint: 'chat', requestScope: new RequestScope({} as unknown as Knex) });

    expect((capturedContext as any)?.runtimeSnapshot).toEqual(createRuntimeSnapshot({
      requestId: 'req-runtime',
      agentKey: 'gamemaster',
    }));
  });
});
