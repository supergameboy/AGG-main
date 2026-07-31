import { ID, Timestamp, JSONValue } from './core';
import type { PanelUpdates } from './dynamic-ui';

export type AgentType =
  | 'gamemaster'
  | 'output'
  | 'challenge'
  | 'quest'
  | 'map'
  | 'npc_party'
  | 'inventory'
  | 'skill'
  | 'numerical'
  | 'event'
  | 'time'
  | 'game';

export type ToolType =
  | 'inventory_data'
  | 'skill_data'
  | 'map_data'
  | 'quest_data'
  | 'npc_party_data'
  | 'event_data'
  | 'combat_data'
  | 'numerical'
  | 'time_data'
  | 'inventory_service'
  | 'skill_service'
  | 'map_service'
  | 'quest_service'
  | 'npc_service'
  | 'event_service'
  | 'dialogue_service'
  | 'challenge_service'
  | 'character_service'
  | 'numerical_service'
  | 'game_time_service'
  | 'game_init_service'
  | 'generate_options'
  | 'batch_query'
  | 'coordinator_service'
  | 'rule_service'
  | 'skill_loader'
  | 'help_service'
  | 'dynamic_ui'
  | 'template_pool_service';

export interface AgentMessage {
  id: ID;
  timestamp: Timestamp;
  from: AgentType;
  to: AgentType | AgentType[];
  type: 'request' | 'response' | 'notification' | 'error';
  saveId: ID;
  payload: {
    action: string;
    intentHint?: string;
    data: unknown;
  };
  metadata: {
    priority: 'low' | 'normal' | 'high';
    requiresResponse: boolean;
    timeout?: number;
    /** v2 新增: WS 请求的 requestId，供 processMessage 入口创建 ProgressContext */
    _wsRequestId?: string;
    /** v2 新增: 发起请求的 WS 客户端 ID，供 processMessage 入口创建 ProgressContext */
    _wsClientId?: string;
    /** v2 新增: 父任务标识（task:{父agentRunId}），子Agent 通过 metadata 注入而非 setParentContext */
    _parentTask?: string | null;
  };
  correlationId?: ID;
}

export interface AgentContext {
  agentType: AgentType;
  messages: LLMMessage[];
  state: Record<string, JSONValue>;
  lastUpdate: Timestamp;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  reasoningContent?: string;
  functionCall?: {
    name: string;
    arguments: string;
  };
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface ToolCall {
  id: ID;
  toolType: ToolType;
  method: string;
  params: Record<string, unknown>;
  timestamp: Timestamp;
}

export interface ToolResult {
  id: ID;
  toolCallId: ID;
  success: boolean;
  data?: unknown;
  error?: string;
  timestamp: Timestamp;
  hookEvents?: Array<Record<string, unknown>>;
  _meta?: {
    toolType: string;
    method: string;
    params: Record<string, unknown>;
    /** M4 §14.2：循环早终止标记（after_tool_call hook 经引擎透传；首版仅标记，消费方 M5+） */
    terminate?: boolean;
  };
  fallbackSuggestion?: {
    type: 'generate_location' | 'generate_npc' | 'generate_item' | 'generate_skill' | 'generate_quest' | 'discover_area' | 'create_entry';
    suggestedAction: string;
    context: Record<string, unknown>;
    promptHint: string;
  };
  writeOperation?: {
    toolType: string;
    method: string;
    params: Record<string, unknown>;
    result: unknown;
    timestamp: Timestamp;
  };
}

export interface AgentSchedule {
  id: ID;
  save_id: ID;
  agentType: AgentType;
  parentScheduleId?: ID;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: JSONValue;
  output?: JSONValue;
  error?: string;
  startTime?: Timestamp;
  endTime?: Timestamp;
  createdAt: Timestamp;
}

export interface Binding {
  id: ID;
  agent_id: AgentType;
  match_type: 'messageType' | 'context' | 'custom';
  match_value: string;
  context_condition?: Record<string, JSONValue>;
  priority: number;
  enabled: boolean;
  description: string;
}

export interface WriteOperation {
  toolType: ToolType;
  method: string;
  params: Record<string, unknown>;
  result: unknown;
  timestamp: Timestamp;
}

export interface DecisionLog {
  id: ID;
  save_id: ID;
  agentType: AgentType;
  decisionType: string;
  input: JSONValue;
  reasoning: string;
  output: JSONValue;
  confidence: number;
  timestamp: Timestamp;
}

export interface DialogueOption {
  id: string;
  text: string;
  nextTopic?: string;
  npcId: string;
}

export interface AgentUserContent {
  message: string;
  speaker?: string;
  options?: DialogueOption[];
  messages?: Array<Record<string, unknown>>;
}

/**
 * @deprecated 兼容旧的子 Agent 二次委派请求。
 * 优先使用 `TaskCenteredOutput.taskStatus.needsFollowUp`
 * 以及 `actions/results` 让 GM 自主决定后续调度。
 */
export interface NeedAgentRequest {
  agentType: AgentType;
  action: string;
  reason: 'generate' | 'correct' | 'coordinate';
  data: Record<string, unknown>;
}

/** 任务报告变更项 */
export interface TaskReportChange {
  type: string;
  name: string;
  id?: string;
  /** 更新类操作涉及的字段列表（仅 updated 项使用） */
  fields?: string[];
}

/** 子 Agent 任务报告（LLM 主动输出，程序兜底拼接） */
export interface TaskReport {
  /** 一句话任务总结 */
  summary: string;
  /** 数据变更清单 */
  changes: {
    created: TaskReportChange[];
    updated: TaskReportChange[];
    deleted: TaskReportChange[];
  };
  /** 关键决策说明（如为什么选择某方案、为什么偏离任务描述等） */
  keyDecisions?: string[];
  /** map 子 Agent 专属：起始地点 ID（lv3 具体位置） */
  startingLocationId?: string;
  /** map 子 Agent 专属：起始地点名称 */
  startingLocationName?: string;
}

/** 任务完成状态 */
export interface TaskStatus {
  completed: boolean;
  summary: string;
  failureReason?: string;
  needsFollowUp?: boolean;
  followUpDescription?: string;
  /** 子 Agent 结构化任务报告（LLM 主动输出，未输出时由程序兜底拼接） */
  taskReport?: TaskReport;
}

/** 工具调用操作记录 */
export interface ActionRecord {
  tool: string;
  method: string;
  params: Record<string, unknown>;
  result: 'success' | 'failure' | 'partial';
  timestamp: number;
  summary: string;
}

/** 实体引用 */
export interface EntityRef {
  type: string;
  id: string;
  name: string;
  keyFields: Record<string, unknown>;
}

/** 任务数据结果 */
export interface TaskResults {
  created: EntityRef[];
  updated: EntityRef[];
  deleted: EntityRef[];
  computed: Record<string, unknown>;
  custom: Record<string, unknown>;
}

/** Agent元数据 */
export interface AgentMeta {
  agentType: AgentType;
  englishId: string;
  action: string;
  intent: string;
  intentHint: string;
  iterations: number;
  success: boolean;
  parseFailed?: boolean;
  skillUsed?: string;
  rulesTriggered?: string[];
  tokenUsage?: { input: number; output: number };
}

/** 以任务为中心的Agent输出格式 */
export interface TaskCenteredOutput {
  taskStatus: TaskStatus;
  actions: ActionRecord[];
  results: TaskResults;
  content: AgentUserContent;
  panelUpdates?: PanelUpdates;
  _meta: AgentMeta;
  toStandardOutput(): StandardAgentOutput;
}

export interface StandardAgentOutput {
  content: AgentUserContent;
  data: Record<string, unknown>;
  panelUpdates?: PanelUpdates;
  /**
   * @deprecated 仅为兼容旧协调链路保留。
   * 新逻辑应读取 `TaskCenteredOutput.taskStatus.needsFollowUp`。
   */
  needAgents?: NeedAgentRequest[];
  _meta?: AgentMeta;
}

/** 游戏响应附加数据（从 backend/agents/types.ts 迁移，Phase 4 模块D 统一收敛） */
export interface GameResponseData {
  blocked?: boolean;
  category?: string;
  reason?: string;
  [key: string]: unknown;
}

/** Agent 统一响应结构（从 backend/agents/types.ts 迁移，Phase 4 模块D 统一收敛） */
export interface AgentResponse {
  success: boolean;
  data?: GameResponseData;
  error?: string;
  errorCode?: string;
  messages?: AgentMessage[];
  toolCalls?: ToolResult[];
  panelUpdates?: PanelUpdates;
}

// ==================== LLMRequestDispatcher 类型（M9 模块，方式 A 下沉） ====================
// 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §5.1
// 类型下沉策略（M2 修复）：LLMDispatchRequest/LLMDispatchResult/DispatcherMetricsSnapshot
// 全部下沉到 shared，backend 从 shared 引用。shared 完全自洽，backend 仅实现。

/**
 * Dispatcher 调度请求
 */
export interface LLMDispatchRequest {
  /** Provider ID（可选，未指定时使用默认 Provider） */
  providerId?: string;
  /** 模型（可选，未指定时使用 Provider 默认模型） */
  model?: string;
  /** LLM 消息数组 */
  messages: LLMMessage[];
  /** LLM 选项（temperature 等） */
  options?: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: 'json_object' | 'text' };
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
    loggingMetadata?: {
      stage?: string;
      prefixHash?: string;
      cacheStrategy?: string;
      reactIterations?: number;
      toolCallsCount?: number;
    };
  };
  /** 令牌桶等待超时（默认 30s） */
  timeoutMs?: number;
  /** 调用方标识（用于指标分类） */
  agentKey?: string;
  /** 存档 ID（用于 dev trace） */
  saveId?: ID;
}

/**
 * 错误类型枚举
 */
export type LLMDispatchErrorType =
  | 'rate_limited'        // 429 触发，所有 key 都冷静期
  | 'auth_failed'         // 401/403，所有 key 都 failed
  | 'timeout'             // 令牌等待超时
  | 'no_available_key'    // 无可用 key
  | 'provider_error';     // 5xx/timeout/network

/**
 * Dispatcher 调度结果
 */
export interface LLMDispatchResult {
  success: boolean;
  response?: {
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
  };
  error?: {
    type: LLMDispatchErrorType;
    message: string;
    retryable: boolean;
    lastUsedKeyIndex?: number;
  };
  metrics: {
    selectedKeyIndex: number;
    waitMs: number;
    attemptCount: number;
    cooldownTriggered: boolean;
  };
}

/**
 * per-key 指标快照
 */
export interface PerKeyMetrics {
  keyIndex: number;
  label: string;
  availableTokens: number;
  activeRequests: number;
  isInCooldown: boolean;
  cooldownEndsAt: number | null;
  isFailed: boolean;
  consecutive429: number;
  totalUsed: number;
  total429: number;
}

/**
 * Provider 维度指标快照
 */
export interface DispatcherMetricsSnapshot {
  providerId: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  rateLimitedCount: number;
  authFailedCount: number;
  avgWaitMs: number;
  avgAttemptCount: number;
  perKeyMetrics: PerKeyMetrics[];
}

/**
 * 流式调用事件类型
 *
 * 用于 dispatchStream 方法的返回 AsyncIterable 元素类型。
 */
export interface LLMDispatchStreamEvent {
  /** 事件类型：delta（增量 token）/ done（完成）/ error（错误） */
  type: 'delta' | 'done' | 'error';
  /** delta 文本（type='delta' 时填充） */
  delta?: string;
  /** 完整响应（type='done' 时填充） */
  response?: LLMDispatchResult['response'];
  /** 错误信息（type='error' 时填充） */
  error?: { type: LLMDispatchErrorType; message: string; retryable: boolean };
}

/**
 * LLMRequestDispatcher 端口接口（唯一权威定义）
 *
 * M2 修复：本接口仅在此处定义一次。backend 通过
 * `import type { ILLMRequestDispatcher } from '@ai-rpg/shared/types/agent'` 引用，
 * 避免重复定义导致的不一致。
 */
export interface ILLMRequestDispatcher {
  /** 调度 LLM 请求（非流式） */
  dispatch(request: LLMDispatchRequest): Promise<LLMDispatchResult>;
  /**
   * 调度 LLM 请求（流式）
   *
   * 用于 ReActLoop 等需要流式输出的场景。Dispatcher 内部仍走 chatWithKey，
   * 但通过 LLMService.streamWithKey 暴露流式入口。
   */
  dispatchStream(request: LLMDispatchRequest): Promise<AsyncIterable<LLMDispatchStreamEvent>>;
  /** 获取 Provider 维度指标 */
  getMetrics(providerId: string): DispatcherMetricsSnapshot;
  /** 手动重置 key 冷静期（调试用） */
  resetCooldown(providerId: string, keyIndex: number): void;
  /**
   * 初始化：启动时调用一次，全量同步 trackers 作为"配置变更未触发事件"的兜底。
   */
  initialize(): Promise<void>;
  /**
   * 销毁：清理 tracker 定时器、debounce 定时器、取消事件订阅。
   * 在 init.ts 的 SIGTERM/SIGINT shutdown hook 中调用。
   */
  destroy(): void;
}
