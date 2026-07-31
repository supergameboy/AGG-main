import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { apiClient } from '@/api/client';

export type LLMTimeRange = '1h' | '6h' | '24h' | '7d';

export interface LLMMetricsOverview {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgDurationMs: number;
  p95DurationMs: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  cacheHitRatio: number;
}

export interface LLMStageBreakdownItem {
  stage: string;
  calls: number;
  successCalls: number;
  failedCalls: number;
  avgDurationMs: number;
  p95DurationMs: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  cacheHitRatio: number;
}

export interface LLMSummary {
  overview: LLMMetricsOverview;
  stageBreakdown: LLMStageBreakdownItem[];
}

export interface LLMRecentItem {
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
}

interface LLMMetricsFilters {
  timeRange: LLMTimeRange;
  stage: string;
  limit: number;
}

interface LLMMetricsStoreState {
  filters: LLMMetricsFilters;
  summary: LLMSummary | null;
  recentItems: LLMRecentItem[];
  availableStages: string[];
  loading: boolean;
  error: string | null;
  setTimeRange: (timeRange: LLMTimeRange) => void;
  setStage: (stage: string) => void;
  refresh: () => Promise<void>;
}

let latestRequestId = 0;

function buildParams(filters: LLMMetricsFilters, includeLimit: boolean): Record<string, string | number> {
  const params: Record<string, string | number> = {
    timeRange: filters.timeRange,
  };
  if (filters.stage !== 'all') {
    params.stage = filters.stage;
  }
  if (includeLimit) {
    params.limit = filters.limit;
  }
  return params;
}

function mergeAvailableStages(currentStages: string[], summary: LLMSummary | null, recentItems: LLMRecentItem[]): string[] {
  const stages = new Set<string>(currentStages.length > 0 ? currentStages : ['all']);
  stages.add('all');

  for (const item of summary?.stageBreakdown ?? []) {
    if (item.stage) {
      stages.add(item.stage);
    }
  }

  for (const item of recentItems) {
    if (item.stage) {
      stages.add(item.stage);
    }
  }

  return Array.from(stages);
}

export const useLLMMetricsStore = create<LLMMetricsStoreState>()(
  devtools(
    immer((set, get) => ({
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

      setTimeRange: (timeRange) => {
        set((state) => {
          state.filters.timeRange = timeRange;
        });
      },

      setStage: (stage) => {
        set((state) => {
          state.filters.stage = stage;
        });
      },

      refresh: async () => {
        const { filters } = get();
        const requestId = ++latestRequestId;
        set((state) => {
          state.loading = true;
          state.error = null;
        });

        try {
          const [summary, recent] = await Promise.all([
            apiClient.get('/dev/llm-metrics/summary', {
              params: buildParams(filters, false),
            }) as Promise<LLMSummary>,
            apiClient.get('/dev/llm-metrics/recent', {
              params: buildParams(filters, true),
            }) as Promise<{ items: LLMRecentItem[] }>,
          ]);

          if (requestId !== latestRequestId) {
            return;
          }

          set((state) => {
            state.summary = summary;
            state.recentItems = recent.items;
            state.availableStages = mergeAvailableStages(state.availableStages, summary, recent.items);
            state.loading = false;
          });
        } catch (error) {
          if (requestId !== latestRequestId) {
            return;
          }

          set((state) => {
            state.loading = false;
            state.error = error instanceof Error ? error.message : '加载 LLM 指标失败';
          });
        }
      },
    })),
    { name: 'LLMMetricsStore' }
  )
);
