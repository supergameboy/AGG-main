import type { Character } from '@/types';
import type { Gender, AgeGroup } from '@ai-rpg/shared';

export interface CharacterMappingOptions {
  saveId: string;
  overrides?: Partial<Character>;
}

export function mapCharacterData(raw: Record<string, unknown>, options: CharacterMappingOptions): Character {
  const { saveId, overrides } = options;
  const da = raw.derived_attributes as Record<string, number> | undefined;
  const statusEffects = Array.isArray(raw.status_effects ?? raw.statusEffects)
    ? (raw.status_effects ?? raw.statusEffects) as string[]
    : [];
  return {
    id: (raw.id as string) ?? '',
    save_id: saveId,
    name: (raw.name as string) ?? '',
    gender: (raw.gender as Gender) ?? 'male',
    customGender: (raw.customGender as string) || (raw.custom_gender as string) || undefined,
    ageGroup: (raw.ageGroup as AgeGroup) || (raw.age_group as AgeGroup) || undefined,
    race: (raw.race as string) ?? overrides?.race ?? '',
    raceName: (raw.raceName as string) ?? (raw.race as string) ?? overrides?.raceName ?? '',
    class: (raw.class as string) ?? overrides?.class ?? '',
    className: (raw.className as string) ?? (raw.class as string) ?? overrides?.className ?? '',
    background: (raw.background as string) ?? overrides?.background ?? '',
    backgroundName: (raw.backgroundName as string) ?? (raw.background as string) ?? overrides?.backgroundName ?? '',
    level: (raw.level as number) ?? overrides?.level ?? 1,
    experience: (raw.experience as number) ?? 0,
    attributes: (raw.attributes as Record<string, number>) ?? {},
    attributeNames: (raw.attributeNames as Record<string, string>) ?? {},
    derivedAttributes: da ? Object.fromEntries(
      Object.entries(da).map(([k, v]) => [k, v ?? 0])
    ) : {},
    currentHP: (raw.current_hp as number) ?? 0,
    maxHP: (raw.max_hp as number) ?? (da?.maxHealth ?? 0),
    currentMP: (raw.current_mp as number) ?? 0,
    maxMP: (raw.max_mp as number) ?? (da?.maxMana ?? 0),
    gold: ((raw.currency as Record<string, number>) ?? {})['gold'] ?? 0,
    currency: (raw.currency as Record<string, number>) ?? {},
    statusEffects,
    status: raw.status as Record<string, unknown> | undefined,
    created_at: (raw.created_at as number) ?? Date.now(),
    updated_at: (raw.updated_at as number) ?? Date.now(),
  } as unknown as Character;
}
