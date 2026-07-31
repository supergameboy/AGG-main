import type { Knex } from 'knex';

/**
 * 009: M9 LLMRequestDispatcher 支撑迁移
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §9.1
 *
 * 三项变更：
 * 1. model_providers 新增 version 列（NOT NULL DEFAULT 0）
 *    — provider_config_changed 事件契约的版本号（§12.1），订阅方据此丢弃过期事件；
 *      ModelConfigService 每次 update 时 version = version + 1
 * 2. api_keys JSON 回填 rateLimit 默认配置
 *    — 现有 key 无 rateLimit 时回填默认值（与 agents/llm-dispatcher/constants.ts 的
 *      DEFAULT_TOKEN_BUCKET_CONFIG 一致：capacity=5, refillRatePerSec=1, maxConcurrent=3）
 *    — 仅新增缺失字段，不触碰已加密的 key 字段
 * 3. 新增 llm_dispatch_metrics 指标表
 *    — v2.4 分表决策（用户 2026-07-27 拍板）：M9 dispatcher 调度度量写本表；
 *      agent_llm_calls 仅由 M1 LLMMetricsSink 写单次调用度量，两表关注点分离
 *    — 本表非 save-scoped（save_id 可空），不注册到 SHADOW_STATE_TABLES（§13.1 第 5 条）
 *    — 写入方为 E 层 LLMMetricsSink（services/llm-metrics-sink/），StagingPool 显式豁免
 *
 * 幂等性：列/表存在性检查 + rateLimit 仅回填缺失项，重复执行无副作用。
 */

/**
 * 与 agents/llm-dispatcher/constants.ts DEFAULT_TOKEN_BUCKET_CONFIG 保持一致。
 * 迁移脚本自包含，不 import agents/ 层模块（数据层不反向依赖 Agent 核心）。
 */
const DEFAULT_KEY_RATE_LIMIT = {
  capacity: 5,
  refillRatePerSec: 1,
  maxConcurrent: 3,
} as const;

interface ApiKeyJsonEntry {
  rateLimit?: typeof DEFAULT_KEY_RATE_LIMIT;
  [key: string]: unknown;
}

export async function up(knex: Knex): Promise<void> {
  // 1. model_providers 新增 version 列
  const hasVersion = await knex.schema.hasColumn('model_providers', 'version');
  if (!hasVersion) {
    await knex.schema.alterTable('model_providers', (table) => {
      table.bigInteger('version').notNullable().defaultTo(0);
    });
    console.log('009: added model_providers.version column');
  } else {
    console.log('009: model_providers.version column already exists, skipping');
  }

  // 2. api_keys JSON 回填 rateLimit（仅回填缺失项，幂等）
  const providers = await knex('model_providers').select('id', 'api_keys');
  let backfilled = 0;
  for (const provider of providers) {
    const keys = JSON.parse(provider.api_keys || '[]') as ApiKeyJsonEntry[];
    let changed = false;
    const updatedKeys = keys.map((k) => {
      if (k.rateLimit) return k;
      changed = true;
      return { ...k, rateLimit: { ...DEFAULT_KEY_RATE_LIMIT } };
    });
    if (changed) {
      await knex('model_providers')
        .where('id', provider.id)
        .update({ api_keys: JSON.stringify(updatedKeys) });
      backfilled += 1;
    }
  }
  console.log(`009: api_keys rateLimit backfill complete (${backfilled}/${providers.length} providers updated)`);

  // 3. 新增 llm_dispatch_metrics 指标表（v2.4 分表）
  const hasTable = await knex.schema.hasTable('llm_dispatch_metrics');
  if (!hasTable) {
    await knex.schema.createTable('llm_dispatch_metrics', (table) => {
      table.increments('id').primary();
      table.string('provider_id', 64).notNullable();
      table.string('agent_key', 64).notNullable();
      // 可空：batch_spawn_agents 内部分发等场景无 saveId；非 save-scoped 表
      table.string('save_id', 64).nullable();
      // 本次调用的 key 索引（-1 表示无可用 key）
      table.integer('key_index').notNullable();
      // boolean 以 0/1 存储（与 agent_llm_calls 等姊妹表风格一致）
      table.integer('success').notNullable();
      // rate_limited / auth_failed / server_error / timeout / network / context_overflow / no_available_key
      table.string('error_type', 32).nullable();
      table.integer('duration_ms').notNullable();
      // 本次 dispatch 总尝试次数（含失败转移）
      table.integer('attempt_count').notNullable();
      // 令牌桶 acquire 总等待时间（毫秒）
      table.integer('wait_ms').notNullable();
      table.integer('cooldown_triggered').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      // 按 provider + 时间范围查询指标
      table.index(['provider_id', 'created_at'], 'idx_llm_dispatch_metrics_provider_time');
      // 按 save_id 查询某次游戏的所有 LLM 调度（调试用）
      table.index(['save_id'], 'idx_llm_dispatch_metrics_save_id');
      // 按 agent_key 查询某 Agent 的调度历史
      table.index(['agent_key', 'created_at'], 'idx_llm_dispatch_metrics_agent_time');
    });
    console.log('009: created llm_dispatch_metrics table');
  } else {
    console.log('009: llm_dispatch_metrics table already exists, skipping');
  }
}

export async function down(knex: Knex): Promise<void> {
  // 逆序回滚：先删表，再剥离 rateLimit，最后删列

  await knex.schema.dropTableIfExists('llm_dispatch_metrics');
  console.log('009 down: dropped llm_dispatch_metrics table');

  const providers = await knex('model_providers').select('id', 'api_keys');
  for (const provider of providers) {
    const keys = JSON.parse(provider.api_keys || '[]') as ApiKeyJsonEntry[];
    const updatedKeys = keys.map((k) => {
      const rest = { ...k };
      delete rest.rateLimit;
      return rest;
    });
    await knex('model_providers')
      .where('id', provider.id)
      .update({ api_keys: JSON.stringify(updatedKeys) });
  }
  console.log('009 down: stripped rateLimit from api_keys');

  const hasVersion = await knex.schema.hasColumn('model_providers', 'version');
  if (hasVersion) {
    await knex.raw('ALTER TABLE model_providers DROP COLUMN version');
    console.log('009 down: dropped model_providers.version column');
  }
}
