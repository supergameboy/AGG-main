import { describe, expect, it, vi } from 'vitest';
import {
  LLMService,
  SmartRetry,
  LLMInvalidApiKeyError,
  LLMTokenLimitExceededError,
  LLMTimeoutError,
  LLMContentFilteredError,
  LLMNetworkError,
} from '@ai-rpg/ai';

describe('SmartRetry 错误分类', () => {
  const retry = new SmartRetry();

  it('正确分类认证错误 (401/403) 为不可重试', () => {
    const result = retry.classifyError(new Error('401 Authentication failed'));
    expect(result.category).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('正确分类速率限制 (429) 为不可重试（由 Dispatcher 处理换 key）', () => {
    const result = retry.classifyError(new Error('429 Rate limit exceeded'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(false);
  });

  it('正确分类超时为可重试', () => {
    const result = retry.classifyError(new Error('Request timeout after 30000ms'));
    expect(result.category).toBe('timeout');
    expect(result.retryable).toBe(true);
  });

  it('正确分类网络错误为可重试', () => {
    const result = retry.classifyError(new Error('fetch failed: ECONNREFUSED'));
    expect(result.category).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('正确分类上下文溢出为不可重试', () => {
    const result = retry.classifyError(new Error('context_length_exceeded'));
    expect(result.category).toBe('context_overflow');
    expect(result.retryable).toBe(false);
  });

  it('正确分类内容过滤为不可重试', () => {
    const result = retry.classifyError(new Error('content_filter triggered'));
    expect(result.category).toBe('content_filtered');
    expect(result.retryable).toBe(false);
  });

  it('正确分类服务端错误 (5xx) 为可重试', () => {
    const result = retry.classifyError(new Error('502 Bad Gateway'));
    expect(result.category).toBe('server_error');
    expect(result.retryable).toBe(true);
  });

  it('正确分类请求格式错误 (400) 为不可重试', () => {
    const result = retry.classifyError(new Error('400 Bad request'));
    expect(result.category).toBe('bad_request');
    expect(result.retryable).toBe(false);
  });

  it('未知错误分类为不可重试', () => {
    const result = retry.classifyError(new Error('something unexpected'));
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(false);
  });
});

describe('SmartRetry 重试策略', () => {
  const retry = new SmartRetry();

  it('429 速率限制策略：不可重试 + 抛出原始错误（由 Dispatcher 处理换 key + 冷却）', () => {
    const classified = retry.classifyError(new Error('429 Rate limit exceeded'));
    const strategy = retry.decideStrategy(classified, 1);
    expect(strategy.shouldRetry).toBe(false);
    expect(strategy.throwInstead).toBeUndefined();
  });

  it('超时策略：可重试 + 切换 Provider + 不切换 Key', () => {
    const classified = retry.classifyError(new Error('timeout'));
    const strategy = retry.decideStrategy(classified, 1);
    expect(strategy.shouldRetry).toBe(true);
    expect(strategy.switchProvider).toBe(true);
    expect(strategy.switchKey).toBe(false);
  });

  it('认证失败策略：不可重试 + 抛出原始错误（由 Dispatcher 冷却该 key）', () => {
    const classified = retry.classifyError(new Error('401 Unauthorized'));
    const strategy = retry.decideStrategy(classified, 1);
    expect(strategy.shouldRetry).toBe(false);
    expect(strategy.throwInstead).toBeUndefined();
  });

  it('上下文溢出策略：不可重试 + 抛出 LLMTokenLimitExceededError', () => {
    const classified = retry.classifyError(new Error('context_length_exceeded'));
    const strategy = retry.decideStrategy(classified, 1);
    expect(strategy.shouldRetry).toBe(false);
    expect(strategy.throwInstead).toBeInstanceOf(LLMTokenLimitExceededError);
  });

  it('超过最大重试次数后不可重试', () => {
    const classified = retry.classifyError(new Error('429 Rate limit'));
    const strategy = retry.decideStrategy(classified, 3);
    expect(strategy.shouldRetry).toBe(false);
  });

  it('指数退避延迟随重试次数递增', () => {
    const classified = retry.classifyError(new Error('timeout'));
    const s1 = retry.decideStrategy(classified, 1);
    const s2 = retry.decideStrategy(classified, 2);
    expect(s2.delayMs).toBeGreaterThan(s1.delayMs);
  });
});

describe('SmartRetry 类型化错误转换', () => {
  const retry = new SmartRetry();

  it('auth → LLMInvalidApiKeyError', () => {
    const classified = retry.classifyError(new Error('401'));
    const error = retry.toTypedError(classified);
    expect(error).toBeInstanceOf(LLMInvalidApiKeyError);
  });

  it('context_overflow → LLMTokenLimitExceededError', () => {
    const classified = retry.classifyError(new Error('context_length_exceeded'));
    const error = retry.toTypedError(classified);
    expect(error).toBeInstanceOf(LLMTokenLimitExceededError);
  });

  it('content_filtered → LLMContentFilteredError', () => {
    const classified = retry.classifyError(new Error('content_filter'));
    const error = retry.toTypedError(classified);
    expect(error).toBeInstanceOf(LLMContentFilteredError);
  });

  it('timeout → LLMTimeoutError', () => {
    const classified = retry.classifyError(new Error('timeout'));
    const error = retry.toTypedError(classified);
    expect(error).toBeInstanceOf(LLMTimeoutError);
  });

  it('network → LLMNetworkError', () => {
    const classified = retry.classifyError(new Error('fetch failed'));
    const error = retry.toTypedError(classified);
    expect(error).toBeInstanceOf(LLMNetworkError);
  });
});

describe('LLMService 集成（M1：ILLMMetricsSink 端口）', () => {
  it('记录 LLM 调用时应通过 metricsSink 写入 prompt cache 与阶段元数据', async () => {
    const recordSpy = vi.fn();
    const service = new LLMService({} as never, { record: recordSpy });
    const internalService = service as unknown as {
      emitMetrics: (params: {
        saveId?: string;
        agentType?: string;
        model: string;
        usage: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          promptCacheHitTokens?: number;
          promptCacheMissTokens?: number;
        };
        durationMs: number;
        success: boolean;
        metadata?: {
          stage?: string;
          prefixHash?: string;
          cacheStrategy?: string;
          reactIterations?: number;
          toolCallsCount?: number;
        };
      }) => void;
    };

    internalService.emitMetrics({
      saveId: 'save-1',
      agentType: 'coordinator',
      model: 'deepseek-chat',
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        promptCacheHitTokens: 64,
        promptCacheMissTokens: 36,
      },
      durationMs: 1500,
      success: true,
      metadata: {
        stage: 'planner',
        prefixHash: 'hash-123',
        cacheStrategy: 'stable-prefix-v1',
        reactIterations: 0,
        toolCallsCount: 0,
      },
    });

    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
      saveId: 'save-1',
      agentType: 'coordinator',
      model: 'deepseek-chat',
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      promptCacheHitTokens: 64,
      promptCacheMissTokens: 36,
      stage: 'planner',
      prefixHash: 'hash-123',
      cacheStrategy: 'stable-prefix-v1',
      reactIterations: 0,
      toolCallsCount: 0,
      durationMs: 1500,
      success: true,
    }));
  });

  it('saveId/agentType 缺失时不记录度量（对齐原 logLLMCall 门控）', async () => {
    const recordSpy = vi.fn();
    const service = new LLMService({} as never, { record: recordSpy });
    const internalService = service as unknown as {
      emitMetrics: (params: {
        saveId?: string;
        agentType?: string;
        model: string;
        usage: { promptTokens: number; completionTokens: number; totalTokens: number };
        durationMs: number;
        success: boolean;
      }) => void;
    };

    internalService.emitMetrics({
      model: 'deepseek-chat',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      durationMs: 100,
      success: true,
    });

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('LLM 调用失败时也应通过 metricsSink 写入最小失败日志并保留阶段元数据', async () => {
    const recordSpy = vi.fn();
    const fakeModelConfig = {
      getActiveApiKey: vi.fn().mockResolvedValue(null),
      reportKeyFailure: vi.fn(),
    };

    const service = new LLMService(fakeModelConfig as never, { record: recordSpy });
    const internalService = service as unknown as {
      executeWithRetry: (
        client: { chat: () => Promise<never> },
        messages: Array<{ role: 'user'; content: string }>,
        options: {
          agentType: string;
          loggingMetadata: {
            stage: string;
          };
        },
        providerId: string,
        model: string,
        saveId: string,
        agentType: string
      ) => Promise<unknown>;
      delay: (ms: number) => Promise<void>;
    };

    vi.spyOn(internalService, 'delay').mockResolvedValue(undefined);

    await expect(internalService.executeWithRetry(
      { chat: vi.fn().mockRejectedValue(new Error('fatal boom')) },
      [{ role: 'user', content: 'hello' }],
      {
        agentType: 'dialogue',
        loggingMetadata: {
          stage: 'planner',
        },
      },
      'provider-1',
      'model-1',
      'save-1',
      'dialogue'
    )).rejects.toThrow('fatal boom');

    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
      saveId: 'save-1',
      agentType: 'dialogue',
      model: 'model-1',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      stage: 'planner',
      success: false,
    }));
  });
});
