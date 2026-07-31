/**
 * 超时控制工具（P3-S0 从 backend/src/utils/timeout.ts 拆分迁移）
 *
 * 迁移部分：TimeoutError + withTimeout + TimeoutOptions（纯逻辑，仅依赖 shared logger）
 * 保留在 backend：getTimeoutConfig（依赖 backend 的 config）
 */

import { getChildLogger } from './logger.js';

const logger = getChildLogger('timeout');

export interface TimeoutOptions {
  timeoutMs: number;
  errorMessage?: string;
  context?: string;
}

/**
 * 超时配置结构（v1.3 新增）
 *
 * 与 backend/utils/config.ts 的 timeout schema 字段一致。
 * BaseTool 通过 registerTimeoutConfig 注册的 provider 获取此配置。
 */
export interface TimeoutConfig {
  chat: number;
  directMessage: number;
  llmProvider: number;
  agentProcessing: number;
  dagNode: number;
  toolExecution: number;
  reactIteration: number;
  reactMaxTokens: number;
  wsHeartbeat: number;
  wsMaxMissedHeartbeats: number;
}

class TimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly context: string | undefined;

  constructor(timeoutMs: number, context?: string) {
    const message = context
      ? `Operation timed out after ${timeoutMs}ms: ${context}`
      : `Operation timed out after ${timeoutMs}ms`;
    super(message);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.context = context;
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, errorMessage, context } = options;

  if (timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const msg = errorMessage || (context ? `Timeout: ${context}` : `Timeout after ${timeoutMs}ms`);
      logger.warn(msg, { timeoutMs, context });
      reject(new TimeoutError(timeoutMs, context));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}
