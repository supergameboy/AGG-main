import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMCallMetricsPayload } from '@ai-rpg/ai';
import { LLMMetricsSink } from '../LLMMetricsSink.js';

/**
 * LLMMetricsSink 单元测试（M1 设计文档 §10.1 / §6.4）
 *
 * 验证点：
 * 1. 1s debounce：record 后 1 秒内合并为一次批量插入
 * 2. 100 条阈值：buffer 满立即 flush
 * 3. 非阻塞：record 立即返回，flush 失败仅记日志不抛出
 * 4. saveId='0'（pool 生成）→ save_id=null 避免 FK 违约
 * 5. 字段映射：cache/stage 元数据与 success 布尔 → 整数
 * 6. destroy：清理定时器并 flush 剩余数据
 */

function makePayload(overrides: Partial<LLMCallMetricsPayload> = {}): LLMCallMetricsPayload {
  return {
    saveId: 'save-1',
    agentType: 'coordinator',
    model: 'deepseek-chat',
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    durationMs: 1500,
    success: true,
    timestamp: 1770000000000,
    ...overrides,
  };
}

describe('LLMMetricsSink', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('agent_llm_calls', (table) => {
      table.text('id').primary();
      table.text('save_id').nullable();
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
      table.float('cost').nullable();
    });

    // M2-2 成本附带：Sink 按 default_model 匹配 provider 行解析元数据
    await db.schema.createTable('model_providers', (table) => {
      table.text('id').primary();
      table.text('provider_type').notNullable();
      table.text('name').notNullable();
      table.text('default_model').nullable();
      table.text('extra_config').nullable();
      table.integer('enabled').defaultTo(1);
    });
  });

  /** 插入 provider 行（M2-2 成本解析依赖） */
  async function insertProvider(overrides: {
    id?: string;
    providerType?: string;
    name?: string;
    defaultModel?: string | null;
    extraConfig?: string | null;
    enabled?: number;
  } = {}): Promise<void> {
    await db('model_providers').insert({
      id: overrides.id ?? 'p-1',
      provider_type: overrides.providerType ?? 'deepseek',
      name: overrides.name ?? 'DeepSeek',
      default_model: overrides.defaultModel === undefined ? 'deepseek-chat' : overrides.defaultModel,
      extra_config: overrides.extraConfig === undefined ? null : overrides.extraConfig,
      enabled: overrides.enabled ?? 1,
    });
  }

  afterEach(async () => {
    await db.destroy();
  });

  it('record 后 1 秒 debounce 触发批量插入', async () => {
    vi.useFakeTimers();
    try {
      const sink = new LLMMetricsSink(db);
      sink.record(makePayload({ model: 'model-a' }));
      sink.record(makePayload({ model: 'model-b' }));

      // debounce 未触发前表为空
      expect(await db('agent_llm_calls').count('* as c').first()).toMatchObject({ c: 0 });

      await vi.advanceTimersByTimeAsync(1000);

      const rows = await db('agent_llm_calls').orderBy('model', 'asc');
      expect(rows.map(r => r.model)).toEqual(['model-a', 'model-b']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('buffer 满 100 条时立即 flush（不等 debounce）', async () => {
    vi.useFakeTimers();
    try {
      const sink = new LLMMetricsSink(db);
      for (let i = 0; i < 100; i++) {
        sink.record(makePayload({ model: `m-${i}` }));
      }

      // flush 是异步的，等待微任务完成
      await vi.advanceTimersByTimeAsync(0);

      expect(await db('agent_llm_calls').count('* as c').first()).toMatchObject({ c: 100 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("saveId='0' 时 save_id 写入 null（避免 saves 表 FK 违约）", async () => {
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload({ saveId: '0' }));
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    expect(row.save_id).toBeNull();
  });

  it('字段映射：success 布尔转整数，可选元数据缺失时写 null/0', async () => {
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload({ success: false }));
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    expect(row).toMatchObject({
      save_id: 'save-1',
      agent_type: 'coordinator',
      model: 'deepseek-chat',
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      duration_ms: 1500,
      success: 0,
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 0,
      stage: null,
      prefix_hash: null,
      cache_strategy: null,
      react_iterations: null,
      tool_calls_count: null,
    });
    expect(row.id).toBeTruthy();
  });

  it('字段映射：cache 与阶段元数据完整透传', async () => {
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload({
      promptCacheHitTokens: 64,
      promptCacheMissTokens: 36,
      stage: 'planner',
      prefixHash: 'hash-123',
      cacheStrategy: 'stable-prefix-v1',
      reactIterations: 2,
      toolCallsCount: 3,
    }));
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    expect(row).toMatchObject({
      prompt_cache_hit_tokens: 64,
      prompt_cache_miss_tokens: 36,
      stage: 'planner',
      prefix_hash: 'hash-123',
      cache_strategy: 'stable-prefix-v1',
      react_iterations: 2,
      tool_calls_count: 3,
    });
  });

  it('flush 失败时丢弃批次且不抛出（不阻塞 LLM 主流程）', async () => {
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload());
    await db.schema.dropTable('agent_llm_calls');

    await expect(sink.flush()).resolves.toBeUndefined();
    // 批次已丢弃：后续 record 可正常工作
    sink.record(makePayload());
  });

  it('并发 flush 保护：flushing 期间重复调用直接返回', async () => {
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload());

    const first = sink.flush();
    const second = sink.flush();
    await Promise.all([first, second]);

    expect(await db('agent_llm_calls').count('* as c').first()).toMatchObject({ c: 1 });
  });

  it('destroy 清理定时器并 flush 剩余数据', async () => {
    vi.useFakeTimers();
    try {
      const sink = new LLMMetricsSink(db);
      sink.record(makePayload());

      await sink.destroy();

      expect(await db('agent_llm_calls').count('* as c').first()).toMatchObject({ c: 1 });
      // destroy 后不再有待触发定时器
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ============================================================
  // M2-2 成本附带（resolveModelMetadata + calculateCost）
  // ============================================================

  it('已知模型附带 cost：deepseek-chat 静态表成本计算正确（§10.2 验收3）', async () => {
    await insertProvider();
    const sink = new LLMMetricsSink(db);
    // prompt 100 / completion 20；deepseek-chat: input $0.27/M, output $1.1/M（inclusive 口径）
    sink.record(makePayload());
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    const expected = (100 / 1e6) * 0.27 + (20 / 1e6) * 1.1;
    expect(row.cost).toBeCloseTo(expected, 10);
  });

  it('已知模型含 cache token：命中按 cacheRead 价、计费输入扣除命中（inclusive 口径）', async () => {
    await insertProvider();
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload({ promptCacheHitTokens: 64, promptCacheMissTokens: 36 }));
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    // 计费输入 = 100-64=36（$0.27/M）+ 输出 20（$1.1/M）+ 命中 64（$0.07/M）+ 写缓存 36（无单价按 0）
    const expected = (36 / 1e6) * 0.27 + (20 / 1e6) * 1.1 + (64 / 1e6) * 0.07;
    expect(row.cost).toBeCloseTo(expected, 10);
  });

  it('未知模型 cost 为 null 而非 0（禁止编造，§10.2 验收3）', async () => {
    await insertProvider({ defaultModel: 'deepseek-chat' });
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload({ model: 'unknown-model-x' }));
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    expect(row.cost).toBeNull();
  });

  it('无 provider 行匹配时 cost 为 null', async () => {
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload());
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    expect(row.cost).toBeNull();
  });

  it('payload.cost 显式提供时直接使用（扩展点优先于 Sink 计算）', async () => {
    await insertProvider();
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload({
      cost: { inputCost: 1, outputCost: 2, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 3.25 },
    }));
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    expect(row.cost).toBe(3.25);
  });

  it('DB override（extra_config.metadata）覆盖静态表成本', async () => {
    await insertProvider({
      extraConfig: JSON.stringify({ metadata: { cost: { input: 1, output: 2 } } }),
    });
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload());
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    // 覆盖后：input $1/M × 100 + output $2/M × 20（cacheRead 覆盖未提供回落静态表 0.07，但无命中不计）
    const expected = (100 / 1e6) * 1 + (20 / 1e6) * 2;
    expect(row.cost).toBeCloseTo(expected, 10);
  });

  it('disabled provider 行不参与成本解析（cost 为 null）', async () => {
    await insertProvider({ enabled: 0 });
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload());
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    expect(row.cost).toBeNull();
  });

  it('extra_config JSON 非法时忽略 override 并回落静态表', async () => {
    await insertProvider({ extraConfig: '{invalid json' });
    const sink = new LLMMetricsSink(db);
    sink.record(makePayload());
    await sink.flush();

    const row = await db('agent_llm_calls').first();
    const expected = (100 / 1e6) * 0.27 + (20 / 1e6) * 1.1;
    expect(row.cost).toBeCloseTo(expected, 10);
  });
});
