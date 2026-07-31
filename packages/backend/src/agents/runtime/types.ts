/**
 * runtime/ 模块接口集中定义（M3：AgentRuntime 6 模块拆分）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M3-AgentRuntime拆分.md
 *   §8.2 HookDispatcher / §9.2 MemoryController / §10.2 ToolExecutor
 *   §11.2 ContextManager / §12.2 RecoveryCoordinator
 *
 * 约束（§13.1 依赖规则）：
 * - 本文件仅含类型（type-only import，编译时擦除，零运行时依赖）
 * - 模块实现文件 import 本文件接口；模块间禁止直接 import 具体类
 * - BaseAgent 仅以 type import 出现（agentInstancesProvider 签名用）
 */

import type { ID } from '../../../../shared/src/types/core.js';
import type { AgentType, AgentContext, LLMMessage } from '../../../../shared/src/types/agent.js';
import type { AgentHookPoliciesConfig } from '../../../../shared/src/types/agent-config.js';
import type { RuntimeEvent, ExecutionTraceIds } from '../../../../shared/src/types/execution-trace.js';
import type { ProgressPhase, ProgressDetail } from '@ai-rpg/shared';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import type { IContextProvider } from '../../game-systems/shared/types.js';
import type { INPCService } from '../../game-systems/npc/types.js';
import type { DatabaseWriteQueue } from '../../services/DatabaseWriteQueue.js';
import type { ContextCompressor } from '../../services/context-compressor.js';
import type { ContextFlushQueue } from '../../services/context-flush-queue.js';
import type { BaseAgent } from '../BaseAgent.js';
import type { ToolRegistry } from '../ToolRegistry.js';
import type {
  ReActEngineContext,
  ReActEngineHooks,
  ReActEngineResult,
  CallToolFn,
} from '../ReActEngine.js';
import type { ReActLoopDeps, RequestContext } from '../ReActLoop.js';
import type { SemanticContextCompressor } from '../memory/semantic-context-compressor.js';
import type { EpisodicMemoryService } from '../memory/episodic-memory-service.js';
import type { ProceduralMemoryService } from '../memory/procedural-memory-service.js';
import type { PromptBuildBudgetGuard } from '../memory/prompt-budget-guard.js';
import type { AgentHook, AgentHookContext, AgentHookName, AgentHookResult } from './agent-hooks.js';
import type { AgentRequestPath, HookPlacementEntry } from './hook-placement-config.js';
import type { AgentRuntimeSnapshot } from './agent-runtime-snapshot.js';
import type { AuditReport } from '../../../../shared/src/types/audit.js';
import type { OnTaskCompletePayload } from './audit-hook.js';
import type { AgentRuntimeState } from './agent-runtime-state.js';
import type { RecoveryPlanner } from './recovery-planner.js';

// ─── HookDispatcher（§8.2） ───

export interface HookDispatchArgs {
  requestId: string;
  agentRunId: string;
  payload?: Record<string, unknown>;
  toolCallId?: string;
  /**
   * 4 维度放置上下文（M4 §8.3，可选）。
   * 缺省时 dispatch 走现状默认链（渐进迁移路径）；提供时经 placementResolver
   * 解析 4 维度匹配链并拼接在默认链之后执行。
   */
  placement?: HookPlacementContext;
}

export interface HookDispatcherDeps {
  agentKey: string;
  /** report_progress payload 的 agentType 字段（facade 计算：agentConfig.englishId || agentKey） */
  agentTypeLabel: string;
  webSocketService: IWebSocketBroadcaster;
  /** 快照提供者（D3.3：构造注入，禁止反向依赖 facade） */
  snapshotProvider: () => Readonly<AgentRuntimeSnapshot> | null;
  /** 状态只读视图（recovery.attempts 用作 iteration 字段；progressContext 注入快照） */
  stateReader: Readonly<AgentRuntimeState>;
  /** 种子快照字段工厂（facade 提供 model/permission/language 等配置字段） */
  seedSnapshotFactory: () => HookSeedSnapshotFields;
  hookPolicies: AgentHookPoliciesConfig | undefined;
  /** on_task_complete hook 工厂依赖（resetRuntime 时注册审核 hook） */
  onTaskCompleteHook: AgentHook;
  /** M4：4 维度放置解析器；缺省时 dispatch 走现状默认链（渐进迁移路径，§8.3） */
  placementResolver?: IHookPlacementResolver;
}

export interface HookSeedSnapshotFields {
  saveId: ID | undefined;
  providerId: string | null;
  model: string | null;
  temperature: number;
  maxTokens: number;
  configuredTools: string[];
  systemPrompt: string;
  language: string | null;
  templateId: string | null;
}

// ─── M4：类型化 Hook patch/payload 映射（模块M4设计 §6.1/§6.2/§6.4） ───

/** Hook 事件名：M4 词汇表别名（= AgentHookName；M3 既有命名保持不动） */
export type HookEventName = AgentHookName;

// 各 patch 一律用 type 别名而非 interface：对象字面量类型自带隐式索引签名，
// 保持对既有 AgentHookResult<Record<string, unknown>> 消费方（AgentRuntime.dispatchHook、
// ReActLoopDeps）的赋值兼容；interface 无隐式索引签名，会断裂 M3 调用链。

/** before_model_select：模型选择覆盖（现状 HookModelOverride 收敛，§6.2） */
export type ModelSelectPatch = {
  providerId?: string | null;
  model?: string | null;
  temperature?: number;
  maxTokens?: number;
};

/** before_prompt_build：prompt 上下文覆盖 */
export type PromptBuildPatch = {
  promptContext?: Record<string, unknown>;
  injectedContext?: string | null;
  systemPromptOverride?: string;
};

/** before_tool_expose：工具可见性覆盖（allowedFunctionNames 为替换语义：数组合并易越权，§8.4） */
export type ToolExposePatch = {
  allowedFunctionNames?: string[];
  excludedMethods?: Array<{ source: string; method: string }>;
};

/** before_tool_call：参数级 patch（整体替换语义，§7.5：参数是 LLM 完整决策，部分覆盖会产生语义不明的混合参数） */
export type BeforeToolCallPatch = {
  normalizedArguments?: Record<string, unknown>;
};

/** after_tool_call：字段级覆盖（M4 G2 核心；应用语义见 tool-result-merge.ts，§7.2） */
export type AfterToolCallPatch = {
  /** 整体替换 data（与 dataMerge 同现时 dataMerge 先应用、data 后覆盖） */
  data?: unknown;
  /** 浅合并一层进 data（目标非 plain object 时忽略并 warn） */
  dataMerge?: Record<string, unknown>;
  /** 覆盖 error（空字符串 = 清除错误） */
  error?: string;
  /** 翻转错误标记：映射 success = !isError（与 error 字段独立，§2.3 场景B） */
  isError?: boolean;
  /** 追加 warnings 到 data.warnings（数组 concat） */
  appendWarnings?: string[];
  /** 循环早终止提示（对齐 pi terminate；不写入 result，由引擎消费） */
  terminate?: boolean;
  /** @deprecated 整对象 result patch（过渡兼容；与新字段同现时在最先浅合并为基底，§7.2 步骤1） */
  result?: Record<string, unknown>;
};

/** before/after_compaction：压缩干预 */
export type CompactionPatch = {
  skip?: boolean;
  strategy?: 'semantic' | 'truncation';
  status?: 'ok' | 'failed';
};

/** after_agent_fail：恢复决策输入（现状 recovery 字段类型化） */
export type RecoveryPatch = {
  recovery?: {
    reason: string;
    suggestedAction?: string;
  };
};

/** report_progress 不允许 patch（仅 emittedEvents 副作用）——Record<string, never> 在类型层面封堵误用 */
export type ReportProgressPatch = Record<string, never>;

/** on_task_complete：审核报告（audit-hook.ts 现状定义的收敛版——去掉 [key: string]: unknown 索引签名逃逸舱，§6.2） */
export type OnTaskCompletePatch = {
  auditReport?: AuditReport | null;
  auditSkipped?: boolean;
};

/** 各 hook 的 patch 类型映射（D4.1：单一映射表，一个概念只表达一次；新增 hook 名只需加一行） */
export interface HookPatchMap {
  before_model_select: ModelSelectPatch;
  before_prompt_build: PromptBuildPatch;
  before_tool_expose: ToolExposePatch;
  before_tool_call: BeforeToolCallPatch;
  after_tool_call: AfterToolCallPatch;
  before_compaction: CompactionPatch;
  after_compaction: CompactionPatch;
  after_agent_fail: RecoveryPatch;
  report_progress: ReportProgressPatch;
  on_task_complete: OnTaskCompletePatch;
}

export type HookPatchFor<N extends HookEventName> = HookPatchMap[N];

/**
 * 各 hook 的 payload 类型映射（§6.4：现状调用点的收敛声明，字段以实测代码为准）。
 *
 * 注意：before_model_select / before_prompt_build / before_tool_expose / after_compaction
 * 四处与设计文档 §6.4 表格不一致（文档写的是早期设想形态），此处按代码为准原则记录实测形态，
 * 设计文档待勘误。promptContext/promptResult/apiTools 结构归 prompt 模块所有，
 * 后续子任务随调用点收敛再精确化。
 *
 * 本子任务仅声明类型；dispatch 的 args.payload 对 HookPayloadMap[K] 的绑定依赖
 * tool-executor/facade 调用点收敛，属后续子任务（§16.2）。
 */
export interface HookPayloadMap {
  before_model_select: { providerId: string | null; model: string | null; temperature: number; maxTokens: number };
  before_prompt_build: { promptContext: unknown; reqCtx: RequestContext };
  before_tool_expose: { promptResult: unknown; allowedFunctionNames: string[]; apiTools: unknown };
  before_tool_call: { toolName: string; args: Record<string, unknown>; readonlyMode: boolean };
  after_tool_call: { toolName: string; result: Record<string, unknown>; isError: boolean; readonlyMode: boolean };
  before_compaction: { saveId: ID; label: string };
  after_compaction: { saveId: ID; label: string; status: 'completed' | 'failed'; error?: { message: string } };
  after_agent_fail: { error: { message: string }; reqCtx?: unknown; failureStage: string; attempts: number };
  report_progress: { phase: ProgressPhase; agentType: string; taskDescription: string; parentTask: string | null; detail?: ProgressDetail };
  on_task_complete: OnTaskCompletePayload;
}

export type HookPayloadFor<N extends HookEventName> = HookPayloadMap[N];

/** 类型化 hook 签名（D4.1：patch 类型与 hook 名编译期绑定，hook 作者无需显式标注泛型） */
export type TypedAgentHook<N extends HookEventName> = (
  context: AgentHookContext,
) => Promise<AgentHookResult<HookPatchFor<N>> | undefined> | AgentHookResult<HookPatchFor<N>> | undefined;

export interface IHookDispatcher {
  register(name: AgentHookName, hook: AgentHook): void;
  /**
   * 泛型化派发（M4 子任务A，§8.3）：patch 类型经 HookPatchMap 与 hook 名编译期绑定。
   * args 保持 HookDispatchArgs 信封（requestId/agentRunId/toolCallId 与 patch 类型正交）；
   * payload 对 HookPayloadMap[K] 的逐字段绑定依赖调用点收敛，属后续子任务（§16.2）。
   */
  dispatch<K extends HookEventName>(
    eventName: K,
    args: HookDispatchArgs,
  ): Promise<AgentHookResult<HookPatchMap[K]>>;
  reportProgress(phase: ProgressPhase, detail?: ProgressDetail): void;
  applyPolicies(policies: AgentHookPoliciesConfig | undefined): void;
  getPolicies(): AgentHookPoliciesConfig | undefined;
  /** 重建派发器 + 重注册默认 hooks（构造与 applyPolicies 时调用） */
  resetRuntime(): void;
  /** 已注册 hook 清单（createRequestScopedCopy 复制用） */
  getRegisteredHooks(): ReadonlyArray<{ name: AgentHookName; hook: AgentHook }>;
  /** createRequestScopedCopy 时恢复动态注册清单 */
  restoreRegisteredHooks(hooks: ReadonlyArray<{ name: AgentHookName; hook: AgentHook }>): void;
}

// ─── HookPlacementResolver（M4 §8.3，4 维度放置解析） ───

/**
 * 放置上下文：dispatch 调用方传入（D4.5/D4.6）。
 * agentType/path 由 facade 路由时确定；domain 仅 before/after_tool_call
 * 派发时由 ToolExecutor 从 toolName 前缀解析传入。
 */
export interface HookPlacementContext {
  agentType: AgentType;
  path: AgentRequestPath;
  /** 仅 before/after_tool_call 派发时提供（D4.6） */
  domain?: string;
}

/**
 * 解析后的有序 hook 链（特异性升序：通用→Agent类型→路径→领域，D4.4）。
 * 后执行者覆盖先执行者（标量），越具体越后执行越能覆盖越通用——
 * 与 CSS 特异性、防火墙规则同构。
 */
export interface ResolvedHookChain<N extends HookEventName = HookEventName> {
  hooks: ReadonlyArray<TypedAgentHook<N>>;
  /** 命中的 entry id 清单（诊断/日志用） */
  matchedEntryIds: string[];
  /** 降级标记：resolver 异常回退默认链时为 true（D4.7） */
  degraded: boolean;
}

export interface IHookPlacementResolver {
  /**
   * 解析 4 维度匹配，返回按特异性升序排列的 hook 链。
   * 契约（总规划 §2.4 / M4 §13）：
   * - Happy：返回匹配链
   * - Error：无匹配 → hooks: []（合法，语义"无覆盖"，不视为错误）
   * - Failure：本方法内部任何异常不得抛出——自行 catch 并返回
   *   { hooks: 默认链, degraded: true }（D4.7，ReAct 循环不阻断）
   * - Edge：4 维度并列冲突由固定秩 + 声明序确定性规则解决（§8.4），不抛错
   */
  resolvePlacement<N extends HookEventName>(
    name: N,
    context: HookPlacementContext,
  ): ResolvedHookChain<N>;

  /** 配置热重载（ConfigLoader watch 触发；重建索引 + 清空缓存，§11.3） */
  reload(entries: ReadonlyArray<HookPlacementEntry>): void;
}

// ─── MemoryController（§9.2） ───

export interface GMMemoryDeps {
  semanticContextCompressor: SemanticContextCompressor;
  episodicMemoryService: EpisodicMemoryService;
  proceduralMemoryService: ProceduralMemoryService;
  promptBuildBudgetGuard: PromptBuildBudgetGuard;
  npcServiceFactory: (saveId: ID) => Promise<INPCService>;
}

export interface MemoryControllerDeps {
  agentKey: string;
  hookDispatcher: IHookDispatcher;
  writeQueue: DatabaseWriteQueue | undefined;
  contextCompressor: ContextCompressor | undefined;
  contextService: IContextProvider | undefined;
  /** GM 专属记忆依赖；子 Agent 路径为 undefined（compressNPCMemories/checkMemoryThresholds 直接跳过） */
  gmMemoryDeps: GMMemoryDeps | undefined;
  /** GM 子 Agent 实例表（compressAgentContexts 遍历用）；子 Agent 路径返回空 Map */
  agentInstancesProvider: () => ReadonlyMap<AgentType, BaseAgent>;
  /** 按 Agent 实例获取其 ContextManager（replaceMessages 回写用） */
  contextManagerProvider: (agent: BaseAgent) => IContextManager;
  snapshotProvider: () => Readonly<AgentRuntimeSnapshot> | null;
}

export interface IMemoryController {
  /** post-ReAct 异步触发全量压缩检查（不阻塞响应；fire-and-forget） */
  triggerCompression(saveId: ID): void;
}

// ─── ToolExecutor（§10.2） ───

export interface ToolExecutorDeps {
  agentKey: string;
  agentType: AgentType;
  isSubAgent: boolean;
  toolRegistry: ToolRegistry;
  hookDispatcher: IHookDispatcher;
  /** 权限字段写者（state.allowedFunctionNames / state.excludedMethods；state.recovery 只读） */
  state: AgentRuntimeState;
  emitRuntimeEvent: (saveId: ID | undefined, event: RuntimeEvent) => void;
  buildTraceIds: (reqCtx: RequestContext, extra?: Partial<ExecutionTraceIds>) => ExecutionTraceIds;
  reportProgress: (phase: ProgressPhase, detail?: ProgressDetail) => void;
  getCurrentSaveId: () => ID;
  getCurrentTemplateId: () => string | undefined;
  getMaxIterations: () => number;
  /** 确定性动作配置（构造参数快照；facade 配置字段） */
  deterministicActions: string[];
  initDeterministicActions: string[];
  /** agentConfig.tools 快照（getGrantedToolTypes 判定 'all' 用） */
  configuredTools: string[];
  /** BaseAgent.callTool 低层执行器（§10.5：执行器与编排者分层） */
  callToolFn: (toolType: string, method: string, params: Record<string, unknown>, saveId: ID | undefined, reqCtx: RequestContext) => Promise<import('../../../../shared/src/types/agent.js').ToolResult>;
  /** buildContextFetcher 请求级 RequestScope 工厂 */
  createRequestScope: () => RequestContext['requestScope'];
}

export interface BuildEngineHooksArgs {
  saveId: ID;
  requestId: string;
  agentRunId: string;
  agentName?: string;
  reqCtx: RequestContext;
}

export type PreExecutedToolCall = NonNullable<ReActEngineContext['preExecutedToolCalls']>[number];

/** 上下文抓取器签名（prompt 层惰性数据获取，对齐 buildContextFetcher 现状） */
export type ContextFetcherFn = (source: string, method: string, params: Record<string, unknown>, saveId: ID, templateId?: string) => Promise<unknown>;

export interface IToolExecutor {
  /** 构建 ReActEngineHooks（原 buildRequestHooks） */
  buildEngineHooks(args: BuildEngineHooksArgs): ReActEngineHooks;
  /** 确定性动作预执行（deterministicActions） */
  executeDeterministicActions(saveId: ID, reqCtx: RequestContext): Promise<PreExecutedToolCall[]>;
  /** 初始化确定性动作预执行（initDeterministicActions） */
  executeInitDeterministicActions(saveId: ID, reqCtx: RequestContext): Promise<PreExecutedToolCall[]>;
  /** 上下文抓取器（prompt 层惰性数据获取） */
  buildContextFetcher(): ContextFetcherFn;
  /** GM 全工具授权（构造时调用） */
  grantAllToolPermissions(): void;
  /** 已授权工具类型清单 */
  getGrantedToolTypes(): string[];
}

// ─── ContextManager（§11.2） ───

export interface ContextManagerDeps {
  agentType: AgentType;
  /** 延迟求值（BaseAgent 构造后由 AgentRuntime 同步赋值，保持现状时序） */
  getContextService: () => IContextProvider | undefined;
  getFlushQueue: () => ContextFlushQueue | undefined;
  getCurrentSaveId: () => ID;
}

/**
 * cloneForRequestScope 的重绑定依赖（指向 scoped agent 实例）。
 * 保持"读取调用时实例字段"的语义：scoped agent 的 currentSaveId 后续变更
 * （ensureSaveId）必须作用于副本自身而非源实例。
 */
export type ContextManagerRebindDeps = Omit<ContextManagerDeps, 'agentType'>;

export interface IContextManager {
  /** 当前上下文（拷贝语义同现状 getContext） */
  getContext(): AgentContext;
  /** 追加消息（SOFT=100 异步压缩 / HARD=150 同步压缩，阈值常量保持现状） */
  addMessage(message: LLMMessage): Promise<void>;
  /** 部分更新并持久化 */
  update(updates: Partial<AgentContext>): Promise<void>;
  /** 清空（内存 + DB） */
  clear(): Promise<void>;
  /** 从 DB 加载（saveId 切换时） */
  load(): Promise<void>;
  /** 压缩回写：更新内存 + 落库（MemoryController 专用，§9.4 修复） */
  replaceMessages(messages: LLMMessage[]): Promise<void>;
  /** createRequestScopedCopy 专用：返回持有独立 context 拷贝、依赖重绑定到 scoped agent 的副本 */
  cloneForRequestScope(rebind: ContextManagerRebindDeps): IContextManager;
}

// ─── RecoveryCoordinator（§12.2） ───

export interface RecoveryCoordinatorDeps {
  recoveryPlanner: RecoveryPlanner;
  /** recovery 字段单写者（D3.4） */
  state: AgentRuntimeState;
  /** reactLoopDeps 延迟求值（setHelpRegistry 重建后取最新） */
  reactLoopDepsProvider: () => ReActLoopDeps;
}

export interface ExecuteRecoveryArgs {
  reactContext: ReActEngineContext;
  hooks: ReActEngineHooks | undefined;
  callToolFn: CallToolFn;
  requestId: string;
  agentRunId: string;
  failureStage: string;
  reqCtx: RequestContext;
}

export interface IRecoveryCoordinator {
  /** 包装 ReActLoop.executeReActWithRecovery，写回 recovery 状态 */
  executeWithRecovery(args: ExecuteRecoveryArgs): Promise<ReActEngineResult>;
  /** 请求入口重置（attempts=0, readonlyMode=false） */
  reset(): void;
  /** 只读访问器（测试与断言用） */
  readonly attempts: number;
  readonly readonlyMode: boolean;
}
