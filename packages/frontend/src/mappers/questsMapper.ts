import type { Quest, ObjectiveType, EventTrigger } from '@/types';
import { QUEST_FIELD_KEYS } from '@/utils/fieldDefinitions';

function normalizeQuestType(value: unknown): Quest['type'] {
  switch (value) {
    case 'main':
    case 'side':
    case 'daily':
    case 'weekly':
    case 'chain':
    case 'repeatable':
      return value;
    default:
      return 'side';
  }
}

function normalizeQuestStatus(value: unknown): Quest['status'] {
  switch (value) {
    case 'locked':
    case 'available':
    case 'active':
    case 'completed':
    case 'failed':
      return value;
    default:
      return 'available';
  }
}

function normalizeObjectiveType(value: unknown): ObjectiveType {
  const validTypes: ObjectiveType[] = ['kill', 'collect', 'talk', 'explore', 'use_item'];
  if (validTypes.includes(value as ObjectiveType)) return value as ObjectiveType;
  return 'kill';
}

export function mapQuestsData(rawQuests: Record<string, unknown>[], saveId: string): Quest[] {
  return rawQuests.map((q) => ({
    id: q.id as string,
    save_id: saveId,
    name: (q.name as string) ?? '',
    type: normalizeQuestType(q.type),
    description: (q.description as string) ?? '',
    status: normalizeQuestStatus(q.status),
    visible: Boolean(q.visible),
    prerequisite_quest_ids: Array.isArray(q.prerequisite_quest_ids) ? q.prerequisite_quest_ids as string[] : [],
    giver_npc_id: (q.giver_npc_id as string) ?? (q.giverNpcId as string) ?? (q.giver as string | undefined),
    giver_location_id: (q.giver_location_id as string) ?? (q.giverLocationId as string) ?? (q.location_id as string) ?? undefined,
    quest_chain_id: (q.quest_chain_id as string) ?? (q.questChainId as string) ?? undefined,
    conditions: (q.conditions as Quest['conditions']) ?? undefined,
    objectives: Array.isArray(q.objectives)
      ? (q.objectives as Record<string, unknown>[]).map((o) => ({
          id: o.id as string,
          quest_id: (o.quest_id as string) ?? (q.id as string),
          type: normalizeObjectiveType(o.type),
          description: (o.description as string) ?? '',
          target: (o.target as string) ?? '',
          current: (o.current as number) ?? 0,
          required: (o.required as number) ?? 1,
          completed: Boolean(o.completed),
          event_trigger: o.event_trigger
            ? (typeof o.event_trigger === 'string' ? JSON.parse(o.event_trigger) : o.event_trigger) as EventTrigger
            : o.eventTrigger
              ? (typeof o.eventTrigger === 'string' ? JSON.parse(o.eventTrigger) : o.eventTrigger) as EventTrigger
              : undefined,
        }))
      : [],
    rewards: (q.rewards as Quest['rewards']) ?? {},
    time_limit: (q.time_limit as number) ?? (q.timeLimit as number) ?? 0,
    custom_data: (q.custom_data ?? q.customData) as Record<string, unknown> | undefined,
  })) as unknown as Quest[];
}

export function mapQuestRealtimeUpdate(rawQuest: Record<string, unknown>, saveId: string): { normalized: Quest; patch: Partial<Quest> } {
  const rewards = (rawQuest.rewards as Quest['rewards']) ?? {};
  const normalized: Quest = {
    id: rawQuest.id as string,
    save_id: saveId,
    name: (rawQuest.name as string) ?? '',
    type: normalizeQuestType(rawQuest.type),
    description: typeof rawQuest.description === 'string' ? rawQuest.description : '',
    status: normalizeQuestStatus(rawQuest.status),
    visible: Boolean(rawQuest.visible),
    prerequisite_quest_ids: Array.isArray(rawQuest.prerequisite_quest_ids) ? rawQuest.prerequisite_quest_ids as string[] : [],
    giver_npc_id: (rawQuest.giver_npc_id as string) ?? (rawQuest.giverNpcId as string) ?? (rawQuest.giver as string | undefined),
    giver_location_id: (rawQuest.giver_location_id as string) ?? (rawQuest.giverLocationId as string) ?? (rawQuest.location_id as string) ?? undefined,
    quest_chain_id: (rawQuest.quest_chain_id as string) ?? (rawQuest.questChainId as string) ?? undefined,
    conditions: (rawQuest.conditions as Quest['conditions']) ?? undefined,
    objectives: Array.isArray(rawQuest.objectives)
      ? (rawQuest.objectives as Record<string, unknown>[]).map((o) => ({
          id: o.id as string,
          quest_id: (o.quest_id as string) ?? (rawQuest.id as string),
          type: normalizeObjectiveType(o.type),
          description: (o.description as string) ?? '',
          target: (o.target as string) ?? '',
          current: (o.current as number) ?? 0,
          required: (o.required as number) ?? 1,
          completed: Boolean(o.completed),
          event_trigger: o.event_trigger
            ? (typeof o.event_trigger === 'string' ? JSON.parse(o.event_trigger) : o.event_trigger) as EventTrigger
            : o.eventTrigger
              ? (typeof o.eventTrigger === 'string' ? JSON.parse(o.eventTrigger) : o.eventTrigger) as EventTrigger
              : undefined,
        }))
      : [],
    rewards,
    time_limit: (rawQuest.time_limit as number) ?? (rawQuest.timeLimit as number) ?? 0,
    custom_data: (rawQuest.custom_data ?? rawQuest.customData) as Record<string, unknown> | undefined,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  const patch: Partial<Quest> = {};
  if ('name' in rawQuest) patch.name = normalized.name;
  if ('type' in rawQuest) patch.type = normalized.type;
  if (typeof rawQuest.description === 'string') patch.description = rawQuest.description;
  if ('status' in rawQuest) patch.status = normalized.status;
  if ('visible' in rawQuest) patch.visible = normalized.visible;
  if ('objectives' in rawQuest) patch.objectives = normalized.objectives;
  if ('rewards' in rawQuest) patch.rewards = normalized.rewards;
  if ('giver_npc_id' in rawQuest || 'giverNpcId' in rawQuest || 'giver' in rawQuest) patch.giver_npc_id = normalized.giver_npc_id;
  if ('giver_location_id' in rawQuest || 'giverLocationId' in rawQuest || 'location_id' in rawQuest) patch.giver_location_id = normalized.giver_location_id;
  if ('quest_chain_id' in rawQuest || 'questChainId' in rawQuest) patch.quest_chain_id = normalized.quest_chain_id;
  if ('conditions' in rawQuest) patch.conditions = normalized.conditions;
  if ('custom_data' in rawQuest || 'customData' in rawQuest) patch.custom_data = normalized.custom_data;
  if ('time_limit' in rawQuest || 'timeLimit' in rawQuest) patch.time_limit = normalized.time_limit;
  if ('created_at' in rawQuest && typeof rawQuest.created_at === 'number') patch.created_at = rawQuest.created_at;
  if ('updated_at' in rawQuest && typeof rawQuest.updated_at === 'number') patch.updated_at = rawQuest.updated_at;
  return { normalized, patch };
}

/**
 * 校验映射结果是否覆盖 QUEST_FIELD_KEYS 中的所有字段。
 * 用于测试，确保初始化映射与实时映射字段一致。
 */
export function getQuestFieldKeys(): readonly string[] {
  return QUEST_FIELD_KEYS;
}
