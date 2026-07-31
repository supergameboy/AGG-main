import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime.js';
import type { IntegrationResult } from '../coordinator/types.js';
import type { ReActEngineResult } from '../ReActEngine.js';
import { StoryKernel } from '../story/StoryKernel.js';
import { StoryPostReactPipeline } from '../story/StoryPostReactPipeline.js';
import { StagingPool } from '../../services/StagingPool.js';
import { EntityGraphLayer } from '../prompt/layers/entity-graph-layer.js';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import { RequestScope } from '../../services/RequestScope.js';
import type { Knex } from 'knex';

// AP-L1: StagingPool 构造函数注入 IDevTraceHook，测试提供最小 mock
const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

/**
 * 测试用 Agent 访问类型：暴露私有 deps/gmDeps 容器，便于测试通过容器注入 mock。
 *
 * 设计原因：AgentRuntime 通过 this.deps.xxx / this.gmDeps?.xxx 访问依赖，
 * 测试必须通过同一容器注入 mock，而不是直接替换实例属性。
 * gmDeps === deps（构造时同引用），所以两者可互换访问。
 */
type TestAgent = {
  deps: Record<string, unknown>;
  gmDeps: Record<string, unknown>;
  reactEngine: { execute: (...args: unknown[]) => Promise<unknown> };
  [key: string]: unknown;
};

function createGameMasterAgent() {
  const agent = new AgentRuntime(
    {
      llmService: {} as never,
      db: vi.fn() as never,
      promptModule: {
        rules: { getAllRulesForAgent: vi.fn().mockReturnValue([]) },
        skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
      } as never,
      devTraceCollector: () => null,
      devTraceHook: mockDevTraceHook,
      createTraceCollector: () => ({}) as never,
      createResponsePool: () => ({ stage: vi.fn(), flush: vi.fn().mockReturnValue({ uiDirective: undefined, uiIntensity: undefined, panelUpdates: {}, time: undefined }), hasUIDirective: vi.fn().mockReturnValue(false), hasPanelUpdates: vi.fn().mockReturnValue(false), clear: vi.fn() }) as never,
      createStagingPool: () => new StagingPool(mockDevTraceHook),
      createShadowStateLayer: () => ({ read: vi.fn().mockReturnValue(undefined), readOne: vi.fn().mockReturnValue(undefined), ensureSnapshot: vi.fn().mockResolvedValue(undefined), apply: vi.fn(), reset: vi.fn() }) as never,
      createRequestScope: () => new RequestScope({} as unknown as Knex),
      // GM deps 键必须存在，isGMAgentDeps 才会返回 true 并设置 gmDeps
      storyKernel: {} as never,
      responseBuilder: {} as never,
      mapServiceFactory: (() => Promise.resolve({} as never)) as never,
      npcServiceFactory: (() => Promise.resolve({} as never)) as never,
      isInCombat: (() => Promise.resolve(false)) as never,
      gameTimeService: {} as never,
      resultIntegrator: { clearWriteOperationLog: vi.fn() } as never,
      entityGraphLayer: new EntityGraphLayer(),
      entityGraphService: {} as never,
      // post-flush 事件处理：drainPendingEvents 返回空数组，不触发 bootstrapEventHandlers
      requestEventBridge: { drainPendingEvents: () => [] } as never,
    } as never,
    {
      name: 'GameMaster',
      tools: [],
      max_iterations: 4,
      force_structured_output: true,
      isSubAgent: false,
    } as never,
    'gamemaster',
    'test system prompt',
  );

  return agent as unknown as TestAgent;
}

describe('AgentRuntime post-react 主链', () => {
  it('Pre-react 应把模板、snapshot、projection、worldState、sceneNPC、战斗态与 entity-graph 送入 story directive 生成链', async () => {
    const agent = createGameMasterAgent();
    const storyRequestContext = {
      snapshot: {
        context: {
          currentChapter: 'chapter_1',
          mainQuest: '调查灰雾',
        },
        history: {
          events: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        },
        chapter: {
          chapter: 'chapter_1',
          mainQuest: '调查灰雾',
          level: 1,
        },
      },
      projection: {
        chapter: 'chapter_1',
        mainQuest: '调查灰雾',
      },
      worldState: {
        nodeCount: 2,
        edgeCount: 1,
        nodesByType: { npc: 1, location: 1 },
        edgesByRelation: { located_in: 1 },
      },
    };

    agent.gmDeps.storyKernel = {
      prepareRequestContext: vi.fn().mockResolvedValue(storyRequestContext),
      isPacingEnabled: vi.fn().mockReturnValue(false),
    };
    agent.deps.promptModule = {
      build: vi.fn().mockResolvedValue({
        systemPrompt: 'gm system prompt',
        userPrompt: 'gm user prompt',
        apiTools: [],
        allowedFunctionNames: new Set<string>(),
      }),
    };
    vi.spyOn(agent.reactEngine, 'execute').mockResolvedValue({
      content: '{}',
      iterations: 1,
      toolCalls: [],
    });
    agent.buildGameMasterFinalResponse = vi.fn().mockResolvedValue({
      success: true,
      data: {},
      messages: [],
    });

    vi.spyOn(agent as never, 'executeContextInjection' as never).mockResolvedValue({
      context: null,
      injectedMethods: [],
    });
    vi.spyOn(EntityGraphLayer.prototype, 'build').mockResolvedValue({
      content: '<entity_graph><node id="npc-chief" /></entity_graph>',
    } as never);

    const directiveSpy = vi
      .spyOn(agent as never, 'generateStoryDirective' as never)
      .mockResolvedValue(null);

    await (agent.executeGameMasterReAct as (  // eslint-disable-line @typescript-eslint/no-explicit-any
      message: Record<string, unknown>,
      saveId: string,
      startTime: number,
      sceneNPCs: Array<{ id: string; name: string; role?: string }>,
      validatedNpcIds: string[],
      invalidNpcIds: string[],
      inCombat: boolean,
      templateContext: string | null,
      requestLanguage: string | null,
      reqCtx: Record<string, unknown>,
    ) => Promise<unknown>)(
      {
        payload: {
          action: 'chat',
          data: {
            playerInput: '我先和村长聊聊灰雾',
          },
        },
      },
      'save-pre-react',
      Date.now(),
      [{ id: 'npc-chief', name: '村长艾德温', role: 'chief' }],
      ['npc-chief'],
      [],
      false,
      '模板世界观上下文',
      'zh-CN',
      { intentHint: 'chat' },
    );

    expect(directiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        saveId: 'save-pre-react',
        templateContext: '模板世界观上下文',
        storySnapshot: storyRequestContext.snapshot,
        projection: storyRequestContext.projection,
        worldState: storyRequestContext.worldState,
        sceneNPCs: [{ id: 'npc-chief', name: '村长艾德温', role: 'chief' }],
        entityGraphXml: '<entity_graph><node id="npc-chief" /></entity_graph>',
        inCombat: false,
      }),
    );
  });

  it('generateStoryDirective 应优先使用请求上下文 projection 作为当前故事投影真源', async () => {
    const agent = createGameMasterAgent();
    const normalizeStoryDirective = vi.fn().mockReturnValue({
      requiredLayer1Agents: [],
      optionalLayer1Agents: [],
      projection: { chapter: 'chapter_projection', mainQuest: '推进投影主线' },
    });
    const llmDispatch = vi.fn().mockResolvedValue({
      success: true,
      response: {
        content: JSON.stringify({
          requiredLayer1Agents: [],
          optionalLayer1Agents: [],
          projection: {},
        }),
      },
      metrics: { selectedKeyIndex: 0, waitMs: 0, attemptCount: 1, cooldownTriggered: false },
    });

    agent.gmDeps.storyKernel = {
      normalizeStoryDirective,
      isPacingEnabled: vi.fn().mockReturnValue(false),
    };
    // M9：generateStoryDirective 经 chatViaDispatcher → deps.llmRequestDispatcher.dispatch
    agent.deps.llmRequestDispatcher = {
      dispatch: llmDispatch,
    };

    vi.spyOn(agent as never, 'loadPromptFile' as never).mockReturnValue('story orchestration prompt');

    const result = await (agent.generateStoryDirective as ( // eslint-disable-line @typescript-eslint/no-explicit-any
      context: Record<string, unknown>,
    ) => Promise<unknown>)({
      saveId: 'save-projection',
      message: {
        payload: {
          action: 'chat',
          data: {
            playerInput: '继续调查灰雾',
          },
        },
      },
      reqCtx: { intentHint: 'chat' },
      templateContext: '模板上下文',
      storySnapshot: {
        context: {
          currentChapter: 'chapter_snapshot',
          mainQuest: '旧主线',
        },
        history: {
          events: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        },
        chapter: {
          chapter: 'chapter_snapshot',
          mainQuest: '旧主线',
          level: 1,
        },
      },
      projection: {
        chapter: 'chapter_projection',
        mainQuest: '推进投影主线',
      },
      worldState: undefined,
      sceneNPCs: [],
      inCombat: false,
      entityGraphXml: null,
    });

    expect(result).toEqual({
      requiredLayer1Agents: [],
      optionalLayer1Agents: [],
      projection: { chapter: 'chapter_projection', mainQuest: '推进投影主线' },
    });
    expect(llmDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('章节: chapter_projection'),
          }),
        ]),
        saveId: 'save-projection',
        agentKey: 'gamemaster',
      }),
    );
    expect(llmDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('主线任务: 推进投影主线'),
          }),
        ]),
        saveId: 'save-projection',
        agentKey: 'gamemaster',
      }),
    );
    expect(normalizeStoryDirective).toHaveBeenCalledWith(
      expect.any(Object),
      { chapter: 'chapter_projection', mainQuest: '推进投影主线' },
    );
  });

  it('ui_interaction 应先经过 preprocessAction 再进入 generateStoryDirective 与 LLM 输入主链', async () => {
    const agent = createGameMasterAgent();
    const storyRequestContext = {
      snapshot: {
        context: {
          currentChapter: 'chapter_ui',
          mainQuest: '处理灰雾委托',
        },
        history: {
          events: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        },
        chapter: {
          chapter: 'chapter_ui',
          mainQuest: '处理灰雾委托',
          level: 1,
        },
      },
      projection: {
        chapter: 'chapter_ui',
        mainQuest: '处理灰雾委托',
      },
      worldState: {
        nodeCount: 1,
        edgeCount: 0,
        nodesByType: { npc: 1 },
        edgesByRelation: {},
      },
    };
    const llmDispatch = vi.fn().mockResolvedValue({
      success: true,
      response: {
        content: JSON.stringify({
          requiredLayer1Agents: [],
          optionalLayer1Agents: [],
          projection: {},
        }),
      },
      metrics: { selectedKeyIndex: 0, waitMs: 0, attemptCount: 1, cooldownTriggered: false },
    });

    agent.resolveRequestLanguage = vi.fn().mockResolvedValue('zh-CN');
    agent.buildRequestTemplateRuntime = vi.fn().mockResolvedValue({ templateContext: '模板上下文' });
    agent.resolveTemplateId = vi.fn().mockResolvedValue('template-medieval');
    agent.buildSceneNPCContext = vi.fn().mockResolvedValue([{ id: 'npc-chief', name: '村长艾德温' }]);
    agent.validateTargetNpcIds = vi.fn().mockReturnValue({ validIds: [], invalidNpcIds: [] });
    agent.gmDeps.storyKernel = {
      prepareRequestContext: vi.fn().mockResolvedValue(storyRequestContext),
      normalizeStoryDirective: vi.fn().mockReturnValue({
        requiredLayer1Agents: [],
        optionalLayer1Agents: [],
        projection: storyRequestContext.projection,
      }),
      isPacingEnabled: vi.fn().mockReturnValue(false),
    };
    agent.deps.promptModule = {
      rules: { getAllRulesForAgent: vi.fn().mockReturnValue([]) },
      skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
      build: vi.fn().mockResolvedValue({
        systemPrompt: 'gm system prompt',
        userPrompt: 'gm user prompt',
        apiTools: [],
        allowedFunctionNames: new Set<string>(),
      }),
    };
    // M9：generateStoryDirective 经 chatViaDispatcher → deps.llmRequestDispatcher.dispatch
    agent.deps.llmRequestDispatcher = {
      dispatch: llmDispatch,
    };
    vi.spyOn(agent.reactEngine, 'execute').mockResolvedValue({
      content: '{}',
      iterations: 1,
      toolCalls: [],
    });
    agent.buildGameMasterFinalResponse = vi.fn().mockResolvedValue({
      success: true,
      data: {},
      messages: [],
    });

    vi.spyOn(agent as never, 'executeContextInjection' as never).mockResolvedValue({
      context: null,
      injectedMethods: [],
    });
    vi.spyOn(EntityGraphLayer.prototype, 'build').mockResolvedValue({
      content: '<entity_graph><node id="npc-chief" /></entity_graph>',
    } as never);
    const directiveSpy = vi.spyOn(agent as never, 'generateStoryDirective' as never);

    await (agent.processGameMasterPath as ( // eslint-disable-line @typescript-eslint/no-explicit-any
      message: Record<string, unknown>,
      startTime: number,
    ) => Promise<unknown>)(
      {
        saveId: 'save-ui-interaction',
        payload: {
          action: 'ui_interaction',
          data: {
            interactionType: 'accept_quest',
            target: '灰雾委托',
          },
        },
      },
      Date.now(),
    );

    expect(directiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reqCtx: expect.objectContaining({
          intentHint: 'accept_quest',
        }),
        message: expect.objectContaining({
          payload: expect.objectContaining({
            intentHint: 'accept_quest',
            data: expect.objectContaining({
              interactionMessage: '接受任务 灰雾委托',
            }),
          }),
        }),
      }),
    );
    expect(llmDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('意图: accept_quest'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('内容: 接受任务 灰雾委托'),
          }),
        ]),
        saveId: 'save-ui-interaction',
        agentKey: 'gamemaster',
      }),
    );
  });

  it.each([
    ['playerInput', { playerInput: '接受委托并继续追查', interactionMessage: '不应覆盖 playerInput' }, '接受委托并继续追查'],
    ['interactionMessage', { interactionMessage: '前往铁匠铺询问灰雾线索' }, '前往铁匠铺询问灰雾线索'],
    ['selectedDialogueOption.text', { selectedDialogueOption: { text: '追问村长关于钟声的来源' } }, '追问村长关于钟声的来源'],
    ['selectedDialogueOption.message', { selectedDialogueOption: { message: '查看委托详情' } }, '查看委托详情'],
  ])(
    'generateStoryDirective 在非 chat 场景应解析 %s 作为玩家输入',
    async (_source, data, expectedInput) => {
      const agent = createGameMasterAgent();
      const normalizeStoryDirective = vi.fn().mockReturnValue({
        requiredLayer1Agents: [],
        optionalLayer1Agents: [],
        projection: { chapter: 'chapter_1', mainQuest: '调查灰雾' },
      });
      const llmDispatch = vi.fn().mockResolvedValue({
        success: true,
        response: {
          content: JSON.stringify({
            requiredLayer1Agents: [],
            optionalLayer1Agents: [],
            projection: {},
          }),
        },
        metrics: { selectedKeyIndex: 0, waitMs: 0, attemptCount: 1, cooldownTriggered: false },
      });

      agent.gmDeps.storyKernel = {
        normalizeStoryDirective,
        isPacingEnabled: vi.fn().mockReturnValue(false),
      };
      // M9：generateStoryDirective 经 chatViaDispatcher → deps.llmRequestDispatcher.dispatch
      agent.deps.llmRequestDispatcher = {
        dispatch: llmDispatch,
      };

      vi.spyOn(agent as never, 'loadPromptFile' as never).mockReturnValue('story orchestration prompt');

      await (agent.generateStoryDirective as ( // eslint-disable-line @typescript-eslint/no-explicit-any
        context: Record<string, unknown>,
      ) => Promise<unknown>)({
        saveId: 'save-non-chat',
        message: {
          payload: {
            action: 'select_option',
            data,
          },
        },
        reqCtx: { intentHint: 'dialogue' },
        templateContext: '模板上下文',
        storySnapshot: {
          context: {
            currentChapter: 'chapter_1',
            mainQuest: '调查灰雾',
          },
          history: {
            events: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          },
          chapter: {
            chapter: 'chapter_1',
            mainQuest: '调查灰雾',
            level: 1,
          },
        },
        projection: {
          chapter: 'chapter_1',
          mainQuest: '调查灰雾',
        },
        worldState: undefined,
        sceneNPCs: [],
        inCombat: false,
        entityGraphXml: null,
      });

      expect(llmDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(`内容: ${expectedInput}`),
            }),
          ]),
          saveId: 'save-non-chat',
          agentKey: 'gamemaster',
        }),
      );
      expect(normalizeStoryDirective).toHaveBeenCalled();
    },
  );

  it('应把显式 postReviewDecision 经过真实 pipeline 与 runtime commit 主链写回，且不丢 todo/continuity 字段', async () => {
    const agent = createGameMasterAgent();
    agent.currentAction = 'chat';
    agent.currentStoryDirective = {
      storyGoal: '确认村庄异变来源',
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      todoList: ['确认异变来源', '补齐 NPC 反应'],
      projection: {
        chapter: 'chapter_1',
        mainQuest: '调查村口骚动的来源',
      },
    };

    const domain = {
      getSnapshot: vi.fn().mockResolvedValue({
        context: {
          agentContext: {
            state: {
              runtimeState: {
                storyPhase: 'opening',
                activeHooks: ['hook-village-chief'],
              },
              projection: {
                chapter: 'chapter_1',
                mainQuest: '调查村口骚动的来源',
              },
            },
          },
          saveInfo: null,
        },
        history: {
          events: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        },
        chapter: {
          chapter: 'chapter_1',
          mainQuest: '调查村口骚动的来源',
          level: 1,
        },
      }),
      saveStoryState: vi.fn().mockResolvedValue(undefined),
      addStoryEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    };

    const postReviewDecision = {
      taskReview: {
        completion: 'partial',
        missingRequirements: ['缺少 NPC 反应'],
      },
      continuityAudit: {
        passed: false,
        issues: [
          {
            dimension: 'timeline',
            severity: 'error',
            problem: 'NPC 反应顺序错误',
            expectedValue: '先确认线索，再回应玩家',
            actualValue: '直接跳到结论',
            suggestion: '补齐 NPC 反馈',
          },
        ],
      },
      auditResult: {
        pass: false,
        failures: [],
        rootCause: 'llm_understanding_error',
        confidence: 0.8,
      },
      todoCompletion: {
        completedItems: ['确认异变来源'],
        incompleteItems: ['补齐 NPC 反应'],
        overallCompletion: 'partial',
      },
      secondLayerDecision: {
        shouldSchedule: true,
        reason: '需要补齐 NPC 反应',
        agents: ['npc_party', 'output'],
      },
    };

    const responseBuilder = {
      triggerAutoSave: vi.fn().mockResolvedValue(undefined),
      getGameTimeData: vi.fn().mockResolvedValue(undefined),
    };

    const storyKernel = new StoryKernel(domain as never);
    const buildRuntimeStoryStateCommitSpy = vi.spyOn(storyKernel, 'buildRuntimeStoryStateCommit');
    const saveStoryStateSpy = vi.spyOn(storyKernel, 'saveStoryState');

    agent.gmDeps.responseBuilder = responseBuilder;
    agent.gmDeps.storyKernel = storyKernel;
    agent.storyPostReactPipeline = new StoryPostReactPipeline({});

    const reviewSpy = vi.spyOn(agent as never, 'reviewStoryConsistency' as never).mockResolvedValue(postReviewDecision);

    const integrationResult: IntegrationResult = {
      success: true,
      data: {},
      writeOperations: [],
      agentResponses: new Map(),
      needsFurtherProcessing: false,
      fallbackSuggestions: [],
    };
    const reactResult: ReActEngineResult = {
      content: '最终输出',
      iterations: 1,
      toolCalls: [],
    };
    const stagingPool = new StagingPool(mockDevTraceHook);

    await (agent.postProcessReActResult as (  // eslint-disable-line @typescript-eslint/no-explicit-any
      integrationResult: IntegrationResult,
      saveId: string,
      invalidNpcIds: string[],
      reactResult: ReActEngineResult,
      stagingPool: unknown,
      shadowState: unknown,
    ) => Promise<unknown>)(integrationResult, 'save-1', [], reactResult, stagingPool, {} as never);

    expect(reviewSpy).toHaveBeenCalled();
    expect(buildRuntimeStoryStateCommitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projection: {
          chapter: 'chapter_1',
          mainQuest: '调查村口骚动的来源',
        },
      }),
      expect.objectContaining({
        storyDirective: agent.currentStoryDirective,
        resolvedLayer1Agents: ['npc_party'],
        needAgentReasons: ['需要补齐 NPC 反应'],
        postReviewDecision: expect.objectContaining({
          todoCompletion: expect.objectContaining({
            overallCompletion: 'partial',
            incompleteItems: ['补齐 NPC 反应'],
          }),
          continuityAudit: expect.objectContaining({
            passed: false,
            issues: [
              expect.objectContaining({
                dimension: 'timeline',
                severity: 'error',
              }),
            ],
          }),
        }),
        postReactTraceSummary: expect.objectContaining({
          resolvedLayer1Agents: ['npc_party'],
          decisionSummary: expect.objectContaining({
            todoCompletion: 'partial',
            auditPassed: false,
            secondLayerDecisionValid: true,
          }),
        }),
      }),
    );
    expect(saveStoryStateSpy).toHaveBeenCalledWith(
      'save-1',
      expect.objectContaining({
        runtimeState: expect.objectContaining({
          lastResolvedLayer1Agents: ['npc_party'],
          lastNeedAgentReasons: ['需要补齐 NPC 反应'],
          lastPostReviewDecision: expect.objectContaining({
            todoCompletion: expect.objectContaining({
              overallCompletion: 'partial',
              completedItems: ['确认异变来源'],
              incompleteItems: ['补齐 NPC 反应'],
            }),
            continuityAudit: expect.objectContaining({
              passed: false,
              issues: [
                expect.objectContaining({
                  dimension: 'timeline',
                  severity: 'error',
                }),
              ],
            }),
          }),
          lastPostReactTraceSummary: expect.objectContaining({
            resolvedLayer1Agents: ['npc_party'],
            repairReasons: ['audit:llm_understanding_error'],
          }),
          lastRepairRoundCount: 0,
        }),
      }),
    );
    expect(agent.currentPostReviewDecision).toEqual(postReviewDecision);
  });
});
