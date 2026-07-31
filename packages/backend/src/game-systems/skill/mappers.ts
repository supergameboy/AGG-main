import { ID } from '../../../../shared/src/types/core.js';
import { parseCostArray } from '../../../../shared/src/types/game.js';
import type { SkillPoolEntry } from '../../../../shared/src/types/game.js';
import type { CharacterSkill, SkillCategory, SkillElement, OwnerType } from './types.js';

/**
 * skill_pool 表 row → SkillPoolEntry 纯映射函数。
 *
 * 共享消费方:
 * - SkillPoolRepository.rowToEntity: BaseRepository 抽象方法实现
 *
 * 设计原则: 一个概念只表达一次（code-standards §二.4）。原 SkillService.poolRowToSkillPoolEntry
 * 为私有方法，迁移为独立纯映射函数后供 Repository 共享。
 */
export function mapSkillPoolRowToEntry(row: Record<string, unknown>): SkillPoolEntry {
  return {
    id: row.id as string,
    saveId: row.save_id as string,
    name: row.name as string,
    description: row.description as string,
    category: row.category as string,
    element: row.element as string,
    cost: parseCostArray(row.cost),
    damage: typeof row.damage === 'string' ? JSON.parse(row.damage) : (row.damage as Record<string, unknown>),
    effects: typeof row.effects === 'string' ? JSON.parse(row.effects) : (row.effects as Array<Record<string, unknown>>),
    cooldown: row.cooldown as number,
    maxLevel: row.max_level as number,
    targetType: row.target_type as string,
    range: row.range as number,
    learned: Boolean(row.learned),
    customData: typeof row.custom_data === 'string' ? JSON.parse(row.custom_data) : (row.custom_data as Record<string, unknown>),
    recommendedClasses: typeof row.recommended_classes === 'string' ? JSON.parse(row.recommended_classes) : (row.recommended_classes as string[] ?? []),
    createdAt: row.created_at as number | undefined,
  };
}

/**
 * character_skills 表 row → CharacterSkill 纯映射函数。
 *
 * 共享消费方:
 * - CharacterSkillRepository.rowToEntity: BaseRepository 抽象方法实现
 *
 * 设计原则: 一个概念只表达一次（code-standards §二.4）。原 SkillService.rowToCharacterSkill
 * 为私有方法，迁移为独立纯映射函数后供 Repository 共享。
 */
export function mapCharacterSkillRow(row: Record<string, unknown>): CharacterSkill {
  return {
    id: row.id as ID,
    saveId: row.save_id as ID,
    skillId: row.skill_id as string,
    name: row.name as string,
    description: row.description as string,
    level: row.level as number,
    maxLevel: row.max_level as number,
    experience: row.experience as number,
    cooldownRemaining: row.cooldown_remaining as number,
    category: row.category as SkillCategory,
    element: row.element as SkillElement,
    cost: parseCostArray(row.cost),
    effects: typeof row.effects === 'string'
      ? JSON.parse(row.effects)
      : (row.effects as Record<string, unknown>),
    customData: typeof row.custom_data === 'string'
      ? JSON.parse(row.custom_data)
      : (row.custom_data as Record<string, unknown>),
    unlocked: row.unlocked != null ? Boolean(row.unlocked) : true,
    visible: Boolean(row.visible),
    ownerType: row.owner_type as OwnerType,
    ownerId: row.owner_id as string,
    consecutiveUses: (row.consecutive_uses as number) ?? 0,
    lastUsedAt: (row.last_used_at as number) ?? 0,
  };
}
