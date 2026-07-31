/**
 * quest 领域纯映射函数。
 *
 * 从 QuestService 私有方法迁入（rowToQuest L991 / rowToObjective L1030），
 * 供 QuestRepository / QuestObjectiveRepository 共享。
 */
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type {
  Quest,
  QuestObjective,
  QuestType,
  QuestStatus,
  ObjectiveType,
} from './types.js';
import type { QuestReward, QuestConditions, EventTrigger } from '../../../../shared/src/types/game.js';

/** JSON 字段安全解析：字符串则 parse，对象则直返，空值用 fallback */
function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

/** quests 表行 → Quest 实体 */
export function rowToQuest(row: Record<string, unknown>): Quest {
  return {
    id: row.id as ID,
    saveId: row.save_id as ID,
    name: row.name as string,
    description: (row.description as string) ?? '',
    type: row.type as QuestType,
    status: row.status as QuestStatus,
    visible: Boolean(row.visible),
    prerequisiteQuestIds: parseJsonField<string[]>(row.prerequisite_quest_ids, []),
    conditions: parseJsonField<QuestConditions | undefined>(row.conditions, undefined),
    giverNpcId: (row.giver_npc_id as string | null) ?? null,
    giverLocationId: (row.giver_location_id as string | null) ?? null,
    questChainId: (row.quest_chain_id as string | null) ?? null,
    rewards: parseJsonField<QuestReward>(row.rewards, {}),
    timeLimit: (row.time_limit as number) ?? 0,
    customData: parseJsonField<Record<string, unknown>>(row.custom_data, {}),
    createdAt: row.created_at as Timestamp,
    updatedAt: row.updated_at as Timestamp,
  };
}

/** quest_objectives 表行 → QuestObjective 实体 */
export function rowToObjective(row: Record<string, unknown>): QuestObjective {
  return {
    id: row.id as ID,
    questId: row.quest_id as ID,
    description: row.description as string,
    type: row.type as ObjectiveType,
    target: row.target as string,
    required: (row.required as number) ?? 1,
    current: (row.current as number) ?? 0,
    completed: Boolean(row.completed),
    eventTrigger: parseJsonField<EventTrigger | undefined>(row.event_trigger, undefined),
  };
}

/** Quest 实体 → quests 表行（用于 insert） */
export function questToRow(quest: Omit<Quest, 'id'> & { id?: ID }): Record<string, unknown> {
  const now = (quest.createdAt ?? Date.now()) as Timestamp;
  return {
    id: quest.id,
    save_id: quest.saveId,
    name: quest.name,
    description: quest.description,
    type: quest.type,
    status: quest.status,
    visible: quest.visible ? 1 : 0,
    prerequisite_quest_ids: JSON.stringify(quest.prerequisiteQuestIds ?? []),
    conditions: quest.conditions ? JSON.stringify(quest.conditions) : null,
    giver_npc_id: quest.giverNpcId ?? null,
    giver_location_id: quest.giverLocationId ?? null,
    quest_chain_id: quest.questChainId ?? null,
    rewards: JSON.stringify(quest.rewards ?? {}),
    time_limit: quest.timeLimit ?? 0,
    custom_data: JSON.stringify(quest.customData ?? {}),
    created_at: now,
    updated_at: now,
  };
}

/**
 * QuestObjective 实体 → quest_objectives 表行（用于 insert）。
 * save_id 由 Repository.insert 调用时补充（QuestObjective 类型不含 saveId 字段，
 * 但 quest_objectives 表有 save_id 列用于按存档隔离）。
 */
export function objectiveToRow(objective: Omit<QuestObjective, 'id'> & { id?: ID }, saveId: ID): Record<string, unknown> {
  return {
    id: objective.id,
    save_id: saveId,
    quest_id: objective.questId,
    description: objective.description,
    type: objective.type,
    target: objective.target,
    required: objective.required,
    current: objective.current,
    completed: objective.completed ? 1 : 0,
    event_trigger: objective.eventTrigger ? JSON.stringify(objective.eventTrigger) : null,
  };
}
