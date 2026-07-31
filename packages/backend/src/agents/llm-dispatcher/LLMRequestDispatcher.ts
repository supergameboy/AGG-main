import { randomUUID } from 'crypto';
import type { ID } from '@ai-rpg/shared';
import type { IDevTraceHook, DevTraceType } from '@ai-rpg/shared/tool-core';
import type { EventBus, BusEvent, ProviderConfigChangedPayload, LLMMetricsEventPayload } from '@ai-rpg/shared/messaging';
import type { LLMService, ModelConfigService, LLMStreamFinalMessage, OAuthCredentialService } from '@ai-rpg/ai';
import { getOAuthProvider } from '@ai-rpg/ai';
import { createChildLogger } from '../../utils/logger.js';
import { KeyHealthTracker } from './KeyHealthTracker.js';
import { DispatcherMetrics } from './DispatcherMetrics.js';
import type { TokenBucketConfig } from './TokenBucket.js';
import {
  ACQUIRE_TIMEOUT_DEFAULT_MS,
  COOLDOWN_DEFAULT_MS,
  FAILED_RESTORE_MS,
  computeMaxAttempts,
} from './constants.js';
import type {
  ILLMRequestDispatcher,
  LLMDispatchRequest,
  LLMDispatchResult,
  LLMDispatchErrorType,
  LLMDispatchStreamEvent,
  DispatcherMetricsSnapshot,
} from './types.js';

const logger = createChildLogger('llm-dispatcher');

/** dispatcher 调度 trace 事件类型（DevTraceType 的 dispatcher_* 子集） */
type DispatcherTraceType = Extract<DevTraceType, `dispatcher_${string}`>;

/** 错误分类结果（内部维度，比 LLMDispatchErrorType 更细） */
type ClassifiedErrorCategory = 'rate_limit' | 'auth' | 'timeout' | 'network' | 'server_error' | 'other';

/**
 * LLM 请求调度器
 *
 * 职责：
 * 1. 选 key（令牌最多优先）
 * 2. per-key 令牌桶限流（并发 + QPS）
 * 3. 调用 LLMService.chatWithKey / streamWithKey（传入选定的 key）
 * 4. 失败转移（429/401 切下一个 key）
 * 5. 动态冷静期管理（Retry-After 头解析）
 * 6. 配置变更同步（provider_config_changed 事件驱动 + 启动全量兜底）
 *
 * 架构归属：Agent 核心层 G
 * 架构合规：通过 AgentDeps 注入，替代直接注入 LLMService
 *
 * 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §4/§6.3/§12
 *
 * 适配说明（与现有 EventBus 实现对齐）：
 * - 设计文档使用 eventBus.on/off + emit(type, payload)，现有 EventBus 为
 *   subscribe/unsubscribe + emit(type, BusEvent)，payload 经 BusEvent.data 传递
 */
export class LLMRequestDispatcher implements ILLMRequestDispatcher {
  private trackers: Map<string, KeyHealthTracker> = new Map();
  private metrics: DispatcherMetrics = new DispatcherMetrics();
  private initialized = false;

  // ============== provider_config_changed 事件契约相关字段（§12） ==============
  /** 已处理 eventId 集合（幂等去重，FIFO 上限 1000） */
  private processedEventIds: Set<string> = new Set();
  /** 每个 providerId 最近已处理的 version（乱序丢弃） */
  private lastProcessedVersion: Map<string, number> = new Map();
  /** 同 providerId 串行化锁（避免并发同步导致 tracker 状态错乱） */
  private syncLock: Map<string, Promise<void>> = new Map();
  /** debounce 定时器（防事件风暴，§12.3） */
  private configChangeDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** debounce 窗口内待处理的 payload（取 version 最大者） */
  private pendingConfigChanges: Map<string, ProviderConfigChangedPayload> = new Map();
  private readonly CONFIG_CHANGE_DEBOUNCE_MS = 300;
  /**
   * 事件 handler 绑定引用（构造函数中绑定，destroy 中 unsubscribe 必须传同一引用
   * 才能正确取消订阅）
   */
  private readonly boundOnConfigChanged: (event: BusEvent) => void;

  constructor(
    private readonly llmService: LLMService,
    private readonly modelConfigService: ModelConfigService,
    private readonly eventBus: EventBus,
    private readonly devTraceHook: IDevTraceHook,
    private readonly acquireTimeoutMs: number = ACQUIRE_TIMEOUT_DEFAULT_MS,
    private readonly oauthCredentialService?: OAuthCredentialService,
  ) {
    this.boundOnConfigChanged = (event) =>
      this.onProviderConfigChanged(event.data as unknown as ProviderConfigChangedPayload);
    this.eventBus.subscribe('provider_config_changed', this.boundOnConfigChanged);
  }

  /**
   * 初始化（启动时调用一次）
   *
   * 调用 syncAllTrackers 全量同步，作为"配置变更未触发事件"的兜底（§12.2.4）。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.syncAllTrackers();
    this.initialized = true;
    logger.info('LLMRequestDispatcher initialized', {
      providerCount: this.trackers.size,
    });
  }

  /**
   * 主入口：调度 LLM 请求（非流式）
   *
   * 尝试计数策略（B2 修复）：
   * - llmCallAttempts：仅统计真正调用 LLMService 的次数（含 429/auth/5xx）
   * - 令牌等待失败（acquire=false）不计入 llmCallAttempts，但会通过 triedKeyIndices 排除该 key
   * - maxAttempts = min(provider.apiKeys.length, MAX_LLM_CALL_ATTEMPTS)
   */
  async dispatch(request: LLMDispatchRequest): Promise<LLMDispatchResult> {
    const startTime = Date.now();
    const requestId = `dispatch-${startTime}-${Math.random().toString(36).slice(2, 8)}`;

    this.emitTrace('dispatcher_request_start', {
      providerId: request.providerId,
      agentKey: request.agentKey,
      saveId: request.saveId,
      requestId,
    });

    const resolved = await this.resolveProviderAndTracker(request, startTime, requestId);
    if ('result' in resolved) return resolved.result;
    const { providerId, tracker, provider } = resolved;

    // B2 修复：动态计算最大尝试次数 = min(key 总数, 3)
    const maxAttempts = computeMaxAttempts(provider.apiKeys.length);

    let llmCallAttempts = 0;
    let lastKeyIndex = -1;
    let cooldownTriggered = false;
    let totalWaitMs = 0;
    /** 已尝试过的 key 索引集合（避免重复试同一 key） */
    const triedKeyIndices = new Set<number>();

    while (llmCallAttempts < maxAttempts) {
      // 1. 选 key（排除已尝试的）
      const keyIndex = tracker.selectKey(triedKeyIndices);
      if (keyIndex === null) {
        const minRemaining = tracker.getMinCooldownRemainingMs();
        logger.warn('All keys unavailable', { providerId, llmCallAttempts, minRemaining, triedKeyIndices: [...triedKeyIndices] });
        const result = this.failResult(
          'no_available_key',
          `All keys in cooldown, min remaining ${minRemaining}ms`,
          false,
          lastKeyIndex,
          llmCallAttempts,
          startTime,
          requestId,
          { waitMs: totalWaitMs, cooldownTriggered },
        );
        this.emitMetricsEvent(providerId, request, result, startTime, lastKeyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        return result;
      }
      lastKeyIndex = keyIndex;
      triedKeyIndices.add(keyIndex);

      this.emitTrace('dispatcher_key_selected', { providerId, keyIndex, saveId: request.saveId, requestId });

      // 2. 获取桶并 acquire
      const bucket = tracker.getBucket(keyIndex)!;
      const acquireTimeoutMs = request.timeoutMs ?? this.acquireTimeoutMs;
      const acquireStart = Date.now();
      const acquired = await bucket.acquire(acquireTimeoutMs);
      const waitMs = Date.now() - acquireStart;
      totalWaitMs += waitMs;

      if (!acquired) {
        // 令牌等待失败（超时或 key 进入冷静期）：不计入 llmCallAttempts，继续尝试下一个 key
        logger.warn('Token acquire failed, will try next key', {
          providerId, keyIndex, waitMs, triedKeyIndices: [...triedKeyIndices],
        });
        continue;
      }

      this.emitTrace('dispatcher_token_acquired', { providerId, keyIndex, waitMs, saveId: request.saveId, requestId });

      // 3. 解析运行时 key（M2-B3 D2：OAuth 托管型经 OAuthCredentialService 运行时解析真实 token）
      let apiKey: string | null;
      try {
        apiKey = await this.resolveRuntimeApiKey(provider.providerType, provider.apiKeys[keyIndex].key);
      } catch (err) {
        // 刷新失败：provider_error（retryable=false），不记 key 故障（故障源在 OAuth 凭证而非 key 本身）
        bucket.release();
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('OAuth resolveApiKey failed', { providerId, providerType: provider.providerType, error: errorMessage });
        const result = this.failResult('provider_error', errorMessage, false, keyIndex, llmCallAttempts, startTime, requestId, { waitMs: totalWaitMs, cooldownTriggered });
        this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        return result;
      }
      if (apiKey === null) {
        // OAuth 未登录：无凭证可解析，提示走授权流程
        bucket.release();
        const result = this.failResult(
          'no_available_key',
          `OAuth provider '${provider.providerType}' 未登录，请先在模型配置页完成授权`,
          false, keyIndex, llmCallAttempts, startTime, requestId,
          { waitMs: totalWaitMs, cooldownTriggered },
        );
        this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        return result;
      }

      // 4. 调用 LLM（acquire 成功 + key 解析成功才计入 llmCallAttempts）
      llmCallAttempts += 1;

      try {
        const response = await this.llmService.chatWithKey(
          request.messages,
          {
            providerId,
            model: request.model ?? provider.defaultModel,
            apiKey,
            keyIndex,
            options: request.options,
          },
        );

        // 4. 成功，release token
        bucket.release();
        this.metrics.recordSuccess(providerId, keyIndex, Date.now() - startTime);
        this.metrics.recordAttempt(providerId, totalWaitMs, llmCallAttempts);

        this.emitTrace('dispatcher_request_end', {
          providerId, success: true, attemptCount: llmCallAttempts, totalMs: Date.now() - startTime,
          saveId: request.saveId, requestId,
        });

        const result: LLMDispatchResult = {
          success: true,
          response: this.convertChatResponse(response),
          metrics: {
            selectedKeyIndex: keyIndex,
            waitMs: totalWaitMs,
            attemptCount: llmCallAttempts,
            cooldownTriggered,
          },
        };
        this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        return result;
      } catch (err) {
        bucket.release();
        const errorType = this.classifyError(err);
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (errorType === 'rate_limit') {
          // 429：标记冷静期 + 切下一个 key
          const retryAfterMs = this.parseRetryAfter(err);
          bucket.markCooldown(retryAfterMs);
          cooldownTriggered = true;
          this.metrics.record429(providerId, keyIndex);
          this.emitTrace('dispatcher_cooldown_triggered', {
            providerId, keyIndex, cooldownMs: retryAfterMs || COOLDOWN_DEFAULT_MS, saveId: request.saveId, requestId,
          });
          continue;
        }

        if (errorType === 'auth') {
          // 401/403：标记 failed + 切下一个 key
          bucket.markFailed(errorMessage);
          this.metrics.recordAuthFailed(providerId, keyIndex);
          // M2-B3 D2：OAuth 托管型 401 意味着 session token 可能提前失效，后台强制刷新（fire-and-forget）
          this.triggerOAuthForceRefresh(provider.providerType);
          this.emitTrace('dispatcher_key_failed', {
            providerId, keyIndex, error: errorMessage, saveId: request.saveId, requestId,
          });
          continue;
        }

        // 其他错误（5xx/timeout/network/context_overflow 等）：交给调用方
        this.metrics.recordError(providerId, keyIndex, errorType);
        this.metrics.recordAttempt(providerId, totalWaitMs, llmCallAttempts);
        this.emitTrace('dispatcher_request_end', {
          providerId, success: false, attemptCount: llmCallAttempts, totalMs: Date.now() - startTime,
          saveId: request.saveId, requestId,
        });

        const result: LLMDispatchResult = {
          success: false,
          error: {
            type: errorType === 'timeout' ? 'timeout' : 'provider_error',
            message: errorMessage,
            retryable: errorType === 'timeout' || errorType === 'network' || errorType === 'server_error',
            lastUsedKeyIndex: keyIndex,
          },
          metrics: {
            selectedKeyIndex: keyIndex,
            waitMs: totalWaitMs,
            attemptCount: llmCallAttempts,
            cooldownTriggered,
          },
        };
        this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        return result;
      }
    }

    // 达到最大 LLM 调用尝试次数
    const result = this.failResult(
      'rate_limited',
      `Max ${maxAttempts} LLM call attempts reached`,
      true,
      lastKeyIndex,
      llmCallAttempts,
      startTime,
      requestId,
      { waitMs: totalWaitMs, cooldownTriggered },
    );
    this.emitMetricsEvent(providerId, request, result, startTime, lastKeyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
    return result;
  }

  /**
   * 调度 LLM 请求（流式）
   *
   * 复用 dispatch 的选 key / 令牌桶 / 失败转移逻辑，通过 LLMService.streamWithKey 暴露流式入口。
   *
   * 失败转移边界：仅在"尚未向消费方 yield 任何 delta"时允许 429/auth 失败转移
   * （已输出部分内容后失败无法无缝切换，错误事件直接透传给消费方）。
   *
   * 事件映射（LLMStreamEvent → LLMDispatchStreamEvent）：
   * - text_delta → delta（增量文本）
   * - done → done（携带完整响应，含 toolCalls/usage）
   * - error → error（不可转移错误）
   * - 其余生命周期事件（start/text_start/thinking_* 等）由 done 事件聚合承载，不逐条透传
   */
  async dispatchStream(request: LLMDispatchRequest): Promise<AsyncIterable<LLMDispatchStreamEvent>> {
    const startTime = Date.now();
    const requestId = `dispatch-stream-${startTime}-${Math.random().toString(36).slice(2, 8)}`;

    this.emitTrace('dispatcher_request_start', {
      providerId: request.providerId,
      agentKey: request.agentKey,
      saveId: request.saveId,
      requestId,
      stream: true,
    });

    const resolved = await this.resolveProviderAndTracker(request, startTime, requestId);
    if ('result' in resolved) {
      const failResult = resolved.result;
      const providerId = request.providerId ?? '';
      this.emitMetricsEvent(providerId, request, failResult, startTime, -1, 0, 0, false);
      return this.singleEventIterable({
        type: 'error',
        error: {
          type: failResult.error!.type,
          message: failResult.error!.message,
          retryable: failResult.error!.retryable,
        },
      });
    }
    const { providerId, tracker, provider } = resolved;
    const maxAttempts = computeMaxAttempts(provider.apiKeys.length);

    const generator = this.streamAttemptGenerator(
      request, providerId, tracker, provider.providerType, provider.apiKeys.map(k => k.key), provider.defaultModel,
      maxAttempts, startTime, requestId,
    );
    return generator;
  }

  /**
   * 流式尝试循环（async generator）
   */
  private async *streamAttemptGenerator(
    request: LLMDispatchRequest,
    providerId: string,
    tracker: KeyHealthTracker,
    providerType: string,
    apiKeys: string[],
    defaultModel: string,
    maxAttempts: number,
    startTime: number,
    requestId: string,
  ): AsyncIterable<LLMDispatchStreamEvent> {
    let llmCallAttempts = 0;
    let lastKeyIndex = -1;
    let cooldownTriggered = false;
    let totalWaitMs = 0;
    const triedKeyIndices = new Set<number>();

    while (llmCallAttempts < maxAttempts) {
      const keyIndex = tracker.selectKey(triedKeyIndices);
      if (keyIndex === null) {
        const result = this.failResult(
          'no_available_key',
          'All keys in cooldown',
          false,
          lastKeyIndex,
          llmCallAttempts,
          startTime,
          requestId,
          { waitMs: totalWaitMs, cooldownTriggered },
        );
        this.emitMetricsEvent(providerId, request, result, startTime, lastKeyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        yield { type: 'error', error: { type: 'no_available_key', message: result.error!.message, retryable: false } };
        return;
      }
      lastKeyIndex = keyIndex;
      triedKeyIndices.add(keyIndex);

      this.emitTrace('dispatcher_key_selected', { providerId, keyIndex, saveId: request.saveId, requestId });

      const bucket = tracker.getBucket(keyIndex)!;
      const acquireTimeoutMs = request.timeoutMs ?? this.acquireTimeoutMs;
      const acquireStart = Date.now();
      const acquired = await bucket.acquire(acquireTimeoutMs);
      totalWaitMs += Date.now() - acquireStart;

      if (!acquired) {
        logger.warn('Token acquire failed (stream), will try next key', { providerId, keyIndex });
        continue;
      }

      this.emitTrace('dispatcher_token_acquired', { providerId, keyIndex, saveId: request.saveId, requestId });

      // 解析运行时 key（M2-B3 D2，与 dispatch 对称）
      let apiKey: string | null;
      try {
        apiKey = await this.resolveRuntimeApiKey(providerType, apiKeys[keyIndex]);
      } catch (err) {
        bucket.release();
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('OAuth resolveApiKey failed (stream)', { providerId, providerType, error: errorMessage });
        const result = this.failResult('provider_error', errorMessage, false, keyIndex, llmCallAttempts, startTime, requestId, { waitMs: totalWaitMs, cooldownTriggered });
        this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        yield { type: 'error', error: { type: 'provider_error', message: errorMessage, retryable: false } };
        return;
      }
      if (apiKey === null) {
        bucket.release();
        const message = `OAuth provider '${providerType}' 未登录，请先在模型配置页完成授权`;
        const result = this.failResult('no_available_key', message, false, keyIndex, llmCallAttempts, startTime, requestId, { waitMs: totalWaitMs, cooldownTriggered });
        this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
        yield { type: 'error', error: { type: 'no_available_key', message, retryable: false } };
        return;
      }

      llmCallAttempts += 1;
      let emittedAny = false;
      let failover = false;

      try {
        const stream = this.llmService.streamWithKey(
          request.messages,
          {
            providerId,
            model: request.model ?? defaultModel,
            apiKey,
            keyIndex,
            options: request.options,
          },
        );

        for await (const event of stream) {
          if (event.type === 'text_delta') {
            emittedAny = true;
            yield { type: 'delta', delta: event.delta };
            continue;
          }

          if (event.type === 'done') {
            bucket.release();
            this.metrics.recordSuccess(providerId, keyIndex, Date.now() - startTime);
            this.metrics.recordAttempt(providerId, totalWaitMs, llmCallAttempts);
            this.emitTrace('dispatcher_request_end', {
              providerId, success: true, attemptCount: llmCallAttempts, totalMs: Date.now() - startTime,
              saveId: request.saveId, requestId, stream: true,
            });
            const response = this.convertStreamFinalMessage(event.message, event.reason);
            const result: LLMDispatchResult = {
              success: true,
              response,
              metrics: { selectedKeyIndex: keyIndex, waitMs: totalWaitMs, attemptCount: llmCallAttempts, cooldownTriggered },
            };
            this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
            yield { type: 'done', response };
            return;
          }

          if (event.type === 'error') {
            const category = this.classifyError({ message: event.error.message, code: event.error.code });
            if ((category === 'rate_limit' || category === 'auth') && !emittedAny) {
              // 未输出任何内容：可无缝失败转移
              if (category === 'rate_limit') {
                bucket.markCooldown(0);
                cooldownTriggered = true;
                this.metrics.record429(providerId, keyIndex);
                this.emitTrace('dispatcher_cooldown_triggered', {
                  providerId, keyIndex, cooldownMs: COOLDOWN_DEFAULT_MS, saveId: request.saveId, requestId, stream: true,
                });
              } else {
                bucket.markFailed(event.error.message);
                this.metrics.recordAuthFailed(providerId, keyIndex);
                // M2-B3 D2：OAuth 托管型 401 后台强制刷新（fire-and-forget）
                this.triggerOAuthForceRefresh(providerType);
                this.emitTrace('dispatcher_key_failed', {
                  providerId, keyIndex, error: event.error.message, saveId: request.saveId, requestId, stream: true,
                });
              }
              bucket.release();
              failover = true;
              break;
            }

            // 不可转移错误：透传
            bucket.release();
            this.metrics.recordError(providerId, keyIndex, category);
            this.metrics.recordAttempt(providerId, totalWaitMs, llmCallAttempts);
            const dispatchErrorType: LLMDispatchErrorType = category === 'timeout' ? 'timeout' : 'provider_error';
            this.emitTrace('dispatcher_request_end', {
              providerId, success: false, attemptCount: llmCallAttempts, totalMs: Date.now() - startTime,
              saveId: request.saveId, requestId, stream: true,
            });
            const result = this.failResult(dispatchErrorType, event.error.message, event.error.retryable ?? false, keyIndex, llmCallAttempts, startTime, requestId, { waitMs: totalWaitMs, cooldownTriggered });
            this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
            yield { type: 'error', error: { type: dispatchErrorType, message: event.error.message, retryable: event.error.retryable ?? false } };
            return;
          }
          // 其余生命周期事件（start/text_start/text_end/thinking_*/toolcall_*）由 done 聚合承载
        }
      } catch (err) {
        // EventStream fail() 经迭代器 throw 传播的错误
        bucket.release();
        const category = this.classifyError(err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        if ((category === 'rate_limit' || category === 'auth') && !emittedAny) {
          if (category === 'rate_limit') {
            bucket.markCooldown(this.parseRetryAfter(err));
            cooldownTriggered = true;
            this.metrics.record429(providerId, keyIndex);
          } else {
            bucket.markFailed(errorMessage);
            this.metrics.recordAuthFailed(providerId, keyIndex);
            // M2-B3 D2：OAuth 托管型 401 后台强制刷新（fire-and-forget）
            this.triggerOAuthForceRefresh(providerType);
          }
          failover = true;
        } else {
          this.metrics.recordError(providerId, keyIndex, category);
          this.metrics.recordAttempt(providerId, totalWaitMs, llmCallAttempts);
          const dispatchErrorType: LLMDispatchErrorType = category === 'timeout' ? 'timeout' : 'provider_error';
          const result = this.failResult(dispatchErrorType, errorMessage, category !== 'other', keyIndex, llmCallAttempts, startTime, requestId, { waitMs: totalWaitMs, cooldownTriggered });
          this.emitMetricsEvent(providerId, request, result, startTime, keyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
          yield { type: 'error', error: { type: dispatchErrorType, message: errorMessage, retryable: category !== 'other' } };
          return;
        }
      }

      if (!failover) {
        // 流正常结束但无 done 事件（异常防御）：视为失败转移
        bucket.release();
      }
      // failover：继续外层循环，切下一个 key
    }

    const result = this.failResult(
      'rate_limited',
      `Max ${maxAttempts} LLM call attempts reached (stream)`,
      true,
      lastKeyIndex,
      llmCallAttempts,
      startTime,
      requestId,
      { waitMs: totalWaitMs, cooldownTriggered },
    );
    this.emitMetricsEvent(providerId, request, result, startTime, lastKeyIndex, totalWaitMs, llmCallAttempts, cooldownTriggered);
    yield { type: 'error', error: { type: 'rate_limited', message: result.error!.message, retryable: true } };
  }

  /**
   * 获取指标快照
   */
  getMetrics(providerId: string): DispatcherMetricsSnapshot {
    const tracker = this.trackers.get(providerId);
    return this.metrics.getSnapshot(providerId, tracker);
  }

  /**
   * 手动重置冷静期（调试用）
   */
  resetCooldown(providerId: string, keyIndex: number): void {
    const tracker = this.trackers.get(providerId);
    const bucket = tracker?.getBucket(keyIndex);
    bucket?.resetCooldown();
  }

  /**
   * m2 修复：销毁所有 tracker，清理定时器 + 取消事件订阅
   *
   * 在 init.ts 的 shutdown hook 中调用，避免 KeyHealthTracker 的
   * restoreTimer 与 debounce 定时器在应用关闭后继续触发。
   */
  destroy(): void {
    for (const timer of this.configChangeDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.configChangeDebounceTimers.clear();
    this.pendingConfigChanges.clear();
    // 必须传同一 handler 引用才能正确取消订阅
    this.eventBus.unsubscribe('provider_config_changed', this.boundOnConfigChanged);

    for (const tracker of this.trackers.values()) {
      tracker.destroy();
    }
    this.trackers.clear();
    this.initialized = false;
    logger.info('LLMRequestDispatcher destroyed', {});
  }

  // ============== 私有方法：Provider 解析 ==============

  /**
   * 解析运行时 apiKey（M2-B3 D2）
   *
   * OAuth 托管型（oauth-registry 命中且已注入 oauthCredentialService）经
   * OAuthCredentialService.resolveApiKey 取真实 token（过期自动刷新落库）；
   * 其余场景原样返回配置 key（行为与 M9 现状完全一致）。
   *
   * @returns key 字符串；OAuth 型无凭证返回 null（调用方走"未登录"failResult no_available_key）
   * @throws 刷新失败原样抛错（调用方 failResult provider_error，retryable=false）
   */
  private async resolveRuntimeApiKey(providerType: string, configuredKey: string): Promise<string | null> {
    if (!this.oauthCredentialService || !getOAuthProvider(providerType)) {
      return configuredKey;
    }
    return this.oauthCredentialService.resolveApiKey(providerType);
  }

  /**
   * 401 后触发 OAuth 强制刷新（M2-B3 D2，fire-and-forget）
   *
   * 刷新结果不阻塞当前失败转移：成功则下次调用拿到新 token；失败则死凭证被删除，
   * 下次 resolveApiKey 返回 null 走"未登录"提示路径。并发 401 由
   * OAuthCredentialService 内部 refreshPromises 去重，不会形成刷新风暴。
   */
  private triggerOAuthForceRefresh(providerType: string): void {
    if (!this.oauthCredentialService || !getOAuthProvider(providerType)) return;
    void this.oauthCredentialService.forceRefresh(providerType).catch((err) => {
      logger.warn('OAuth forceRefresh after auth failure failed', {
        providerType,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * 解析 Provider + Tracker（dispatch / dispatchStream 共用前置步骤）
   *
   * 失败时返回 { result } 兜底结果，成功时返回 { providerId, tracker, provider }。
   */
  private async resolveProviderAndTracker(
    request: LLMDispatchRequest,
    startTime: number,
    requestId: string,
  ): Promise<
    | { result: LLMDispatchResult }
    | { providerId: string; tracker: KeyHealthTracker; provider: { providerType: string; apiKeys: Array<{ key: string; label: string; rateLimit?: TokenBucketConfig }>; defaultModel: string } }
  > {
    const providerId = request.providerId ?? (await this.modelConfigService.getDefaultProviderId());
    if (!providerId) {
      return { result: this.failResult('no_available_key', 'No provider configured', false, -1, 0, startTime, requestId) };
    }

    const tracker = this.trackers.get(providerId);
    if (!tracker) {
      return { result: this.failResult('no_available_key', `Provider ${providerId} not initialized`, false, -1, 0, startTime, requestId) };
    }

    const provider = await this.modelConfigService.getProviderUnmasked(providerId);
    if (!provider || provider.apiKeys.length === 0) {
      return { result: this.failResult('no_available_key', `Provider ${providerId} has no keys`, false, -1, 0, startTime, requestId) };
    }

    return { providerId, tracker, provider };
  }

  // ============== 私有方法：tracker 同步 ==============

  private async initTrackerForProvider(
    providerId: string,
    keys: Array<{ key: string; label: string; rateLimit?: TokenBucketConfig }>,
  ): Promise<void> {
    const tracker = new KeyHealthTracker(COOLDOWN_DEFAULT_MS, FAILED_RESTORE_MS);
    tracker.initializeKeys(keys);
    this.trackers.set(providerId, tracker);
  }

  /**
   * 实际应用配置变更（由 handleConfigChange 串行化调用，§12.2.5）
   *
   * 注意：此方法假设幂等/乱序/字段过滤已由 handleConfigChange 完成。
   */
  private async applyConfigChange(payload: ProviderConfigChangedPayload): Promise<void> {
    const providerId = payload.providerId;

    if (payload.changeType === 'deleted') {
      const tracker = this.trackers.get(providerId);
      if (tracker) {
        tracker.destroy();
        this.trackers.delete(providerId);
      }
      logger.info('Tracker removed after provider deleted', { providerId, version: payload.version });
      return;
    }

    const provider = await this.modelConfigService.getProviderUnmasked(providerId);
    if (!provider) {
      // DB 中已不存在（兜底，与 deleted 等价）
      const tracker = this.trackers.get(providerId);
      if (tracker) {
        tracker.destroy();
        this.trackers.delete(providerId);
      }
      logger.warn('Provider disappeared in DB, tracker removed', { providerId });
      return;
    }

    let tracker = this.trackers.get(providerId);
    if (!tracker) {
      tracker = new KeyHealthTracker(COOLDOWN_DEFAULT_MS, FAILED_RESTORE_MS);
      this.trackers.set(providerId, tracker);
    }
    tracker.initializeKeys(provider.apiKeys);
    logger.info('Tracker synced after config change', {
      providerId,
      keyCount: provider.apiKeys.length,
      version: payload.version,
    });
  }

  /**
   * 启动时全量同步兜底（§12.2.4 幂等性表）
   *
   * 场景：配置变更未触发事件（如手动改 DB）时，启动阶段全量同步保证 tracker 与 DB 一致。
   * 在 initialize() 中调用。
   */
  private async syncAllTrackers(): Promise<void> {
    const providers = await this.modelConfigService.getAllEnabledProviders();
    const activeProviderIds = new Set(providers.map((p) => p.id));

    // 删除 DB 中已不存在的 tracker
    for (const providerId of this.trackers.keys()) {
      if (!activeProviderIds.has(providerId)) {
        const tracker = this.trackers.get(providerId);
        tracker?.destroy();
        this.trackers.delete(providerId);
      }
    }

    // 同步或新建 tracker，并记录 version 基线
    for (const provider of providers) {
      await this.initTrackerForProvider(provider.id, provider.apiKeys);
      this.lastProcessedVersion.set(provider.id, provider.version ?? 0);
    }
    logger.info('syncAllTrackers completed', { providerCount: providers.length });
  }

  // ============== 私有方法：provider_config_changed 事件契约（§12） ==============

  /**
   * 入口：接收事件 → debounce → 实际处理（§12.3）
   *
   * 同一 providerId 的多次事件在 300ms 窗口内合并为一次处理，
   * 取窗口内 version 最大的 payload 作为处理依据。
   *
   * 注意：此方法不记录 eventId，由 handleConfigChange 统一记录。
   * 原因：debounce 窗口内被覆盖的旧事件 A 不会被处理，A.eventId 不应被记录；
   * 只有最终被 handleConfigChange 处理的事件才记录 eventId 用于幂等去重。
   */
  private onProviderConfigChanged(payload: ProviderConfigChangedPayload): void {
    const pending = this.pendingConfigChanges.get(payload.providerId);
    if (!pending || payload.version > pending.version) {
      this.pendingConfigChanges.set(payload.providerId, payload);
    }

    const existing = this.configChangeDebounceTimers.get(payload.providerId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const latest = this.pendingConfigChanges.get(payload.providerId);
      this.pendingConfigChanges.delete(payload.providerId);
      this.configChangeDebounceTimers.delete(payload.providerId);
      if (latest) {
        this.handleConfigChange(latest).catch((err) => {
          logger.error('Debounced handleConfigChange failed', {
            providerId: payload.providerId,
            err,
          });
        });
      }
    }, this.CONFIG_CHANGE_DEBOUNCE_MS);
    this.configChangeDebounceTimers.set(payload.providerId, timer);
  }

  /**
   * 事件处理：幂等去重 + 乱序丢弃 + 字段过滤 + 同 providerId 串行化（§12.2.5）
   */
  private async handleConfigChange(payload: ProviderConfigChangedPayload): Promise<void> {
    // 1. 幂等检查（eventId 唯一记录点）
    if (this.processedEventIds.has(payload.eventId)) {
      logger.debug('Duplicate provider_config_changed event ignored', { eventId: payload.eventId });
      return;
    }

    // 2. 乱序检查
    const lastVersion = this.lastProcessedVersion.get(payload.providerId) ?? 0;
    if (payload.version <= lastVersion) {
      logger.warn('Stale provider_config_changed event ignored', {
        providerId: payload.providerId,
        eventVersion: payload.version,
        lastProcessedVersion: lastVersion,
      });
      return;
    }

    // 3. 字段过滤（仅关注影响令牌桶的变更）
    const affectsTracker =
      payload.changeType === 'deleted' ||
      payload.changedFields.includes('api_keys') ||
      payload.changedFields.includes('rateLimit') ||
      payload.changedFields.includes('enabled');
    if (!affectsTracker) {
      logger.debug('provider_config_changed skipped (no tracker-affecting fields)', {
        providerId: payload.providerId,
        changedFields: payload.changedFields,
      });
      // 仍记录 version，避免旧事件被误判为乱序
      this.lastProcessedVersion.set(payload.providerId, payload.version);
      return;
    }

    // 4. 串行化同步（同 providerId）
    const lock = this.syncLock.get(payload.providerId) ?? Promise.resolve();
    this.syncLock.set(
      payload.providerId,
      lock.then(() => this.applyConfigChange(payload)).catch((err) => {
        logger.error('Failed to apply config change', {
          providerId: payload.providerId,
          eventId: payload.eventId,
          err,
        });
      }),
    );

    // 5. 记录已处理（FIFO 上限 1000）
    this.processedEventIds.add(payload.eventId);
    if (this.processedEventIds.size > 1000) {
      const first = this.processedEventIds.values().next().value;
      if (first) this.processedEventIds.delete(first);
    }
    this.lastProcessedVersion.set(payload.providerId, payload.version);
  }

  // ============== 私有方法：错误分类与解析 ==============

  /**
   * 错误分类（B5 修复）
   *
   * 优先级：
   * 1. HTTP 状态码（err.status / err.response.status / err.response.statusCode）
   * 2. Provider SDK 错误码字段（err.code，如 'ENOTFOUND'/'ETIMEDOUT'）
   * 3. 严格正则匹配 message（避免子串误匹配，如 '14012' 不会命中 401）
   */
  private classifyError(err: unknown): ClassifiedErrorCategory {
    const status = this.extractHttpStatus(err);
    if (status === 429) return 'rate_limit';
    if (status === 401 || status === 403) return 'auth';
    if (status && status >= 500) return 'server_error';

    const code = (err as { code?: string }).code;
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
    if (code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return 'network';

    const msg = (err as Error).message?.toLowerCase() ?? '';
    // 严格正则：用 \b 词边界避免 '14012' 误匹配 401
    if (/\b429\b/.test(msg) || /\brate[-_ ]?limit\b/.test(msg)) return 'rate_limit';
    if (/\b401\b|\b403\b/.test(msg) || /\bunauthorized\b|\bforbidden\b/.test(msg)) return 'auth';
    if (/\btimeout\b|\btimed[-_ ]?out\b/.test(msg)) return 'timeout';
    if (/\bnetwork\b|\beconnreset\b|\benotfound\b|\beconnrefused\b/.test(msg)) return 'network';
    if (/\b5\d\d\b/.test(msg)) return 'server_error';

    return 'other';
  }

  /**
   * 从错误对象中提取 HTTP 状态码
   * 兼容 fetch/axios/node-fetch/Provider SDK 的不同错误结构
   */
  private extractHttpStatus(err: unknown): number | undefined {
    const e = err as {
      status?: number;
      statusCode?: number;
      response?: { status?: number; statusCode?: number };
      res?: { status?: number; statusCode?: number };
    };
    return e.status ?? e.statusCode ?? e.response?.status ?? e.response?.statusCode ?? e.res?.status ?? e.res?.statusCode;
  }

  private parseRetryAfter(err: unknown): number {
    const headers = (err as { headers?: Record<string, string> }).headers;
    const retryAfter = headers?.['retry-after'];
    if (!retryAfter) return 0;

    // delay-seconds 格式优先（纯数字）：Date.parse('120') 在 V8 中被解释为公元 120 年
    // （返回负数时间戳而非 NaN），会误入 HTTP date 分支得到 0，丢失真实冷静期
    if (/^\d+$/.test(retryAfter.trim())) {
      return parseInt(retryAfter.trim(), 10) * 1000;
    }

    // HTTP date 格式
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, asDate - Date.now());
    }

    return 0;
  }

  // ============== 私有方法：响应转换 ==============

  /**
   * LLMService.chatWithKey 返回的 LLMResponse → LLMDispatchResult['response']
   *
   * 差异点：LLMService 层 toolCalls 为 { id, type, function: { name, arguments: string } }，
   * dispatcher 契约为 { id, name, arguments: Record }，arguments 需 JSON.parse。
   */
  private convertChatResponse(response: {
    content: string;
    reasoningContent?: string;
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      promptCacheHitTokens?: number;
      promptCacheMissTokens?: number;
    };
    finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }): NonNullable<LLMDispatchResult['response']> {
    return {
      content: response.content,
      reasoningContent: response.reasoningContent,
      toolCalls: response.toolCalls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.safeParseArguments(tc.function.arguments),
      })),
      usage: response.usage,
      finishReason: response.finishReason,
    };
  }

  /**
   * 流式 done 事件的最终消息 → LLMDispatchResult['response']
   *
   * LLMStreamFinalMessage.content 为 string 或内容块数组（text/thinking/tool_use），
   * 聚合为 dispatcher 契约的扁平响应结构。
   */
  private convertStreamFinalMessage(
    message: LLMStreamFinalMessage,
    finishReason: 'stop' | 'length' | 'tool_calls',
  ): NonNullable<LLMDispatchResult['response']> {
    const usage = message.usage ? { ...message.usage } : undefined;

    if (typeof message.content === 'string') {
      return { content: message.content, usage, finishReason };
    }

    let text = '';
    let thinking = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        text += block.text ?? '';
      } else if (block.type === 'thinking') {
        thinking += block.thinking ?? '';
      } else if (block.type === 'tool_use' && block.toolCall) {
        toolCalls.push({
          id: block.toolCall.id,
          name: block.toolCall.function.name,
          arguments: this.safeParseArguments(block.toolCall.function.arguments),
        });
      }
    }

    return {
      content: text,
      reasoningContent: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
    };
  }

  private safeParseArguments(args: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(args);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { raw: args };
    }
  }

  // ============== 私有方法：trace 与指标事件 ==============

  /**
   * M4 修复：emitTrace 允许无 saveId 的事件通过。
   *
   * - 有 saveId：通过 devTraceHook 发送，供前端 dev trace 面板展示
   * - 无 saveId：降级为 logger.debug，避免事件被静默丢弃（如 batch_spawn_agents 内部分发）
   */
  private emitTrace(type: DispatcherTraceType, data: Record<string, unknown>): void {
    if (data.saveId) {
      this.devTraceHook.emit({
        type,
        saveId: data.saveId as ID,
        data,
        timestamp: Date.now(),
        requestId: data.requestId as string | undefined,
      });
    } else {
      logger.debug('dispatcher trace (no saveId)', { type, ...data });
    }
  }

  /**
   * 发布 LLM 指标事件（C5 修复，§6.3）
   *
   * 与 emitTrace 的区别：
   * - emitTrace：发送到 devTraceHook（前端 dev trace 面板），实时展示
   * - emitMetricsEvent：发布到 EventBus，由 LLMMetricsSink（E 层）异步批量持久化到 llm_dispatch_metrics 表（v2.4 分表）
   *
   * StagingPool 豁免说明：
   * - 本方法仅发布事件到 EventBus，不直接写 DB
   * - 订阅方 LLMMetricsSink 显式豁免 StagingPool（详见 §6.2 类注释）
   * - 写入目标 llm_dispatch_metrics 非 save-scoped 表，无需 ShadowState 缓存
   *
   * 适配说明：现有 EventBus.emit 签名为 emit(type, BusEvent)，payload 经 BusEvent.data 传递；
   * emit 为异步 fire-and-forget，失败仅记录日志不阻塞主流程（§12.2.1）。
   */
  private emitMetricsEvent(
    resolvedProviderId: string,
    request: LLMDispatchRequest,
    result: LLMDispatchResult,
    startTime: number,
    keyIndex: number,
    totalWaitMs: number,
    llmCallAttempts: number,
    cooldownTriggered: boolean,
  ): void {
    const payload: LLMMetricsEventPayload = {
      eventId: randomUUID(),
      timestamp: new Date(startTime).toISOString(),
      providerId: resolvedProviderId,
      agentKey: request.agentKey ?? 'unknown',
      saveId: request.saveId,
      keyIndex,
      success: result.success,
      errorType: result.success ? undefined : (result.error?.type as LLMMetricsEventPayload['errorType']),
      durationMs: Date.now() - startTime,
      attemptCount: llmCallAttempts,
      waitMs: totalWaitMs,
      cooldownTriggered,
    };

    this.eventBus.emit('llm_metrics_event', {
      type: 'llm_metrics_event',
      saveId: request.saveId ?? '',
      data: payload as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    }).catch((err) => {
      logger.warn('Failed to emit llm_metrics_event', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  /**
   * M1 修复：errorType 参数直接声明为 LLMDispatchErrorType，
   * 移除 `as LLMDispatchResult['error']['type']` cast。
   */
  private failResult(
    errorType: LLMDispatchErrorType,
    message: string,
    retryable: boolean,
    lastUsedKeyIndex: number,
    attemptCount: number,
    startTime: number,
    requestId: string,
    extra?: { waitMs: number; cooldownTriggered: boolean },
  ): LLMDispatchResult {
    this.emitTrace('dispatcher_request_end', {
      success: false, attemptCount, totalMs: Date.now() - startTime, requestId,
    });
    return {
      success: false,
      error: {
        type: errorType,
        message,
        retryable,
        lastUsedKeyIndex: lastUsedKeyIndex >= 0 ? lastUsedKeyIndex : undefined,
      },
      metrics: {
        selectedKeyIndex: lastUsedKeyIndex >= 0 ? lastUsedKeyIndex : -1,
        waitMs: extra?.waitMs ?? 0,
        attemptCount,
        cooldownTriggered: extra?.cooldownTriggered ?? false,
      },
    };
  }

  private async *singleEventIterable(event: LLMDispatchStreamEvent): AsyncIterable<LLMDispatchStreamEvent> {
    yield event;
  }
}
