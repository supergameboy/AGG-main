/**
 * 统一进度回传共享类型
 * 替代旧的 agent_thinking/agent_tool_call/agent_observation/agent_final_answer/agent_error/agent_started/init_progress/react_progress
 */

/** 进度事件阶段 — 描述 Agent 当前在做什么 */
export type ProgressPhase =
  | 'task_start'
  | 'task_end'
  | 'tool_call'
  | 'tool_result'
  | 'thinking'
  | 'iteration'
  | 'sub_agent_start'
  | 'sub_agent_end'
  | 'error';

/** 统一进度事件载荷 */
export interface ProgressEvent {
  phase: ProgressPhase;
  /** Agent 类型（englishId），如 'gamemaster', 'skill', 'map' */
  agentType: string;
  /** 本次 Agent 运行的唯一 ID（nodeId 唯一来源，D8 决策），格式 "{agentKey}:{uuid}" */
  agentRunId: string;
  /** 任务描述（GM 为 intentHint 原始值，子Agent 为 spawn_agent 的 task 参数），用于 nodeId 构建，不翻译 */
  taskDescription: string;
  /** 父任务标识，格式 "task:{agentRunId}"，根任务为 null */
  parentTask: string | null;
  /** 阶段附加数据 */
  detail?: ProgressDetail;
  timestamp: number;
}

/**
 * 构建任务节点ID：task:{agentRunId}
 * D8 决策：移除 taskIndex 机制，nodeId 唯一性由 agentRunId 保证
 */
export function buildTaskNodeId(agentRunId: string): string {
  return `task:${agentRunId}`;
}

/**
 * 请求级不可变进度上下文（v2 核心）
 *
 * 在 processMessage 入口一次性创建，整个请求生命周期不可变。
 * 替代 ReActAgent 上的 5 个可变实例字段：
 *   currentRequestId → ProgressContext.requestId
 *   currentAgentRunId → ProgressContext.agentRunId
 *   currentTaskDescription → ProgressContext.taskDescription
 *   currentParentTask → ProgressContext.parentTask
 *   currentTaskIndex → 删除（D8 决策，nodeId 改用 agentRunId）
 *
 * 新增 broadcastClientId：WS 广播目标，统一游戏流和模板编辑器的传输路径。
 */
export interface ProgressContext {
  /** WS 请求的 requestId（来自客户端），用于前端事件关联 */
  requestId: string;
  /** 本次 Agent 运行的唯一 ID（nodeId 唯一来源，D8 决策） */
  agentRunId: string;
  /** 任务描述（intentHint 原始值 或 子Agent task 参数） */
  taskDescription: string;
  /** 父任务标识，格式 "task:{父agentRunId}"，根任务为 null */
  parentTask: string | null;
  /** WS 广播目标 clientId。所有进度事件统一通过 broadcastToClient(clientId, ...) 发送 */
  broadcastClientId: string;
}

/** 阶段附加数据 — 按 phase 区分 */
export type ProgressDetail =
  | ToolCallDetail
  | ToolResultDetail
  | ThinkingDetail
  | IterationDetail
  | SubAgentDetail
  | TaskEndDetail
  | ErrorDetail
  | Record<string, unknown>;

export interface ToolCallDetail {
  toolName: string;
  args?: Record<string, unknown>;
}

export interface ToolResultDetail {
  toolName: string;
  success: boolean;
  summary?: string;
}

export interface ThinkingDetail {
  thought?: string;
}

export interface IterationDetail {
  iteration: number;
  maxIterations: number;
}

export interface SubAgentDetail {
  subAgentType: string;
  subTaskDescription: string;
}

export interface TaskEndDetail {
  success: boolean;
  /** 致命错误标记：true 表示此错误导致整个初始化/任务无法继续 */
  fatal?: boolean;
  summary?: string;
  durationMs?: number;
}

export interface ErrorDetail {
  error: string;
  errorType?: string;
  /** 是否可恢复：true=可恢复继续，false=致命需中止 */
  recoverable?: boolean;
}

/** WS 事件类型名 */
export const PROGRESS_EVENT_TYPE = 'agent_progress' as const;
