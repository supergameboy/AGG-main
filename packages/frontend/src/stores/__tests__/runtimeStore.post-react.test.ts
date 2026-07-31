import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchPostReactTracesMock, fetchRuntimeSnapshotsMock, loggerErrorMock } = vi.hoisted(() => ({
  fetchPostReactTracesMock: vi.fn(),
  fetchRuntimeSnapshotsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/api/gameApi', () => ({
  gameApi: {
    fetchPostReactTraces: fetchPostReactTracesMock,
    fetchRuntimeSnapshots: fetchRuntimeSnapshotsMock,
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { useRuntimeStore } from '../runtimeStore';

describe('useRuntimeStore post-react', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRuntimeStore.setState({
      runtimeSnapshots: null,
      runtimeSnapshotsLoading: false,
      runtimeSnapshotsError: null,
      postReact: null,
      postReactLoading: false,
      postReactError: null,
      activeSubTab: 'staging',
      liveEvents: [],
    });
  });

  it('fetchPostReact 失败时应保留上一份成功数据，只更新错误态', async () => {
    const previousPostReact = {
      saveId: 'save-1',
      traceCount: 1,
      postReactTraces: [
        {
          type: 'story_post_react',
          timestamp: 1718000000000,
          data: {
            phase: 'post-react' as const,
            repairRoundCount: 0,
            requiresRepair: false,
            decisionSummary: {
              secondLayerDecisionValid: true,
            },
            repairReasons: [],
            resolvedLayer1Agents: [],
            needAgentReasons: [],
            runtimeCommitSummary: {
              wrotePostReviewDecision: true,
              wroteContinuityAudit: true,
              wroteTodoCompletion: true,
              wroteRepairMetadata: false,
            },
          },
        },
      ],
    };

    fetchPostReactTracesMock.mockResolvedValueOnce(previousPostReact);

    await useRuntimeStore.getState().fetchPostReact('save-1');

    fetchPostReactTracesMock.mockRejectedValueOnce({
      name: 'AxiosError',
      isAxiosError: true,
      response: {
        status: 503,
        data: {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'collector unavailable',
            details: { traceType: 'story_post_react' },
          },
        },
      },
    });

    await useRuntimeStore.getState().fetchPostReact('save-1');

    const state = useRuntimeStore.getState();
    expect(state.postReact).toEqual(previousPostReact);
    expect(state.postReactLoading).toBe(false);
    expect(state.postReactError).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用',
      category: 'server',
      details: { traceType: 'story_post_react' },
      statusCode: 503,
    });
  });

  it('fetchRuntimeSnapshots 失败时应保留上一份成功数据，只更新错误态', async () => {
    const previousRuntimeSnapshots = {
      saveId: 'save-1',
      traceCount: 1,
      runtimeSnapshots: [
        {
          type: 'runtime_snapshot',
          timestamp: 1718000001000,
          data: {
            requestId: 'req-1',
            agentKey: 'gamemaster',
            permissions: {
              visibleToolTypes: ['event_service'],
              visibleFunctionCount: 1,
            },
          },
        },
      ],
    };

    fetchRuntimeSnapshotsMock.mockResolvedValueOnce(previousRuntimeSnapshots);

    await useRuntimeStore.getState().fetchRuntimeSnapshots('save-1');

    fetchRuntimeSnapshotsMock.mockRejectedValueOnce({
      name: 'AxiosError',
      isAxiosError: true,
      response: {
        status: 503,
        data: {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'collector unavailable',
            details: { traceType: 'runtime_snapshot' },
          },
        },
      },
    });

    await useRuntimeStore.getState().fetchRuntimeSnapshots('save-1');

    const state = useRuntimeStore.getState();
    expect(state.runtimeSnapshots).toEqual(previousRuntimeSnapshots);
    expect(state.runtimeSnapshotsLoading).toBe(false);
    expect(state.runtimeSnapshotsError).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用',
      category: 'server',
      details: { traceType: 'runtime_snapshot' },
      statusCode: 503,
    });
  });
});
