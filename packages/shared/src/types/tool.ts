/**
 * 工具核心类型定义（Phase 4 模块D 统一收敛）
 *
 * 本文件是工具系统所有公共类型契约的唯一数据源，收敛来源：
 * - 原 shared/src/tool-core/types.ts（20+ 类型，已删除）
 * - 原 backend/src/types/tool.ts（中转层，已删除）
 * - 原 backend/src/agents/types.ts 中的 GameResponseData/AgentResponse/ActionHandler（迁移到 shared/types/agent.ts + 本文件）
 *
 * 设计文档：docs/design/fractal-design-20260626-backend-decoupling-refactor/...模块D-去冗余与深度模块化.md §6
 */

import type { Knex } from 'knex';
import type { ID, Timestamp } from './core.js';
import type { ToolType } from './agent.js';
import type { ExecutionTraceIds } from './execution-trace.js';
import type { ProgressContext } from './progress.js';
import type {
  IStagingPool,
  IShadowStateLayer,
  IWriteQueue,
  IAgentRuntimeSnapshot,
} from '../tool-core/port-interfaces.js';
import type { BaseTool } from '../tool-core/BaseTool.js';
import type { ToolProgressCallback } from '../tool-core/tool-progress.js';
import type { ToolAbortSignal } from '../tool-core/abort-signal.js';

/** 冲突处理配置（从 backend/services/StagingPool.ts 迁移，纯数据结构） */
export interface OnConflictConfig {
  columns: string[];
  action: 'merge' | 'ignore';
}

/** 暂存写入记录（从 backend/services/StagingPool.ts 迁移，纯数据结构） */
export interface StagedWrite {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete' | 'upsert';
  data: Record<string, unknown>;
  where?: Record<string, unknown>;
  onConflict?: OnConflictConfig;
  capturedSql?: string;
  capturedBindings?: unknown[];
  toolType: string;
  method: string;
  source: 'gamemaster' | 'subagent';
  subAgentType?: string;
  derivedFrom?: string;
  timestamp: number;
}

/** 已注入方法状态（从 backend/types/tool.ts 迁移） */
export interface InjectedMethodState {
  source: string;
  method: string;
  level?: 'summary' | 'detail';
}

/**
 * 批量执行配置。
 *
 * 启用后 BaseTool 会在 `executeBatch` 中拆分数组参数，对每个 item 逐个调用 handler，
 * handler 每次只收到 1 个 item 的字段平铺到顶层（通过 `buildSingleParams` 转换），
 * 而非完整数组。设计意图是让 LLM 用一次工具调用表达批量意图，handler 复用单条逻辑。
 *
 * **handler 契约**：必须访问 item 中的字段（平铺到 `params` 顶层，如 `params.npcId`、
 * `params.name`），**禁止**访问 `params[param]` 原数组（已被 `buildSingleParams` 移除，
 * 值为 `undefined`，会导致 `Cannot read properties of undefined` 错误）。
 *
 * **设计反例**（v1.2 实测发现）：`batch_mark_initialized` 配置 `batch: { param: 'updates' }`
 * 后，handler 仍访问 `params.updates as NpcInitUpdate[]`——`params.updates` 已被移除，
 * 值为 `undefined`，导致 100% 失败。正确做法参考 `update_npc`（NPCServiceTool.ts:700-731）
 * 直接访问 `params.name` / `params.description` / `params.npcId` 等顶层字段。
 *
 * **不适用场景**：handler 需要 1 次性收完整数组在事务内原子化批量操作时（如
 * `batch_mark_initialized` 的设计意图），**不要**配置 `batch`，让 handler 直接收
 * `params[param]` 数组，内部用 `txManager.transaction` 包裹所有操作即可（参考
 * `batch_check_init_status` 不配置 `batch`，handler 直接收 `params.npcIds`）。
 */
export interface BatchConfig {
  /**
   * 主参数名（必须是 LLM 入参中的数组字段），如 `'skills'` / `'updates'` / `'npcs'`。
   *
   * BaseTool 会从 `params[param]` 取出数组，对每个 item 调用 `buildSingleParams`
   * 转换后传给 handler。handler 内部访问的是 item 平铺后的顶层字段，
   * **不能**再访问 `params[param]` 本身。
   */
  param: string;
  /**
   * 批量执行模式：
   * - `sequential`（默认）：顺序执行，前一项失败不影响后续项，结果聚合 success/failure
   * - `parallel`：并行执行（注：staging 模式下强制顺序，避免事务冲突）
   */
  mode?: 'sequential' | 'parallel';
  /**
   * 批量上限，默认 20。超出时 BaseTool 返回
   * `{success: false, error: "批量参数 'xxx' 超过上限 20，当前 N 项"}`。
   * 用于防止 LLM 一次传入过多 item 导致工具调用超时或资源耗尽。
   */
  maxItems?: number;
}

/** 回退建议（从 backend/types/tool.ts 迁移） */
export interface FallbackSuggestion {
  type: 'generate_location' | 'generate_npc' | 'generate_item' | 'generate_skill' | 'generate_quest' | 'discover_area' | 'create_entry';
  suggestedAction: string;
  context: Record<string, unknown>;
  promptHint: string;
}

/** 工具响应（从 backend/types/tool.ts 迁移，完整字段） */
export interface ToolResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  /**
   * v1.6: 取消标记（M6）。true 时 success=false 且 error 为取消文案，
   * G 层/ReActLoop 据此区分"失败"与"取消"。aborted 响应不携带 writeOperation。
   */
  aborted?: boolean;
  writeOperation?: {
    toolType: ToolType;
    method: string;
    params: Record<string, unknown>;
    result: unknown;
    timestamp: Timestamp;
    /** 批量执行时的子操作记录 */
    batchOperations?: Array<{
      toolType: ToolType;
      method: string;
      params: Record<string, unknown>;
      result: unknown;
      timestamp: Timestamp;
    }>;
  };
  fallbackSuggestion?: FallbackSuggestion;
}

/** 批量项结果（从 backend/types/tool.ts 迁移） */
export interface BatchItemResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** 方法处理函数 */
export type MethodHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResponse>;

/**
 * 工具方法定义（从 backend/types/tool.ts 迁移）
 *
 * BaseTool.registerMethod 接受此配置，handler 通过 ToolContext 执行。
 */
export interface ToolMethod {
  name: string;
  description: string;
  summary?: string;
  parameters: Record<string, unknown>;
  isWrite: boolean;
  /** 只读方法默认可缓存；依赖运行时上下文或带有副作用的只读方法应显式关闭缓存。 */
  cacheable?: boolean;
  handler: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResponse>;
  /**
   * 启用批量执行模式。
   *
   * 配置后 BaseTool 在 `executeBatch` 中拆分数组，对每个 item 逐个调用 handler，
   * handler 每次只收到 1 个 item 的字段平铺到顶层。**禁止**在 handler 内访问
   * `params[batch.param]` 原数组（已被 `buildSingleParams` 移除）。
   *
   * 详见 `BatchConfig` 的完整契约说明。
   *
   * **设计选择**：
   * - handler 复用单条逻辑 → 配置 `batch`，handler 访问顶层字段
   * - handler 需要 1 次性收完整数组（如事务内原子化批量操作）→ **不**配置 `batch`，
   *   handler 直接收 `params[param]` 数组，内部用事务包裹
   */
  batch?: BatchConfig;
  returns?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** 工具定义（从 backend/types/tool.ts 迁移） */
export interface ToolDefinition {
  type: ToolType;
  name: string;
  description: string;
  summary?: string;
  version: string;
  methods: ToolMethod[];
}

/** 工具权限（从 backend/types/tool.ts 迁移） */
export interface ToolPermission {
  toolType: ToolType;
  agentType: string;
  readAllowed: boolean;
  writeAllowed: boolean;
}

/**
 * 工具上下文（v1.3 修订：完整 18 字段 + 端口接口抽象）
 *
 * v1.2 仅定义 4 字段 + `[key: string]: unknown` 兜底，会破坏 17 个 ServiceTool
 * 的 handler 实现（直接访问 context.stagingPool.stage() 等方法）。
 * v1.3 保留完整字段，4 个 backend 专有类型改为 port-interfaces.ts 的接口。
 * v1.4 新增 IRequestScope 端口接口 + ToolContext.requestScope 必填字段（架构债务治理）。
 * v1.5 移除 db: Knex 字段（D4 决策），工具层通过 requestScope.getDb() 获取 db。
 * v1.6 新增 onUpdate/abortSignal 可选字段（M6 工具层扩展：进度上报 + 协作式取消）。
 */
export interface ToolContext {
  saveId: ID;
  agentType: string;
  timestamp: Timestamp;
  // 以下 4 个字段类型改为端口接口（v1.3 修订，避免 shared→backend 类型传染）
  writeQueue?: IWriteQueue;
  stagingPool?: IStagingPool;
  shadowState?: IShadowStateLayer;
  runtimeSnapshot?: IAgentRuntimeSnapshot;
  // 以下字段保持不变（来自 backend/src/types/tool.ts 实际定义）
  toolType?: string;
  methodName?: string;
  agentSource?: 'gamemaster' | 'subagent';
  subAgentType?: string;
  /** H1: 当前 Agent 被授权使用的工具类型列表，用于权限过滤 */
  agentTools?: string[];
  /** 当前存档所属的模板ID，从 saves.template_id 解析，通过 context 传递，不暴露给 LLM */
  templateId?: string;
  /** 当前请求的意图提示，用于 hooked 规则的匹配过滤 */
  intentHint?: string;
  /** 当前轮次的故事指令，用于传递给子Agent */
  storyDirective?: unknown;
  /** 当前请求内已注入的上下文方法，防止同一请求内重复注入 */
  injectedMethods?: InjectedMethodState[];
  /** 当前轮次的工具暴露预算使用态，用于按需帮助加载限流 */
  toolExposureState?: {
    maxOnDemandLoadsPerTurn: number;
    usedOnDemandLoads: number;
  };
  /** 当预算使用态变化后，同步刷新运行时快照观测 */
  syncToolExposureState?: (state: {
    maxOnDemandLoadsPerTurn: number;
    usedOnDemandLoads: number;
  }) => void;
  /** 当前请求的执行追踪主键，用于子Agent关联parentAgentRunId */
  traceIds?: Partial<ExecutionTraceIds>;
  /** v2 新增：当前请求的进度上下文，用于 coordinator-service 注入子Agent 的 metadata */
  progressContext?: ProgressContext;
  /**
   * 请求级 Service 缓存管理器（必填，v1.4 架构债务治理）。
   * 单次请求内共享 Service 实例，避免跨领域 ServiceTool 级联创建重复实例。
   * 类型为 IRequestScope 端口接口，避免 shared → backend 类型依赖。
   */
  requestScope: IRequestScope;
  /**
   * v1.6: 进度回调（可选，M6）。长耗时 handler 经 context.onUpdate?.() 上报中间进度，
   * 由 G 层桥接进 report_progress 链路到前端进度树。未接线时为 undefined，
   * handler 必须用可选链调用（未接线零开销）。
   */
  onUpdate?: ToolProgressCallback;
  /**
   * v1.6: 取消信号（可选，M6）。handler 在循环/批处理检查点经 throwIfAborted 协作式取消。
   * 由 G 层请求级 AbortController 注入，非取消感知入口缺省为 undefined。
   */
  abortSignal?: ToolAbortSignal;
}

/**
 * 请求级 Service 缓存管理器端口接口（v1.4 架构债务治理）。
 * shared 包只定义接口，backend 包 RequestScope 类实现该接口。
 * 避免 shared → backend 类型依赖（code-standards §4 模块边界明确）。
 */
export interface IRequestScope {
  /**
   * 获取或计算请求级 Service 实例。
   * 首次调用执行 factory 并缓存 Promise，后续调用直接返回缓存的 Promise。
   * 并发安全：Promise 缓存避免并发重复创建。
   */
  getOrCompute<T>(
    key: string,
    factory: () => Promise<T>,
  ): Promise<T>;

  /**
   * 获取请求级 Knex 实例（AgentRuntime 创建 RequestScope 时注入）。
   * 工具层通过此方法获取 db，用于创建 Repository 实例（D8 决策）。
   */
  getDb(): Knex;
}

/** 权限检查结果 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/** 参数描述符 */
export interface ParameterDescriptor {
  type: string;
  description?: string;
  required?: boolean;
  [key: string]: unknown;
}

/** 方法描述符 */
export interface MethodDescriptor {
  name: string;
  description: string;
  parameters: Record<string, ParameterDescriptor>;
  required?: string[];
}

/** 方法权限 */
export interface MethodPermission {
  readAllowed: boolean;
  writeAllowed: boolean;
}

/** 工具描述符 */
export interface ToolDescriptor {
  toolType: string;
  name: string;
  description: string;
  methods: MethodDescriptor[];
  permissions?: Record<string, MethodPermission>;
}

/** 工具接口（工具自身实现，区别于模块B的 ToolCaller） */
export interface Tool {
  readonly descriptor: ToolDescriptor;
  registerMethod(name: string, handler: MethodHandler): void;
  handleCall(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResponse>;
  checkPermission(agentType: string, method: string): PermissionCheckResult;
}

/**
 * ActionHandler（v1.3 新增：从 backend/src/agents/types.ts 迁移）
 *
 * 结构简单（仅依赖 string/number/Record），无 backend 专有依赖，可安全迁移。
 */
export interface ActionHandler {
  action: string;
  method: string;
  paramMapping?: Record<string, string>;
  priority: number;
  description?: string;
}

/**
 * StagingKnex 上下文（从 backend/services/StagingKnex.ts 迁移）
 *
 * createStagingKnex 接受此上下文，端口接口替代具体类。
 */
export interface StagingKnexContext {
  stagingPool: IStagingPool;
  shadowState: IShadowStateLayer;
  toolType: string;
  method: string;
  source: 'gamemaster' | 'subagent';
  subAgentType?: string;
}

/**
 * ToolRegistry 端口接口：仅暴露消费方实际使用的方法。
 *
 * 消费方：
 * - services/ws-template-handler.ts（violation #19）：pool:generate-options case 中 getTool('generate_options')
 * - game-systems/batch/BatchQueryServiceTool.ts（violation #2）：batch query 中 getTool(source)
 *
 * 实现：backend/src/agents/ToolRegistry.ts（结构类型匹配，不显式 implements，与项目 IMapService/INPCService 模式一致）
 * 注入：
 * - ws-template-handler 通过 GameHandlerContext.toolRegistry 传递（ctx 是依赖载体）
 * - BatchQueryServiceTool 通过 setter 注入（与 GenerateOptionsTool.setDependencies 模式一致）
 *
 * 设计文档：docs/design/fractal-design-20260626-backend-decoupling-refactor/...模块C-严格分层解耦.md §3.10
 */
export interface IToolRegistry {
  /** 按工具类型获取工具实例（BatchQueryServiceTool + ws-template-handler 使用） */
  getTool(type: ToolType): BaseTool | undefined;
}
