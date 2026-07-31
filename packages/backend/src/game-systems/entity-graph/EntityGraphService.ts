import { createChildLogger } from '../../utils/logger.js';
import type { IEntityGraphProvider } from '../shared/types.js';
import type { IEntityGraphRepository, IEntityGraphCache, EntityType, RelationType, EntityNode, EntityEdge, EntitySubgraph, GraphSnapshot,
  IAwarenessRepository,
  IRelationshipRepository,
  AwarenessSource,
  RelationshipSource,
  EntityAwarenessEvent,
  EntityAwarenessState,
  EntityRelationshipEvent,
  EntityRelationshipState,
} from './types.js';
import type { INPCService } from '../npc/types.js';
import type { IMapService } from '../map/types.js';
import type { NPCProfile } from '../npc/types.js';
import type { LocationData } from '../map/types.js';

/**
 * EntityGraphService（S5 重构 + EG-M3-3 集成缓存层 + 模块3 信息边界简化 + 006 awareness/relationship 升级）。
 *
 * S5 之前：直接持有 db: Knex，31 处直接数据库调用。
 * S5 之后：注入 IEntityGraphRepository，所有数据访问通过 Repository。
 * EG-M3-3：新增 cache 必填参数，查询走缓存，写入失效缓存（保守策略 invalidate(saveId)）。
 * 模块3 简化：删除 InformationBoundary 双轨机制，统一到 PERCEIVES 边管理 awareness/relationship。
 * 006 升级：awareness/relationship 从 PERCEIVES 边 properties 迁移到独立表（events + states 双表），
 *   score 语义改为 delta（变更量），累加 + clamp [-10, +10]，source 结构化。
 *
 * 职责（保留）：
 * - implements IEntityGraphProvider（端口方法签名，供 EntityGraphServiceTool + information-boundary-layer 使用）
 * - 额外暴露 getAllSnapshots / getWorldStateSummary（供 routes/dev.ts + StoryKernel.EntityGraphPort 使用）
 * - 新增 countAwarenessByTopic（供 StoryKernel.assessInfoSpreadFactor 紧张度引擎使用）
 *
 * 缓存策略：
 * - 查询方法（getFullGraph/getSubgraph/getEdges）：先查缓存，未命中查 DB → 写入缓存 → 返回
 * - 写入方法（upsertNode/upsertEdge/setAwareness/setRelationship）：
 *   写入 DB 后失效该 saveId 全图缓存（保守策略：宁可多失效不可脏读）
 * - 不缓存的方法：getNode/getNodesByType/getNodesByLocation/getEdgesByRelation/getPerceivesEdges
 *   awareness/relationship states/events 查询不缓存（每次应反映最新状态）
 *
 * cache 必填（非可选）：
 * - 生产场景注入 EntityGraphCache 实例
 * - 审计场景注入 NullEntityGraphCache（空对象模式，所有方法 no-op）
 * - 不使用可选参数 + fallback 默认值，避免静默降级
 *
 * 006 awareness/relationship 升级语义：
 * - setAwareness/setRelationship 改为 delta 语义（scoreDelta 是本次变更量）
 * - events 表追加变更事件（全量历史 + 写入时压缩 R1-R4）
 * - states 表派生当前状态（current_score = clamp(累加 delta, -10, +10)）
 * - source 字段结构化（含 type/informerType/informerId/topicType/topicId/note/occurredAt）
 * - 自动化与 GM 共存：delta 累加天然叠加，无需 GM 覆盖锁
 */
export class EntityGraphService implements IEntityGraphProvider {
  private logger: ReturnType<typeof createChildLogger>;

  /**
   * 模块4 L2-7：跨领域端口接口注入（§7.1）。
   *
   * - 生产场景（EntityGraphServiceTool.createEntityGraphService）：注入 NPCService/MapService 实例
   * - 简化场景（dev routes / StoryKernel port）：传 null，仅使用图查询方法
   * - getNpcProfile/getLocationSummary 在端口为 null 时抛错（运行时暴露，不静默降级）
   *
   * 006 升级：新增 awarenessRepository + relationshipRepository 必填注入。
   */
  constructor(
    private repository: IEntityGraphRepository,
    // EG-M3-3: cache 必填（无 ? 可选标记），由 init.ts / agent-deps.ts 在构造时强制注入
    // 审计场景使用临时 EntityGraphService 实例（基于 StagingKnex 代理 db），
    // 注入 NullEntityGraphCache（空对象模式），而非可选参数静默降级
    private cache: IEntityGraphCache,
    // 006 升级：awareness/relationship 双表 Repository 必填注入
    private awarenessRepository: IAwarenessRepository,
    private relationshipRepository: IRelationshipRepository,
    // 模块4：跨领域端口（可选，仅 getNpcProfile/getLocationSummary 需要）
    private npcService: INPCService | null = null,
    private mapService: IMapService | null = null,
  ) {
    this.logger = createChildLogger('service:entity-graph');
  }

  async upsertNode(saveId: string, type: EntityType, entityId: string, label: string, properties?: Record<string, unknown>): Promise<string> {
    const id = await this.repository.upsertNode(saveId, type, entityId, label, properties);
    // 节点变更失效全图缓存（保守策略）
    this.cache.invalidate(saveId);
    this.logger.info('Node upserted', { saveId, type, entityId, id });
    return id;
  }

  async getNode(saveId: string, type: EntityType, entityId: string): Promise<EntityNode | null> {
    return this.repository.getNode(saveId, type, entityId);
  }

  async getNodesByLocation(saveId: string, locationId: string, options?: { includeDescendants?: boolean; nodeTypeFilter?: string[] }): Promise<EntityNode[]> {
    const nodes = await this.repository.getNodesByLocation(saveId, locationId, options);
    this.logger.info('Nodes by location retrieved', { saveId, locationId, includeDescendants: !!options?.includeDescendants, count: nodes.length });
    return nodes;
  }

  async getNodesByType(saveId: string, type: EntityType): Promise<EntityNode[]> {
    return this.repository.getNodesByType(saveId, type);
  }

  async upsertEdge(saveId: string, fromNodeId: string, relation: RelationType, toNodeId: string, weight?: number, properties?: Record<string, unknown>): Promise<string> {
    const id = await this.repository.upsertEdge(saveId, fromNodeId, relation, toNodeId, weight, properties);
    // 边变更失效全图缓存（保守策略）
    // 理由：invalidateKey 不支持通配符，而 subgraph:{nodeId}:{depth} 缓存键含 depth
    //   且 fromNodeId/toNodeId 的所有祖先链路都可能受影响。全量失效符合"宁可多失效不可脏读"原则
    //   下次查询时自动从 DB 重新加载并重建缓存
    this.cache.invalidate(saveId);
    this.logger.info('Edge upserted', { saveId, fromNodeId, relation, toNodeId, id });
    return id;
  }

  async getEdges(saveId: string, nodeId: string): Promise<EntityEdge[]> {
    const cacheKey = `edges:${nodeId}`;
    const cached = this.cache.get<EntityEdge[]>(saveId, cacheKey);
    if (cached) return cached;

    const result = await this.repository.getEdges(saveId, nodeId);
    this.cache.set(saveId, cacheKey, result);
    return result;
  }

  async getEdgesByRelation(saveId: string, relation: RelationType): Promise<EntityEdge[]> {
    return this.repository.getEdgesByRelation(saveId, relation);
  }

  async getSubgraph(saveId: string, centerNodeId: string, depth: number): Promise<EntitySubgraph> {
    const cacheKey = `subgraph:${centerNodeId}:${depth}`;
    const cached = this.cache.get<EntitySubgraph>(saveId, cacheKey);
    if (cached) return cached;

    const graph = await this.repository.getSubgraph(saveId, centerNodeId, depth);
    this.cache.set(saveId, cacheKey, graph);
    this.logger.info('Subgraph retrieved', { saveId, centerNodeId, depth, nodeCount: graph.nodes.length, edgeCount: graph.edges.length });
    return graph;
  }

  async getFullGraph(saveId: string): Promise<EntitySubgraph> {
    const cacheKey = 'fullGraph';
    const cached = this.cache.get<EntitySubgraph>(saveId, cacheKey);
    if (cached) return cached;

    const graph = await this.repository.getFullGraph(saveId);
    this.cache.set(saveId, cacheKey, graph);
    this.logger.info('Full graph retrieved', { saveId, nodeCount: graph.nodes.length, edgeCount: graph.edges.length });
    return graph;
  }

  // === 模块3：PERCEIVES 感知边管理（替代 InformationBoundary 双轨机制） ===

  /**
   * 设置元素 A 对元素 B 的认识值（delta 语义，追加 event + UPSERT state）。
   *
   * 006 升级：awareness 数据从 PERCEIVES 边 properties 迁移到独立表（events + states 双表）。
   * - events 表追加变更事件（全量历史 + 写入时压缩 R1-R4）
   * - states 表派生当前状态（current_score = clamp(累加 delta, -10, +10)）
   * - source 字段结构化（含 type/informerType/informerId/topicType/topicId/note/occurredAt）
   * - 自动化与 GM 共存：delta 累加天然叠加，无需 GM 覆盖锁
   *
   * 实体存在性校验（§13.3 归属保守处理）：
   * - observer/target 节点必须存在，缺失抛错，禁止 fallback
   *
   * @param observerType/observerId 元素 A（observer，任意类型）
   * @param targetType/targetId 元素 B（被认识者，任意类型，可与 A 不同类）
   * @param scoreDelta 本次变更量（非绝对值），正数提升认识，负数降低
   * @param source 结构化来源对象
   * @param awarenessNote 认识备注（可选）
   * @returns 更新后的事件 + 状态
   */
  async setAwareness(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
    scoreDelta: number,
    source: AwarenessSource,
    awarenessNote?: string,
  ): Promise<{ event: EntityAwarenessEvent; state: EntityAwarenessState }> {
    const fromNodeId = await this.requireNodeExists(saveId, observerType, observerId, 'observer');
    const toNodeId = await this.requireNodeExists(saveId, targetType, targetId, 'target');

    // 写入时压缩判断（R1-R4）
    const lastEvent = await this.awarenessRepository.getLatestEvent(saveId, fromNodeId, toNodeId);
    const compressible = this.isAwarenessCompressible(lastEvent, source, scoreDelta);

    let eventId: string;
    if (compressible && lastEvent) {
      // R1 合并：同 source.type + 同符号 + 非关键转折 + 是 auto 类型
      await this.awarenessRepository.mergeEvent(saveId, lastEvent.id, scoreDelta, awarenessNote, source);
      eventId = lastEvent.id;
    } else {
      // 追加新事件
      eventId = await this.awarenessRepository.insertEvent(saveId, fromNodeId, toNodeId, scoreDelta, source, awarenessNote);
    }

    // UPSERT states 表（current_score = clamp(current + delta, -10, +10)）
    const existingState = await this.awarenessRepository.getState(saveId, fromNodeId, toNodeId);
    const oldScore = existingState?.currentScore ?? 0;
    const newScore = this.clampScore(oldScore + scoreDelta);
    await this.awarenessRepository.upsertState(
      saveId, fromNodeId, toNodeId, newScore,
      awarenessNote, source, eventId,
    );

    this.cache.invalidate(saveId);
    this.logger.info('Awareness updated', { saveId, observerType, observerId, targetType, targetId, scoreDelta, newScore, compressed: compressible });

    // 返回新增/合并后的事件 + 更新后的状态
    const event = (await this.awarenessRepository.getLatestEvent(saveId, fromNodeId, toNodeId))!;
    const state = (await this.awarenessRepository.getState(saveId, fromNodeId, toNodeId))!;
    return { event, state };
  }

  /**
   * 查询元素 A 对元素 B 的当前认识状态（从 states 表读取，O(1)）。
   * 不存在时返回 null（get 操作不抛错）。
   */
  async getAwareness(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<{ currentScore: number; effectiveNote?: string; effectiveSource: AwarenessSource; lastUpdated: number } | null> {
    const fromNodeId = await this.tryGetNodeId(saveId, observerType, observerId);
    const toNodeId = await this.tryGetNodeId(saveId, targetType, targetId);
    if (!fromNodeId || !toNodeId) return null;

    const state = await this.awarenessRepository.getState(saveId, fromNodeId, toNodeId);
    if (!state) return null;
    return {
      currentScore: state.currentScore,
      ...(state.effectiveNote !== undefined ? { effectiveNote: state.effectiveNote } : {}),
      effectiveSource: state.effectiveSource,
      lastUpdated: state.lastUpdated,
    };
  }

  /**
   * 查询 A 对 B 的 awareness 变更历史（全部事件，按时间正序）。
   * 用于审核反查（DialogueConsistencyChecker）和剧情回顾。
   */
  async getAwarenessHistory(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<EntityAwarenessEvent[]> {
    const fromNodeId = await this.tryGetNodeId(saveId, observerType, observerId);
    const toNodeId = await this.tryGetNodeId(saveId, targetType, targetId);
    if (!fromNodeId || !toNodeId) return [];
    return this.awarenessRepository.getHistory(saveId, fromNodeId, toNodeId);
  }

  /**
   * 按 entity_id 或 label 查询节点（006 升级新增，审核反查专用）。
   *
   * 期望效果：
   *   - 优先按 entity_id 精确匹配（repository.getNode）
   *   - 不存在时按 label 模糊匹配（repository.findNodeByEntityIdOrLabel）
   *   - 不存在时返回 null
   *
   * 用途：DialogueConsistencyChecker 把 LLM 提取的 name（如"村长艾德温"）
   *   解析为 entity_id，再调用 getAwarenessHistory 查询 awareness 变更历史。
   *
   * 设计依据：§13.2 工具实体引用 name/id 双兼容规范在工具层已实现，
   *   Service 层接收已解析的 entity_id；审核反查是 Service 层少数需要 name 解析的场景，
   *   暴露此方法供 DialogueConsistencyChecker 使用，不扩大 IEntityGraphProvider 接口
   *   （接口最小化原则，§六.2）。
   */
  async findNodeByNameOrId(
    saveId: string,
    entityType: EntityType,
    nameOrId: string,
  ): Promise<EntityNode | null> {
    // 先按 entity_id 精确匹配
    const byId = await this.repository.getNode(saveId, entityType, nameOrId);
    if (byId) return byId;
    // 再按 label 模糊匹配
    return this.repository.findNodeByEntityIdOrLabel(saveId, entityType, nameOrId);
  }

  /**
   * 设置元素 A 对元素 B 的关系值（delta 语义，与 setAwareness 对称）。
   * 参数命名与 setAwareness 一致（code-standards §四 API 设计一致）。
   *
   * @param scoreDelta 本次关系变更量（正数提升喜欢，负数降低）
   * @param source 结构化来源（relationship 不支持 auto:xxx 类型）
   * @param relationshipNote 关系备注（可选）
   */
  async setRelationship(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
    scoreDelta: number,
    source: RelationshipSource,
    relationshipNote?: string,
  ): Promise<{ event: EntityRelationshipEvent; state: EntityRelationshipState }> {
    const fromNodeId = await this.requireNodeExists(saveId, observerType, observerId, 'observer');
    const toNodeId = await this.requireNodeExists(saveId, targetType, targetId, 'target');

    // 写入时压缩判断（R1-R4，relationship 不含 auto:xxx，永远不压缩——R4 保留 GM 手动事件）
    // 此处保留压缩入口以保持 API 对称，但实际 relationship 永远追加新事件
    const lastEvent = await this.relationshipRepository.getLatestEvent(saveId, fromNodeId, toNodeId);
    const compressible = this.isRelationshipCompressible(lastEvent, source, scoreDelta);

    let eventId: string;
    if (compressible && lastEvent) {
      await this.relationshipRepository.mergeEvent(saveId, lastEvent.id, scoreDelta, relationshipNote, source);
      eventId = lastEvent.id;
    } else {
      eventId = await this.relationshipRepository.insertEvent(saveId, fromNodeId, toNodeId, scoreDelta, source, relationshipNote);
    }

    const existingState = await this.relationshipRepository.getState(saveId, fromNodeId, toNodeId);
    const oldScore = existingState?.currentScore ?? 0;
    const newScore = this.clampScore(oldScore + scoreDelta);
    await this.relationshipRepository.upsertState(
      saveId, fromNodeId, toNodeId, newScore,
      relationshipNote, source, eventId,
    );

    this.cache.invalidate(saveId);
    this.logger.info('Relationship updated', { saveId, observerType, observerId, targetType, targetId, scoreDelta, newScore, compressed: compressible });

    const event = (await this.relationshipRepository.getLatestEvent(saveId, fromNodeId, toNodeId))!;
    const state = (await this.relationshipRepository.getState(saveId, fromNodeId, toNodeId))!;
    return { event, state };
  }

  /**
   * 查询元素 A 对元素 B 的当前关系状态。
   */
  async getRelationship(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<{ currentScore: number; effectiveNote?: string; effectiveSource: RelationshipSource; lastUpdated: number } | null> {
    const fromNodeId = await this.tryGetNodeId(saveId, observerType, observerId);
    const toNodeId = await this.tryGetNodeId(saveId, targetType, targetId);
    if (!fromNodeId || !toNodeId) return null;

    const state = await this.relationshipRepository.getState(saveId, fromNodeId, toNodeId);
    if (!state) return null;
    return {
      currentScore: state.currentScore,
      ...(state.effectiveNote !== undefined ? { effectiveNote: state.effectiveNote } : {}),
      effectiveSource: state.effectiveSource,
      lastUpdated: state.lastUpdated,
    };
  }

  /**
   * 查询 A 对 B 的 relationship 变更历史（全部事件，按时间正序）。
   */
  async getRelationshipHistory(
    saveId: string,
    observerType: EntityType, observerId: string,
    targetType: EntityType, targetId: string,
  ): Promise<EntityRelationshipEvent[]> {
    const fromNodeId = await this.tryGetNodeId(saveId, observerType, observerId);
    const toNodeId = await this.tryGetNodeId(saveId, targetType, targetId);
    if (!fromNodeId || !toNodeId) return [];
    return this.relationshipRepository.getHistory(saveId, fromNodeId, toNodeId);
  }

  /**
   * 批量查询多个 A 对 B 的当前认识（消除 N+1，供 information-boundary-layer 使用）。
   *
   * @param observerIds 多个认识者的 entity_id 列表（已由 ServiceTool 解析 name → entity_id）
   * @param targetType/targetId 目标元素 B
   */
  async getAwarenessBatch(
    saveId: string,
    observerType: EntityType, observerIds: string[],
    targetType: EntityType, targetId: string,
  ): Promise<Array<{ observerId: string; currentScore: number; effectiveNote?: string }>> {
    const toNodeId = await this.tryGetNodeId(saveId, targetType, targetId);
    if (!toNodeId) return [];

    // 为每个 observerId 解析 node ID
    const observerNodeIds: Array<{ observerId: string; nodeId: string }> = [];
    for (const observerId of observerIds) {
      const fromNodeId = await this.tryGetNodeId(saveId, observerType, observerId);
      if (fromNodeId) observerNodeIds.push({ observerId, nodeId: fromNodeId });
    }
    if (observerNodeIds.length === 0) return [];

    // 批量查询 states
    const states = await this.awarenessRepository.getStatesBatch(
      saveId,
      observerNodeIds.map(o => o.nodeId),
      toNodeId,
    );
    const stateByObserver = new Map(states.map(s => [s.observerNodeId, s]));

    const result: Array<{ observerId: string; currentScore: number; effectiveNote?: string }> = [];
    for (const { observerId, nodeId } of observerNodeIds) {
      const state = stateByObserver.get(nodeId);
      if (state) {
        result.push({
          observerId,
          currentScore: state.currentScore,
          ...(state.effectiveNote !== undefined ? { effectiveNote: state.effectiveNote } : {}),
        });
      }
    }
    return result;
  }

  /**
   * 查询 A 对所有其他元素的当前认识（业务查询，模块4 协同）。
   * 返回 A 作为 observer 的所有 awareness states。
   */
  async getEntityAwareness(
    saveId: string,
    observerType: EntityType, observerId: string,
  ): Promise<Array<{ targetId: string; targetType: string; currentScore: number; effectiveNote?: string }>> {
    const fromNodeId = await this.tryGetNodeId(saveId, observerType, observerId);
    if (!fromNodeId) return [];

    // awarenessRepository 没有按 observer 批量查所有 target 的方法，复用图查询找出 A 的所有 PERCEIVES 出边
    // 然后 states 表批量查
    const edges = await this.repository.getPerceivesEdges(saveId, fromNodeId, undefined);
    if (edges.length === 0) return [];

    // states 表按 observer 单查每个 target（避免新增 Repository 方法，复用 getState）
    const results: Array<{ targetId: string; targetType: string; currentScore: number; effectiveNote?: string }> = [];
    for (const edge of edges) {
      const state = await this.awarenessRepository.getState(saveId, fromNodeId, edge.toNodeId);
      if (state) {
        results.push({
          targetId: edge.toNodeId,
          targetType: this.parseTypeFromNodeId(edge.toNodeId),
          currentScore: state.currentScore,
          ...(state.effectiveNote !== undefined ? { effectiveNote: state.effectiveNote } : {}),
        });
      }
    }
    return results;
  }

  /**
   * 查询对指定主题有 awareness 记录的 observer 数量（current_score >= minScore）。
   * 用于 StoryKernel.assessInfoSpreadFactor 计算信息扩散度（紧张度引擎 info 因子）。
   */
  async countAwarenessByTopic(
    saveId: string,
    topicType: EntityType,
    topicId: string,
  ): Promise<number> {
    const topicNodeId = await this.tryGetNodeId(saveId, topicType, topicId);
    if (!topicNodeId) return 0;
    return this.awarenessRepository.countObserversByTargetAndScore(
      saveId,
      topicNodeId,
      { minScore: 1 },
    );
  }

  // === 006 升级辅助方法 ===

  /**
   * 判断 awareness 事件是否可压缩（R1-R4 规则）。
   *
   * R1. 同 source.type 且都是 auto: 开头
   * R2. delta 绝对值 < 3（非关键转折）
   * R3. source.type !== 'informed_by'（保留 informed_by）
   * R4. source.type 不以 auto: 开头时永远不压缩（保留 GM 手动事件）
   */
  private isAwarenessCompressible(
    lastEvent: EntityAwarenessEvent | null,
    incomingSource: AwarenessSource,
    incomingDelta: number,
  ): boolean {
    if (!lastEvent) return false;
    // R4: 仅 auto 类型可压缩
    if (!lastEvent.source.type.startsWith('auto:')) return false;
    if (!incomingSource.type.startsWith('auto:')) return false;
    // R1: 同 source.type
    if (lastEvent.source.type !== incomingSource.type) return false;
    // R1: 同符号（同为正或同为负）
    if (Math.sign(lastEvent.scoreDelta) !== Math.sign(incomingDelta)) return false;
    // R3: informed_by 不压缩（虽已通过 R4 排除，但显式声明）
    if (lastEvent.source.type === 'informed_by') return false;
    // R2: delta 绝对值 < 3（非关键转折）
    if (Math.abs(incomingDelta) >= 3) return false;
    return true;
  }

  /**
   * 判断 relationship 事件是否可压缩。
   * relationship 不含 auto:xxx 类型，永远返回 false（保留全部 GM 手动事件）。
   */
  private isRelationshipCompressible(
    _lastEvent: EntityRelationshipEvent | null,
    _incomingSource: RelationshipSource,
    _incomingDelta: number,
  ): boolean {
    return false;
  }

  /**
   * 数值边界保护：clamp 到 [-10, +10]。
   */
  private clampScore(score: number): number {
    return Math.max(-10, Math.min(10, score));
  }

  /**
   * 校验节点存在性并返回 node ID（§13.3 归属保守处理：缺失抛错，禁止 fallback）。
   * 节点存在即代表归属有效（节点由领域 Service 创建时携带 owner_type/owner_id）。
   */
  private async requireNodeExists(
    saveId: string,
    entityType: EntityType,
    entityId: string,
    role: 'observer' | 'target',
  ): Promise<string> {
    const node = await this.repository.getNode(saveId, entityType, entityId);
    if (!node) {
      throw new Error(`PERCEIVES 边 ${role} 节点不存在: entityType=${entityType}, entityId=${entityId}, saveId=${saveId}`);
    }
    return node.id;
  }

  /**
   * 尝试获取节点 ID，不存在时返回 null（get 操作不抛错）。
   */
  private async tryGetNodeId(
    saveId: string,
    entityType: EntityType,
    entityId: string,
  ): Promise<string | null> {
    const node = await this.repository.getNode(saveId, entityType, entityId);
    return node?.id ?? null;
  }

  /**
   * 从 node ID 解析 entityType。
   * node ID 格式：egn_{type}_{saveId}_{entityId}（由 buildEntityNodeId 生成）
   */
  private parseTypeFromNodeId(nodeId: string): string {
    const parts = nodeId.split('_');
    return parts[1] ?? 'unknown';
  }

  async createSnapshot(
    saveId: string,
    type: 'baseline' | 'chapter',
    chapterNumber?: number,
    deltaFromId?: string,
    addedNodeIds?: string[],
    removedNodeIds?: string[],
    addedEdgeIds?: string[],
    removedEdgeIds?: string[],
  ): Promise<string> {
    const id = await this.repository.createSnapshot(saveId, type, chapterNumber, deltaFromId, addedNodeIds, removedNodeIds, addedEdgeIds, removedEdgeIds);
    this.logger.info('Snapshot created', { saveId, type, chapterNumber, id });
    return id;
  }

  async getSnapshot(saveId: string, snapshotId: string): Promise<GraphSnapshot | null> {
    return this.repository.getSnapshot(saveId, snapshotId);
  }

  async getLatestSnapshot(saveId: string): Promise<GraphSnapshot | null> {
    return this.repository.getLatestSnapshot(saveId);
  }

  // === 非 IEntityGraphProvider 方法（routes/dev.ts + StoryKernel.EntityGraphPort 消费） ===

  async getAllSnapshots(saveId: string): Promise<GraphSnapshot[]> {
    return this.repository.getAllSnapshots(saveId);
  }

  async getWorldStateSummary(saveId: string): Promise<{
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
    edgesByRelation: Record<string, number>;
    snapshotCount: number;
  }> {
    return this.repository.getWorldStateSummary(saveId);
  }

  // === 模块4：业务聚合查询方法 ===

  /**
   * 查询实体的所有关系（含 -10~+10 关系值/认识值）。
   *
   * 区分结构性关系（程序派生，无 scores）和感知关系（LLM 管理，含 scores）。
   * 006 升级：awareness/relationship 数据从 PERCEIVES 边 properties 迁移到独立 states 表。
   * 一次 getEdges 查询 + 内存分类，避免 N+1。感知数据按需从 states 表查。
   *
   * @param entityId 已由 ServiceTool.resolveEntityRef 解析为真实 entity_id
   */
  async getEntityRelations(
    saveId: string,
    entityType: EntityType,
    entityId: string,
    options?: {
      relationType?: RelationType;
      direction?: 'outgoing' | 'incoming' | 'both';
    },
  ): Promise<{
    structuralRelations: Array<{ targetId: string; targetType: string; relation: RelationType }>;
    perceptions: Array<{
      targetId: string;
      targetType: string;
      currentRelationshipScore?: number;
      relationshipNote?: string;
      currentAwarenessScore?: number;
      awarenessNote?: string;
    }>;
  }> {
    const node = await this.repository.getNode(saveId, entityType, entityId);
    if (!node) {
      throw new Error(`实体不存在: entityType=${entityType}, entityId=${entityId}, saveId=${saveId}`);
    }

    const direction = options?.direction ?? 'both';
    const relationFilter = options?.relationType;

    // 查询边（getEdges 已按 from/to 双向查并去重）
    const allEdges = await this.repository.getEdges(saveId, node.id);

    // 一次 getFullGraph 获取所有节点（用于 toNodeId → entityType/entityId 反查）
    const fullGraph = await this.getFullGraph(saveId);
    const nodeById = new Map<string, EntityNode>(fullGraph.nodes.map(n => [n.id, n]));

    const structuralRelations: Array<{ targetId: string; targetType: string; relation: RelationType }> = [];
    const perceptions: Array<{
      targetId: string;
      targetType: string;
      currentRelationshipScore?: number;
      relationshipNote?: string;
      currentAwarenessScore?: number;
      awarenessNote?: string;
    }> = [];

    for (const edge of allEdges) {
      // 方向过滤
      if (direction === 'outgoing' && edge.fromNodeId !== node.id) continue;
      if (direction === 'incoming' && edge.toNodeId !== node.id) continue;

      // 关系类型过滤
      if (relationFilter && edge.relation !== relationFilter) continue;

      // 确定目标节点（按方向）
      const targetNodeId = edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId;
      const targetNode = nodeById.get(targetNodeId);
      if (!targetNode) continue; // 过滤已删除实体的残留边

      const targetId = targetNode.entityId;
      const targetType = targetNode.entityType;

      if (edge.relation === 'PERCEIVES') {
        // 感知关系（仅出边有效，入边不算 observer 的感知）
        if (edge.fromNodeId !== node.id) continue;
        // 006 升级：从独立 states 表读取当前状态
        const [awarenessState, relationshipState] = await Promise.all([
          this.awarenessRepository.getState(saveId, node.id, targetNodeId),
          this.relationshipRepository.getState(saveId, node.id, targetNodeId),
        ]);
        if (!awarenessState && !relationshipState) continue;
        perceptions.push({
          targetId,
          targetType,
          ...(relationshipState ? { currentRelationshipScore: relationshipState.currentScore } : {}),
          ...(relationshipState?.effectiveNote !== undefined ? { relationshipNote: relationshipState.effectiveNote } : {}),
          ...(awarenessState ? { currentAwarenessScore: awarenessState.currentScore } : {}),
          ...(awarenessState?.effectiveNote !== undefined ? { awarenessNote: awarenessState.effectiveNote } : {}),
        });
      } else {
        // 结构性关系
        structuralRelations.push({ targetId, targetType, relation: edge.relation });
      }
    }

    return { structuralRelations, perceptions };
  }

  /**
   * 查询 NPC 完整画像（一次查询消除 N+1）。
   *
   * 聚合：NPC 基础信息（INPCService）+ 结构性关系 + 感知关系（含 -10~+10 scores）。
   * 跨领域端口接口注入（§7.1），npcService 缺失时抛错。
   *
   * @param npcId 已由 ServiceTool.resolveEntityRef 解析为真实 entity_id
   */
  async getNpcProfile(
    saveId: string,
    npcId: string,
  ): Promise<{
    npc: { id: string; name: string; type: string; location?: string; customData?: Record<string, unknown> };
    structuralRelations: Array<{ targetId: string; targetType: string; relation: RelationType }>;
    perceptions: Array<{
      targetId: string;
      targetType: string;
      currentRelationshipScore?: number;
      relationshipNote?: string;
      currentAwarenessScore?: number;
      awarenessNote?: string;
    }>;
  }> {
    if (!this.npcService) {
      throw new Error('EntityGraphService.getNpcProfile requires INPCService injection (npcService is null)');
    }

    // 跨领域查询 NPC 基础信息（端口接口注入，§7.1）
    const npcProfile: NPCProfile = await this.npcService.getNPC(saveId, npcId);

    // 聚合图关系（复用 getEntityRelations）
    const relations = await this.getEntityRelations(saveId, 'npc', npcId);

    return {
      npc: {
        id: npcProfile.id,
        name: npcProfile.name,
        type: 'npc',
        ...(npcProfile.locationId ? { location: npcProfile.locationId } : {}),
      },
      structuralRelations: relations.structuralRelations,
      perceptions: relations.perceptions,
    };
  }

  /**
   * 查询地点概览（NPC + 物品 + 子地点 + 连接）。
   *
   * 聚合：地点基础信息（IMapService）+ 地点下实体（图查询）+ 子地点 + 连接。
   * 跨领域端口接口注入（§7.1），mapService 缺失时抛错。
   *
   * @param locationId 已由 ServiceTool.resolveEntityRef 解析为真实 entity_id
   */
  async getLocationSummary(
    saveId: string,
    locationId: string,
    includeDescendants: boolean = false,
  ): Promise<{
    location: { id: string; name: string; type: string };
    npcs: Array<{ id: string; name: string; role?: string }>;
    items: Array<{ id: string; name: string; type: string }>;
    subLocations: Array<{ id: string; name: string }>;
    connections: Array<{ targetLocationId: string; targetName: string }>;
  }> {
    if (!this.mapService) {
      throw new Error('EntityGraphService.getLocationSummary requires IMapService injection (mapService is null)');
    }

    // 跨领域查询地点基础信息（端口接口注入，§7.1）
    const location: LocationData = await this.mapService.getLocation(locationId, saveId);

    // 图查询：获取地点节点的所有关系
    const relations = await this.getEntityRelations(saveId, 'location', locationId);

    const npcs: Array<{ id: string; name: string; role?: string }> = [];
    const items: Array<{ id: string; name: string; type: string }> = [];
    const subLocations: Array<{ id: string; name: string }> = [];
    const connections: Array<{ targetLocationId: string; targetName: string }> = [];

    // 一次 getFullGraph 获取所有节点（用于 targetId → label 反查）
    const fullGraph = await this.getFullGraph(saveId);
    const nodeByEntityId = new Map<string, EntityNode>();
    for (const n of fullGraph.nodes) {
      nodeByEntityId.set(`${n.entityType}:${n.entityId}`, n);
    }

    for (const rel of relations.structuralRelations) {
      const targetNode = nodeByEntityId.get(`${rel.targetType}:${rel.targetId}`);
      if (!targetNode) continue;

      switch (rel.relation) {
        case 'LOCATED_AT':
          if (rel.targetType === 'npc') {
            npcs.push({ id: rel.targetId, name: targetNode.label });
          } else if (rel.targetType === 'item') {
            items.push({ id: rel.targetId, name: targetNode.label, type: 'item' });
          }
          break;
        case 'CONNECTED_TO':
          connections.push({ targetLocationId: rel.targetId, targetName: targetNode.label });
          break;
        default:
          // 其他结构性关系（如 OWNS）不在地点概览中展示
          break;
      }
    }

    // 子地点查询：通过 IMapService 获取（递归层级由 mapService 管理）
    if (includeDescendants) {
      const childIds = await this.mapService.getChildLocationIds(saveId, locationId);
      for (const childId of childIds) {
        const childNode = nodeByEntityId.get(`location:${childId}`);
        if (childNode) {
          subLocations.push({ id: childId, name: childNode.label });
        }
      }
    }

    return {
      location: { id: location.id, name: location.name, type: 'location' },
      npcs,
      items,
      subLocations,
      connections,
    };
  }
}
