import type { LLMMessage as SharedLLMMessage } from '@ai-rpg/shared';
import type { EventStream } from './event-stream.js';
import type { ModelCostBreakdown } from './model-metadata.js';

export type LLMProvider = 'openai' | 'gemini' | 'deepseek' | 'glm' | 'kimi' | 'anthropic' | 'qwen' | 'ernie' | 'spark' | 'siliconflow' | 'github-copilot' | 'custom';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  apiFormat?: 'openai' | 'anthropic';
  /**
   * 透传至底层 HTTP client 的默认请求头（M2-B3 扩展点）。
   * GitHubCopilotProvider 借此注入 Copilot 必需的 Editor 系列与 User-Agent 头（缺失会 403）。
   */
  defaultHeaders?: Record<string, string>;
  thinking?: {
    enabled: boolean;
    effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; name: string };
  responseFormat?: { type: 'json_object' | 'text' };
  stop?: string[];
  topP?: number;
  /** 思考级别（pi 6 级，M5 v1.2 D5.3；off = 真正 per-request 关闭思考） */
  reasoningEffort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  requestId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface ToolCallResult {
  toolCallId: string;
  output: string;
}

export interface LLMResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

export interface StreamChunk {
  type: 'content' | 'tool_call';
  content?: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    index: number;
    id: string;
    name: string;
    arguments: string;
  }>;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
}

export interface LLMClient {
  chat(messages: SharedLLMMessage[], options?: ChatOptions): Promise<LLMResponse>;
  stream(messages: SharedLLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;
  countTokens(text: string): number;
}

// ===== 12 种 LLMStreamEvent 类型（M1 模块 §6.2）=====

/**
 * 部分聚合快照
 * 每个事件携带当前已聚合的部分结果，便于消费方增量渲染
 */
export interface LLMStreamPartial {
  text?: string;
  thinking?: string;
  toolCalls?: Partial<LLMStreamToolCall>[];
  usage?: Partial<LLMStreamUsage>;
}

/**
 * 完整的工具调用
 */
export interface LLMStreamToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 最终消息（done 事件携带）
 */
export interface LLMStreamFinalMessage {
  role: 'assistant';
  content: string | Array<{
    type: 'text' | 'thinking' | 'tool_use';
    text?: string;
    thinking?: string;
    toolCall?: LLMStreamToolCall;
  }>;
  usage?: LLMStreamUsage;
}

/**
 * Token 使用统计
 */
export interface LLMStreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

/**
 * 错误信息
 */
export interface LLMStreamErrorInfo {
  message: string;
  code?: string;
  retryable?: boolean;
}

/**
 * 完成原因
 */
export type LLMFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

// ===== 生命周期事件 =====

export interface LLMStreamStartEvent {
  type: 'start';
  partial: LLMStreamPartial;
}

export interface LLMStreamDoneEvent {
  type: 'done';
  reason: Extract<LLMFinishReason, 'stop' | 'length' | 'tool_calls'>;
  message: LLMStreamFinalMessage;
  usage?: LLMStreamUsage;
}

export interface LLMStreamErrorEvent {
  type: 'error';
  reason: 'aborted' | 'error';
  error: LLMStreamErrorInfo;
  partial: LLMStreamPartial;
}

// ===== 文本内容事件 =====

export interface LLMStreamTextStartEvent {
  type: 'text_start';
  contentIndex: number;
  partial: LLMStreamPartial;
}

export interface LLMStreamTextDeltaEvent {
  type: 'text_delta';
  contentIndex: number;
  delta: string;
  partial: LLMStreamPartial;
}

export interface LLMStreamTextEndEvent {
  type: 'text_end';
  contentIndex: number;
  content: string;
  partial: LLMStreamPartial;
}

// ===== 思考过程事件 =====

export interface LLMStreamThinkingStartEvent {
  type: 'thinking_start';
  contentIndex: number;
  partial: LLMStreamPartial;
}

export interface LLMStreamThinkingDeltaEvent {
  type: 'thinking_delta';
  contentIndex: number;
  delta: string;
  partial: LLMStreamPartial;
}

export interface LLMStreamThinkingEndEvent {
  type: 'thinking_end';
  contentIndex: number;
  content: string;
  partial: LLMStreamPartial;
}

// ===== 工具调用事件 =====

export interface LLMStreamToolCallStartEvent {
  type: 'toolcall_start';
  contentIndex: number;
  partial: LLMStreamPartial;
}

export interface LLMStreamToolCallDeltaEvent {
  type: 'toolcall_delta';
  contentIndex: number;
  delta: string;
  partial: LLMStreamPartial;
}

export interface LLMStreamToolCallEndEvent {
  type: 'toolcall_end';
  contentIndex: number;
  toolCall: LLMStreamToolCall;
  partial: LLMStreamPartial;
}

/**
 * LLM 流式事件（12 种 discriminated union）
 */
export type LLMStreamEvent =
  | LLMStreamStartEvent
  | LLMStreamDoneEvent
  | LLMStreamErrorEvent
  | LLMStreamTextStartEvent
  | LLMStreamTextDeltaEvent
  | LLMStreamTextEndEvent
  | LLMStreamThinkingStartEvent
  | LLMStreamThinkingDeltaEvent
  | LLMStreamThinkingEndEvent
  | LLMStreamToolCallStartEvent
  | LLMStreamToolCallDeltaEvent
  | LLMStreamToolCallEndEvent;

/**
 * LLM 流式事件流
 * 专门用于 LLMService.stream() 的返回值类型
 */
export type LLMStreamEventStream = EventStream<LLMStreamEvent, LLMStreamFinalMessage>;

// ===== ILLMMetricsSink 端口（M1 模块 §6.4）=====

/**
 * LLM 调用度量数据载荷
 */
export interface LLMCallMetricsPayload {
  saveId: string;
  agentType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  success: boolean;
  timestamp: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  stage?: string;
  prefixHash?: string;
  cacheStrategy?: string;
  reactIterations?: number;
  toolCallsCount?: number;
  /**
   * 本次调用成本（USD，M2-2 增量，可选向后兼容）。
   * 未知模型元数据时为 undefined（禁止编造 0），E 层 LLMMetricsSink 落库为 null。
   * 由 E 层 Sink 落库时经 resolveModelMetadata + calculateCost 附带；
   * 已显式提供时 Sink 直接使用（扩展点，优先级高于 Sink 计算）。
   */
  cost?: ModelCostBreakdown;
}

/**
 * LLM 度量数据出口端口
 *
 * H 层通过此端口将度量数据传递给外部系统，零 DB 依赖
 */
export interface ILLMMetricsSink {
  record(payload: LLMCallMetricsPayload): void;
}

/**
 * 空实现（默认，用于测试或未配置场景）
 */
export class NullLLMMetricsSink implements ILLMMetricsSink {
  record(): void {
    // 空操作
  }
}

// ===== IModelConfigStore 端口（M1 模块 §6.6）=====

/**
 * model_providers 表行类型
 */
export interface ModelProviderStoreRow {
  id: string;
  provider_type: string;
  name: string;
  base_url: string;
  api_format: string;
  api_keys: string;
  default_model: string;
  max_tokens: number;
  enabled: number;
  extra_config: string | null;
  created_at: number;
  updated_at: number;
  /**
   * 配置版本号（单调递增，provider_config_changed 事件契约）
   * M9 迁移009新增（DB DEFAULT 0），每次 updateProvider 时 version = version + 1
   * 设计文档: solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §12.1
   */
  version: number;
}

/**
 * model_config_defaults 表行类型
 */
export interface ModelConfigDefaultsStoreRow {
  id: string;
  default_provider_id: string | null;
  default_model: string | null;
  fast_provider_id: string | null;
  fast_model: string | null;
  updated_at: number;
}

/**
 * 模型配置存储端口
 *
 * H 层通过此端口访问模型配置持久化，零 DB 依赖
 */
export interface IModelConfigStore {
  listProviderRows(): Promise<ModelProviderStoreRow[]>;
  getProviderRow(id: string): Promise<ModelProviderStoreRow | null>;
  insertProviderRow(row: ModelProviderStoreRow): Promise<void>;
  updateProviderRow(id: string, data: Record<string, unknown>): Promise<void>;
  deleteProviderRow(id: string): Promise<void>;

  getDefaultsRow(): Promise<ModelConfigDefaultsStoreRow | null>;
  insertDefaultsRow(row: ModelConfigDefaultsStoreRow): Promise<void>;
  updateDefaultsRow(data: Record<string, unknown>): Promise<void>;

  countAgentProfilesReferencingProvider(providerId: string): Promise<number>;

  listProviderApiKeyRows(): Promise<Array<{ id: string; api_keys: string }>>;

  /**
   * 自增 provider version 并返回新值（M9 §12.2.1）
   * 调用方：ModelConfigService.updateProvider / deleteProvider
   * 语义：UPDATE model_providers SET version = version + 1 WHERE id = ? 后读取新值
   */
  incrementProviderVersion(id: string): Promise<number>;

  /**
   * 读取 provider 当前 version（M9 §12.2.1）
   * provider 不存在时返回 0
   */
  getProviderVersion(id: string): Promise<number>;
}
