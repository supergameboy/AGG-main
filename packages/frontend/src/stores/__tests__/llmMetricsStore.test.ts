import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/api/client';
import { useLLMMetricsStore } from '../llmMetricsStore';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('useLLMMetricsStore', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useLLMMetricsStore.setState({
      filters: {
        timeRange: '24h',
        stage: 'all',
        limit: 20,
      },
      summary: null,
      recentItems: [],
      availableStages: ['all'],
      loading: false,
      error: null,
    });
  });

  it('refresh 应同时拉取 summary 与 recent 并写入状态', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/dev/llm-metrics/summary') {
        return {
          overview: {
            totalCalls: 2,
            successCalls: 2,
            failedCalls: 0,
            avgDurationMs: 120,
            p95DurationMs: 180,
            promptCacheHitTokens: 90,
            promptCacheMissTokens: 10,
            cacheHitRatio: 0.9,
          },
          stageBreakdown: [
            {
              stage: 'planner',
              calls: 2,
              successCalls: 2,
              failedCalls: 0,
              avgDurationMs: 120,
              p95DurationMs: 180,
              promptCacheHitTokens: 90,
              promptCacheMissTokens: 10,
              cacheHitRatio: 0.9,
            },
          ],
        };
      }

      return {
        items: [
          {
            id: 'call-1',
            timestamp: 1,
            stage: 'planner',
            success: true,
            durationMs: 180,
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            promptCacheHitTokens: 90,
            promptCacheMissTokens: 10,
            cacheStrategy: 'stable-prefix-v1',
            prefixHash: 'hash-1',
            reactIterations: 0,
            toolCallsCount: 0,
          },
        ],
      };
    });

    await useLLMMetricsStore.getState().refresh();

    expect(apiClient.get).toHaveBeenCalledWith('/dev/llm-metrics/summary', {
      params: { timeRange: '24h' },
    });
    expect(apiClient.get).toHaveBeenCalledWith('/dev/llm-metrics/recent', {
      params: { timeRange: '24h', limit: 20 },
    });

    const state = useLLMMetricsStore.getState();
    expect(state.summary?.overview.totalCalls).toBe(2);
    expect(state.recentItems).toHaveLength(1);
    expect(state.availableStages).toEqual(['all', 'planner']);
    expect(state.error).toBeNull();
  });

  it('refresh 应只接收最后一次请求响应并保留已见过的 stage 集合', async () => {
    const firstSummary = deferred<{
      overview: {
        totalCalls: number;
        successCalls: number;
        failedCalls: number;
        avgDurationMs: number;
        p95DurationMs: number;
        promptCacheHitTokens: number;
        promptCacheMissTokens: number;
        cacheHitRatio: number;
      };
      stageBreakdown: Array<{
        stage: string;
        calls: number;
        successCalls: number;
        failedCalls: number;
        avgDurationMs: number;
        p95DurationMs: number;
        promptCacheHitTokens: number;
        promptCacheMissTokens: number;
        cacheHitRatio: number;
      }>;
    }>();
    const firstRecent = deferred<{
      items: Array<{
        id: string;
        timestamp: number;
        stage: string;
        success: boolean;
        durationMs: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        promptCacheHitTokens: number;
        promptCacheMissTokens: number;
        cacheStrategy: string | null;
        prefixHash: string | null;
        reactIterations: number | null;
        toolCallsCount: number | null;
      }>;
    }>();
    const secondSummary = deferred<{
      overview: {
        totalCalls: number;
        successCalls: number;
        failedCalls: number;
        avgDurationMs: number;
        p95DurationMs: number;
        promptCacheHitTokens: number;
        promptCacheMissTokens: number;
        cacheHitRatio: number;
      };
      stageBreakdown: Array<{
        stage: string;
        calls: number;
        successCalls: number;
        failedCalls: number;
        avgDurationMs: number;
        p95DurationMs: number;
        promptCacheHitTokens: number;
        promptCacheMissTokens: number;
        cacheHitRatio: number;
      }>;
    }>();
    const secondRecent = deferred<{
      items: Array<{
        id: string;
        timestamp: number;
        stage: string;
        success: boolean;
        durationMs: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        promptCacheHitTokens: number;
        promptCacheMissTokens: number;
        cacheStrategy: string | null;
        prefixHash: string | null;
        reactIterations: number | null;
        toolCallsCount: number | null;
      }>;
    }>();

    vi.mocked(apiClient.get).mockImplementation((url, config) => {
      const stage = (config as { params?: { stage?: string } } | undefined)?.params?.stage;
      if (url === '/dev/llm-metrics/summary' && stage === 'planner') {
        return secondSummary.promise as ReturnType<typeof apiClient.get>;
      }
      if (url === '/dev/llm-metrics/recent' && stage === 'planner') {
        return secondRecent.promise as ReturnType<typeof apiClient.get>;
      }
      if (url === '/dev/llm-metrics/summary') {
        return firstSummary.promise as ReturnType<typeof apiClient.get>;
      }
      return firstRecent.promise as ReturnType<typeof apiClient.get>;
    });

    const firstRefresh = useLLMMetricsStore.getState().refresh();
    useLLMMetricsStore.getState().setStage('planner');
    const secondRefresh = useLLMMetricsStore.getState().refresh();

    secondSummary.resolve({
      overview: {
        totalCalls: 1,
        successCalls: 1,
        failedCalls: 0,
        avgDurationMs: 100,
        p95DurationMs: 100,
        promptCacheHitTokens: 50,
        promptCacheMissTokens: 0,
        cacheHitRatio: 1,
      },
      stageBreakdown: [
        {
          stage: 'planner',
          calls: 1,
          successCalls: 1,
          failedCalls: 0,
          avgDurationMs: 100,
          p95DurationMs: 100,
          promptCacheHitTokens: 50,
          promptCacheMissTokens: 0,
          cacheHitRatio: 1,
        },
      ],
    });
    secondRecent.resolve({
      items: [
        {
          id: 'planner-call',
          timestamp: 2,
          stage: 'planner',
          success: true,
          durationMs: 100,
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
          promptCacheHitTokens: 20,
          promptCacheMissTokens: 0,
          cacheStrategy: 'stable-prefix-v1',
          prefixHash: 'planner-hash',
          reactIterations: 1,
          toolCallsCount: 0,
        },
      ],
    });
    await secondRefresh;

    firstSummary.resolve({
      overview: {
        totalCalls: 1,
        successCalls: 1,
        failedCalls: 0,
        avgDurationMs: 250,
        p95DurationMs: 250,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 40,
        cacheHitRatio: 0,
      },
      stageBreakdown: [
        {
          stage: 'reviewer',
          calls: 1,
          successCalls: 1,
          failedCalls: 0,
          avgDurationMs: 250,
          p95DurationMs: 250,
          promptCacheHitTokens: 0,
          promptCacheMissTokens: 40,
          cacheHitRatio: 0,
        },
      ],
    });
    firstRecent.resolve({
      items: [
        {
          id: 'reviewer-call',
          timestamp: 1,
          stage: 'reviewer',
          success: true,
          durationMs: 250,
          promptTokens: 30,
          completionTokens: 10,
          totalTokens: 40,
          promptCacheHitTokens: 0,
          promptCacheMissTokens: 40,
          cacheStrategy: null,
          prefixHash: 'reviewer-hash',
          reactIterations: 0,
          toolCallsCount: 0,
        },
      ],
    });
    await firstRefresh;

    const state = useLLMMetricsStore.getState();
    expect(state.filters.stage).toBe('planner');
    expect(state.summary?.stageBreakdown.map((item) => item.stage)).toEqual(['planner']);
    expect(state.recentItems.map((item) => item.stage)).toEqual(['planner']);
    expect(state.availableStages).toEqual(['all', 'planner']);
  });
});
