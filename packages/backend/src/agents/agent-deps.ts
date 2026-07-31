/**
 * AgentDeps 依赖注入容器接口与工厂。
 *
 * 设计目标：将 AgentRuntime 的全局依赖通过 AgentDeps 容器注入，消除
 * ReActAgent 对 services/ 的 value import。请求级依赖（stagingPool、
 * shadowState、traceCollector、responsePool）由 AgentRuntime 在请求
 * 处理时创建，不放入 AgentDeps。
 *
 * 详见 docs/design/fractal-design-20260626-backend-decoupling-refactor/
 *   fractal-design-20260626-backend-decoupling-refactor-模块B-Agent核心纯化.md 3.2 节
 */
import type { Knex } from 'knex';
import type { LLMService } from '@ai-rpg/ai';
// M1: LLMMetricsService 已迁移到 E 层（services/llm-metrics/）。
// 仅工厂组合根引用（派生 DevModeService），不外泄给 Agent 核心消费方。
import type { LLMMetricsService } from '../services/llm-metrics/index.js';
import type { IWebSocketBroadcaster, IPanelUpdateBroadcaster } from '@ai-rpg/shared/messaging';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import type { ID } from '@ai-rpg/shared';
// M9: LLMRequestDispatcher 端口接口（shared 层唯一权威定义，方式 A 下沉）
import type { ILLMRequestDispatcher } from '@ai-rpg/shared/types/agent';
// M5: prepareNextTurn hook 工厂签名类型（工厂实现在 init.ts 组合根闭包捕获 IModelTierResolver）
import type { PrepareNextTurnHook } from './runtime/prepare-next-turn.js';
// M4: 4 维度 placement 解析器端口（组合根装配后经 HookDispatcherDeps 注入）
import type { IHookPlacementResolver } from './runtime/types.js';
import type { AgentConfig } from '../../../shared/src/types/agent-config.js';
import type { PromptModule } from './prompt/index.js';
import type { ContextInjector } from '../services/context-injector.js';
import type { ContextFlushQueue } from '../services/context-flush-queue.js';
import type { DatabaseWriteQueue } from '../services/DatabaseWriteQueue';
import type { TemplateService } from '../services/template.js';
import type { TemplatePoolService } from '../services/template-pool.js';
import type { ITemplateProvider, ITemplatePoolProvider, IEntityGraphProvider, IContextProvider } from '../game-systems/shared/types.js';
import type { HelpRegistry } from '../services/help-registry.js';
import type { DecisionLogService } from '../services/decision-log.js';
import type { DevTraceCollector } from '../services/DevTraceCollector.js';
import type { TraceCollector } from '../services/TraceCollector.js';
import type { ResponsePool } from '../services/response-pool.js';
import type { StagingPool } from '../services/StagingPool.js';
import type { ShadowStateLayer } from '../services/ShadowStateLayer.js';
import type { RequestScope } from '../services/RequestScope.js';
import type { RequestEventBridge } from '../services/RequestEventBridge.js';
import type { QuestService } from '../game-systems/quest/QuestService.js';
import type { EventService } from '../game-systems/event/EventService.js';
import type { BusEventType } from '@ai-rpg/shared/messaging';
import type { ToolCaller, IGameTimeService } from './types.js';
import type { IMapService } from '../game-systems/map/types.js';
import type { INPCService } from '../game-systems/npc/types.js';
import type { IAuditAgent, AuditContext } from '../game-systems/audit/ProgramChecker.js';
import type { IStagingPool, IShadowStateLayer } from '@ai-rpg/shared/tool-core';
import type { ISaveProvider } from '../game-systems/save/types.js';
// EG-M2-8: IEntityGraphRepairer 端口接口（GMAgentDeps 新增字段类型）
// EG-M3-7: IEntityGraphCache 端口接口（AgentDeps 新增字段类型，用于 flush 后失效缓存）
// EG-M4-3: IEntityGraphAuditor 端口接口（收敛到 entity-graph/types.ts，含 auditGraphState）
// EG-M4-4: IEntityGraphReconciler 端口接口（GMAgentDeps 新增字段类型，定期纠错）
// 模块2 简化：删除 IEntityGraphRepairer/IEntityGraphAuditor（Auditor/Repairer 已删除）
import type { IEntityGraphCache, IEntityGraphReconciler } from '../game-systems/entity-graph/types.js';
import type {
  ICharacterReadPort,
  INPCReadPort,
  ILocationReadPort,
  ILocationConnectionReadPort,
  IInventoryReadPort,
  IQuestReadPort,
  IEventReadPort,
  IFactionReadPort,
  ICharacterSkillReadPort,
  INPCGoalReadPort,
  EntityGraphBuildContext,
} from '../game-systems/entity-graph/types.js';

/**
 * bootstrap 级事件处理器容器（FOLLOWUP-3 新增）。
 *
 * 持有 bootstrap QuestService/EventService 实例，供 AgentRuntime post-flush 处理 pending 事件。
 * bootstrap 实例使用原始 db（非 StagingKnex），仅用于 post-flush 阶段（§13.1 不适用）。
 */
export interface BootstrapEventHandlers {
  questService: QuestService;
  eventService: EventService;
}

/** QuestService 订阅的事件类型（与 index.ts bootstrap 订阅保持一致） */
export const QUEST_EVENT_TYPES: readonly BusEventType[] = [
  'kill', 'item_change', 'dialogue', 'location_enter', 'equip_item', 'use_item',
] as const;

/** EventService 订阅的事件类型（与 index.ts bootstrap 订阅保持一致） */
export const EVENT_SERVICE_EVENT_TYPES: readonly BusEventType[] = [
  'kill', 'dialogue', 'location_enter', 'quest_update',
] as const;

// 工厂内部 value import：派生依赖的具体类。仅工厂使用，不外泄给消费方。
import { ContextCompressor } from '../services/context-compressor.js';
import { EntityGraphUpdater } from '../game-systems/entity-graph/EntityGraphUpdater.js';
import { EntityGraphBuilder } from '../game-systems/entity-graph/EntityGraphBuilder.js';
// EG-M4-4: EntityGraphReconciler（定期纠错器，在 createGMAgentDeps 内创建）
import { EntityGraphReconciler } from '../game-systems/entity-graph/EntityGraphReconciler.js';
import { EntityGraphLayer } from './prompt/layers/entity-graph-layer.js';
import { SaveService } from '../game-systems/save/SaveService.js';
import { SaveRepository } from '../game-systems/save/SaveRepository.js';
import { SaveStateRepository } from '../game-systems/save/SaveStateRepository.js';
import { SaveSnapshotRepository } from '../game-systems/save/SaveSnapshotRepository.js';
import { SaveGameTimeRepository } from '../game-systems/save/SaveGameTimeRepository.js';
import { SaveDataPort } from '../game-systems/save/SaveDataPort.js';
import { KnexTransactionManager } from '../database/TransactionManager.js';
import { DevModeService } from '../services/DevModeService.js';
import { getDevTraceCollector } from '../services/DevTraceCollector.js';
import { DevTraceHook } from '../services/DevTraceHook.js';

// GM-specific 派生依赖（全部在 agents/ 层，可 value import）
import { ResponseBuilder } from './coordinator/ResponseBuilder.js';
import { ResultIntegrator } from './coordinator/ResultIntegrator.js';
import { StoryKernel } from './story/StoryKernel.js';
import { EpisodicMemoryService } from './memory/episodic-memory-service.js';
import { ProceduralMemoryService } from './memory/procedural-memory-service.js';
import { SemanticContextCompressor } from './memory/semantic-context-compressor.js';
import { PromptBuildBudgetGuard } from './memory/prompt-budget-guard.js';
import { EpisodicMemoryRepository } from '../game-systems/memory/EpisodicMemoryRepository.js';
import { ProceduralMemoryRepository } from '../game-systems/memory/ProceduralMemoryRepository.js';
import type { RefreshRepos } from './coordinator/DataRefreshHandler.js';
import { CharacterRepository } from '../game-systems/character/CharacterRepository.js';
import { InventoryRepository } from '../game-systems/inventory/InventoryRepository.js';
import { LocationRepository } from '../game-systems/map/LocationRepository.js';
import { LocationConnectionRepository } from '../game-systems/map/LocationConnectionRepository.js';
import { NPCRepository } from '../game-systems/npc/NPCRepository.js';
import { QuestRepository } from '../game-systems/quest/QuestRepository.js';
import { QuestObjectiveRepository } from '../game-systems/quest/QuestObjectiveRepository.js';
import { CharacterSkillRepository } from '../game-systems/skill/CharacterSkillRepository.js';

/**
 * Agent 运行时全局依赖容器。
 *
 * 包含全局依赖（init 阶段创建，整个 Agent 生命周期共享）和请求级服务工厂
 * （v1.5 新增）。请求级服务（StagingPool、ShadowStateLayer、TraceCollector、
 * ResponsePool）通过工厂函数创建，工厂在组合根（init.ts）闭包捕获 db 和
 * SHADOW_STATE_TABLES 等组合根级参数，仅暴露请求级参数（requestId/saveId 等）。
 *
 * v2.4 修订：原设计将请求级依赖放入 AgentDeps，但 ShadowStateLayer 需要
 * scopeValues+tables、TraceCollector 需要 requestId，无法在全局工厂创建，
 * 故拆分为全局依赖（17）+ 请求级依赖（4，由 AgentRuntime 管理）。
 *
 * v2.7 修订：新增 db 字段（第 18 字段）。AgentRuntime 多处需要 db 直接访问
 * （createShadowState/buildContextFetcher/executeDeterministicActions 等），
 * 原 ReActAgent 通过 deps.db 获取，AgentDeps 必须暴露此字段。
 * v2.8 修订：删除 db 字段。prompt 层 db 调用全部迁移到端口接口
 * （drive-layer 用 allNpcs.filter，equipment-slot-layer 用 ITemplateProvider.getInventoryRules），
 * AgentRuntime 不再需要直接访问 db。CreateAgentDepsParams.db 保留供组合根创建 Repository。
 *
 * v1.5 修订：新增 4 个请求级服务工厂字段（createTraceCollector/
 * createResponsePool/createStagingPool/createShadowStateLayer），消除
 * AgentRuntime 对 services/ 的 4 处 value import。工厂在 init.ts 组装，
 * AgentRuntime 通过 deps.createXxx() 调用获取请求级实例。
 */
export interface AgentDeps {
  /** Prompt 构建 */
  promptModule: PromptModule;

  /**
   * LLM 调用（Phase 1 后从 @ai-rpg/ai 引用）
   *
   * @deprecated M9 双写过渡期保留：新代码请使用 llmRequestDispatcher。
   * 保留原因（设计 §11 回退策略）：
   * - 工厂内部派生 ContextCompressor / SemanticContextCompressor 仍需原始 LLMService
   * - ReActEngine（chatRaw 热路径）与 StoryKernel / LLMChecker 等辅助路径在过渡期内继续使用
   * 一个 Sprint 后移除本字段。
   */
  llmService: LLMService;

  /**
   * LLM 请求调度器（M9 新增）。
   *
   * ReAct 循环外 Agent 入口（AgentRuntime.callLLM）统一经此调度：
   * 选 key + per-key 令牌桶限流 + 429/401 失败转移 + 调度指标事件。
   * 端口接口唯一定义在 shared/types/agent.ts（方式 A 下沉）。
   */
  llmRequestDispatcher: ILLMRequestDispatcher;

  /** 上下文管理 */
  contextInjector: ContextInjector;
  contextCompressor: ContextCompressor;
  contextService: IContextProvider;

  /** 数据基础设施 */
  writeQueue: DatabaseWriteQueue;

  /** 实体图 */
  entityGraphService: IEntityGraphProvider;
  /**
   * EntityGraphService 共享的缓存实例（EG-M3-6 新增）。
   *
   * AgentRuntime 在 StagingPool flush 后调用 cache.invalidate(saveId) 失效缓存，
   * 确保下一次查询从 DB 重新加载（不脏读）。
   * 该实例与 init.ts 创建 EntityGraphService 时注入的 cache 是同一引用。
   */
  graphServiceCache: IEntityGraphCache;
  entityGraphUpdater: EntityGraphUpdater;
  entityGraphLayer: EntityGraphLayer;
  /**
   * EntityGraphBuilder（EG-M1-2 新增）— 全量图构建器。
   * processInitialize 在 ReAct flush 后调用 enrichFromExistingData 补充基础图（初始化豁免，不走 StagingPool）。
   */
  entityGraphBuilder: EntityGraphBuilder;
  /**
   * EntityGraphBuildContext（EG-M1-2 新增）— 11 个跨领域 ReadPort 聚合。
   * 供 EntityGraphBuilder.enrichFromExistingData 读取已落库的业务表数据。
   */
  entityGraphBuildContext: EntityGraphBuildContext;

  /**
   * NPC 服务工厂（per-request，D-S2-6 新增）。
   *
   * NPCService 依赖 per-request CharacterService（ruleParser 依赖 saveId），
   * 无法全局单例。每次请求时通过工厂创建新实例，闭包捕获 db + ServiceTool 组合根。
   * PromptLayer 驱动力/信息边界等需要查询 NPC 数据时，先 await 工厂获取实例。
   */
  npcServiceFactory: (saveId: ID) => Promise<INPCService>;

  /** 模板（v1.8 接口注入，业务层通过接口访问） */
  templateProvider: ITemplateProvider;
  templatePoolProvider: ITemplatePoolProvider;

  /** 存档 */
  saveService: ISaveProvider;

  /** 帮助与规则 */
  helpRegistry: HelpRegistry;

  /** 决策与追踪 */
  decisionLogService: DecisionLogService;

  /** 开发工具 */
  devModeService: DevModeService;
  devTraceCollector: () => DevTraceCollector | null;

  /** 上下文刷新队列（v1.4 新增，violation #2, #11） */
  flushQueue: ContextFlushQueue;
  /** WebSocket 广播端口（v1.4 新增，violation #4, #8, #12, #13） */
  webSocketService: IWebSocketBroadcaster;
  /**
   * 面板变更统一推送端口（统一面板变更推送机制新增）。
   *
   * AgentRuntime 在 ReAct flush 后调用 pushPanelUpdates 推送合并后的 panelUpdates
   * （含 LLM 输出 + domain refresh 数据，经 PanelUpdatesMerger 合并）。
   * 实现委托 IWebSocketBroadcaster.broadcastToClient 推送 'panel:update' 事件。
   */
  panelUpdateBroadcaster: IPanelUpdateBroadcaster;
  /**
   * dev:* 调试事件统一 Hook 端口（AP-L1 新增）。
   *
   * 业务代码通过此端口调用 dev:* 事件广播，不再直接依赖 IWebSocketBroadcaster。
   * 实现内部封装 DevTraceCollector.addTrace + broadcastToClient + try-catch + warn。
   */
  devTraceHook: IDevTraceHook;

  /** 工具调用器（替代直接依赖 ToolRegistry） */
  toolCaller: ToolCaller;

  /** 请求级服务工厂（v1.5 新增，消除 AgentRuntime value import services/） */
  createTraceCollector: (requestId: string) => TraceCollector;
  createResponsePool: () => ResponsePool;
  createStagingPool: () => StagingPool;
  createShadowStateLayer: (
    saveId: ID,
    templateId: string | undefined,
    enableSnapshot: boolean,
  ) => ShadowStateLayer;
  /** 请求级 Service 缓存管理器工厂（架构债务治理新增） */
  createRequestScope: () => RequestScope;

  /**
   * prepareNextTurn hook 工厂（M5 新增，可选）。
   *
   * init.ts 闭包捕获 IModelTierResolver；per-request 调用，返回本请求专用 hook 实例
   * （tier 解析 memoize 作用域 = 请求）。Agent 未配置 prepareNextTurn 时返回 undefined，
   * ReActEngine 零行为变化（M5 设计 §8.5）。
   */
  createPrepareNextTurnHook?: (agentConfig: AgentConfig) => PrepareNextTurnHook | undefined;

  /**
   * Per-request 事件桥接器（FOLLOWUP-3 新增）。
   * AgentRuntime 通过它包裹 processMessageCore，激活 per-request 事件队列。
   * bootstrap 订阅器通过它转发事件，避免 ReAct 循环内直接写 DB 绕过 StagingPool（§13.1）。
   */
  requestEventBridge: RequestEventBridge;

  /**
   * bootstrap 级事件处理器（FOLLOWUP-3 新增）。
   * AgentRuntime post-flush 阶段调用，处理 pending EventBus 事件。
   * 使用原始 db（非 StagingKnex），仅用于 post-flush（§13.1 不适用）。
   */
  bootstrapEventHandlers: BootstrapEventHandlers;

  /**
   * 无状态审核Agent（v5.2 上移自 GMAgentDeps，所有 Agent 都可获取）。
   * on_task_complete hook 回调调用 auditAgent.auditForReport 获取 AuditReport。
   */
  auditAgent: IAuditAgent;
  /**
   * 审核上下文构造器（v5.2 上移自 GMAgentDeps，所有 Agent 都可获取）。
   * init.ts 闭包捕获 dataProviders/db 等共享依赖；
   * per-request 的 stagingPool/shadowState 由 AgentRuntime 调用时传入。
   */
  auditContextBuilder: (
    saveId: ID,
    templateId: ID,
    perRequest: { stagingPool: IStagingPool; shadowState: IShadowStateLayer },
  ) => AuditContext;

  /**
   * 4 维度 placement 解析器（M4 §9.2，可选）。
   * init.ts 组合根装配后经 HookDispatcherDeps 注入；缺省时 dispatch 走现状默认链
   * （渐进迁移路径，§8.3）。GM 与子 Agent 共享同一单例（解析器无 per-request 状态，
   * per-request 的 4 维度上下文在 dispatch 调用点传入）。
   */
  placementResolver?: IHookPlacementResolver;
}

/**
 * createAgentDeps 工厂参数：init.ts 已创建的基础依赖。
 *
 * 工厂内部从这些基础依赖派生出其余全局依赖（contextCompressor、
 * entityGraphService 等），组装成完整的 AgentDeps 容器。
 *
 * v1.5 新增 4 个请求级服务工厂参数：工厂在 init.ts（组合根）组装，
 * 闭包捕获 db 和 SHADOW_STATE_TABLES 等组合根级参数，仅暴露请求级参数。
 */
export interface CreateAgentDepsParams {
  db: Knex;
  llmService: LLMService;
  /** LLM 请求调度器（M9 新增，init.ts 组合根创建并 initialize 后传入） */
  llmRequestDispatcher: ILLMRequestDispatcher;
  llmMetricsService: LLMMetricsService;
  promptModule: PromptModule;
  writeQueue: DatabaseWriteQueue;
  helpRegistry: HelpRegistry;
  contextInjector: ContextInjector;
  contextService: IContextProvider;
  entityGraphService: IEntityGraphProvider;
  /** EG-M3-6: 共享缓存实例（用于 flush 后失效缓存） */
  graphServiceCache: IEntityGraphCache;
  /** NPC 服务工厂（per-request，由 init.ts 闭包捕获 db + NPCServiceTool 组装） */
  npcServiceFactory: (saveId: ID) => Promise<INPCService>;
  decisionLogService: DecisionLogService;
  templateService: TemplateService;
  templatePoolService: TemplatePoolService;
  // 注：CreateAgentDepsParams 保留具体类类型（组合根需要具体类构造 SaveService/DevModeService 等派生依赖）。
  // 字段名保持 templateService/templatePoolService 以便与 init.ts 调用方对齐。
  // AgentDeps 字段（templateProvider/templatePoolProvider）使用接口类型，业务层通过接口访问。
  toolCaller: ToolCaller;
  /** 上下文刷新队列（v1.4 新增） */
  flushQueue: ContextFlushQueue;
  /** WebSocket 广播端口（v1.4 新增） */
  webSocketService: IWebSocketBroadcaster;
  /**
   * 面板变更统一推送端口（统一面板变更推送机制新增）。
   *
   * 由 init.ts 组合根创建 PanelUpdateBroadcaster 实例后传入，
   * 复用 webSocketService 实例构造（接口最小化，仅依赖 IWebSocketBroadcaster）。
   */
  panelUpdateBroadcaster: IPanelUpdateBroadcaster;
  /**
   * dev:* 调试事件统一 Hook 端口（AP-L1 新增）。
   *
   * 由 init.ts 组合根创建 DevTraceHook 实例后传入。
   * 若未传入，工厂内部会基于 webSocketService + getDevTraceCollector() 创建默认实例。
   */
  devTraceHook?: IDevTraceHook;
  /** 请求级服务工厂（v1.5 新增，在 init.ts 组装） */
  createTraceCollector: (requestId: string) => TraceCollector;
  createResponsePool: () => ResponsePool;
  createStagingPool: () => StagingPool;
  createShadowStateLayer: (
    saveId: ID,
    templateId: string | undefined,
    enableSnapshot: boolean,
  ) => ShadowStateLayer;
  /** 请求级 Service 缓存管理器工厂（架构债务治理新增） */
  createRequestScope: () => RequestScope;
  /**
   * prepareNextTurn hook 工厂（M5 新增，可选）。
   * init.ts 组合根闭包捕获 IModelTierResolver 后传入；缺省时 AgentRuntime 不启用循环内切模型。
   */
  createPrepareNextTurnHook?: (agentConfig: AgentConfig) => PrepareNextTurnHook | undefined;
  /** Per-request 事件桥接器（FOLLOWUP-3 新增，index.ts 组合根注入） */
  requestEventBridge: RequestEventBridge;
  /** bootstrap 级事件处理器（FOLLOWUP-3 新增，index.ts 组合根注入） */
  bootstrapEventHandlers: BootstrapEventHandlers;
  /** 无状态审核Agent（v5.2 上移自 CreateGMAgentDepsParams，所有 Agent 都可获取） */
  auditAgent: IAuditAgent;
  /** 审核上下文构造器（v5.2 上移自 CreateGMAgentDepsParams，所有 Agent 都可获取） */
  auditContextBuilder: (
    saveId: ID,
    templateId: ID,
    perRequest: { stagingPool: IStagingPool; shadowState: IShadowStateLayer },
  ) => AuditContext;
  /** 4 维度 placement 解析器（M4 §9.2，可选；init.ts 组合根装配后传入，缺省走默认链） */
  placementResolver?: IHookPlacementResolver;
}

/**
 * 从 init 阶段已创建的基础依赖派生出完整的 AgentDeps 容器。
 *
 * 派生依赖（6 个）由工厂内部基于 db/llmService/templateService 等创建：
 * - contextCompressor: new ContextCompressor(db, llmService)
 * - entityGraphUpdater: new EntityGraphUpdater(devTraceHook)
 * - entityGraphLayer: new EntityGraphLayer()
 * - saveService: new SaveService(db, templateService)
 * - devModeService: new DevModeService(templateService, llmMetricsService)
 * - devTraceCollector: () => getDevTraceCollector()
 * - devTraceHook: params.devTraceHook ?? new DevTraceHook(getDevTraceCollector(), webSocketService)
 *
 * v1.9.2 修订：entityGraphService 不再由工厂内部 new，改为由 init.ts 传入（单一实例化模式，
 * 与 contextService 模式对称）。工厂仅透传，不构造。
 *
 * 请求级服务工厂（v1.5 新增 4 个）由 init.ts 组装后传入，本工厂仅透传：
 * - createTraceCollector / createResponsePool / createStagingPool / createShadowStateLayer
 * 工厂在组合根闭包捕获 db 和 SHADOW_STATE_TABLES，仅暴露请求级参数。
 */
export function createAgentDeps(params: CreateAgentDepsParams): AgentDeps {
  const {
    db,
    llmService,
    llmRequestDispatcher,
    llmMetricsService,
    promptModule,
    writeQueue,
    helpRegistry,
    contextInjector,
    contextService,
    entityGraphService,
    graphServiceCache,
    npcServiceFactory,
    decisionLogService,
    templateService,
    templatePoolService,
    toolCaller,
    flushQueue,
    webSocketService,
    panelUpdateBroadcaster,
    createTraceCollector,
    createResponsePool,
    createStagingPool,
    createShadowStateLayer,
    createRequestScope,
    createPrepareNextTurnHook,
    requestEventBridge,
    bootstrapEventHandlers,
    auditAgent,
    auditContextBuilder,
    placementResolver,
  } = params;

  // AP-L1: dev:* 事件统一 Hook 端口。
  // 优先使用 init.ts 组合根传入的实例（推荐），否则工厂内部创建默认实例。
  const devTraceHook: IDevTraceHook = params.devTraceHook ?? new DevTraceHook(
    getDevTraceCollector(),
    webSocketService,
  );

  // S5: EntityGraphUpdater 跨领域端口适配器（ICharacterReadPort）
  const characterReadPort: ICharacterReadPort = {
    findBySaveId: async (saveId) => {
      const repo = new CharacterRepository(db);
      return repo.findBySaveIdWithNames(saveId) as unknown as Record<string, unknown>[];
    },
    findIdBySaveId: async (saveId) => {
      const repo = new CharacterRepository(db);
      const rows = await repo.findBySaveIdWithNames(saveId);
      return rows[0]?.id ?? null;
    },
  };

  // EG-M1-1: EntityGraphBuilder 跨领域只读端口适配器（10 个缺失端口）
  // 实现策略：adapter 直接查询 db 获取 raw rows（snake_case），EntityGraphBuilder 需要原始字段而非 mapped entities。
  // characterReadPort 走 Repository.findBySaveIdWithNames 是因为该方法做 JOIN（characters + names），非简单 SELECT *。
  // 详见设计文档模块1 ReadPort adapter 实现策略章节。
  const npcReadPort: INPCReadPort = {
    findBySaveId: async (saveId, trx?) => {
      const query = trx ? db('npcs').transacting(trx) : db('npcs');
      const rows = await query.where({ save_id: saveId }).select('*');
      return rows as unknown as Record<string, unknown>[];
    },
  };

  // 模块2 简化：删除 npcRelationReadPort 适配器（npc_relations 表已删除，关系数据由 PERCEIVES 边维护）

  const locationReadPort: ILocationReadPort = {
    findBySaveId: async (saveId, trx?) => {
      const query = trx ? db('locations').transacting(trx) : db('locations');
      const rows = await query.where({ save_id: saveId }).select('*');
      return rows as unknown as Record<string, unknown>[];
    },
  };

  const locationConnectionReadPort: ILocationConnectionReadPort = {
    findBySaveId: async (saveId, trx?) => {
      const query = trx ? db('location_connections').transacting(trx) : db('location_connections');
      const rows = await query.where({ save_id: saveId }).select('*');
      return rows as unknown as Record<string, unknown>[];
    },
  };

  const inventoryReadPort: IInventoryReadPort = {
    findBySaveId: async (saveId, ownerType?, trx?) => {
      let query = trx ? db('inventory').transacting(trx) : db('inventory');
      query = query.where({ save_id: saveId });
      if (ownerType) {
        query = query.where({ owner_type: ownerType });
      }
      const rows = await query.select('*');
      return rows as unknown as Record<string, unknown>[];
    },
  };

  const questReadPort: IQuestReadPort = {
    findBySaveId: async (saveId, trx?) => {
      const query = trx ? db('quests').transacting(trx) : db('quests');
      const rows = await query.where({ save_id: saveId }).select('*');
      return rows as unknown as Record<string, unknown>[];
    },
  };

  const eventReadPort: IEventReadPort = {
    // JOIN event_triggers + events：events 表无 save_id（全局事件模板表），通过 event_triggers.save_id 过滤
    // 返回 events.id/name/type/trigger_type（trigger_type 在 events 表，不在 event_triggers 表）
    findTriggerEventsBySaveId: async (saveId, trx?) => {
      const query = trx ? db('event_triggers').transacting(trx) : db('event_triggers');
      const rows = await query
        .join('events', 'event_triggers.event_id', 'events.id')
        .where('event_triggers.save_id', saveId)
        .select('events.id', 'events.name', 'events.type', 'events.trigger_type');
      return rows as unknown as Record<string, unknown>[];
    },
  };

  const factionReadPort: IFactionReadPort = {
    findBySaveId: async (saveId, trx?) => {
      const query = trx ? db('factions').transacting(trx) : db('factions');
      const rows = await query.where({ save_id: saveId }).select('*');
      return rows as unknown as Record<string, unknown>[];
    },
    // 运行时检测：factions 表在 migrations 中不存在（兼容旧存档/未来扩展）
    hasTable: async () => db.schema.hasTable('factions'),
  };

  const characterSkillReadPort: ICharacterSkillReadPort = {
    findBySaveId: async (saveId, trx?) => {
      const query = trx ? db('character_skills').transacting(trx) : db('character_skills');
      const rows = await query.where({ save_id: saveId }).select('*');
      return rows as unknown as Record<string, unknown>[];
    },
  };

  const npcGoalReadPort: INPCGoalReadPort = {
    findActiveBySaveId: async (saveId, trx?) => {
      const query = trx ? db('npc_goals').transacting(trx) : db('npc_goals');
      const rows = await query.where({ save_id: saveId, status: 'active' }).select('*');
      return rows as unknown as Record<string, unknown>[];
    },
    // 运行时检测：npc_goals 表可能不存在（旧存档兼容）
    hasTable: async () => db.schema.hasTable('npc_goals'),
  };

  // EG-M1-2: EntityGraphBuilder 实例 + EntityGraphBuildContext 聚合
  // EntityGraphBuilder 使用 entityGraphService（IEntityGraphProvider）进行图写入（upsertNode/upsertEdge）
  // EntityGraphBuildContext 聚合 11 个 ReadPort，供 enrichFromExistingData 读取已落库的业务表数据
  const entityGraphBuilder = new EntityGraphBuilder(entityGraphService);
  const entityGraphBuildContext: EntityGraphBuildContext = {
    characterPort: characterReadPort,
    npcPort: npcReadPort,
    // 模块2 简化：删除 npcRelationPort 字段（npc_relations 表已删除，关系数据由 PERCEIVES 边维护）
    locationPort: locationReadPort,
    locationConnectionPort: locationConnectionReadPort,
    inventoryPort: inventoryReadPort,
    questPort: questReadPort,
    eventPort: eventReadPort,
    factionPort: factionReadPort,
    characterSkillPort: characterSkillReadPort,
    npcGoalPort: npcGoalReadPort,
  };

  // S5: SaveService 组合根 — 4 Repository + SaveDataPort + txManager
  const saveRepo = new SaveRepository(db);
  const saveSnapshotRepo = new SaveSnapshotRepository(db);
  const saveStateRepo = new SaveStateRepository(db);
  const saveGameTimeRepo = new SaveGameTimeRepository(db);
  const saveDataPort = new SaveDataPort(db);
  const saveTxManager = new KnexTransactionManager(db);

  return {
    promptModule,
    llmService,
    llmRequestDispatcher,
    contextInjector,
    contextCompressor: new ContextCompressor(db, llmService),
    contextService,
    writeQueue,
    entityGraphService,
    graphServiceCache,
    entityGraphUpdater: new EntityGraphUpdater(devTraceHook),
    entityGraphLayer: new EntityGraphLayer(),
    entityGraphBuilder,
    entityGraphBuildContext,
    npcServiceFactory,
    templateProvider: templateService,
    templatePoolProvider: templatePoolService,
    saveService: new SaveService(saveRepo, saveSnapshotRepo, saveStateRepo, saveGameTimeRepo, saveDataPort, saveTxManager),
    helpRegistry,
    decisionLogService,
    devModeService: new DevModeService(templateService, llmMetricsService),
    devTraceCollector: () => getDevTraceCollector(),
    flushQueue,
    webSocketService,
    panelUpdateBroadcaster,
    devTraceHook,
    toolCaller,
    createTraceCollector,
    createResponsePool,
    createStagingPool,
    createShadowStateLayer,
    createRequestScope,
    createPrepareNextTurnHook,
    requestEventBridge,
    bootstrapEventHandlers,
    auditAgent,
    auditContextBuilder,
    placementResolver,
  };
}

/**
 * GM-specific AgentDeps 子接口。
 *
 * 仅 GM Agent 需要这 9 个依赖（普通子 Agent 不需要）。
 * createGMAgentDeps 在 createAgentDeps 基础上派生 GM-specific 依赖。
 *
 * v2.7 修订：新增 mapServiceFactory/npcServiceFactory 工厂字段（D-S2-6 per-request 模式），
 * 替代 ReActAgent 对 MapService/NPCService 具体类的直接依赖。
 */
export interface GMAgentDeps extends AgentDeps {
  /** GM 响应构建 */
  responseBuilder: ResponseBuilder;
  /** GM 故事系统（init.ts 创建 StoryService 并包装为 StoryKernel 注入） */
  storyKernel: StoryKernel;
  /** GM 结果集成 */
  resultIntegrator: ResultIntegrator;
  /** GM 记忆系统 */
  episodicMemoryService: EpisodicMemoryService;
  proceduralMemoryService: ProceduralMemoryService;
  semanticContextCompressor: SemanticContextCompressor;
  /** GM 预算检查 */
  promptBuildBudgetGuard: PromptBuildBudgetGuard;
  /**
   * GM 场景构建所需的地图数据查询工厂（per-request，D-S2-6 新增）。
   *
   * MapService 依赖 per-request CharacterService（ruleParser 依赖 saveId），
   * 无法全局单例。每次请求时通过工厂创建新实例。
   */
  mapServiceFactory: (saveId: ID) => Promise<IMapService>;
  /**
   * GM 战斗状态轻量检查（P1.2 修订，替代原 combatServiceFactory）。
   *
   * 原 combatServiceFactory 每次请求创建完整 9 参数 CombatService（~22 次 DB query + ~11 次 YAML 解析），
   * 仅用于 AgentRuntime inCombat 检查。P1.2 改为轻量 existsBySaveId（1 次 SELECT combat_states）。
   * CombatServiceTool.hasActiveCombat 内部 new CombatRepository 直接查询，不创建完整 Service。
   */
  isInCombat: (saveId: ID) => Promise<boolean>;
  /** GM 时间查询与推进（P3-S8 新增，消除 ResponseBuilder 对 GameTimeService 的动态 import） */
  gameTimeService: IGameTimeService;
  /**
   * GM 图定期纠错器（EG-M4-4 新增）— 全量重建图数据，修复累积漂移。
   *
   * 触发时机：
   * - 写入阈值触发（processChat 后，累计写入次数达 50 次）
   * - 章节推进触发（EventBus chapter_advanced 事件，快照前纠错）
   *
   * 由 init.ts 构造 EntityGraphReconciler 实例并注入，
   * AgentRuntime.triggerReconcileIfNeeded + init.ts chapter_advanced 订阅调用。
   *
   * 模块2 简化：删除 graphAuditor/entityGraphRepairer 字段（Auditor/Repairer 已删除）。
   */
  entityGraphReconciler: IEntityGraphReconciler;
  // v5.2：auditAgent + auditContextBuilder 已上移到 AgentDeps（所有 Agent 都可获取）
}

/**
 * createGMAgentDeps 工厂参数。
 *
 * 继承 CreateAgentDepsParams（复用 createAgentDeps），新增 GM-specific 必传参数：
 * - storyKernel: 由 init.ts 构造（需 StoryService 来自 game-systems/，agents/ 不能 value import）
 * - mapServiceFactory: per-request 工厂，闭包捕获 db + MapServiceTool（D-S2-6）
 * - maxContextTokens: PromptBuildBudgetGuard 预算上限，默认 8000
 *
 * 注：npcServiceFactory 已在 CreateAgentDepsParams 中定义。
 */
export interface CreateGMAgentDepsParams extends CreateAgentDepsParams {
  storyKernel: StoryKernel;
  mapServiceFactory: (saveId: ID) => Promise<IMapService>;
  /** 战斗状态轻量检查闭包（P1.2，由 init.ts 闭包捕获 db + CombatServiceTool.hasActiveCombat 组装） */
  isInCombat: (saveId: ID) => Promise<boolean>;
  gameTimeService: IGameTimeService;
  // v5.2：auditAgent + auditContextBuilder 已上移到 CreateAgentDepsParams（所有 Agent 都可获取）
  maxContextTokens?: number;
}

/**
 * 从 init 阶段已创建的基础依赖 + GM-specific 外部依赖派生出完整的 GMAgentDeps。
 *
 * 工厂内可派生的 GM 依赖（6 个，仅需 db/llmService/内部依赖）：
 * - responseBuilder: new ResponseBuilder(responseBuilderRepos, writeQueue, saveService, gameTimeService)
 * - resultIntegrator: new ResultIntegrator()
 * - episodicMemoryService: new EpisodicMemoryService(new EpisodicMemoryRepository(db))
 * - proceduralMemoryService: new ProceduralMemoryService(new ProceduralMemoryRepository(db))
 * - semanticContextCompressor: new SemanticContextCompressor(llmService, episodicMemoryService)
 * - promptBuildBudgetGuard: new PromptBuildBudgetGuard(maxContextTokens ?? 8000)
 *
 * 工厂外构造的 GM 依赖（由 init.ts 传入）：
 * - storyKernel: 需 StoryService（game-systems/）包装为 StoryDomainPort
 * - mapServiceFactory: per-request 工厂闭包（D-S2-6）
 *
 * 注：npcServiceFactory 已在 createAgentDeps 中透传。
 */
export function createGMAgentDeps(params: CreateGMAgentDepsParams): GMAgentDeps {
  const baseDeps = createAgentDeps(params);
  const { db, llmService, writeQueue, storyKernel, mapServiceFactory, isInCombat, gameTimeService, maxContextTokens } = params;
  // v5.2：auditAgent + auditContextBuilder 已在 baseDeps 中（继承自 CreateAgentDepsParams）

  const episodicMemoryService = new EpisodicMemoryService(new EpisodicMemoryRepository(db));
  const proceduralMemoryService = new ProceduralMemoryService(new ProceduralMemoryRepository(db));

  const responseBuilderRepos: RefreshRepos = {
    characterRepo: new CharacterRepository(db),
    inventoryRepo: new InventoryRepository(db),
    locationRepo: new LocationRepository(db),
    locationConnectionRepo: new LocationConnectionRepository(db),
    npcRepo: new NPCRepository(db),
    questRepo: new QuestRepository(db),
    questObjectiveRepo: new QuestObjectiveRepository(db),
    characterSkillRepo: new CharacterSkillRepository(db),
  };

  // EG-M4-4: EntityGraphReconciler 在组合根创建（D8 合规）
  // 模块2 简化版：依赖 baseDeps.entityGraphBuilder（enrichFromExistingData）+
  // baseDeps.entityGraphBuildContext（11 ReadPort）+ baseDeps.entityGraphService（getFullGraph 统计）
  // 不再依赖 graphAuditor/entityGraphRepairer/createAuditGraphProviderFactory/writeQueue
  const entityGraphReconciler = new EntityGraphReconciler(
    baseDeps.entityGraphBuilder,
    baseDeps.entityGraphBuildContext,
    baseDeps.entityGraphService,
  );

  return {
    ...baseDeps,
    responseBuilder: new ResponseBuilder(responseBuilderRepos, writeQueue, baseDeps.saveService, gameTimeService),
    storyKernel,
    resultIntegrator: new ResultIntegrator(),
    episodicMemoryService,
    proceduralMemoryService,
    semanticContextCompressor: new SemanticContextCompressor(llmService, episodicMemoryService),
    promptBuildBudgetGuard: new PromptBuildBudgetGuard(maxContextTokens ?? 8000),
    mapServiceFactory,
    isInCombat,
    gameTimeService,
    entityGraphReconciler,
    // v5.2：auditAgent + auditContextBuilder 已在 baseDeps 中（...baseDeps 展开）
  };
}

/**
 * 类型守卫：判断 AgentDeps 是否为 GMAgentDeps。
 *
 * 通过检查 GM-specific 字段是否存在来区分。AgentRuntime 构造函数用此判断
 * 是否激活 GM 路径（processGameMasterPath/processPoolGenerationPath 等）。
 */
export function isGMAgentDeps(deps: AgentDeps): deps is GMAgentDeps {
  return 'storyKernel' in deps && 'responseBuilder' in deps && 'mapServiceFactory' in deps;
}
