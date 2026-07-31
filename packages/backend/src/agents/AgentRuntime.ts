/**
 * AgentRuntime: 从 ReActAgent 迁移的状态化 Agent 运行时。
 *
 * 设计目标：
 * - 继承 BaseAgent，组合 ReActLoop 的 21 个纯函数
 * - 通过 AgentDeps/GMAgentDeps 容器注入全局依赖（消除 services/ value import）
 * - 管理请求级状态（currentAction、recoveryRuntimeState、traceCollector 等）
 * - 调用 ReActLoop 函数执行循环逻辑，不重新实现
 *
 * 详见 docs/design/fractal-design-20260626-backend-decoupling-refactor/
 *   fractal-design-20260626-backend-decoupling-refactor-模块B-Agent核心纯化.md
 */

// === value imports: agents/ 内部模块（允许） ===
import { BaseAgent } from './BaseAgent.js';
import { ReActEngine } from './ReActEngine.js';
import type { ReActEngineContext, ReActEngineHooks, ReActEngineResult, CallToolFn, LlmDebugReport } from './ReActEngine.js';
import type {
  AgentHook,
  AgentHookName,
  AgentHookResult,
} from './runtime/agent-hooks.js';
import { HookDispatcher } from './runtime/hook-dispatcher.js';
import { RecoveryCoordinator } from './runtime/recovery-coordinator.js';
import { ToolExecutor } from './runtime/tool-executor.js';
import { MemoryController } from './runtime/memory-controller.js';
import type { HookPlacementContext, HookSeedSnapshotFields, IHookDispatcher, IMemoryController, IRecoveryCoordinator, IToolExecutor } from './runtime/types.js';
import {
  cloneAgentRuntimeStateForRequestScope,
  createInitialAgentRuntimeState,
  type AgentRuntimeState,
} from './runtime/agent-runtime-state.js';
import { createOnTaskCompleteHook } from './runtime/audit-hook.js';
import {
  createToolExposureRuntimeState,
  mergeToolExposureBudget,
  type ToolExposureRuntimeState,
} from './runtime/tool-exposure-budget.js';
import { RecoveryPlanner } from './runtime/recovery-planner.js';
import type { AgentRuntimeSnapshot } from './runtime/agent-runtime-snapshot.js';
import { StoryPostReactPipeline } from './story/StoryPostReactPipeline.js';
// ContinuityAuditor 已迁移到 AuditAgent（方案M），此 import 移除
import { DOMAIN_ENRICHMENT_AGENT_TYPES } from './coordinator/types.js';
import type { IntegrationResult } from './coordinator/types.js';
import type {
  StorySnapshot,
  StoryProjection,
  WorldStateSummary,
  StoryDirective,
  StoryRequestContext,
  StoryPostReactDevtoolsTrace,
  StoryMasterPlan,
  PacingConstraints,
} from './story/types.js';

// === ReActLoop 函数导入 ===
import {
  extractTaskSummary,
  applyPromptContextPatch,
  resolveModelOverride,
  applyToolExposePatch,
  parseSubAgentResponseWithRetry,
  parseLLMResponseWithRetry,
  type ReActLoopContext,
  type ReActLoopDeps,
  type RequestContext,
} from './ReActLoop.js';

// === value imports: @ai-rpg/ai、utils/、shared/（允许） ===
import { ChatOptions, LLM_DEFAULTS } from '@ai-rpg/ai';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { createProgressReporter, type ToolProgress } from '@ai-rpg/shared/tool-core';
import { parseLLMJson } from '../utils/llm-json.js';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { isInitAction } from '../utils/constants';
import { ID, Timestamp } from '../../../shared/src/types/core.js';
import {
  AgentType,
  AgentMessage,
  LLMMessage,
  TaskStatus,
  EntityRef,
  TaskResults,
  ToolResult,
  ToolType,
  StandardAgentOutput,
  DialogueOption,
} from '../../../shared/src/types/agent';
import { DIALOGUE_MESSAGE_TYPES, type DialogueMessageType, type PanelUpdates, type DialogueUpdate, type DialogueMessageEntry } from '../../../shared/src/types/dynamic-ui';
import type {
  ProgressPhase,
  ProgressDetail,
  ProgressContext,
  TaskEndDetail,
  ThinkingDetail,
} from '@ai-rpg/shared';
import type { RuntimeEvent, ExecutionTraceIds } from '../../../shared/src/types/execution-trace.js';
import type {
  UnifiedPostReviewDecision,
} from '../../../shared/src/types/agent-coordination.js';
import type { TaskContent, TaskContract } from '../../../shared/src/types/audit.js';

// === type-only imports: services/ 与 game-systems/（零 value import） ===
// v1.5: 请求级服务（TraceCollector/ResponsePool/StagingPool/ShadowStateLayer）
// 通过 AgentDeps 工厂注入，agents/ 零 value import services/
import type { ResponsePoolFlush } from '../services/response-pool.js';
import type { StagingPool } from '../services/StagingPool.js';
import type { ShadowStateLayer } from '../services/ShadowStateLayer.js';
import type { AgentConfig as YamlAgentConfig } from './config/schema.js';
import type { PromptModule } from './prompt/index.js';
import type { PromptBuildResult, PromptContext } from './prompt/types.js';
import type { HelpRegistry } from '../services/help-registry.js';
import type { LocationData } from '../game-systems/map/types';
import {
  AgentStatus,
  AGENT_CAPABILITIES_DECLARATION,
  type AgentResponse,
  type GameResponseData,
  type LLMOptions,
  type LLMResponse,
} from './types.js';

// === deps container ===
import {
  type AgentDeps,
  type GMAgentDeps,
  isGMAgentDeps,
  QUEST_EVENT_TYPES,
  EVENT_SERVICE_EVENT_TYPES,
} from './agent-deps.js';

const logger = createChildLogger('agent-runtime');

// EG-M4-5: 定期纠错触发阈值（累计写入次数，跨多次请求累加）
// 含义：每累计 50 次写入触发一次 Reconciler.reconcile
const RECONCILE_THRESHOLD = 50;

const CONFIG_DIR = process.env.AGENT_CONFIG_DIR || resolve(process.cwd(), 'config');

// Fallback interaction mapping — 当 interaction-mapping.yaml 不存在或解析失败时使用。
// 如需新增交互类型，须同步更新此 fallback 和 config/interaction-mapping.yaml
const DEFAULT_INTERACTION_MAPPING: Record<string, { messageSuffix: string }> = {
  use_item: { messageSuffix: '使用物品 {target}' },
  equip_item: { messageSuffix: '装备物品 {target}' },
  unequip_item: { messageSuffix: '卸下装备 {target}' },
  drop_item: { messageSuffix: '丢弃物品 {target}' },
  examine_item: { messageSuffix: '查看物品 {target}' },
  learn_skill: { messageSuffix: '学习技能 {target}' },
  use_skill: { messageSuffix: '使用技能 {target}' },
  view_skill: { messageSuffix: '查看技能 {target}' },
  travel: { messageSuffix: '前往 {target}' },
  travel_to: { messageSuffix: '旅行至 {target}' },
  talk_npc: { messageSuffix: '与 {target} 对话' },
  accept_quest: { messageSuffix: '接受任务 {target}' },
  abandon_quest: { messageSuffix: '放弃任务 {target}' },
  buy_item: { messageSuffix: '购买物品 {target}' },
  sell_item: { messageSuffix: '出售物品 {target}' },
  craft_item: { messageSuffix: '制作物品 {target}' },
  enhance_item: { messageSuffix: '强化装备 {target}' },
  deposit_item: { messageSuffix: '存入仓库 {target}' },
  withdraw_item: { messageSuffix: '取出物品 {target}' },
  select_option: { messageSuffix: '选择: {target}' },
  custom: { messageSuffix: '自定义操作' },
};

function loadInteractionMapping(): Record<string, { messageSuffix: string }> {
  try {
    const mappingYaml = readFileSync(resolve(CONFIG_DIR, 'interaction-mapping.yaml'), 'utf-8');
    const mappingConfig = yaml.load(mappingYaml) as {
      interaction_mapping: Record<string, { messageSuffix: string }>;
    };
    if (mappingConfig?.interaction_mapping && typeof mappingConfig.interaction_mapping === 'object') {
      return mappingConfig.interaction_mapping;
    }
    return DEFAULT_INTERACTION_MAPPING;
  } catch {
    return DEFAULT_INTERACTION_MAPPING;
  }
}

const INTERACTION_MAPPING = loadInteractionMapping();

interface StoryDirectiveGenerationContext {
  saveId: ID;
  message: AgentMessage;
  reqCtx: RequestContext;
  templateContext: string | null;
  storySnapshot: StorySnapshot;
  projection: StoryProjection;
  worldState?: WorldStateSummary;
  sceneNPCs: Array<{ id: string; name: string; role?: string }>;
  inCombat: boolean;
  entityGraphXml: string | null;
}

interface RepairRuntimeScope {
  stagingPool: StagingPool;
  shadowState: ShadowStateLayer;
}

interface PostProcessReActResultOutput {
  gameTimeData: { day: number; hour: number; minute: number; period: string; season: string; description: string } | undefined;
  integrationResult: IntegrationResult;
  reactResult?: ReActEngineResult;
}

class PostReactRepairFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostReactRepairFailureError';
  }
}

export class AgentRuntime extends BaseAgent {
  // 配置字段（构造函数初始化后不变）
  private agentConfig: YamlAgentConfig;
  private agentKey: string;
  private maxIterations: number;
  private forceStructuredOutput: boolean;
  private providerId?: string;
  private model?: string;
  private isSubAgent: boolean;
  private deterministicActions: string[];
  private initDeterministicActions: string[];

  // 依赖容器
  private deps: AgentDeps;
  private gmDeps?: GMAgentDeps;  // 仅 GM 路径有值

  // ReAct 引擎与循环
  private reactEngine: ReActEngine;
  private recoveryPlanner: RecoveryPlanner;
  private reactLoopDeps: ReActLoopDeps;  // 构造时构建一次

  // 运行时状态
  // M3 状态收敛（§6）：AgentRuntime 请求级可变状态全部收敛进 state（单一聚合接口），
  // 既有读写路径统一经 this.state.xxx 访问；createRequestScopedCopy 整体克隆。
  private state: AgentRuntimeState = createInitialAgentRuntimeState();
  private get currentProgressContext(): ProgressContext | null {
    return this.state.progressContext;
  }
  private set currentProgressContext(ctx: ProgressContext | null) {
    this.state.progressContext = ctx;
  }
  private hookDispatcher: IHookDispatcher;
  private recoveryCoordinator: IRecoveryCoordinator;
  private toolExecutor: IToolExecutor;
  private memoryController: IMemoryController;

  // GM-only 字段
  private agentInstances: Map<AgentType, BaseAgent> = new Map();
  private activeRequestCount = 0;
  private storyPostReactPipeline = new StoryPostReactPipeline({});

  // 待注入感知更新提示（模块3 L2-2 后处理引导）已收敛进 state.pendingPerceptionHint：
  // 由 postReactResult.perceptionUpdateHint 赋值（post-react 阶段后），
  // 在下一轮 GM systemPrompt 构建时注入 `<perception_hint>` 段并清空（一次性消费）。

  /**
   * 在 GM systemPrompt 构建时，将 state.pendingPerceptionHint 注入 prompt 顶部（模块3 L2-2）。
   * 注入后立即清空字段（一次性消费，避免跨轮累积）。
   *
   * 期望效果：GM 在下一轮 prompt 中看到 <perception_hint> 段，
   * 知晓上一轮发生的感知变化事件，主动调用 set_awareness/set_relationship。
   */
  private consumePerceptionHint(): string {
    if (!this.state.pendingPerceptionHint) return '';
    const hint = this.state.pendingPerceptionHint;
    this.state.pendingPerceptionHint = null;  // 一次性消费
    return `\n<perception_hint>\n${hint}\n</perception_hint>\n`;
  }

  // EG-M4-5: 定期纠错阈值计数（per-saveId 累计写入次数）
  // flush 后检查，超过 RECONCILE_THRESHOLD 触发 Reconciler.reconcile
  private reconcileCounters: Map<string, number> = new Map();
  // 保存本轮 flush 前的写入次数（stagingPool.flush 后 writeCount 归零，无法直接读取）
  private lastRequestWriteCount = 0;

  // on_task_complete 审核去重 Set（EC4）已收敛进 state.auditedKeys；
  // 子 Agent 任务契约（v5.2 EC9）已收敛进 state.currentTaskContract。

  // v2.3 Q3 决策: currentRequestId/currentAgentRunId 改为 getter 从 currentProgressContext 读取
  /** 当前请求 ID（从 ProgressContext 读取，无 ProgressContext 时返回空字符串） */
  protected get currentRequestId(): string {
    return this.currentProgressContext?.requestId ?? '';
  }
  /** 当前 Agent 运行 ID（从 ProgressContext 读取，无 ProgressContext 时返回空字符串） */
  private get currentAgentRunId(): string {
    return this.currentProgressContext?.agentRunId ?? '';
  }

  get memoryServices(): { episodic: import('./memory/episodic-memory-service.js').EpisodicMemoryService | undefined; procedural: import('./memory/procedural-memory-service.js').ProceduralMemoryService | undefined } {
    return {
      episodic: this.gmDeps?.episodicMemoryService,
      procedural: this.gmDeps?.proceduralMemoryService,
    };
  }

  /** 暴露StoryKernel实例供EventBus订阅 */
  getStoryKernel(): import('./story/StoryKernel.js').StoryKernel | undefined {
    return this.gmDeps?.storyKernel;
  }

  get configuredTools(): string[] {
    return this.agentConfig.tools;
  }

  /**
   * override: GM（isSubAgent=false）允许 spawn，子 Agent 不允许。
   * 与 enableSpawnAgent 配置字段语义一致，但此 getter 参与运行时检查。
   */
  override get canSpawnAgent(): boolean {
    return !this.isSubAgent;
  }

  get maxContextTokens(): number | undefined {
    return this.agentConfig.max_context_tokens;
  }

  constructor(deps: AgentDeps, agentConfig: YamlAgentConfig, agentKey: string, systemPrompt: string) {
    super(
      { type: agentKey as AgentType, name: agentConfig.name, systemPrompt },
      {
        devTraceCollector: deps.devTraceCollector,
        webSocketService: deps.webSocketService,
        devTraceHook: deps.devTraceHook,
      },
    );
    this.deps = deps;
    this.contextService = deps.contextService;  // 同步 BaseAgent.contextService 供内部 persistContext 使用
    this.flushQueue = deps.flushQueue;  // v1.4 新增：同步 BaseAgent.flushQueue 供 persistContext 使用

    this.agentConfig = structuredClone(agentConfig);
    this.agentKey = agentKey;
    this.maxIterations = agentConfig.max_iterations ?? 200;
    this.forceStructuredOutput = agentConfig.force_structured_output ?? true;
    this.providerId = agentConfig.provider_id;
    this.model = agentConfig.model;
    this.isSubAgent = agentConfig.isSubAgent ?? (agentKey !== 'gamemaster');
    this.deterministicActions = agentConfig.deterministicActions ?? [];
    this.initDeterministicActions = agentConfig.initDeterministicActions ?? [];

    if (isGMAgentDeps(deps)) {
      this.gmDeps = deps;
    }

    // 构造 reactEngine 与 recoveryPlanner
    this.reactEngine = new ReActEngine({
      llmService: deps.llmService,
      toolRegistry: this.toolRegistry,
      writeQueue: deps.writeQueue,
      helpRegistry: deps.helpRegistry,
    });
    this.recoveryPlanner = new RecoveryPlanner(agentConfig.hookPolicies?.recovery);

    // 构造 reactLoopDeps（一次性，setHelpRegistry 时重建）
    this.reactLoopDeps = this.buildReActLoopDeps();

    // HookDispatcher 装配（D3.3：snapshotProvider 回调注入，禁止反向依赖 facade）
    this.hookDispatcher = this.buildHookDispatcher();

    // RecoveryCoordinator 装配（Step 4：recovery 状态单写者，reactLoopDeps 延迟求值）
    this.recoveryCoordinator = this.buildRecoveryCoordinator();

    // ToolExecutor 装配（Step 5：依赖 hookDispatcher + state）
    this.toolExecutor = this.buildToolExecutor();

    // MemoryController 装配（Step 6：依赖 hookDispatcher + GM 记忆依赖）
    this.memoryController = this.buildMemoryController();

    // GM 分支：授予所有工具权限
    if (this.gmDeps) {
      this.toolExecutor.grantAllToolPermissions();
    }

    logger.info(`Agent ${this.agentKey} starting`, {
      tag: 'AGENT-START',
      agent: this.agentKey,
      model: this.model,
      provider: this.providerId,
      toolsConfigured: this.agentConfig.tools?.length || 0,
      maxIterations: this.maxIterations,
      isSubAgent: this.isSubAgent,
    });
  }

  // ─── ReActLoop 上下文与依赖构建 ───

  private buildReActLoopContext(): ReActLoopContext {
    return {
      agentKey: this.agentKey,
      englishId: this.agentConfig.englishId || this.agentKey,
      currentAction: this.state.currentAction,
      maxIterations: this.maxIterations,
      providerId: this.providerId ?? null,
      model: this.model ?? null,
      temperature: this.agentConfig.temperature ?? LLM_DEFAULTS.temperature,
      maxTokens: this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens,
    };
  }

  /**
   * 构建 TaskContent - 所有 Agent 在 ReAct loop 启动时构建（设计文档 taskContent 来源表）。
   *
   * - GM init 路径：description 来自 storyGoal 或 currentAction
   * - GM chat 路径：description 来自 storyGoal 或 currentAction
   * - 子 Agent：description 来自 currentAction 或 agentKey
   *
   * taskContent 用于 on_task_complete hook 审核去重（auditKey）和报告回传。
   * agentRunId 由调用方传入（来自 processMessageCore 的 agentRunId 变量）。
   */
  private buildTaskContent(agentRunId: string): TaskContent | undefined {
    const directive = this.currentStoryDirective as { storyGoal?: string } | null;
    const storyGoal = directive?.storyGoal;
    const description = storyGoal || this.state.currentAction || this.agentKey;
    // v5.2 EC9: 默认 'chat'，禁止 'unknown' fallback
    const action = this.state.currentAction || 'chat';

    // v5.2 EC9: expected 来源
    // - GM 路径：expected = undefined（审核维度由 agentType 决定，不依赖 expected.counts）
    // - 子 Agent 路径：expected = currentTaskContract?.expected（由 coordinator-service 传递）
    const expected = this.state.currentTaskContract?.expected;

    // GM 可通过 taskContract.audit_mode 覆盖审核模式（创造性任务强制 LLM 审）
    const auditMode = this.state.currentTaskContract?.audit_mode;

    return {
      description,
      action,
      expected,
      agentType: this.agentKey,
      agentRunId,
      auditMode,
    };
  }

  /**
   * M5: 构建 prepareNextTurn 相关字段（三处 ReActEngineContext 构建点共用，M5 设计 §8.5）。
   *
   * hook 由 deps 工厂 per-request 创建（tier 解析 memoize 作用域 = 请求）；
   * guard 配置直读 agentConfig（缺省由 ModelSwitchGuard 默认值兜底，M5 §16 Q4）。
   * Agent 未配置 prepareNextTurn 时工厂返回 undefined，引擎零行为变化。
   */
  private buildPrepareNextTurnFields(): Pick<ReActEngineContext, 'prepareNextTurn' | 'prepareNextTurnGuard'> {
    return {
      prepareNextTurn: this.deps.createPrepareNextTurnHook?.(this.agentConfig),
      prepareNextTurnGuard: this.agentConfig.prepareNextTurn?.guard,
    };
  }

  private buildReActLoopDeps(): ReActLoopDeps {
    return {
      reactEngine: this.reactEngine,
      recoveryPlanner: this.recoveryPlanner,
      dispatchHook: (event, requestId, agentRunId, payload) =>
        this.dispatchHook(
          event as AgentHookName,
          requestId,
          agentRunId,
          payload as Record<string, unknown> | undefined,
        ),
      emitRuntimeEvent: (saveId, event) =>
        this.emitRuntimeEvent(saveId as ID | undefined, event as RuntimeEvent),
      buildTraceIds: (reqCtx, extra) =>
        this.buildCurrentTraceIds(reqCtx, extra as Partial<ExecutionTraceIds>),
      getSkillCompletionCriteria: (skillName: string) =>
        this.deps.promptModule.skills.getSkillByName(skillName)?.completionCriteria,
    };
  }

  // ─── 生命周期与 Hook ───

  /**
   * HookDispatcher 工厂（构造函数与 createRequestScopedCopy 共用）。
   *
   * stateReader/snapshotProvider 闭包捕获 this——scoped 副本必须经本工厂重建
   * dispatcher，禁止跨实例共享（否则会读取父实例 state，破坏请求隔离）。
   */
  private buildHookDispatcher(): IHookDispatcher {
    return new HookDispatcher({
      agentKey: this.agentKey,
      agentTypeLabel: this.agentConfig.englishId || this.agentKey,
      webSocketService: this.deps.webSocketService,
      snapshotProvider: () => this.getRuntimeSnapshot(),
      stateReader: this.state,
      seedSnapshotFactory: () => this.buildHookSeedSnapshotFields(),
      hookPolicies: this.agentConfig.hookPolicies,
      // v5.2 EC7: on_task_complete hook 注册（所有 AgentRuntime，auditAgent + auditContextBuilder 已上移到 AgentDeps）
      // 审核挂起-恢复模式核心：ReAct loop 提交点触发审核，patch 注入 auditReport
      // 子 Agent 也注册 hook，依赖 this.deps.auditAgent（YamlAgentFactory.depsParams 已传入）
      onTaskCompleteHook: createOnTaskCompleteHook({
        auditAgent: this.deps.auditAgent,
        auditContextBuilder: this.deps.auditContextBuilder,
        auditedKeys: this.state.auditedKeys,
      }),
      // M4：4 维度 placement 解析器（组合根单例，deps 可选注入；缺省走现状默认链）
      placementResolver: this.deps.placementResolver,
    });
  }

  /** 种子快照字段（HookDispatcher createSeedSnapshot 的配置字段供给，§8.3） */
  private buildHookSeedSnapshotFields(): HookSeedSnapshotFields {
    return {
      saveId: this.currentSaveId,
      providerId: this.providerId ?? null,
      model: this.model ?? null,
      temperature: this.agentConfig.temperature ?? LLM_DEFAULTS.temperature,
      maxTokens: this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens,
      configuredTools: [...this.agentConfig.tools],
      systemPrompt: this.systemPrompt,
      language: this.currentLanguage,
      templateId: this.currentTemplateId ?? null,
    };
  }

  /**
   * RecoveryCoordinator 工厂（构造函数与 createRequestScopedCopy 共用）。
   * state 闭包捕获 this——scoped 副本必须经本工厂重建以绑定克隆后的 state（recovery 单写者）。
   */
  private buildRecoveryCoordinator(): IRecoveryCoordinator {
    return new RecoveryCoordinator({
      recoveryPlanner: this.recoveryPlanner,
      state: this.state,
      reactLoopDepsProvider: () => this.reactLoopDeps,
    });
  }

  /**
   * ToolExecutor 工厂（构造函数与 createRequestScopedCopy 共用）。
   * state/hookDispatcher 闭包捕获 this——scoped 副本必须经本工厂重建以绑定
   * 克隆后的 state 与重建后的 hookDispatcher（禁止跨实例共享）。
   */
  private buildToolExecutor(): IToolExecutor {
    return new ToolExecutor({
      agentKey: this.agentKey,
      agentType: this.type,
      isSubAgent: this.isSubAgent,
      toolRegistry: this.toolRegistry,
      hookDispatcher: this.hookDispatcher,
      state: this.state,
      emitRuntimeEvent: (saveId, event) => this.emitRuntimeEvent(saveId, event),
      buildTraceIds: (reqCtx, extra) => this.buildCurrentTraceIds(reqCtx, extra),
      reportProgress: (phase, detail) => this.reportProgress(phase, detail),
      getCurrentSaveId: () => this.currentSaveId,
      getCurrentTemplateId: () => this.currentTemplateId,
      getMaxIterations: () => this.maxIterations,
      deterministicActions: this.deterministicActions,
      initDeterministicActions: this.initDeterministicActions,
      configuredTools: [...this.agentConfig.tools],
      callToolFn: (toolType, method, params, saveId, reqCtx) =>
        this.callTool(toolType, method, params, saveId, reqCtx),
      createRequestScope: () => this.deps.createRequestScope(),
    });
  }

  /**
   * MemoryController 工厂（构造函数与 createRequestScopedCopy 共用）。
   * hookDispatcher 闭包捕获 this——scoped 副本必须经本工厂重建以绑定重建后的 dispatcher。
   */
  private buildMemoryController(): IMemoryController {
    return new MemoryController({
      agentKey: this.agentKey,
      hookDispatcher: this.hookDispatcher,
      writeQueue: this.deps.writeQueue,
      contextCompressor: this.deps.contextCompressor,
      contextService: this.deps.contextService,
      gmMemoryDeps: this.gmDeps
        ? {
            semanticContextCompressor: this.gmDeps.semanticContextCompressor,
            episodicMemoryService: this.gmDeps.episodicMemoryService,
            proceduralMemoryService: this.gmDeps.proceduralMemoryService,
            promptBuildBudgetGuard: this.gmDeps.promptBuildBudgetGuard,
            npcServiceFactory: this.gmDeps.npcServiceFactory,
          }
        : undefined,
      agentInstancesProvider: () => this.agentInstances,
      contextManagerProvider: (agent) => agent.contextManager,
      snapshotProvider: () => this.getRuntimeSnapshot(),
    });
  }

  private resetRecoveryRuntimeState(): void {
    this.recoveryCoordinator.reset();
  }

  override createRequestScopedCopy<T extends BaseAgent>(this: T): T {
    const scopedAgent = super.createRequestScopedCopy() as AgentRuntime;
    const self = this as unknown as AgentRuntime;
    scopedAgent.agentConfig = structuredClone(self.agentConfig);
    // 状态收敛（G2 验收点）：整体克隆替代逐字段复制
    scopedAgent.state = cloneAgentRuntimeStateForRequestScope(self.state);
    // HookDispatcher 重建：闭包必须指向 scoped 副本自身（禁止共享父实例 dispatcher）
    scopedAgent.hookDispatcher = scopedAgent.buildHookDispatcher();
    scopedAgent.hookDispatcher.restoreRegisteredHooks(self.hookDispatcher.getRegisteredHooks());
    // RecoveryCoordinator 重建：绑定 scoped 副本的克隆 state（recovery 单写者）
    scopedAgent.recoveryCoordinator = scopedAgent.buildRecoveryCoordinator();
    // ToolExecutor 重建：绑定 scoped 副本的克隆 state + 重建后的 hookDispatcher
    scopedAgent.toolExecutor = scopedAgent.buildToolExecutor();
    // MemoryController 重建：绑定 scoped 副本重建后的 hookDispatcher
    scopedAgent.memoryController = scopedAgent.buildMemoryController();
    return scopedAgent as unknown as T;
  }

  setHelpRegistry(registry: HelpRegistry): void {
    // 重建 ReActEngine 以注入 helpRegistry，并重建 reactLoopDeps 以引用新引擎
    this.reactEngine = new ReActEngine({
      llmService: this.deps.llmService,
      toolRegistry: this.toolRegistry,
      writeQueue: this.deps.writeQueue,
      helpRegistry: registry,
    });
    this.reactLoopDeps = this.buildReActLoopDeps();
  }

  setDevModeService(service: AgentDeps['devModeService']): void {
    this.deps.devModeService = service;
  }

  registerHook(name: AgentHookName, hook: AgentHook): void {
    this.hookDispatcher.register(name, hook);
  }

  applyHookPolicies(policies?: YamlAgentConfig['hookPolicies']): void {
    this.agentConfig = {
      ...structuredClone(this.agentConfig),
      hookPolicies: policies ? structuredClone(policies) : undefined,
    };
    this.hookDispatcher.applyPolicies(policies);
    // 保持现状行为（resetHookRuntime 等价语义）：策略变更重建 recoveryPlanner + reactLoopDeps
    this.recoveryPlanner = new RecoveryPlanner(this.agentConfig.hookPolicies?.recovery);
    this.reactLoopDeps = this.buildReActLoopDeps();
    // 同步重建 RecoveryCoordinator（deps.recoveryPlanner 构造期引用需保持最新）
    this.recoveryCoordinator = this.buildRecoveryCoordinator();
  }

  getHookPolicies(): YamlAgentConfig['hookPolicies'] | undefined {
    return this.hookDispatcher.getPolicies();
  }

  private reportProgress(phase: ProgressPhase, detail?: ProgressDetail): void {
    this.hookDispatcher.reportProgress(phase, detail);
  }

  private async dispatchHook(
    name: AgentHookName,
    requestId: string,
    agentRunId: string,
    payload?: Record<string, unknown>,
    toolCallId?: string,
    placement?: HookPlacementContext,
  ): Promise<AgentHookResult<Record<string, unknown>>> {
    return this.hookDispatcher.dispatch(name, { requestId, agentRunId, payload, toolCallId, placement });
  }

  /**
   * 当前请求的 4 维度 placement 上下文（M4 §14.4）。
   * agentType 取 facade 类型；path 读 state.currentPath（facade 路由时写入，单写者）。
   * domain 仅 ToolExecutor 工具调用派发点补充，此处不携带。
   */
  private currentHookPlacement(): HookPlacementContext {
    return { agentType: this.type, path: this.state.currentPath };
  }

  // ─── 入口方法 ───

  async processMessage(message: AgentMessage, _reqCtx?: RequestContext): Promise<AgentResponse> {
    try {
      const result = await this.processMessageCore(message);

      this.reportProgress('task_end', {
        success: result.success ?? true,
        summary: extractTaskSummary(result),
      } as TaskEndDetail);
      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('processMessage failed', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        requestId: this.currentRequestId,
        agentRunId: this.currentAgentRunId,
      });

      const isFatal = !this.currentProgressContext?.parentTask;
      this.reportProgress('task_end', {
        success: false,
        fatal: isFatal,
        summary: errorMessage,
      } as TaskEndDetail);

      return {
        success: false,
        error: errorMessage,
        errorCode: 'AGENT_PROCESSING_FAILED',
      };
    }
  }

  private async processMessageCore(message: AgentMessage): Promise<AgentResponse> {
    // FOLLOWUP-3: 包裹 runWithState 激活 per-request 事件上下文。
    // bootstrap EventBus 订阅器（QuestService/EventService 转发器）通过 requestEventBridge.pushEvent 入队，
    // 避免 ReAct 循环内直接写 DB 绕过 StagingPool（架构规范 §13.1）。
    // post-flush 阶段由 drainAndProcessPendingBusEvents 处理 pending 事件。
    return this.deps.requestEventBridge.runWithState(async () => {
      const startTime = Date.now() as Timestamp;

      // 设计文档 EC4: 请求开始时清理 auditedKeys（per-request 生命周期）
      // 避免跨请求累积导致去重永远命中（内存泄漏防护）
      this.state.auditedKeys.clear();

      const meta = (message.metadata ?? {}) as Record<string, unknown>;
      const requestId = (meta._wsRequestId as string) || (typeof message.id === 'string' ? message.id : '') || '';
      const clientId = (meta._wsClientId as string) || '';

      const taskDescription = this.deriveTaskDescription(message);
      const agentRunId = `${this.agentKey}:${randomUUID()}`;
      const parentTask = (meta._parentTask as string | null) ?? null;

      this.currentProgressContext = {
        requestId,
        agentRunId,
        taskDescription,
        parentTask,
        broadcastClientId: clientId,
      };

      this.reportProgress('task_start');

      try {
        if (this.isSubAgent) {
          return await this.processSubAgentPath(message);
        }

        // GM path: activeRequestCount + full orchestration
        this.activeRequestCount++;
        this.setStatus(AgentStatus.PROCESSING);
        try {
          const result = await this.processGameMasterPath(message, startTime);
          logger.info(`Agent ${this.agentKey} completed`, {
            tag: 'AGENT-END',
            requestId,
            agent: this.agentKey,
            elapsed: Date.now() - startTime,
            success: result.success !== false,
            toolCallCount: result.toolCalls?.length || 0,
          });
          return result;
        } finally {
          this.activeRequestCount--;
          if (this.activeRequestCount === 0) {
            this.setStatus(AgentStatus.IDLE);
          }
        }
      } finally {
        this.currentProgressContext = null;
        this.state.currentAction = undefined;
        this.state.traceCollector = undefined;
        // v5.2 EC9: 清理 currentTaskContract（per-request 生命周期，避免跨请求泄漏）
        this.state.currentTaskContract = undefined;
      }
    });
  }

  /**
   * 纯函数：从消息中推导任务描述
   */
  private deriveTaskDescription(message: AgentMessage): string {
    const payloadData = message.payload?.data as Record<string, unknown> | undefined;
    const taskDescription = payloadData?.taskDescription as string | undefined;
    if (taskDescription) return taskDescription;

    const intentHint = message.payload?.intentHint as string | undefined;
    if (intentHint) return intentHint;

    return this.agentConfig.englishId || this.agentKey;
  }

  // ─── ReAct 循环执行（组合 ReActLoop 纯函数） ───

  /**
   * 执行 ReAct 循环并应用恢复策略（M3 Step 4：薄委托 RecoveryCoordinator）。
   *
   * RecoveryCoordinator 作为 recovery 状态单写者，包装 ReActLoop.executeReActWithRecovery
   * 纯函数并写回 recoveryState；facade 保留本薄委托避免调用点变更。
   */
  private async executeReActWithRecovery(
    reactContext: ReActEngineContext,
    hooks: ReActEngineHooks | undefined,
    callToolFn: CallToolFn,
    requestId: string,
    agentRunId: string,
    failureStage: string,
    reqCtx: RequestContext,
  ): Promise<ReActEngineResult> {
    return this.recoveryCoordinator.executeWithRecovery({
      reactContext,
      hooks,
      callToolFn,
      requestId,
      agentRunId,
      failureStage,
      reqCtx,
    });
  }

  /**
   * 解析子 Agent 响应并应用重试策略。
   *
   * AgentRuntime 持有 reactLoopDeps，此方法作为 ReActLoop.parseSubAgentResponseWithRetry
   * 纯函数的薄包装，统一注入 getSkillCompletionCriteria，便于测试以 spy 方式替换行为。
   */
  private async parseSubAgentResponseWithRetry(
    context: ReActLoopContext,
    response: { content: string; iterations: number; toolCalls: ToolResult[] },
    retryLLMFn?: () => Promise<string>,
    reqCtx?: RequestContext,
  ): Promise<StandardAgentOutput> {
    return parseSubAgentResponseWithRetry(
      context,
      response,
      retryLLMFn,
      reqCtx,
      this.reactLoopDeps.getSkillCompletionCriteria,
    );
  }

  // ─── SubAgent 路径 ───

  private async processSubAgentPath(message: AgentMessage): Promise<AgentResponse> {
    this.setStatus(AgentStatus.PROCESSING);
    this.state.currentAction = message.payload?.action;
    this.state.currentPath = 'sub_agent';
    this.resetRecoveryRuntimeState();

    const subPayloadData = (message.payload?.data as Record<string, unknown>) || {};
    // v5.2 EC9: 读取 coordinator-service 传递的 taskContract，存储到 currentTaskContract
    // buildTaskContent 从 currentTaskContract?.expected 构建 taskContent.expected
    this.state.currentTaskContract = subPayloadData.taskContract as TaskContract | undefined;
    const reqCtx: RequestContext = {
      intentHint: '',
      stagingPool: this.currentStagingPool,
      shadowState: this.currentShadowState,
      traceIds: subPayloadData.traceIds as Partial<ExecutionTraceIds> | undefined,
      requestScope: this.deps.createRequestScope(),
    };

    try {
      const requestId = this.resolveRuntimeSnapshotRequestId(message);
      const agentRunId = this.currentAgentRunId;
      this.currentSaveId = await this.ensureSaveId(message);

      const npcService = await this.deps.npcServiceFactory(this.currentSaveId);
      const ctx: PromptContext = {
        agentKey: this.agentKey,
        agentConfig: this.buildPromptAgentConfig(this.agentConfig.tools),
        excludedMethods: this.state.excludedMethods,
        language: this.currentLanguage,
        message: message.payload ? { payload: message.payload } : { payload: undefined },
        templateContext: this.currentTemplateContext,
        templateId: this.currentTemplateId,
        domain: {
          templateProvider: this.deps.templateProvider,
          npcService,
          specialRules: this.currentSpecialRules,
          storyDirective: this.currentStoryDirective,
          postReviewDecision: this.currentPostReviewDecision,
          saveId: this.currentSaveId,
        },
        options: {},
      };

      const loopCtx = this.buildReActLoopContext();
      const modelSelectHookResult = await this.dispatchHook(
        'before_model_select',
        requestId,
        agentRunId,
        {
          providerId: this.providerId ?? null,
          model: this.model ?? null,
          temperature: this.agentConfig.temperature ?? LLM_DEFAULTS.temperature,
          maxTokens: this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const selectedModel = resolveModelOverride(loopCtx, modelSelectHookResult.patch);

      const promptHookResult = await this.dispatchHook(
        'before_prompt_build',
        requestId,
        agentRunId,
        {
          promptContext: ctx,
          reqCtx,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const hookedPromptContext = applyPromptContextPatch(ctx, promptHookResult.patch);
      const promptModel = resolveModelOverride(loopCtx, promptHookResult.patch, selectedModel);

      const builtPromptResult = await this.deps.promptModule.build(hookedPromptContext);
      const toolExposeHookResult = await this.dispatchHook(
        'before_tool_expose',
        requestId,
        agentRunId,
        {
          promptResult: builtPromptResult,
          allowedFunctionNames: [...builtPromptResult.allowedFunctionNames],
          apiTools: builtPromptResult.apiTools,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const promptResult = applyToolExposePatch(builtPromptResult, toolExposeHookResult.patch);
      reqCtx.toolExposureState ??= createToolExposureRuntimeState(promptResult.toolExposureTrace);
      const runtimeSnapshot = this.bindRuntimeSnapshot(
        hookedPromptContext,
        promptResult,
        requestId,
        'react-subagent',
        reqCtx.toolExposureState,
      );
      this.systemPrompt = runtimeSnapshot.promptSnapshot.systemPrompt;
      const userMessage = runtimeSnapshot.promptSnapshot.userPrompt;
      const tools = promptResult.apiTools;
      this.state.allowedFunctionNames = this.filterTemplatePoolToolsForGamePath(
        new Set(runtimeSnapshot.toolVisibilitySnapshot.allowedFunctionNames),
        this.state.currentAction,
      );

      reqCtx.intentHint = message.payload?.intentHint || '';
      const triggeredRules = this.deps.promptModule.rules.getAllRulesForAgent(this.agentKey, reqCtx.intentHint);
      if (triggeredRules.length > 0) {
        reqCtx.rulesTriggered = triggeredRules.map(r => r.name);
      }

      if (!tools || tools.length === 0) {
        if (this.agentConfig.tools && this.agentConfig.tools.length > 0) {
          logger.warn(`Tools configured but none available for agent: ${this.agentKey}`, {
            configuredTools: this.agentConfig.tools,
          });
        } else {
          logger.info(`No tools configured for agent: ${this.agentKey}, using pure LLM mode`);
        }

        // M9：经 LLMRequestDispatcher 调度（选 key + 限流 + 失败转移）
        const responseContent = await this.chatViaDispatcher(
          [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: userMessage }],
          {
            providerId: promptModel.providerId ?? undefined,
            model: promptModel.model ?? undefined,
            temperature: promptModel.temperature ?? (this.agentConfig.temperature ?? LLM_DEFAULTS.temperature),
            maxTokens: promptModel.maxTokens ?? (this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens),
            responseFormat: this.agentConfig.force_structured_output ? { type: 'json_object' } : undefined,
            loggingMetadata: this.buildLoggingMetadata('react-pure-llm', 0, 0),
          },
          this.currentSaveId || undefined,
        );

        const retryFn = async (): Promise<string> => {
          return this.chatViaDispatcher(
            [{ role: 'system', content: this.systemPrompt }, { role: 'user', content: userMessage }],
            {
              providerId: promptModel.providerId ?? undefined,
              model: promptModel.model ?? undefined,
              temperature: promptModel.temperature ?? (this.agentConfig.temperature ?? LLM_DEFAULTS.temperature),
              maxTokens: promptModel.maxTokens ?? (this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens),
              responseFormat: this.agentConfig.force_structured_output ? { type: 'json_object' } : undefined,
              loggingMetadata: this.buildLoggingMetadata('react-pure-llm-retry', 0, 0),
            },
            this.currentSaveId || undefined,
          );
        };

        return {
          success: true,
          data: await parseLLMResponseWithRetry(loopCtx, { content: responseContent, iterations: 0 }, retryFn, reqCtx) as unknown as GameResponseData,
          messages: [message],
        };
      }

      const engineContext: ReActEngineContext = {
        systemPrompt: this.systemPrompt,
        userMessage,
        apiTools: tools as NonNullable<ChatOptions['tools']>,
        allowedFunctionNames: this.state.allowedFunctionNames,
        injectedContext: this.currentInjectedContext,
        injectedMethods: this.currentInjectedMethods,
        currentSaveId: this.currentSaveId,
        agentType: this.agentKey,
        agentKey: this.agentKey,
        maxIterations: this.maxIterations,
        forceStructuredOutput: this.forceStructuredOutput,
        temperature: promptModel.temperature ?? (this.agentConfig.temperature ?? LLM_DEFAULTS.temperature),
        maxTokens: promptModel.maxTokens ?? (this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens),
        providerId: promptModel.providerId ?? undefined,
        model: promptModel.model ?? undefined,
        currentAction: this.state.currentAction,
        autoLoadOnFirstUse: this.agentConfig.help?.autoLoadOnFirstUse,
        traceCollector: this.state.traceCollector,
        templateId: this.currentTemplateId,
        toolExposureState: reqCtx.toolExposureState,
        syncToolExposureState: (state) => this.syncRuntimeSnapshotToolExposureState(state),
        requestId,
        stagingPool: this.currentStagingPool,
        shadowState: this.currentShadowState,
        requestScope: reqCtx.requestScope,
        taskContent: this.buildTaskContent(agentRunId),
        ...this.buildPrepareNextTurnFields(),
      };

      const callToolFn: CallToolFn = async (toolType, method, params, saveId, _agentType) => {
        return this.callTool(toolType, method, params, saveId, reqCtx);
      };

      const hooks = this.toolExecutor.buildEngineHooks({ saveId: this.currentSaveId, requestId, agentRunId, agentName: this.agentKey, reqCtx });
      const llmResponse = await this.executeReActWithRecovery(
        engineContext,
        hooks,
        callToolFn,
        requestId,
        agentRunId,
        'subagent-react-loop',
        reqCtx,
      );

      this.extractMetaFromReActResult(llmResponse, reqCtx);

      const retryFn = async (): Promise<string> => {
        const retryResponse = await this.executeReActWithRecovery(
          engineContext,
          hooks,
          callToolFn,
          requestId,
          `${agentRunId}:retry`,
          'subagent-react-retry',
          reqCtx,
        );
        return retryResponse.content;
      };

      const response = {
        success: true,
        data: await this.parseSubAgentResponseWithRetry(
          loopCtx,
          llmResponse,
          retryFn,
          reqCtx,
        ) as unknown as GameResponseData,
        messages: [message],
        toolCalls: llmResponse.toolCalls,
      };
      this.applyPendingRuntimeRefreshes();
      return response;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`AgentRuntime processSubAgentPath failed: ${this.agentKey}`, { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
        messages: [message],
      };
    } finally {
      this.currentProgressContext = null;
      this.state.currentAction = undefined;
      this.setStatus(AgentStatus.IDLE);
    }
  }

  // ─── GM 路径 ───

  private async processGameMasterPath(message: AgentMessage, startTime: number): Promise<AgentResponse> {
    this.state.currentPath = 'game_master';
    this.resetRecoveryRuntimeState();

    const requestPayloadData = (message.payload?.data as Record<string, unknown>) || {};
    const reqCtx: RequestContext = {
      intentHint: '',
      stagingPool: this.currentStagingPool,
      shadowState: this.currentShadowState,
      traceIds: requestPayloadData.traceIds as Partial<ExecutionTraceIds> | undefined,
      requestScope: this.deps.createRequestScope(),
    };

    const action = message.payload?.action || (message.payload?.data as Record<string, unknown>)?.action as string | undefined || '';

    if (!message.saveId) {
      logger.error('Agent received message without saveId, this should be handled by game.ts');
      return { success: false, error: 'saveId is required', errorCode: 'SAVE_ID_REQUIRED' };
    }

    const effectiveSaveId = message.saveId;
    this.currentSaveId = effectiveSaveId;

    const isPoolGeneration = effectiveSaveId === '0' as ID;
    if (isPoolGeneration) {
      return this.processPoolGenerationPath(message, startTime, reqCtx);
    }

    const requestLanguage = (await this.resolveRequestLanguage(effectiveSaveId, requestPayloadData.language as string | undefined)) ?? null;

    const templateIdFromPayload = requestPayloadData.templateId as ID | undefined;
    const requestTemplateRuntime = await this.buildRequestTemplateRuntime(effectiveSaveId, templateIdFromPayload);

    await this.resolveTemplateId(effectiveSaveId, templateIdFromPayload);

    const devRequestId = requestPayloadData._devRequestId as string | undefined;
    if (devRequestId) {
      this.state.traceCollector = this.deps.createTraceCollector(devRequestId);
      this.deps.devModeService.setCoordinatorDecisions(devRequestId, []);
    }

    this.preprocessAction(message, action, effectiveSaveId, reqCtx);

    const triggeredRules = this.deps.promptModule.rules.getAllRulesForAgent('gamemaster', reqCtx.intentHint);
    if (triggeredRules.length > 0) {
      reqCtx.rulesTriggered = triggeredRules.map(r => r.name);
    }

    const sceneNPCData = await this.buildSceneNPCContext(effectiveSaveId);
    const { validIds: validatedNpcIds, invalidNpcIds } = this.validateTargetNpcIds(message, sceneNPCData);
    if (message.payload?.data) {
      (message.payload.data as Record<string, unknown>).sceneNPCs = sceneNPCData;
      (message.payload.data as Record<string, unknown>).targetNpcIds = validatedNpcIds;
    }

    let inCombat = false;
    try {
      // P1.2: 改用轻量 isInCombat 闭包（1 次 SELECT combat_states），
      // 替代原 combatServiceFactory + getCombatState（22 次 DB query + 11 次 YAML 解析）。
      const isInCombatChecker = this.gmDeps?.isInCombat;
      if (isInCombatChecker) {
        inCombat = await isInCombatChecker(effectiveSaveId);
      }
    } catch {
      logger.debug('Failed to check combat state, assuming not in combat');
    }
    if (message.payload?.data) {
      (message.payload.data as Record<string, unknown>).inCombat = inCombat;
    }

    return this.executeGameMasterReAct(
      message, effectiveSaveId, startTime,
      sceneNPCData, validatedNpcIds, invalidNpcIds, inCombat,
      requestTemplateRuntime.templateContext, requestLanguage, reqCtx,
    );
  }

  private async processPoolGenerationPath(message: AgentMessage, startTime: number, reqCtx: RequestContext): Promise<AgentResponse> {
    this.state.currentPath = 'pool_generation';
    this.resetRecoveryRuntimeState();
    const requestPayloadData = (message.payload?.data as Record<string, unknown>) || {};
    const templateId = requestPayloadData.templateId as ID | undefined;

    if (!templateId) {
      return { success: false, error: 'templateId is required for pool generation', errorCode: 'TEMPLATE_ID_REQUIRED' };
    }

    try {
      this.currentTemplateId = templateId;

      const intentHint = (requestPayloadData.intentHint as string) || 'generate_pool';
      if (message.payload) message.payload.intentHint = intentHint;
      reqCtx.intentHint = intentHint;
      this.state.currentAction = message.payload?.action as string || 'generate_pool';

      const categories = requestPayloadData.categories as string[] | undefined;
      const recommendedClasses = requestPayloadData.recommendedClasses as string[] | undefined;
      const batchSize = requestPayloadData.batchSize as number | undefined;
      const seed = requestPayloadData.seed as string | undefined;

      const triggeredRules = this.deps.promptModule.rules.getAllRulesForAgent('gamemaster', intentHint);
      if (triggeredRules.length > 0) {
        reqCtx.rulesTriggered = triggeredRules.map(r => r.name);
      }

      const availableAgents: Array<{ type: string; name: string; whenToInvoke: string; supportedIntents: string[] }> = [];
      for (const [agentType, agent] of this.agentInstances) {
        if (agentType === 'gamemaster') continue;
        const cap = AGENT_CAPABILITIES_DECLARATION[agentType];
        availableAgents.push({
          type: agentType, name: agent.name,
          whenToInvoke: cap?.whenToInvoke ?? '', supportedIntents: cap?.supportedIntents ?? [],
        });
      }

      const templateData = await this.deps.templateProvider.getTemplate(templateId) ?? null;
      const templateContext = await this.buildTemplateContextForPoolGeneration(templateData as unknown as Record<string, unknown> | null, categories, recommendedClasses, batchSize, seed);

      const promptContext: PromptContext = {
        agentKey: 'gamemaster',
        agentConfig: this.buildPromptAgentConfig(this.toolExecutor.getGrantedToolTypes()),
        excludedMethods: [],
        language: null,
        message: { payload: message.payload },
        templateContext,
        templateId,
        domain: {
          templateProvider: this.deps.templateProvider,
          graphService: this.deps.entityGraphService,
          specialRules: this.currentSpecialRules,
          storyDirective: null, postReviewDecision: null,
          saveId: '0' as ID, inCombat: false,
          sceneNPCs: [], targetNpcIds: [], availableAgents,
        },
        options: {},
      };

      const loopCtx = this.buildReActLoopContext();
      const requestId = this.resolveRuntimeSnapshotRequestId(message);
      const agentRunId = this.currentAgentRunId;
      const modelSelectHookResult = await this.dispatchHook(
        'before_model_select',
        requestId,
        agentRunId,
        {
          providerId: this.providerId ?? null,
          model: this.model ?? null,
          temperature: 0.9,
          maxTokens: 4096,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const selectedModel = resolveModelOverride(loopCtx, modelSelectHookResult.patch, {
        providerId: this.providerId ?? null,
        model: this.model ?? null,
        temperature: 0.9,
        maxTokens: 4096,
      });
      const promptHookResult = await this.dispatchHook(
        'before_prompt_build',
        requestId,
        agentRunId,
        {
          promptContext,
          reqCtx,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const hookedPromptContext = applyPromptContextPatch(promptContext, promptHookResult.patch);
      const promptModel = resolveModelOverride(loopCtx, promptHookResult.patch, selectedModel);
      const builtPromptResult = await this.deps.promptModule.build(hookedPromptContext);
      const toolExposeHookResult = await this.dispatchHook(
        'before_tool_expose',
        requestId,
        agentRunId,
        {
          promptResult: builtPromptResult,
          allowedFunctionNames: [...builtPromptResult.allowedFunctionNames],
          apiTools: builtPromptResult.apiTools,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const promptResult = applyToolExposePatch(builtPromptResult, toolExposeHookResult.patch);
      reqCtx.toolExposureState ??= createToolExposureRuntimeState(promptResult.toolExposureTrace);
      const runtimeSnapshot = this.bindRuntimeSnapshot(
        hookedPromptContext,
        promptResult,
        requestId,
        'react-pool-generation',
        reqCtx.toolExposureState,
      );
      const systemPrompt = runtimeSnapshot.promptSnapshot.systemPrompt;
      const userPrompt = runtimeSnapshot.promptSnapshot.userPrompt;
      const apiTools = promptResult.apiTools;
      const allowedFunctionNames = this.filterTemplatePoolToolsForGamePath(
        new Set(runtimeSnapshot.toolVisibilitySnapshot.allowedFunctionNames),
        this.state.currentAction,
      );
      this.systemPrompt = systemPrompt;

      const reactContext: ReActEngineContext = {
        systemPrompt, userMessage: userPrompt,
        apiTools: apiTools as NonNullable<ChatOptions['tools']>,
        allowedFunctionNames,
        injectedContext: '', injectedMethods: [],
        currentSaveId: '0' as ID,
        agentType: 'gamemaster', agentKey: 'gamemaster',
        maxIterations: this.maxIterations,
        forceStructuredOutput: false,
        temperature: promptModel.temperature ?? 0.9,
        maxTokens: promptModel.maxTokens ?? 4096,
        providerId: promptModel.providerId ?? undefined,
        model: promptModel.model ?? undefined,
        currentAction: this.state.currentAction,
        traceCollector: undefined,
        stagingPool: undefined, shadowState: undefined,
        templateId,
        toolExposureState: reqCtx.toolExposureState,
        syncToolExposureState: (state) => this.syncRuntimeSnapshotToolExposureState(state),
        requestId,
        requestScope: reqCtx.requestScope,
        ...this.buildPrepareNextTurnFields(),
      };

      const hooks = this.toolExecutor.buildEngineHooks({ saveId: '0' as ID, requestId, agentRunId, agentName: 'gamemaster', reqCtx });
      const callToolFn: CallToolFn = async (toolType, method, params, saveId, _agentType) => {
        return this.callTool(toolType, method, params, saveId, reqCtx);
      };

      this.reportProgress('thinking', { thought: 'Generating template pool data...' } as ThinkingDetail);

      const reactResult = await this.executeReActWithRecovery(
        reactContext,
        hooks,
        callToolFn,
        requestId,
        agentRunId,
        'pool-generation-react-loop',
        reqCtx,
      );
      this.extractMetaFromReActResult(reactResult, reqCtx);

      return this.buildPoolGenerationResponse(reactResult, startTime, reqCtx);
    } catch (error) {
      logger.error('Pool generation failed', {
        error: getErrorMessage(error),
        templateId,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Pool generation failed',
        errorCode: 'POOL_GENERATION_FAILED',
      };
    } finally {
      this.currentTemplateId = undefined;
      this.state.currentAction = undefined;
    }
  }

  private async buildTemplateContextForPoolGeneration(
    templateData: Record<string, unknown> | null,
    categories?: string[],
    recommendedClasses?: string[],
    batchSize?: number,
    seed?: string,
  ): Promise<string> {
    const parts: string[] = [];
    if (!templateData) {
      parts.push('模板数据不可用');
    } else {
      if (templateData.name) parts.push(`模板名称: ${templateData.name}`);
      if (templateData.worldSetting) parts.push(`世界设定: ${JSON.stringify(templateData.worldSetting)}`);
      if (templateData.characterCreation) parts.push(`角色创建选项: ${JSON.stringify(templateData.characterCreation)}`);
    }
    if (categories && categories.length > 0) parts.push(`指定生成分类: ${categories.join(', ')}`);
    if (recommendedClasses && recommendedClasses.length > 0) parts.push(`推荐职业: ${recommendedClasses.join(', ')}`);
    if (batchSize) parts.push(`每批生成数量: ${batchSize}`);
    if (seed) parts.push(`随机种子: ${seed}（影响创意方向）`);

    const templateId = templateData?.id as ID | undefined;
    if (templateId) {
      const poolService = this.deps.templatePoolProvider;
      const action = this.state.currentAction;
      if (action === 'generate_pool_skills') {
        const existingSkills = await poolService.listSkills(templateId);
        if (existingSkills.length > 0) {
          parts.push(`\n已有技能池数据（不可重复，参考风格和数值范围）:\n${JSON.stringify(existingSkills, null, 2)}`);
        } else {
          parts.push('\n技能池当前为空，无已有数据。');
        }
        const stats = await poolService.getPoolStats(templateId);
        parts.push(`技能池统计: ${JSON.stringify(stats)}`);
      } else if (action === 'generate_pool_items') {
        const existingItems = await poolService.listItems(templateId);
        if (existingItems.length > 0) {
          parts.push(`\n已有物品池数据（不可重复，参考风格和数值范围）:\n${JSON.stringify(existingItems, null, 2)}`);
        } else {
          parts.push('\n物品池当前为空，无已有数据。');
        }
        const stats = await poolService.getPoolStats(templateId);
        parts.push(`物品池统计: ${JSON.stringify(stats)}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * 路径屏蔽：游戏路径（chat/initialize 等）屏蔽 add_template_pool_* 工具。
   * 设计原则：模板池数据处理自动化，工具不暴露给 LLM。
   * LLM 只读模板池（list/get 工具），程序只写模板池（upsertSkill/upsertItem 自动调用）。
   * 仅 pool-generation 路径暴露 add_template_pool_* 工具（开发者审核后写入）。
   */
  private filterTemplatePoolToolsForGamePath(
    allowedFunctionNames: Set<string>,
    currentAction: string | undefined,
  ): Set<string> {
    const isGamePath = !currentAction || !currentAction.startsWith('generate_pool_');
    if (!isGamePath) return allowedFunctionNames;

    const filtered = new Set<string>();
    for (const name of allowedFunctionNames) {
      if (!name.includes('add_template_pool_skill') && !name.includes('add_template_pool_item')) {
        filtered.add(name);
      }
    }
    return filtered;
  }

  private buildPoolGenerationResponse(reactResult: ReActEngineResult, _startTime: number, _reqCtx: RequestContext): AgentResponse {
    const generatedData: { skills?: unknown[]; items?: unknown[] } = {};
    for (const tc of reactResult.toolCalls) {
      const toolName = tc._meta ? `${tc._meta.toolType}__${tc._meta.method}` : '';
      if (toolName === 'template_pool_service__add_template_pool_skills' && tc.data) {
        const result = tc.data as { success?: boolean; data?: { created?: unknown[]; errors?: unknown[] } };
        if (result.data?.created) {
          generatedData.skills = result.data.created;
        }
      }
      if (toolName === 'template_pool_service__add_template_pool_items' && tc.data) {
        const result = tc.data as { success?: boolean; data?: { created?: unknown[]; errors?: unknown[] } };
        if (result.data?.created) {
          generatedData.items = result.data.created;
        }
      }
    }
    const hasData = Object.values(generatedData).some(v =>
      Array.isArray(v) ? v.length > 0 : v != null,
    );
    const response = {
      success: true,
      data: {
        type: 'pool_generation',
        generated: generatedData,
        _meta: {
          generated: hasData,
          emptyResult: !hasData,
        },
      } as unknown as GameResponseData,
      messages: [],
      toolCalls: reactResult.toolCalls,
    };
    this.applyPendingRuntimeRefreshes();
    return response;
  }

  // ─── GM ReAct 编排 ───

  private async executeGameMasterReAct(
    message: AgentMessage,
    saveId: ID,
    startTime: number,
    sceneNPCs: Array<{ id: string; name: string; role?: string; services?: Array<{ type: string; name: string }>; disposition?: string; locationId?: string; locationName?: string; reachability?: string }>,
    validatedNpcIds: string[],
    invalidNpcIds: string[],
    inCombat: boolean,
    templateContext: string | null,
    requestLanguage: string | null,
    reqCtx: RequestContext,
  ): Promise<AgentResponse> {
    this.resetRecoveryRuntimeState();
    const requestId = this.resolveRuntimeSnapshotRequestId(message);
    const agentRunId = this.currentAgentRunId;

    if (!reqCtx.traceIds) reqCtx.traceIds = {};
    reqCtx.traceIds.agentRunId = agentRunId;
    reqCtx.traceIds.agentDepth = 0;

    this.emitRuntimeEvent(saveId, {
      type: 'request_started',
      at: Date.now(),
      traceIds: this.buildCurrentTraceIds(reqCtx),
      source: 'gamemaster',
      summary: `Request started: ${requestId}`,
    });

    const injected = await this.executeContextInjection(saveId, requestId);

    // Generate StoryMasterPlan for init (before GM ReAct loop — story blueprint first, then data)
    let storyDirective: StoryDirective | null = null;
    const storyKernel = this.gmDeps?.storyKernel;
    if (storyKernel && isInitAction(this.state.currentAction || '')) {
      try {
        // 构建增强模板上下文：包含 startingScene、NPCs、locations、initialData、characterCreation
        // 这些数据在 story-master-plan 提示词中明确要求但 getWorldContext() 不包含
        const enhancedCtx = await this.buildEnhancedInitTemplateContext(
          this.currentTemplateId || (message.payload.data as Record<string, unknown> | undefined)?.templateId as ID | undefined,
          templateContext,
        );

        const payloadData = message.payload.data as Record<string, unknown> | undefined;
        const masterPlan = await this.generateMasterPlan({
          saveId,
          templateContext: enhancedCtx,
          characterData: payloadData?.characterData as Record<string, unknown> | undefined,
        });
        if (masterPlan) {
          const initialCommit = storyKernel.buildInitialStoryState(masterPlan);
          await storyKernel.saveStoryState(saveId, initialCommit);
          // Inject masterPlan into message payload for GM prompt access
          const data = message.payload.data as Record<string, unknown>;
          data.masterPlan = masterPlan;
          logger.info('StoryMasterPlan generated for init', { saveId });
        }
      } catch (error) {
        logger.warn('Failed to generate StoryMasterPlan, continuing without it', {
          saveId,
          error: getErrorMessage(error),
        });
      }
    } else if (storyKernel && !isInitAction(this.state.currentAction || '')) {
      try {
        const entityGraphLayer = this.deps.entityGraphLayer;
        const graphOutput = await entityGraphLayer.build({
          agentKey: 'gamemaster',
          agentConfig: this.buildPromptAgentConfig(this.toolExecutor.getGrantedToolTypes()),
          excludedMethods: injected.injectedMethods,
          language: null,
          message: { payload: message.payload },
          templateContext,
          templateId: this.currentTemplateId,
          domain: {
            templateProvider: this.deps.templateProvider,
            graphService: this.deps.entityGraphService,
            saveId,
            inCombat,
            sceneNPCs,
            targetNpcIds: validatedNpcIds,
            availableAgents: [],
          },
          options: {},
        } as PromptContext);
        const entityGraphXml = graphOutput.content;

        const storyRequestContext = await storyKernel.prepareRequestContext(saveId);
        storyDirective = await this.generateStoryDirective({
          saveId,
          message,
          reqCtx,
          templateContext,
          storySnapshot: storyRequestContext.snapshot,
          projection: storyRequestContext.projection,
          worldState: storyRequestContext.worldState,
          sceneNPCs,
          inCombat,
          entityGraphXml,
        });
        this.currentStoryDirective = storyDirective;
      } catch (error) {
        logger.warn('Failed to generate StoryDirective, continuing without it', {
          saveId,
          error: getErrorMessage(error),
        });
      }
    }

    // StagingPool + ShadowState (controlled by enableStagingPool config)
    // 13.1 规则: enableStagingPool 默认启用，ReAct 循环工具写操作必须经 StagingKnex 代理走 StagingPool。
    // 禁止以"未启用"为由走 writeQueue 直写 DB。
    const enableStagingPool = this.agentConfig.enableStagingPool ?? true;
    const stagingPool = reqCtx.stagingPool ?? this.deps.createStagingPool();
    const shadowState = reqCtx.shadowState ?? this.createShadowState(saveId, enableStagingPool);

    if (enableStagingPool) {
      if (!reqCtx.stagingPool) {
        stagingPool.bindShadowState(shadowState);
        stagingPool.bindGraphUpdater(this.deps.entityGraphUpdater, saveId, requestId);
      }
      if (!reqCtx.shadowState) {
        await shadowState.ensureSnapshot();
      }

      reqCtx.stagingPool = stagingPool;
      reqCtx.shadowState = shadowState;
    }

    let finalResponse: AgentResponse | undefined;

    try {
      const availableAgents: Array<{ type: string; name: string; whenToInvoke: string; supportedIntents: string[] }> = [];
      for (const [agentType, agent] of this.agentInstances) {
        if (agentType === 'gamemaster') continue;
        const cap = AGENT_CAPABILITIES_DECLARATION[agentType];
        availableAgents.push({
          type: agentType,
          name: agent.name,
          whenToInvoke: cap?.whenToInvoke ?? '',
          supportedIntents: cap?.supportedIntents ?? [],
        });
      }

      const npcService = await this.deps.npcServiceFactory(saveId);
      const promptContext: PromptContext = {
        agentKey: 'gamemaster',
        agentConfig: this.buildPromptAgentConfig(this.toolExecutor.getGrantedToolTypes()),
        excludedMethods: injected.injectedMethods,
        language: requestLanguage,
        message: { payload: message.payload },
        templateContext,
        templateId: this.currentTemplateId,
        domain: {
          templateProvider: this.deps.templateProvider,
          graphService: this.deps.entityGraphService,
          npcService,
          specialRules: this.currentSpecialRules,
          storyDirective: storyDirective || this.currentStoryDirective,
          postReviewDecision: null,
          saveId,
          inCombat,
          sceneNPCs,
          targetNpcIds: validatedNpcIds,
          availableAgents,
        },
        options: {},
      };

      const loopCtx = this.buildReActLoopContext();
      const modelSelectHookResult = await this.dispatchHook(
        'before_model_select',
        requestId,
        agentRunId,
        {
          providerId: this.providerId ?? null,
          model: this.model ?? null,
          temperature: this.agentConfig.temperature ?? LLM_DEFAULTS.temperature,
          maxTokens: this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const selectedModel = resolveModelOverride(loopCtx, modelSelectHookResult.patch);
      const promptHookResult = await this.dispatchHook(
        'before_prompt_build',
        requestId,
        agentRunId,
        {
          promptContext,
          reqCtx,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const hookedPromptContext = applyPromptContextPatch(promptContext, promptHookResult.patch);
      const promptModel = resolveModelOverride(loopCtx, promptHookResult.patch, selectedModel);
      const builtPromptResult = await this.deps.promptModule.build(hookedPromptContext);
      const toolExposeHookResult = await this.dispatchHook(
        'before_tool_expose',
        requestId,
        agentRunId,
        {
          promptResult: builtPromptResult,
          allowedFunctionNames: [...builtPromptResult.allowedFunctionNames],
          apiTools: builtPromptResult.apiTools,
        },
        undefined,
        this.currentHookPlacement(),
      );
      const promptResult = applyToolExposePatch(builtPromptResult, toolExposeHookResult.patch);
      reqCtx.toolExposureState ??= createToolExposureRuntimeState(promptResult.toolExposureTrace);

      const exposedToolCount = promptResult.apiTools?.length ?? 0;
      this.emitRuntimeEvent(saveId, {
        type: 'tool_exposed',
        at: Date.now(),
        traceIds: this.buildCurrentTraceIds(reqCtx),
        source: 'gamemaster',
        summary: `Tools exposed: ${exposedToolCount} functions available`,
        detail: { exposedToolCount, allowedFunctionNames: [...promptResult.allowedFunctionNames] },
      });

      const promptLayerCount = promptResult.systemPromptTrace?.layers?.length ?? 0;
      this.emitRuntimeEvent(saveId, {
        type: 'prompt_built',
        at: Date.now(),
        traceIds: this.buildCurrentTraceIds(reqCtx),
        source: 'gamemaster',
        summary: `Prompt built with ${promptLayerCount} layers`,
        detail: { layerCount: promptLayerCount },
      });

      const runtimeSnapshot = this.bindRuntimeSnapshot(
        hookedPromptContext,
        promptResult,
        requestId,
        'react-gamemaster',
        reqCtx.toolExposureState,
      );
      const systemPrompt = runtimeSnapshot.promptSnapshot.systemPrompt;
      const userPrompt = runtimeSnapshot.promptSnapshot.userPrompt;
      const apiTools = promptResult.apiTools;
      const allowedFunctionNames = this.filterTemplatePoolToolsForGamePath(
        new Set(runtimeSnapshot.toolVisibilitySnapshot.allowedFunctionNames),
        this.state.currentAction,
      );
      this.systemPrompt = systemPrompt;
      // 模块3 L2-2：注入上一轮后处理引导生成的 perceptionUpdateHint（一次性消费）
      // MEDIUM-3 第三轮修订：注入点为 react-gamemaster 路径 systemPrompt 赋值之后
      this.systemPrompt = this.consumePerceptionHint() + this.systemPrompt;

      this.emitRuntimeEvent(saveId, {
        type: 'snapshot_built',
        at: Date.now(),
        traceIds: this.buildCurrentTraceIds(reqCtx),
        source: 'gamemaster',
        summary: `Runtime snapshot built for request ${requestId}`,
        detail: { requestId, allowedFunctionCount: allowedFunctionNames.size },
      });

      const isInitPhase = isInitAction(this.state.currentAction || '');
      const preExecutedToolCalls = isInitPhase
        ? await this.toolExecutor.executeInitDeterministicActions(saveId, reqCtx)
        : await this.toolExecutor.executeDeterministicActions(saveId, reqCtx);

      const reactContext: ReActEngineContext = {
        systemPrompt,
        userMessage: userPrompt,
        apiTools: apiTools as NonNullable<ChatOptions['tools']>,
        allowedFunctionNames,
        injectedContext: injected.context,
        injectedMethods: injected.injectedMethods,
        currentSaveId: saveId,
        agentType: 'gamemaster',
        agentKey: 'gamemaster',
        maxIterations: this.maxIterations,
        forceStructuredOutput: true,
        temperature: promptModel.temperature ?? (this.agentConfig.temperature ?? LLM_DEFAULTS.temperature),
        maxTokens: promptModel.maxTokens ?? (this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens),
        providerId: promptModel.providerId ?? undefined,
        model: promptModel.model ?? undefined,
        currentAction: this.state.currentAction,
        traceCollector: this.state.traceCollector,
        stagingPool,
        shadowState,
        preExecutedToolCalls: preExecutedToolCalls.length > 0 ? preExecutedToolCalls : undefined,
        templateId: this.currentTemplateId,
        toolExposureState: reqCtx.toolExposureState,
        syncToolExposureState: (state) => this.syncRuntimeSnapshotToolExposureState(state),
        requestId,
        requestScope: reqCtx.requestScope,
        taskContent: this.buildTaskContent(agentRunId),
        ...this.buildPrepareNextTurnFields(),
      };

      const hooks = this.toolExecutor.buildEngineHooks({ saveId, requestId, agentRunId, agentName: 'gamemaster', reqCtx });
      const callToolFn: CallToolFn = async (toolType, method, params, saveId, _agentType) => {
        return this.callTool(toolType, method, params, saveId, reqCtx);
      };

      this.reportProgress('thinking', { thought: 'Processing via ReAct loop...' } as ThinkingDetail);

      const reactResult = await this.executeReActWithRecovery(
        reactContext,
        hooks,
        callToolFn,
        requestId,
        agentRunId,
        'gamemaster-react-loop',
        reqCtx,
      );

      this.extractMetaFromReActResult(reactResult, reqCtx);

      // 提前 flush StagingPool 到 DB，确保后续 DataRefreshHandler 读到已提交数据。
      // 原 finally 块中 stagingPool.flush 晚于 buildGameMasterFinalResponse 内的
      // DataRefreshHandler.refreshAll()，导致面板刷新数据为陈旧值（根因排查见
      // bug-hunt-20260720-travel-panel-not-update.md）。
      if (stagingPool.hasWrites() && this.deps.writeQueue) {
        try {
          this.lastRequestWriteCount = stagingPool.writeCount;
          await stagingPool.flush(this.deps.writeQueue);
          this.deps.graphServiceCache.invalidate(saveId);

          if (stagingPool.isDirtyAfterFlush()) {
            logger.warn('StagingPool partial flush detected before response building, reloading shadow snapshot', {
              requestId,
              failedWrites: stagingPool.getFailedWrites().length,
            });
            try {
              await this.dispatchHook('before_compaction', requestId, agentRunId, {
                reason: 'partial_flush_recovery',
                saveId,
                failedWrites: stagingPool.getFailedWrites().length,
              });
            } catch (hookError) {
              logger.warn('before_compaction hook failed during partial flush recovery', {
                error: getErrorMessage(hookError),
              });
            }
            stagingPool.clearDirtyAfterFlush();
          }
        } catch (flushError) {
          logger.error('StagingPool flush failed before response building', {
            error: getErrorMessage(flushError),
          });
          stagingPool.clear();
          // 数据未落库，无法构建有效响应，throw 由外层 handleGameMessage 处理
          throw flushError;
        }
      } else if (stagingPool.hasWrites()) {
        logger.error('StagingPool has writes but no writeQueue, discarding staged writes', {
          writeCount: stagingPool.writeCount,
        });
        stagingPool.clear();
      }

      // v5.2 EC8: 移除 repairExecutor（post-react repair 循环已删除）
      // 审核统一由 on_task_complete hook 在 ReAct loop 内处理
      try {
        finalResponse = await this.buildGameMasterFinalResponse(
          reactResult, message, saveId, startTime, invalidNpcIds, stagingPool, shadowState,
        );
      } catch (error) {
        if (error instanceof PostReactRepairFailureError) {
          logger.error('Post-react repair failed, clearing staged writes before aborting request', {
            saveId,
            writeCount: stagingPool.writeCount,
            error: error.message,
          });
          stagingPool.clear();
        }
        throw error;
      }

      this.memoryController.triggerCompression(saveId);
      this.applyPendingRuntimeRefreshes();

      if (!finalResponse) throw new Error('Unreachable: finalResponse unset after try-catch');
      return finalResponse;
    } finally {
      // post-flush 事件处理（架构规范 §13.1）
      // ReAct 循环已结束，§13.1 不再适用，可安全使用原始 db 处理 pending EventBus 事件。
      // bootstrap 转发器在 ReAct 循环内将事件入队（pushEvent），此处 drain 并处理。
      // StagingPool flush 已前置到 buildGameMasterFinalResponse 之前。
      await this.drainAndProcessPendingBusEvents();
      // EG-M4-5: GM 路径在 flush + 事件处理成功后触发定期纠错检查
      if (this.gmDeps && this.lastRequestWriteCount > 0) {
        try {
          await this.triggerReconcileIfNeeded(saveId);
        } catch (reconcileError) {
          // reconcile 失败不影响已提交的 flush（数据已落库）
          logger.error('Entity Graph reconcile failed (threshold triggered)', {
            saveId,
            error: getErrorMessage(reconcileError),
          });
        }
      }

      this.currentProgressContext = null;
      this.currentStoryDirective = null;
      this.currentPostReviewDecision = null;
      this.currentPacingState = undefined;
      this.currentPacingReviewResult = undefined;
      this.state.currentAction = undefined;
      this.state.pendingRuntimeRefreshes = [];
      this.state.pendingPerceptionHint = null;  // 模块3 L2-2：清理感知提示，避免跨请求残留
      this.state.traceCollector = undefined;
      this.currentTemplateId = undefined;

      reqCtx.stagingPool = undefined;
      reqCtx.shadowState = undefined;
    }
  }

  /**
   * FOLLOWUP-3: 排空并处理 per-request pending EventBus 事件。
   *
   * 在 StagingPool.flush 之后调用（post-flush 阶段）。ReAct 循环已结束，
   * 架构规范 §13.1 不再适用，可安全使用 bootstrap 实例（原始 db）处理事件。
   *
   * 事件链保护：handleGameEvent 可能触发 quest_update，handleBusEvent 可能触发
   * trigger_resolved/story_progress，这些新事件会再次入队。使用 while 循环 +
   * MAX_ITERATIONS=5 防止无限循环（与 EventBus MAX_EVENT_DEPTH=5 对称）。
   */
  private async drainAndProcessPendingBusEvents(): Promise<void> {
    const MAX_ITERATIONS = 5;
    let iterations = 0;
    let pending = this.deps.requestEventBridge.drainPendingEvents();

    while (pending.length > 0 && iterations < MAX_ITERATIONS) {
      for (const event of pending) {
        try {
          if (QUEST_EVENT_TYPES.includes(event.type)) {
            await this.deps.bootstrapEventHandlers.questService.handleGameEvent(event);
          }
          if (EVENT_SERVICE_EVENT_TYPES.includes(event.type)) {
            await this.deps.bootstrapEventHandlers.eventService.handleBusEvent(event);
          }
        } catch (error) {
          logger.error('Post-flush event processing failed', {
            eventType: event.type,
            saveId: event.saveId,
            error: getErrorMessage(error),
          });
        }
      }
      pending = this.deps.requestEventBridge.drainPendingEvents();
      iterations++;
    }

    if (pending.length > 0) {
      logger.warn('Post-flush event processing exceeded max iterations, discarding', {
        remaining: pending.length,
        iterations,
      });
    }
  }

  // ─── StoryDirective 生成 ───

  /**
   * 初始化阶段生成 StoryMasterPlan（故事蓝图）。
   * 在 GM ReAct 循环启动前调用，确保"先故事后数据"的初始化时序。
   */
  private async generateMasterPlan(
    context: { saveId: ID; templateContext: string | null; characterData?: Record<string, unknown> },
  ): Promise<StoryMasterPlan | null> {
    const masterPlanPrompt = this.loadPromptFile('story-master-plan');
    if (!masterPlanPrompt) {
      logger.debug('story-master-plan prompt not found, skipping StoryMasterPlan generation');
      return null;
    }

    const userMessageLines = [
      `## 模板世界观`,
      context.templateContext || '无',
      ``,
      `## 角色创建数据`,
      context.characterData
        ? JSON.stringify(context.characterData, null, 2)
        : '无',
      ``,
      `生成 StoryMasterPlan JSON 对象。`,
    ];

    const userMessage = userMessageLines.join('\n');

    try {
      // M9：经 LLMRequestDispatcher 调度
      const rawContent = (await this.chatViaDispatcher(
        [
          { role: 'system', content: masterPlanPrompt },
          { role: 'user', content: userMessage },
        ],
        {
          providerId: this.providerId,
          model: this.model,
          temperature: 0.3,
          maxTokens: 1200,
          responseFormat: { type: 'json_object' },
          loggingMetadata: this.buildLoggingMetadata('story-master-plan', 0, 0),
        },
        context.saveId,
      )) || '';
      if (!rawContent.trim()) {
        logger.warn('Empty response from story-master-plan LLM');
        return null;
      }

      // 复用项目通用的 LLM JSON 解析工具：自动剥离 markdown 代码块、
      // 修复截断 JSON、snake_case → camelCase 规范化
      const { parseLLMJson } = await import('../utils/llm-json.js');
      const parsed = parseLLMJson<StoryMasterPlan>(rawContent, 'story-master-plan');

      // Validate required fields
      if (!parsed.initialProjection?.chapter || !parsed.initialProjection?.mainQuest) {
        logger.warn('StoryMasterPlan missing required initialProjection fields', {
          saveId: context.saveId,
        });
        return null;
      }

      return parsed;
    } catch (error) {
      logger.warn('Failed to parse StoryMasterPlan from LLM response', {
        saveId: context.saveId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  private async generateStoryDirective(
    context: StoryDirectiveGenerationContext,
  ): Promise<StoryDirective | null> {
    const storyKernel = this.gmDeps?.storyKernel;
    if (!storyKernel) return null;

    const orchestrationPrompt = this.loadPromptFile('story-orchestration');
    if (!orchestrationPrompt) {
      logger.debug('story-orchestration prompt not found, skipping StoryDirective generation');
      return null;
    }

    const playerInput = this.resolveStoryDirectivePlayerInput(context.message);
    const intentHint = context.reqCtx.intentHint || 'chat';
    const currentProjection = this.resolveStoryDirectiveProjection(context);

    let pacingConstraints: PacingConstraints | null = null;
    if (storyKernel.isPacingEnabled()) {
      try {
        const pacingState = await storyKernel.computePacingState(
          context.saveId,
          context.worldState,
          context.storySnapshot,
          currentProjection,
          context.templateContext ?? undefined,
        );
        const densityResult = await storyKernel.assessEventDensity(context.saveId, pacingState.config);
        const speedResult = await storyKernel.assessProgressSpeed(context.saveId, pacingState.config);
        pacingConstraints = storyKernel.generatePacingConstraints(pacingState, densityResult, speedResult);
        this.currentPacingState = pacingState;
      } catch (error) {
        logger.warn('Pacing engine failed, continuing without pacing constraints', {
          saveId: context.saveId,
          error: getErrorMessage(error),
        });
      }
    }

    const userMessageLines = [
      `## 模板世界观`,
      context.templateContext || '无',
      ``,
      `## 当前故事状态`,
      `章节: ${currentProjection.chapter || '未知'}`,
      `主线任务: ${currentProjection.mainQuest || '未知'}`,
      `近期事件: ${this.summarizeRecentEvents({ snapshot: context.storySnapshot, projection: currentProjection, worldState: context.worldState })}`,
      `世界状态: ${this.summarizeWorldState(context.worldState)}`,
      ``,
      context.storySnapshot.context.agentContext?.state
        ? storyKernel.buildCharacterContext(
            (context.storySnapshot.context.agentContext.state as Record<string, unknown> | null)?.runtimeState as Record<string, unknown> ?? {}
          )
        : '',
      `## 当前游戏状态`,
      `战斗中: ${context.inCombat ? '是' : '否'}`,
      `场景NPC: ${context.sceneNPCs.map(n => n.name).join(', ') || '无'}`,
      ``,
      `## 实体关系图`,
      context.entityGraphXml || '无数据',
    ];

    if (pacingConstraints) {
      userMessageLines.push(
        ``,
        `## 节奏约束`,
        `紧张度: ${pacingConstraints.tension.toFixed(1)}/100`,
        `节奏阶段: ${pacingConstraints.stage}`,
        `事件密度指导: ${pacingConstraints.densityGuidance}`,
        `推进速度指导: ${pacingConstraints.speedGuidance}`,
      );
    }

    userMessageLines.push(
      ``,
      `## 玩家输入`,
      `意图: ${intentHint}`,
      `内容: ${playerInput}`,
      ``,
      `生成 StoryDirective JSON 对象，包含 todoList 字段。`,
    );

    const userMessage = userMessageLines.join('\n');

    // M9：经 LLMRequestDispatcher 调度
    const content = await this.chatViaDispatcher(
      [
        { role: 'system', content: orchestrationPrompt },
        { role: 'user', content: userMessage },
      ],
      {
        providerId: this.providerId,
        model: this.model,
        temperature: 0.3,
        maxTokens: 800,
        responseFormat: { type: 'json_object' },
        loggingMetadata: this.buildLoggingMetadata('story-directive', 0, 0),
      },
      context.saveId,
    );
    const parsedDirective = this.parseStoryDirectiveFromLLM(content);

    if (parsedDirective) {
      const directive = storyKernel.normalizeStoryDirective(parsedDirective, currentProjection);
      if (pacingConstraints) {
        directive.constraints = { ...directive.constraints, pacing: pacingConstraints };
      }
      return directive;
    }

    return null;
  }

  private resolveStoryDirectiveProjection(
    context: StoryDirectiveGenerationContext,
  ): StoryProjection {
    return {
      chapter: context.projection.chapter
        ?? context.storySnapshot.chapter.chapter
        ?? (context.storySnapshot.context as { currentChapter?: string }).currentChapter
        ?? null,
      mainQuest: context.projection.mainQuest
        ?? context.storySnapshot.chapter.mainQuest
        ?? (context.storySnapshot.context as { mainQuest?: string }).mainQuest
        ?? null,
    };
  }

  private resolveStoryDirectivePlayerInput(message: AgentMessage): string {
    const payloadData = message.payload?.data;
    if (!payloadData || typeof payloadData !== 'object' || Array.isArray(payloadData)) {
      return '';
    }

    const data = payloadData as Record<string, unknown>;
    const selectedDialogueOption = data.selectedDialogueOption;
    const selectedDialogueOptionRecord =
      selectedDialogueOption && typeof selectedDialogueOption === 'object' && !Array.isArray(selectedDialogueOption)
        ? selectedDialogueOption as Record<string, unknown>
        : null;

    return this.firstNonEmptyStoryDirectiveInput([
      data.playerInput,
      data.interactionMessage,
      selectedDialogueOptionRecord?.text,
      selectedDialogueOptionRecord?.message,
    ]);
  }

  private firstNonEmptyStoryDirectiveInput(values: unknown[]): string {
    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  /** 摘要近期事件 */
  private summarizeRecentEvents(ctx: StoryRequestContext): string {
    const events = ctx.snapshot?.history?.events;
    if (!events || events.length === 0) return '无';
    return events.slice(0, 5).map(e => e.title || e.description || '未知事件').join('; ');
  }

  /** 摘要世界状态 */
  private summarizeWorldState(ws: WorldStateSummary | undefined): string {
    if (!ws) return '无';
    return `节点${ws.nodeCount}/边${ws.edgeCount} (${Object.entries(ws.nodesByType).map(([t, c]) => `${t}:${c}`).join(', ')})`;
  }

  private parseStoryDirectiveFromLLM(content: string): Record<string, unknown> | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      }
    } catch {
      logger.debug('Failed to parse StoryDirective JSON from LLM output');
    }
    return null;
  }

  private loadPromptFile(promptName: string): string | null {
    try {
      const promptPath = resolve(process.env.AGENT_CONFIG_DIR || resolve(process.cwd(), 'config'), 'agent-profiles', 'prompts', `${promptName}.md`);
      return readFileSync(promptPath, 'utf-8');
    } catch {
      return null;
    }
  }

  // ─── Runtime Snapshot 管理 ───

  private resolveRuntimeSnapshotRequestId(message: AgentMessage): string {
    return typeof message.id === 'string' && message.id.length > 0
      ? message.id
      : randomUUID();
  }

  private extractRuntimeSnapshotTraceNames(
    promptResult: PromptBuildResult,
    layerName: string,
    metadataKey: string,
  ): string[] {
    const layer = promptResult.systemPromptTrace?.layers.find((entry) => entry.name === layerName);
    const values = layer?.metadata?.[metadataKey];
    if (!Array.isArray(values)) {
      return [];
    }
    return values.filter((value): value is string => typeof value === 'string');
  }

  private createRuntimeSnapshotFromPrompt(
    promptContext: PromptContext,
    promptResult: PromptBuildResult,
    requestId: string,
    source: string,
    toolExposureState?: ToolExposureRuntimeState,
  ): AgentRuntimeSnapshot {
    const toolVisibilityTrace = promptResult.toolVisibilityTrace ?? [];
    const toolExposureTrace = promptResult.toolExposureTrace;
    return {
      requestId,
      sessionId: this.currentSaveId || (promptContext.domain.saveId as string | undefined) || 'unknown-session',
      agentKey: promptContext.agentKey,
      createdAt: Date.now(),
      modelSnapshot: {
        providerId: this.providerId ?? null,
        model: this.model ?? null,
        temperature: this.agentConfig.temperature ?? LLM_DEFAULTS.temperature,
        maxTokens: this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens,
      },
      permissionSnapshot: {
        configuredTools: [...this.agentConfig.tools],
        defaultDeny: true,
      },
      ruleSnapshot: this.extractRuntimeSnapshotTraceNames(promptResult, 'rules', 'ruleNames').map((name) => ({
        name,
        source: 'prompt-build',
      })),
      skillSnapshot: this.extractRuntimeSnapshotTraceNames(promptResult, 'skills', 'skillNames').map((name) => ({
        name,
        source: 'prompt-build',
      })),
      helpSnapshot: [],
      toolVisibilitySnapshot: {
        allowedToolTypes: toolVisibilityTrace.map((entry) => entry.toolType),
        allowedFunctionNames: [...promptResult.allowedFunctionNames],
        deferredFunctionNames: toolExposureTrace?.deferredTools?.map((entry) => entry.functionName) ?? [],
        toolExposureBudget: mergeToolExposureBudget(toolExposureTrace?.budget, toolExposureState),
      },
      promptSnapshot: {
        systemPrompt: promptResult.systemPrompt,
        userPrompt: promptResult.userPrompt,
      },
      contextSnapshot: {
        language: promptContext.language,
        templateId: promptContext.templateId ?? null,
      },
      debugSnapshot: {
        source,
      },
    };
  }

  private bindRuntimeSnapshot(
    promptContext: PromptContext,
    promptResult: PromptBuildResult,
    requestId: string,
    source: string,
    toolExposureState?: ToolExposureRuntimeState,
  ): AgentRuntimeSnapshot {
    const snapshot = this.createRuntimeSnapshotFromPrompt(
      promptContext,
      promptResult,
      requestId,
      source,
      toolExposureState,
    );
    this.setRuntimeSnapshot(snapshot);
    return this.getRuntimeSnapshot() ?? snapshot;
  }

  private syncRuntimeSnapshotToolExposureState(toolExposureState: ToolExposureRuntimeState): void {
    const currentSnapshot = this.getRuntimeSnapshot();
    if (!currentSnapshot?.toolVisibilitySnapshot.toolExposureBudget) {
      return;
    }

    const newToolExposureBudget = mergeToolExposureBudget(
      currentSnapshot.toolVisibilitySnapshot.toolExposureBudget,
      toolExposureState,
    );
    const helpSnapshotKeys = new Set(
      currentSnapshot.helpSnapshot.map((entry) => `${entry.tool}.${entry.method}`),
    );
    const newHelpSnapshot = [...currentSnapshot.helpSnapshot];
    for (const entry of this.currentInjectedMethods) {
      const key = `${entry.source}.${entry.method}`;
      if (helpSnapshotKeys.has(key)) {
        continue;
      }
      newHelpSnapshot.push({
        tool: entry.source,
        method: entry.method,
      });
      helpSnapshotKeys.add(key);
    }

    const newSnapshot = {
      ...currentSnapshot,
      toolVisibilitySnapshot: {
        ...currentSnapshot.toolVisibilitySnapshot,
        toolExposureBudget: newToolExposureBudget,
      },
      helpSnapshot: newHelpSnapshot,
    } as AgentRuntimeSnapshot;
    this.setRuntimeSnapshot(newSnapshot);
  }

  private applyPendingRuntimeRefreshes(): AgentRuntimeSnapshot | null {
    const nextSnapshot = this.state.pendingRuntimeRefreshes.at(-1) ?? null;
    this.state.pendingRuntimeRefreshes = [];
    if (!nextSnapshot) {
      return null;
    }
    this.setRuntimeSnapshot(nextSnapshot);
    return this.getRuntimeSnapshot();
  }

  queueRuntimeSnapshotRefresh(snapshot: AgentRuntimeSnapshot): void {
    this.state.pendingRuntimeRefreshes.push(snapshot);
  }

  private preprocessAction(message: AgentMessage, action: string, _saveId: ID, reqCtx: RequestContext): void {
    this.state.currentAction = action;

    // 初始化动作统一映射 intentHint='initialize'：
    // - 让 SkillLayer 通过 getSkillsByIntent 匹配 trigger:[initialize] 的 game-initialization 技能
    // - 让 RulesLayer 触发 hook 含 'initialize' 的 init-convergence 等规则
    // - 避免 LLM 因技能未注入而反复调用 load_skill 浪费迭代
    if (isInitAction(action)) {
      if (message.payload) message.payload.intentHint = 'initialize';
      reqCtx.intentHint = 'initialize';
      return;
    }

    const initialIntentHint = (message.payload?.intentHint as string) || (message.payload?.data as Record<string, unknown>)?.interactionType as string || 'chat';

    if ((action === 'chat' || action === 'dialogue-LLM') && (initialIntentHint === 'select' || initialIntentHint === 'dialogue')) {
      const payloadData = (message.payload?.data ?? {}) as Record<string, unknown>;
      const playerAction = payloadData.playerAction as Record<string, unknown> | undefined;
      const selectedOptionId = String(playerAction?.selectedOptionId ?? payloadData.selectedOptionId ?? '');
      const targetNpcId = String(playerAction?.targetNpcId ?? payloadData.targetNpcId ?? '');
      const optionText = String(playerAction?.optionText ?? payloadData.optionText ?? payloadData.message ?? '');

      if (message.payload?.data) {
        (message.payload.data as Record<string, unknown>).selectedDialogueOption = {
          optionId: selectedOptionId, npcId: targetNpcId, text: optionText,
        };
      }
    }

    if (action === 'ui_interaction' && message.payload) {
      const payloadData = (message.payload.data as Record<string, unknown>) || {};
      const interactionType = payloadData.interactionType as string | undefined;
      const target = payloadData.target as string | undefined;

      if (interactionType) {
        const mapping = INTERACTION_MAPPING[interactionType];
        const resolvedSuffix = mapping
          ? mapping.messageSuffix.replace('{target}', target ?? '')
          : `${interactionType}${target ? ` ${target}` : ''}`;
        message.payload.intentHint = interactionType;
        (message.payload.data as Record<string, unknown>).interactionMessage = resolvedSuffix;
      }
    }

    if (message.payload) message.payload.intentHint = initialIntentHint;
    reqCtx.intentHint = initialIntentHint;
  }

  private extractMetaFromReActResult(reactResult: ReActEngineResult, reqCtx: RequestContext): void {
    if (reactResult.usage) {
      reqCtx.tokenUsage = reactResult.usage;
    }

    for (const tc of reactResult.toolCalls) {
      if (tc._meta?.toolType === 'skill_loader' && tc._meta?.method === 'load_skill' && tc.success) {
        const params = tc._meta.params as Record<string, unknown> | undefined;
        if (params?.skillName && typeof params.skillName === 'string') {
          reqCtx.skillUsed = params.skillName;
        }
      }
    }

    // 消费 LLM 自报告的 debug 信息（从 content 中剥离后附加到 result.debug）
    if (reactResult.debug) {
      this.consumeLlmDebugReport(reactResult.debug);
    }
  }

  /**
   * 消费 LLM 自报告的 debug 信息，三路记录：
   * 1. DevTraceCollector（持久化到内存 Map）— 由 devTraceHook 内部处理
   * 2. logger（控制台日志）
   * 3. WebSocket 广播 dev:llm_debug 事件（实时推送 DevTools）— 由 devTraceHook 内部处理
   *
   * AP-L1 修复: 三路记录中的 1+3 统一走 devTraceHook.emit 入口，
   * 消除重复的 getClientIdBySaveId + broadcastToClient + try-catch + warn 模式。
   */
  private consumeLlmDebugReport(debug: LlmDebugReport): void {
    const saveId = this.currentSaveId;
    if (!saveId) return;

    // logger 记录（INFO 级别，便于排查）— 独立于 devTraceHook，保持原 logger 行为
    logger.info(`[LLM_DEBUG] ${debug.agentType} reported ${debug.issues.length} issue(s)`, {
      agent: debug.agentType,
      issues: debug.issues.map(i => ({ type: i.type, description: i.description, toolName: i.toolName })),
    });

    // DevTraceCollector 持久化 + WebSocket 广播 — 统一走 devTraceHook
    this.deps.devTraceHook.emit({
      type: 'llm_debug',
      saveId,
      data: {
        agentType: debug.agentType,
        issues: debug.issues,
        requestId: this.currentRequestId,
      },
    });
  }

  private buildPromptAgentConfig(tools: string[]): PromptContext['agentConfig'] {
    return {
      tools: [...tools],
      maxIterations: this.maxIterations,
      toolBudget: this.agentConfig.toolBudget
        ? structuredClone(this.agentConfig.toolBudget)
        : undefined,
    };
  }

  getPromptAgentConfig(agentKey: string = this.agentKey): PromptContext['agentConfig'] | null {
    if (agentKey === this.agentKey) {
      const tools = this.isSubAgent ? this.agentConfig.tools : this.toolExecutor.getGrantedToolTypes();
      return this.buildPromptAgentConfig(tools);
    }

    const targetAgent = this.getAgent(agentKey as AgentType);
    if (targetAgent instanceof AgentRuntime) {
      return targetAgent.getPromptAgentConfig();
    }

    return null;
  }

  // ─── GM 最终响应构建 ───

  private async buildGameMasterFinalResponse(
    reactResult: ReActEngineResult,
    message: AgentMessage,
    saveId: ID,
    startTime: number,
    invalidNpcIds: string[],
    stagingPool: StagingPool,
    shadowState: ShadowStateLayer,
  ): Promise<AgentResponse> {
    const parsedContent = this.parseReActContent(reactResult);
    const integrationResult = this.buildIntegrationResult(parsedContent, reactResult);
    const {
      gameTimeData,
      integrationResult: finalIntegrationResult,
      reactResult: finalReactResult = reactResult,
    } = await this.postProcessReActResult(
      integrationResult,
      saveId,
      invalidNpcIds,
      reactResult,
      stagingPool,
      shadowState,
    );
    const finalParsedContent = this.parseReActContent(finalReactResult);

    this.gmDeps?.resultIntegrator.clearWriteOperationLog();

    if (this.deps.decisionLogService) {
      await this.deps.decisionLogService.logDecision(
        saveId,
        'gamemaster',
        'react_completion',
        String(finalParsedContent.thought || 'ReAct loop completed'),
        String(finalParsedContent.reasoning || ''),
        String(finalParsedContent.action || ''),
      ).catch(e => logger.warn('Failed to log decision', { error: getErrorMessage(e) }));
    }

    const responsePool = this.deps.createResponsePool();

    if (finalParsedContent.dialogue) {
      const dialogueUpdate = this.convertToDialogueUpdate(finalParsedContent.dialogue);
      if (dialogueUpdate) {
        responsePool.stage({ source: 'gamemaster', panelUpdates: { dialogue: dialogueUpdate } });
      }
    } else {
      const outputAgentResult = finalIntegrationResult.agentResponses.get('output' as AgentType);
      if (outputAgentResult?.success && outputAgentResult.data) {
        const outputData = outputAgentResult.data as Record<string, unknown>;
        const dialogue = outputData.dialogue
          ?? (outputData.data as Record<string, unknown>)?.dialogue
          ?? (outputData.content as Record<string, unknown>)?.dialogue;
        if (dialogue) {
          const dialogueUpdate = this.convertToDialogueUpdate(dialogue);
          if (dialogueUpdate) {
            responsePool.stage({ source: 'output', panelUpdates: { dialogue: dialogueUpdate } });
            logger.info('buildGameMasterFinalResponse: recovered dialogue from OutputAgent fallback');
          }
        }
      }
    }
    if (finalParsedContent.uiDirective) {
      responsePool.stage({ source: 'gamemaster', uiDirective: finalParsedContent.uiDirective as string });
    } else {
      const outputAgentResult = finalIntegrationResult.agentResponses.get('output' as AgentType);
      if (outputAgentResult?.success && outputAgentResult.data) {
        const outputData = outputAgentResult.data as Record<string, unknown>;
        const markdown = outputData.markdown
          ?? (outputData.data as Record<string, unknown>)?.markdown;
        if (markdown) {
          responsePool.stage({ source: 'output', uiDirective: markdown as string });
        }
        const uiIntensity = outputData.uiIntensity
          ?? (outputData.data as Record<string, unknown>)?.uiIntensity;
        if (uiIntensity && !finalParsedContent.uiIntensity) {
          finalParsedContent.uiIntensity = uiIntensity;
        }
      }
    }
    if (finalParsedContent.panelUpdates) {
      responsePool.stage({ source: 'gamemaster', panelUpdates: finalParsedContent.panelUpdates as PanelUpdates });
    }

    const responseBuilder = this.gmDeps?.responseBuilder;
    if (responseBuilder) {
      const domainPanelUpdates = await responseBuilder.extractAndRefreshPanelUpdates(
        finalIntegrationResult.data as Record<string, unknown>,
        finalIntegrationResult.writeOperations,
        saveId,
      );
      if (domainPanelUpdates && Object.keys(domainPanelUpdates).length > 0) {
        responsePool.stage({ source: 'domain_agent', panelUpdates: domainPanelUpdates });
      }
    }

    if (gameTimeData) {
      responsePool.stage({ source: 'domain_agent', time: { currentTime: gameTimeData } });
    }

    const flushData = this.mergePlayerDialogueIntoFlushData(
      responsePool.flush(),
      this.buildPlayerDialogueEcho(message),
    );

    // 统一面板变更推送机制：ReAct flush 后程序化推送合并后的 panelUpdates
    // （含 LLM 输出 + domain refresh 数据，经 PanelUpdatesMerger 合并）。
    // triggeredOps 从 finalIntegrationResult.writeOperations 映射，仅取 toolType 与 method 两字段
    // （参考现有映射模式 AgentRuntime.ts:2656-2658，现有映射含 timestamp 共 3 字段，triggeredOps 仅用于前端日志诊断）。
    if (flushData.panelUpdates && Object.keys(flushData.panelUpdates).length > 0) {
      const triggeredOps = finalIntegrationResult.writeOperations.map(op => ({
        toolType: op.toolType,
        method: op.method,
      }));
      this.deps.panelUpdateBroadcaster.pushPanelUpdates(
        saveId,
        flushData.panelUpdates,
        'react_flush',
        triggeredOps,
      );
    }

    const extraData: Record<string, unknown> = {
      gm: {
        processedAt: Date.now(),
        duration: Date.now() - startTime,
        reactIterations: finalReactResult.iterations,
        agentsInvolved: Array.from(finalIntegrationResult.agentResponses.keys()),
      },
      ...finalIntegrationResult.data,
    };
    const payloadData = (message.payload?.data as Record<string, unknown>) || {};
    if (payloadData.saveId && !extraData.saveId) {
      extraData.saveId = payloadData.saveId;
    }
    if (finalIntegrationResult.writeOperations.length > 0) {
      extraData.writeOperations = finalIntegrationResult.writeOperations.map(op => ({
        toolType: op.toolType, method: op.method, timestamp: op.timestamp,
      }));
      if (responseBuilder) {
        extraData.dataChanges = responseBuilder.extractDataChangesPublic(finalIntegrationResult.writeOperations);
      }
    }

    return this.buildUnifiedResponse(flushData, saveId, extraData);
  }

  private parseReActContent(reactResult: ReActEngineResult): Record<string, unknown> {
    const dialogueCalls = reactResult.toolCalls.filter(
      tc => tc._meta?.toolType === 'dialogue_service'
        && tc._meta?.method === 'submit_dialogue'
        && tc.success
    );
    const dynamicUICalls = reactResult.toolCalls.filter(
      tc => tc._meta?.toolType === 'dynamic_ui' && tc.success
    );

    if (dialogueCalls.length > 0 || dynamicUICalls.length > 0) {
      const outputData: Record<string, unknown> = {};

      if (dialogueCalls.length > 0) {
        const lastCall = dialogueCalls[dialogueCalls.length - 1];
        const callData = lastCall.data as Record<string, unknown>;
        if (callData.dialogue) {
          outputData.dialogue = callData.dialogue;
        }
      }

      if (dynamicUICalls.length > 0) {
        const lastCall = dynamicUICalls[dynamicUICalls.length - 1];
        const callData = lastCall.data as Record<string, unknown>;
        if (callData.uiComponents) {
          outputData.uiDirective = callData.uiComponents;
        }
        if (callData.uiIntensity) {
          outputData.uiIntensity = callData.uiIntensity;
        }
      }

      return outputData;
    }

    try {
      return parseLLMJson<Record<string, unknown>>(reactResult.content, 'AgentRuntime.parseReActContent:legacy');
    } catch {
      return { narrative: reactResult.content };
    }
  }

  private buildIntegrationResult(
    parsedContent: Record<string, unknown>,
    reactResult: ReActEngineResult,
  ): IntegrationResult {
    const integrationResult: IntegrationResult = {
      success: true,
      data: parsedContent,
      agentResponses: new Map(),
      writeOperations: [],
      needsFurtherProcessing: false,
      fallbackSuggestions: [],
    };

    for (const tc of reactResult.toolCalls) {
      if (tc.writeOperation) {
        integrationResult.writeOperations.push({
          ...tc.writeOperation,
          toolType: tc.writeOperation.toolType as import('../../../shared/src/types/agent').ToolType,
        });
      }
      if (tc._meta) {
        integrationResult.agentResponses.set(
          tc._meta.toolType as AgentType,
          { success: tc.success, data: tc.data as GameResponseData },
        );
      }

      if (tc.success && tc._meta?.method === 'spawn_agent' && tc.data) {
        const spawnData = tc.data as { agent_type?: string; result?: unknown };
        if (spawnData.result) {
          const subData = (spawnData.result as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
          if (subData?.results) {
            const taskResults = subData.results as TaskResults;
            const entityRefs: EntityRef[] = [
              ...(taskResults.created ?? []),
              ...(taskResults.updated ?? []),
              ...(taskResults.deleted ?? []),
            ];
            if (entityRefs.length > 0) {
              (integrationResult.data as Record<string, unknown>)._subAgentEntities = entityRefs;
            }
          }
          if (subData?.taskStatus) {
            const taskStatus = subData.taskStatus as TaskStatus;
            if (taskStatus.needsFollowUp) {
              integrationResult.needsFurtherProcessing = true;
            }
          }
        }
      }
    }

    return integrationResult;
  }

  private async postProcessReActResult(
    integrationResult: IntegrationResult,
    saveId: ID,
    invalidNpcIds: string[],
    reactResult?: ReActEngineResult,
    stagingPool?: StagingPool,
    shadowState?: ShadowStateLayer,
  ): Promise<PostProcessReActResultOutput> {
    const responseBuilder = this.gmDeps?.responseBuilder;
    if (responseBuilder) {
      await responseBuilder.triggerAutoSave(saveId);
    }

    let latestIntegrationResult = integrationResult;
    let latestReactResult = reactResult;
    let gameTimeData: { day: number; hour: number; minute: number; period: string; season: string; description: string } | undefined;

    const storyKernel = this.gmDeps?.storyKernel;
    if (storyKernel) {
      try {
        const storyRequestContext = await storyKernel.prepareRequestContext(saveId);

        let postReviewDecision: UnifiedPostReviewDecision | null = null;
        let postReactTraceSummary: StoryPostReactDevtoolsTrace | undefined;
        let resolvedLayer1Agents: import('../../../shared/src/types/agent').AgentType[] = [];
        let needAgentReasons: string[] = [];
        if (!isInitAction(this.state.currentAction || '') && this.currentStoryDirective && latestReactResult) {
          try {
            const runtimeStagingPool = stagingPool ?? this.deps.createStagingPool();
            const runtimeShadowState = shadowState ?? this.createShadowState(saveId, false);
            const activeReviewRuntime: RepairRuntimeScope = {
              stagingPool: runtimeStagingPool,
              shadowState: runtimeShadowState,
            };
            let lastRepairReasons: string[] = [];
            // v5.2 EC8: repair 循环已删除，repairRoundCount 恒为 0
            // 保留 const 仅为 trace 字段类型契约（finalizePostReactTraceSummary 写入 devtoolsTrace）
            const repairRoundCount = 0;

            postReviewDecision = await this.reviewStoryConsistency(
              saveId, storyRequestContext, latestReactResult, latestIntegrationResult,
            );
            let postReactResult = await this.storyPostReactPipeline.run({
              saveId,
              storyRequestContext,
              storyDirective: this.currentStoryDirective as StoryDirective | null,
              postReviewDecision,
              reactResult: latestReactResult,
              integrationResult: latestIntegrationResult,
              stagingPool: activeReviewRuntime.stagingPool,
              shadowState: activeReviewRuntime.shadowState,
              pacingReviewResult: this.currentPacingReviewResult,
            });

            if (postReactResult.devtoolsTrace.repairReasons.length > 0) {
              lastRepairReasons = [...postReactResult.devtoolsTrace.repairReasons];
            }

            // v5.2 EC8: 消除 chat 路径 repair 循环
            // 审核统一由 on_task_complete hook 在 ReAct loop 内处理，post-react 不再 repair
            // 保留单次 reviewStoryConsistency 调用（无循环、无 repair）

            postReviewDecision = postReactResult.postReviewDecision;
            postReactTraceSummary = this.finalizePostReactTraceSummary(
              postReactResult.devtoolsTrace,
              postReviewDecision,
              repairRoundCount,
              lastRepairReasons,
            );
            const devTraceCollector = this.deps.devTraceCollector();
            if (devTraceCollector) {
              devTraceCollector.addTrace(saveId, {
                type: 'story_post_react',
                data: postReactTraceSummary as unknown as Record<string, unknown>,
                timestamp: Date.now(),
              });
            }
            resolvedLayer1Agents = postReactResult.resolvedLayer1Agents;
            needAgentReasons = postReactResult.needAgentReasons;
            // 模块3 L2-2：持久化 perceptionUpdateHint 到实例字段，下一轮 GM systemPrompt 构建时注入
            this.state.pendingPerceptionHint = postReactResult.perceptionUpdateHint ?? null;
            this.currentPostReviewDecision = postReviewDecision;
          } catch (reviewError) {
            this.currentPostReviewDecision = null;
            if (reviewError instanceof PostReactRepairFailureError) {
              throw reviewError;
            }
            logger.warn('Story review failed, continuing without post-review', {
              saveId,
              error: getErrorMessage(reviewError)
            });
          }
        } else if (isInitAction(this.state.currentAction || '') && latestReactResult) {
          // v5.2 EC8: init 路径后审（无 repair 循环，审核统一由 on_task_complete hook 处理）
          // init 不走 storyPostReactPipeline（不需要 secondLayerDecision/recordUploadDecision）
          try {
            const postReviewDecision = await this.reviewInitConvergence(
              saveId,
              latestReactResult,
              latestIntegrationResult,
            );

            this.currentPostReviewDecision = postReviewDecision;
          } catch (reviewError) {
            this.currentPostReviewDecision = null;
            if (reviewError instanceof PostReactRepairFailureError) {
              throw reviewError;
            }
            logger.warn('Init review failed, continuing without post-review', {
              saveId,
              error: getErrorMessage(reviewError),
            });
          }
        } else {
          this.currentPostReviewDecision = null;
        }

        const storyStateCommit = storyKernel.buildRuntimeStoryStateCommit(
          storyRequestContext,
          {
            storyDirective: this.currentStoryDirective as StoryDirective | null,
            resolvedLayer1Agents,
            writeToolTypes: latestIntegrationResult.writeOperations.map(op => String(op.toolType)),
            needAgentReasons,
            postReviewDecision,
            postReactTraceSummary,
          },
        );
        await storyKernel.saveStoryState(saveId, storyStateCommit);

        if (postReviewDecision) {
          const storyEvent = storyKernel.buildRecordUploadStoryEvent(
            storyRequestContext, postReviewDecision
          );
          if (storyEvent) {
            await storyKernel.addStoryEvent(saveId, storyEvent);
            logger.info('Story event recorded', { saveId, summary: storyEvent.title });
          }
        }
      } catch (error) {
        if (error instanceof PostReactRepairFailureError) {
          throw error;
        }
        logger.warn('Failed to save story state after ReAct', { saveId, error: getErrorMessage(error) });
      }
    }

    if (invalidNpcIds.length > 0) {
      await this.attachNpcWarnings(latestIntegrationResult, invalidNpcIds, saveId);
    }

    const actionType = this.inferActionType(latestIntegrationResult);
    if (responseBuilder) {
      gameTimeData = await responseBuilder.getGameTimeData(saveId, actionType);
    }

    return {
      gameTimeData,
      integrationResult: latestIntegrationResult,
      reactResult: latestReactResult,
    };
  }

  private async createRepairRuntime(saveId: ID): Promise<RepairRuntimeScope> {
    // 13.1 规则: 审查/修复路径同样默认启用 StagingPool，禁止运行时路径默认 false。
    const enableStagingPool = this.agentConfig.enableStagingPool ?? true;
    const stagingPool = this.deps.createStagingPool();
    const shadowState = this.createShadowState(saveId, enableStagingPool);

    if (enableStagingPool) {
      stagingPool.bindShadowState(shadowState);
      stagingPool.bindGraphUpdater(this.deps.entityGraphUpdater, saveId);
      await shadowState.ensureSnapshot();
    }

    return { stagingPool, shadowState };
  }

  public async createRequestRuntime(saveId: ID): Promise<RepairRuntimeScope> {
    return this.createRepairRuntime(saveId);
  }

  public async flushRequestRuntime(runtime: RepairRuntimeScope): Promise<void> {
    if (!runtime.stagingPool.hasWrites()) {
      return;
    }

    if (this.deps.writeQueue) {
      await runtime.stagingPool.flush(this.deps.writeQueue);
      return;
    }

    logger.error('Request runtime has writes but no writeQueue, discarding staged writes', {
      writeCount: runtime.stagingPool.writeCount,
    });
    runtime.stagingPool.clear();
  }

  /**
   * EG-M4-5: 触发定期纠错（写入阈值触发路径）。
   *
   * flush 后由 processMessageCore 的 finally 块调用。
   * 累计写入次数（per-saveId，跨多次请求）超过 RECONCILE_THRESHOLD 时
   * 触发 Reconciler.reconcile 全量重建图数据。
   *
   * 设计要点（模块2 简化版）：
   * - 使用 lastRequestWriteCount（flush 前 saved），因 stagingPool.writeCount 在 flush 后归零
   * - 简化版 Reconciler 直写 DB（graphProvider.upsertNode/upsertEdge），无需 StagingPool
   * - 通过 gmDeps.entityGraphReconciler 访问 Reconciler 实例
   * - 失败由 Reconciler 内部捕获返回 error 字段，不阻塞主流程（L3-1）
   *
   * @param saveId 存档 ID
   */
  private async triggerReconcileIfNeeded(saveId: string): Promise<void> {
    const currentCount = this.reconcileCounters.get(saveId) ?? 0;
    const newCount = currentCount + this.lastRequestWriteCount;

    if (newCount < RECONCILE_THRESHOLD) {
      this.reconcileCounters.set(saveId, newCount);
      this.lastRequestWriteCount = 0;
      return;
    }

    logger.info('Triggering reconcile (threshold reached)', {
      saveId, writeCount: newCount, threshold: RECONCILE_THRESHOLD,
    });

    await this.gmDeps!.entityGraphReconciler.reconcile(saveId);

    // 重置计数器（纠错完成，重新累计）
    this.reconcileCounters.set(saveId, 0);
    this.lastRequestWriteCount = 0;
  }

  private buildPlayerDialogueEcho(message: AgentMessage): DialogueMessageEntry | null {
    const payloadData = (message.payload?.data as Record<string, unknown>) || {};
    const content = typeof payloadData.playerInput === 'string' ? payloadData.playerInput : '';
    if (!content) {
      return null;
    }

    const speaker = typeof payloadData.playerSpeaker === 'string' && payloadData.playerSpeaker.trim()
      ? payloadData.playerSpeaker
      : 'player';

    return {
      id: randomUUID(),
      speaker,
      content,
      emotion: 'neutral',
      messageType: 'player_meta',
    };
  }

  private mergePlayerDialogueIntoFlushData(
    flushData: ResponsePoolFlush,
    playerMessage: DialogueMessageEntry | null,
  ): ResponsePoolFlush {
    if (!playerMessage) {
      return flushData;
    }

    const dialogueUpdate = flushData.panelUpdates.dialogue;
    if (!dialogueUpdate) {
      return {
        ...flushData,
        panelUpdates: {
          ...flushData.panelUpdates,
          dialogue: { addedMessages: [playerMessage] },
        },
      };
    }

    const existingMessages = dialogueUpdate.addedMessages ?? [];
    const alreadyHasPlayerEcho = existingMessages.some(
      (entry) => entry.messageType === 'player_meta' && entry.content === playerMessage.content,
    );

    if (alreadyHasPlayerEcho) {
      return flushData;
    }

    return {
      ...flushData,
      panelUpdates: {
        ...flushData.panelUpdates,
        dialogue: {
          ...dialogueUpdate,
          addedMessages: [playerMessage, ...existingMessages],
        },
      },
    };
  }

  /**
   * 将旧 ResponsePoolDialogue 结构（含 message/speaker/emotion/options/messages 字段）
   * 转换为新的 DialogueUpdate 结构（含 addedMessages/options）。
   *
   * 转换规则（设计 5.9）：
   * - 非对象类型（null/undefined/字符串/数组等）直接返回 undefined
   * - messages 非空数组 → addedMessages = messages 每项加 id: randomUUID()
   * - 否则若 message 非空字符串 → addedMessages = [{ id, speaker||'旁白', content, messageType:'narrator' }]
   * - options 非空数组 → options = dialogue.options
   * - addedMessages 与 options 都为空 → 返回 undefined
   */
  private convertToDialogueUpdate(dialogue: unknown): DialogueUpdate | undefined {
    if (typeof dialogue !== 'object' || dialogue === null) {
      return undefined;
    }
    const d = dialogue as Record<string, unknown>;

    let addedMessages: DialogueMessageEntry[] | undefined;
    const messages = d.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      addedMessages = messages.map((m) => {
        const msg = (m as Record<string, unknown>) ?? {};
        return {
          id: randomUUID(),
          speaker: typeof msg.speaker === 'string' ? msg.speaker : '旁白',
          content: typeof msg.content === 'string' ? msg.content : '',
          emotion: typeof msg.emotion === 'string' ? msg.emotion : undefined,
          messageType: this.normalizeMessageType(msg.messageType),
        };
      });
    } else if (typeof d.message === 'string' && d.message) {
      addedMessages = [{
        id: randomUUID(),
        speaker: typeof d.speaker === 'string' && d.speaker ? d.speaker : '旁白',
        content: d.message,
        emotion: typeof d.emotion === 'string' ? d.emotion : undefined,
        messageType: 'narrator',
      }];
    }

    let options: DialogueOption[] | undefined;
    const rawOptions = d.options;
    if (Array.isArray(rawOptions) && rawOptions.length > 0) {
      options = rawOptions as DialogueOption[];
    }

    if (!addedMessages && !options) {
      return undefined;
    }

    const result: DialogueUpdate = {};
    if (addedMessages) result.addedMessages = addedMessages;
    if (options) result.options = options;
    return result;
  }

  private normalizeMessageType(value: unknown): DialogueMessageType {
    if (typeof value === 'string' && (DIALOGUE_MESSAGE_TYPES as readonly string[]).includes(value)) {
      return value as DialogueMessageType;
    }
    return 'npc';
  }

  private createShadowState(saveId: ID, enableSnapshot: boolean): ShadowStateLayer {
    return this.deps.createShadowStateLayer(
      saveId,
      this.currentTemplateId,
      enableSnapshot,
    );
  }

  private finalizePostReactTraceSummary(
    trace: StoryPostReactDevtoolsTrace,
    postReviewDecision: UnifiedPostReviewDecision | null,
    repairRoundCount: number,
    lastRepairReasons: string[],
  ): StoryPostReactDevtoolsTrace {
    const repairReasons = trace.repairReasons.length > 0
      ? trace.repairReasons
      : lastRepairReasons;

    return {
      ...trace,
      repairRoundCount,
      repairReasons,
      runtimeCommitSummary: {
        wrotePostReviewDecision: postReviewDecision != null,
        // v5.2 EC8: 审核已统一到 on_task_complete hook，postReviewDecision 不再含 auditResult
        wroteContinuityAudit: false,
        wroteTodoCompletion: postReviewDecision?.todoCompletion != null,
        wroteRepairMetadata: repairRoundCount > 0 || repairReasons.length > 0,
      },
    };
  }

  private async reviewStoryConsistency(
    saveId: ID,
    storyContext: StoryRequestContext,
    reactResult: ReActEngineResult,
    integrationResult: IntegrationResult,
  ): Promise<UnifiedPostReviewDecision | null> {
    if (!this.gmDeps?.storyKernel) return null;

    const reviewPrompt = this.loadPromptFile('story-review-and-record');
    if (!reviewPrompt) return null;

    // 设计文档 EC6: 审核已统一到 on_task_complete hook（ReAct loop 提交点）
    // 此处不再调用 auditAgent.auditWorld（移除 catch + return null fallback 模式）

    let pacingReviewResult: import('./story/types.js').PacingReviewResult | undefined;
    const pacingState = this.currentPacingState;
    if (pacingState && this.gmDeps.storyKernel.isPacingEnabled()) {
      try {
        pacingReviewResult = await this.gmDeps.storyKernel.reviewPacing(saveId, pacingState);
        this.currentPacingReviewResult = pacingReviewResult;
      } catch (pacingError) {
        logger.warn('Pacing review failed, continuing without pacing review', {
          saveId,
          error: getErrorMessage(pacingError),
        });
      }
    }

    const writeOpsSummary = integrationResult.writeOperations
      .map(op => `${op.toolType}.${op.method}`)
      .join(', ');

    const directive = this.currentStoryDirective as StoryDirective | null;
    const todoList = directive?.todoList;
    const todoHint = todoList && todoList.length > 0
      ? `## 本轮 TODO List\n${todoList.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n`
      : '';

    const auditHint = '';  // 设计文档 EC6: 审核已统一到 on_task_complete hook，此处不再注入 audit hint

    const pacingHint = pacingReviewResult
      ? `## 节奏审查\n紧张度一致性: ${pacingReviewResult.tensionConsistent ? '正常' : '异常'}\n连续高压: ${pacingReviewResult.consecutiveHighPressure ? '是' : '否'}\n连续低压: ${pacingReviewResult.consecutiveLowPressure ? '是' : '否'}\n推进偏离: ${pacingReviewResult.progressDeviation.toFixed(2)}${pacingReviewResult.suggestions.length > 0 ? `\n建议: ${pacingReviewResult.suggestions.join('; ')}` : ''}\n`
      : '';

    const userMessage = [
      `## 当前主线目标`,
      `章节: ${storyContext.projection.chapter || '未知'}`,
      `主线任务: ${storyContext.projection.mainQuest || '未知'}`,
      ``,
      `## 本轮 StoryDirective`,
      `目标: ${directive?.storyGoal || '未知'}`,
      `玩家目标: ${directive?.playerFacingObjective || '未知'}`,
      ``,
      todoHint,
      auditHint,
      pacingHint,
      `## 第一层结果`,
      `写操作: ${writeOpsSummary || '无'}`,
      `LLM 最终输出: ${(reactResult.content || '').slice(0, 800)}`,
      ``,
      `生成 UnifiedPostReviewDecision JSON 对象，包含 todoCompletion 字段。`,
    ].join('\n');

    try {
      // M9：经 LLMRequestDispatcher 调度
      const content = await this.chatViaDispatcher(
        [
          { role: 'system', content: reviewPrompt },
          { role: 'user', content: userMessage },
        ],
        {
          providerId: this.providerId,
          model: this.model,
          temperature: 0.2,
          maxTokens: 800,
          responseFormat: { type: 'json_object' },
          loggingMetadata: this.buildLoggingMetadata('story-review', 0, 0),
        },
        saveId,
      );

      const parsed = this.parseStoryDirectiveFromLLM(content);

      if (parsed) {
        const decision = this.gmDeps.storyKernel.normalizeUnifiedPostReviewDecision(parsed);
        return decision;
      }

      return null;
    } catch (error) {
      logger.warn('reviewStoryConsistency failed', {
        saveId,
        error: getErrorMessage(error)
      });
      return null;
    }
  }

  /**
   * init 路径的后审：程序化校验 + LLM review + 返回 UnifiedPostReviewDecision。
   * 镜像 reviewStoryConsistency 的结构，但使用 init-convergence-review prompt，
   * 且程序化校验只做 init convergence（资源数量是否达标），不做运行时一致性检查。
   */
  private async reviewInitConvergence(
    saveId: ID,
    reactResult: ReActEngineResult,
    integrationResult: IntegrationResult,
  ): Promise<UnifiedPostReviewDecision | null> {
    if (!this.gmDeps?.storyKernel) return null;

    const reviewPrompt = this.loadPromptFile('init-convergence-review');
    if (!reviewPrompt) return null;

    // 设计文档 EC6: 审核已统一到 on_task_complete hook（ReAct loop 提交点）
    // 此处不再调用 auditAgent.auditWorld（移除 catch + return null fallback 模式）

    // 2. 构造 LLM review 的 user message
    const writeOpsSummary = integrationResult.writeOperations
      .map(op => `${op.toolType}.${op.method}`)
      .join(', ');

    const auditHint = '## 程序化校验结果\n审核已统一到 on_task_complete hook，此处不再注入 audit hint\n';

    const userMessage = [
      `## 本轮 init 执行结果`,
      `写操作: ${writeOpsSummary || '无'}`,
      `LLM 最终输出: ${(reactResult.content || '').slice(0, 800)}`,
      ``,
      auditHint,
      `生成 UnifiedPostReviewDecision JSON 对象，重点评估 taskReview.completion 和 todoCompletion.overallCompletion。`,
    ].join('\n');

    // 3. LLM 调用
    try {
      // M9：经 LLMRequestDispatcher 调度
      const content = await this.chatViaDispatcher(
        [
          { role: 'system', content: reviewPrompt },
          { role: 'user', content: userMessage },
        ],
        {
          providerId: this.providerId,
          model: this.model,
          temperature: 0.2,
          maxTokens: 800,
          responseFormat: { type: 'json_object' },
          loggingMetadata: this.buildLoggingMetadata('init-convergence-review', 0, 0),
        },
        saveId,
      );

      const parsed = this.parseStoryDirectiveFromLLM(content);

      if (parsed) {
        const decision = this.gmDeps.storyKernel.normalizeUnifiedPostReviewDecision(parsed);
        return decision;
      }

      return null;
    } catch (error) {
      logger.warn('reviewInitConvergence failed', {
        saveId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  private buildUnifiedResponse(
    flushData: ResponsePoolFlush,
    saveId: ID | undefined,
    extraData: Record<string, unknown> = {},
  ): AgentResponse {
    const responseData: Record<string, unknown> = { ...extraData };

    // 统一面板变更推送机制：dialogue 数据由 panelUpdates.dialogue 推送，
    // 不再写入 responseData.dialogue/message/speaker/options（设计 5.13）
    if (flushData.uiDirective) {
      responseData.uiDirective = flushData.uiDirective;
    }
    if (flushData.uiIntensity && flushData.uiIntensity !== 'none') {
      responseData.uiIntensity = flushData.uiIntensity;
    }
    // 统一面板变更推送机制：panelUpdates 已在 buildGameMasterFinalResponse 中
    // 通过 panelUpdateBroadcaster.pushPanelUpdates 推送，不再写入 GameResponse.panelUpdates 字段。
    // GameResponse.panelUpdates 字段已从 shared/types/dynamic-ui.ts 移除。
    if (flushData.time) {
      responseData.time = flushData.time;
    }

    const sanitizedData = this.gmDeps?.responseBuilder
      ? this.gmDeps.responseBuilder.sanitizeAllOutputsPublic(responseData)
      : responseData;

    return {
      success: true,
      data: sanitizedData,
      messages: [{
        id: randomUUID() as ID,
        timestamp: Date.now() as Timestamp,
        from: 'gamemaster',
        to: 'output',
        type: 'response',
        saveId: saveId ?? ('' as ID),
        payload: { action: 'unified_response', data: sanitizedData },
        metadata: { priority: 'normal', requiresResponse: false },
      }],
    };
  }

  private inferActionType(integrationResult: IntegrationResult): string {
    const agentTypes = Array.from(integrationResult.agentResponses?.keys() ?? []);
    if (agentTypes.includes('challenge')) return 'combat';
    if (agentTypes.includes('map')) return 'move';
    if (agentTypes.includes('quest')) return 'quest_accept';
    if (agentTypes.includes('skill')) return 'cast_skill';
    if (agentTypes.includes('npc_party')) return 'dialogue';
    if (agentTypes.includes('inventory')) return 'trade';
    return 'dialogue';
  }

  private async attachNpcWarnings(
    integrationResult: IntegrationResult,
    invalidNpcIds: string[],
    saveId: string,
  ): Promise<void> {
    if (!this.gmDeps) return;
    const mapService = await this.gmDeps.mapServiceFactory(saveId);
    const npcService = await this.gmDeps.npcServiceFactory(saveId);
    try {
      const currentLocation = await mapService.getCurrentLocation(saveId);
      let filteredOutNpcs: Array<{ id: string; name: string }>;
      try {
        const npcNameMap = await npcService.getNPCNamesByIds(invalidNpcIds);
        filteredOutNpcs = invalidNpcIds.map(id => ({ id, name: npcNameMap.get(id) || id }));
      } catch {
        filteredOutNpcs = invalidNpcIds.map(id => ({ id, name: id }));
      }
      integrationResult.data.npcWarnings = {
        warningType: 'npc_not_in_scene',
        filteredOutNpcs,
        currentLocationName: currentLocation?.name || '未知地点',
      };
    } catch (error) {
      logger.warn('Failed to attach NPC warnings', { error: getErrorMessage(error) });
    }
  }

  private async buildSceneNPCContext(saveId: string): Promise<Array<{
    id: string; name: string; role?: string;
    locationId?: string; locationName?: string;
    reachability?: 'current' | 'parent' | 'sibling' | 'child' | 'connected';
    services?: Array<{ type: string; name: string }>;
    disposition?: string;
  }>> {
    if (!this.gmDeps) return [];
    const mapService = await this.gmDeps.mapServiceFactory(saveId);
    const npcService = await this.gmDeps.npcServiceFactory(saveId);
    try {
      const currentLocation = await mapService.getCurrentLocation(saveId);
      if (!currentLocation) return [];

      const reachableIds = await mapService.getReachableLocationIds(saveId, currentLocation.id);

      let siblingIds: ID[] = [];
      if (currentLocation.parentLocationId) {
        siblingIds = (await mapService.getChildLocationIds(saveId, currentLocation.parentLocationId))
          .filter(id => id !== currentLocation.id);
      }

      const locationNameMap = await mapService.getLocationNamesByIds(saveId, reachableIds);

      const allNpcRows = await npcService.getNPCsByLocationIds(saveId, reachableIds);

      const npcIdSet = new Set<string>();
      const sceneNPCs = [];

      for (const npcRow of allNpcRows) {
        const npcId = npcRow.id;
        if (npcIdSet.has(npcId)) continue;
        npcIdSet.add(npcId);

        let services: Array<{ type: string; name: string }> | undefined;
        try {
          const raw = npcRow.services;
          services = raw ? (typeof raw === 'string' ? JSON.parse(raw) : undefined) : undefined;
        } catch { services = undefined; }

        sceneNPCs.push({
          id: npcId,
          name: npcRow.name,
          role: npcRow.role,
          locationId: npcRow.locationId,
          locationName: locationNameMap.get(npcRow.locationId as ID),
          reachability: this.classifyReachability(npcRow.locationId, currentLocation, siblingIds),
          services,
        });
      }

      return sceneNPCs;
    } catch {
      return [];
    }
  }

  private classifyReachability(
    npcLocationId: ID,
    currentLocation: LocationData,
    siblingIds: ID[],
  ): 'current' | 'parent' | 'sibling' | 'child' | 'connected' {
    if (npcLocationId === currentLocation.id) return 'current';
    if (npcLocationId === currentLocation.parentLocationId) return 'parent';
    if (currentLocation.childLocationIds?.includes(npcLocationId)) return 'child';
    if (siblingIds.includes(npcLocationId)) return 'sibling';
    return 'connected';
  }

  private validateTargetNpcIds(message: AgentMessage, sceneNPCs: Array<{ id: string; name: string }>): { validIds: string[]; invalidNpcIds: string[] } {
    const data = (message.payload?.data ?? {}) as Record<string, unknown> | undefined;
    const frontendNpcIds = (data?.targetNpcIds as string[]) || [];
    if (frontendNpcIds.length === 0) return { validIds: [], invalidNpcIds: [] };

    const sceneNpcIdSet = new Set(sceneNPCs.map(n => n.id));
    const validIds = frontendNpcIds.filter(id => sceneNpcIdSet.has(id));
    const invalidNpcIds = frontendNpcIds.filter(id => !sceneNpcIdSet.has(id));

    return { validIds, invalidNpcIds };
  }

  private async executeContextInjection(saveId: ID, requestId?: string): Promise<{ context: string | null; injectedMethods: Array<{ source: string; method: string }> }> {
    try {
      if (!this.deps.contextInjector.hasRules('gamemaster')) {
        return { context: null, injectedMethods: [] };
      }
      // 初始化阶段跳过预加载：角色/位置/任务/技能/装备/背包此时都为空，
      // 预加载无信息量。跳过后 GM 可直接通过工具调用获取子Agent 结果。
      if (isInitAction(this.state.currentAction || '')) {
        return { context: null, injectedMethods: [] };
      }
      const fetcher = this.toolExecutor.buildContextFetcher();
      const result = await this.deps.contextInjector.injectForAgentDetailed('gamemaster', saveId, fetcher, undefined, this.agentConfig.max_context_tokens, this.currentTemplateId, requestId);
      return { context: result.context, injectedMethods: result.injectedMethods };
    } catch (error) {
      logger.warn('ContextInjector failed, continuing without enrichment', { saveId, error: getErrorMessage(error) });
      return { context: null, injectedMethods: [] };
    }
  }

  private async resolveRequestLanguage(saveId: ID, explicitLanguage?: string): Promise<string | undefined> {
    if (explicitLanguage) return explicitLanguage;
    if (!saveId) return undefined;
    try {
      return await this.deps.saveService.getSaveLanguage(saveId) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async buildRequestTemplateRuntime(saveId: ID, fallbackTemplateId?: ID, options?: { fullContext?: boolean }): Promise<{
    templateContext: string | null;
    specialRules: Record<string, unknown> | null;
  }> {
    const runtime = { templateContext: null as string | null, specialRules: null as Record<string, unknown> | null };
    try {
      if (!saveId && !fallbackTemplateId) return runtime;

      const templateId = (saveId ? await this.deps.saveService.getSaveTemplateId(saveId) : undefined) || fallbackTemplateId;
      if (!templateId) return runtime;

      const templateProvider = this.deps.templateProvider;
      if (templateProvider) {
        if (options?.fullContext) {
          runtime.templateContext = await templateProvider.getSystemContext(templateId);
        } else {
          runtime.templateContext = await templateProvider.getWorldContext(templateId);
        }

        const template = await templateProvider.getTemplate(templateId as ID);
        const specialRules = template?.specialRules as Record<string, unknown> | null;
        if (specialRules && Object.keys(specialRules).length > 0) {
          runtime.specialRules = specialRules;
        }
      }
    } catch (error) {
      logger.warn('Failed to build request template runtime', { saveId, error: getErrorMessage(error) });
    }
    return runtime;
  }

  /** 从 saves 表解析 templateId 并缓存到 currentTemplateId，供 ToolContext 传递 */
  private async resolveTemplateId(saveId: ID, fallbackTemplateId?: ID): Promise<void> {
    try {
      if (this.currentTemplateId) return;
      const templateId = (saveId ? await this.deps.saveService.getSaveTemplateId(saveId) : undefined) || fallbackTemplateId || undefined;
      this.currentTemplateId = templateId;
    } catch (error) {
      logger.warn('Failed to resolve templateId', { saveId, error: getErrorMessage(error) });
    }
  }

  /**
   * 为故事蓝图生成构建增强模板上下文。
   * 在 getWorldContext() 基础上追加 story-master-plan 提示词所需的数据：
   * startingScene、npcs、locations、initialData、characterCreation。
   */
  private async buildEnhancedInitTemplateContext(
    templateId: ID | undefined,
    fallbackCtx: string | null,
  ): Promise<string | null> {
    if (!templateId) return fallbackCtx;

    try {
      const templateProvider = this.deps.templateProvider;
      if (!templateProvider) return fallbackCtx;

      // 获取 SystemContext（= worldContext + startingScene + knownLocations）
      const systemCtx = await templateProvider.getSystemContext(templateId);
      const template = await templateProvider.getTemplate(templateId);
      if (!template) return systemCtx;

      const parts = [systemCtx];

      // characterCreation: 可选种族和职业定义
      const cc = template.characterCreation as Record<string, unknown> | undefined;
      if (cc && Object.keys(cc).length > 0) {
        parts.push('', '## Character Creation Options');
        if (cc.races) parts.push(`- Available Races: ${JSON.stringify(cc.races)}`);
        if (cc.classes) parts.push(`- Available Classes: ${JSON.stringify(cc.classes)}`);
        if (cc.factions) parts.push(`- Available Factions: ${JSON.stringify(cc.factions)}`);
        if (cc.backgrounds) parts.push(`- Available Backgrounds: ${JSON.stringify(cc.backgrounds)}`);
      }

      // npcs: 模板预定义 NPC（只取名称和关键属性，控制长度）
      const templateNpcs = template.npcs;
      if (Array.isArray(templateNpcs) && templateNpcs.length > 0) {
        const npcSummaries = templateNpcs.slice(0, 20).map((npc: Record<string, unknown>) => {
          const fields: string[] = [];
          if (npc.name) fields.push(`name: ${npc.name}`);
          if (npc.role) fields.push(`role: ${npc.role}`);
          if (npc.race) fields.push(`race: ${npc.race}`);
          if (npc.location) fields.push(`location: ${npc.location}`);
          return `  - {${fields.join(', ')}}`;
        });
        parts.push('', '## Template NPCs', ...npcSummaries);
        if (templateNpcs.length > 20) {
          parts.push(`  ... and ${templateNpcs.length - 20} more`);
        }
      }

      // locations: 模板预定义地点（只取名称和层级）
      const templateLocs = template.locations;
      if (Array.isArray(templateLocs) && templateLocs.length > 0) {
        const locSummaries = templateLocs.slice(0, 20).map((loc: Record<string, unknown>) => {
          const fields: string[] = [];
          if (loc.name) fields.push(`name: ${loc.name}`);
          if (loc.type) fields.push(`type: ${loc.type}`);
          if (loc.level) fields.push(`level: ${loc.level}`);
          return `  - {${fields.join(', ')}}`;
        });
        parts.push('', '## Template Locations', ...locSummaries);
        if (templateLocs.length > 20) {
          parts.push(`  ... and ${templateLocs.length - 20} more`);
        }
      }

      // initialData: 初始数据（可能含任务、事件等）
      const initData = template.initialData as Record<string, unknown> | undefined;
      if (initData && Object.keys(initData).length > 0) {
        parts.push('', '## Initial Data', JSON.stringify(initData, null, 2));
      }

      return parts.join('\n');
    } catch (error) {
      logger.warn('Failed to build enhanced init template context', {
        templateId,
        error: getErrorMessage(error),
      });
      return fallbackCtx;
    }
  }

  /**
   * Agent LLM 调用统一入口（M9 §11.2 重接线）。
   *
   * 经 LLMRequestDispatcher 调度：选 key + per-key 令牌桶限流 + 429/401 失败转移
   * + 调度指标事件（llm_metrics_event → llm_dispatch_metrics 表）。
   * 替代原 deps.llmService.chatRaw 直调（双写过渡期，见 AgentDeps.llmService @deprecated）。
   */
  async callLLM(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const result = await this.deps.llmRequestDispatcher.dispatch({
      providerId: this.providerId,
      model: this.model ?? options?.model,
      messages,
      options: {
        temperature: options?.temperature ?? this.agentConfig.temperature ?? LLM_DEFAULTS.temperature,
        maxTokens: options?.maxTokens ?? this.agentConfig.max_tokens ?? LLM_DEFAULTS.maxTokens,
        loggingMetadata: options?.loggingMetadata,
      },
      agentKey: this.agentKey,
      saveId: this.currentSaveId || undefined,
    });

    if (!result.success || !result.response) {
      return { success: false, error: `LLM dispatch failed: ${result.error?.type} - ${result.error?.message}` };
    }

    return {
      success: true,
      content: result.response.content,
      reasoningContent: result.response.reasoningContent,
      usage: result.response.usage
        ? {
            promptTokens: result.response.usage.promptTokens,
            completionTokens: result.response.usage.completionTokens,
            totalTokens: result.response.usage.totalTokens,
            promptCacheHitTokens: result.response.usage.promptCacheHitTokens,
            promptCacheMissTokens: result.response.usage.promptCacheMissTokens,
          }
        : undefined,
    };
  }

  /**
   * M9 双写过渡期内部辅助：经 LLMRequestDispatcher 的 chat 等价入口。
   *
   * 返回 content 文本；调度失败时抛错（与原 deps.llmService.chat 直调行为对称，
   * 调用方各自的 try/catch 语义保持不变）。
   */
  private async chatViaDispatcher(
    messages: LLMMessage[],
    options: {
      providerId?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      responseFormat?: { type: 'json_object' | 'text' };
      loggingMetadata?: NonNullable<ChatOptions['loggingMetadata']>;
    },
    saveId?: ID,
  ): Promise<string> {
    const result = await this.deps.llmRequestDispatcher.dispatch({
      providerId: options.providerId,
      model: options.model,
      messages,
      options: {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        responseFormat: options.responseFormat,
        loggingMetadata: options.loggingMetadata,
      },
      agentKey: this.agentKey,
      saveId,
    });

    if (!result.success || !result.response) {
      throw new Error(`LLM dispatch failed: ${result.error?.type} - ${result.error?.message}`);
    }
    return result.response.content;
  }

  private buildLoggingMetadata(stage: string, reactIterations: number, toolCallsCount: number): NonNullable<ChatOptions['loggingMetadata']> {
    return {
      stage,
      reactIterations,
      toolCallsCount,
    };
  }

  // ─── GM-specific methods (only meaningful when isSubAgent=false) ───

  registerAgent(agent: BaseAgent): void {
    this.agentInstances.set(agent.type, agent);
  }

  getAgentInstances(): Map<AgentType, BaseAgent> {
    return this.agentInstances;
  }

  getRegisteredAgents(): AgentType[] {
    return Array.from(this.agentInstances.keys());
  }

  getAgent(agentType: AgentType): BaseAgent | undefined {
    return this.agentInstances.get(agentType);
  }

  isActive(): boolean {
    return this.activeRequestCount > 0;
  }

  getActiveRequestCount(): number {
    return this.activeRequestCount;
  }

  getCurrentScheduleDepth(): number {
    return 0;
  }

  getPromptModule(): PromptModule {
    return this.deps.promptModule;
  }

  override async callTool(toolType: string, method: string, params: Record<string, unknown>, saveId: ID | undefined, reqCtx: RequestContext): Promise<ToolResult> {
    const resolvedSaveId = saveId || this.currentSaveId;
    const toolCallId = randomUUID() as ID;
    const timestamp = Date.now() as Timestamp;

    // Propagate toolCallId into request context for trace continuity
    if (reqCtx?.traceIds) {
      reqCtx.traceIds.toolCallId = toolCallId;
    }

    try {
      const activeStagingPool = reqCtx?.stagingPool;
      const activeShadowState = reqCtx?.shadowState;

      const toolContext: import('@ai-rpg/shared/types/tool').ToolContext = {
        saveId: resolvedSaveId,
        agentType: this.type,
        timestamp,
        writeQueue: activeStagingPool ? undefined : this.deps.writeQueue,
        agentTools: this.agentConfig.tools,
        templateId: this.currentTemplateId,
        intentHint: reqCtx?.intentHint,
        storyDirective: this.currentStoryDirective,
        runtimeSnapshot: this.getRuntimeSnapshot() ?? undefined,
        injectedMethods: this.currentInjectedMethods,
        toolExposureState: reqCtx?.toolExposureState,
        syncToolExposureState: reqCtx?.toolExposureState
          ? (state) => this.syncRuntimeSnapshotToolExposureState(state)
          : undefined,
        traceIds: reqCtx?.traceIds,
        progressContext: this.currentProgressContext ?? undefined,
        requestScope: reqCtx.requestScope,
        // M6 §7.6.1：进度桥接（ToolProgress → report_progress 链路）+ 请求级取消信号透传
        onUpdate: createProgressReporter(
          (progress) => {
            try {
              this.reportToolProgress(toolType, method, progress);
            } catch (err) {
              logger.warn('progress bridge failed', { error: getErrorMessage(err) });
            }
          },
          { throttleMs: 200 },
        ),
        abortSignal: reqCtx?.abortSignal,
      };

      if (activeStagingPool) {
        toolContext.stagingPool = activeStagingPool;
        toolContext.shadowState = activeShadowState;
        toolContext.agentSource = this.type === 'gamemaster' ? 'gamemaster' : 'subagent';
      }

      const response = await this.toolRegistry.execute(
        this.type,
        toolType as ToolType,
        method,
        params,
        toolContext,
      );

      return {
        id: randomUUID() as ID,
        toolCallId,
        success: response.success,
        data: response.data as Record<string, unknown>,
        error: response.error,
        timestamp: Date.now() as Timestamp,
        _meta: { toolType, method, params },
        writeOperation: response.writeOperation,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return {
        id: randomUUID() as ID,
        toolCallId,
        success: false,
        error: errorMessage,
        timestamp: Date.now() as Timestamp,
      };
    }
  }

  /**
   * M6 §7.6.1：工具进度映射进现有 report_progress 链路（phase='tool_call'）。
   *
   * detail 经 ProgressDetail 的 Record<string, unknown> 兜底成员承载扩展 progress 字段，
   * 前端 updateProgressTree 按 toolName 定位节点、未知字段通用渲染——零前端改动（§7.6.1 调查结论）。
   */
  protected override reportToolProgress(toolType: string, method: string, progress: ToolProgress): void {
    this.reportProgress('tool_call', {
      toolName: `${toolType}.${method}`,
      progress,
    });
  }

  private emitRuntimeEvent(saveId: ID | undefined, event: RuntimeEvent): void {
    if (!saveId) return;
    const collector = this.deps.devTraceCollector();
    if (!collector) return;
    try {
      collector.addRuntimeEvent(saveId as string, event);
    } catch {
      // DevTraceCollector 写入失败不影响主流程
    }
  }

  private buildCurrentTraceIds(reqCtx: RequestContext, overrides?: Partial<ExecutionTraceIds>): ExecutionTraceIds {
    const base = reqCtx.traceIds ?? {};
    return {
      requestId: base.requestId ?? 'unknown',
      sessionId: base.sessionId ?? this.currentSaveId ?? 'unknown',
      agentRunId: base.agentRunId ?? '',
      agentDepth: base.agentDepth ?? 0,
      ...overrides,
    };
  }

  async handleLanguageTranslation(saveId: string, sourceLanguage: string, targetLanguage: string): Promise<{ success: boolean; error?: string }> {
    if (!this.agentInstances.size) {
      return { success: false, error: 'No agent instances available for translation' };
    }

    const translateContext = { saveId, sourceLanguage, targetLanguage, action: 'translate_data' };

    try {
      const domainAgentKeys = DOMAIN_ENRICHMENT_AGENT_TYPES as string[];
      const results = await Promise.allSettled(
        domainAgentKeys.map(agentKey => {
          const agent = this.agentInstances.get(agentKey as AgentType);
          if (!agent) return Promise.resolve({ success: true });
          return agent.processMessage({
            id: `translate-${Date.now()}`,
            timestamp: Date.now() as Timestamp,
            from: 'gamemaster' as AgentType,
            to: agentKey as AgentType,
            type: 'request',
            saveId: saveId as ID,
            payload: { action: 'chat', data: translateContext },
            metadata: { priority: 'normal', requiresResponse: false },
          });
        }),
      );

      const summary = results.map((r, i) => ({
        agent: domainAgentKeys[i],
        success: r.status === 'fulfilled',
      }));

      const allSucceeded = summary.every(s => s.success);
      if (!allSucceeded) {
        return { success: false, error: `Translation partially failed: ${summary.filter(s => !s.success).map(s => s.agent).join(', ')}` };
      }

      await this.deps.saveService.updateSaveLanguage(saveId, targetLanguage);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }
}