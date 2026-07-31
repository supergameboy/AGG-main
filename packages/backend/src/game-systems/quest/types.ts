import { ID, Timestamp } from '../../../../shared/src/types/core.js';
import { QuestReward, QuestConditions, EventTrigger } from '../../../../shared/src/types/game.js';
import type { QuestType, QuestStatus, ObjectiveType } from '../../../../shared/src/types/game.js';
import type { Knex } from 'knex';

export interface Quest {
  id: ID;
  saveId: ID;
  name: string;
  description: string;
  type: QuestType;
  status: QuestStatus;
  visible: boolean;
  prerequisiteQuestIds: string[];
  conditions?: QuestConditions;
  giverNpcId: string | null;
  giverLocationId: string | null;
  questChainId: string | null;
  rewards: QuestReward;
  timeLimit: number;
  customData: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface QuestObjective {
  id: ID;
  questId: ID;
  description: string;
  type: ObjectiveType;
  target: string;
  required: number;
  current: number;
  completed: boolean;
  eventTrigger?: EventTrigger;
}

export interface QuestDetail extends Quest {
  objectives: QuestObjective[];
  progressPercent: number;
  canComplete: boolean;
}

/**
 * 创建任务的业务输入。
 *
 * Phase C-F4 修订: 移除 saveId 字段。
 * saveId 作为上下文参数在 createQuest(saveId, input) 签名中传递，不在 input 中重复，
 * 与 QuestService 其他 19 个方法 `(saveId, ...)` 模式保持一致。
 * 对照 code-standards: §4.1 对称与一致 + §5.2 接口最小化 + §2.4 一个概念只表达一次。
 */
export interface CreateQuestInput {
  name: string;
  description?: string;
  type?: QuestType;
  visible?: boolean;
  giverNpcId?: string | null;
  giverLocationId?: string | null;
  questChainId?: string | null;
  prerequisiteQuestIds?: string[];
  conditions?: QuestConditions;
  rewards?: QuestReward;
  objectives?: Array<{
    description: string;
    type: ObjectiveType;
    target: string;
    required?: number;
    eventTrigger?: EventTrigger;
  }>;
}

export interface QuestChainInfo {
  questId: ID;
  name: string;
  status: QuestStatus;
  prerequisiteId: ID | null;
  prerequisiteName: string | null;
  prerequisiteCompleted: boolean;
  isUnlocked: boolean;
  prerequisites: Array<{ id: ID; name: string; completed: boolean }>;
}

// Re-export shared types for convenience
export type { QuestReward, QuestConditions, QuestCondition, EventTrigger, QuestType, QuestStatus, ObjectiveType } from '../../../../shared/src/types/game.js';

// ============================================================================
// Repository 端口接口（S3-1 Phase B 新增，D7 一表一 Repository）
// ============================================================================

/**
 * Quest 领域 Repository 端口接口（quests 表）。
 * D7: 一表一 Repository，本接口只操作 quests 表。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * 覆盖 QuestService 全部 19 处 quests 表 db 调用。
 */
export interface IQuestRepository {
  // === 查询 ===
  /** 按 ID 查询任务（覆盖 getQuest L125: where id + save_id first） */
  findById(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<Quest | null>;
  /** 查询存档下所有任务（覆盖 listQuests L85: where save_id orderBy created_at asc，支持 status/visible 过滤） */
  findBySaveId(saveId: ID, options?: { status?: QuestStatus; visible?: boolean }, trx?: Knex.Transaction): Promise<Quest[]>;
  /** 按状态查询任务（覆盖 autoUnlockDependentQuests L879 where status='locked' + handleGameEvent L918 where status='active'） */
  findBySaveIdAndStatus(saveId: ID, status: QuestStatus, trx?: Knex.Transaction): Promise<Quest[]>;
  /** 按名称精确查询（覆盖 resolveQuestId L164 byName） */
  findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<Quest | null>;
  /** 按名称模糊查询（覆盖 resolveQuestId L170 byNameLike） */
  findByNameLike(saveId: ID, namePattern: string, trx?: Knex.Transaction): Promise<Quest | null>;
  /** 查询任务 ID + 名称列表（覆盖 resolveQuestId L176 available hint: select id+name limit 20） */
  findNamesBySaveId(saveId: ID, limit?: number, trx?: Knex.Transaction): Promise<Array<{ id: ID; name: string }>>;
  /** 按发布者 NPC 查询任务（覆盖 getQuestsByGiver L674: where giver_npc_id orderBy created_at asc） */
  findByNpcId(saveId: ID, npcId: ID, trx?: Knex.Transaction): Promise<Quest[]>;
  /** 查询主线任务（覆盖 getMainQuest L692: where type='main' + whereNotIn status orderBy created_at asc first） */
  findMainQuest(saveId: ID, trx?: Knex.Transaction): Promise<Quest | null>;
  /** 查询依赖某任务的锁定任务（覆盖 autoUnlockDependentQuests L879: where status='locked' select id + prerequisite_quest_ids） */
  findLockedByDependency(saveId: ID, trx?: Knex.Transaction): Promise<Array<{ id: ID; prerequisiteQuestIds: string[] }>>;
  /** 统计指定 ID 列表中已完成的任务数（覆盖 checkAllPrerequisitesCompleted L907: whereIn id + where status='completed' count） */
  countCompletedByIds(saveId: ID, questIds: ID[], trx?: Knex.Transaction): Promise<number>;
  // === 写入 ===
  /** 插入任务（覆盖 createQuest L232 insert） */
  insert(data: Omit<Quest, 'id'> & { id?: ID }, saveId: ID, trx?: Knex.Transaction): Promise<Quest>;
  /** 更新任务（覆盖 acceptQuest/completeQuest/failQuest/abandonQuest/lockQuest/unlockQuest/updateQuest 状态变更） */
  update(questId: ID, saveId: ID, patch: Partial<Quest>, trx?: Knex.Transaction): Promise<Quest | null>;
  /** 删除任务（覆盖 removeQuest L525 delete） */
  delete(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<boolean>;
  /**
   * 按 saveId 删除所有任务（rollbackSave 回滚存档时清理 quests 表）。
   * S4-D6: 统一返回 Promise<void>。D9: 支持可选 trx 参数。
   */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
  /** 统计存档下任务数量（GameInitService.getInitializationStatus 跨领域 count） */
  countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number>;

  // === S6 新增（StoryKernel 跨领域 quests 表只读查询） ===
  /**
   * 获取活跃的限时任务列表（time_limit > 0）。
   * 覆盖 StoryKernel.assessTimeFactor 跨领域 quests 查询。
   * D9: 支持 trx 参数，供事务内只读查询使用。
   */
  getActiveTimeLimitedQuests(saveId: ID, trx?: Knex.Transaction): Promise<Array<{ time_limit: number; created_at: number }>>;

  /**
   * 获取主线任务 ID。
   * 覆盖 StoryKernel.getMainQuestProgress 跨领域 quests 查询（type='main'）。
   * D9: 支持 trx 参数，供事务内只读查询使用。
   */
  getMainQuestId(saveId: ID, trx?: Knex.Transaction): Promise<string | null>;
}

/**
 * Quest 领域 Repository 端口接口（quest_objectives 表）。
 * D7: 一表一 Repository，本接口只操作 quest_objectives 表。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * 覆盖 QuestService 全部 6 处 quest_objectives 表 db 调用。
 */
export interface IQuestObjectiveRepository {
  /** 按任务 ID 查询所有目标（覆盖 getObjectives L772: where quest_id orderBy id asc） */
  findByQuestId(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<QuestObjective[]>;
  /** 批量查询多个任务的目标（覆盖 DataRefreshHandler.createQuestRefreshConfig 的 whereIn('quest_id', questIds) orderBy id asc） */
  findByQuestIds(saveId: ID, questIds: ID[], trx?: Knex.Transaction): Promise<QuestObjective[]>;
  /** 按 ID 查询目标（覆盖 updateObjective L390 where id + save_id first） */
  findById(objectiveId: ID, saveId: ID, trx?: Knex.Transaction): Promise<QuestObjective | null>;
  /** 插入目标（覆盖 createQuest L257 循环插入） */
  insert(data: Omit<QuestObjective, 'id'> & { id?: ID }, saveId: ID, trx?: Knex.Transaction): Promise<QuestObjective>;
  /** 更新目标（覆盖 updateObjective L401 update current + completed） */
  update(objectiveId: ID, saveId: ID, patch: Partial<QuestObjective>, trx?: Knex.Transaction): Promise<QuestObjective | null>;
  /** 删除任务的所有目标（覆盖 removeQuest L525 级联删除） */
  deleteByQuestId(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<number>;
  /** 按事件触发类型查询未完成目标（覆盖 handleGameEvent L923: where quest_id + whereNotNull event_trigger + 未完成） */
  findEventTriggeredActiveByQuestIds(saveId: ID, questIds: ID[], trx?: Knex.Transaction): Promise<QuestObjective[]>;

  // === S6 新增（StoryKernel 跨领域 quest_objectives 表只读查询） ===
  /**
   * 获取指定任务的目标进度（current + required）。
   * 覆盖 StoryKernel.getMainQuestProgress 跨领域 quest_objectives 查询。
   * questId 为全局唯一可读 ID，不需要 saveId 过滤。
   * D9: 支持 trx 参数，供事务内只读查询使用。
   */
  getProgressByQuestId(questId: ID, trx?: Knex.Transaction): Promise<Array<{ current: number; required: number }>>;
}

// ============================================================================
// Service 端口接口（S3-1 Phase B 新增，供 dialogue 跨领域访问）
// ============================================================================

/**
 * Quest 领域 Service 端口接口。
 * 供跨领域消费方注入使用（如 dialogue 跨领域 quests 表访问）。
 * D-S3-4: dialogue → quests 跨领域写入（L822 INSERT quests）迁移到 IQuestService.createQuest() 端口调用，
 * 一并修复字段错误 title→name。
 *
 * Phase C 修订: createQuest 签名改为直接使用 CreateQuestInput，
 * 与 QuestService 现有实现一致（去掉自定义 params 和 trx 参数）。
 * status 由 createQuest 内部根据 prerequisiteQuestIds 计算（无前置 → 'available'）。
 *
 * Phase C-F4 修订: CreateQuestInput 移除 saveId 字段。
 * saveId 作为上下文参数在 createQuest(saveId, input) 签名中传递，不在 input 中重复。
 * 与 QuestService 其他 19 个方法 `(saveId, ...)` 模式保持一致（code-standards §4.1）。
 */
export interface IQuestService {
  /**
   * 检查任务完成状态（跨领域只读查询）。
   * 覆盖 DialogueService L649 直接 SELECT quests 检查任务完成状态。
   * 支持 ID 或名称查询（findById → findByName 兜底）。
   */
  isQuestCompleted(saveId: ID, questIdOrName: string, trx?: Knex.Transaction): Promise<boolean>;

  /**
   * 创建任务（跨领域写入）。
   * D-S3-4: 覆盖 DialogueService L822 直接 INSERT quests（字段错误 title→name）。
   * 迁移到端口调用时使用正确字段名 name（CreateQuestInput.name）。
   * status 由内部逻辑计算（无 prerequisiteQuestIds → 'available'）。
   * saveId 作为上下文参数（与 QuestService 其他方法一致），不在 input 中重复（Phase C-F4 修订）。
   *
   * S3-3: 新增可选 trx 参数，支持事务透传（dialogue processDialogueChoice 单事务包裹所有效果）。
   *
   * 事务策略（与 InventoryService.addItem 模式一致，避免嵌套事务）:
   * - 传入 trx: 在已有事务内执行，所有 Repository 调用透传 trx，不开新事务
   * - 未传 trx: 用 txManager.transaction 开新事务（保持原 createQuest 行为）
   * 实现方式: 抽取 createQuestInTrx(trx, saveId, input) 私有方法，公共方法按 trx 参数分支。
   */
  createQuest(saveId: ID, input: CreateQuestInput, trx?: Knex.Transaction): Promise<Quest>;
}