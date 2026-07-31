/**
 * entity_graph 节点/边主键 id 构造单一数据源（跨层共享）。
 *
 * 从 game-systems/entity-graph/node-id.ts 迁移至 shared/utils/，
 * 使 Agent 核心 G 层也能 value-import 使用，消除 5 文件 18 处内联重复。
 * 纯函数，零依赖。
 */

/**
 * 构造 entity_graph_nodes 主键 id。
 * 格式: egn_{entityType}_{saveId}_{entityId}
 */
export function buildEntityNodeId(
  entityType: string,
  saveId: string,
  entityId: string,
): string {
  return `egn_${entityType}_${saveId}_${entityId}`;
}

/**
 * 构造 entity_graph_edges 主键 id。
 * 格式: ege_{fromNodeId}_{relation}_{toNodeId}
 */
export function buildEntityEdgeId(
  fromNodeId: string,
  relation: string,
  toNodeId: string,
): string {
  return `ege_${fromNodeId}_${relation}_${toNodeId}`;
}
