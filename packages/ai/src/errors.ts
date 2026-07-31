/**
 * LLM 错误类型——ai 包独立实现
 *
 * 从 backend/errors/errorTypes.ts 迁移，但不依赖 backend 的 AppError/ErrorCode 体系。
 * 保持构造函数签名与 backend 兼容，确保 smart-retry.ts 的 toTypedError 无需修改调用方式。
 *
 * 迁移的 6 个错误类（被 smart-retry.ts 使用）：
 * - LLMInvalidApiKeyError
 * - LLMTokenLimitExceededError
 * - LLMTimeoutError
 * - LLMContentFilteredError
 * - LLMNetworkError
 * - LLMModelUnavailableError
 */

/**
 * LLM 错误基类——对应 backend 的 LLMError（简化版，不继承 AppError）
 */
export class LLMError extends Error {
  constructor(message?: string) {
    super(message || 'LLM Error');
    this.name = 'LLMError';
  }
}

export class LLMInvalidApiKeyError extends LLMError {
  constructor(provider?: string) {
    super(provider ? `LLM API 密钥无效: ${provider}` : 'LLM API 密钥无效');
    this.name = 'LLMInvalidApiKeyError';
  }
}

export class LLMModelUnavailableError extends LLMError {
  constructor(model?: string, details?: { originalError?: string }) {
    const detail = details?.originalError ? `: ${details.originalError}` : '';
    super(model ? `LLM 模型不可用: ${model}${detail}` : `LLM 模型不可用${detail}`);
    this.name = 'LLMModelUnavailableError';
  }
}

export class LLMTokenLimitExceededError extends LLMError {
  constructor(tokenCount?: number, limit?: number) {
    super(
      tokenCount !== undefined && limit !== undefined
        ? `LLM Token 超限: ${tokenCount}/${limit}`
        : 'LLM Token 超限'
    );
    this.name = 'LLMTokenLimitExceededError';
  }
}

export class LLMContentFilteredError extends LLMError {
  constructor(reason?: string) {
    super(reason ? `内容被过滤: ${reason}` : '内容被过滤');
    this.name = 'LLMContentFilteredError';
  }
}

export class LLMTimeoutError extends LLMError {
  /**
   * @param timeoutOrMessage 数字时按超时毫秒数格式化（0 表示禁用超时，不显示误导性的 "(0ms)"）；
   *                         字符串时作为原始错误信息附加，保留真实错误上下文
   */
  constructor(timeoutOrMessage?: number | string) {
    let message: string;
    if (typeof timeoutOrMessage === 'number') {
      // timeout <= 0 表示禁用超时（commit f61d5f8 决策），不应显示 "(0ms)"
      message = timeoutOrMessage > 0 ? `LLM 请求超时 (${timeoutOrMessage}ms)` : 'LLM 请求超时';
    } else if (timeoutOrMessage) {
      message = `LLM 请求超时: ${timeoutOrMessage}`;
    } else {
      message = 'LLM 请求超时';
    }
    super(message);
    this.name = 'LLMTimeoutError';
  }
}

export class LLMNetworkError extends LLMError {
  constructor(message?: string) {
    super(message || 'LLM 网络连接失败');
    this.name = 'LLMNetworkError';
  }
}

/**
 * Provider 模块 lazy 加载失败（M2-1）
 *
 * dynamic import 失败时由 LazyProviderProxy 抛出，禁止 fallback 掩盖：
 * 模块缺失/依赖未安装必须让调用方看到明确错误，而非静默降级。
 */
export class LLMProviderLoadError extends Error {
  readonly providerType: string;
  constructor(message: string, providerType = 'unknown') {
    super(message);
    this.name = 'LLMProviderLoadError';
    this.providerType = providerType;
  }
}
