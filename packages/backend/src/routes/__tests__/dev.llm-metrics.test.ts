import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevRoutes } from '../dev.js';
import { errorHandler } from '../../middlewares/errorhandler.js';

describe('Dev routes LLM metrics', () => {
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

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/dev', createDevRoutes(db));
    app.use(errorHandler);
    return app;
  }

  it('GET /llm-metrics/summary 应返回聚合结果', async () => {
    const now = Date.now();
    await db('agent_llm_calls').insert({
      id: 'row-1',
      agent_type: 'dag-scheduler',
      model: 'model-a',
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_cache_hit_tokens: 12,
      prompt_cache_miss_tokens: 3,
      stage: 'planner',
      prefix_hash: 'hash-1',
      cache_strategy: 'stable-prefix-v1',
      react_iterations: 0,
      tool_calls_count: 0,
      duration_ms: 180,
      success: 1,
      timestamp: now - 1_000,
    });

    const response = await request(createApp())
      .get('/api/v1/dev/llm-metrics/summary?timeRange=24h');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.overview.totalCalls).toBe(1);
    expect(response.body.data.stageBreakdown).toEqual([
      expect.objectContaining({
        stage: 'planner',
        calls: 1,
      }),
    ]);
  });

  it('GET /llm-metrics/recent 应校验非法 timeRange', async () => {
    const response = await request(createApp())
      .get('/api/v1/dev/llm-metrics/recent?timeRange=30d');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
