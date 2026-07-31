/**
 * entity-graph 模块桶导出（P4-S4 新建，S5 更新）
 *
 * 整合实体图子系统的全部公开类，消费方从此处统一导入。
 * 5 个类从 services/ 迁移至 game-systems/entity-graph/（P4-S4-c），
 * EntityGraphServiceTool 为原有文件。
 * S5 新增：EntityGraphRepository + types.ts 端口接口导出。
 *
 * 模块2 简化：删除 EntityGraphAuditor/EntityGraphRepairer 桶导出（文件已删除）。
 * 删除类型导出：GraphAuditIssue/IEntityGraphRepairer/IEntityGraphAuditor/
 * ExpectedNode/ExpectedEdge/ExpectedGraphState/GraphDiff（类型已删除）。
 *
 * 模块3 简化：删除 Fact/InformationBoundary/InformationBoundaryRow 导出（类型已删除，
 * 认识数据统一到 PERCEIVES 边的 EntityEdgeProperties）。新增 EntityEdgeProperties 导出。
 */
export { EntityGraphService } from './EntityGraphService.js';
export { EntityGraphRepository } from './EntityGraphRepository.js';
export { EntityGraphBuilder } from './EntityGraphBuilder.js';
export { EntityGraphUpdater } from './EntityGraphUpdater.js';
export { EntityGraphSnapshotManager } from './EntityGraphSnapshotManager.js';
export { EntityGraphServiceTool } from './EntityGraphServiceTool.js';
// EG-M3-8: 缓存层实现（桶导出新增）
export { EntityGraphCache, NullEntityGraphCache } from './EntityGraphCache.js';
// EG-M4-2: 定期纠错器（桶导出新增，模块2 简化为全量重建版）
export { EntityGraphReconciler } from './EntityGraphReconciler.js';

// S5 新增：端口接口 + Row 类型 + 跨领域 ReadPort + 领域类型（types.ts）
export type {
  IEntityGraphRepository,
  EntityGraphNodeRow,
  EntityGraphEdgeRow,
  EntityGraphSnapshotRow,
  ICharacterReadPort,
  INPCReadPort,
  // 模块2 简化：删除 INPCRelationReadPort 导出（npc_relations 表已删除）
  ILocationReadPort,
  ILocationConnectionReadPort,
  IInventoryReadPort,
  IQuestReadPort,
  IEventReadPort,
  IFactionReadPort,
  ICharacterSkillReadPort,
  INPCGoalReadPort,
  EntityGraphBuildContext,
  // S5 领域类型（从 EntityGraphService.ts 迁移到 types.ts，消除 type-level 循环依赖）
  EntityType,
  RelationType,
  EntityNode,
  EntityEdge,
  EntityEdgeProperties,
  EntitySubgraph,
  GraphSnapshot,
  // EG-M3-1: 缓存层端口接口
  IEntityGraphCache,
  // EG-M4-1: 纠错器端口接口 + 纠错结果（模块2 简化版，删除审计器/期望图/差异类型）
  IEntityGraphReconciler,
  ReconcileResult,
} from './types.js';
