import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMRequestDispatcher } from '../LLMRequestDispatcher.js';
import type { LLMDispatchRequest, LLMDispatchStreamEvent } from '../types.js';
import type { TokenBucketConfig } from '../TokenBucket.js';
import type { ModelProvider, ApiKeyEntry } from '@ai-rpg/shared';
import type { LLMService, ModelConfigService, OAuthCredentialService } from '@ai-rpg/ai';
import type { EventBus, BusEvent, ProviderConfigChangedPayload } from '@ai-rpg/shared/messaging';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';

/**
 * LLMRequestDispatcher 集成测试
 *
 * 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §13 + §12.4
 *
 * Mock 策略：LLMService / ModelConfigService / EventBus / IDevTraceHook 全部
 * 以 plain object mock，provider_config_changed handler 通过 subscribe 捕获后手动派发。
 * debounce（300ms）与并发等待使用真实定时器短延迟（< 1s）。
 */

// ============== Mock 依赖 ==============

const chatWithKey = vi.fn();
const streamWithKey = vi.fn();
const llmService = { chatWithKey, streamWithKey } as unknown as LLMService;

const getDefaultProviderId = vi.fn();
const getProviderUnmasked = vi.fn();
const getAllEnabledProviders = vi.fn();
const modelConfigService = {
  getDefaultProviderId,
  getProviderUnmasked,
  getAllEnabledProviders,
} as unknown as ModelConfigService;

type ConfigChangeHandler = (event: BusEvent) => void;
let configChangeHandler: ConfigChangeHandler | null = null;
const eventBusSubscribe = vi.fn((type: string, handler: ConfigChangeHandler) => {
  if (type === 'provider_config_changed') configChangeHandler = handler;
});
const eventBusUnsubscribe = vi.fn();
const eventBusEmit = vi.fn().mockResolvedValue(undefined);
const eventBus = {
  subscribe: eventBusSubscribe,
  unsubscribe: eventBusUnsubscribe,
  emit: eventBusEmit,
} as unknown as EventBus;

const devTraceEmit = vi.fn();
const devTraceHook = { emit: devTraceEmit } as unknown as IDevTraceHook;

// ============== 测试辅助 ==============

let eventSeq = 0;

function makeKey(index: number, rateLimit?: TokenBucketConfig): ApiKeyEntry {
  return { key: `sk-key${index}`, label: `Key${index}`, priority: index, rateLimit };
}

function makeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'p1',
    providerType: 'custom',
    name: 'Test Provider',
    baseUrl: 'https://api.test.com',
    apiFormat: 'openai',
    apiKeys: [makeKey(0), makeKey(1)],
    defaultModel: 'test-model',
    maxTokens: 4096,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<LLMDispatchRequest> = {}): LLMDispatchRequest {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    saveId: 'save-1',
    agentKey: 'test-agent',
    ...overrides,
  };
}

function makeLLMResponse(content = 'Hello!') {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: 'stop' as const,
  };
}

function rateLimitError(headers?: Record<string, string>): Error {
  const err = new Error('429 Too Many Requests') as Error & {
    status?: number;
    headers?: Record<string, string>;
  };
  err.status = 429;
  if (headers) err.headers = headers;
  return err;
}

function authError(): Error {
  const err = new Error('401 Unauthorized') as Error & { status?: number };
  err.status = 401;
  return err;
}

function serverError(): Error {
  const err = new Error('500 Internal Server Error') as Error & { status?: number };
  err.status = 500;
  return err;
}

function timeoutError(): Error {
  const err = new Error('socket timeout') as Error & { code?: string };
  err.code = 'ETIMEDOUT';
  return err;
}

/** 构造流式事件 AsyncIterable（dispatcher 仅消费 type/delta/message/reason/error 字段） */
function makeStream(events: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

function makeDoneMessage(content: string) {
  return {
    role: 'assistant' as const,
    content,
    usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
  };
}

/** 等待微任务与短延迟（确保 dispatch 推进到 LLM 调用点） */
async function flush(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** 等待 debounce（300ms）+ 异步处理完成 */
async function waitForDebounce(): Promise<void> {
  await new Promise((r) => setTimeout(r, 450));
}

/** 手动派发 provider_config_changed 事件（payload 经 BusEvent.data 传递） */
function emitConfigChange(payload: Partial<ProviderConfigChangedPayload> = {}): ProviderConfigChangedPayload {
  const full: ProviderConfigChangedPayload = {
    eventId: `evt-${++eventSeq}`,
    version: 2,
    timestamp: new Date().toISOString(),
    providerId: 'p1',
    changeType: 'updated',
    changedFields: ['api_keys'],
    ...payload,
  };
  configChangeHandler!({ data: full } as BusEvent);
  return full;
}

async function collectStream(
  iterable: AsyncIterable<LLMDispatchStreamEvent>,
): Promise<LLMDispatchStreamEvent[]> {
  const events: LLMDispatchStreamEvent[] = [];
  for await (const e of iterable) events.push(e);
  return events;
}

// ============== 测试 ==============

describe('LLMRequestDispatcher', () => {
  let dispatcher: LLMRequestDispatcher | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    configChangeHandler = null;
    eventBusEmit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    dispatcher?.destroy();
    dispatcher = null;
  });

  /** 创建并初始化 dispatcher（providers 为 DB 全量 enabled 列表） */
  async function makeDispatcher(
    providers: ModelProvider[],
    opts: { acquireTimeoutMs?: number } = {},
  ): Promise<LLMRequestDispatcher> {
    getAllEnabledProviders.mockResolvedValue(providers);
    getProviderUnmasked.mockImplementation(
      async (id: string) => providers.find((p) => p.id === id) ?? null,
    );
    getDefaultProviderId.mockResolvedValue(providers[0]?.id ?? null);
    dispatcher = new LLMRequestDispatcher(
      llmService,
      modelConfigService,
      eventBus,
      devTraceHook,
      opts.acquireTimeoutMs,
    );
    await dispatcher.initialize();
    return dispatcher;
  }

  describe('dispatch - 正常路径', () => {
    it('单 key 成功调用', async () => {
      const d = await makeDispatcher([makeProvider({ apiKeys: [makeKey(0)] })]);
      chatWithKey.mockResolvedValue(makeLLMResponse('hi'));

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(true);
      expect(result.response?.content).toBe('hi');
      expect(result.response?.usage?.totalTokens).toBe(15);
      expect(result.metrics.selectedKeyIndex).toBe(0);
      expect(result.metrics.attemptCount).toBe(1);
      expect(result.metrics.cooldownTriggered).toBe(false);
      expect(chatWithKey).toHaveBeenCalledTimes(1);
      expect(chatWithKey.mock.calls[0][1]).toMatchObject({
        providerId: 'p1',
        model: 'test-model',
        apiKey: 'sk-key0',
        keyIndex: 0,
      });
    });

    it('多 key 选择令牌最多的', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockResolvedValue(makeLLMResponse());

      // 第一次：两 key 令牌并列，取 idx 最小（key0）
      const r1 = await d.dispatch(makeRequest());
      expect(r1.metrics.selectedKeyIndex).toBe(0);

      // 第二次：key0 令牌少 1 个，应选 key1
      const r2 = await d.dispatch(makeRequest());
      expect(r2.metrics.selectedKeyIndex).toBe(1);
      expect(chatWithKey.mock.calls[1][1]).toMatchObject({ apiKey: 'sk-key1', keyIndex: 1 });
    });

    it('Provider 未指定时使用默认', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockResolvedValue(makeLLMResponse());

      const result = await d.dispatch(makeRequest({ providerId: undefined }));

      expect(result.success).toBe(true);
      expect(getDefaultProviderId).toHaveBeenCalled();
      expect(chatWithKey.mock.calls[0][1]).toMatchObject({ providerId: 'p1' });
    });

    it('无 Provider 配置返回 no_available_key', async () => {
      const d = await makeDispatcher([]);

      const result = await d.dispatch(makeRequest({ providerId: undefined }));

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('no_available_key');
      expect(result.error?.message).toContain('No provider configured');
      expect(chatWithKey).not.toHaveBeenCalled();
    });

    it('Provider 未初始化返回 no_available_key', async () => {
      const d = await makeDispatcher([makeProvider()]);

      const result = await d.dispatch(makeRequest({ providerId: 'unknown' }));

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('no_available_key');
      expect(result.error?.message).toContain('not initialized');
    });

    it('Provider 无 keys 返回 no_available_key', async () => {
      const d = await makeDispatcher([makeProvider({ apiKeys: [] })]);

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('no_available_key');
      expect(result.error?.message).toContain('has no keys');
    });

    it('toolCalls 参数 JSON.parse 转换为 Record', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockResolvedValue({
        ...makeLLMResponse(),
        toolCalls: [
          { id: 'tc-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"BJ"}' } },
        ],
      });

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(true);
      expect(result.response?.toolCalls).toEqual([
        { id: 'tc-1', name: 'get_weather', arguments: { city: 'BJ' } },
      ]);
    });
  });

  describe('dispatch - 429 失败转移', () => {
    it('429 后切下一个 key', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(makeLLMResponse());

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(true);
      expect(result.metrics.attemptCount).toBe(2);
      expect(result.metrics.selectedKeyIndex).toBe(1);
      expect(result.metrics.cooldownTriggered).toBe(true);
      const metrics = d.getMetrics('p1');
      expect(metrics.rateLimitedCount).toBe(1);
      expect(metrics.perKeyMetrics[0].isInCooldown).toBe(true);
      expect(metrics.perKeyMetrics[0].consecutive429).toBe(1);
    });

    it('Retry-After 头解析冷静期', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey
        .mockRejectedValueOnce(rateLimitError({ 'retry-after': '120' }))
        .mockResolvedValueOnce(makeLLMResponse());
      const before = Date.now();

      await d.dispatch(makeRequest());

      const metrics = d.getMetrics('p1');
      const cooldownEndsAt = metrics.perKeyMetrics[0].cooldownEndsAt!;
      expect(cooldownEndsAt).toBeGreaterThanOrEqual(before + 120 * 1000 - 2000);
      expect(cooldownEndsAt).toBeLessThanOrEqual(Date.now() + 120 * 1000 + 2000);
    });

    it('无 Retry-After 使用默认 5 分钟', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(makeLLMResponse());
      const before = Date.now();

      await d.dispatch(makeRequest());

      const metrics = d.getMetrics('p1');
      const cooldownEndsAt = metrics.perKeyMetrics[0].cooldownEndsAt!;
      expect(cooldownEndsAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 2000);
      expect(cooldownEndsAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 2000);
    });

    it('达到最大重试次数返回 rate_limited', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValue(rateLimitError());

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('rate_limited');
      expect(result.error?.retryable).toBe(true);
      // maxAttempts = min(2 keys, 3) = 2
      expect(result.metrics.attemptCount).toBe(2);
      expect(result.error?.lastUsedKeyIndex).toBe(1);
      expect(chatWithKey).toHaveBeenCalledTimes(2);
    });

    it('全部 key 冷静期返回 no_available_key', async () => {
      const d = await makeDispatcher([makeProvider({ apiKeys: [makeKey(0)] })]);
      chatWithKey.mockRejectedValue(rateLimitError());

      // 第一次：唯一 key 429 进入冷静期，达到 maxAttempts=1 → rate_limited
      const r1 = await d.dispatch(makeRequest());
      expect(r1.error?.type).toBe('rate_limited');

      // 第二次：selectKey 无可用 key → no_available_key（不再调用 LLM）
      const r2 = await d.dispatch(makeRequest());
      expect(r2.success).toBe(false);
      expect(r2.error?.type).toBe('no_available_key');
      expect(r2.error?.retryable).toBe(false);
      expect(chatWithKey).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispatch - 401/403 失败转移', () => {
    it('401 后标记 failed + 切下一个 key', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValueOnce(authError()).mockResolvedValueOnce(makeLLMResponse());

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(true);
      expect(result.metrics.selectedKeyIndex).toBe(1);
      const metrics = d.getMetrics('p1');
      expect(metrics.authFailedCount).toBe(1);
      expect(metrics.perKeyMetrics[0].isFailed).toBe(true);
      expect(metrics.perKeyMetrics[1].isFailed).toBe(false);
    });

    it('全部 key failed 返回 no_available_key', async () => {
      const d = await makeDispatcher([makeProvider({ apiKeys: [makeKey(0)] })]);
      chatWithKey.mockRejectedValue(authError());

      // 第一次：401 → failed，达到 maxAttempts=1 → rate_limited
      const r1 = await d.dispatch(makeRequest());
      expect(r1.error?.type).toBe('rate_limited');

      // 第二次：唯一 key failed → no_available_key
      const r2 = await d.dispatch(makeRequest());
      expect(r2.success).toBe(false);
      expect(r2.error?.type).toBe('no_available_key');
      expect(chatWithKey).toHaveBeenCalledTimes(1);
    });

    it('403 同样按 auth 处理', async () => {
      const d = await makeDispatcher([makeProvider()]);
      const err = new Error('403 Forbidden') as Error & { status?: number };
      err.status = 403;
      chatWithKey.mockRejectedValueOnce(err).mockResolvedValueOnce(makeLLMResponse());

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(true);
      expect(d.getMetrics('p1').authFailedCount).toBe(1);
    });
  });

  describe('dispatch - 5xx/timeout/其他错误', () => {
    it('5xx 释放并发槽 + 返回 provider_error（不转移）', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValue(serverError());

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('provider_error');
      expect(result.error?.retryable).toBe(true);
      expect(result.metrics.attemptCount).toBe(1);
      expect(result.error?.lastUsedKeyIndex).toBe(0);
      // 并发槽已释放
      expect(d.getMetrics('p1').perKeyMetrics[0].activeRequests).toBe(0);
      expect(chatWithKey).toHaveBeenCalledTimes(1);
    });

    it('timeout 释放并发槽 + 返回 timeout', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValue(timeoutError());

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('timeout');
      expect(result.error?.retryable).toBe(true);
      expect(d.getMetrics('p1').perKeyMetrics[0].activeRequests).toBe(0);
    });

    it('context_overflow 直接返回错误（不转移不重试）', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValue(new Error('context_length_exceeded: maximum context length'));

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('provider_error');
      expect(result.error?.retryable).toBe(false);
      expect(result.metrics.attemptCount).toBe(1);
      expect(chatWithKey).toHaveBeenCalledTimes(1);
    });

    it('网络错误返回 provider_error 且 retryable', async () => {
      const d = await makeDispatcher([makeProvider()]);
      const err = new Error('getaddrinfo ENOTFOUND api.test.com') as Error & { code?: string };
      err.code = 'ENOTFOUND';
      chatWithKey.mockRejectedValue(err);

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('provider_error');
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('令牌桶限流', () => {
    it('并发超限时进入等待队列', async () => {
      const d = await makeDispatcher([
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 1 })],
        }),
      ]);
      let resolveFirst!: (v: ReturnType<typeof makeLLMResponse>) => void;
      chatWithKey
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
        .mockResolvedValueOnce(makeLLMResponse('second'));

      const p1 = d.dispatch(makeRequest());
      await flush(); // 等第一个请求完成 acquire 并进入 LLM 调用
      expect(chatWithKey).toHaveBeenCalledTimes(1);

      // 第二个请求并发槽满 → 进入等待队列
      const p2 = d.dispatch(makeRequest());
      await flush(50);
      expect(chatWithKey).toHaveBeenCalledTimes(1); // 仍在等待

      resolveFirst(makeLLMResponse('first'));
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r2.metrics.waitMs).toBeGreaterThan(0);
    });

    it('令牌不足时等待补充（release 唤醒后获得补充令牌）', async () => {
      // capacity=1 + refillRate=5/s：第一个请求耗尽令牌，
      // 第二个请求进入队列；第一个完成后 release 唤醒 + refill 补充 1 个令牌
      const d = await makeDispatcher([
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 1, refillRatePerSec: 5, maxConcurrent: 3 })],
        }),
      ]);
      let resolveFirst!: (v: ReturnType<typeof makeLLMResponse>) => void;
      chatWithKey
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
        .mockResolvedValueOnce(makeLLMResponse('second'));

      const p1 = d.dispatch(makeRequest());
      await flush();
      expect(chatWithKey).toHaveBeenCalledTimes(1);

      const p2 = d.dispatch(makeRequest());
      await flush(250); // 第二个请求等待期间令牌缓慢补充（不足 1 个时仍在队列）

      resolveFirst(makeLLMResponse('first'));
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(chatWithKey).toHaveBeenCalledTimes(2);
    });

    it('令牌等待超时后无可用 key 返回 no_available_key', async () => {
      const d = await makeDispatcher([
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 1, refillRatePerSec: 0, maxConcurrent: 1 })],
        }),
      ]);
      let resolveFirst!: (v: ReturnType<typeof makeLLMResponse>) => void;
      chatWithKey
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
        .mockResolvedValue(makeLLMResponse());

      const p1 = d.dispatch(makeRequest());
      await flush();
      expect(chatWithKey).toHaveBeenCalledTimes(1);

      // 第二个请求 acquire 100ms 超时 → 排除该 key 后无可用 key
      const r2 = await d.dispatch(makeRequest({ timeoutMs: 100 }));
      expect(r2.success).toBe(false);
      expect(r2.error?.type).toBe('no_available_key');
      expect(r2.metrics.attemptCount).toBe(0); // 未发起 LLM 调用
      expect(chatWithKey).toHaveBeenCalledTimes(1);

      resolveFirst(makeLLMResponse('first'));
      const r1 = await p1;
      expect(r1.success).toBe(true);
    });
  });

  describe('dispatchStream - 流式路径', () => {
    it('流式正常路径：delta 透传 + done 聚合响应', async () => {
      const d = await makeDispatcher([makeProvider()]);
      streamWithKey.mockReturnValue(
        makeStream([
          { type: 'text_delta', delta: 'Hello' },
          { type: 'text_delta', delta: ' world' },
          { type: 'done', reason: 'stop', message: makeDoneMessage('Hello world') },
        ]),
      );

      const events = await collectStream(await d.dispatchStream(makeRequest()));

      expect(events.map((e) => e.type)).toEqual(['delta', 'delta', 'done']);
      expect(events[0]).toMatchObject({ type: 'delta', delta: 'Hello' });
      const done = events[2] as Extract<LLMDispatchStreamEvent, { type: 'done' }>;
      expect(done.response.content).toBe('Hello world');
      expect(done.response.usage?.totalTokens).toBe(7);
      expect(d.getMetrics('p1').successCount).toBe(1);
    });

    it('流式 429 未输出任何内容前可无缝失败转移', async () => {
      const d = await makeDispatcher([makeProvider()]);
      streamWithKey
        .mockReturnValueOnce(
          makeStream([{ type: 'error', error: { message: '429 Too Many Requests', retryable: true } }]),
        )
        .mockReturnValueOnce(
          makeStream([
            { type: 'text_delta', delta: 'ok' },
            { type: 'done', reason: 'stop', message: makeDoneMessage('ok') },
          ]),
        );

      const events = await collectStream(await d.dispatchStream(makeRequest()));

      // 消费方无感知切换：只看到第二个 key 的内容
      expect(events.map((e) => e.type)).toEqual(['delta', 'done']);
      expect(d.getMetrics('p1').rateLimitedCount).toBe(1);
      expect(d.getMetrics('p1').perKeyMetrics[0].isInCooldown).toBe(true);
    });

    it('流式已输出部分内容后 5xx 错误直接透传（不转移）', async () => {
      const d = await makeDispatcher([makeProvider()]);
      streamWithKey.mockReturnValue(
        makeStream([
          { type: 'text_delta', delta: 'partial' },
          { type: 'error', error: { message: '500 Internal Server Error', retryable: true } },
        ]),
      );

      const events = await collectStream(await d.dispatchStream(makeRequest()));

      expect(events.map((e) => e.type)).toEqual(['delta', 'error']);
      const errEvent = events[1] as Extract<LLMDispatchStreamEvent, { type: 'error' }>;
      expect(errEvent.error.type).toBe('provider_error');
      expect(errEvent.error.retryable).toBe(true);
      expect(streamWithKey).toHaveBeenCalledTimes(1);
    });

    it('流式全部 key 429 后返回 rate_limited 错误事件', async () => {
      const d = await makeDispatcher([makeProvider({ apiKeys: [makeKey(0)] })]);
      streamWithKey.mockReturnValue(
        makeStream([{ type: 'error', error: { message: '429 Too Many Requests', retryable: true } }]),
      );

      const events = await collectStream(await d.dispatchStream(makeRequest()));

      expect(events).toHaveLength(1);
      const errEvent = events[0] as Extract<LLMDispatchStreamEvent, { type: 'error' }>;
      expect(errEvent.error.type).toBe('rate_limited');
      expect(errEvent.error.retryable).toBe(true);
    });
  });

  describe('配置变更同步', () => {
    it('provider_config_changed 事件触发同步（新增 key 创建 TokenBucket）', async () => {
      const d = await makeDispatcher([makeProvider()]);
      expect(d.getMetrics('p1').perKeyMetrics).toHaveLength(2);

      const newProvider = makeProvider({ apiKeys: [makeKey(0), makeKey(1), makeKey(2)], version: 2 });
      getProviderUnmasked.mockResolvedValue(newProvider);
      emitConfigChange({ version: 2, changedFields: ['api_keys'] });
      await waitForDebounce();

      const metrics = d.getMetrics('p1');
      expect(metrics.perKeyMetrics).toHaveLength(3);
      expect(metrics.perKeyMetrics[2].label).toBe('Key2');
      expect(metrics.perKeyMetrics[2].availableTokens).toBe(5); // 新 bucket 满令牌
    });

    it('删除 key 时销毁对应 TokenBucket', async () => {
      const d = await makeDispatcher([makeProvider()]);

      getProviderUnmasked.mockResolvedValue(makeProvider({ apiKeys: [makeKey(0)], version: 2 }));
      emitConfigChange({ version: 2, changedFields: ['api_keys'] });
      await waitForDebounce();

      expect(d.getMetrics('p1').perKeyMetrics).toHaveLength(1);
    });

    it('修改 rateLimit 时更新 config 保留 bucket 状态', async () => {
      const d = await makeDispatcher([
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 })],
        }),
      ]);
      chatWithKey.mockResolvedValue(makeLLMResponse());
      await d.dispatch(makeRequest()); // key0 消耗 1 个令牌
      expect(d.getMetrics('p1').perKeyMetrics[0].totalUsed).toBe(1);

      getProviderUnmasked.mockResolvedValue(
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 10, refillRatePerSec: 5, maxConcurrent: 5 })],
          version: 2,
        }),
      );
      emitConfigChange({ version: 2, changedFields: ['rateLimit'] });
      await waitForDebounce();

      const metrics = d.getMetrics('p1');
      expect(metrics.perKeyMetrics[0].totalUsed).toBe(1); // 计数保留
      expect(metrics.perKeyMetrics[0].availableTokens).toBeLessThan(10); // 未重置为新 capacity 满令牌
    });

    it('changeType=deleted 清理 tracker，后续 dispatch 返回 no_available_key', async () => {
      const d = await makeDispatcher([makeProvider()]);

      emitConfigChange({ changeType: 'deleted', changedFields: [], version: 2 });
      await waitForDebounce();

      chatWithKey.mockResolvedValue(makeLLMResponse());
      const result = await d.dispatch(makeRequest());
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('no_available_key');
      expect(result.error?.message).toContain('not initialized');
      expect(chatWithKey).not.toHaveBeenCalled();
    });
  });

  describe('provider_config_changed 事件契约（§12.4）', () => {
    describe('幂等性', () => {
      it('同一 eventId 重复派发：第二次丢弃', async () => {
        await makeDispatcher([makeProvider()]);
        const payload = emitConfigChange({ version: 2 });
        await waitForDebounce();
        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);

        configChangeHandler!({ data: payload } as BusEvent);
        await waitForDebounce();

        expect(getProviderUnmasked).toHaveBeenCalledTimes(1); // 未再次同步
      });
    });

    describe('乱序处理', () => {
      it('version < 已处理 version：丢弃', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ version: 3 });
        await waitForDebounce();
        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);

        emitConfigChange({ version: 2 });
        await waitForDebounce();

        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);
      });

      it('version = 已处理 version：丢弃（同一版本多次派发）', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ version: 2 });
        await waitForDebounce();
        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);

        emitConfigChange({ version: 2 }); // 不同 eventId 但同 version
        await waitForDebounce();

        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);
      });

      it('version > 已处理 version：正常处理', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ version: 2 });
        await waitForDebounce();
        emitConfigChange({ version: 3 });
        await waitForDebounce();

        expect(getProviderUnmasked).toHaveBeenCalledTimes(2);
      });
    });

    describe('字段过滤', () => {
      it('changedFields 仅含 name：跳过同步但记录 version', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ version: 2, changedFields: ['name'] });
        await waitForDebounce();
        expect(getProviderUnmasked).not.toHaveBeenCalled();

        // version=2 已记录：随后同 version 的 api_keys 事件被乱序丢弃
        emitConfigChange({ version: 2, changedFields: ['api_keys'] });
        await waitForDebounce();
        expect(getProviderUnmasked).not.toHaveBeenCalled();
      });

      it('changedFields 含 enabled：触发同步', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ version: 2, changedFields: ['enabled'] });
        await waitForDebounce();

        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);
      });

      it('changedFields 为空数组且 changeType=updated：跳过同步', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ version: 2, changedFields: [] });
        await waitForDebounce();

        expect(getProviderUnmasked).not.toHaveBeenCalled();
      });

      it('changeType=deleted：不查库直接清理 tracker', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ changeType: 'deleted', changedFields: [], version: 2 });
        await waitForDebounce();

        expect(getProviderUnmasked).not.toHaveBeenCalled();
      });
    });

    describe('debounce 防事件风暴', () => {
      it('300ms 内 5 次同 providerId 事件：仅触发 1 次同步', async () => {
        await makeDispatcher([makeProvider()]);
        for (let v = 2; v <= 6; v++) {
          emitConfigChange({ version: v });
        }
        await waitForDebounce();

        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);
      });

      it('debounce 窗口内取 version 最大的 payload', async () => {
        await makeDispatcher([makeProvider()]);
        emitConfigChange({ version: 2 });
        emitConfigChange({ version: 5 });
        emitConfigChange({ version: 3 });
        await waitForDebounce();
        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);

        // 已处理 v5：随后 v4 应被乱序丢弃
        emitConfigChange({ version: 4 });
        await waitForDebounce();
        expect(getProviderUnmasked).toHaveBeenCalledTimes(1);
      });

      it('不同 providerId 的事件互不 debounce', async () => {
        const p2 = makeProvider({ id: 'p2', apiKeys: [makeKey(0)], version: 1 });
        await makeDispatcher([makeProvider(), p2]);

        emitConfigChange({ providerId: 'p1', version: 2 });
        emitConfigChange({ providerId: 'p2', version: 2 });
        await waitForDebounce();

        expect(getProviderUnmasked).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('多 Provider 切换（M5 补充）', () => {
    function makeP2(): ModelProvider {
      return makeProvider({
        id: 'p2',
        apiKeys: [{ key: 'sk-p2-key0', label: 'P2Key0', priority: 0 }],
        defaultModel: 'p2-model',
      });
    }

    it('多个 Provider 各自独立令牌桶', async () => {
      const d = await makeDispatcher([makeProvider(), makeP2()]);
      chatWithKey.mockResolvedValue(makeLLMResponse());

      await d.dispatch(makeRequest({ providerId: 'p1' })); // p1 key0
      await d.dispatch(makeRequest({ providerId: 'p1' })); // p1 key1（key0 令牌少）
      await d.dispatch(makeRequest({ providerId: 'p2' })); // p2 key0（独立桶不受影响）

      expect(chatWithKey.mock.calls[0][1]).toMatchObject({ providerId: 'p1', keyIndex: 0 });
      expect(chatWithKey.mock.calls[1][1]).toMatchObject({ providerId: 'p1', keyIndex: 1 });
      expect(chatWithKey.mock.calls[2][1]).toMatchObject({ providerId: 'p2', keyIndex: 0, model: 'p2-model' });
    });

    it('Provider A 全部 key 冷静期时，不影响 Provider B 调用', async () => {
      const d = await makeDispatcher([makeProvider(), makeP2()]);
      chatWithKey.mockImplementation(async (_messages: unknown, params: { providerId: string }) => {
        if (params.providerId === 'p1') throw rateLimitError();
        return makeLLMResponse();
      });

      const r1 = await d.dispatch(makeRequest({ providerId: 'p1' }));
      expect(r1.success).toBe(false);
      expect(r1.error?.type).toBe('rate_limited');

      const r2 = await d.dispatch(makeRequest({ providerId: 'p2' }));
      expect(r2.success).toBe(true);
    });

    it('切换 Provider 后指标独立统计', async () => {
      const d = await makeDispatcher([makeProvider(), makeP2()]);
      chatWithKey.mockImplementation(async (_messages: unknown, params: { providerId: string }) => {
        if (params.providerId === 'p1') throw rateLimitError();
        return makeLLMResponse();
      });

      await d.dispatch(makeRequest({ providerId: 'p1' })); // p1 全 429 → rate_limited
      await d.dispatch(makeRequest({ providerId: 'p2' })); // p2 成功

      const m1 = d.getMetrics('p1');
      const m2 = d.getMetrics('p2');
      expect(m1.successCount).toBe(0);
      expect(m1.rateLimitedCount).toBe(2); // p1 两个 key 各 429 一次
      expect(m2.successCount).toBe(1);
      expect(m2.rateLimitedCount).toBe(0);
    });
  });

  describe('配置变更与运行时竞争（M5 补充）', () => {
    it('dispatch 进行中 Provider 被删除：当前请求正常完成，后续请求失败', async () => {
      const d = await makeDispatcher([makeProvider()]);
      let resolveLlm!: (v: ReturnType<typeof makeLLMResponse>) => void;
      chatWithKey.mockImplementationOnce(() => new Promise((r) => { resolveLlm = r; }));

      const inFlight = d.dispatch(makeRequest());
      await flush();
      expect(chatWithKey).toHaveBeenCalledTimes(1);

      // 进行中删除 Provider
      emitConfigChange({ changeType: 'deleted', changedFields: [], version: 2 });

      // 当前请求正常完成
      resolveLlm(makeLLMResponse());
      const result = await inFlight;
      expect(result.success).toBe(true);

      await waitForDebounce();
      // 后续请求失败
      chatWithKey.mockResolvedValue(makeLLMResponse());
      const r2 = await d.dispatch(makeRequest());
      expect(r2.success).toBe(false);
      expect(r2.error?.message).toContain('not initialized');
    });

    it('dispatch 进行中 rateLimit 配置变更：当前请求不受影响，下次请求生效', async () => {
      const d = await makeDispatcher([
        makeProvider({ apiKeys: [makeKey(0, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 })] }),
      ]);
      let resolveLlm!: (v: ReturnType<typeof makeLLMResponse>) => void;
      chatWithKey.mockImplementationOnce(() => new Promise((r) => { resolveLlm = r; }));

      const inFlight = d.dispatch(makeRequest());
      await flush();

      // 进行中变更 rateLimit（缩容 capacity 10 → 不影响在飞请求）
      getProviderUnmasked.mockResolvedValue(
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 10, refillRatePerSec: 5, maxConcurrent: 5 })],
          version: 2,
        }),
      );
      emitConfigChange({ version: 2, changedFields: ['rateLimit'] });

      resolveLlm(makeLLMResponse());
      const result = await inFlight;
      expect(result.success).toBe(true);

      await waitForDebounce();
      // tracker 状态未被破坏，后续请求正常
      chatWithKey.mockResolvedValue(makeLLMResponse());
      const r2 = await d.dispatch(makeRequest());
      expect(r2.success).toBe(true);
    });
  });

  describe('并发 dispatch 竞争（M5 补充）', () => {
    it('同一 Provider 多个 dispatch 并发：maxConcurrent 限制生效', async () => {
      const d = await makeDispatcher([
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 10, refillRatePerSec: 0, maxConcurrent: 2 })],
        }),
      ]);
      let active = 0;
      let maxActive = 0;
      chatWithKey.mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 50));
        active -= 1;
        return makeLLMResponse();
      });

      const results = await Promise.all([
        d.dispatch(makeRequest()),
        d.dispatch(makeRequest()),
        d.dispatch(makeRequest()),
        d.dispatch(makeRequest()),
      ]);

      expect(results.every((r) => r.success)).toBe(true);
      expect(maxActive).toBeLessThanOrEqual(2);
    });

    it('并发 dispatch 中一个触发 429：其他 dispatch 不受影响', async () => {
      const d = await makeDispatcher([makeProvider()]);
      let call = 0;
      chatWithKey.mockImplementation(async () => {
        call += 1;
        if (call === 1) throw rateLimitError(); // 首个调用 429
        await new Promise((r) => setTimeout(r, 30));
        return makeLLMResponse();
      });

      const results = await Promise.all([
        d.dispatch(makeRequest()),
        d.dispatch(makeRequest()),
        d.dispatch(makeRequest()),
      ]);

      expect(results.every((r) => r.success)).toBe(true);
      expect(d.getMetrics('p1').rateLimitedCount).toBe(1);
    });

    it('高并发下 DispatcherMetrics 计数准确（无丢失或重复）', async () => {
      const d = await makeDispatcher([
        makeProvider({
          apiKeys: [makeKey(0, { capacity: 20, refillRatePerSec: 5, maxConcurrent: 10 })],
        }),
      ]);
      chatWithKey.mockResolvedValue(makeLLMResponse());

      const results = await Promise.all(
        Array.from({ length: 10 }, () => d.dispatch(makeRequest())),
      );

      expect(results.every((r) => r.success)).toBe(true);
      const metrics = d.getMetrics('p1');
      expect(metrics.successCount).toBe(10);
      expect(metrics.totalRequests).toBe(10);
    });
  });

  describe('指标暴露', () => {
    it('getMetrics 返回正确指标', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey
        .mockRejectedValueOnce(rateLimitError()) // d1: key0 429
        .mockResolvedValue(makeLLMResponse()); // d1: key1 成功; d2: key1 成功

      await d.dispatch(makeRequest()); // attempts=2
      await d.dispatch(makeRequest()); // attempts=1（key0 冷静期）

      const metrics = d.getMetrics('p1');
      expect(metrics.providerId).toBe('p1');
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.successCount).toBe(2);
      expect(metrics.rateLimitedCount).toBe(1);
      expect(metrics.avgAttemptCount).toBe(1.5);
      expect(metrics.perKeyMetrics).toHaveLength(2);
      expect(metrics.perKeyMetrics[0].total429).toBe(1);
      expect(metrics.perKeyMetrics[1].totalUsed).toBe(2);
    });

    it('perKeyMetrics 包含所有 key', async () => {
      const d = await makeDispatcher([makeProvider({ apiKeys: [makeKey(0), makeKey(1), makeKey(2)] })]);

      const metrics = d.getMetrics('p1');

      expect(metrics.perKeyMetrics).toHaveLength(3);
      expect(metrics.perKeyMetrics.map((k) => k.keyIndex)).toEqual([0, 1, 2]);
      expect(metrics.perKeyMetrics.map((k) => k.label)).toEqual(['Key0', 'Key1', 'Key2']);
    });
  });

  describe('手动重置', () => {
    it('resetCooldown 清除冷静期 + failed 状态', async () => {
      const d = await makeDispatcher([makeProvider({ apiKeys: [makeKey(0)] })]);
      chatWithKey.mockRejectedValueOnce(rateLimitError());

      const r1 = await d.dispatch(makeRequest());
      expect(r1.success).toBe(false);
      expect(d.getMetrics('p1').perKeyMetrics[0].isInCooldown).toBe(true);

      d.resetCooldown('p1', 0);

      expect(d.getMetrics('p1').perKeyMetrics[0].isInCooldown).toBe(false);
      chatWithKey.mockResolvedValueOnce(makeLLMResponse());
      const r2 = await d.dispatch(makeRequest());
      expect(r2.success).toBe(true);
    });
  });

  describe('dev trace', () => {
    it('dispatcher_request_start / key_selected / token_acquired / request_end 事件触发', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockResolvedValue(makeLLMResponse());

      await d.dispatch(makeRequest());

      const types = devTraceEmit.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('dispatcher_request_start');
      expect(types).toContain('dispatcher_key_selected');
      expect(types).toContain('dispatcher_token_acquired');
      expect(types).toContain('dispatcher_request_end');
      // 携带 saveId 与 requestId
      const start = devTraceEmit.mock.calls.find(
        (c) => (c[0] as { type: string }).type === 'dispatcher_request_start',
      );
      expect(start![0]).toMatchObject({ saveId: 'save-1' });
    });

    it('dispatcher_cooldown_triggered 事件触发', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValueOnce(rateLimitError()).mockResolvedValueOnce(makeLLMResponse());

      await d.dispatch(makeRequest());

      const types = devTraceEmit.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('dispatcher_cooldown_triggered');
    });

    it('dispatcher_key_failed 事件触发（401）', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValueOnce(authError()).mockResolvedValueOnce(makeLLMResponse());

      await d.dispatch(makeRequest());

      const types = devTraceEmit.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain('dispatcher_key_failed');
    });

    it('无 saveId 时 trace 降级为 logger（不调用 devTraceHook）', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockResolvedValue(makeLLMResponse());

      await d.dispatch(makeRequest({ saveId: undefined }));

      expect(devTraceEmit).not.toHaveBeenCalled();
    });
  });

  describe('llm_metrics_event 指标事件', () => {
    it('dispatch 成功发布 llm_metrics_event 到 EventBus', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockResolvedValue(makeLLMResponse());

      await d.dispatch(makeRequest());

      expect(eventBusEmit).toHaveBeenCalledWith(
        'llm_metrics_event',
        expect.objectContaining({
          type: 'llm_metrics_event',
          saveId: 'save-1',
          data: expect.objectContaining({
            providerId: 'p1',
            agentKey: 'test-agent',
            saveId: 'save-1',
            keyIndex: 0,
            success: true,
            attemptCount: 1,
            cooldownTriggered: false,
          }),
        }),
      );
    });

    it('dispatch 失败（rate_limited）发布 llm_metrics_event 含 errorType', async () => {
      const d = await makeDispatcher([makeProvider()]);
      chatWithKey.mockRejectedValue(rateLimitError());

      await d.dispatch(makeRequest());

      expect(eventBusEmit).toHaveBeenCalledWith(
        'llm_metrics_event',
        expect.objectContaining({
          data: expect.objectContaining({
            success: false,
            errorType: 'rate_limited',
            attemptCount: 2,
            cooldownTriggered: true,
          }),
        }),
      );
    });
  });

  describe('destroy', () => {
    it('destroy 取消事件订阅并清理 tracker', async () => {
      const d = await makeDispatcher([makeProvider()]);

      d.destroy();

      expect(eventBusUnsubscribe).toHaveBeenCalledWith('provider_config_changed', expect.any(Function));
      expect(d.getMetrics('p1').perKeyMetrics).toHaveLength(0);
    });

    it('destroy 清理未触发的 debounce 定时器', async () => {
      const d = await makeDispatcher([makeProvider()]);
      emitConfigChange({ version: 2 }); // 未过 debounce 窗口

      d.destroy();
      await waitForDebounce();

      expect(getProviderUnmasked).not.toHaveBeenCalled();
    });
  });

  // ============== M2-B3 D2：OAuth 运行时 key 解析（DP1-DP4） ==============

  describe('dispatch - OAuth 托管型（M2-B3 D2）', () => {
    const resolveApiKey = vi.fn();
    const forceRefresh = vi.fn();
    const oauthCredentialService = { resolveApiKey, forceRefresh } as unknown as OAuthCredentialService;

    function makeOAuthProvider(): ModelProvider {
      return makeProvider({
        providerType: 'github-copilot',
        apiKeys: [{ key: '__oauth_managed__', label: 'OAuth 托管', priority: 0 }],
      });
    }

    /** 与 makeDispatcher 对称，追加 oauthCredentialService 注入 */
    async function makeOAuthDispatcher(providers: ModelProvider[]): Promise<LLMRequestDispatcher> {
      getAllEnabledProviders.mockResolvedValue(providers);
      getProviderUnmasked.mockImplementation(
        async (id: string) => providers.find((p) => p.id === id) ?? null,
      );
      getDefaultProviderId.mockResolvedValue(providers[0]?.id ?? null);
      dispatcher = new LLMRequestDispatcher(
        llmService,
        modelConfigService,
        eventBus,
        devTraceHook,
        undefined,
        oauthCredentialService,
      );
      await dispatcher.initialize();
      return dispatcher;
    }

    beforeEach(() => {
      resolveApiKey.mockReset();
      forceRefresh.mockReset();
      forceRefresh.mockResolvedValue(undefined);
    });

    it('DP1: OAuth 型 dispatch 经 resolveApiKey 取真实 token', async () => {
      const d = await makeOAuthDispatcher([makeOAuthProvider()]);
      resolveApiKey.mockResolvedValue('copilot-session-token');
      chatWithKey.mockResolvedValue(makeLLMResponse('hi'));

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(true);
      expect(resolveApiKey).toHaveBeenCalledWith('github-copilot');
      expect(chatWithKey).toHaveBeenCalledTimes(1);
      expect(chatWithKey.mock.calls[0][1]).toMatchObject({
        providerId: 'p1',
        apiKey: 'copilot-session-token',
        keyIndex: 0,
      });
    });

    it('DP2: OAuth 无凭证 → no_available_key 且提示未登录', async () => {
      const d = await makeOAuthDispatcher([makeOAuthProvider()]);
      resolveApiKey.mockResolvedValue(null);

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('no_available_key');
      expect(result.error?.message).toContain('未登录');
      expect(result.error?.retryable).toBe(false);
      expect(chatWithKey).not.toHaveBeenCalled();
    });

    it('DP3: 普通型 Provider 回归——resolveApiKey 不被调，行为与现状一致', async () => {
      const d = await makeOAuthDispatcher([makeProvider({ apiKeys: [makeKey(0)] })]);
      chatWithKey.mockResolvedValue(makeLLMResponse('hi'));

      const result = await d.dispatch(makeRequest());

      expect(result.success).toBe(true);
      expect(resolveApiKey).not.toHaveBeenCalled();
      expect(chatWithKey.mock.calls[0][1]).toMatchObject({ apiKey: 'sk-key0' });
    });

    it('DP4: 401 → forceRefresh 触发（fire-and-forget），原 markFailed 逻辑不变', async () => {
      const d = await makeOAuthDispatcher([makeOAuthProvider()]);
      resolveApiKey.mockResolvedValue('copilot-session-token');
      chatWithKey.mockRejectedValue(authError());

      const result = await d.dispatch(makeRequest());

      // 单 key 401 → failed，达到 maxAttempts=1 → rate_limited（与存量 401 语义一致）
      expect(result.error?.type).toBe('rate_limited');
      expect(forceRefresh).toHaveBeenCalledWith('github-copilot');
      const metrics = d.getMetrics('p1');
      expect(metrics.perKeyMetrics[0].isFailed).toBe(true);
    });

    it('DP4b: 普通型 401 不触发 forceRefresh', async () => {
      const d = await makeOAuthDispatcher([makeProvider({ apiKeys: [makeKey(0)] })]);
      chatWithKey.mockRejectedValue(authError());

      await d.dispatch(makeRequest());

      expect(forceRefresh).not.toHaveBeenCalled();
    });

    it('DP1s: 流式 dispatchStream 经 resolveApiKey 取真实 token', async () => {
      const d = await makeOAuthDispatcher([makeOAuthProvider()]);
      resolveApiKey.mockResolvedValue('copilot-session-token');
      streamWithKey.mockReturnValue(makeStream([
        { type: 'text_delta', delta: 'he' },
        { type: 'done', message: makeDoneMessage('hello'), reason: 'stop' },
      ]));

      const events = await collectStream(await d.dispatchStream(makeRequest()));

      expect(events.map((e) => e.type)).toEqual(['delta', 'done']);
      expect(resolveApiKey).toHaveBeenCalledWith('github-copilot');
      expect(streamWithKey.mock.calls[0][1]).toMatchObject({ apiKey: 'copilot-session-token' });
    });

    it('DP2s: 流式 OAuth 无凭证 → error 事件 no_available_key', async () => {
      const d = await makeOAuthDispatcher([makeOAuthProvider()]);
      resolveApiKey.mockResolvedValue(null);

      const events = await collectStream(await d.dispatchStream(makeRequest()));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        error: { type: 'no_available_key', retryable: false },
      });
      expect(streamWithKey).not.toHaveBeenCalled();
    });
  });
});
