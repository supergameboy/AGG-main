/**
 * quest/ 模块桶导出（S3-1 Phase B Repository 模式重构）。
 *
 * 导出内容:
 * - Service: QuestService（9 参数构造，Repository + 跨领域端口 + 事务管理）
 * - ServiceTool: QuestServiceTool（组合根，createQuestService 工厂方法）
 * - Repository: QuestRepository（quests 表）+ QuestObjectiveRepository（quest_objectives 表）
 * - 端口接口: IQuestRepository + IQuestObjectiveRepository + IQuestService
 * - 共享映射: rowToQuest + rowToObjective + questToRow + objectiveToRow
 * - 实体类型: Quest + QuestObjective + QuestDetail + CreateQuestInput + QuestChainInfo
 *   + 从 shared 重导出的 QuestReward + QuestConditions + EventTrigger + QuestType + QuestStatus + ObjectiveType
 */

// Service + ServiceTool
export { QuestService } from './QuestService.js';
export { QuestServiceTool } from './QuestServiceTool.js';

// Repository
export { QuestRepository } from './QuestRepository.js';
export { QuestObjectiveRepository } from './QuestObjectiveRepository.js';

// 共享映射函数（供消费方共享 row ↔ entity 转换）
export { rowToQuest, rowToObjective, questToRow, objectiveToRow } from './mappers.js';

// 端口接口 + 实体类型
export type {
  IQuestRepository,
  IQuestObjectiveRepository,
  IQuestService,
  Quest,
  QuestObjective,
  QuestDetail,
  CreateQuestInput,
  QuestChainInfo,
  QuestReward,
  QuestConditions,
  QuestCondition,
  EventTrigger,
  QuestType,
  QuestStatus,
  ObjectiveType,
} from './types.js';
