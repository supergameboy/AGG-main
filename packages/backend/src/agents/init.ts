import type { Knex } from 'knex';
import { resolve } from 'path';
import { ToolRegistry } from './ToolRegistry.js';
import { AgentRuntime } from './AgentRuntime.js';
import { createGMAgentDeps } from './agent-deps.js';
import { ToolCallerImpl } from './coordinator/tool-caller.js';
import { LLMService, ModelConfigService } from '@ai-rpg/ai';
import type { OAuthCredentialService } from '@ai-rpg/ai';
// M1: LLMMetricsService（查询）+ LLMMetricsSink（写入端口实现）为 E 层服务
// M9: LLMDispatchMetricsSink（Dispatcher 调度指标订阅器，写 llm_dispatch_metrics，分表决策 v2.4）
import { LLMMetricsService, LLMMetricsSink, LLMDispatchMetricsSink } from '../services/llm-metrics/index.js';
// M9: LLMRequestDispatcher（Agent 核心层 G，选 key + 令牌桶限流 + 429/401 失败转移）
import { LLMRequestDispatcher } from './llm-dispatcher/LLMRequestDispatcher.js';
// M5: prepareNextTurn 工厂 + IModelTierResolver 端口（组合根适配 ModelConfigService）
import { createPrepareNextTurnHook, type IModelTierResolver } from './runtime/prepare-next-turn.js';
// M4: 4 维度 Hook 系统组合根装配（模块M4设计 §9.2）
import { buildHookImplRegistry } from './runtime/hook-impl-registry.js';
import { buildHookPlacementResolver } from './runtime/hook-placement-resolver.js';
import { ContextService } from '../services/context.js';
import { DecisionLogService } from '../services/decision-log.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { ConfigLoader } from './config/ConfigLoader.js';
import { YamlAgentFactory } from './config/YamlAgentFactory.js';
import { PromptModule } from './prompt/index.js';
import { RulesEngine } from '../services/rules-engine.js';
import { SkillRegistry } from '../services/skill-registry.js';
import { TemplateService } from '../services/template.js';
import { TemplatePoolService } from '../services/template-pool.js';
import { DatabaseWriteQueue } from '../services/DatabaseWriteQueue';
import { updateCapabilitiesFromConfig } from './types.js';
import { GameTimeService } from '../game-systems/time/GameTimeService.js';
import { StoryService } from '../game-systems/story/StoryService.js';
import { StoryDomain } from './story/StoryDomain.js';
import { StoryKernel } from './story/StoryKernel.js';
import { EntityGraphService } from '../game-systems/entity-graph/EntityGraphService.js';
// EG-M2-9: EntityGraphSnapshotManager（自动快照）
// 模块2 简化：删除 EntityGraphAuditor/EntityGraphRepairer（审计/修复闭环已删除）
import { EntityGraphSnapshotManager } from '../game-systems/entity-graph/EntityGraphSnapshotManager.js';
// EG-M4-4: EntityGraphReconciler 在 createGMAgentDeps 内部创建（依赖 baseDeps.entityGraphBuilder 等）
// EG-M3-7: EntityGraphCache（缓存层，GM 路径共享实例）
import { EntityGraphCache } from '../game-systems/entity-graph/EntityGraphCache.js';
import type { INPCService } from '../game-systems/npc/types.js';
import type { IMapService } from '../game-systems/map/types.js';
import type { EntityGraphPort } from './story/types.js';
import type { IContextProvider } from '../game-systems/shared/types.js';
import type { EntityType } from '../game-systems/entity-graph/types.js';

import { GameTimeServiceTool } from '../game-systems/time/GameTimeServiceTool.js';
import { NumericalServiceTool } from '../game-systems/numerical/NumericalServiceTool.js';
import { CharacterServiceTool } from '../game-systems/character/CharacterServiceTool.js';
import { InventoryServiceTool } from '../game-systems/inventory/InventoryServiceTool.js';
import { SkillServiceTool } from '../game-systems/skill/SkillServiceTool.js';
import { MapServiceTool } from '../game-systems/map/MapServiceTool.js';
import { NPCServiceTool } from '../game-systems/npc/NPCServiceTool.js';
import { DialogueServiceTool } from '../game-systems/dialogue/DialogueServiceTool.js';
import { QuestServiceTool } from '../game-systems/quest/QuestServiceTool.js';
import { CombatServiceTool } from '../game-systems/combat/CombatServiceTool.js';
// 阶段四调整: G2 ChallengeProgram + ModeRouter（G2 程序执行层 + 路由层 B 的前置依赖）
// 原 ChallengeOrchestrator 拆分为 ChallengeProgram（纯程序执行）+ 服务层 E 路由编排
import { ChallengeProgram } from '../programs/ChallengeProgram.js';
import { ModeRouter } from '../game-systems/shared/mode-router/mode-router.js';
import { EventServiceTool } from '../game-systems/event/EventServiceTool.js';
import { StoryServiceTool } from '../game-systems/story/StoryServiceTool.js';
import { GameInitServiceTool } from '../game-systems/init/GameInitServiceTool.js';
import { GenerateOptionsTool } from '../game-systems/character/GenerateOptionsTool.js';
import { BatchQueryServiceTool } from '../game-systems/batch/BatchQueryServiceTool.js';
import { EntityGraphServiceTool } from '../game-systems/entity-graph/EntityGraphServiceTool.js';
import { TemplatePoolServiceTool } from '../game-systems/template/TemplatePoolServiceTool.js';
import { CoordinatorServiceTool } from './tools/coordinator-service.js';
import { ContextInjector } from '../services/context-injector.js';
import { GameDataExpander } from '../services/game-data-expander.js';
import { TemplateRecordAdapter } from '../services/data-source-adapters/TemplateRecordAdapter.js';
import { TemplatePoolAdapter } from '../services/data-source-adapters/TemplatePoolAdapter.js';
import { SavePoolAdapter } from '../services/data-source-adapters/SavePoolAdapter.js';
import { GameStateAdapter } from '../services/data-source-adapters/GameStateAdapter.js';
// 模块4: 关系数据.* tag 适配器（EntityGraphService 查询能力暴露给 manifest）
import { EntityGraphAdapter } from '../services/data-source-adapters/EntityGraphAdapter.js';
import { buildDataProviders, createExpandContextBuilder, buildShadowSavePoolProvider } from '../services/data-providers-builder.js';
import { DispatchLogRepository } from '../game-systems/dispatch/DispatchLogRepository.js';
import { DedupService } from '../game-systems/dispatch/DedupService.js';
import { AuditAgent } from '../game-systems/audit/AuditAgent.js';
import { LLMCheckerImpl } from '../game-systems/audit/LLMChecker.js';
import { RootCauseClassifierImpl } from '../game-systems/audit/RootCauseClassifier.js';
import {
  EntityCountsChecker,
  NpcLocationChecker,
  ItemOwnershipChecker,
} from '../game-systems/audit/program-checkers/index.js';
import { RuleServiceTool } from './tools/rule-service.js';
import { SkillLoaderTool } from './tools/skill-service.js';
import { HelpServiceTool } from './tools/help-service.js';
import { DynamicUIServiceTool } from './tools/dynamic-ui-service.js';
import { AgentMemoryServiceTool } from './memory/agent-memory-service-tool.js';
import { HelpRegistry } from '../services/help-registry.js';
import { ContextFlushQueue } from '../services/context-flush-queue.js';
// P1-2: 组合根创建 WebSocketService 实例（移除模块级单例 value import）
import { WebSocketService } from '../services/WebSocketService.js';
import { ClientSessionManager } from '../services/ClientSessionManager.js';
// v1.5: 请求级服务工厂所需的具体类（组合根 value import，合法）
import { TraceCollector } from '../services/TraceCollector.js';
import { ResponsePool } from '../services/response-pool.js';
import { StagingPool } from '../services/StagingPool.js';
import { ShadowStateLayer, type ShadowStateTableConfig } from '../services/ShadowStateLayer.js';
import { RequestScope } from '../services/RequestScope.js';
// AP-L1: dev:* 调试事件统一 Hook 端口实现（组合根创建单例，注入到 StagingPool/EntityGraphUpdater/BaseAgent）
import { DevTraceHook } from '../services/DevTraceHook.js';
import { getDevTraceCollector } from '../services/DevTraceCollector.js';
// 统一面板变更推送机制：服务层 E 实现，组合根创建单例注入 AgentDeps
import { PanelUpdateBroadcaster } from '../services/PanelUpdateBroadcaster.js';
import type { ID } from '@ai-rpg/shared';
import type { IStagingPool, IShadowStateLayer, IDevTraceHook } from '@ai-rpg/shared/tool-core';
import type { IPanelUpdateBroadcaster } from '@ai-rpg/shared/messaging';
import type { AuditContext, LLMChecker } from '../game-systems/audit/ProgramChecker.js';
// P0-2: game-service 依赖注入所需的具体类（组合根 value import，合法）
import type { GameServiceDeps, RollbackRepos } from '../services/game-service.js';
import { KnexTransactionManager } from '../database/TransactionManager.js';
import { LocationRepository } from '../game-systems/map/LocationRepository.js';
import { LocationConnectionRepository } from '../game-systems/map/LocationConnectionRepository.js';
import { DiscoveredLocationRepository } from '../game-systems/map/DiscoveredLocationRepository.js';
import { CombatHistoryRepository } from '../game-systems/combat/CombatHistoryRepository.js';
import { CombatRepository } from '../game-systems/combat/CombatRepository.js';
import { DialogueRepository } from '../game-systems/dialogue/DialogueRepository.js';
import { CharacterSkillRepository } from '../game-systems/skill/CharacterSkillRepository.js';
import { SkillPoolRepository } from '../game-systems/skill/SkillPoolRepository.js';
import { QuestRepository } from '../game-systems/quest/QuestRepository.js';
import { NPCRepository } from '../game-systems/npc/NPCRepository.js';
import { NPCGoalRepository } from '../game-systems/npc/NPCGoalRepository.js';
import { InventoryRepository } from '../game-systems/inventory/InventoryRepository.js';
import { ItemPoolRepository } from '../game-systems/inventory/ItemPoolRepository.js';
import { EntityGraphRepository } from '../game-systems/entity-graph/EntityGraphRepository.js';
// 006 升级：awareness/relationship 独立表 Repository（组合根 value import，合法）
import { AwarenessRepository } from '../game-systems/entity-graph/AwarenessRepository.js';
import { RelationshipRepository } from '../game-systems/entity-graph/RelationshipRepository.js';
// 006 升级：AwarenessAutoSubscriber 订阅 dialogue/combat_end 事件自动追加 awareness
import { AwarenessAutoSubscriber } from '../game-systems/entity-graph/AwarenessAutoSubscriber.js';
// 006 升级：DialogueConsistencyChecker 对话-awareness 一致性审核（AuditAgent.llmCheckers 数组化装配）
import { DialogueConsistencyChecker } from '../game-systems/audit/DialogueConsistencyChecker.js';
// EG-M1-3: type imports for createGameServiceDeps 参数
import type { EntityGraphBuilder } from '../game-systems/entity-graph/EntityGraphBuilder.js';
import type { EntityGraphBuildContext } from '../game-systems/entity-graph/types.js';
import { CharacterRepository } from '../game-systems/character/CharacterRepository.js';
import { SaveRepository } from '../game-systems/save/SaveRepository.js';
import { SaveSnapshotRepository } from '../game-systems/save/SaveSnapshotRepository.js';
import { SaveGameTimeRepository } from '../game-systems/save/SaveGameTimeRepository.js';
import { SaveDataPort } from '../game-systems/save/SaveDataPort.js';
import { SaveService } from '../game-systems/save/SaveService.js';
import { EventRepository } from '../game-systems/event/EventRepository.js';
import { EventTriggerRepository } from '../game-systems/event/EventTriggerRepository.js';
import { GameTimeRepository } from '../game-systems/time/GameTimeRepository.js';
import { StoryEventRepository } from '../game-systems/story/StoryEventRepository.js';
import { PacingRepository } from '../game-systems/story/PacingRepository.js';
import { PacingHistoryRepository } from '../game-systems/story/PacingHistoryRepository.js';
import { AgentContextRepository } from '../game-systems/story/AgentContextRepository.js';
import { QuestObjectiveRepository } from '../game-systems/quest/QuestObjectiveRepository.js';
import type { StoryKernelRepos } from './story/StoryKernel.js';
import { SaveStateRepository } from '../game-systems/save/SaveStateRepository.js';
import { CharacterService } from '../game-systems/character/CharacterService.js';
import { NumericalService } from '../game-systems/numerical/NumericalService.js';
import { MapService } from '../game-systems/map/MapService.js';
import { LocationEntityResolver } from '../game-systems/map/LocationEntityResolver.js';
import { NPCService } from '../game-systems/npc/NPCService.js';
import { NpcEntityResolver } from '../game-systems/npc/NpcEntityResolver.js';
import { InventoryService } from '../game-systems/inventory/InventoryService.js';
import { SkillService } from '../game-systems/skill/SkillService.js';
import { SkillPoolEntityResolver } from '../game-systems/skill/SkillPoolEntityResolver.js';
import { TemplateRuleParser } from '../game-systems/shared/rule-parser/TemplateRuleParser.js';
import { AgentProfileRepository } from '../game-systems/config/AgentProfileRepository.js';
import { QuestService } from '../game-systems/quest/QuestService.js';
import { QuestEntityResolver } from '../game-systems/quest/QuestEntityResolver.js';
import { EventService } from '../game-systems/event/EventService.js';
import { requestEventBridge } from '../services/RequestEventBridge.js';
import type { BootstrapEventHandlers } from './agent-deps.js';
import { eventBus } from '@ai-rpg/shared/messaging';

const logger = createChildLogger('agent:init');

/**
 * ShadowState 快照表配置（v1.5 从 AgentRuntime.ts 迁移到组合根）。
 *
 * 原在 AgentRuntime.ts 模块级声明，现迁移到 init.ts 作为组合根级配置，
 * 由 createShadowStateLayer 工厂闭包捕获，AgentRuntime 不再直接持有此配置。
 *
 * 架构规范 §13.1（2026-07-21 增补）：所有在 ReAct 循环内被 ServiceTool 写入的 save-scoped 表
 * 必须注册到 SHADOW_STATE_TABLES。未注册的表在 StagingPool 上下文内被写入时，
 * shadowState.apply 会在 pendingUpdates 留下空 Map，使 read 误判为"权威空"返回 []
 * 而非 undefined，禁止 DB fallback，导致 re-fetch 返回 null，触发"not found"错误。
 *
 * 修复历史（2026-07-21 bug-hunt-20260721-shadow-state-character-skills-missing）：
 * - character_skills 缺失导致 use_skill 失败 3 次，gamemaster ReAct 循环终止
 * - 一次性补齐所有 ReAct 循环内被写入的 save-scoped 表（共 11 张）
 * - 删除过时的 items 配置（migration 067 已删除该表）
 */
export const SHADOW_STATE_TABLES: ShadowStateTableConfig[] = [
  // 核心实体表
  { table: 'npcs', scopeField: 'save_id' },
  { table: 'characters', scopeField: 'save_id' },
  { table: 'character_skills', scopeField: 'save_id' },  // 2026-07-21 新增：修复 use_skill 失败
  { table: 'quests', scopeField: 'save_id' },
  { table: 'quest_objectives', scopeField: 'save_id' },   // 2026-07-21 新增：update_quest_objective re-fetch
  { table: 'locations', scopeField: 'save_id' },
  { table: 'location_connections', scopeField: 'save_id' },
  { table: 'discovered_locations', scopeField: 'save_id' },  // 2026-07-21 新增：mark_location_discovered re-fetch

  // 物品与技能池
  { table: 'inventory', scopeField: 'save_id' },
  { table: 'item_pool', scopeField: 'save_id' },
  { table: 'skill_pool', scopeField: 'save_id' },

  // 战斗与对话
  { table: 'combat_states', scopeField: 'save_id' },       // 2026-07-21 新增：start_combat re-fetch
  { table: 'combat_history', scopeField: 'save_id' },      // 2026-07-21 新增：end_combat 写入
  { table: 'dialogues', scopeField: 'save_id' },           // 2026-07-21 新增：record_dialogue 写入
  { table: 'dialogue_summaries', scopeField: 'save_id' },  // 2026-07-21 新增：summarize_dialogues 写入

  // 事件与故事
  { table: 'event_triggers', scopeField: 'save_id' },      // 2026-07-21 新增：create_event_trigger re-fetch
  { table: 'events', scopeField: 'save_id' },              // 2026-07-21 新增：trigger_event 写入
  { table: 'story_events', scopeField: 'save_id' },        // 2026-07-21 新增：record_story_event 写入
  { table: 'npc_goals', scopeField: 'save_id' },           // 2026-07-21 新增：set_npc_goal re-fetch

  // 时间与存档状态
  { table: 'save_game_time', scopeField: 'save_id' },      // 2026-07-21 新增：advance_time re-fetch

  // 模板池（template-scoped）
  { table: 'template_skill_pool', scopeField: 'template_id' },
  { table: 'template_item_pool', scopeField: 'template_id' },

  // 实体图
  { table: 'entity_graph_nodes', scopeField: 'save_id' },
  { table: 'entity_graph_edges', scopeField: 'save_id' },
  // 模块3: information_boundaries 表已删除（PERCEIVES 边数据存于 entity_graph_edges.properties）

  // 006 升级：awareness/relationship 独立表（set_awareness/set_relationship ServiceTool 写入路径）
  // 未注册会导致 StagingPool 上下文内写入后 read 返回 [] 而非 undefined，禁止 DB fallback，触发 "not found" 错误
  { table: 'entity_awareness_events', scopeField: 'save_id' },
  { table: 'entity_awareness_states', scopeField: 'save_id' },
  { table: 'entity_relationship_events', scopeField: 'save_id' },
  { table: 'entity_relationship_states', scopeField: 'save_id' },

  // 008 升级：saves 表（select_challenge_mode/endChallenge 写入 active_challenge_mode，DF-007 持久化跨请求）
  // 注意：saves 表的 PK 是 id（即 saveId），不是 save_id；scopeField 用 'id'，scopeValues 需提供 id=saveId
  { table: 'saves', scopeField: 'id' },
];

export interface AgentSystemInitResult {
  coordinator: AgentRuntime;
  toolRegistry: ToolRegistry;
  llmService: LLMService;
  /**
   * M9 新增: LLM 请求调度器单例。
   *
   * 供 index.ts 组合根在 SIGTERM/SIGINT shutdown hook 中调用 destroy()
   * 清理 KeyHealthTracker 定时器 + 取消 provider_config_changed 事件订阅（m2 修复）。
   */
  llmRequestDispatcher: LLMRequestDispatcher;
  /**
   * M9 新增: Dispatcher 调度指标订阅器（E 层，写 llm_dispatch_metrics 表）。
   *
   * 供 index.ts shutdown hook 调用 destroy()（最后一次 flush + 取消 llm_metrics_event 订阅）。
   */
  llmDispatchMetricsSink: LLMDispatchMetricsSink;
  modelConfigService: ModelConfigService;
  contextService: IContextProvider;
  decisionLogService: DecisionLogService;
  configLoader: ConfigLoader;
  agentFactory: YamlAgentFactory;
  reactAgents: Map<string, AgentRuntime>;
  helpRegistry: HelpRegistry;
  /** P1-2 新增: WebSocket 服务实例（替代原模块级单例，供 backend/index.ts 使用） */
  webSocketService: WebSocketService;
  /** S2-1 新增: NPCServiceTool 实例（供 dev 路由按需创建 per-request NPCService） */
  npcServiceTool: NPCServiceTool;
  /** P0-2 新增: game-service 所需的端口依赖（locationRepo/skillService/rollbackRepos/txManager） */
  gameServiceDeps: GameServiceDeps;
  /**
   * FOLLOWUP-3 新增: bootstrap 级事件处理器容器。
   *
   * 持有 bootstrap QuestService/EventService 实例（原始 db，非 StagingKnex），
   * 供 index.ts 组合根注册 EventBus 转发器订阅 + AgentRuntime post-flush 处理 pending 事件。
   */
  bootstrapEventHandlers: BootstrapEventHandlers;
  /**
   * AP-L1 新增: dev:* 调试事件统一 Hook 端口实例。
   *
   * 供 index.ts 组合根的 EventBus.setDevHooks 使用（dev:event_bus_publish 事件），
   * 与 Agent 内部使用的 devTraceHook 共享同一实例。
   */
  devTraceHook: IDevTraceHook;
  /**
   * 统一面板变更推送机制新增：IPanelUpdateBroadcaster 端口实例。
   *
   * 供 ws-request-handler.handleWSInitialize 调用 pushPanelUpdate 推送初始 location 面板，
   * 替代原 'map:update' 事件。与 AgentRuntime/CoordinatorServiceTool 内部使用的实例共享同一单例。
   */
  panelUpdateBroadcaster: IPanelUpdateBroadcaster;
  /**
   * EG-OUT-2 新增: EntityGraphService 单例（共享 entityGraphCache）。
   *
   * 供 backend/index.ts 组合根传给 createDevRoutes，避免 dev 路由重复实例化
   * 与缓存不一致（dev.ts 兜底路径使用 NullEntityGraphCache 无缓存）。
   */
  entityGraphService: EntityGraphService;
}

/**
 * 创建 EntityGraphPort：将 EntityGraphService 包装为 StoryKernel 所需的端口接口。
 *
 * 从 ReActAgent.createEntityGraphPort 迁移到组合根（init.ts），
 * 因为 AgentRuntime 不再直接持有 game-systems/services 依赖。
 *
 * v1.9.2：接收 init.ts:260 创建的单一 EntityGraphService 实例，
 * 消除函数内部 3 处 new EntityGraphService(db) 重复实例化。
 *
 * 模块1 L2-1 / L2-3 / F1 / M4 修订：
 * - 接收 npcServiceFactory/mapServiceFactory 闭包（INPCService/IMapService 端口接口，M4 决策）
 * - per-saveId 单缓存：同一 saveId 内只创建一个同时注入 NPC+Map 的 EntityGraphService 实例
 *   （F1 修订：避免 separate cache 导致 getLocationSummary/getNpcProfile 缺端口抛错的 bug）
 * - getWorldStateSummary/getSubgraph/getEntityRelations：直接转发到 base service（无需跨领域端口）
 * - getNpcProfile/getLocationSummary：通过 getOrCreateFullService 获取同时注入 NPC+Map 的 per-saveId service
 *
 * 期望效果：StoryKernel 通过 Port 获取 NPC 画像/地点概览/实体关系，
 * 跨领域 Service 按需创建并缓存，避免 base entityGraphService 缺失跨领域端口的抛错。
 * MEDIUM-2 第三轮修订：当前无消费者（模块3 L2-1 简化后 StoryKernel 不查询），
 * 接口能力预留为未来扩展点（子 Agent 上下文注入/审计/风险评估等）。
 */
function createEntityGraphPort(
  baseService: EntityGraphService,
  entityGraphRepository: EntityGraphRepository,
  entityGraphCache: EntityGraphCache,
  // 006 升级：awareness/relationship 独立表 Repository 注入（per-saveId 实例复用）
  awarenessRepository: AwarenessRepository,
  relationshipRepository: RelationshipRepository,
  npcServiceFactory: (saveId: ID) => Promise<INPCService>,
  mapServiceFactory: (saveId: ID) => Promise<IMapService>,
): EntityGraphPort {
  // per-saveId 单缓存：同一 saveId 内只创建一个同时注入 NPC+Map 的 EntityGraphService 实例
  // F1 修订：避免 separate cache 导致 getLocationSummary/getNpcProfile 缺端口抛错
  const serviceCache = new Map<string, EntityGraphService>();

  const getOrCreateFullService = async (saveId: string): Promise<EntityGraphService> => {
    let service = serviceCache.get(saveId);
    if (!service) {
      const npcService = await npcServiceFactory(saveId as ID);
      const mapService = await mapServiceFactory(saveId as ID);
      // 同时注入两个跨领域端口，支持 getNpcProfile + getLocationSummary
      // 006 升级：awareness/relationship Repository 必填注入（感知数据从独立表读写）
      service = new EntityGraphService(
        entityGraphRepository, entityGraphCache,
        awarenessRepository, relationshipRepository,
        npcService, mapService,
      );
      serviceCache.set(saveId, service);
    }
    return service;
  };

  return {
    // 既有方法：直接转发到 base service（无需跨领域端口）
    async getWorldStateSummary(saveId) {
      return baseService.getWorldStateSummary(saveId);
    },
    async getSubgraph(saveId, centerNodeId, depth) {
      const subgraph = await baseService.getSubgraph(saveId, centerNodeId, depth);
      return {
        nodes: subgraph.nodes.map(n => ({
          id: n.id, entityType: n.entityType, entityId: n.entityId, label: n.label, properties: n.properties,
        })),
        edges: subgraph.edges.map(e => ({
          fromNodeId: e.fromNodeId, relation: e.relation, toNodeId: e.toNodeId,
        })),
      };
    },
    // 模块1 L2-1：结构化数据查询通道（未来扩展点）
    async getEntityRelations(saveId, entityType, entityId) {
      // getEntityRelations 不依赖 npcService/mapService，可直接使用 base service
      const result = await baseService.getEntityRelations(saveId, entityType as EntityType, entityId);
      if (!result) return null;
      return {
        structuralRelations: result.structuralRelations.map(r => ({
          targetId: r.targetId, targetType: r.targetType, relation: r.relation as string,
        })),
        // 006 升级：Service 返回 currentXxxScore，Port 接口字段名为 XxxScore（去 current 前缀）
        perceptions: result.perceptions.map(p => ({
          targetId: p.targetId, targetType: p.targetType,
          ...(p.currentRelationshipScore !== undefined ? { relationshipScore: p.currentRelationshipScore } : {}),
          ...(p.relationshipNote !== undefined ? { relationshipNote: p.relationshipNote } : {}),
          ...(p.currentAwarenessScore !== undefined ? { awarenessScore: p.currentAwarenessScore } : {}),
          ...(p.awarenessNote !== undefined ? { awarenessNote: p.awarenessNote } : {}),
        })),
      };
    },
    // 新方法：通过 getOrCreateFullService 获取同时注入 NPC+Map 的 per-saveId service
    async getNpcProfile(saveId, npcId) {
      const service = await getOrCreateFullService(saveId);
      const result = await service.getNpcProfile(saveId, npcId);
      if (!result) return null;
      return {
        npc: result.npc,
        structuralRelations: result.structuralRelations.map(r => ({
          targetId: r.targetId, targetType: r.targetType, relation: r.relation as string,
        })),
        // 006 升级：Service 返回 currentXxxScore，Port 接口字段名为 XxxScore（去 current 前缀）
        perceptions: result.perceptions.map(p => ({
          targetId: p.targetId, targetType: p.targetType,
          ...(p.currentRelationshipScore !== undefined ? { relationshipScore: p.currentRelationshipScore } : {}),
          ...(p.relationshipNote !== undefined ? { relationshipNote: p.relationshipNote } : {}),
          ...(p.currentAwarenessScore !== undefined ? { awarenessScore: p.currentAwarenessScore } : {}),
          ...(p.awarenessNote !== undefined ? { awarenessNote: p.awarenessNote } : {}),
        })),
      };
    },
    async getLocationSummary(saveId, locationId) {
      const service = await getOrCreateFullService(saveId);
      const result = await service.getLocationSummary(saveId, locationId);
      if (!result) return null;
      return result;  // LocationSummaryData 结构与 Service 返回一致，直接透传
    },
    // 006 升级新增（设计文档 §9）：紧张度引擎 assessInfoSpreadFactor 读取 awareness 扩散度
    // countAwarenessByTopic 不依赖 npcService/mapService，可直接使用 base service
    async countAwarenessByTopic(saveId, topicType, topicId) {
      return baseService.countAwarenessByTopic(
        saveId,
        topicType as EntityType,
        topicId,
      );
    },
  };
}

function registerAllTools(configLoader: ConfigLoader | undefined, llmService: LLMService | undefined, templateService: TemplateService | undefined, templatePoolService: TemplatePoolService | undefined, contextInjector: ContextInjector, contextService: IContextProvider): { toolRegistry: ToolRegistry; coordinatorServiceTool: CoordinatorServiceTool; ruleServiceTool: RuleServiceTool; skillLoaderTool: SkillLoaderTool; helpServiceTool: HelpServiceTool; mapServiceTool: MapServiceTool; npcServiceTool: NPCServiceTool; combatServiceTool: CombatServiceTool } {
  const toolRegistry = ToolRegistry.getInstance();

  logger.info('Registering ServiceTools to ToolRegistry');

  const generateOptionsTool = new GenerateOptionsTool();
  if (configLoader && llmService) {
    generateOptionsTool.setDependencies(configLoader, llmService);
  }
  if (templateService) {
    generateOptionsTool.setTemplateProvider(templateService);
  }

  const coordinatorServiceTool = new CoordinatorServiceTool(contextInjector);
  const ruleServiceTool = new RuleServiceTool();
  const skillLoaderTool = new SkillLoaderTool();
  const helpServiceTool = new HelpServiceTool();

  // S1-6 组合根适配：ServiceTool 按依赖拓扑顺序创建（D8）
  // character → map → npc → inventory（依赖 character + npc）→ skill → quest
  const characterServiceTool = new CharacterServiceTool();
  if (templateService) {
    characterServiceTool.setTemplateService(templateService);
  }

  // S2-1 D8 依赖拓扑: map 依赖 character，npc 依赖 map + character
  const mapServiceTool = new MapServiceTool(characterServiceTool);
  const npcServiceTool = new NPCServiceTool(mapServiceTool, characterServiceTool);
  if (templateService) {
    npcServiceTool.setTemplateService(templateService);
  }

  // inventory 依赖 character + npc（npc 用于 owner_id 名称→id 解析）
  const inventoryServiceTool = new InventoryServiceTool(
    characterServiceTool,
    templatePoolService ?? null,
    npcServiceTool,
  );

  // S2-2 D8 依赖拓扑: skill 依赖 character + npc + inventory
  const skillServiceTool = new SkillServiceTool(
    characterServiceTool,
    npcServiceTool,
    inventoryServiceTool,
  );
  if (templateService) {
    skillServiceTool.setTemplateService(templateService);
  }
  if (templatePoolService) {
    skillServiceTool.setTemplatePoolService(templatePoolService);
  }

  // S3-1 Phase B D8 依赖拓扑: quest 依赖 npc + character + inventory + skill
  const questServiceTool = new QuestServiceTool(
    npcServiceTool,
    characterServiceTool,
    inventoryServiceTool,
    skillServiceTool,
  );

  // S3-2 Phase C D8 依赖拓扑: combat 依赖 character + inventory + skill + numerical
  // NumericalServiceTool 无跨领域依赖，CombatServiceTool 持有 4 跨领域 ServiceTool 引用
  const numericalServiceTool = new NumericalServiceTool();
  const combatServiceTool = new CombatServiceTool(
    characterServiceTool,
    inventoryServiceTool,
    skillServiceTool,
    numericalServiceTool,
  );

  // S3-3 Phase C D8 依赖拓扑: dialogue 依赖 npc + quest + inventory + character（006 升级新增）
  // 006 升级：characterServiceTool 用于 emit dialogue 事件时查询 player ID（设计文档 §7.3）
  const dialogueServiceTool = new DialogueServiceTool(
    npcServiceTool,
    questServiceTool,
    inventoryServiceTool,
    characterServiceTool,
  );
  if (templateService) {
    dialogueServiceTool.setTemplateService(templateService);
  }

  const templatePoolServiceTool = new TemplatePoolServiceTool();
  if (templatePoolService) {
    templatePoolServiceTool.setTemplatePoolService(templatePoolService);
  }

  const storyServiceTool = new StoryServiceTool();
  storyServiceTool.setContextCompressor(contextService);

  // 模块4: EntityGraphServiceTool 构造函数注入 NPCServiceTool + MapServiceTool
  // 组合根 createEntityGraphService(context) 内部按请求创建 EntityGraphService，
  // 并通过 npcServiceTool/mapServiceTool 获取跨领域端口（INPCService/IMapService）
  const entityGraphServiceTool = new EntityGraphServiceTool(npcServiceTool, mapServiceTool);

  const batchQueryServiceTool = new BatchQueryServiceTool();
  batchQueryServiceTool.setToolRegistry(toolRegistry);

  // S4 D8 依赖拓扑: game-init 依赖 character（currency 修改有业务逻辑，S4-D4）
  const gameInitServiceTool = new GameInitServiceTool(characterServiceTool);
  if (templateService) {
    gameInitServiceTool.setTemplateService(templateService);
  }

  const serviceTools = [
    new GameTimeServiceTool(),
    numericalServiceTool,
    characterServiceTool,
    inventoryServiceTool,
    skillServiceTool,
    mapServiceTool,
    npcServiceTool,
    dialogueServiceTool,
    questServiceTool,
    combatServiceTool,
    new EventServiceTool(storyServiceTool),
    storyServiceTool,
    gameInitServiceTool,
    batchQueryServiceTool,
    entityGraphServiceTool,
    templatePoolServiceTool,
    new DynamicUIServiceTool(),
    generateOptionsTool,
    coordinatorServiceTool,
    ruleServiceTool,
    skillLoaderTool,
    helpServiceTool,
    new AgentMemoryServiceTool()
  ];

  for (const tool of serviceTools) {
    toolRegistry.register(tool);
  }

  logger.info(`Registered ${serviceTools.length} ServiceTools to ToolRegistry`);

  return { toolRegistry, coordinatorServiceTool, ruleServiceTool, skillLoaderTool, helpServiceTool, mapServiceTool, npcServiceTool, combatServiceTool };
}

export async function initializeAgentSystem(
  db: Knex,
  modelConfigService: ModelConfigService,
  oauthCredentialService?: OAuthCredentialService,
): Promise<AgentSystemInitResult> {
  logger.info('Starting YAML-driven Agent system initialization');

  try {
    // Create the DatabaseWriteQueue singleton early - all write operations
    // should be serialized through this to prevent SQLite lock contention.
    const writeQueue = new DatabaseWriteQueue(db, logger);

    // v1.4: ContextFlushQueue 在组合根创建，通过 AgentDeps 注入（消除 YamlAgentFactory 本地实例化）
    const flushQueue = new ContextFlushQueue(db, { writeQueue });

    logger.info('Seeding ModelConfigService from environment');
    await modelConfigService.seedFromEnv();

    // Bridge convict config (LLM_PROVIDER/LLM_API_KEY/LLM_MODEL etc.) to database
    try {
      const { config } = await import('../utils/config.js');
      const llmConfig = config.llm;
      if (llmConfig && typeof llmConfig === 'object') {
        await modelConfigService.seedFromConvictConfig({
          provider: llmConfig.provider || 'openai',
          apiKey: llmConfig.apiKey || '',
          baseUrl: llmConfig.baseUrl || '',
          model: llmConfig.model || 'gpt-4',
          temperature: llmConfig.temperature ?? 0.7,
        });
      }
    } catch (error) {
      logger.warn('Failed to bridge convict config to ModelConfigService', {
        error: getErrorMessage(error),
      });
    }

    logger.info('Creating LLMService with ModelConfigService');
    // M1: LLMService 无状态化——度量写入经 ILLMMetricsSink 端口（异步 buffer 批量落库，不阻塞主流程）
    const llmService = new LLMService(modelConfigService, new LLMMetricsSink(db));

    logger.info('Creating ContextService and DecisionLogService instances');

    const contextService = new ContextService(db);
    const entityGraphRepository = new EntityGraphRepository(db);
    // 006 升级：awareness/relationship 独立表 Repository（共享 db，组合根创建单例）
    const awarenessRepository = new AwarenessRepository(db);
    const relationshipRepository = new RelationshipRepository(db);
    // EG-M3-7: 主 EntityGraphService 实例使用共享 EntityGraphCache（生产场景缓存）
    // 该 cache 实例同时通过 AgentDeps.graphServiceCache 注入 AgentRuntime，
    // flush 后调用 cache.invalidate(saveId) 失效缓存
    const entityGraphCache = new EntityGraphCache();
    // bootstrap 级 entityGraphService：npcService/mapService 显式传 null。
    // 模块4: 此实例被 buildDataProviders 注入到 entityGraphProvider，供 EntityGraphAdapter 路由调用。
    // 默认 manifest 不配置"关系数据.NPC关系/地点关系"（LOW-1 第七轮修订），避免 getNpcProfile/getLocationSummary 抛错降级。
    // 若 GM 通过 batch_spawn_agents 显式传入这两个 tag，GameDataExpander 会捕获抛错降级为 warn（局部降级）。
    // GM 实际需要 NPC 关系数据时，应通过模块1 EntityGraphPort 路径（per-saveId 实例含 npcService）由工具调用消费。
    // 006 升级：awarenessRepository/relationshipRepository 必填注入（感知数据从独立表读写，不允许 null）
    const entityGraphService = new EntityGraphService(
      entityGraphRepository, entityGraphCache,
      awarenessRepository, relationshipRepository,
      null, null,
    );
    const decisionLogService = new DecisionLogService(db);

    logger.info('Initializing YAML-driven Agent profiles...');

    const configDir = process.env.AGENT_CONFIG_DIR || 'config';
    const profileRepo = new AgentProfileRepository(db);
    const configLoader = new ConfigLoader(configDir, profileRepo);

    await configLoader.loadAll();
    logger.info('YAML config loaded successfully');

    // 创建共享 ContextInjector 实例，统一管理上下文注入规则
    const contextInjector = new ContextInjector();
    configLoader.setContextInjector(contextInjector);

    // 从YAML配置动态构建Agent能力声明
    const yamlCapabilities = configLoader.getCapabilitiesFromProfiles();
    updateCapabilitiesFromConfig(yamlCapabilities);
    logger.info(`Loaded ${Object.keys(yamlCapabilities).length} agent capabilities from YAML profiles`);

    const templateService = new TemplateService(db, undefined, configLoader);
    const templatePoolService = new TemplatePoolService(db);
    templateService.setTemplatePoolService(templatePoolService);

    const { toolRegistry, coordinatorServiceTool, ruleServiceTool, skillLoaderTool, helpServiceTool, mapServiceTool, npcServiceTool, combatServiceTool } = registerAllTools(configLoader, llmService, templateService, templatePoolService, contextInjector, contextService);

    // 工具注册完成后，注入 ToolRegistry 引用并校验工具引用
    configLoader.setToolRegistry(toolRegistry);
    const toolValidation = configLoader.validateToolReferences();
    if (!toolValidation.valid) {
      logger.error(`Tool reference validation failed: ${toolValidation.errors.join(', ')}`);
      throw new Error(`Tool reference validation failed: ${toolValidation.errors.join(', ')}`);
    }
    for (const w of toolValidation.warnings) {
      logger.warn(w);
    }
    logger.info('Tool reference validation passed');

    // 初始化 HelpRegistry 并注入到 HelpServiceTool 和 SkillLoaderTool
    const helpRegistry = new HelpRegistry(resolve(configDir, 'agent-help'));
    await helpRegistry.loadAllHelp();
    helpServiceTool.setHelpRegistry(helpRegistry);
    skillLoaderTool.setHelpRegistry(helpRegistry);

    const promptsDir = resolve(process.cwd(), 'config', 'agent-profiles', 'prompts');
    const rulesEngine = new RulesEngine(resolve(configDir, 'agent-rules'));
    const skillRegistry = new SkillRegistry(resolve(configDir, 'agent-skills'));
    const promptModule = new PromptModule({ toolRegistry, helpRegistry, promptsDir, rulesEngine, skillRegistry });

    // 将 RulesEngine 注入到 RuleServiceTool
    ruleServiceTool.setRulesEngine(rulesEngine);
    skillLoaderTool.setSkillRegistry(skillRegistry);
    skillLoaderTool.setRulesEngine(rulesEngine);

    // 创建共享的基础依赖（coordinator 和 subagents 共用）
    const llmMetricsService = new LLMMetricsService(db);
    const toolCaller = new ToolCallerImpl(toolRegistry);

    // P1-2 新增: 创建会话管理器 + WebSocket 服务实例（替代原模块级单例）
    // 会话独立于 WS 连接存在，支持重连恢复；过期清理 60s 扫描一次
    const sessionManager = new ClientSessionManager();
    sessionManager.startIdleSweep(60_000);
    const webSocketService = new WebSocketService({ sessionManager });

    // AP-L1: dev:* 调试事件统一 Hook 端口实例（组合根单例）。
    // 业务代码（StagingPool/EntityGraphUpdater/BaseAgent/AgentRuntime）通过此端口
    // 调用 dev:* 事件广播，不再直接依赖 IWebSocketBroadcaster + DevTraceCollector 散点逻辑。
    const devTraceHook = new DevTraceHook(getDevTraceCollector(), webSocketService);

    // M9: 创建 LLMRequestDispatcher（Agent 核心层 G）+ LLMDispatchMetricsSink（服务层 E）
    // - Dispatcher：选 key + per-key 令牌桶限流 + 429/401 失败转移 + 调度指标事件。
    //   构造函数内订阅 provider_config_changed 事件；initialize() 全量同步 trackers（兜底）。
    // - LLMDispatchMetricsSink：订阅 llm_metrics_event，异步批量写 llm_dispatch_metrics 表。
    //   StagingPool 显式豁免（architecture-standards §13.1 第 4 条"非 Agent 路径显式豁免"）：
    //   非 ReAct 循环内工具写操作 + llm_dispatch_metrics 非 save-scoped 表，详见 sink 类注释。
    // - destroy() 由 index.ts SIGTERM/SIGINT shutdown hook 调用（经 AgentSystemInitResult 暴露）。
    const llmRequestDispatcher = new LLMRequestDispatcher(
      llmService,
      modelConfigService,
      eventBus,
      devTraceHook,
      // M2-B3 D2：acquireTimeoutMs 取默认值；OAuth 型 Provider 的运行时 key 解析注入
      undefined,
      oauthCredentialService,
    );
    await llmRequestDispatcher.initialize();
    const llmDispatchMetricsSink = new LLMDispatchMetricsSink(db, eventBus);
    llmDispatchMetricsSink.initialize();

    // 统一面板变更推送机制：组合根创建 PanelUpdateBroadcaster 实例（单例）。
    // AgentRuntime 在 ReAct flush 后调用 pushPanelUpdates 推送合并后的 panelUpdates；
    // CoordinatorServiceTool 在 batch_spawn_agents 完成后调用主动补推；
    // WSRequestHandler.handleWSInitialize 调用 pushPanelUpdate 推送初始 location 面板。
    // 复用 webSocketService 实例构造（接口最小化，仅依赖 IWebSocketBroadcaster）。
    const panelUpdateBroadcaster = new PanelUpdateBroadcaster(webSocketService);

    // v1.5: 请求级服务工厂 — 在组合根闭包捕获 db 和 SHADOW_STATE_TABLES，
    // 仅暴露请求级参数（requestId/saveId/templateId/enableSnapshot）。
    // AgentRuntime 通过 deps.createXxx() 调用获取请求级实例，零 value import services/。
    const createTraceCollector = (requestId: string) => new TraceCollector(requestId);
    const createResponsePool = () => new ResponsePool();
    const createStagingPool = () => {
      // EG-M2-9: StagingPool 创建时绑定原始 db（createProxyDb 需要）
      const pool = new StagingPool(devTraceHook);
      pool.bindOriginalDb(db);
      return pool;
    };
    const createShadowStateLayer = (
      saveId: ID,
      templateId: string | undefined,
      enableSnapshot: boolean,
    ) => new ShadowStateLayer(
      db,
      // saves 表的 PK 是 id（即 saveId），scopeField='id' 需在此映射 id → saveId
      { save_id: saveId, template_id: templateId, id: saveId },
      enableSnapshot ? SHADOW_STATE_TABLES : [],
    );
    const createRequestScope = () => new RequestScope(db);

    // D-S2-6 per-request 工厂：闭包捕获 db + ServiceTool，按 saveId 创建 per-request 实例。
    // NPCService/MapService 依赖 per-request CharacterService（ruleParser 依赖 saveId），
    // 无法全局单例，改为工厂注入。agentType/timestamp 为 ToolContext 必填字段但工厂内部不使用。
    //
    // 初始化豁免（13.1 规则）：NPCService/MapService/CombatService 在 init.ts 组合根创建，
    // 用于 AgentRuntime 状态查询（inCombat）和 GMCoordinator 依赖注入，不走 ReAct 循环工具调用路径。
    // 按 architecture-standards.md 13.1 第4条"非 Agent 路径显式豁免"标注。
    // 运行时工具调用路径的写操作经 StagingKnex 代理走 StagingPool（M2 enableStagingPool 默认 true 已启用）。
    const npcServiceFactory = (saveId: ID) => npcServiceTool.createNPCService({
      saveId, agentType: 'gamemaster', timestamp: Date.now(), requestScope: new RequestScope(db),
    });
    const mapServiceFactory = (saveId: ID) => mapServiceTool.createMapService({
      saveId, agentType: 'gamemaster', timestamp: Date.now(), requestScope: new RequestScope(db),
    });
    // P1.2: isInCombat 轻量闭包，替代原 combatServiceFactory。
    // 原 combatServiceFactory 每次创建完整 9 参数 CombatService（22 次 DB query + 11 次 YAML 解析），
    // 仅用于 AgentRuntime inCombat 检查。改为 hasActiveCombat 仅 1 次 SELECT combat_states。
    // 初始化豁免（13.1）：同上，不走 ReAct 循环工具调用路径。
    const isInCombat = (saveId: ID) => combatServiceTool.hasActiveCombat({
      saveId, agentType: 'gamemaster', timestamp: Date.now(), requestScope: new RequestScope(db),
    });

    // FOLLOWUP-3: bootstrap 级 QuestService/EventService 实例（原始 db，非 StagingKnex）
    // 仅用于 EventBus 订阅（handleGameEvent/handleBusEvent 路径）。
    // per-request 实例由 QuestServiceTool/EventServiceTool 内按请求创建（注入 StagingKnex 代理 db）。
    // bootstrap 实例的 handleGameEvent 只用 questRepo + objectiveRepo（4 个 undefined 跨领域 Service 不影响）。
    // bootstrap EventService 的 handleBusEvent 用 eventRepo + triggerRepo + storyEventWriter（storyService 已注入）。
    // 在 YamlAgentFactory 之前创建，因 YamlAgentFactory 需要 bootstrapEventHandlers 作为 CreateAgentDepsParams 字段。
    const bootstrapStoryEventRepo = new StoryEventRepository(db);
    const bootstrapAgentContextRepo = new AgentContextRepository(db);
    const bootstrapSaveRepo = new SaveRepository(db);
    const bootstrapTxManager = new KnexTransactionManager(db);
    const bootstrapStoryService = new StoryService(
      bootstrapStoryEventRepo,
      bootstrapAgentContextRepo,
      bootstrapSaveRepo,
      bootstrapTxManager,
    );
    const bootstrapQuestRepo = new QuestRepository(db);
    const bootstrapObjectiveRepo = new QuestObjectiveRepository(db);
    const bootstrapQuestService = new QuestService(
      bootstrapQuestRepo,
      bootstrapObjectiveRepo,
      new KnexTransactionManager(db),
      new TemplateRuleParser(),
      new QuestEntityResolver(bootstrapQuestRepo, db),
      undefined,
      undefined,
      undefined,
      undefined,
      eventBus,
    );
    const bootstrapEventService = new EventService(
      new EventRepository(db),
      new EventTriggerRepository(db),
      bootstrapStoryService,
      new SaveRepository(db),
      new KnexTransactionManager(db),
      undefined,
      eventBus,
    );
    const bootstrapEventHandlers: BootstrapEventHandlers = {
      questService: bootstrapQuestService,
      eventService: bootstrapEventService,
    };

    // Determine default profile early for GM creation
    // v5.2：YamlAgentFactory 推迟到 auditAgent/auditContextBuilder 创建之后（子 Agent AgentDeps 需要这两个字段）
    const profiles = configLoader.getAllProfiles();
    const defaultProfile = profiles.length > 0 ? profiles[0].name : 'fantasy_rpg';

    logger.info('Creating GameMasterAgent (as AgentRuntime with isSubAgent=false)');

    // Load GM config from YAML profile
    const gmProfile = configLoader.getProfile(defaultProfile);
    const gmConfig = gmProfile?.agents?.gamemaster;
    const gmSystemPrompt = configLoader.loadSystemPrompt(defaultProfile, 'gamemaster');

    // GM-specific 依赖：game-systems/ 实例 + StoryKernel（组合根构造）
    // 注：mapServiceFactory/npcServiceFactory/isInCombat 已提前创建（per-request 工厂闭包/轻量闭包，D-S2-6/D-S3-2-3/P1.2）
    // S4: GameTimeService/StoryService 已改为 Repository 注入模式，此处创建 GM 路径专用 Repository 实例
    const gmTxManager = new KnexTransactionManager(db);
    const gmGameTimeRepo = new GameTimeRepository(db);
    const gmStoryEventRepo = new StoryEventRepository(db);
    const gmAgentContextRepo = new AgentContextRepository(db);
    const gmSaveRepo = new SaveRepository(db);
    const gameTimeService = new GameTimeService(gmGameTimeRepo, gmTxManager);
    // 模块2 简化：删除 EntityGraphAuditor/EntityGraphRepairer 实例化（审计/修复闭环已删除）
    // EG-M2-9: EntityGraphSnapshotManager 实例化（使用 entityGraphService + writeQueue）
    const entityGraphSnapshotManager = new EntityGraphSnapshotManager(entityGraphService, writeQueue);
    const storyService = new StoryService(
      gmStoryEventRepo,
      gmAgentContextRepo,
      gmSaveRepo,
      gmTxManager,
      contextService,  // IContextCompressor（ContextService 实现该接口）
    );
    const storyDomain = new StoryDomain(storyService);
    const entityGraphPort = createEntityGraphPort(
      entityGraphService,
      entityGraphRepository,
      entityGraphCache,
      // 006 升级：awareness/relationship Repository 透传给 per-saveId EntityGraphService 实例
      awarenessRepository,
      relationshipRepository,
      npcServiceFactory,
      mapServiceFactory,
    );
    // S6: StoryKernel 通过 StoryKernelRepos 注入 6 个 Repository（零 db 传递）
    // dpCharacterRepo/dpQuestRepo 与下方 buildDataProviders 共享实例（DRY）
    const dpCharacterRepo = new CharacterRepository(db);
    const dpQuestRepo = new QuestRepository(db);
    const gmPacingRepo = new PacingRepository(db);
    const gmPacingHistoryRepo = new PacingHistoryRepository(db);
    const gmQuestObjectiveRepo = new QuestObjectiveRepository(db);
    const storyKernelRepos: StoryKernelRepos = {
      pacing: gmPacingRepo,
      pacingHistory: gmPacingHistoryRepo,
      storyEvent: gmStoryEventRepo,
      character: dpCharacterRepo,
      quest: dpQuestRepo,
      questObjective: gmQuestObjectiveRepo,
    };
    const storyKernel = new StoryKernel(storyDomain, entityGraphPort, storyKernelRepos, llmService);

    // 方案L：配置 GameDataExpander + DataProviders（manifest 路径 7跳降2跳）
    // 提前到 createGMAgentDeps 之前，因 AuditAgent 的 auditContextBuilder 需要捕获 dataProviders
    const gameDataExpander = new GameDataExpander();
    gameDataExpander.registerAdapter(new TemplateRecordAdapter());
    gameDataExpander.registerAdapter(new TemplatePoolAdapter());
    gameDataExpander.registerAdapter(new SavePoolAdapter());
    gameDataExpander.registerAdapter(new GameStateAdapter());
    // 模块4: 关系数据.* tag 适配器（路由到 entityGraphProvider 9 方法）
    gameDataExpander.registerAdapter(new EntityGraphAdapter());
    // P1-3: buildDataProviders 改为注入 11 个领域 Repository（消除 12 个方法直接 db 调用）
    // dpCharacterRepo/dpQuestRepo 已在上方 GM 区段创建（与 StoryKernelRepos 共享）
    const dpLocationRepo = new LocationRepository(db);
    const dpNpcRepo = new NPCRepository(db);
    const dpSkillPoolRepo = new SkillPoolRepository(db);
    const dpItemPoolRepo = new ItemPoolRepository(db);
    const dpDialogueRepo = new DialogueRepository(db);
    const dpEventTriggerRepo = new EventTriggerRepository(db);
    const dpCombatRepo = new CombatRepository(db);
    const dpGameTimeRepo = new GameTimeRepository(db);
    const dpSaveStateRepo = new SaveStateRepository(db);
    const dataProviders = buildDataProviders({
      getTemplateRecord: (templateId: ID) => templateService.getTemplateRecordSync(templateId),
      templatePoolService,
      characterRepo: dpCharacterRepo,
      locationRepo: dpLocationRepo,
      npcRepo: dpNpcRepo,
      questRepo: dpQuestRepo,
      skillPoolRepo: dpSkillPoolRepo,
      itemPoolRepo: dpItemPoolRepo,
      dialogueRepo: dpDialogueRepo,
      eventTriggerRepo: dpEventTriggerRepo,
      combatRepo: dpCombatRepo,
      gameTimeRepo: dpGameTimeRepo,
      saveStateRepo: dpSaveStateRepo,
      // 模块4: 复用 L492 创建的 bootstrap 级 entityGraphService 实例（npcService=null/mapService=null）
      // getNpcProfile/getLocationSummary 调用会抛错被 GameDataExpander 降级为 warn（局部降级）
      entityGraphService,
    });

    // 方案M：构造 AuditAgent（无状态审核Agent，程序审为主+LLM审按需触发）
    // 模块2 简化：GraphConsistencyChecker 已删除（依赖已删除的 EntityGraphAuditor），graph_consistency 维度移除
    const programCheckers = [
      new EntityCountsChecker(),
      new NpcLocationChecker(),
      new ItemOwnershipChecker(),
    ];
    // 006 升级：llmCheckers 数组化装配（设计文档 §8）
    //   - LLMCheckerImpl：通用内容质量审核（既有）
    //   - DialogueConsistencyChecker：对话-awareness 一致性审核（006 新增，老汤姆场景修复关键）
    // 每个 LLMChecker 独立隔离 try/catch（AuditAgent 内部），单个失败不影响其他
    const llmCheckers: LLMChecker[] = [
      new LLMCheckerImpl(llmService),
      new DialogueConsistencyChecker(entityGraphService, llmService),
    ];
    const rootCauseClassifier = new RootCauseClassifierImpl();
    const auditAgent = new AuditAgent(programCheckers, llmCheckers, rootCauseClassifier);

    // 006 升级：AwarenessAutoSubscriber 订阅 dialogue/combat_end 事件（设计文档 §7.3）
    //   - dialogue 事件 → 自动 setAwareness(npc, player, +1, source='auto:dialogue')
    //   - combat_end 事件 → 自动 setAwareness(npc, player, +3, source='auto:combat')
    //   - 错误不传播异常（避免污染发布方），仅记日志
    const awarenessAutoSubscriber = new AwarenessAutoSubscriber(eventBus, entityGraphService);
    awarenessAutoSubscriber.subscribe();

    // auditContextBuilder 闭包：捕获 dataProviders/db，per-request 的 stagingPool/shadowState 由调用方传入
    // 模块2 简化：删除 graphAuditorProvider + auditGraphProviderFactory（EntityGraphAuditor + GraphConsistencyChecker 已删除）
    const auditContextBuilder = (
      saveId: ID,
      templateId: ID,
      perRequest: { stagingPool: IStagingPool; shadowState: IShadowStateLayer },
    ): AuditContext => ({
      saveId,
      templateId,
      db,
      dataProviders,
      auditProviders: {
        stagingPoolProvider: perRequest.stagingPool,
        shadowStateProvider: perRequest.shadowState,
        // 基于 ShadowState 的 savePool 数据源：审核 Checker 通过此读取本轮未提交数据
        shadowSavePoolProvider: buildShadowSavePoolProvider(
          perRequest.stagingPool.createProxyDb(),
        ),
      },
    });

    // M4 §9.2：4 维度 Hook 系统组合根装配（装配顺序即依赖方向）。
    // - hookImplRegistry：6 个内建实现的代码侧注册表（YAML hookRef 的解析目标）
    // - loadHookPlacement：YAML 加载 + V1-V8 启动期校验（fail-fast；文件缺失 → 空 entries，仅默认链生效）
    // - hookPlacementResolver：GM 与子 Agent 共享同一单例（解析器无 per-request 状态，
    //   per-request 的 4 维度上下文在 dispatch 调用点传入，经 AgentDeps.placementResolver 注入）
    // implDeps.auditedKeys 缺省说明：auditedKeys 是 per-AgentRuntime 请求级状态
    // （AgentRuntimeState.auditedKeys），组合根不可得；generic-audit entry 因此处于休眠态
    // （§14.4：on_task_complete 派发不携带 placement，解析器永不为其物化工厂）。
    // 若未来激活，工厂 fail-fast 抛错由 resolver per-entry 降级捕获（§13），不拖垮整条链。
    const hookImplRegistry = buildHookImplRegistry();
    const hookPlacementConfig = configLoader.loadHookPlacement(hookImplRegistry);
    const hookPlacementResolver = buildHookPlacementResolver({
      entries: hookPlacementConfig.entries,
      implRegistry: hookImplRegistry,
      implDeps: { webSocketService, auditAgent, auditContextBuilder },
    });

    // FOLLOWUP-3: bootstrapEventHandlers 已在上方 YamlAgentFactory 前创建（供两者共享）
    // M5: IModelTierResolver 组合根适配器（M5 设计 §8.1）。
    // G 层不直接依赖 H 层 ModelConfigService，经此最小端口闭包捕获；
    // fast tier 未配置（fastProviderId 为空）时返回 null → iteration-tier 策略 no-op。
    const modelTierResolver: IModelTierResolver = {
      async resolve(tier) {
        const defaults = await modelConfigService.getDefaults();
        if (tier === 'fast') {
          if (!defaults.fastProviderId) return null;
          return { providerId: defaults.fastProviderId, model: defaults.fastModel ?? undefined };
        }
        return {
          providerId: defaults.defaultProviderId ?? undefined,
          model: defaults.defaultModel ?? undefined,
        };
      },
    };

    const gmDeps = createGMAgentDeps({
      db,
      llmService,
      // M9: LLMRequestDispatcher 单例（上方已 initialize）
      llmRequestDispatcher,
      llmMetricsService,
      promptModule,
      writeQueue,
      helpRegistry,
      contextInjector,
      contextService,
      entityGraphService,
      // EG-M3-7: 共享缓存实例（AgentRuntime flush 后失效缓存使用）
      graphServiceCache: entityGraphCache,
      npcServiceFactory,
      decisionLogService,
      templateService,
      templatePoolService,
      toolCaller,
      storyKernel,
      mapServiceFactory,
      isInCombat,
      gameTimeService,
      // 模块2 简化：删除 graphAuditor/entityGraphRepairer（Auditor/Repairer 已删除）
      // v5.2：auditAgent + auditContextBuilder 已上移到 CreateAgentDepsParams（所有 Agent 都可获取）
      auditAgent,
      auditContextBuilder,
      maxContextTokens: gmConfig?.max_context_tokens,
      flushQueue,
      webSocketService,
      panelUpdateBroadcaster,
      devTraceHook,
      createTraceCollector,
      createResponsePool,
      createStagingPool,
      createShadowStateLayer,
      createRequestScope,
      // M5: per-request prepareNextTurn hook 工厂（闭包捕获 modelTierResolver）
      createPrepareNextTurnHook: (agentConfig) => createPrepareNextTurnHook(agentConfig, modelTierResolver),
      requestEventBridge,
      bootstrapEventHandlers,
      // M4 §9.2：4 维度 placement 解析器单例（组合根装配，见上方）
      placementResolver: hookPlacementResolver,
    });

    // v5.2：YamlAgentFactory 在 auditAgent/auditContextBuilder 创建后创建（子 Agent AgentDeps 需要这两个字段）
    const agentFactory = new YamlAgentFactory({
      configLoader,
      llmService,
      // M9: LLMRequestDispatcher 单例（与 GM 共享，子 Agent 经 createAgentDeps 注入）
      llmRequestDispatcher,
      llmMetricsService,
      db,
      promptModule,
      writeQueue,
      helpRegistry,
      contextInjector,
      contextService,
      entityGraphService,
      graphServiceCache: entityGraphCache,
      npcServiceFactory,
      decisionLogService,
      templateService,
      templatePoolService,
      toolCaller,
      flushQueue,
      webSocketService,
      panelUpdateBroadcaster,
      devTraceHook,
      createTraceCollector,
      createResponsePool,
      createStagingPool,
      createShadowStateLayer,
      createRequestScope,
      // M5: per-request prepareNextTurn hook 工厂（闭包捕获 modelTierResolver，与 GM 共享同一适配器）
      createPrepareNextTurnHook: (agentConfig) => createPrepareNextTurnHook(agentConfig, modelTierResolver),
      requestEventBridge,
      bootstrapEventHandlers,
      // v5.2：子 Agent 也需要 auditAgent + auditContextBuilder（on_task_complete hook 注册）
      auditAgent,
      auditContextBuilder,
      // M4 §9.2：4 维度 placement 解析器单例（与 GM 共享，子 Agent 经 createAgentDeps 注入）
      placementResolver: hookPlacementResolver,
    });

    const coordinator = new AgentRuntime(
      gmDeps,
      gmConfig ?? {
        name: 'GameMasterAgent',
        description: 'Game Master Agent',
        system_prompt_file: 'gamemaster.md',
        tools: [],
        isSubAgent: false,
        enableSpawnAgent: true,
      },
      'gamemaster',
      gmSystemPrompt,
    );

    // EG-M4-4: 订阅 chapter_advanced 事件（取代模块2 订阅，统一编排 reconcile → snapshot）
    // 模块4 超集：先纠错确保图状态正确，再创建快照。禁止两个订阅同时存在（会导致快照创建两次）
    // 前置依赖：StoryService 章节推进时需发射 chapter_advanced 事件（含 saveId + chapterNumber）
    // 当前 StoryService 尚未发射此事件，订阅器处于待激活状态
    // 模块2 简化版：Reconciler 直写 DB（graphProvider.upsert），无需 StagingPool
    eventBus.subscribe('chapter_advanced', async (event) => {
      const chapterNumber = typeof event.data.chapterNumber === 'number'
        ? event.data.chapterNumber
        : typeof event.data.chapter_number === 'number'
          ? event.data.chapter_number
          : 0;
      if (chapterNumber > 0) {
        // 1. 先纠错（确保快照前图状态正确）
        await gmDeps.entityGraphReconciler.reconcile(event.saveId);
        // 2. 再创建快照
        await entityGraphSnapshotManager.autoCreateChapterSnapshot(event.saveId, chapterNumber);
      }
    });

    // 注入记忆服务到 PromptModule 和 AgentMemoryServiceTool
    const { episodic, procedural } = coordinator.memoryServices;
    if (episodic && procedural) {
      promptModule.setMemoryServices(episodic, procedural);
      const memoryTool = toolRegistry.getTool('memory_service' as any);
      if (memoryTool && 'setServices' in memoryTool) {
        (memoryTool as any).setServices(episodic, procedural);
      }
    }

    // v5.2：agentFactory 已在上方 auditContextBuilder 创建后创建

    // 注入活跃请求检查器，使reload时能感知GameMasterAgent的处理状态
    agentFactory.setActiveRequestChecker(coordinator);

    logger.info(`Creating AgentRuntime instances from default profile: ${defaultProfile}`);
    const reactAgents = await agentFactory.createAgentsFromProfile(defaultProfile);

    await agentFactory.setupPermissionsFromConfig(defaultProfile);
    logger.info('YAML permissions configured');

    logger.info('Registering AgentRuntime instances to GameMasterAgent...');
    for (const [agentKey, reactAgent] of reactAgents) {
      coordinator.registerAgent(reactAgent);
      logger.info(`Registered AgentRuntime to Coordinator: ${agentKey}`);
    }

    coordinatorServiceTool.setAgentRegistry(coordinator.getAgentInstances());

    // 方案L：GameDataExpander + DataProviders 已在 createGMAgentDeps 前创建（供 AuditAgent 使用）
    coordinatorServiceTool.setGameDataExpander(gameDataExpander, createExpandContextBuilder(dataProviders));
    logger.info('GameDataExpander configured (manifest path enabled)');

    // 方案I：配置 DispatchLogRepository + DedupService（去重持久化+重试预算）
    const dispatchLogRepo = new DispatchLogRepository(db);
    const dedupService = new DedupService(dispatchLogRepo);
    coordinatorServiceTool.setDedupService(dedupService);
    logger.info('DedupService configured (dispatch log persistence enabled)');

    // 统一面板变更推送机制：注入 PanelUpdateBroadcaster 实例（供 batch_spawn_agents handler 主动补推）
    coordinatorServiceTool.setPanelUpdateBroadcaster(panelUpdateBroadcaster);

    // EC7：子 Agent 审核统一由 on_task_complete hook 处理（在子 Agent ReAct loop 内挂起-恢复）
    // coordinator 不再独立审核子 Agent 结果，AuditAgent 通过 gmDeps 注入 AgentRuntime

    logger.info(`Agent system initialized: ${reactAgents.size} AgentRuntime instances created`);

    // P0-2: 创建 game-service 所需的端口依赖（全局共享实例，非 per-request）
    // EG-M1-3: 注入 EntityGraphBuilder + EntityGraphBuildContext（gmDeps 已在上方 line 691 创建）
    // 阶段四调整: 注入 combatServiceTool（供 ChallengeProgram 构造注入 ICombatServiceTool 端口接口）
    const gameServiceDeps = createGameServiceDeps(
      db,
      templateService,
      templatePoolService,
      gmDeps.entityGraphBuilder,
      gmDeps.entityGraphBuildContext,
      combatServiceTool,
    );

    return {
      coordinator,
      toolRegistry,
      llmService,
      // M9: 供 index.ts shutdown hook 调用 destroy()
      llmRequestDispatcher,
      llmDispatchMetricsSink,
      modelConfigService,
      contextService,
      decisionLogService,
      configLoader,
      agentFactory,
      reactAgents,
      helpRegistry,
      webSocketService,
      npcServiceTool,
      gameServiceDeps,
      bootstrapEventHandlers,
      devTraceHook,
      panelUpdateBroadcaster,
      entityGraphService,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('Failed to initialize Agent system', { error: errorMessage });
    throw error;
  }
}

/**
 * P0-2: 创建 game-service 所需的端口依赖（全局共享实例）。
 *
 * game-service 不在 Agent 请求上下文中（HTTP/WS 请求入口 → validateSkillUsage → Agent），
 * 无法通过 ServiceTool 获取 per-request 实例，因此在组合根创建全局共享实例。
 *
 * 创建内容：
 * 1. RollbackRepos 容器（13 个 Repository，覆盖 rollbackSave 14 张表）
 * 2. LocationRepository（processInitialize 3 处 db 调用）
 * 3. KnexTransactionManager（rollbackSave 单事务执行）
 * 4. SkillService（validateSkillUsage 迁移到 SkillService.validateUsage）
 *
 * SkillService 构造函数需要完整的跨领域依赖链（character/npc/inventory），
 * 虽然只有 validateUsage 会被 game-service 调用，但构造函数要求全部注入。
 */
export function createGameServiceDeps(
  db: Knex,
  templateService: TemplateService,
  templatePoolService: TemplatePoolService,
  /** EG-M1-3: EntityGraphBuilder（来自 gmDeps，避免重复创建） */
  entityGraphBuilder: EntityGraphBuilder,
  /** EG-M1-3: EntityGraphBuildContext 11 个 ReadPort 聚合（来自 gmDeps） */
  entityGraphBuildContext: EntityGraphBuildContext,
  /** 阶段四调整: CombatServiceTool 实例（供 ChallengeProgram 构造注入 ICombatServiceTool 端口接口） */
  combatServiceTool: CombatServiceTool,
): GameServiceDeps {
  const txManager = new KnexTransactionManager(db);

  // === Repository 实例（rollbackSave 13 个 + locationRepo 独立 + Service 依赖） ===
  const locationRepo = new LocationRepository(db);
  const locationConnectionRepo = new LocationConnectionRepository(db);
  const discoveredRepo = new DiscoveredLocationRepository(db);
  const combatHistoryRepo = new CombatHistoryRepository(db);
  const combatStateRepo = new CombatRepository(db);
  const dialogueRepo = new DialogueRepository(db);
  const characterSkillRepo = new CharacterSkillRepository(db);
  const skillPoolRepo = new SkillPoolRepository(db);
  const questRepo = new QuestRepository(db);
  const npcRepo = new NPCRepository(db);
  const npcGoalRepo = new NPCGoalRepository(db);
  const inventoryRepo = new InventoryRepository(db);
  const itemPoolRepo = new ItemPoolRepository(db);
  const entityGraphRepo = new EntityGraphRepository(db);
  const characterRepo = new CharacterRepository(db);
  const saveRepo = new SaveRepository(db);
  const eventRepo = new EventRepository(db);

  const rollbackRepos: RollbackRepos = {
    combatHistoryRepo,
    combatStateRepo,
    dialogueRepo,
    characterSkillRepo,
    questRepo,
    // 模块2 简化：删除 npcRelationRepo（npc_relations 表已删除）
    npcRepo,
    inventoryRepo,
    locationConnectionRepo,
    locationRepo,
    entityGraphRepo,
    characterRepo,
    saveRepo,
  };

  // === Service 实例（构造完整依赖链：numerical → character → map → npc → inventory → skill，D8 拓扑序） ===
  const ruleParser = new TemplateRuleParser();
  // P0-2: NumericalService 构造函数已改为 Repository 注入（characterRepo/inventoryRepo/npcRepo/txManager/ruleParser）
  const numericalService = new NumericalService(
    characterRepo,
    inventoryRepo,
    npcRepo,
    txManager,
    ruleParser,
  );
  const characterService = new CharacterService(
    characterRepo,
    saveRepo,
    numericalService,
    txManager,
    templateService,
  );
  const locationResolver = new LocationEntityResolver(locationRepo, db);
  const mapService = new MapService(
    locationRepo,
    locationConnectionRepo,
    discoveredRepo,
    characterService,
    eventRepo,
    txManager,
    locationResolver,
  );
  // 模块2 简化：删除 npcRelationRepo 构造参数（关系数据由 EntityGraphService 维护）
  const npcResolver = new NpcEntityResolver(npcRepo, db);
  const npcService = new NPCService(
    npcRepo,
    npcGoalRepo,
    mapService,
    characterService,
    saveRepo,
    templateService,
    numericalService,
    txManager,
    npcResolver,
  );
  const inventoryService = new InventoryService(
    inventoryRepo,
    itemPoolRepo,
    characterService,
    numericalService,
    saveRepo,
    txManager,
    ruleParser,
    templatePoolService,
    npcService,
  );
  const skillPoolResolver = new SkillPoolEntityResolver(skillPoolRepo, db);
  const skillService = new SkillService(
    skillPoolRepo,
    characterSkillRepo,
    characterService,
    npcService,
    inventoryService,
    saveRepo,
    txManager,
    ruleParser,
    templateService,
    templatePoolService,
    skillPoolResolver,
  );

  // S5: SaveService 端口实例（game-service 消费 ISaveProvider）
  const saveSnapshotRepo = new SaveSnapshotRepository(db);
  const saveStateRepo = new SaveStateRepository(db);
  const saveGameTimeRepo = new SaveGameTimeRepository(db);
  const saveDataPort = new SaveDataPort(db);
  const saveService = new SaveService(
    saveRepo,
    saveSnapshotRepo,
    saveStateRepo,
    saveGameTimeRepo,
    saveDataPort,
    txManager,
  );

  // 阶段四调整: ChallengeProgram（G2 程序执行层）+ ModeRouter（路由层 B 前置依赖）
  // ChallengeProgram 是全局单例，构造函数注入 combatServiceTool（ICombatServiceTool 端口接口）
  // ModeRouter 是全局单例，构造函数注入 saveRepo（ISaveRepository 端口接口）
  // 设计变更：原 ChallengeOrchestrator 拆分为 ChallengeProgram（纯程序执行）+ 服务层 E 路由编排
  const challengeProgram = new ChallengeProgram(combatServiceTool);
  const modeRouter = new ModeRouter(saveRepo);

  return {
    characterService,
    locationRepo,
    skillService,
    saveService,
    rollbackRepos,
    txManager,
    // EG-M1-3: EntityGraphBuilder + EntityGraphBuildContext（从 gmDeps 透传，避免重复创建）
    entityGraphBuilder,
    entityGraphBuildContext,
    // 阶段四调整: G2 程序执行层 + ModeRouter（全局单例，供 handleChat 路由分流）
    challengeProgram,
    modeRouter,
  };
}
