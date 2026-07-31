import { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type {
  NPCProfile,
  NPCGoal,
  NPCVisibility,
  GoalCategory,
} from './types.js';

/**
 * npcs 表 row → NPCProfile 纯映射函数。
 *
 * 共享消费方:
 * - NPCRepository.rowToEntity: BaseRepository 抽象方法实现，封装 row → entity 映射
 *
 * 设计原则: 一个概念只表达一次（code-standards §二.4）。原 NPCService.rowToNPCProfile
 * 为私有方法，迁移为独立纯映射函数后供 Repository 共享。
 */
export function npcRowToProfile(row: Record<string, unknown>): NPCProfile {
  const customData: Record<string, unknown> = typeof row.custom_data === 'string'
    ? JSON.parse(row.custom_data)
    : (row.custom_data as Record<string, unknown>) ?? {};

  return {
    id: row.id as ID,
    saveId: row.save_id as ID,
    templateNpcId: (row.template_npc_id as string | null) ?? null,
    name: row.name as string,
    title: (row.title as string) ?? '',
    description: (row.description as string) ?? '',
    role: row.role as string,
    race: (row.race as string) ?? '',
    locationId: (row.location_id as string | null) ?? null,
    level: (row.level as number) ?? 1,
    services: parseJsonField<Array<{ type: string; name: string }>>(row.services, []),
    dialogueHistory: parseJsonField<NPCProfile['dialogueHistory']>(row.dialogue_history, []),
    inParty: Boolean(row.in_party),
    joinedPartyAt: (row.joined_party_at as Timestamp | null) ?? null,
    reputation: (row.reputation as number) ?? 0,
    mood: (row.mood as number) ?? 50,
    visible: Boolean(row.visible),
    attrInitialized: Boolean(row.attr_initialized),
    invInitialized: Boolean(row.inv_initialized),
    skillInitialized: Boolean(row.skill_initialized),
    relation: (customData.disposition as string) ?? undefined,
    customData,
    currency: parseJsonField<Record<string, number>>(row.currency, {}),
    attributes: parseJsonField<Record<string, unknown>>(row.attributes, {}),
    derivedAttributes: parseJsonField<Record<string, unknown>>(row.derived_attributes, {}),
    currentHp: (row.current_hp as number | null) ?? null,
    maxHp: (row.max_hp as number | null) ?? null,
    currentMp: (row.current_mp as number | null) ?? null,
    maxMp: (row.max_mp as number | null) ?? null,
    visibility: (customData.visibility as NPCVisibility | undefined) ?? undefined,
    createdAt: (row.created_at as number) ?? 0,
  };
}

/**
 * npc_goals 表 row → NPCGoal 纯映射函数。
 *
 * 共享消费方:
 * - NPCGoalRepository.rowToEntity: BaseRepository 抽象方法实现
 */
export function npcGoalRowToGoal(row: Record<string, unknown>): NPCGoal {
  return {
    id: row.id as string,
    saveId: row.save_id as string,
    npcId: row.npc_id as string,
    type: row.type as 'long_term' | 'mid_term',
    category: row.category as GoalCategory,
    description: (row.description as string) ?? '',
    priority: (row.priority as number) ?? 5,
    status: row.status as NPCGoal['status'],
    relatedEntityIds: parseJsonField<string[]>(row.related_entity_ids, []),
    progress: (row.progress as string) ?? '',
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * JSON 字段统一解析：字符串 → JSON.parse，对象 → 直接返回，空值 → 默认值。
 * 一个概念只表达一次（code-standards §二.4），避免每个映射函数重复 try/parse 逻辑。
 */
function parseJsonField<T>(value: unknown, defaultValue: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }
  if (value !== null && value !== undefined) {
    return value as T;
  }
  return defaultValue;
}
