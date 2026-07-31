/**
 * LLMDispatchMetricsSink — Dispatcher 调度指标异步持久化订阅器（E 层）
 *
 * 架构归属：服务层 E（packages/backend/src/services/llm-metrics/）
 * 职责：订阅 EventBus 上的 'llm_metrics_event' 事件，异步批量写入 llm_dispatch_metrics 表
 *
 * 分表决策（v2.4，2026-07-27 拍板）：
 * - 本订阅器写 llm_dispatch_metrics（dispatcher 调度度量：provider_id/key_index/attempt_count/cooldown 等）
 * - agent_llm_calls 仅由 M1 的 LLMMetricsSink 写单次调用度量（token 使用、耗时），两表关注点分离
 *
 * StagingPool 豁免说明（architecture-standards §13.1 第 4 条"非 Agent 路径显式豁免"）：
 * - 本订阅器是异步事件驱动的服务层 E 后台订阅器，非 ReAct 循环内工具写操作
 * - 写入目标 llm_dispatch_metrics 为指标表，非 save-scoped 游戏状态表（不含 save_id PK），ShadowState 无需缓存
 * - 异步批量写入（1s debounce / 满 100 条立即 flush），与 StagingPool 事务性暂存机制目标不同
 * - 写入失败仅影响可观测性，不影响游戏逻辑（logger.error 降级，丢弃批次不阻塞 Dispatcher 主流程）
 * - 因此显式豁免 StagingPool，不通过 StagingKnex 代理，直接使用 knex 实例写入
 *
 * 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §6.2
 * 适配说明（与现有 EventBus 实现对齐）：设计文档使用 eventBus.on/off，
 * 现有 EventBus 为 subscribe/unsubscribe，payload 经 BusEvent.data 传递。
 */

import type { Knex } from 'knex';
import type { EventBus, BusEvent, LLMMetricsEventPayload } from '@ai-rpg/shared/messaging';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('llm-dispatch-metrics-sink');

export class LLMDispatchMetricsSink {
  private buffer: LLMMetricsEventPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  private readonly flushIntervalMs = 1000;
  private readonly maxBufferSize = 100;

  /** handler 绑定引用（destroy 中 unsubscribe 必须传同一引用才能正确取消订阅） */
  private readonly boundOnMetricsEvent: (event: BusEvent) => void;

  constructor(
    private readonly db: Knex,
    private readonly eventBus: EventBus,
  ) {
    this.boundOnMetricsEvent = (event) =>
      this.onMetricsEvent(event.data as unknown as LLMMetricsEventPayload);
  }

  /**
   * 启动时调用（订阅事件）
   */
  initialize(): void {
    this.eventBus.subscribe('llm_metrics_event', this.boundOnMetricsEvent);
    logger.info('LLMDispatchMetricsSink initialized, subscribed to llm_metrics_event');
  }

  /**
   * 事件处理：缓冲 + debounce flush
   */
  private onMetricsEvent(payload: LLMMetricsEventPayload): void {
    this.buffer.push(payload);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush().catch((err) => {
        logger.error('Failed to flush dispatch metrics buffer', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flush().catch((err) => {
        logger.error('Failed to flush dispatch metrics buffer', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.flushIntervalMs);
  }

  /**
   * 批量写入 llm_dispatch_metrics 表（v2.4 分表）
   *
   * StagingPool 豁免：本方法不经过 StagingKnex 代理，直接使用 knex 实例写入。
   * 理由详见类注释（非 ReAct 循环路径 + 非 save-scoped 表 + 异步可观测性数据）。
   *
   * 失败降级：仅记录日志并丢弃批次（可观测性数据可容忍丢失，
   * 不重入缓冲区避免无限堆积导致内存泄漏）。
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      const rows = batch.map((p) => ({
        provider_id: p.providerId,
        agent_key: p.agentKey,
        // 可空（如 batch_spawn_agents 内部分发无 saveId）
        save_id: p.saveId ?? null,
        key_index: p.keyIndex,
        success: p.success ? 1 : 0,
        error_type: p.errorType ?? null,
        duration_ms: p.durationMs,
        attempt_count: p.attemptCount,
        wait_ms: p.waitMs,
        cooldown_triggered: p.cooldownTriggered ? 1 : 0,
        created_at: new Date(p.timestamp).toISOString(),
      }));

      await this.db('llm_dispatch_metrics').insert(rows);
      logger.debug('LLMDispatchMetricsSink flushed', { count: rows.length });
    } catch (err) {
      logger.error('LLMDispatchMetricsSink flush failed', {
        count: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.flushing = false;
    }
  }

  /**
   * 销毁：清理定时器 + 最后一次 flush + 取消订阅
   * 与 LLMRequestDispatcher.destroy() 配套调用（init.ts 注册 SIGTERM/SIGINT hook）
   */
  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
    this.eventBus.unsubscribe('llm_metrics_event', this.boundOnMetricsEvent);
    logger.info('LLMDispatchMetricsSink destroyed');
  }
}
