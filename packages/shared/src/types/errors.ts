/**
 * 跨层共享的错误类型定义
 *
 * 仅放置需要被多个包（如 backend/agents 与 backend/services）共同引用的错误类，
 * 以打破 agents↔services 的双向依赖（参见 fractal-design-20260626-backend-decoupling-refactor）。
 *
 * 规则：
 * - 此文件中的 class 仅做"属性赋值"级别的初始化，不包含业务逻辑
 * - 不依赖任何运行时服务（logger、db 等）
 */

/**
 * 上下文溢出错误
 *
 * 由 LLM 调用层（services/llm-new.ts、services/context-injector.ts）抛出，
 * 由 agents/coordinator 层捕获并处理（如触发压缩、降级）。
 *
 * 迁移自 packages/backend/src/agents/coordinator/types.ts
 * 原因：消除 agents→services 的反向依赖边，改为 agents→shared←services
 */
export class ContextOverflowError extends Error {
  public readonly errorType = 'context_overflow' as const;
  public readonly agentType: string;
  public readonly currentTokens: number;
  public readonly maxTokens: number;
  public readonly partialResult?: Record<string, unknown>;
  public readonly suggestion?: string;

  constructor(opts: {
    agentType: string;
    currentTokens: number;
    maxTokens: number;
    partialResult?: Record<string, unknown>;
    suggestion?: string;
  }) {
    super(`Context overflow for ${opts.agentType}: ${opts.currentTokens}/${opts.maxTokens} tokens`);
    this.name = 'ContextOverflowError';
    this.agentType = opts.agentType;
    this.currentTokens = opts.currentTokens;
    this.maxTokens = opts.maxTokens;
    this.partialResult = opts.partialResult;
    this.suggestion = opts.suggestion;
  }
}
