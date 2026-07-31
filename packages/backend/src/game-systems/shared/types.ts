/**
 * 业务层服务接口定义（v1.8 新增，P3-S5；v1.9 扩展，P3-S6；模块3 简化）
 *
 * 业务层通过 ITemplateProvider/ITemplatePoolProvider 接口访问 TemplateService/TemplatePoolService，
 * 通过 IEntityGraphProvider 接口访问 EntityGraphService，
 * 通过 IContextCompressor 接口访问 ContextService 的压缩能力，
 * 消除 game-systems → services 的运行时 value import 依赖。
 *
 * agents 层通过 IContextProvider 完整接口访问 ContextService（P3-S6 新增）。
 *
 * 接口方法集为业务层/agents 层最小集（仅含实际使用的方法）。
 * 路由层和组合根保留对具体类的 value import。
 *
 * 类型引用说明：
 * - TemplateRecord / CreateTemplateSkillParams / CreateTemplateItemParams 当前定义在 services/ 中，
 *   通过 type-only import 引用（编译时擦除，无运行时依赖）。
 *   后续可将这些类型迁移到 shared/，彻底消除 type 依赖。
 * - EntityType / RelationType / EntityNode / EntityEdge / EntitySubgraph /
 *   GraphSnapshot 定义在 game-systems/entity-graph/types.js，
 *   通过 type-only import 引用（编译时擦除，无运行时依赖）。
 *   模块3 简化：删除 Fact / InformationBoundary 类型引用（information_boundaries 表已废弃）。
 * - ID / AgentType / AgentContext / LLMMessage 定义在 shared 层，无跨层问题。
 */

import type { ID } from '../../../../shared/src/types/core.js';
import type { ChallengeMode } from '../../../../shared/src/types/challenge.js';
import type {
  TemplateSkillPoolEntry,
  TemplateItemPoolEntry,
} from '../../../../shared/src/types/game.js';
import type { InventoryRuleSet } from '../../../../shared/src/types/template.js';
import type { TemplateRecord } from '../../services/template.js';
import type {
  CreateTemplateSkillParams,
  CreateTemplateItemParams,
} from '../../services/template-pool.js';
import type {
  EntityType,
  RelationType,
  EntityNode,
  EntityEdge,
  EntitySubgraph,
  GraphSnapshot,
  AwarenessSource,
  RelationshipSource,
  EntityAwarenessEvent,
  EntityAwarenessState,
  EntityRelationshipEvent,
  EntityRelationshipState,
} from '../entity-graph/types.js';
import type { AgentType, AgentContext, LLMMessage } from '../../../../shared/src/types/agent.js';

/**
 * 模板数据访问端口（业务层 + agents 层最小集）。
 *
 * 业务层（DialogueService / SkillService / GenerateOptionsTool 等）和 agents 层（AgentRuntime）
 * 通过此接口访问模板数据，不再直接 value import services/template.js。
 */
export interface ITemplateProvider {
  /** 获取所有模板（DialogueService 用于 item_grant 查找，SkillService 用于 skill damage 查找）。 */
  getTemplates(): Promise<TemplateRecord[]>;
  /** 按 ID 获取单个模板（GenerateOptionsTool + AgentRuntime 用于读取 characterCreation/worldSetting/startingScene）。 */
  getTemplate(templateId: ID): Promise<TemplateRecord>;
  /** 获取模板系统上下文（AgentRuntime 用于 fullContext 模式下的 templateContext 构建）。 */
  getSystemContext(templateId: string): Promise<string>;
  /** 获取模板世界上下文（AgentRuntime 用于非 fullContext 模式下的 templateContext 构建）。 */
  getWorldContext(templateId: string): Promise<string>;
  /**
   * 获取模板的库存规则（equipment_slots 配置）。
   * Prompt 层 EquipmentSlotLayer 通过此方法获取装备槽配置，
   * 不再直接使用 TemplateRuleParser.fromSaveId(db, saveId) 访问数据库。
   */
  getInventoryRules(templateId: ID): Promise<InventoryRuleSet>;
  /**
   * 获取模板配置的默认挑战模式（default_challenge_mode）。
   * CombatServiceTool.resolveChallengeMode 用于三层覆盖解析的模板默认层。
   * 未配置或值非法时返回 null（由调用方回退到兜底模式，不在此做默认填充）。
   */
  getDefaultChallengeMode(templateId: ID): Promise<ChallengeMode | null>;
}

/**
 * 模板池数据访问端口（业务层最小集）。
 *
 * 业务层（InventoryService / SkillService / TemplatePoolServiceTool 等）通过此接口访问模板池数据，
 * 不再直接 value import services/template-pool.js。
 */
export interface ITemplatePoolProvider {
  /** 按名称查找物品池条目（InventoryService addPoolItem/equipItem/addItemFromPool 三级查找）。 */
  findItemByName(templateId: ID, name: string): Promise<TemplateItemPoolEntry | null>;
  /** 按名称 upsert 物品池条目（InventoryService 回写模板池，程序内部固定调用）。存在则用新数据覆盖，不存在则创建。 */
  upsertItem(templateId: ID, params: CreateTemplateItemParams): Promise<TemplateItemPoolEntry>;
  /** 按名称查找技能池条目（SkillService addPoolSkill/learnSkill 三级查找）。 */
  findSkillByName(templateId: ID, name: string): Promise<TemplateSkillPoolEntry | null>;
  /** 按名称 upsert 技能池条目（SkillService 回写模板池，程序内部固定调用）。存在则用新数据覆盖，不存在则创建。 */
  upsertSkill(templateId: ID, params: CreateTemplateSkillParams): Promise<TemplateSkillPoolEntry>;
  /** 列出技能池条目（TemplatePoolServiceTool list_template_skills）。 */
  listSkills(
    templateId: ID,
    options?: { category?: string; recommendedClass?: string },
  ): Promise<TemplateSkillPoolEntry[]>;
  /** 列出物品池条目（TemplatePoolServiceTool list_template_items）。 */
  listItems(
    templateId: ID,
    options?: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string },
  ): Promise<TemplateItemPoolEntry[]>;
  /** 按 ID 获取技能池条目（TemplatePoolServiceTool get_template_skill）。 */
  getSkill(templateId: ID, skillId: string): Promise<TemplateSkillPoolEntry | null>;
  /** 按 ID 获取物品池条目（TemplatePoolServiceTool get_template_item）。 */
  getItem(templateId: ID, itemId: string): Promise<TemplateItemPoolEntry | null>;
  /** 获取模板池统计（TemplatePoolServiceTool get_template_pool_stats）。 */
  getPoolStats(templateId: ID): Promise<{
    skillCount: number;
    itemCount: number;
    skillCategories: Record<string, number>;
    itemCategories: Record<string, number>;
  }>;
}

/**
 * 实体图数据访问端口（业务层最小集，P3-S6 新增；模块3 简化）。
 *
 * EntityGraphServiceTool 通过此接口访问 EntityGraphService，
 * 不再直接 value import game-systems/entity-graph/EntityGraphService.js。
 *
 * 方法集为 EntityGraphServiceTool 实际使用的方法
 * （不含 getAllSnapshots/getWorldStateSummary 等未使用方法，由 agents 层 EntityGraphPort 单独消费）。
 *
 * 模块3 简化：删除 upsertInformationBoundary/getInformationBoundary（information_boundaries 表已废弃），
 * 新增 6 个 PERCEIVES 感知边管理方法（setAwareness/getAwareness/setRelationship/getRelationship/
 * getAwarenessBatch/getEntityAwareness），统一关系值+认识值到单条 PERCEIVES 边的两个独立字段。
 *
 * 006 升级：awareness/relationship 从 PERCEIVES 边 properties 迁移到独立表（events + states 双表）。
 *   - setAwareness/setRelationship 改为 delta 语义（scoreDelta 是本次变更量）
 *   - events 表追加变更事件（全量历史 + 写入时压缩 R1-R4）
 *   - states 表派生当前状态（current_score = clamp(累加 delta, -10, +10)）
 *   - source 字段结构化（AwarenessSource / RelationshipSource）
 *   - 新增 getAwarenessHistory / getRelationshipHistory 方法（审核反查）
 *   - 自动化与 GM 共存：delta 累加天然叠加，无需 GM 覆盖锁
 *
 * §13.3 归属保守处理：set 操作 observer/target 节点缺失抛错，get 操作返回 null。
 */
export interface IEntityGraphProvider {
  upsertNode(saveId: string, type: EntityType, entityId: string, label: string, properties?: Record<string, unknown>): Promise<string>;
  getNode(saveId: string, type: EntityType, entityId: string): Promise<EntityNode | null>;
  getNodesByType(saveId: string, type: EntityType): Promise<EntityNode[]>;
  getNodesByLocation(saveId: string, locationId: string, options?: { includeDescendants?: boolean; nodeTypeFilter?: string[] }): Promise<EntityNode[]>;
  getFullGraph(saveId: string): Promise<EntitySubgraph>;
  getSubgraph(saveId: string, centerNodeId: string, depth: number): Promise<EntitySubgraph>;
  upsertEdge(saveId: string, fromNodeId: string, relation: RelationType, toNodeId: string, weight?: number, properties?: Record<string, unknown>): Promise<string>;
  getEdges(saveId: string, nodeId: string): Promise<EntityEdge[]>;
  getEdgesByRelation(saveId: string, relation: RelationType): Promise<EntityEdge[]>;
  createSnapshot(saveId: string, type: 'baseline' | 'chapter', chapterNumber?: number): Promise<string>;
  getSnapshot(saveId: string, snapshotId: string): Promise<GraphSnapshot | null>;
  getLatestSnapshot(saveId: string): Promise<GraphSnapshot | null>;
  // === 006 升级：awareness/relationship 双表方案（events + states） ===
  /**
   * 设置 A 对 B 的认识值（delta 语义：scoreDelta 是本次变更量）。
   * 期望效果：追加 awareness event + UPSERT awareness state（current_score = clamp(current + delta, -10, +10)）。
   * 自动化事件（auto:dialogue / auto:combat）与 GM 事件自然叠加，无需覆盖锁。
   */
  setAwareness(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
    scoreDelta: number,
    source: AwarenessSource,
    awarenessNote?: string,
  ): Promise<{ event: EntityAwarenessEvent; state: EntityAwarenessState }>;
  /** 查询 A 对 B 的当前认识状态（从 states 表读取，O(1)）。不存在时返回 null。 */
  getAwareness(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<{ currentScore: number; effectiveNote?: string; effectiveSource: AwarenessSource; lastUpdated: number } | null>;
  /**
   * 设置 A 对 B 的关系值（delta 语义，与 setAwareness 对称）。
   * relationship 不支持 auto:xxx 类型，永远追加新事件（R4 保留 GM 手动事件）。
   */
  setRelationship(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
    scoreDelta: number,
    source: RelationshipSource,
    relationshipNote?: string,
  ): Promise<{ event: EntityRelationshipEvent; state: EntityRelationshipState }>;
  /** 查询 A 对 B 的当前关系状态。不存在时返回 null。 */
  getRelationship(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<{ currentScore: number; effectiveNote?: string; effectiveSource: RelationshipSource; lastUpdated: number } | null>;
  /** 批量查询多个 A 对 B 的认识（消除 N+1，供 information-boundary-layer 使用）。 */
  getAwarenessBatch(
    saveId: string,
    observerType: EntityType, observerIds: string[],
    targetType: EntityType, targetId: string,
  ): Promise<Array<{ observerId: string; currentScore: number; effectiveNote?: string }>>;
  /** 查询 A 对所有其他元素的认识（业务查询，模块4 协同）。 */
  getEntityAwareness(
    saveId: string,
    observerType: EntityType, observerId: string,
  ): Promise<Array<{ targetId: string; targetType: string; currentScore: number; effectiveNote?: string }>>;
  /** 查询 A 对 B 的 awareness 变更历史（全部事件，按时间正序）。供审核反查 / 剧情回顾使用。 */
  getAwarenessHistory(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<EntityAwarenessEvent[]>;
  /** 查询 A 对 B 的 relationship 变更历史（全部事件，按时间正序）。供审核反查 / 剧情回顾使用。 */
  getRelationshipHistory(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<EntityRelationshipEvent[]>;
}

/**
 * 上下文压缩端口（业务层最小集，P3-S6 新增）。
 *
 * StoryService 通过构造函数接收此接口实例，compressContext 方法内部调用注入实例，
 * 不再通过 await import('../../services/context.js') 动态导入 ContextService 具体类
 * （消除 game-systems/story → services/context 跨层依赖）。
 *
 * 装配链路：init.ts → StoryServiceTool.setContextCompressor() 持有 →
 * StoryServiceTool.createService() 透传 → StoryService 构造函数 → compressContext 方法使用。
 * StoryServiceTool 自身不直接调用 compressContext（保留 StoryService.compressContext 方法语义）。
 */
export interface IContextCompressor {
  compressContext(saveId: ID, agentType: AgentType, maxMessages?: number): Promise<void>;
}

/**
 * 上下文服务端口（agents 层完整集，P3-S6 新增）。
 *
 * AgentRuntime / BaseAgent 通过此接口访问 ContextService，
 * 不再直接依赖 ContextService 具体类类型。
 *
 * 方法集为 ContextService 的全部 public 方法（9 个），确保所有使用方都能用接口替代。
 * IContextCompressor（1 方法）是此接口的子集，专门用于 StoryServiceTool 只需要压缩能力的场景。
 * 两个接口共存，ContextService 同时实现两者。
 */
export interface IContextProvider {
  getContext(saveId: ID, agentType: AgentType): Promise<AgentContext>;
  saveContext(saveId: ID, agentType: AgentType, context: Partial<AgentContext>): Promise<void>;
  updateMessages(saveId: ID, agentType: AgentType, messages: LLMMessage[]): Promise<void>;
  updateState(saveId: ID, agentType: AgentType, state: Record<string, unknown>): Promise<void>;
  clearContext(saveId: ID, agentType?: AgentType): Promise<void>;
  getAllContexts(saveId: ID): Promise<Record<AgentType, AgentContext>>;
  compressContext(saveId: ID, agentType: AgentType, maxMessages?: number): Promise<void>;
  exportContext(saveId: ID): Promise<Record<string, unknown>>;
  importContext(saveId: ID, data: Record<string, unknown>): Promise<void>;
}
