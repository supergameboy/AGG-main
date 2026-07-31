import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime.js';
import { ReActEngine } from '../ReActEngine.js';
import { applyToolExposePatch } from '../ReActLoop.js';
import type { AgentMessage, ToolResult } from '../../../../shared/src/types/agent.js';
import type { ChatOptions } from '@ai-rpg/ai';
import type { PromptBuildResult } from '../prompt/types.js';
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

function createGameMasterAgent(overrides?: {
  toolBudget?: {
    maxVisibleTools?: number;
    maxVisibleHelpDocs?: number;
    maxToolSummaryTokens?: number;
    maxHelpSummaryTokens?: number;
    maxOnDemandLoadsPerTurn?: number;
  };
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
      createShadowStateLayer: () => ({ read: vi.fn().mockReturnValue(undefined), readOne: vi.fn().mockReturnValue(undefined), ensureSnapshot: vi.fn().mockResolvedValue(undefined), apply: vi.fn(), reset: vi.fn() }) as never,
      createRequestScope: () => new RequestScope({} as unknown as Knex),
      npcServiceFactory: (() => Promise.resolve({} as never)) as never,
      // post-flush 事件处理：drainPendingEvents 返回空数组，不触发 bootstrapEventHandlers
      requestEventBridge: { drainPendingEvents: () => [] } as never,
    } as never,
    {
      name: 'GameMaster',
      tools: ['map_service'],
      max_iterations: 4,
      toolBudget: overrides?.toolBudget,
      force_structured_output: true,
      isSubAgent: false,
      temperature: 0.7,
      max_tokens: 4096,
    } as never,
    'gamemaster',
    'test system prompt',
  );
}

function createOutputAgent(overrides?: {
  toolBudget?: {
    maxVisibleTools?: number;
    maxVisibleHelpDocs?: number;
    maxToolSummaryTokens?: number;
    maxHelpSummaryTokens?: number;
    maxOnDemandLoadsPerTurn?: number;
  };
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
      createShadowStateLayer: () => ({ read: vi.fn().mockReturnValue(undefined), readOne: vi.fn().mockReturnValue(undefined), ensureSnapshot: vi.fn().mockResolvedValue(undefined), apply: vi.fn(), reset: vi.fn() }) as never,
      createRequestScope: () => new RequestScope({} as unknown as Knex),
      npcServiceFactory: (() => Promise.resolve({} as never)) as never,
      // post-flush 事件处理：drainPendingEvents 返回空数组，不触发 bootstrapEventHandlers
      requestEventBridge: { drainPendingEvents: () => [] } as never,
    } as never,
    {
      name: 'OutputAgent',
      tools: ['dialogue_service'],
      max_iterations: 4,
      toolBudget: overrides?.toolBudget,
      force_structured_output: true,
      isSubAgent: true,
      temperature: 0.7,
      max_tokens: 4096,
    } as never,
    'output',
    'output system prompt',
  );
}

function createPromptBuildResult(): PromptBuildResult {
  return {
    systemPrompt: 'gm system prompt',
    userPrompt: 'gm user prompt',
    apiTools: [
      {
        type: 'function',
        function: {
          name: 'map_service__describe_area',
          description: 'describe',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ],
    allowedFunctionNames: new Set<string>(['map_service__describe_area']),
    toolVisibilityTrace: [
      {
        toolType: 'map_service',
        methodNames: ['describe_area'],
      },
    ],
    toolExposureTrace: {
      visibleTools: [
        {
          toolType: 'map_service',
          methodName: 'describe_area',
          functionName: 'map_service__describe_area',
          summary: 'describe',
          riskLevel: 'read_only',
        },
      ],
      deferredTools: [],
      visibleHelpSummaries: [],
      budget: {
        maxVisibleTools: 1,
        usedVisibleTools: 1,
        maxVisibleHelpDocs: 0,
        usedVisibleHelpDocs: 0,
        maxToolSummaryTokens: 0,
        usedToolSummaryTokens: 0,
        maxHelpSummaryTokens: 0,
        usedHelpSummaryTokens: 0,
        maxOnDemandLoadsPerTurn: 2,
        usedOnDemandLoads: 0,
      },
      trimmedReasons: [],
    },
    systemPromptTrace: {
      content: 'gm system prompt',
      totalTokens: 1,
      layers: [],
    },
    userPromptTrace: {
      content: 'gm user prompt',
      totalTokens: 1,
      action: 'chat',
      intentHint: 'chat',
      blocks: [],
    },
  };
}

function createMessage(): AgentMessage {
  return {
    id: 'req-gm' as never,
    saveId: 'save-1' as never,
    timestamp: Date.now() as never,
    from: 'user' as never,
    to: 'gamemaster' as never,
    type: 'request',
    payload: {
      action: 'chat',
      intentHint: 'chat',
      data: {
        playerInput: '观察四周',
      },
    },
    metadata: {
      priority: 'normal',
      requiresResponse: true,
    },
  };
}

function registerHook(
  agent: AgentRuntime,
  name: string,
  hook: (context: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
) {
  (agent as unknown as {
    registerHook: (
      hookName: string,
      hookFn: (context: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
    ) => void;
  }).registerHook(name, hook);
}

function createEngine(overrides?: {
  chatRaw?: ReturnType<typeof vi.fn>;
  helpRegistry?: {
    hasHelp: ReturnType<typeof vi.fn>;
    getHelp: ReturnType<typeof vi.fn>;
    formatHelpForPrompt: ReturnType<typeof vi.fn>;
  };
}) {
  return new ReActEngine({
    llmService: {
      chatRaw: overrides?.chatRaw ?? vi.fn(),
    } as never,
    toolRegistry: {} as never,
    writeQueue: undefined,
    helpRegistry: overrides?.helpRegistry as never,
  });
}

function createEngineContext(overrides: Partial<Parameters<ReActEngine['execute']>[0]> = {}) {
  return {
    systemPrompt: 'system',
    userMessage: 'user',
    apiTools: [
      {
        type: 'function',
        function: {
          name: 'inventory_service__equip_item',
          description: 'equip',
          parameters: { type: 'object', properties: {} },
        },
      },
    ] as NonNullable<ChatOptions['tools']>,
    allowedFunctionNames: new Set(['inventory_service__equip_item']),
    injectedContext: null,
    injectedMethods: [],
    currentSaveId: 'save-1' as never,
    agentType: 'gamemaster',
    agentKey: 'gamemaster',
    maxIterations: 3,
    forceStructuredOutput: true,
    temperature: 0.7,
    maxTokens: 2048,
    currentAction: 'chat',
    requestScope: new RequestScope({} as unknown as Knex),
    ...overrides,
  };
}

describe('AgentRuntime hook runtime', () => {
  it('getPromptAgentConfig 应返回真实 agent tools、maxIterations 与 toolBudget', () => {
    const agent = createGameMasterAgent({
      toolBudget: {
        maxVisibleTools: 2,
        maxVisibleHelpDocs: 1,
        maxToolSummaryTokens: 300,
        maxHelpSummaryTokens: 200,
        maxOnDemandLoadsPerTurn: 1,
      },
    });
    const outputAgent = createOutputAgent({
      toolBudget: {
        maxVisibleTools: 4,
        maxVisibleHelpDocs: 2,
        maxToolSummaryTokens: 600,
        maxHelpSummaryTokens: 400,
        maxOnDemandLoadsPerTurn: 2,
      },
    });

    agent.registerAgent(outputAgent);

    expect(agent.getPromptAgentConfig('gamemaster')).toEqual({
      tools: expect.arrayContaining(['map_service']),
      maxIterations: 4,
      toolBudget: {
        maxVisibleTools: 2,
        maxVisibleHelpDocs: 1,
        maxToolSummaryTokens: 300,
        maxHelpSummaryTokens: 200,
        maxOnDemandLoadsPerTurn: 1,
      },
    });
    expect(agent.getPromptAgentConfig('output')).toEqual({
      tools: ['dialogue_service'],
      maxIterations: 4,
      toolBudget: {
        maxVisibleTools: 4,
        maxVisibleHelpDocs: 2,
        maxToolSummaryTokens: 600,
        maxHelpSummaryTokens: 400,
        maxOnDemandLoadsPerTurn: 2,
      },
    });
  });

  it('applyToolExposePatch 应写回 toolExposureTrace 与裁剪后的 allowedFunctionNames', () => {
    const promptResult = createPromptBuildResult();
    const patched = applyToolExposePatch(promptResult, {
      allowedFunctionNames: ['map_service__get_current_top_location'],
      apiTools: [
        {
          type: 'function',
          function: {
            name: 'map_service__get_current_top_location',
            description: '查询玩家当前位置',
            parameters: {},
          },
        },
      ],
      toolVisibilityTrace: [
        {
          toolType: 'map_service',
          methodNames: ['get_current_top_location'],
        },
      ],
      toolExposureTrace: {
        visibleTools: [
          {
            toolType: 'map_service',
            methodName: 'get_current_top_location',
            functionName: 'map_service__get_current_top_location',
            summary: '查询玩家当前位置',
            riskLevel: 'read_only',
          },
        ],
        deferredTools: [
          {
            toolType: 'map_service',
            methodName: 'move_to',
            functionName: 'map_service__move_to',
            summary: '查询并执行地点移动',
            riskLevel: 'write_high',
          },
        ],
        visibleHelpSummaries: [],
        budget: {
          maxVisibleTools: 1,
          usedVisibleTools: 1,
          maxVisibleHelpDocs: 0,
          usedVisibleHelpDocs: 0,
          maxToolSummaryTokens: 0,
          usedToolSummaryTokens: 0,
          maxHelpSummaryTokens: 0,
          usedHelpSummaryTokens: 0,
          maxOnDemandLoadsPerTurn: 2,
          usedOnDemandLoads: 0,
        },
        trimmedReasons: ['maxVisibleTools exceeded'],
      },
    });

    expect(patched.allowedFunctionNames).toEqual(new Set(['map_service__get_current_top_location']));
    expect(patched.toolVisibilityTrace).toEqual([
      {
        toolType: 'map_service',
        methodNames: ['get_current_top_location'],
      },
    ]);
    expect(patched.toolExposureTrace).toEqual({
      visibleTools: [
        expect.objectContaining({
          functionName: 'map_service__get_current_top_location',
        }),
      ],
      deferredTools: [
        expect.objectContaining({
          functionName: 'map_service__move_to',
        }),
      ],
      visibleHelpSummaries: [],
      budget: expect.objectContaining({
        maxVisibleTools: 1,
        usedVisibleTools: 1,
      }),
      trimmedReasons: ['maxVisibleTools exceeded'],
    });
  });

  it('before_prompt_build 和 before_tool_expose patch 应影响 PromptContext 与 ReAct context', async () => {
    const agent = createGameMasterAgent({
      toolBudget: {
        maxVisibleTools: 3,
        maxVisibleHelpDocs: 2,
        maxToolSummaryTokens: 500,
        maxHelpSummaryTokens: 300,
        maxOnDemandLoadsPerTurn: 2,
      },
    });
    const buildSpy = vi.fn(async (ctx: {
      templateContext: string | null;
      agentConfig: {
        toolBudget?: {
          maxVisibleTools?: number;
          maxVisibleHelpDocs?: number;
          maxToolSummaryTokens?: number;
          maxHelpSummaryTokens?: number;
          maxOnDemandLoadsPerTurn?: number;
        };
      };
    }) => {
      expect(ctx.templateContext).toBe('hooked template context');
      expect(ctx.agentConfig.toolBudget).toEqual({
        maxVisibleTools: 3,
        maxVisibleHelpDocs: 2,
        maxToolSummaryTokens: 500,
        maxHelpSummaryTokens: 300,
        maxOnDemandLoadsPerTurn: 2,
      });
      return createPromptBuildResult();
    });
    testAccess(agent).deps.promptModule = {
      build: buildSpy,
      rules: { getAllRulesForAgent: vi.fn().mockReturnValue([]) },
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

    registerHook(agent, 'before_prompt_build', async () => ({
      patch: {
        promptContext: {
          templateContext: 'hooked template context',
        },
        modelOverride: {
          model: 'stable-hook-model',
        },
      },
    }));
    registerHook(agent, 'before_tool_expose', async () => ({
      patch: {
        allowedFunctionNames: ['npc_service__inspect_npc'],
      },
    }));

    const response = await (agent as unknown as {
      executeGameMasterReAct: (
        message: AgentMessage,
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
    }).executeGameMasterReAct(
      createMessage(),
      'save-1',
      Date.now(),
      [],
      [],
      [],
      false,
      'original template context',
      'zh-CN',
      { intentHint: 'chat' },
    );

    expect(response.success).toBe(true);
    expect(buildSpy).toHaveBeenCalled();
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'stable-hook-model',
        allowedFunctionNames: new Set(['npc_service__inspect_npc']),
      }),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('before_tool_call patch 应支持参数归一', async () => {
    const chatRaw = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              arguments: JSON.stringify({ inventoryId: 'raw-id' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '{}',
        toolCalls: [],
      });

    const engine = createEngine({ chatRaw });
    const callToolFn = vi.fn(async (): Promise<ToolResult> => ({
      id: 'tool-1' as never,
      toolCallId: 'call-1' as never,
      success: true,
      data: { equipped: true },
      timestamp: Date.now() as never,
      _meta: {
        toolType: 'inventory_service',
        method: 'equip_item',
        params: { inventoryId: 'normalized-id' },
      },
    }));

    await engine.execute(
      createEngineContext(),
      {
        beforeToolCall: async () => ({
          patch: {
            normalizedArguments: { inventoryId: 'normalized-id' },
          },
        }),
      },
      callToolFn,
    );

    expect(callToolFn).toHaveBeenCalledWith(
      'inventory_service',
      'equip_item',
      { inventoryId: 'normalized-id' },
      'save-1',
      'gamemaster',
    );
  });

  it('before_tool_call patch 应支持只读 veto', async () => {
    const chatRaw = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              arguments: JSON.stringify({ inventoryId: 'raw-id' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '{}',
        toolCalls: [],
      });

    const engine = createEngine({ chatRaw });
    const callToolFn = vi.fn();

    const result = await engine.execute(
      createEngineContext(),
      {
        beforeToolCall: async () => ({
          block: true,
          reason: 'readonly-degrade-active',
        }),
      },
      callToolFn,
    );

    expect(callToolFn).not.toHaveBeenCalled();
    expect(result.toolCalls[0]).toEqual(
      expect.objectContaining({
        success: false,
        error: 'readonly-degrade-active',
      }),
    );
  });

  it('after_tool_call patch 应支持结果补丁与 emittedEvents', async () => {
    const chatRaw = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              arguments: JSON.stringify({ inventoryId: 'raw-id' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '{}',
        toolCalls: [],
      });

    const engine = createEngine({ chatRaw });
    const callToolFn = vi.fn(async (): Promise<ToolResult> => ({
      id: 'tool-1' as never,
      toolCallId: 'call-1' as never,
      success: true,
      data: { equipped: false },
      timestamp: Date.now() as never,
      _meta: {
        toolType: 'inventory_service',
        method: 'equip_item',
        params: { inventoryId: 'raw-id' },
      },
    }));

    const result = await engine.execute(
      createEngineContext(),
      {
        afterToolCall: async () => ({
          patch: {
            result: {
              success: true,
              data: { equipped: true, source: 'hook' },
            },
          },
          emittedEvents: [
            { type: 'tool-result-patched', toolName: 'inventory_service__equip_item' },
          ],
        }),
      },
      callToolFn,
    );

    expect(result.toolCalls[0]).toEqual(
      expect.objectContaining({
        success: true,
        data: { equipped: true, source: 'hook' },
        hookEvents: [
          { type: 'tool-result-patched', toolName: 'inventory_service__equip_item' },
        ],
      }),
    );
  });

  it('after_tool_call 部分 patch 应保留原始 success 与审计字段', async () => {
    const chatRaw = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              arguments: JSON.stringify({ inventoryId: 'raw-id' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '{}',
        toolCalls: [],
      });

    const engine = createEngine({ chatRaw });
    const callToolFn = vi.fn(async (): Promise<ToolResult> => ({
      id: 'tool-1' as never,
      toolCallId: 'call-1' as never,
      success: true,
      data: { equipped: false },
      timestamp: Date.now() as never,
      _meta: {
        toolType: 'inventory_service',
        method: 'equip_item',
        params: { inventoryId: 'raw-id' },
      },
      writeOperation: {
        toolType: 'inventory_service',
        method: 'equip_item',
        params: { inventoryId: 'raw-id' },
        result: { equipped: false },
        timestamp: Date.now() as never,
      },
    }));

    const result = await engine.execute(
      createEngineContext(),
      {
        afterToolCall: async () => ({
          patch: {
            result: {
              data: { equipped: true, source: 'patch-only' },
            },
          },
        }),
      },
      callToolFn,
    );

    expect(result.toolCalls[0]).toEqual(
      expect.objectContaining({
        success: true,
        data: { equipped: true, source: 'patch-only' },
        _meta: {
          toolType: 'inventory_service',
          method: 'equip_item',
          params: { inventoryId: 'raw-id' },
        },
        writeOperation: expect.objectContaining({
          toolType: 'inventory_service',
          method: 'equip_item',
        }),
      }),
    );
  });

  it('before_tool_call emittedEvents 应保留到工具调用轨迹', async () => {
    const chatRaw = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              arguments: JSON.stringify({ inventoryId: 'raw-id' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '{}',
        toolCalls: [],
      });

    const engine = createEngine({ chatRaw });
    const callToolFn = vi.fn(async (): Promise<ToolResult> => ({
      id: 'tool-1' as never,
      toolCallId: 'call-1' as never,
      success: true,
      data: { equipped: true },
      timestamp: Date.now() as never,
      _meta: {
        toolType: 'inventory_service',
        method: 'equip_item',
        params: { inventoryId: 'raw-id' },
      },
    }));

    const result = await engine.execute(
      createEngineContext(),
      {
        beforeToolCall: async () => ({
          emittedEvents: [
            { type: 'tool-call-normalized', toolName: 'inventory_service__equip_item' },
          ],
        }),
        afterToolCall: async () => ({
          emittedEvents: [
            { type: 'tool-result-observed', toolName: 'inventory_service__equip_item' },
          ],
        }),
      },
      callToolFn,
    );

    expect(result.toolCalls[0]).toEqual(
      expect.objectContaining({
        hookEvents: [
          { type: 'tool-call-normalized', toolName: 'inventory_service__equip_item' },
          { type: 'tool-result-observed', toolName: 'inventory_service__equip_item' },
        ],
      }),
    );
  });

  it('autoLoadOnFirstUse 找不到帮助正文时不应扣减预算且应继续执行真实工具调用', async () => {
    const chatRaw = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              arguments: JSON.stringify({ inventoryId: 'raw-id' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '{}',
        toolCalls: [],
      });

    const helpRegistry = {
      hasHelp: vi.fn().mockReturnValue(true),
      getHelp: vi.fn().mockResolvedValue(null),
      formatHelpForPrompt: vi.fn(),
    };
    const engine = createEngine({ chatRaw, helpRegistry });
    const callToolFn = vi.fn(async (): Promise<ToolResult> => ({
      id: 'tool-1' as never,
      toolCallId: 'call-1' as never,
      success: true,
      data: { equipped: true },
      timestamp: Date.now() as never,
      _meta: {
        toolType: 'inventory_service',
        method: 'equip_item',
        params: { inventoryId: 'raw-id' },
      },
    }));
    const syncToolExposureState = vi.fn();
    const toolExposureState = {
      maxOnDemandLoadsPerTurn: 1,
      usedOnDemandLoads: 0,
    };

    const result = await engine.execute(
      createEngineContext({
        autoLoadOnFirstUse: true,
        injectedMethods: [],
        toolExposureState,
        syncToolExposureState,
      }),
      undefined,
      callToolFn,
    );

    expect(helpRegistry.getHelp).toHaveBeenCalledWith('inventory_service', 'equip_item');
    expect(callToolFn).toHaveBeenCalledTimes(1);
    expect(result.toolCalls[0]).toEqual(
      expect.objectContaining({
        success: true,
        data: { equipped: true },
      }),
    );
    expect(toolExposureState.usedOnDemandLoads).toBe(0);
    expect(syncToolExposureState).not.toHaveBeenCalled();
  });

  it('maxOnDemandLoadsPerTurn 应在每轮 ReAct 决策前重置，而不是整次请求累计', async () => {
    const chatRaw = vi
      .fn()
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              arguments: JSON.stringify({ inventoryId: 'item-1' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          {
            id: 'call-2',
            type: 'function',
            function: {
              name: 'inventory_service__use_item',
              arguments: JSON.stringify({ inventoryId: 'item-2' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '{}',
        toolCalls: [],
      });

    const helpRegistry = {
      hasHelp: vi.fn().mockReturnValue(true),
      getHelp: vi.fn().mockImplementation(async (_toolType: string, method: string) => `help:${method}`),
      formatHelpForPrompt: vi.fn().mockImplementation((content: string, toolType: string, method: string) =>
        `<tool_help tool="${toolType}" method="${method}">${content}</tool_help>`,
      ),
    };
    const engine = createEngine({ chatRaw, helpRegistry });
    const callToolFn = vi.fn(async (): Promise<ToolResult> => ({
      id: 'tool-1' as never,
      toolCallId: 'call-x' as never,
      success: true,
      data: {},
      timestamp: Date.now() as never,
      _meta: {
        toolType: 'inventory_service',
        method: 'equip_item',
        params: {},
      },
    }));
    const syncToolExposureState = vi.fn();
    const toolExposureState = {
      maxOnDemandLoadsPerTurn: 1,
      usedOnDemandLoads: 0,
    };

    await engine.execute(
      createEngineContext({
        autoLoadOnFirstUse: true,
        injectedMethods: [],
        toolExposureState,
        syncToolExposureState,
        apiTools: [
          {
            type: 'function',
            function: {
              name: 'inventory_service__equip_item',
              description: 'equip',
              parameters: { type: 'object', properties: {} },
            },
          },
          {
            type: 'function',
            function: {
              name: 'inventory_service__use_item',
              description: 'use',
              parameters: { type: 'object', properties: {} },
            },
          },
        ] as NonNullable<ChatOptions['tools']>,
        allowedFunctionNames: new Set([
          'inventory_service__equip_item',
          'inventory_service__use_item',
        ]),
      }),
      undefined,
      callToolFn,
    );

    expect(helpRegistry.getHelp).toHaveBeenCalledTimes(2);
    expect(helpRegistry.getHelp).toHaveBeenNthCalledWith(1, 'inventory_service', 'equip_item');
    expect(helpRegistry.getHelp).toHaveBeenNthCalledWith(2, 'inventory_service', 'use_item');
    expect(callToolFn).not.toHaveBeenCalled();
    expect(syncToolExposureState).toHaveBeenCalledTimes(4);
    expect(toolExposureState.usedOnDemandLoads).toBe(0);
  });

  it('after_agent_fail 应返回 recovery plan 并驱动稳定模型重试', async () => {
    const agent = createGameMasterAgent();

    testAccess(agent).deps.promptModule = {
      build: vi.fn().mockResolvedValue(createPromptBuildResult()),
      rules: { getAllRulesForAgent: vi.fn().mockReturnValue([]) },
      skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
    } as never;
    const executeSpy = vi.spyOn(
      testAccess(agent).reactEngine,
      'execute',
    )
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({
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

    registerHook(agent, 'after_agent_fail', async () => ({
      patch: {
        recovery: {
          action: 'retry_with_stable_model',
          reason: 'provider-timeout',
          stableModel: 'stable-model',
        },
      },
    }));

    const response = await (agent as unknown as {
      executeGameMasterReAct: (
        message: AgentMessage,
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
    }).executeGameMasterReAct(
      createMessage(),
      'save-1',
      Date.now(),
      [],
      [],
      [],
      false,
      'template context',
      'zh-CN',
      { intentHint: 'chat' },
    );

    expect(response.success).toBe(true);
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(executeSpy.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        model: 'stable-model',
      }),
    );
  });

  it('请求级副本应用 hookPolicies 不应回写原始 Agent 配置', () => {
    const agent = createGameMasterAgent();

    (agent as unknown as {
      applyHookPolicies: (policies?: Record<string, unknown>) => void;
      getHookPolicies: () => Record<string, unknown> | undefined;
      createRequestScopedCopy: () => AgentRuntime;
    }).applyHookPolicies({
      disable: ['after_compaction'],
      recovery: {
        enableFallbackAgent: true,
      },
    });

    const scoped = (agent as unknown as {
      createRequestScopedCopy: () => AgentRuntime;
    }).createRequestScopedCopy();

    (scoped as unknown as {
      applyHookPolicies: (policies?: Record<string, unknown>) => void;
      getHookPolicies: () => Record<string, unknown> | undefined;
    }).applyHookPolicies({
      disable: ['before_compaction'],
      recovery: {
        enableFallbackAgent: false,
      },
    });

    expect((agent as unknown as {
      getHookPolicies: () => Record<string, unknown> | undefined;
    }).getHookPolicies()).toEqual({
      disable: ['after_compaction'],
      recovery: {
        enableFallbackAgent: true,
      },
    });
    expect((scoped as unknown as {
      getHookPolicies: () => Record<string, unknown> | undefined;
    }).getHookPolicies()).toEqual({
      disable: ['before_compaction'],
      recovery: {
        enableFallbackAgent: false,
      },
    });
  });

  it('applyHookPolicies 后已注册的自定义 Hook 仍应保留', async () => {
    const agent = createGameMasterAgent();
    const observed: string[] = [];

    registerHook(agent, 'after_agent_fail', async () => {
      observed.push('custom-hook');
      return {
        patch: {
          recovery: {
            action: 'explain_only',
            reason: 'custom failure',
          },
        },
      };
    });

    (agent as unknown as {
      applyHookPolicies: (policies?: Record<string, unknown>) => void;
      executeReActWithRecovery: (
        reactContext: Record<string, unknown>,
        hooks: Record<string, unknown> | undefined,
        callToolFn: (...args: unknown[]) => Promise<ToolResult>,
        requestId: string,
        agentRunId: string,
        failureStage: string,
        reqCtx: Record<string, unknown>,
      ) => Promise<{ content: string }>;
    }).applyHookPolicies({
      disable: ['before_compaction'],
    });

    const result = await (agent as unknown as {
      executeReActWithRecovery: (
        reactContext: Record<string, unknown>,
        hooks: Record<string, unknown> | undefined,
        callToolFn: (...args: unknown[]) => Promise<ToolResult>,
        requestId: string,
        agentRunId: string,
        failureStage: string,
        reqCtx: Record<string, unknown>,
      ) => Promise<{ content: string }>;
    }).executeReActWithRecovery(
      createEngineContext(),
      undefined,
      vi.fn(async (): Promise<ToolResult> => ({
        id: 'tool-1' as never,
        toolCallId: 'call-1' as never,
        success: true,
        data: {},
        timestamp: Date.now() as never,
      })),
      'req-custom',
      'run-custom',
      'react-loop',
      { intentHint: 'chat' },
    );

    expect(observed).toEqual(['custom-hook']);
    expect(JSON.parse(result.content)).toEqual({
      message: '当前请求未执行写入操作：custom failure',
      recovery: {
        action: 'explain_only',
        reason: 'custom failure',
      },
    });
  });

  it('after_agent_fail 返回 fallback_agent 时应转换为结构化保守回复', async () => {
    const agent = createGameMasterAgent();
    vi.spyOn(
      testAccess(agent).reactEngine,
      'execute',
    ).mockRejectedValue(new Error('provider timeout'));

    registerHook(agent, 'after_agent_fail', async () => ({
      patch: {
        recovery: {
          action: 'fallback_agent',
          reason: 'provider timeout',
          fallbackAgentType: 'output',
        },
      },
    }));

    const result = await (agent as unknown as {
      executeReActWithRecovery: (
        reactContext: Record<string, unknown>,
        hooks: Record<string, unknown> | undefined,
        callToolFn: (...args: unknown[]) => Promise<ToolResult>,
        requestId: string,
        agentRunId: string,
        failureStage: string,
        reqCtx: Record<string, unknown>,
      ) => Promise<{ content: string; iterations: number; toolCalls: ToolResult[] }>;
    }).executeReActWithRecovery(
      createEngineContext(),
      undefined,
      vi.fn(async (): Promise<ToolResult> => ({
        id: 'tool-1' as never,
        toolCallId: 'call-1' as never,
        success: true,
        data: {},
        timestamp: Date.now() as never,
      })),
      'req-1',
      'run-1',
      'react-loop',
      { intentHint: 'chat' },
    );

    expect(JSON.parse(result.content)).toEqual({
      message: '当前处理链路已切换到保守回复模式：provider timeout',
      recovery: {
        action: 'fallback_agent',
        reason: 'provider timeout',
        fallbackAgentType: 'output',
      },
    });
    expect(result.iterations).toBe(0);
    expect(result.toolCalls).toEqual([]);
  });

  it('after_agent_fail 返回 explain_only 时应输出解释而不再抛错', async () => {
    const agent = createGameMasterAgent();
    vi.spyOn(
      testAccess(agent).reactEngine,
      'execute',
    ).mockRejectedValue(new Error('permission denied for write operation'));

    registerHook(agent, 'after_agent_fail', async () => ({
      patch: {
        recovery: {
          action: 'explain_only',
          reason: 'permission denied for write operation',
        },
      },
    }));

    const result = await (agent as unknown as {
      executeReActWithRecovery: (
        reactContext: Record<string, unknown>,
        hooks: Record<string, unknown> | undefined,
        callToolFn: (...args: unknown[]) => Promise<ToolResult>,
        requestId: string,
        agentRunId: string,
        failureStage: string,
        reqCtx: Record<string, unknown>,
      ) => Promise<{ content: string; iterations: number; toolCalls: ToolResult[] }>;
    }).executeReActWithRecovery(
      createEngineContext(),
      undefined,
      vi.fn(async (): Promise<ToolResult> => ({
        id: 'tool-1' as never,
        toolCallId: 'call-1' as never,
        success: true,
        data: {},
        timestamp: Date.now() as never,
      })),
      'req-2',
      'run-2',
      'react-loop',
      { intentHint: 'chat' },
    );

    expect(JSON.parse(result.content)).toEqual({
      message: '当前请求未执行写入操作：permission denied for write operation',
      recovery: {
        action: 'explain_only',
        reason: 'permission denied for write operation',
      },
    });
    expect(result.iterations).toBe(0);
    expect(result.toolCalls).toEqual([]);
  });

  it('output Agent 的终态恢复结果应保持 dialogue/ui 契约', async () => {
    const agent = createOutputAgent();
    vi.spyOn(
      testAccess(agent).reactEngine,
      'execute',
    ).mockRejectedValue(new Error('provider timeout'));

    registerHook(agent, 'after_agent_fail', async () => ({
      patch: {
        recovery: {
          action: 'fallback_agent',
          reason: 'provider timeout',
          fallbackAgentType: 'output',
        },
      },
    }));

    const result = await (agent as unknown as {
      executeReActWithRecovery: (
        reactContext: Record<string, unknown>,
        hooks: Record<string, unknown> | undefined,
        callToolFn: (...args: unknown[]) => Promise<ToolResult>,
        requestId: string,
        agentRunId: string,
        failureStage: string,
        reqCtx: Record<string, unknown>,
      ) => Promise<{ content: string }>;
    }).executeReActWithRecovery(
      createEngineContext({
        agentKey: 'output',
      }),
      undefined,
      vi.fn(async (): Promise<ToolResult> => ({
        id: 'tool-1' as never,
        toolCallId: 'call-1' as never,
        success: true,
        data: {},
        timestamp: Date.now() as never,
      })),
      'req-output',
      'run-output',
      'react-loop',
      { intentHint: 'chat' },
    );

    expect(JSON.parse(result.content)).toEqual({
      dialogue: {
        messages: [{
          speaker: '旁白',
          content: '当前处理链路已切换到保守回复模式：provider timeout',
          messageType: 'narrator',
        }],
      },
      ui: {
        intensity: 'low',
      },
    });
  });

  it('before_compaction 应支持 veto，after_compaction 应观测已执行压缩项', async () => {
    const agent = createGameMasterAgent();
    const checkAndCompress = vi.fn().mockResolvedValue(undefined);
    const compressAgentContexts = vi.fn().mockResolvedValue(undefined);
    const compressNPCMemories = vi.fn().mockResolvedValue(undefined);
    const observedLabels: string[] = [];

    testAccess(agent).deps.contextCompressor = {
      checkAndCompress,
    } as never;
    testAccess(agent).deps.writeQueue = undefined;
    // M3 模块拆分：压缩职责迁入 MemoryController（deps 构造期捕获），
    // deps 后置替换后需经私有工厂重建以绑定新 deps，再 spy 其实例私有方法
    const memoryController = (agent as unknown as {
      buildMemoryController: () => { triggerCompression: (saveId: string) => void };
    }).buildMemoryController();
    testAccess(agent).memoryController = memoryController;
    vi.spyOn(memoryController as never, 'compressAgentContexts' as never).mockImplementation(compressAgentContexts);
    vi.spyOn(memoryController as never, 'compressNPCMemories' as never).mockImplementation(compressNPCMemories);

    registerHook(agent, 'before_compaction', async (context) => {
      const payload = (context.payload ?? {}) as { label?: string };
      if (payload.label === 'compressAgentContexts') {
        return {
          blocked: true,
          reason: 'skip-agent-contexts',
        };
      }

      return {};
    });
    registerHook(agent, 'after_compaction', async (context) => {
      const payload = (context.payload ?? {}) as { label?: string };
      if (payload.label) {
        observedLabels.push(payload.label);
      }
      return {};
    });

    memoryController.triggerCompression('save-1');

    await vi.waitFor(() => {
      expect(checkAndCompress).toHaveBeenCalledWith('save-1');
      expect(compressAgentContexts).not.toHaveBeenCalled();
      expect(compressNPCMemories).toHaveBeenCalledWith('save-1');
      expect(observedLabels.sort()).toEqual(['checkAndCompress', 'checkMemoryThresholds', 'compressNPCMemories'].sort());
    });
  });
});