/**
 * combat/ 模块桶导出（S3-2 完整 Repository 模式）。
 *
 * S3-2: combat_states 表 + combat_history 表分属两个 Repository（D7 一表一 Repository），
 * CombatService 通过 ICombatRepository + ICombatHistoryRepository 端口操作数据。
 * mappers.ts 是包内共享纯映射函数，不从桶导出（接口最小化）。
 */

export { CombatService } from './CombatService.js';
export { CombatServiceTool } from './CombatServiceTool.js';
export { CombatRepository } from './CombatRepository.js';
export { CombatHistoryRepository } from './CombatHistoryRepository.js';
export type {
  ICombatRepository,
  ICombatHistoryRepository,
  ICombatService,
  CombatStateRow,
  CombatHistoryInsertInput,
  CombatParticipant,
  EnemyTemplate,
  CombatAction,
  CombatState,
  CombatResult,
  TurnResult,
  StatusEffect,
  DamageBreakdown,
  CombatLogEntry,
  ParticipantResult,
} from './types.js';
