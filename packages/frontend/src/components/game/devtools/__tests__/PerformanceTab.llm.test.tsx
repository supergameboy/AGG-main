import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PerformanceTab } from '../PerformanceTab';

const llmState = {
  filters: {
    timeRange: '24h',
    stage: 'planner',
    limit: 20,
  },
  availableStages: ['all', 'planner', 'reviewer'],
  summary: {
    overview: {
      totalCalls: 3,
      successCalls: 2,
      failedCalls: 1,
      avgDurationMs: 150,
      p95DurationMs: 300,
      promptCacheHitTokens: 120,
      promptCacheMissTokens: 30,
      cacheHitRatio: 0.8,
    },
    stageBreakdown: [
      {
        stage: 'planner',
        calls: 3,
        successCalls: 2,
        failedCalls: 1,
        avgDurationMs: 150,
        p95DurationMs: 300,
        promptCacheHitTokens: 120,
        promptCacheMissTokens: 30,
        cacheHitRatio: 0.8,
      },
    ],
  },
  recentItems: [
    {
      id: 'call-1',
      timestamp: new Date('2026-05-12T14:20:00.000Z').getTime(),
      stage: 'planner',
      success: true,
      durationMs: 180,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      promptCacheHitTokens: 90,
      promptCacheMissTokens: 30,
      cacheStrategy: 'stable-prefix-v1',
      prefixHash: 'hash-abcdef',
      reactIterations: 0,
      toolCallsCount: 0,
    },
  ],
  loading: false,
  error: null,
  setTimeRange: vi.fn(),
  setStage: vi.fn(),
  refresh: vi.fn(),
};

vi.mock('@/stores/llmMetricsStore', () => ({
  useLLMMetricsStore: (selector: (state: typeof llmState) => unknown) => selector(llmState),
}));

describe('PerformanceTab LLM metrics section', () => {
  beforeEach(() => {
    llmState.setTimeRange.mockClear();
    llmState.setStage.mockClear();
    llmState.refresh.mockClear();
  });

  it('应展示 LLM 指标卡、stage 聚合表与最近明细', () => {
    const markup = renderToStaticMarkup(<PerformanceTab />);

    expect(markup).toContain('LLM分析');
    expect(markup).toContain('缓存命中率');
    expect(markup).toContain('planner');
    expect(markup).toContain('stable-prefix-v1');
  });

  it('stage 已筛到单阶段时仍应保留已见过的其它 stage 选项', () => {
    const markup = renderToStaticMarkup(<PerformanceTab />);

    expect(markup).toContain('全部阶段');
    expect(markup).toContain('planner');
    expect(markup).toContain('reviewer');
  });
});
