/**
 * npc/ 模块桶导出（S2-1 Repository 模式重构 + 模块2/3 简化）。
 *
 * 导出内容:
 * - Service: NPCService（implements INPCService）
 * - ServiceTool: NPCServiceTool（组合根，createNPCService 工厂方法）
 * - Repository: NPCRepository + NPCGoalRepository
 * - 端口接口: INPCRepository + INPCGoalRepository + INPCService
 * - 实体类型: NPCProfile + NPCGoal + PartyMember + NPCStatusPanel + NPCMemory + MoveResult + GoalCategory 等
 * - 共享映射: npcRowToProfile + npcGoalRowToGoal
 *
 * 模块2 简化：删除 NPCRelationRepository + INPCRelationRepository + NPCRelation + npcRelationRowToRelation
 * （关系数据由 EntityGraphService.setRelationship 通过 PERCEIVES 边维护，单一数据源）
 * 模块3 简化：删除 NPCKnowledge 类型导出（已迁移到 PERCEIVES 感知边）。
 */

// Service + ServiceTool
export { NPCService } from './NPCService.js';
export { NPCServiceTool } from './NPCServiceTool.js';

// Repository
export { NPCRepository } from './NPCRepository.js';
export { NPCGoalRepository } from './NPCGoalRepository.js';

// 共享映射函数（供消费方共享 row → entity 转换）
export { npcRowToProfile, npcGoalRowToGoal } from './mappers.js';

// 端口接口 + 实体类型
export type {
  INPCRepository,
  INPCGoalRepository,
  INPCService,
  NPCProfile,
  NPCVisibility,
  PartyMember,
  NPCStatusPanel,
  NPCMemory,
  MemoryCompressionResult,
  CompressOptions,
  DriveProfile,
  MoveResult,
  GoalCategory,
  NPCGoal,
} from './types.js';
