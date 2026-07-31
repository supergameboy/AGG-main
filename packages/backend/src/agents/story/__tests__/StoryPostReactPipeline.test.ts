import { describe, expect, it } from 'vitest';
import { StoryPostReactPipeline } from '../StoryPostReactPipeline.js';

describe('StoryPostReactPipeline', () => {
  it('应返回统一的 Post-react 结果骨架', async () => {
    const pipeline = new StoryPostReactPipeline({} as never);

    const result = await pipeline.run({
      saveId: 'save-1',
      storyRequestContext: {} as never,
      storyDirective: null,
      reactResult: {} as never,
      integrationResult: {} as never,
      stagingPool: {} as never,
      shadowState: {} as never,
    });

    expect(result).toMatchObject({
      postReviewDecision: null,
      resolvedLayer1Agents: [],
      needAgentReasons: [],
      requiresRepair: false,
    });
    expect(result.storyStateCommit).toEqual({
      runtimeState: {},
      projection: {
        chapter: null,
        mainQuest: null,
      },
    });
    expect(result.devtoolsTrace).toMatchObject({
      phase: 'post-react',
      repairRoundCount: 0,
      requiresRepair: false,
      decisionSummary: {
        secondLayerDecisionValid: false,
      },
      repairReasons: [],
      resolvedLayer1Agents: [],
      needAgentReasons: [],
      runtimeCommitSummary: {
        wrotePostReviewDecision: false,
        wroteContinuityAudit: false,
        wroteTodoCompletion: false,
        wroteRepairMetadata: false,
      },
    });
  });

  it('应把 secondLayerDecision 与 todoCompletion/auditResult 转成程序结果', async () => {
    const pipeline = new StoryPostReactPipeline({} as never);

    const result = await pipeline.run({
      saveId: 'save-1',
      storyRequestContext: {} as never,
      storyDirective: {
        requiredLayer1Agents: [],
        optionalLayer1Agents: [],
        projection: { chapter: null, mainQuest: null },
        todoList: ['推进剧情'],
      },
      reactResult: {} as never,
      integrationResult: {
        success: true,
        data: {
          unifiedDecision: {
            secondLayerDecision: {
              shouldSchedule: true,
              agents: ['npc_party'],
              reason: '需要补齐 NPC 反应',
              needsDynamicUI: true,
              dynamicUIScenario: 'npc-dialogue',
              dynamicUIReason: '出现新对话状态',
            },
            todoCompletion: { overallCompletion: 'failed' },
            // 方案M迁移：使用 auditResult（AuditResult）替代旧 continuityAudit
            auditResult: {
              pass: false,
              rootCause: 'llm_understanding_error',
              failures: [
                {
                  dimension: 'timeline',
                  severity: 'error',
                  expected: 'A',
                  actual: 'B',
                  reason: '顺序错误',
                  suggestedFix: '修正顺序',
                },
              ],
              confidence: 0.8,
            },
          },
        },
        writeOperations: [],
        agentResponses: new Map(),
        needsFurtherProcessing: false,
        fallbackSuggestions: [],
      },
      stagingPool: {} as never,
      shadowState: {} as never,
    });

    expect(result.resolvedLayer1Agents).toEqual(['npc_party']);
    expect(result.needAgentReasons).toEqual(['需要补齐 NPC 反应']);
    expect(result.requiresRepair).toBe(true);
    expect(result.devtoolsTrace.decisionSummary).toMatchObject({
      storyConsistency: undefined,
      todoCompletion: 'failed',
      auditPassed: false,
      auditRootCause: 'llm_understanding_error',
      secondLayerDecisionValid: true,
    });
  });

  it('应优先消费显式 postReviewDecision，并过滤非可路由 AgentType', async () => {
    const pipeline = new StoryPostReactPipeline({} as never);

    const result = await pipeline.run({
      saveId: 'save-1',
      storyRequestContext: {} as never,
      storyDirective: {
        requiredLayer1Agents: [],
        optionalLayer1Agents: [],
        projection: { chapter: null, mainQuest: null },
        todoList: ['推进剧情'],
      },
      postReviewDecision: {
        secondLayerDecision: {
          shouldSchedule: true,
          agents: ['npc_party', 'output'],
          reason: '需要补齐幽灵 Agent',
        },
        todoCompletion: {
          completedItems: ['推进剧情'],
          incompleteItems: ['补齐 NPC 反馈'],
          overallCompletion: 'partial',
        },
        // 方案M迁移：使用 auditResult（AuditResult）替代旧 continuityAudit
        auditResult: {
          pass: true,
          failures: [],
          confidence: 1.0,
        },
      },
      reactResult: {} as never,
      integrationResult: {
        success: true,
        data: {
          unifiedDecision: {
            secondLayerDecision: {
              shouldSchedule: true,
              agents: ['output'],
              reason: '这条路径不应被消费',
            },
            todoCompletion: { overallCompletion: 'partial' },
            // 此分支不应被消费，仅占位
            auditResult: {
              pass: false,
              rootCause: 'llm_understanding_error',
              failures: [
                {
                  dimension: 'timeline',
                  severity: 'error',
                  expected: 'A',
                  actual: 'B',
                  reason: '不应走到这里',
                  suggestedFix: '以显式输入为准',
                },
              ],
              confidence: 0.8,
            },
          },
        },
        writeOperations: [],
        agentResponses: new Map(),
        needsFurtherProcessing: false,
        fallbackSuggestions: [],
      },
      stagingPool: {} as never,
      shadowState: {} as never,
    });

    expect(result.postReviewDecision).toEqual(
      expect.objectContaining({
        secondLayerDecision: expect.objectContaining({
          agents: ['npc_party', 'output'],
        }),
        todoCompletion: expect.objectContaining({
          overallCompletion: 'partial',
        }),
        auditResult: expect.objectContaining({
          pass: true,
        }),
      }),
    );
    expect(result.resolvedLayer1Agents).toEqual(['npc_party']);
    expect(result.needAgentReasons).toEqual(['需要补齐幽灵 Agent']);
    expect(result.requiresRepair).toBe(false);
    expect(result.devtoolsTrace.decisionSummary).toMatchObject({
      todoCompletion: 'partial',
      auditPassed: true,
      secondLayerDecisionValid: true,
    });
  });

  it('应过滤非可路由 AgentType，并在只剩 output/gamemaster 时触发 repair', async () => {
    const pipeline = new StoryPostReactPipeline({} as never);

    const result = await pipeline.run({
      saveId: 'save-1',
      storyRequestContext: {} as never,
      storyDirective: {
        requiredLayer1Agents: [],
        optionalLayer1Agents: [],
        projection: { chapter: null, mainQuest: null },
        todoList: ['推进剧情'],
      },
      postReviewDecision: {
        secondLayerDecision: {
          shouldSchedule: true,
          agents: ['output', 'gamemaster'],
          reason: '错误地尝试调度不可路由 Agent',
        },
        todoCompletion: {
          completedItems: [],
          incompleteItems: ['推进剧情'],
          overallCompletion: 'partial',
        },
      },
      reactResult: {} as never,
      integrationResult: {
        success: true,
        data: {},
        writeOperations: [],
        agentResponses: new Map(),
        needsFurtherProcessing: false,
        fallbackSuggestions: [],
      },
      stagingPool: {} as never,
      shadowState: {} as never,
    });

    expect(result.resolvedLayer1Agents).toEqual([]);
    expect(result.requiresRepair).toBe(true);
    expect(result.devtoolsTrace.decisionSummary).toMatchObject({
      todoCompletion: 'partial',
      secondLayerDecisionValid: false,
    });
    expect(result.devtoolsTrace.repairReasons).toContain('second_layer_decision:invalid');
  });

  it('应在 devtools trace summary 中保留 partial_match', async () => {
    const pipeline = new StoryPostReactPipeline({} as never);

    const result = await pipeline.run({
      saveId: 'save-1',
      storyRequestContext: {} as never,
      storyDirective: null,
      postReviewDecision: {
        storyReview: {
          storyConsistency: 'partial_match',
          continuitySummary: '存在轻微偏差',
          issues: ['节奏略跳'],
          recommendations: ['下轮补齐过渡'],
        } as any,
      },
      reactResult: {} as never,
      integrationResult: {
        success: true,
        data: {},
        writeOperations: [],
        agentResponses: new Map(),
        needsFurtherProcessing: false,
        fallbackSuggestions: [],
      },
      stagingPool: {} as never,
      shadowState: {} as never,
    });

    expect(result.devtoolsTrace.decisionSummary.storyConsistency).toBe('partial_match');
  });
});
