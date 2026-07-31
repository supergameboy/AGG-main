import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
// 模块2 简化：删除 IStagingPool/IEntityGraphProvider 导入
// 原因：IEntityGraphAuditor/IEntityGraphRepairer 已删除，IEntityGraphReconciler 简化为不传 stagingPool

// === 领域类型（S5 从 EntityGraphService.ts 迁移到 types.ts，消除 type-level 循环依赖） ===

export type EntityType = 'character' | 'npc' | 'location' | 'item' | 'quest' | 'event' | 'faction' | 'skill' | 'goal';

/**
 * 实体关系类型。
 *
 * - 结构性关系（LOCATED_AT/OWNS/KNOWS 等）：由 EntityGraphUpdater 从业务表派生，LLM 不直接管理
 * - PERCEIVES：LLM 管理的感知边（A 对 B 的关系值 + 认识值），由 set_awareness/set_relationship 工具 upsert
 */
export type RelationType =
  | 'LOCATED_AT' | 'OWNS' | 'EQUIPPED_WITH' | 'HAS_SKILL'
  | 'KNOWS' | 'ALLIED_WITH' | 'HOSTILE_TO'
  | 'REQUIRES' | 'TRIGGERS' | 'CONNECTED_TO'
  | 'BELONGS_TO' | 'PARTY_MEMBER'
  | 'AWARE_OF' | 'WITNESSED' | 'PURSUES'
  | 'PERCEIVES';  // 模块3 新增：LLM 管理的感知边（A 对 B 的关系值+认识值）

export interface EntityNode {
  id: string;
  saveId: string;
  entityType: EntityType;
  entityId: string;
  label: string;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 实体边的 properties 结构。
 *
 * - 结构性关系边（KNOWS/LOCATED_AT 等）：properties 携带派生元数据（如 source: 'derived_from:npc_relations'）
 * - PERCEIVES 感知边：properties 仅承载结构性元数据（lastUpdated）
 *
 * 006 升级：awarenessScore/awarenessNote/source/relationshipScore/relationshipNote 字段
 *   已迁移到独立表（entity_awareness_events/states + entity_relationship_events/states），
 *   PERCEIVES 边的 properties 不再承载这些字段（设计文档 §17）。
 *   读取 awareness/relationship 数据请通过 EntityGraphService.getAwareness/getRelationship 等方法。
 */
export interface EntityEdgeProperties {
  /** 最后更新时间戳 */
  lastUpdated?: number;
  /** 其他业务属性（保留扩展性） */
  [key: string]: unknown;
}

export interface EntityEdge {
  id: string;
  saveId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: RelationType;
  weight: number;
  properties: EntityEdgeProperties;
  createdAt: number;
  updatedAt: number;
}

export interface EntitySubgraph {
  nodes: EntityNode[];
  edges: EntityEdge[];
}

export interface GraphSnapshot {
  id: string;
  saveId: string;
  snapshotType: 'baseline' | 'chapter';
  chapterNumber: number | null;
  nodesCount: number;
  edgesCount: number;
  deltaFromSnapshotId: string | null;
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  createdAt: number;
}

/**
 * EntityGraph 领域 Repository 端口接口（S5 完整集 + 模块3 简化）。
 *
 * S4-D5 仅含 deleteBySaveId；S5 扩展为完整 Repository（21 新增方法 + 4 rowToXxx 映射），
 * 覆盖 EntityGraphService 31 处 db 调用 + EntityGraphServiceTool 2 处 db 查询。
 * 模块3 简化：删除 information_boundaries 表 + 相关 2 方法 + rowToBoundary 映射，
 * 新增 getPerceivesEdges 方法支撑 PERCEIVES 感知边查询。
 *
 * 设计依据：L0-1 方案A（单一 Repository 扩展），3 表强耦合（nodes/edges/snapshots），
 * 事务边界单一。不继承 BaseRepository（操作多张表），手动持有 db: Knex。
 *
 * D9: 所有方法支持 trx? 可选参数，供事务内调用透传。
 * Row 类型单一化（§9.2）：JSON 字段在 Row 中声明为 string，rowToXxx 负责解析。
 */

// === Row 类型（新增，Row 类型单一化 §9.2） ===

/**
 * entity_graph_nodes 表 Row 类型。
 * properties 字段为 JSON 字符串，Repository.rowToNode 负责 JSON.parse。
 */
export interface EntityGraphNodeRow {
  id: string;
  save_id: string;
  entity_type: string;
  entity_id: string;
  label: string;
  properties: string;
  created_at: number;
  updated_at: number;
}

/**
 * entity_graph_edges 表 Row 类型。
 * properties 字段为 JSON 字符串，Repository.rowToEdge 负责 JSON.parse。
 */
export interface EntityGraphEdgeRow {
  id: string;
  save_id: string;
  from_node_id: string;
  to_node_id: string;
  relation: string;
  weight: number;
  properties: string;
  created_at: number;
  updated_at: number;
}

/**
 * entity_graph_snapshots 表 Row 类型。
 * added_node_ids/removed_node_ids/added_edge_ids/removed_edge_ids 字段为 JSON 字符串或 null，
 * Repository.rowToSnapshot 负责 JSON.parse。
 */
export interface EntityGraphSnapshotRow {
  id: string;
  save_id: string;
  snapshot_type: string;
  chapter_number: number | null;
  nodes_count: number;
  edges_count: number;
  delta_from_snapshot_id: string | null;
  added_node_ids: string | null;
  removed_node_ids: string | null;
  added_edge_ids: string | null;
  removed_edge_ids: string | null;
  created_at: number;
}

// === IEntityGraphRepository 完整接口（1 已有 + 20 新增 + 模块3 1 新增 = 22 方法） ===

export interface IEntityGraphRepository {
  // === 已有（S4-D5） ===
  /**
   * 删除指定 saveId 的所有 entity_graph_nodes + entity_graph_edges。
   * 用于 rollbackSave 原子性清理实体图数据。
   * 先删 edges（依赖 nodes），再删 nodes。
   */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;

  // === Node CRUD（5 方法） ===
  upsertNode(saveId: string, type: EntityType, entityId: string, label: string, properties?: Record<string, unknown>, trx?: Knex.Transaction): Promise<string>;
  getNode(saveId: string, type: EntityType, entityId: string, trx?: Knex.Transaction): Promise<EntityNode | null>;
  getNodesByType(saveId: string, type: EntityType, trx?: Knex.Transaction, limit?: number): Promise<EntityNode[]>;
  getNodesByLocation(saveId: string, locationId: string, options?: { includeDescendants?: boolean; nodeTypeFilter?: string[] }, trx?: Knex.Transaction): Promise<EntityNode[]>;
  findNodeByEntityIdOrLabel(saveId: string, entityType: EntityType, entityIdOrLabel: string, timestamp?: number, trx?: Knex.Transaction): Promise<EntityNode | null>;
  /**
   * 仅按 label 匹配节点（供 EntityGraphResolver.findByName 使用，避免 findNodeByEntityIdOrLabel 重复 entity_id 查询）。
   * 返回所有 label 匹配的节点（可能多个），由调用方自行消歧。
   */
  findNodesByLabel(saveId: string, entityType: EntityType, label: string, trx?: Knex.Transaction): Promise<EntityNode[]>;

  // === Edge CRUD（4 方法） ===
  upsertEdge(saveId: string, fromNodeId: string, relation: RelationType, toNodeId: string, weight?: number, properties?: Record<string, unknown>, trx?: Knex.Transaction): Promise<string>;
  getEdges(saveId: string, nodeId: string, trx?: Knex.Transaction): Promise<EntityEdge[]>;
  getEdgesByRelation(saveId: string, relation: RelationType, trx?: Knex.Transaction): Promise<EntityEdge[]>;
  findNodeIdByEntityIdOrLabel(saveId: string, entityIdOrLabel: string, timestamp?: number, trx?: Knex.Transaction): Promise<string | null>;

  // === Graph 查询（2 方法） ===
  getSubgraph(saveId: string, centerNodeId: string, depth: number, trx?: Knex.Transaction): Promise<EntitySubgraph>;
  getFullGraph(saveId: string, trx?: Knex.Transaction): Promise<EntitySubgraph>;

  // === Snapshot（4 方法） ===
  createSnapshot(saveId: string, type: 'baseline' | 'chapter', chapterNumber?: number, deltaFromId?: string, addedNodeIds?: string[], removedNodeIds?: string[], addedEdgeIds?: string[], removedEdgeIds?: string[], trx?: Knex.Transaction): Promise<string>;
  getSnapshot(saveId: string, snapshotId: string, trx?: Knex.Transaction): Promise<GraphSnapshot | null>;
  getLatestSnapshot(saveId: string, trx?: Knex.Transaction): Promise<GraphSnapshot | null>;
  getAllSnapshots(saveId: string, trx?: Knex.Transaction): Promise<GraphSnapshot[]>;

  // === 聚合统计（1 方法） ===
  getWorldStateSummary(saveId: string, trx?: Knex.Transaction): Promise<{
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
    edgesByRelation: Record<string, number>;
    snapshotCount: number;
  }>;

  // === PERCEIVES 感知边查询（模块3 新增） ===
  /**
   * 查询 PERCEIVES 边（LLM 管理的感知数据）。
   * 同时支撑 getAwareness/getAwarenessBatch/getEntityAwareness 三个 Service 方法：
   * - getAwareness(A, B)：getPerceivesEdges(saveId, fromNodeId=A, toNodeId=B)
   * - getAwarenessBatch([A1,A2], B)：getPerceivesEdges(saveId, toNodeId=B) + 内存过滤 fromNodeId in [A1,A2]
   * - getEntityAwareness(A)：getPerceivesEdges(saveId, fromNodeId=A)
   */
  getPerceivesEdges(saveId: string, fromNodeId?: string, toNodeId?: string, trx?: Knex.Transaction): Promise<EntityEdge[]>;
}

// === EntityGraphBuilder 跨领域读端口（S5 新增，D3 修复） ===

/**
 * Character 领域只读端口（EntityGraphBuilder/EntityGraphUpdater 跨领域访问）。
 * 方法集为 entity-graph 实际使用的最小集。
 */
export interface ICharacterReadPort {
  /** 按 saveId 查询所有角色行（Builder enrichFromExistingData 使用）。 */
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
  /** 按 saveId 查询首个角色 ID（Builder/Updater 在 owner_id 缺失时回退使用）。 */
  findIdBySaveId(saveId: string, trx?: Knex.Transaction): Promise<string | null>;
}

/** NPC 领域只读端口。 */
export interface INPCReadPort {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
}

// 模块2 简化：删除 INPCRelationReadPort 接口（npc_relations 表已删除，关系数据由 PERCEIVES 边维护）

/** Location 领域只读端口。 */
export interface ILocationReadPort {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
}

/** Location 连接只读端口。 */
export interface ILocationConnectionReadPort {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
}

/** Inventory 领域只读端口（ownerType 可选过滤）。 */
export interface IInventoryReadPort {
  findBySaveId(saveId: string, ownerType?: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
}

/** Quest 领域只读端口。 */
export interface IQuestReadPort {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
}

/**
 * Event 领域只读端口。
 * 方法为 findTriggerEventsBySaveId：聚合 event_triggers + events 两表，
 * 返回触发器关联的事件行（Builder enrichFromExistingData 使用）。
 */
export interface IEventReadPort {
  findTriggerEventsBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
}

/**
 * Faction 领域只读端口。
 * hasTable 用于运行时检测 factions 表是否存在（Builder 兼容旧存档）。
 */
export interface IFactionReadPort {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
  hasTable(): Promise<boolean>;
}

/** Character 技能只读端口。 */
export interface ICharacterSkillReadPort {
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
}

/**
 * NPC 目标只读端口。
 * hasTable 用于运行时检测 npc_goals 表是否存在（Builder 兼容旧存档）。
 * findActiveBySaveId 只返回 status='active' 的目标。
 */
export interface INPCGoalReadPort {
  findActiveBySaveId(saveId: string, trx?: Knex.Transaction): Promise<Record<string, unknown>[]>;
  hasTable(): Promise<boolean>;
}

/**
 * EntityGraphBuilder 跨领域数据读取端口聚合（S5 新增）。
 *
 * 聚合 11 个跨领域表的只读查询方法，消除 Builder 直接 db 跨领域访问（D3 严重违规）。
 * 组合根在 init.ts 创建，聚合各领域 Repository 端口（或专用 Adapter 实现）。
 */
export interface EntityGraphBuildContext {
  characterPort: ICharacterReadPort;
  npcPort: INPCReadPort;
  // 模块2 简化：删除 npcRelationPort 字段（npc_relations 表已删除）
  locationPort: ILocationReadPort;
  locationConnectionPort: ILocationConnectionReadPort;
  inventoryPort: IInventoryReadPort;
  questPort: IQuestReadPort;
  eventPort: IEventReadPort;
  factionPort: IFactionReadPort;
  characterSkillPort: ICharacterSkillReadPort;
  npcGoalPort: INPCGoalReadPort;
}

// === EG-M3-1: 缓存层端口接口 ===

/**
 * EntityGraph 缓存层端口接口（EG-M3-1 新增）。
 *
 * per-saveId 独立缓存空间，按查询类型分键（fullGraph / subgraph:{centerNodeId}:{depth} / edges:{nodeId}）。
 * 实现类：EntityGraphCache（生产场景）+ NullEntityGraphCache（审计场景空对象模式）。
 *
 * 设计依据：
 * - cache 在 EntityGraphService 构造函数中必填（非可选），由组合根注入
 * - 审计场景使用临时 EntityGraphService（基于 StagingKnex 代理 db），缓存无意义，注入 NullEntityGraphCache
 * - 写入时保守失效（invalidate(saveId) 全量），StagingPool flush 后失效整个 saveId 缓存
 *
 * 缓存命中策略：
 * - get() 命中返回缓存数据，未命中返回 null
 * - set() 写入缓存，可选 ttlSeconds（默认由实现类决定）
 * - invalidate(saveId) 失效该 saveId 的所有缓存条目
 * - invalidateKey(saveId, key) 失效特定缓存键
 */
export interface IEntityGraphCache {
  /**
   * 从缓存获取数据
   * @param saveId 存档 ID
   * @param key 缓存键（如 "fullGraph", "subgraph:egn_npc_xxx:2", "edges:egn_npc_xxx"）
   * @returns 缓存数据或 null（未命中）
   */
  get<T>(saveId: string, key: string): T | null;

  /**
   * 设置缓存
   * @param saveId 存档 ID
   * @param key 缓存键
   * @param value 缓存数据
   * @param ttlSeconds 过期时间（秒），可选（未传则使用实现类默认 TTL）
   */
  set<T>(saveId: string, key: string, value: T, ttlSeconds?: number): void;

  /**
   * 失效指定 saveId 的所有缓存
   * @param saveId 存档 ID
   */
  invalidate(saveId: string): void;

  /**
   * 失效指定 saveId 的特定缓存键
   * @param saveId 存档 ID
   * @param key 缓存键
   */
  invalidateKey(saveId: string, key: string): void;

  /**
   * 清空所有缓存
   */
  clear(): void;

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; hitCount: number; missCount: number };
}

// === 模块2 简化：删除审计-修复闭环类型 ===
// 已删除：GraphAuditIssue, IEntityGraphRepairer, IEntityGraphAuditor,
//         ExpectedNode, ExpectedEdge, ExpectedGraphState, GraphDiff
// 原因：EntityGraphAuditor/EntityGraphRepairer 已删除，Reconciler 改用全量重建

/**
 * 纠错结果（Reconciler.reconcile 返回值）。
 *
 * 模块2 简化版：全量重建结果，无审计闭环字段。
 * - rebuilt: 是否执行了全量重建
 * - nodeCount/edgeCount: 重建后节点/边数量（失败时为 0）
 * - error: 失败时的错误信息（成功时为 undefined，L3-1 错误处理）
 */
export interface ReconcileResult {
  saveId: string;
  rebuilt: boolean;
  nodeCount: number;
  edgeCount: number;
  error?: string;
}

// === IEntityGraphReconciler 端口接口 ===

/**
 * 实体图定期纠错器端口接口。
 *
 * 模块2 简化版：全量重建兜底机制，无审计闭环。
 * 通过 Builder.enrichFromExistingData 重新派生全量图数据，
 * 直写 DB（graphProvider.upsert），无需 StagingPool（非 ReAct 循环路径，§13.1 不适用）。
 *
 * 触发时机：
 * - 写入阈值触发（AgentRuntime.triggerReconcileIfNeeded，累计写入次数达阈值）
 * - 章节推进触发（init.ts chapter_advanced 订阅，快照前纠错）
 *
 * 失败处理（L3-1）：
 * - 重建失败返回 error 字段，不抛错，不阻塞 AgentRuntime 主流程
 * - 失败信息通过 logger 暴露给开发者，不反馈给 LLM
 */
export interface IEntityGraphReconciler {
  /**
   * 全量重建图数据兜底机制。
   *
   * @param saveId 存档 ID
   * @returns 纠错结果（重建统计 + 失败时的错误信息）
   */
  reconcile(saveId: string): Promise<ReconcileResult>;
}

// ════════════════════════════════════════════════════════════════════════════
// awareness/relationship 升级（006 迁移 + delta 语义 + 双表方案）
// 设计文档: docs/design/fix/fix-20260721-awareness-relationship-upgrade.md
// ════════════════════════════════════════════════════════════════════════════

/**
 * awareness/relationship 变更来源类型。
 *
 * - GM 手动事件：direct_observation / informed_by / overheard / rumor / player_stated / inferred
 * - 程序自动事件：auto:dialogue / auto:combat（仅 awareness，relationship 不自动化）
 * - 系统派生：derived_from_system
 *
 * source.type 优先级：非 auto 类型 > auto 类型（查询最新有效值时使用）
 */
export type AwarenessSourceType =
  | 'direct_observation'
  | 'informed_by'
  | 'overheard'
  | 'rumor'
  | 'player_stated'
  | 'inferred'
  | 'auto:dialogue'
  | 'auto:combat'
  | 'derived_from_system';

/**
 * relationship 来源类型（不含 auto:xxx，relationship 完全手动）。
 */
export type RelationshipSourceType =
  | 'direct_observation'
  | 'informed_by'
  | 'overheard'
  | 'rumor'
  | 'player_stated'
  | 'inferred'
  | 'derived_from_system';

/**
 * 结构化 source 对象（awareness 版本）。
 *
 * - type=informed_by 时，informerType/informerId 必填（追溯信息传播链）
 * - topicType/topicId 可选（记录告知的主题，如 quest:调查暗影森林）
 * - note 自由文本补充
 * - occurredAt 该来源事件发生时间（由 Service 写入）
 */
export interface AwarenessSource {
  type: AwarenessSourceType;
  informerType?: EntityType;
  informerId?: string;
  topicType?: EntityType;
  topicId?: string;
  note?: string;
  occurredAt: number;
}

/**
 * 结构化 source 对象（relationship 版本，同结构但 type 范围不同）。
 */
export interface RelationshipSource {
  type: RelationshipSourceType;
  informerType?: EntityType;
  informerId?: string;
  topicType?: EntityType;
  topicId?: string;
  note?: string;
  occurredAt: number;
}

/**
 * awareness 变更事件（entity_awareness_events 表 entity）。
 *
 * 每次调用 setAwareness 追加一条事件，记录本次 delta 变更。
 * 写入时压缩：连续同 source.type + 同符号 + 非关键转折的 auto 事件可合并（merged_count 累加）。
 */
export interface EntityAwarenessEvent {
  id: string;
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  scoreDelta: number;
  awarenessNote?: string;
  source: AwarenessSource;
  mergedCount: number;
  createdAt: number;
}

/**
 * awareness 当前状态（entity_awareness_states 表 entity）。
 *
 * 由 events 表派生：current_score = clamp(累加全部 delta, -10, +10)。
 * effective_note/effective_source/effective_event_id 指向最新有效事件。
 * UNIQUE(save_id, observer_node_id, target_node_id) 约束。
 */
export interface EntityAwarenessState {
  id: string;
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  currentScore: number;
  effectiveNote?: string;
  effectiveSource: AwarenessSource;
  effectiveEventId: string;
  lastUpdated: number;
}

/** relationship 变更事件（同结构，scoreDelta/relationshipNote/source 用 RelationshipSource）。 */
export interface EntityRelationshipEvent {
  id: string;
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  scoreDelta: number;
  relationshipNote?: string;
  source: RelationshipSource;
  mergedCount: number;
  createdAt: number;
}

/** relationship 当前状态。 */
export interface EntityRelationshipState {
  id: string;
  saveId: string;
  observerNodeId: string;
  targetNodeId: string;
  currentScore: number;
  effectiveNote?: string;
  effectiveSource: RelationshipSource;
  effectiveEventId: string;
  lastUpdated: number;
}

// === Row 类型（§9.2 单一化：JSON 字段声明为 string，Repository 负责 JSON.parse） ===

export interface EntityAwarenessEventRow {
  id: string;
  save_id: string;
  observer_node_id: string;
  target_node_id: string;
  score_delta: number;
  awareness_note: string | null;
  source: string;
  merged_count: number;
  created_at: number;
}

export interface EntityAwarenessStateRow {
  id: string;
  save_id: string;
  observer_node_id: string;
  target_node_id: string;
  current_score: number;
  effective_note: string | null;
  effective_source: string | null;
  effective_event_id: string | null;
  last_updated: number;
}

export interface EntityRelationshipEventRow {
  id: string;
  save_id: string;
  observer_node_id: string;
  target_node_id: string;
  score_delta: number;
  relationship_note: string | null;
  source: string;
  merged_count: number;
  created_at: number;
}

export interface EntityRelationshipStateRow {
  id: string;
  save_id: string;
  observer_node_id: string;
  target_node_id: string;
  current_score: number;
  effective_note: string | null;
  effective_source: string | null;
  effective_event_id: string | null;
  last_updated: number;
}

// === IAwarenessRepository 端口接口 ===

/**
 * awareness 数据访问 Repository 端口接口。
 *
 * 双表方案：
 * - events 表：变更追加（全量历史 + 写入时压缩）
 * - states 表：派生单值当前状态（UNIQUE 约束）
 *
 * D9: 所有方法支持 trx? 可选参数。
 * D3: 仅访问 entity_awareness_events + entity_awareness_states 两表，不跨领域。
 */
export interface IAwarenessRepository {
  // === 写入 ===
  /**
   * 追加一条 awareness 变更事件。
   * 期望效果：INSERT 到 entity_awareness_events 表。
   */
  insertEvent(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    scoreDelta: number,
    source: AwarenessSource,
    awarenessNote: string | undefined,
    trx?: Knex.Transaction,
  ): Promise<string>;

  /**
   * 合并事件（写入时压缩 R1：连续 auto 事件合并）。
   * 期望效果：UPDATE last_event SET score_delta += incoming_delta, merged_count += 1, ...
   */
  mergeEvent(
    saveId: string,
    eventId: string,
    incomingDelta: number,
    incomingNote: string | undefined,
    incomingSource: AwarenessSource,
    trx?: Knex.Transaction,
  ): Promise<void>;

  /**
   * UPSERT awareness 当前状态（current_score = clamp(current + delta, -10, +10)）。
   * 期望效果：若 (save_id, observer, target) 存在则 UPDATE，否则 INSERT。
   */
  upsertState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    newScore: number,
    effectiveNote: string | undefined,
    effectiveSource: AwarenessSource,
    effectiveEventId: string,
    trx?: Knex.Transaction,
  ): Promise<void>;

  // === 查询 ===
  /**
   * 查询最新一条事件（写入时压缩判断用）。
   */
  getLatestEvent(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessEvent | null>;

  /**
   * 查询全部历史事件（审核反查/剧情回顾用）。
   */
  getHistory(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessEvent[]>;

  /**
   * 查询当前状态（GM prompt 注入用，O(1)）。
   */
  getState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessState | null>;

  /**
   * 批量查询多个 observer 对同一 target 的状态（NPC prompt 注入用）。
   */
  getStatesBatch(
    saveId: string,
    observerNodeIds: string[],
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessState[]>;

  /**
   * 统计对指定 target 有 current_score >= minScore 的 observer 数量。
   * 期望效果：SELECT COUNT(*) FROM entity_awareness_states
   *   WHERE save_id = ? AND target_node_id = ? AND current_score >= ?
   * 用途：StoryKernel.assessInfoSpreadFactor 计算信息扩散度（紧张度引擎 info 因子）。
   */
  countObserversByTargetAndScore(
    saveId: string,
    targetNodeId: string,
    options: { minScore: number },
    trx?: Knex.Transaction,
  ): Promise<number>;

  // === 清理 ===
  /**
   * 删除指定 saveId 的全部 awareness 数据（rollbackSave 用）。
   * 顺序：先 states，后 events。
   */
  deleteBySaveId(saveId: string, trx?: Knex.Transaction): Promise<void>;
}

// === IRelationshipRepository 端口接口（同结构，移除 auto:xxx source 类型） ===

export interface IRelationshipRepository {
  // === 写入 ===
  insertEvent(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    scoreDelta: number,
    source: RelationshipSource,
    relationshipNote: string | undefined,
    trx?: Knex.Transaction,
  ): Promise<string>;

  mergeEvent(
    saveId: string,
    eventId: string,
    incomingDelta: number,
    incomingNote: string | undefined,
    incomingSource: RelationshipSource,
    trx?: Knex.Transaction,
  ): Promise<void>;

  upsertState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    newScore: number,
    effectiveNote: string | undefined,
    effectiveSource: RelationshipSource,
    effectiveEventId: string,
    trx?: Knex.Transaction,
  ): Promise<void>;

  // === 查询 ===
  getLatestEvent(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityRelationshipEvent | null>;

  getHistory(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityRelationshipEvent[]>;

  getState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityRelationshipState | null>;

  getStatesBatch(
    saveId: string,
    observerNodeIds: string[],
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityRelationshipState[]>;

  /**
   * 统计对指定 target 有 current_score >= minScore 的 observer 数量。
   * 用途：未来扩展（当前 StoryKernel 仅读 awareness 扩散度，relationship 暂未使用）。
   */
  countObserversByTargetAndScore(
    saveId: string,
    targetNodeId: string,
    options: { minScore: number },
    trx?: Knex.Transaction,
  ): Promise<number>;

  // === 清理 ===
  deleteBySaveId(saveId: string, trx?: Knex.Transaction): Promise<void>;
}
