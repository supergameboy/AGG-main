import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuntimeTab } from '../RuntimeTab';
import type { ApiErrorDetail } from '@/api/errorHandler';
import type { PostReactTraceResponse } from '@/api/gameApi';

type RuntimeState = {
  activeSubTab: 'staging' | 'eventbus' | 'audit' | 'graph' | 'postreact' | 'snapshot';
  stagingPool: { stagingWriteTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  stagingPoolLoading: boolean;
  eventBus: { eventBusTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  eventBusLoading: boolean;
  auditLog: { auditTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  auditLogLoading: boolean;
  graphChanges: { graphChangeTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  graphChangesLoading: boolean;
  runtimeSnapshots: {
    runtimeSnapshots: Array<{ type: string; data: Record<string, unknown>; timestamp: number }>;
    traceCount: number;
  } | null;
  runtimeSnapshotsLoading: boolean;
  runtimeSnapshotsError: ApiErrorDetail | null;
  postReact: PostReactTraceResponse | null;
  postReactLoading: boolean;
  postReactError: ApiErrorDetail | null;
  liveEvents: Array<{ type: string; data: unknown; timestamp: number }>;
  setActiveSubTab: ReturnType<typeof vi.fn>;
  fetchStagingPool: ReturnType<typeof vi.fn>;
  fetchEventBus: ReturnType<typeof vi.fn>;
  fetchAuditLog: ReturnType<typeof vi.fn>;
  fetchGraphChanges: ReturnType<typeof vi.fn>;
  fetchRuntimeSnapshots: ReturnType<typeof vi.fn>;
  fetchPostReact: ReturnType<typeof vi.fn>;
};

const runtimeState: RuntimeState = {
  activeSubTab: 'postreact',
  stagingPool: null,
  stagingPoolLoading: false,
  eventBus: null,
  eventBusLoading: false,
  auditLog: null,
  auditLogLoading: false,
  graphChanges: null,
  graphChangesLoading: false,
  runtimeSnapshots: null,
  runtimeSnapshotsLoading: false,
  runtimeSnapshotsError: null,
  postReact: null,
  postReactLoading: false,
  postReactError: null,
  liveEvents: [],
  setActiveSubTab: vi.fn(),
  fetchStagingPool: vi.fn(),
  fetchEventBus: vi.fn(),
  fetchAuditLog: vi.fn(),
  fetchGraphChanges: vi.fn(),
  fetchRuntimeSnapshots: vi.fn(),
  fetchPostReact: vi.fn(),
};

vi.mock('@/stores/runtimeStore', () => ({
  useRuntimeStore: (selector: (state: RuntimeState) => unknown) => selector(runtimeState),
}));

vi.mock('@/stores/gameStore', () => ({
  useGameStore: (selector: (state: { saveId: string | null }) => unknown) => selector({ saveId: 'save-1' }),
}));

describe('RuntimeTab', () => {
  beforeEach(() => {
    runtimeState.activeSubTab = 'postreact';
    runtimeState.runtimeSnapshotsLoading = false;
    runtimeState.runtimeSnapshotsError = null;
    runtimeState.runtimeSnapshots = {
      traceCount: 1,
      runtimeSnapshots: [
        {
          type: 'runtime_snapshot',
          timestamp: 1718000001000,
          data: {
            requestId: 'req-1',
            agentKey: 'gamemaster',
            parentAgentRunId: 'parent-run-1',
            model: {
              providerId: 'openai',
              model: 'gpt-4o-mini',
            },
            permissions: {
              configuredTools: ['event_service', 'map_service'],
              defaultDeny: true,
              visibleToolTypes: ['event_service'],
              visibleFunctionCount: 1,
              deferredFunctionCount: 1,
            },
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
            deferredTools: ['map_service__move_to'],
            knowledge: {
              ruleNames: ['gm-rule'],
              skillNames: ['gm-skill'],
              helpMethods: ['event_service.get_event_snapshot'],
            },
            prompt: {
              systemPromptLength: 1200,
              userPromptLength: 320,
            },
            context: {
              language: 'zh-CN',
              templateId: 'template-parent',
            },
            debug: {
              source: 'parent-runtime',
            },
          },
        },
      ],
    };
    runtimeState.postReactLoading = false;
    runtimeState.postReactError = null;
    runtimeState.postReact = {
      saveId: 'save-1',
      traceCount: 1,
      postReactTraces: [
        {
          type: 'story_post_react',
          timestamp: 1718000000000,
          data: {
            phase: 'post-react',
            repairRoundCount: 2,
            requiresRepair: true,
            decisionSummary: {
              storyConsistency: 'partial_match',
              todoCompletion: 'failed',
              continuitySeverity: 'error',
              secondLayerDecisionValid: true,
            },
            repairReasons: ['continuity_audit:error', 'todo_completion:failed'],
            resolvedLayer1Agents: ['npc_party'],
            needAgentReasons: ['需要补齐 NPC 反应'],
            runtimeCommitSummary: {
              wrotePostReviewDecision: true,
              wroteContinuityAudit: true,
              wroteTodoCompletion: true,
              wroteRepairMetadata: true,
            },
          },
        },
      ],
    };
  });

  it('应在 RuntimeTab 中展示 Snapshot 概览与能力面摘要', () => {
    runtimeState.activeSubTab = 'snapshot';

    const markup = renderToStaticMarkup(<RuntimeTab />);

    expect(markup).toContain('Snapshot 概览');
    expect(markup).toContain('工具可见性');
    expect(markup).toContain('event_service');
    expect(markup).toContain('gm-rule');
    expect(markup).toContain('gpt-4o-mini');
    expect(markup).toContain('Deferred');
    expect(markup).toContain('map_service__move_to');
    expect(markup).toContain('usedOnDemandLoads');
  });

  it('snapshot collector 返回 503 时应显示不可用状态', () => {
    runtimeState.activeSubTab = 'snapshot';
    runtimeState.runtimeSnapshots = null;
    runtimeState.runtimeSnapshotsError = {
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用',
      category: 'server',
      statusCode: 503,
      details: { traceType: 'runtime_snapshot' },
    };

    const markup = renderToStaticMarkup(<RuntimeTab />);

    expect(markup).toContain('Runtime snapshot collector 暂不可用');
    expect(markup).toContain('503');
    expect(markup).not.toContain('点击&quot;刷新&quot;加载数据');
  });

  it('应在 RuntimeTab 中展示 Post-react 概览与修正回路', () => {
    const markup = renderToStaticMarkup(<RuntimeTab />);

    expect(markup).toContain('Post-react 概览');
    expect(markup).toContain('修正回路');
    expect(markup).toContain('状态写回摘要');
    expect(markup).toContain('partial_match');
    expect(markup).toContain('continuity_audit:error');
  });

  it('collector 返回 503 时应显示不可用状态', () => {
    runtimeState.postReact = null;
    runtimeState.postReactError = {
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用',
      category: 'server',
      statusCode: 503,
      details: { traceType: 'story_post_react' },
    };

    const markup = renderToStaticMarkup(<RuntimeTab />);

    expect(markup).toContain('Post-react collector 暂不可用');
    expect(markup).toContain('503');
    expect(markup).not.toContain('点击&quot;刷新&quot;加载数据');
  });

  it('postReactError 存在但仍有旧 traces 时应显示错误 banner 并继续渲染上次成功数据', () => {
    runtimeState.postReactError = {
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用',
      category: 'server',
      statusCode: 503,
      details: { traceType: 'story_post_react' },
    };

    const markup = renderToStaticMarkup(<RuntimeTab />);

    expect(markup).toContain('Post-react collector 暂不可用');
    expect(markup).toContain('503');
    expect(markup).toContain('Post-react 概览');
    expect(markup).toContain('修正回路');
    expect(markup).toContain('partial_match');
  });
});
