import type { FrontendCharacterSkill } from '@/types';
import { parseCostArray } from '@ai-rpg/shared';
import { SKILL_FIELD_KEYS } from '@/utils/fieldDefinitions';
import { assertOwnerType } from '@/utils/entityFilter';

export type GameCharacterSkill = FrontendCharacterSkill;

export function mapSkillsData(rawSkills: Record<string, unknown>[]): GameCharacterSkill[] {
  const validTypes = ['attack', 'defense', 'healing', 'buff', 'debuff', 'utility', 'passive'];
  return rawSkills.map((skill) => {
    const category = (skill.category as string) ?? 'attack';
    const normalizedCategory = category === 'active' ? 'attack' : category;
    const skillType = validTypes.includes(normalizedCategory) ? normalizedCategory : 'utility';
    return {
      id: skill.id as string,
      skill_id: (skill.skill_id ?? skill.skillId) as string,
      name: (skill.name as string) ?? '',
      type: skillType,
      description: skill.description as string | undefined,
      level: (skill.level as number) ?? 1,
      maxLevel: (skill.max_level ?? skill.maxLevel) as number | undefined,
      experience: (skill.experience as number) ?? undefined,
      cost: parseCostArray(skill.cost),
      cooldown: (skill.cooldown_remaining ?? skill.cooldownRemaining ?? skill.cooldown) as number | undefined,
      unlocked: skill.unlocked !== undefined ? Boolean(skill.unlocked) : true,
      element: skill.element as string | undefined,
      effects: skill.effects as Record<string, unknown> | undefined,
      customData: skill.customData as Record<string, unknown> | undefined,
      // §13.3: ownerType 缺失即抛错，禁止兜底；与 inventoryMapper 对称
      ownerType: assertOwnerType(
        (skill.owner_type as string | undefined) ?? (skill.ownerType as string | undefined)
      ),
      ownerId: (skill.owner_id as string) ?? (skill.ownerId as string) ?? '',
      visible: (skill.visible as boolean | undefined) ?? true,
    };
  });
}

/**
 * 校验映射结果是否覆盖 SKILL_FIELD_KEYS 中的所有字段。
 * 用于测试，确保初始化映射与实时映射字段一致。
 */
export function getSkillFieldKeys(): readonly string[] {
  return SKILL_FIELD_KEYS;
}
