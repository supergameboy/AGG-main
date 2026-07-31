/**
 * LLMMetricsService — LLM 度量查询服务（E 层）
 *
 * M1 迁移说明（设计文档 模块M1 §6.7 / §12.2）：
 * - 原位置：packages/ai/src/LLMMetricsService.ts（H 层）
 * - 新位置：packages/backend/src/services/llm-metrics/（E 层）
 * - 职责：查询 agent_llm_calls 表，生成统计报表（查询接口保持不变）
 * - 写入职责由 LLMMetricsSink 承担（订阅 LLMService emitMetrics，异步批量落库）
 */

import type { Knex } from 'knex';

export type LLMTimeRange = '1h' | '6h' | '24h' | '7d';

export interface LLMMetricsFilters {
  timeRange?: LLMTimeRange;
  stage?: string;
  limit?: number;
}

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

export interface LLMSummaryResult {
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

export interface LLMRecentResult {
  items: LLMRecentItem[];
}

interface LLMCallRow {
  id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  prompt_cache_hit_tokens: number | null;
  prompt_cache_miss_tokens: number | null;
  stage: string | null;
  prefix_hash: string | null;
  cache_strategy: string | null;
  react_iterations: number | null;
  tool_calls_count: number | null;
  duration_ms: number | null;
  success: number | boolean | null;
  timestamp: number;
}

const TIME_RANGE_MS: Record<LLMTimeRange, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeStage(stage: string | null | undefined): string {
  return stage && stage.trim() ? stage : 'unknown';
}

function asNumber(value: number | null | undefined): number {
  return typeof value === 'number' ? value : 0;
}

function asBoolean(value: number | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return value === 1;
}

function calculateP95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)];
}

function buildOverview(rows: LLMCallRow[]): LLMMetricsOverview {
  const durations = rows.map((row) => asNumber(row.duration_ms));
  const totalCalls = rows.length;
  const successCalls = rows.filter((row) => asBoolean(row.success)).length;
  const failedCalls = totalCalls - successCalls;
  const promptCacheHitTokens = rows.reduce((sum, row) => sum + asNumber(row.prompt_cache_hit_tokens), 0);
  const promptCacheMissTokens = rows.reduce((sum, row) => sum + asNumber(row.prompt_cache_miss_tokens), 0);
  const cacheBase = promptCacheHitTokens + promptCacheMissTokens;

  return {
    totalCalls,
    successCalls,
    failedCalls,
    avgDurationMs: totalCalls === 0 ? 0 : roundToTwo(durations.reduce((sum, value) => sum + value, 0) / totalCalls),
    p95DurationMs: calculateP95(durations),
    promptCacheHitTokens,
    promptCacheMissTokens,
    cacheHitRatio: cacheBase === 0 ? 0 : roundToTwo(promptCacheHitTokens / cacheBase),
  };
}

export class LLMMetricsService {
  constructor(private readonly db: Knex) {}

  async getSummary(filters: LLMMetricsFilters = {}): Promise<LLMSummaryResult> {
    const rows = await this.queryRows(filters);
    const byStage = new Map<string, LLMCallRow[]>();

    for (const row of rows) {
      const stage = normalizeStage(row.stage);
      const stageRows = byStage.get(stage) ?? [];
      stageRows.push(row);
      byStage.set(stage, stageRows);
    }

    const stageBreakdown = Array.from(byStage.entries())
      .map(([stage, stageRows]) => {
        const overview = buildOverview(stageRows);
        return {
          stage,
          calls: stageRows.length,
          successCalls: overview.successCalls,
          failedCalls: overview.failedCalls,
          avgDurationMs: overview.avgDurationMs,
          p95DurationMs: overview.p95DurationMs,
          promptCacheHitTokens: overview.promptCacheHitTokens,
          promptCacheMissTokens: overview.promptCacheMissTokens,
          cacheHitRatio: overview.cacheHitRatio,
        };
      })
      .sort((left, right) => {
        if (right.calls !== left.calls) {
          return right.calls - left.calls;
        }
        return left.stage.localeCompare(right.stage);
      });

    return {
      overview: buildOverview(rows),
      stageBreakdown,
    };
  }

  async getRecent(filters: LLMMetricsFilters = {}): Promise<LLMRecentResult> {
    const rows = await this.queryRows(filters, filters.limit ?? 20);

    return {
      items: rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        stage: normalizeStage(row.stage),
        success: asBoolean(row.success),
        durationMs: asNumber(row.duration_ms),
        promptTokens: asNumber(row.prompt_tokens),
        completionTokens: asNumber(row.completion_tokens),
        totalTokens: asNumber(row.total_tokens),
        promptCacheHitTokens: asNumber(row.prompt_cache_hit_tokens),
        promptCacheMissTokens: asNumber(row.prompt_cache_miss_tokens),
        cacheStrategy: row.cache_strategy ?? null,
        prefixHash: row.prefix_hash ?? null,
        reactIterations: row.react_iterations ?? null,
        toolCallsCount: row.tool_calls_count ?? null,
      })),
    };
  }

  async getTokenUsageForSave(saveId: string, sinceTimestamp: number): Promise<{
    input: number; output: number; total: number; cacheHit: number; cacheMiss: number;
  }> {
    try {
      const rows = await this.db('agent_llm_calls')
        .where('save_id', saveId)
        .where('timestamp', '>=', sinceTimestamp)
        .select('prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens');

      return rows.reduce((acc, row) => ({
        input: acc.input + asNumber(row.prompt_tokens),
        output: acc.output + asNumber(row.completion_tokens),
        total: acc.total + asNumber(row.total_tokens),
        cacheHit: acc.cacheHit + asNumber(row.prompt_cache_hit_tokens),
        cacheMiss: acc.cacheMiss + asNumber(row.prompt_cache_miss_tokens),
      }), { input: 0, output: 0, total: 0, cacheHit: 0, cacheMiss: 0 });
    } catch {
      return { input: 0, output: 0, total: 0, cacheHit: 0, cacheMiss: 0 };
    }
  }

  private async queryRows(filters: LLMMetricsFilters, limit?: number): Promise<LLMCallRow[]> {
    const timeRange = filters.timeRange ?? '24h';
    const sinceTimestamp = Date.now() - TIME_RANGE_MS[timeRange];

    let query = this.db('agent_llm_calls')
      .select<LLMCallRow[]>([
        'id',
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
        'prompt_cache_hit_tokens',
        'prompt_cache_miss_tokens',
        'stage',
        'prefix_hash',
        'cache_strategy',
        'react_iterations',
        'tool_calls_count',
        'duration_ms',
        'success',
        'timestamp',
      ])
      .where('timestamp', '>=', sinceTimestamp)
      .orderBy('timestamp', 'desc');

    if (filters.stage) {
      if (filters.stage === 'unknown') {
        query = query.where((builder) => {
          builder.whereNull('stage').orWhere('stage', '');
        });
      } else {
        query = query.where('stage', filters.stage);
      }
    }

    if (limit) {
      query = query.limit(limit);
    }

    return query;
  }
}
