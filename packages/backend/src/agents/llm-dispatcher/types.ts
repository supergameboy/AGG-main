/**
 * llm-dispatcher 类型定义
 *
 * M2 修复：类型唯一定义在 shared/types/agent.ts，本文件仅 re-export。
 * 避免重复定义导致的不一致。
 *
 * 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §5.1
 */

// Re-export all dispatcher types from shared (single source of truth)
export type {
  LLMDispatchRequest,
  LLMDispatchResult,
  LLMDispatchErrorType,
  PerKeyMetrics,
  DispatcherMetricsSnapshot,
  LLMDispatchStreamEvent,
  ILLMRequestDispatcher,
} from '@ai-rpg/shared';

// Re-export event payload types for convenience
export type { ProviderConfigChangedPayload } from '@ai-rpg/shared/messaging';
