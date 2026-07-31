import {
  LLMInvalidApiKeyError,
  LLMTokenLimitExceededError,
  LLMTimeoutError,
  LLMContentFilteredError,
  LLMNetworkError,
  LLMModelUnavailableError,
} from '../errors.js';
import { getErrorMessage } from '../utils/error.js';

// ==================== 错误分类 ====================

export type LLMErrorCategory =
  | 'rate_limit'
  | 'auth'
  | 'context_overflow'
  | 'content_filtered'
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'bad_request'
  | 'unknown';

export interface ClassifiedError {
  category: LLMErrorCategory;
  retryable: boolean;
  originalError: Error;
  retryAfterMs?: number;
}

// ==================== 重试策略 ====================

export interface RetryStrategy {
  shouldRetry: boolean;
  delayMs: number;
  switchProvider: boolean;
  switchKey: boolean;
  throwInstead?: Error;
}

export interface SmartRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  serverErrorBaseDelayMs: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: SmartRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 500,
  serverErrorBaseDelayMs: 2000,
  timeoutMs: 0, // 超时已禁用（commit f61d5f8 决策）
};

// ==================== SmartRetry 类 ====================

export class SmartRetry {
  private readonly config: SmartRetryConfig;

  constructor(config?: Partial<SmartRetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 统一错误分类——替代散落在多处的 isKeyFailure/isNetworkError/isContextOverflowError
   */
  classifyError(error: unknown): ClassifiedError {
    const msg = getErrorMessage(error).toLowerCase();
    const originalError = error instanceof Error ? error : new Error(String(error));

    // 1. 上下文溢出——不重试
    if (this.matchKeywords(msg, ['context_length_exceeded', 'max context length', 'too many tokens', 'token limit', 'context_overflow'])) {
      return { category: 'context_overflow', retryable: false, originalError };
    }

    // 2. 内容过滤——不重试
    if (this.matchKeywords(msg, ['content_filter', 'content policy', 'safety', 'content_filtered'])) {
      return { category: 'content_filtered', retryable: false, originalError };
    }

    // 3. 认证失败——不重试，由 LLMRequestDispatcher 标记 key failed 并切换 Key（M9 §7.3）
    if (this.matchKeywords(msg, ['401', '403', 'authentication', 'invalid_api_key', 'invalid api key', 'auth failed'])) {
      return { category: 'auth', retryable: false, originalError };
    }

    // 4. 速率限制——不重试，由 LLMRequestDispatcher 标记冷静期并切换 Key（M9 §7.3）
    if (this.matchKeywords(msg, ['429', 'rate limit', 'rate_limit', 'too many requests'])) {
      const retryAfterMs = this.extractRetryAfter(error);
      return { category: 'rate_limit', retryable: false, originalError, retryAfterMs };
    }

    // 5. 超时——可重试（仅匹配真正的请求超时，ETIMEDOUT/ECONNRESET 归入网络层错误）
    if (this.matchKeywords(msg, ['timeout', 'timed out'])) {
      return { category: 'timeout', retryable: true, originalError };
    }

    // 6. 网络错误——可重试（含连接层错误 ETIMEDOUT/ECONNRESET，这些是 TCP 层失败而非请求超时）
    if (this.matchKeywords(msg, ['fetch failed', 'econnrefused', 'enotfound', 'etimedout', 'econnreset', 'network error', 'llm_network_error', 'network'])) {
      return { category: 'network', retryable: true, originalError };
    }

    // 7. 服务端错误 (5xx)——可重试
    if (this.matchKeywords(msg, ['500', '502', '503', '529', 'server error', 'service unavailable', 'overloaded'])) {
      return { category: 'server_error', retryable: true, originalError };
    }

    // 8. 请求格式错误——不重试
    if (this.matchKeywords(msg, ['400', 'bad request', 'invalid request', 'invalid model'])) {
      return { category: 'bad_request', retryable: false, originalError };
    }

    return { category: 'unknown', retryable: false, originalError };
  }

  /**
   * 根据错误分类和当前重试次数，决定重试策略
   *
   * M9 §7.3 决策表：rate_limit/auth 不再由 SmartRetry 处理（不重试、不切换），
   * 抛出原始错误保留 HTTP status/headers，供 LLMRequestDispatcher 分类与
   * Retry-After 解析；其余不可重试错误仍抛出类型化错误。
   */
  decideStrategy(classified: ClassifiedError, attempt: number): RetryStrategy {
    // 不可重试的错误——直接抛出
    if (!classified.retryable) {
      // rate_limit/auth 抛原始错误（保留 status/headers），由 Dispatcher 处理失败转移
      const throwOriginal = classified.category === 'rate_limit' || classified.category === 'auth';
      return {
        shouldRetry: false,
        delayMs: 0,
        switchProvider: false,
        switchKey: false,
        throwInstead: throwOriginal ? undefined : this.toTypedError(classified),
      };
    }

    // 超过最大重试次数
    if (attempt >= this.config.maxRetries) {
      return {
        shouldRetry: false,
        delayMs: 0,
        switchProvider: false,
        switchKey: false,
        throwInstead: this.toTypedError(classified),
      };
    }

    // 根据错误类型选择策略（rate_limit/auth 已在上方 !retryable 分支拦截，不会到达此处）
    switch (classified.category) {
      case 'timeout':
        return {
          shouldRetry: true,
          delayMs: this.exponentialBackoff(attempt, this.config.baseDelayMs),
          switchProvider: true,
          switchKey: false,
        };

      case 'network':
        return {
          shouldRetry: true,
          delayMs: this.exponentialBackoff(attempt, this.config.baseDelayMs),
          switchProvider: true,
          switchKey: false,
        };

      case 'server_error':
        return {
          shouldRetry: true,
          delayMs: this.exponentialBackoff(attempt, this.config.serverErrorBaseDelayMs),
          switchProvider: true,
          switchKey: false,
        };

      default:
        return {
          shouldRetry: false,
          delayMs: 0,
          switchProvider: false,
          switchKey: false,
          throwInstead: this.toTypedError(classified),
        };
    }
  }

  /**
   * 将分类错误转换为已定义的错误类型——替代散落的通用 Error 抛出
   */
  toTypedError(classified: ClassifiedError): Error {
    const msg = classified.originalError.message;
    switch (classified.category) {
      case 'auth':
        return new LLMInvalidApiKeyError();
      case 'context_overflow':
        return new LLMTokenLimitExceededError();
      case 'content_filtered':
        return new LLMContentFilteredError(msg);
      case 'timeout':
        // 保留原始错误信息，避免用配置项 timeoutMs（值为 0 表示禁用超时）显示无意义的 "(0ms)"
        return new LLMTimeoutError(msg);
      case 'network':
        return new LLMNetworkError(msg);
      case 'rate_limit':
        return new LLMNetworkError(`Rate limit exceeded: ${msg}`);
      case 'server_error':
        return new LLMModelUnavailableError(undefined, { originalError: msg });
      case 'bad_request':
        return new Error(`Bad request: ${msg}`);
      default:
        return classified.originalError;
    }
  }

  /**
   * 计算指数退避延迟 + 随机抖动
   */
  private exponentialBackoff(attempt: number, baseDelayMs: number): number {
    const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), this.config.maxDelayMs);
    const jitter = Math.random() * this.config.jitterMs;
    return delay + jitter;
  }

  /**
   * 从错误对象中提取 Retry-After 值（毫秒）
   */
  private extractRetryAfter(error: unknown): number | undefined {
    if (error && typeof error === 'object') {
      const headers = (error as any).headers;
      if (headers) {
        const retryAfter = headers['retry-after'] || headers['Retry-After'];
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds)) {
            return seconds * 1000;
          }
        }
      }
    }
    return undefined;
  }

  private matchKeywords(msg: string, keywords: string[]): boolean {
    return keywords.some(kw => msg.includes(kw));
  }
}

// 导出单例供服务层使用
export const smartRetry = new SmartRetry();
