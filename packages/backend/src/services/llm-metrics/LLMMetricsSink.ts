/**
 * LLMMetricsSink — LLM 度量数据 Sink（E 层）
 *
 * 实现 @ai-rpg/ai 定义的 ILLMMetricsSink 端口，将度量数据异步批量写入 agent_llm_calls 表。
 *
 * 性能优化策略（设计文档 模块M1 §6.4）：
 * - 1s debounce：1 秒内的多条记录合并为一次批量插入
 * - 100 条阈值：buffer 满 100 条立即 flush
 * - 非阻塞：record() 方法立即返回，不等待 DB 写入
 * - flush 失败记录错误日志并丢弃批次（不阻塞 LLM 调用主流程）
 *
 * 成本附带（M2-2，设计文档 模块M2 §6.3/§9.2）：
 * - flush 时经 resolveModelMetadata + calculateCost 计算 cost 列（USD，可空）
 * - provider/DB override 来源：model_providers 行（default_model 匹配 payload.model）
 * - 未知模型 / 无 cost 元数据 → null（禁止写 0 掩盖未知）
 * - payload.cost 已显式提供时直接使用（扩展点，优先级高于 Sink 计算）
 * - 元数据查询失败仅记错误日志、本批 cost 全 null：成本是辅助信息，
 *   故障隔离不允许拖垮 token 度量主流程（非 fallback 掩盖，错误可观测）
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import type { ILLMMetricsSink, LLMCallMetricsPayload, ModelMetadata } from '@ai-rpg/ai';
import { resolveModelMetadata, calculateCost, getBuiltinModelMetadata } from '@ai-rpg/ai';
import type { ID, Timestamp } from '@ai-rpg/shared';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('llm-metrics-sink');

/** 元数据解析提示：model_providers 行提供的 provider 类型 + DB override */
interface ModelMetadataHint {
  providerType: string;
  dbOverride?: Partial<ModelMetadata>;
}

export class LLMMetricsSink implements ILLMMetricsSink {
  private buffer: LLMCallMetricsPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  private readonly flushIntervalMs = 1000;
  private readonly maxBufferSize = 100;

  constructor(private readonly db: Knex) {}

  /**
   * 记录度量数据（非阻塞）
   */
  record(payload: LLMCallMetricsPayload): void {
    this.buffer.push(payload);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush().catch(err => {
        logger.error('Failed to flush metrics buffer', { error: err instanceof Error ? err.message : String(err) });
      });
      return;
    }

    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flush().catch(err => {
        logger.error('Failed to flush metrics buffer', { error: err instanceof Error ? err.message : String(err) });
      });
    }, this.flushIntervalMs);
  }

  /**
   * 加载 model → 元数据提示映射（每次 flush 查询一次，配置变更即时生效）
   *
   * 多行同 default_model 时优先静态表命中行（元数据解析更可能成功），
   * 否则保持 name 升序首行（与 listProviderRows 同序，确定性）。
   * 查询失败返回空 Map（本批 cost 全 null），错误已记日志可观测。
   */
  private async loadModelMetadataHints(): Promise<Map<string, ModelMetadataHint>> {
    try {
      const rows = await this.db('model_providers')
        .select('provider_type', 'default_model', 'extra_config')
        .where('enabled', 1)
        .orderBy('name', 'asc');

      const hints = new Map<string, ModelMetadataHint>();
      for (const row of rows) {
        const model = row.default_model as string | null;
        if (!model) continue;
        const hint: ModelMetadataHint = {
          providerType: row.provider_type as string,
          dbOverride: this.parseMetadataOverride(row.extra_config as string | null),
        };
        const existing = hints.get(model);
        if (!existing) {
          hints.set(model, hint);
        } else if (
          getBuiltinModelMetadata(existing.providerType, model) === undefined &&
          getBuiltinModelMetadata(hint.providerType, model) !== undefined
        ) {
          hints.set(model, hint);
        }
      }
      return hints;
    } catch (error) {
      logger.error('Failed to load model metadata hints, cost will be null for this batch', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  /**
   * 解析 model_providers.extra_config 中的 metadata 字段（DB override 通道）。
   * JSON 非法 / metadata 非对象 → 忽略并 warn；字段级合法性由 resolveModelMetadata sanitize。
   */
  private parseMetadataOverride(extraConfig: string | null): Partial<ModelMetadata> | undefined {
    if (!extraConfig) return undefined;
    try {
      const parsed: unknown = JSON.parse(extraConfig);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
      const metadata = (parsed as Record<string, unknown>).metadata;
      if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return undefined;
      return metadata as Partial<ModelMetadata>;
    } catch (error) {
      logger.warn('model_providers.extra_config JSON 解析失败，忽略 metadata 覆盖', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * 计算单条度量的成本（USD）。
   * 优先级：payload.cost（显式扩展点）> Sink 计算 > null（未知模型，禁止 0）。
   */
  private resolveCost(payload: LLMCallMetricsPayload, hints: Map<string, ModelMetadataHint>): number | null {
    if (payload.cost) return payload.cost.totalCost;

    const hint = hints.get(payload.model);
    if (!hint) return null;

    const metadata = resolveModelMetadata(hint.providerType, payload.model, hint.dbOverride);
    if (!metadata) return null;

    const breakdown = calculateCost(metadata, {
      promptTokens: payload.promptTokens,
      completionTokens: payload.completionTokens,
      promptCacheHitTokens: payload.promptCacheHitTokens,
      promptCacheMissTokens: payload.promptCacheMissTokens,
    });
    return breakdown?.totalCost ?? null;
  }

  /**
   * 刷新 buffer 到 DB
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      const metadataHints = await this.loadModelMetadataHints();

      await this.db('agent_llm_calls').insert(
        batch.map(payload => ({
          id: randomUUID() as ID,
          // Pool generation uses saveId='0' which doesn't exist in saves table;
          // set to null to avoid FK constraint violation
          save_id: payload.saveId === '0' ? null : payload.saveId,
          agent_type: payload.agentType,
          model: payload.model,
          prompt_tokens: payload.promptTokens,
          completion_tokens: payload.completionTokens,
          total_tokens: payload.totalTokens,
          duration_ms: payload.durationMs,
          success: payload.success ? 1 : 0,
          timestamp: payload.timestamp as Timestamp,
          prompt_cache_hit_tokens: payload.promptCacheHitTokens ?? 0,
          prompt_cache_miss_tokens: payload.promptCacheMissTokens ?? 0,
          stage: payload.stage ?? null,
          prefix_hash: payload.prefixHash ?? null,
          cache_strategy: payload.cacheStrategy ?? null,
          react_iterations: payload.reactIterations ?? null,
          tool_calls_count: payload.toolCallsCount ?? null,
          cost: this.resolveCost(payload, metadataHints),
        }))
      );

      logger.debug('Flushed metrics batch', { count: batch.length });
    } catch (error) {
      logger.error('Failed to insert metrics batch', {
        error: error instanceof Error ? error.message : String(error),
        count: batch.length,
      });
      // 失败时丢弃批次，避免无限重试导致内存泄漏
    } finally {
      this.flushing = false;
    }
  }

  /**
   * 销毁（清理定时器，flush 剩余数据）
   */
  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }
}
