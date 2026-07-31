import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import { buildEntityNodeId, buildEntityEdgeId } from '@ai-rpg/shared/utils/entity-graph-id';
import type {
  IEntityGraphRepository,
  EntityType,
  RelationType,
  EntityNode,
  EntityEdge,
  EntitySubgraph,
  GraphSnapshot,
  EntityGraphNodeRow,
  EntityGraphEdgeRow,
  EntityGraphSnapshotRow,
} from './types.js';

/**
 * EntityGraph Repository 完整实现（S5 + 模块3 简化 + 006 升级）。
 *
 * 操作 3 张强耦合表：entity_graph_nodes / entity_graph_edges / entity_graph_snapshots。
 * 模块3 简化：删除 information_boundaries 表访问，PERCEIVES 感知数据统一存储在 entity_graph_edges.properties。
 * 006 升级：PERCEIVES 边的 awareness/relationship 字段迁移到独立表（entity_awareness_events/states
 *   + entity_relationship_events/states），由 AwarenessRepository/RelationshipRepository 管理。
 *   EntityGraphRepository.getPerceivesEdges 仅返回 PERCEIVES 边结构性元数据（from/to/relation/weight/properties.lastUpdated）。
 *
 * 设计依据：L0-1 方案A（单一 Repository 扩展），3 表强耦合，事务边界单一。
 * 不继承 BaseRepository：操作多张表，不符合 BaseRepository 单表约束。
 * 手动持有 db: Knex，所有方法支持 trx? 可选参数（D9）。
 *
 * Row 类型单一化（§9.2）：JSON 字段在 Row 中声明为 string，rowToXxx 负责 JSON.parse。
 * 消费方接收的是已解析的 entity，不接触原始 row。
 */
export class EntityGraphRepository implements IEntityGraphRepository {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    const query = trx ?? this.db;
    // EG-M1-7: 显式删除 3 张表（原实现仅删 edges + nodes，遗漏 snapshots）
    // 虽 3 表均有 FK(save_id) → saves(id) ON DELETE CASCADE，显式删除更安全：
    // 1. rollbackSave 在事务内执行，CASCADE 依赖 saves 删除（事务末尾），中途失败无法触发 CASCADE
    // 2. 显式删除确保事务内原子性，不依赖隐式 CASCADE 时序
    // 3. 删除顺序按 FK 依赖：edges（依赖 nodes）→ nodes → snapshots（独立）
    // 006 升级：awareness/relationship 数据在独立表（awareness/relationship events+states），
    //   由 AwarenessRepository/RelationshipRepository 各自的 deleteBySaveId 清理，不在此处处理
    await query('entity_graph_edges').where({ save_id: saveId }).del();
    await query('entity_graph_nodes').where({ save_id: saveId }).del();
    await query('entity_graph_snapshots').where({ save_id: saveId }).del();
  }

  // === Node CRUD ===

  async upsertNode(saveId: string, type: EntityType, entityId: string, label: string, properties?: Record<string, unknown>, trx?: Knex.Transaction): Promise<string> {
    const query = trx ?? this.db;
    const id = buildEntityNodeId(type, saveId, entityId);
    const now = Date.now();
    const props = properties ?? {};

    await query('entity_graph_nodes')
      .insert({
        id, save_id: saveId, entity_type: type, entity_id: entityId,
        label, properties: JSON.stringify(props), created_at: now, updated_at: now,
      })
      .onConflict(['save_id', 'entity_type', 'entity_id'])
      .merge(['label', 'properties', 'updated_at']);

    return id;
  }

  async getNode(saveId: string, type: EntityType, entityId: string, trx?: Knex.Transaction): Promise<EntityNode | null> {
    const query = trx ?? this.db;
    const row = await query('entity_graph_nodes')
      .where({ save_id: saveId, entity_type: type, entity_id: entityId })
      .first();
    return row ? this.rowToNode(row) : null;
  }

  async getNodesByType(saveId: string, type: EntityType, trx?: Knex.Transaction, limit?: number): Promise<EntityNode[]> {
    const query = trx ?? this.db;
    // 候选按 created_at DESC 排序（最新创建的在前），可选 limit 限制数量
    let qb = query('entity_graph_nodes')
      .where({ save_id: saveId, entity_type: type })
      .orderBy('created_at', 'desc')
      .select('*');
    if (limit !== undefined) qb = qb.limit(limit);
    const rows = await qb;
    return rows.map((row: EntityGraphNodeRow) => this.rowToNode(row));
  }

  /**
   * 仅按 label 匹配节点（13.2 name/id 兼容的 name 阶段使用）。
   *
   * 与 findNodeByEntityIdOrLabel 区别：
   * - findNodeByEntityIdOrLabel: 两阶段匹配（entity_id + label），多结果抛错
   * - findNodesByLabel: 仅 label 匹配，返回所有匹配项（可能多个），由调用方消歧
   *
   * 供 EntityGraphResolver.findByName 使用——EntityResolverBase.resolve 阶段1 已通过 findById
   * 执行 entity_id 精确匹配，阶段2 findByName 调用此方法仅按 label 匹配，避免重复 entity_id 查询。
   */
  async findNodesByLabel(saveId: string, entityType: EntityType, label: string, trx?: Knex.Transaction): Promise<EntityNode[]> {
    const query = trx ?? this.db;
    const rows = await query('entity_graph_nodes')
      .where({ save_id: saveId, entity_type: entityType, label })
      .select('*');
    return rows.map((row: EntityGraphNodeRow) => this.rowToNode(row));
  }

  async getNodesByLocation(saveId: string, locationId: string, options?: { includeDescendants?: boolean; nodeTypeFilter?: string[] }, trx?: Knex.Transaction): Promise<EntityNode[]> {
    const query = trx ?? this.db;
    const locationNodeId = buildEntityNodeId('location', saveId, locationId);
    const locationIds = new Set<string>([locationNodeId]);

    // BFS：递归收集子地点（BELONGS_TO 边指向父，from_node_id 是子地点）
    if (options?.includeDescendants) {
      const queue = [locationNodeId];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const childEdges = await query('entity_graph_edges')
          .where({ save_id: saveId, relation: 'BELONGS_TO', to_node_id: currentId })
          .select('from_node_id');

        for (const edge of childEdges) {
          const childId = edge.from_node_id as string;
          if (!locationIds.has(childId)) {
            locationIds.add(childId);
            queue.push(childId);
          }
        }
      }
    }

    // LOCATED_AT 边的 to_node_id 是地点，from_node_id 是位于该地点的实体
    const locatedEdges = await query('entity_graph_edges')
      .where({ save_id: saveId, relation: 'LOCATED_AT' })
      .whereIn('to_node_id', Array.from(locationIds))
      .select('from_node_id');

    const nodeIds = locatedEdges.map((e: { from_node_id: string }) => e.from_node_id);
    if (nodeIds.length === 0) return [];

    let nodeQuery = query('entity_graph_nodes')
      .where({ save_id: saveId })
      .whereIn('id', nodeIds);

    if (options?.nodeTypeFilter && options.nodeTypeFilter.length > 0) {
      nodeQuery = nodeQuery.whereIn('entity_type', options.nodeTypeFilter);
    }

    const rows = await nodeQuery.select('*');
    return rows.map((row: EntityGraphNodeRow) => this.rowToNode(row));
  }

  /**
   * 按 entity_id 或 label 查找节点（13.2 name/id + 时间戳兼容）。
   *
   * 两阶段匹配：
   * 1. entity_id 精确匹配 → 命中即返回
   * 2. label 匹配（可能多个）→ 用 timestamp 消歧：
   *    - 优先匹配相同 created_at 时间戳
   *    - 匹配不到再匹配不同时间戳
   *    - 仍无法消歧抛错
   */
  async findNodeByEntityIdOrLabel(saveId: string, entityType: EntityType, entityIdOrLabel: string, timestamp?: number, trx?: Knex.Transaction): Promise<EntityNode | null> {
    const query = trx ?? this.db;

    // 阶段1: entity_id 精确匹配
    const byId = await query('entity_graph_nodes')
      .where({ save_id: saveId, entity_type: entityType, entity_id: entityIdOrLabel })
      .first();
    if (byId) return this.rowToNode(byId);

    // 阶段2: label 匹配
    const byLabel = await query('entity_graph_nodes')
      .where({ save_id: saveId, entity_type: entityType, label: entityIdOrLabel })
      .select('*');
    if (byLabel.length === 0) return null;
    if (byLabel.length === 1) return this.rowToNode(byLabel[0]);

    // 阶段3: 多结果时用 timestamp 消歧
    if (timestamp !== undefined) {
      const same = byLabel.filter((r: EntityGraphNodeRow) => r.created_at === timestamp);
      if (same.length === 1) return this.rowToNode(same[0]);
      if (same.length > 1) {
        throw new Error(`Multiple nodes matched by label with same timestamp: ${entityIdOrLabel}`);
      }
      const different = byLabel.filter((r: EntityGraphNodeRow) => r.created_at !== timestamp);
      if (different.length === 1) return this.rowToNode(different[0]);
      if (different.length > 1) {
        throw new Error(`Multiple nodes matched by label with different timestamp: ${entityIdOrLabel}`);
      }
      return null;
    }

    throw new Error(`Multiple nodes matched by label without timestamp: ${entityIdOrLabel}`);
  }

  // === Edge CRUD ===

  async upsertEdge(saveId: string, fromNodeId: string, relation: RelationType, toNodeId: string, weight?: number, properties?: Record<string, unknown>, trx?: Knex.Transaction): Promise<string> {
    const query = trx ?? this.db;
    const id = buildEntityEdgeId(fromNodeId, relation, toNodeId);
    const now = Date.now();
    const w = weight ?? 1.0;
    const props = properties ?? {};

    await query('entity_graph_edges')
      .insert({
        id, save_id: saveId, from_node_id: fromNodeId, to_node_id: toNodeId,
        relation, weight: w, properties: JSON.stringify(props), created_at: now, updated_at: now,
      })
      .onConflict(['save_id', 'from_node_id', 'relation', 'to_node_id'])
      .merge(['weight', 'properties', 'updated_at']);

    return id;
  }

  async getEdges(saveId: string, nodeId: string, trx?: Knex.Transaction): Promise<EntityEdge[]> {
    const query = trx ?? this.db;
    // 拆分为两个显式 where(object) 查询，避免 where(callback)/orWhere 在
    // StagingKnex 中 conditions 不被追踪导致 ShadowState 读取范围错误放大
    // （会返回当前 save 内所有边而非仅与 nodeId 相连的边）。
    const fromRows = await query('entity_graph_edges')
      .where({ save_id: saveId, from_node_id: nodeId })
      .select('*');
    const toRows = await query('entity_graph_edges')
      .where({ save_id: saveId, to_node_id: nodeId })
      .select('*');
    // 按 edge.id 去重（自环边或一对节点互相引用时两次查询可能同时命中）
    const seen = new Set<string>();
    const edges: EntityEdge[] = [];
    for (const row of [...fromRows, ...toRows] as EntityGraphEdgeRow[]) {
      const edge = this.rowToEdge(row);
      if (!seen.has(edge.id)) {
        seen.add(edge.id);
        edges.push(edge);
      }
    }
    return edges;
  }

  async getEdgesByRelation(saveId: string, relation: RelationType, trx?: Knex.Transaction): Promise<EntityEdge[]> {
    const query = trx ?? this.db;
    const rows = await query('entity_graph_edges')
      .where({ save_id: saveId, relation })
      .select('*');
    return rows.map((row: EntityGraphEdgeRow) => this.rowToEdge(row));
  }

  /**
   * 按 entity_id 或 label 查找节点 ID（13.2 name/id + 时间戳兼容）。
   * 两阶段匹配逻辑同 findNodeByEntityIdOrLabel，但返回 node ID。
   */
  async findNodeIdByEntityIdOrLabel(saveId: string, entityIdOrLabel: string, timestamp?: number, trx?: Knex.Transaction): Promise<string | null> {
    const query = trx ?? this.db;

    // 阶段1: entity_id 精确匹配
    const byId = await query('entity_graph_nodes')
      .where({ save_id: saveId, entity_id: entityIdOrLabel })
      .first();
    if (byId) return byId.id as string;

    // 阶段2: label 匹配
    const byLabel = await query('entity_graph_nodes')
      .where({ save_id: saveId, label: entityIdOrLabel })
      .select('*');
    if (byLabel.length === 0) return null;
    if (byLabel.length === 1) return byLabel[0].id as string;

    // 阶段3: 多结果时用 timestamp 消歧
    if (timestamp !== undefined) {
      const same = byLabel.filter((r: EntityGraphNodeRow) => r.created_at === timestamp);
      if (same.length === 1) return same[0].id as string;
      if (same.length > 1) {
        throw new Error(`Multiple nodes matched by label with same timestamp: ${entityIdOrLabel}`);
      }
      const different = byLabel.filter((r: EntityGraphNodeRow) => r.created_at !== timestamp);
      if (different.length === 1) return different[0].id as string;
      if (different.length > 1) {
        throw new Error(`Multiple nodes matched by label with different timestamp: ${entityIdOrLabel}`);
      }
      return null;
    }

    throw new Error(`Multiple nodes matched by label without timestamp: ${entityIdOrLabel}`);
  }

  // === Graph 查询 ===

  /**
   * 获取以 centerNodeId 为中心、depth 层深度的子图（EG-M3-4 修复 N+1 查询）。
   *
   * 修改前：BFS 内层为每个节点单独查 row（N+1 查询）
   * 修改后：按层批量查询
   *   - 第 0 层：查 centerNode（1 次查询）
   *   - 第 1-N 层：
   *     - 批量查边：whereIn('from_node_id', currentLevelNodeIds) + whereIn('to_node_id', ...)（2 次/层，拆分避免 StagingKnex 条件丢失）
   *     - 批量查节点：whereIn('id', nextLevelNodeIds)（1 次/层）  ← 修复 N+1
   *
   * 总查询次数：O(depth)（修改前为 O(nodes)）
   *
   * 注意：centerNodeId 可能不存在于 DB（首次访问未持久化的节点），此时返回空图。
   */
  async getSubgraph(saveId: string, centerNodeId: string, depth: number, trx?: Knex.Transaction): Promise<EntitySubgraph> {
    const query = trx ?? this.db;
    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const nodes: EntityNode[] = [];
    const edges: EntityEdge[] = [];

    // 第 0 层：查中心节点（1 次查询）
    const centerRow = await query('entity_graph_nodes')
      .where({ id: centerNodeId, save_id: saveId })
      .first();
    if (!centerRow) return { nodes: [], edges: [] };
    nodes.push(this.rowToNode(centerRow));
    visitedNodes.add(centerNodeId);

    let currentLevelNodeIds: string[] = [centerNodeId];

    // BFS：按层批量查询（depth=0 时仅返回中心节点）
    for (let d = 0; d < depth; d++) {
      if (currentLevelNodeIds.length === 0) break;

      // 批量查边：拆分为两个显式 where(object) + whereIn 查询，避免 where(callback)/orWhereIn
      // 在 StagingKnex 中 conditions 不被追踪导致 ShadowState 读取范围错误放大
      // （会返回当前 save 内所有边而非仅与当前层节点相连的边）。
      // 现有 visitedEdges 检查负责按 edge.id 去重，无需额外去重逻辑。
      const fromEdgeRows = await query('entity_graph_edges')
        .where({ save_id: saveId })
        .whereIn('from_node_id', currentLevelNodeIds)
        .select('*');
      const toEdgeRows = await query('entity_graph_edges')
        .where({ save_id: saveId })
        .whereIn('to_node_id', currentLevelNodeIds)
        .select('*');
      const levelEdgeRows = [...fromEdgeRows, ...toEdgeRows];

      // 收集新边 + 下一层节点 ID
      const nextLevelNodeIds: string[] = [];
      for (const edgeRow of levelEdgeRows) {
        const edge = this.rowToEdge(edgeRow);
        if (!visitedEdges.has(edge.id)) {
          edges.push(edge);
          visitedEdges.add(edge.id);
          if (!visitedNodes.has(edge.toNodeId)) nextLevelNodeIds.push(edge.toNodeId);
          if (!visitedNodes.has(edge.fromNodeId)) nextLevelNodeIds.push(edge.fromNodeId);
        }
      }

      if (nextLevelNodeIds.length === 0) break;

      // 批量查节点：whereIn（1 次查询/层）← 修复 N+1
      const nextNodeRows = await query('entity_graph_nodes')
        .where({ save_id: saveId })
        .whereIn('id', nextLevelNodeIds);

      const newVisitedIds: string[] = [];
      for (const nodeRow of nextNodeRows) {
        const node = this.rowToNode(nodeRow);
        if (!visitedNodes.has(node.id)) {
          nodes.push(node);
          visitedNodes.add(node.id);
          newVisitedIds.push(node.id);
        }
      }
      currentLevelNodeIds = newVisitedIds;
    }

    return { nodes, edges };
  }

  async getFullGraph(saveId: string, trx?: Knex.Transaction): Promise<EntitySubgraph> {
    const query = trx ?? this.db;
    const nodeRows = await query('entity_graph_nodes')
      .where({ save_id: saveId })
      .select('*');
    const edgeRows = await query('entity_graph_edges')
      .where({ save_id: saveId })
      .select('*');
    return {
      nodes: nodeRows.map((row: EntityGraphNodeRow) => this.rowToNode(row)),
      edges: edgeRows.map((row: EntityGraphEdgeRow) => this.rowToEdge(row)),
    };
  }

  // === PERCEIVES 感知边查询（模块3 新增） ===

  /**
   * 查询 PERCEIVES 边（LLM 管理的感知数据）。
   *
   * 支撑 Service 层 3 个查询方法：
   * - getAwareness(A, B)：fromNodeId=A, toNodeId=B
   * - getAwarenessBatch([A1,A2], B)：toNodeId=B + 内存过滤 fromNodeId
   * - getEntityAwareness(A)：fromNodeId=A
   *
   * 查询拆分策略（避免 StagingKnex 条件丢失）：
   * - 仅 fromNodeId：单次 where({ save_id, relation: 'PERCEIVES', from_node_id })
   * - 仅 toNodeId：单次 where({ save_id, relation: 'PERCEIVES', to_node_id })
   * - 两者都给：单次 where({ save_id, relation: 'PERCEIVES', from_node_id, to_node_id })
   * - 都不给：单次 where({ save_id, relation: 'PERCEIVES' })
   *
   * StagingKnex 兼容：使用显式 where(object)，避免 where(callback) 条件不被追踪。
   */
  async getPerceivesEdges(saveId: string, fromNodeId?: string, toNodeId?: string, trx?: Knex.Transaction): Promise<EntityEdge[]> {
    const query = trx ?? this.db;
    const where: Record<string, unknown> = { save_id: saveId, relation: 'PERCEIVES' };
    if (fromNodeId !== undefined) where.from_node_id = fromNodeId;
    if (toNodeId !== undefined) where.to_node_id = toNodeId;

    const rows = await query('entity_graph_edges')
      .where(where)
      .select('*');
    return rows.map((row: EntityGraphEdgeRow) => this.rowToEdge(row));
  }

  // === Snapshot ===

  async createSnapshot(
    saveId: string,
    type: 'baseline' | 'chapter',
    chapterNumber?: number,
    deltaFromId?: string,
    addedNodeIds?: string[],
    removedNodeIds?: string[],
    addedEdgeIds?: string[],
    removedEdgeIds?: string[],
    trx?: Knex.Transaction,
  ): Promise<string> {
    const query = trx ?? this.db;
    const nodesCount = (await query('entity_graph_nodes').where({ save_id: saveId }).count('id as count').first())!.count as number;
    const edgesCount = (await query('entity_graph_edges').where({ save_id: saveId }).count('id as count').first())!.count as number;

    const id = `egs_${saveId}_${type}_${Date.now()}`;
    const now = Date.now();

    await query('entity_graph_snapshots').insert({
      id,
      save_id: saveId,
      snapshot_type: type,
      chapter_number: chapterNumber ?? null,
      nodes_count: nodesCount,
      edges_count: edgesCount,
      delta_from_snapshot_id: deltaFromId ?? null,
      added_node_ids: addedNodeIds ? JSON.stringify(addedNodeIds) : null,
      removed_node_ids: removedNodeIds ? JSON.stringify(removedNodeIds) : null,
      added_edge_ids: addedEdgeIds ? JSON.stringify(addedEdgeIds) : null,
      removed_edge_ids: removedEdgeIds ? JSON.stringify(removedEdgeIds) : null,
      created_at: now,
    });

    return id;
  }

  async getSnapshot(saveId: string, snapshotId: string, trx?: Knex.Transaction): Promise<GraphSnapshot | null> {
    const query = trx ?? this.db;
    const row = await query('entity_graph_snapshots')
      .where({ id: snapshotId, save_id: saveId })
      .first();
    return row ? this.rowToSnapshot(row) : null;
  }

  async getLatestSnapshot(saveId: string, trx?: Knex.Transaction): Promise<GraphSnapshot | null> {
    const query = trx ?? this.db;
    const row = await query('entity_graph_snapshots')
      .where({ save_id: saveId })
      .orderBy('created_at', 'desc')
      .first();
    return row ? this.rowToSnapshot(row) : null;
  }

  async getAllSnapshots(saveId: string, trx?: Knex.Transaction): Promise<GraphSnapshot[]> {
    const query = trx ?? this.db;
    const rows = await query('entity_graph_snapshots')
      .where({ save_id: saveId })
      .orderBy('created_at', 'desc');
    return rows.map((row: EntityGraphSnapshotRow) => this.rowToSnapshot(row));
  }

  // === 聚合统计 ===

  async getWorldStateSummary(saveId: string, trx?: Knex.Transaction): Promise<{
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
    edgesByRelation: Record<string, number>;
    snapshotCount: number;
  }> {
    const query = trx ?? this.db;

    const nodeRows = await query('entity_graph_nodes')
      .where({ save_id: saveId })
      .select('entity_type');
    const edgeRows = await query('entity_graph_edges')
      .where({ save_id: saveId })
      .select('relation');
    const snapshotCount = (await query('entity_graph_snapshots')
      .where({ save_id: saveId })
      .count('id as count')
      .first())!.count as number;

    const nodesByType: Record<string, number> = {};
    for (const row of nodeRows) {
      const t = row.entity_type as string;
      nodesByType[t] = (nodesByType[t] ?? 0) + 1;
    }

    const edgesByRelation: Record<string, number> = {};
    for (const row of edgeRows) {
      const r = row.relation as string;
      edgesByRelation[r] = (edgesByRelation[r] ?? 0) + 1;
    }

    return {
      nodeCount: nodeRows.length,
      edgeCount: edgeRows.length,
      nodesByType,
      edgesByRelation,
      snapshotCount,
    };
  }

  // === Row → Entity 映射（3 个，从 EntityGraphService 迁移） ===
  // Row 类型单一化：JSON 字段在 Row 中为 string，rowToXxx 负责 JSON.parse。
  // 模块3 简化：删除 rowToBoundary（information_boundaries 表已废弃）

  private rowToNode(row: EntityGraphNodeRow): EntityNode {
    if (!row.id) {
      throw new Error(`EntityGraphRepository.rowToNode: invalid node id (empty), saveId=${row.save_id}, entityId=${row.entity_id}`);
    }
    // 边界防御：properties 为 null/undefined 时抛错（非 fallback），暴露数据完整性问题
    // 触发场景：DB 历史数据 NULL / ShadowState 派生写入缺失字段
    if (row.properties == null) {
      throw new Error(`EntityGraphRepository.rowToNode: invalid node properties (${row.properties}), nodeId=${row.id}`);
    }
    return {
      id: row.id,
      saveId: row.save_id,
      entityType: row.entity_type as EntityType,
      entityId: row.entity_id,
      label: row.label,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToEdge(row: EntityGraphEdgeRow): EntityEdge {
    if (!row.id) {
      throw new Error(`EntityGraphRepository.rowToEdge: invalid edge id (empty), saveId=${row.save_id}, fromNodeId=${row.from_node_id}, toNodeId=${row.to_node_id}`);
    }
    // 边界防御：properties 为 null/undefined 时抛错（非 fallback），暴露数据完整性问题
    // 触发场景：DB 历史数据 NULL / ShadowState 派生写入缺失字段
    if (row.properties == null) {
      throw new Error(`EntityGraphRepository.rowToEdge: invalid edge properties (${row.properties}), edgeId=${row.id}`);
    }
    return {
      id: row.id,
      saveId: row.save_id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      relation: row.relation as RelationType,
      weight: row.weight,
      properties: JSON.parse(row.properties),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToSnapshot(row: EntityGraphSnapshotRow): GraphSnapshot {
    return {
      id: row.id,
      saveId: row.save_id,
      snapshotType: row.snapshot_type as 'baseline' | 'chapter',
      chapterNumber: row.chapter_number,
      nodesCount: row.nodes_count,
      edgesCount: row.edges_count,
      deltaFromSnapshotId: row.delta_from_snapshot_id,
      addedNodeIds: row.added_node_ids ? JSON.parse(row.added_node_ids) : [],
      removedNodeIds: row.removed_node_ids ? JSON.parse(row.removed_node_ids) : [],
      addedEdgeIds: row.added_edge_ids ? JSON.parse(row.added_edge_ids) : [],
      removedEdgeIds: row.removed_edge_ids ? JSON.parse(row.removed_edge_ids) : [],
      createdAt: row.created_at,
    };
  }
}
