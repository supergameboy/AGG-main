import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMMetricsService } from '../LLMMetricsService.js';

describe('LLMMetricsService', () => {
  let db: Knex;
  let dateNowSpy: { mockRestore: () => void };

  beforeEach(async () => {
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-12T14:30:00.000Z').getTime());

    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('agent_llm_calls', (table) => {
      table.text('id').primary();
      table.text('save_id');
      table.text('agent_type').notNullable();
      table.text('model').notNullable();
      table.integer('prompt_tokens').defaultTo(0);
      table.integer('completion_tokens').defaultTo(0);
      table.integer('total_tokens').defaultTo(0);
      table.integer('prompt_cache_hit_tokens').defaultTo(0);
      table.integer('prompt_cache_miss_tokens').defaultTo(0);
      table.text('stage').nullable();
      table.text('prefix_hash').nullable();
      table.text('cache_strategy').nullable();
      table.integer('react_iterations').nullable();
      table.integer('tool_calls_count').nullable();
      table.integer('duration_ms');
      table.integer('success').defaultTo(1);
      table.integer('timestamp').notNullable();
    });
  });

  afterEach(async () => {
    dateNowSpy.mockRestore();
    await db.destroy();
  });

  it('应按时间范围返回概览与按 stage 聚合结果', async () => {
    const now = Date.now();
    await db('agent_llm_calls').insert([
      {
        id: '1',
        agent_type: 'dag-scheduler',
        model: 'model-a',
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
        stage: 'planner',
        prefix_hash: 'hash-1',
        cache_strategy: 'stable-prefix-v1',
        react_iterations: 0,
        tool_calls_count: 0,
        duration_ms: 100,
        success: 1,
        timestamp: now - 1_000,
      },
      {
        id: '2',
        agent_type: 'dag-scheduler',
        model: 'model-a',
        prompt_tokens: 100,
        completion_tokens: 30,
        total_tokens: 130,
        prompt_cache_hit_tokens: 20,
        prompt_cache_miss_tokens: 80,
        stage: 'planner',
        prefix_hash: 'hash-2',
        cache_strategy: 'stable-prefix-v1',
        react_iterations: 1,
        tool_calls_count: 2,
        duration_ms: 200,
        success: 0,
        timestamp: now - 2_000,
      },
      {
        id: '3',
        agent_type: 'dialogue',
        model: 'model-b',
        prompt_tokens: 90,
        completion_tokens: 10,
        total_tokens: 100,
        prompt_cache_hit_tokens: 50,
        prompt_cache_miss_tokens: 50,
        stage: null,
        prefix_hash: null,
        cache_strategy: null,
        react_iterations: null,
        tool_calls_count: null,
        duration_ms: 400,
        success: 1,
        timestamp: now - 3_000,
      },
      {
        id: '4',
        agent_type: 'dialogue',
        model: 'model-c',
        prompt_tokens: 70,
        completion_tokens: 10,
        total_tokens: 80,
        prompt_cache_hit_tokens: 999,
        prompt_cache_miss_tokens: 1,
        stage: 'reviewer',
        prefix_hash: 'hash-old',
        cache_strategy: 'stable-prefix-v1',
        react_iterations: 0,
        tool_calls_count: 0,
        duration_ms: 900,
        success: 1,
        timestamp: now - 8 * 24 * 60 * 60 * 1000,
      },
    ]);

    const service = new LLMMetricsService(db);
    const summary = await service.getSummary({
      timeRange: '24h',
    });

    expect(summary.overview).toEqual({
      totalCalls: 3,
      successCalls: 2,
      failedCalls: 1,
      avgDurationMs: 233.33,
      p95DurationMs: 400,
      promptCacheHitTokens: 150,
      promptCacheMissTokens: 150,
      cacheHitRatio: 0.5,
    });
    expect(summary.stageBreakdown).toEqual([
      {
        stage: 'planner',
        calls: 2,
        successCalls: 1,
        failedCalls: 1,
        avgDurationMs: 150,
        p95DurationMs: 200,
        promptCacheHitTokens: 100,
        promptCacheMissTokens: 100,
        cacheHitRatio: 0.5,
      },
      {
        stage: 'unknown',
        calls: 1,
        successCalls: 1,
        failedCalls: 0,
        avgDurationMs: 400,
        p95DurationMs: 400,
        promptCacheHitTokens: 50,
        promptCacheMissTokens: 50,
        cacheHitRatio: 0.5,
      },
    ]);
  });

  it('应按 stage 和时间范围过滤最近明细并按时间倒序返回', async () => {
    const now = Date.now();
    await db('agent_llm_calls').insert([
      {
        id: 'a',
        agent_type: 'dag-scheduler',
        model: 'model-a',
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 8,
        prompt_cache_miss_tokens: 2,
        stage: 'planner',
        prefix_hash: 'hash-a',
        cache_strategy: 'stable-prefix-v1',
        react_iterations: 0,
        tool_calls_count: 0,
        duration_ms: 100,
        success: 1,
        timestamp: now - 1_000,
      },
      {
        id: 'b',
        agent_type: 'dag-scheduler',
        model: 'model-a',
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 1,
        prompt_cache_miss_tokens: 9,
        stage: 'reviewer',
        prefix_hash: 'hash-b',
        cache_strategy: 'stable-prefix-v1',
        react_iterations: 0,
        tool_calls_count: 0,
        duration_ms: 300,
        success: 1,
        timestamp: now - 2_000,
      },
      {
        id: 'c',
        agent_type: 'dag-scheduler',
        model: 'model-a',
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 5,
        prompt_cache_miss_tokens: 5,
        stage: 'planner',
        prefix_hash: 'hash-c',
        cache_strategy: 'stable-prefix-v1',
        react_iterations: 1,
        tool_calls_count: 1,
        duration_ms: 200,
        success: 0,
        timestamp: now - 3_000,
      },
    ]);

    const service = new LLMMetricsService(db);
    const recent = await service.getRecent({
      timeRange: '24h',
      stage: 'planner',
      limit: 1,
    });

    expect(recent.items).toEqual([
      {
        id: 'a',
        timestamp: now - 1_000,
        stage: 'planner',
        success: true,
        durationMs: 100,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        promptCacheHitTokens: 8,
        promptCacheMissTokens: 2,
        cacheStrategy: 'stable-prefix-v1',
        prefixHash: 'hash-a',
        reactIterations: 0,
        toolCallsCount: 0,
      },
    ]);
  });
});
