import type { ID } from './core';

/**
 * 审核请求 - 无状态审核Agent的输入契约。
 * 每次调用独立，不持有运行时状态。
 */
export interface AuditRequest {
  taskId: ID;
  taskContract: TaskContract;
  actualOutput: SubAgentResult;
  auditMode: 'program' | 'llm' | 'both';
  auditScope?: AuditDimension[];
}

/**
 * 任务契约 - 期望值定义。
 * expected.names 仅 ProgramChecker 用，LLMChecker 不接收（Q-4 输入隔离）。
 */
export interface TaskContract {
  description: string;
  action?: string;
  /** GM 显式指定审核模式，覆盖 resolveAuditPolicy 默认值。创造性任务（map/npc/quest）设为 'both' 强制 LLM 审 */
  audit_mode?: 'program' | 'llm' | 'both';
  expected?: {
    counts?: Record<string, number>;
    quality?: string[];
    states?: Record<string, boolean>;
    names?: string[];
  };
}

/**
 * 完整任务内容 - 含 Agent 标识，用于 on_task_complete hook 审核去重和报告回传。
 *
 * 与 TaskContract 区别：TaskContent 必带 agentType/agentRunId，action 必填。
 * 所有 Agent 在 ReAct loop 启动时构建 TaskContent 注入 ReActLoopContext。
 */
export interface TaskContent {
  description: string;
  action: string;
  expected?: TaskContract['expected'];
  /** Agent 类型：'GM' | 'NPC' | 'Quest' | 'Map' | ... */
  agentType: string;
  /** 来自 ExecutionTraceIds.agentRunId，用于审核去重 auditKey */
  agentRunId: string;
  /** GM 覆盖审核模式，优先于 resolveAuditPolicy */
  auditMode?: TaskContract['audit_mode'];
}

/**
 * 子Agent实际输出 - 审核对象。
 */
export interface SubAgentResult {
  taskId: ID;
  agentType: string;
  output: string;
  toolCalls?: Array<{ tool: string; method: string; params: Record<string, unknown>; result: unknown }>;
  success: boolean;
  error?: string;
}

/**
 * 审核结果 - 无状态审核Agent的输出契约。
 */
export interface AuditResult {
  pass: boolean;
  failures: AuditFailure[];
  rootCause?: AuditRootCause;
  repairSuggestion?: string;
  confidence: number;
}

/**
 * 审核问题项 - AuditFailure 的报告友好包装。
 *
 * severity 仅用于报告展示，不驱动 loop 终止决策（loop 只看 issues.length）。
 */
export interface AuditIssue {
  /** 问题唯一 ID（uuid） */
  issueId: string;
  /** 审核维度（复用现有 AuditDimension） */
  dimension: AuditDimension;
  /** 严重级别，仅用于报告展示 */
  severity: 'error' | 'warning';
  /** 受影响实体，如 "locations" / "node:黑森林" */
  entity: string;
  /** 问题描述 */
  description: string;
  /** 证据（可选） */
  evidence?: string;
  /** 建议修复（可选） */
  suggestedFix?: string;
}

/**
 * 审核报告 - AuditResult 的超集，含任务上下文 + 去重元数据。
 *
 * 由 on_task_complete hook 回调包装 AuditResult 生成，通过 patch 注入到 ReActLoopContext。
 * loop 主体只读 issues.length 决定 continue/return，不读 severity。
 */
export interface AuditReport {
  /** 报告唯一 ID（uuid） */
  reportId: string;
  /** Agent 运行 ID（来自 ExecutionTraceIds.agentRunId） */
  agentRunId: string;
  /** 存档 ID */
  saveId: string;
  /** 报告生成时间戳 */
  timestamp: number;

  /** 任务上下文（回传给 Agent，让 Agent 知道"哪个任务被审了"） */
  taskContent: TaskContent;

  /** 审核问题列表（空数组表示通过） */
  issues: AuditIssue[];
  /** 人类可读摘要 */
  summary: string;

  /**
   * 当前已存在实体清单（14.3 第3条：current_state 必须提供）。
   *
   * 让 Agent 知道哪些数据已存在，引导使用 update_xxx 修改而非 create_xxx 重新创建。
   * 由 AuditAgent.auditForReport 从 toolCalls 中提取已创建/已更新的实体名称列表。
   * 格式：`["地点 '白杨村'", "NPC '村长'", "技能 '剑术'"]`
   */
  currentState?: string[];

  /** 去重 key：`${agentRunId}::${taskContent.description}` */
  auditKey: string;
  /** 审核轮次，永远是 1（仅一轮，auditKey 去重保证） */
  auditRound: 1;

  /** 原始 AuditResult 字段（保留用于 reconcile 兜底分析） */
  rootCause?: AuditRootCause;
  repairSuggestion?: string;
  confidence: number;
}

/**
 * 审核失败项。
 *
 * 006 升级新增 `suggestedFix?` 可选字段（设计文档 §14.3 第1条：suggestedFix 必须填充）。
 *   - LLMChecker（如 DialogueConsistencyChecker）可直接在 failure 中填充具体修复建议
 *   - AuditAgent.wrapFailures 优先使用 failure 自带的 suggestedFix，无则按 dimension 生成
 *   - 与 AuditIssue.suggestedFix 对齐，避免双轨结构
 */
export interface AuditFailure {
  dimension: AuditDimension;
  expected: unknown;
  actual: unknown;
  reason: string;
  severity: 'error' | 'warning';
  /** 修复建议（可选，LLMChecker 可直接填充；缺失时由 AuditAgent.wrapFailures 按 dimension 生成） */
  suggestedFix?: string;
}

/**
 * 审核维度 - [A]5维度 + [D]6维度 + [C]3维度 + [E]LLM终审。
 *
 * 006 升级新增 `'dialogue_consistency'`：DialogueConsistencyChecker 专用维度，
 * 审核对话内容与 awareness 数据一致性（如老汤姆场景"听村长说"与 awareness 数据矛盾）。
 */
export type AuditDimension =
  | 'entity_names' | 'entity_counts' | 'entity_types' | 'key_fields' | 'omission'
  | 'npc_location' | 'item_ownership' | 'numeric_range' | 'timeline' | 'fk_reference' | 'pacing'
  | 'graph_consistency' | 'info_boundary' | 'orphan_node'
  | 'content_quality'
  | 'dialogue_consistency';

/**
 * 失败根因分类 - 指导修复方向，避免无脑二次派发。
 *
 * - context_injection_error：manifest 注入数据缺失/错误
 * - llm_understanding_error：LLM 偏离 taskContract（content_quality 维度）
 * - data_missing：存档池数据缺失
 * - tool_execution_failure：工具调用失败
 *
 * 模块5 简化：删除 graph_structure_issue（图结构问题由程序全权派生维护，不再由 LLM 审核）
 */
export type AuditRootCause =
  | 'context_injection_error'
  | 'llm_understanding_error'
  | 'data_missing'
  | 'tool_execution_failure';

/**
 * LLM 审核专用的请求类型（Q-4 输入隔离：类型层面剥离 expected.names）。
 * 编译期守门：LLMChecker 只接收此类型，不接收完整 AuditRequest。
 * 避免 LLM "想大象"——不把期望的具体名称泄露给 LLM。
 */
export interface AuditRequestForLLM {
  taskId: ID;
  taskContract: Omit<TaskContract, 'expected'> & {
    expected?: Omit<NonNullable<TaskContract['expected']>, 'names'>;
  };
  actualOutput: SubAgentResult;
  auditScope?: AuditDimension[];
}

/**
 * 审核范围（AuditScope 的简化，复用 AuditDimension 数组）。
 */
export type AuditScope = AuditDimension[];
