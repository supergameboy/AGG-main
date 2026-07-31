import type { FrontendCharacterSkill, FrontendNPCInfo, FrontendMapLocation, Quest } from '@/types';

/** 展示属性条目 — displayStats 的统一格式 */
export interface DisplayStat {
  key: string;
  label: string;
  value: string;
}

// ============================================================
// Skill Display Data
// ============================================================

export interface SkillDisplayData {
  /** 展示类型：优先从 customData.displayType 读取，回退到标准 type */
  displayType: string | undefined;
  /** 展示效果描述：从 customData.displayEffects 读取 */
  displayEffects: string | undefined;
  /** 标签数组：从 customData.tags 读取 */
  tags: string[] | undefined;
  /** 视觉描述：从 customData.visualDesc 读取 */
  visualDesc: string | undefined;
  /** 展示元素：优先从 customData.displayElement 读取，回退到标准 element */
  displayElement: string | undefined;
  /** 职业限制：从 customData.class_requirement 读取 */
  classRequirement: string[] | undefined;
  /** 等级限制：从 customData.level_requirement 读取 */
  levelRequirement: number | undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

export function resolveSkillDisplay(skill: FrontendCharacterSkill): SkillDisplayData {
  const cd = skill.customData;

  return {
    displayType: (cd && isString(cd.displayType) ? cd.displayType : undefined) ?? skill.type,
    displayEffects: cd && isString(cd.displayEffects) ? cd.displayEffects : undefined,
    tags: cd && isStringArray(cd.tags) ? cd.tags : undefined,
    visualDesc: cd && isString(cd.visualDesc) ? cd.visualDesc : undefined,
    displayElement: (cd && isString(cd.displayElement) ? cd.displayElement : undefined) ?? skill.element,
    classRequirement: cd && isStringArray(cd.class_requirement) ? cd.class_requirement : undefined,
    levelRequirement: cd && isNumber(cd.level_requirement) ? cd.level_requirement : undefined,
  };
}

// ============================================================
// NPC Display Data
// ============================================================

export interface NPCDisplayData {
  /** 态度：从 customData.disposition 读取 */
  disposition: string | undefined;
  /** 倾向：从 customData.attitude 读取 */
  attitude: string | undefined;
  /** 是否初始场景NPC：从 customData.is_starting_scene_npc 读取 */
  isStartingSceneNpc: boolean | undefined;
  /** X坐标：从 customData.x 读取 */
  positionX: number | undefined;
  /** Y坐标：从 customData.y 读取 */
  positionY: number | undefined;
}

export function resolveNPCDisplay(npc: FrontendNPCInfo): NPCDisplayData {
  const cd = npc.customData;

  return {
    disposition: cd && isString(cd.disposition) ? cd.disposition : undefined,
    attitude: cd && isString(cd.attitude) ? cd.attitude : undefined,
    isStartingSceneNpc: cd && isBoolean(cd.is_starting_scene_npc) ? cd.is_starting_scene_npc : undefined,
    positionX: cd && isNumber(cd.x) ? cd.x : undefined,
    positionY: cd && isNumber(cd.y) ? cd.y : undefined,
  };
}

// ============================================================
// Quest Display Data
// ============================================================

export interface QuestDisplayData {
  /** 前置任务ID列表：从 Quest.prerequisite_quest_ids 读取 */
  prerequisiteQuestIds: string[];
}

export function resolveQuestDisplay(quest: Quest): QuestDisplayData {
  return {
    prerequisiteQuestIds: quest.prerequisite_quest_ids ?? [],
  };
}

// ============================================================
// Map Location Display Data
// ============================================================

export interface MapLocationDisplayData {
  /** 危险等级：优先从 customData.danger_level 读取，回退到标准 dangerLevel */
  dangerLevel: number | undefined;
  /** 是否起始地点：从 customData.is_starting_location 读取 */
  isStartingLocation: boolean | undefined;
  /** 是否可探索区域：从 customData.is_explorable_area 读取 */
  isExplorableArea: boolean | undefined;
  /** 是否主地图：从 customData.is_main_map 读取 */
  isMainMap: boolean | undefined;
}

export function resolveMapLocationDisplay(location: FrontendMapLocation): MapLocationDisplayData {
  const cd = location.customData;

  return {
    dangerLevel: (cd && isNumber(cd.danger_level) ? cd.danger_level : undefined) ?? location.dangerLevel,
    isStartingLocation: cd && isBoolean(cd.is_starting_location) ? cd.is_starting_location : undefined,
    isExplorableArea: cd && isBoolean(cd.is_explorable_area) ? cd.is_explorable_area : undefined,
    isMainMap: cd && isBoolean(cd.is_main_map) ? cd.is_main_map : undefined,
  };
}

// ============================================================
// Item Display Data — displayStats 统一为数组格式
// ============================================================

export interface ItemDisplayData {
  /** 展示类型：从 item.category 读取 */
  displayType: string | undefined;
  /** 展示稀有度：从 item.quality 读取 */
  displayRarity: string | undefined;
  /** 展示属性列表：从 item.stats 经 normalizeDisplayStats 统一为 DisplayStat[] 数组格式 */
  displayStats: DisplayStat[] | undefined;
  /** 展示效果列表：从 item.effects 映射读取 */
  displayEffects: string[] | undefined;
  /** 展示描述：从 item.description 读取 */
  displayDescription: string | undefined;
}

/** 判断值是否为合法的 DisplayStat 对象 */
function isValidDisplayStat(obj: unknown): obj is DisplayStat {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  return typeof record.key === 'string' && typeof record.label === 'string' && record.value !== undefined;
}

/** 将各种 displayStats 格式统一为 DisplayStat[] 数组 */
export function normalizeDisplayStats(raw: unknown): DisplayStat[] | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;

  // 数组格式：过滤无效条目，确保 value 为字符串
  if (Array.isArray(raw)) {
    const result = raw
      .filter(isValidDisplayStat)
      .map((s) => ({ key: s.key, label: s.label, value: String(s.value) }));
    return result.length > 0 ? result : undefined;
  }

  // Record 格式：key 作为 label，value 转为字符串
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return undefined;

  const result = entries
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([key, value]) => ({ key, label: key, value: String(value) }));

  return result.length > 0 ? result : undefined;
}

export function resolveItemDisplay(item: {
  stats?: Record<string, number>;
  effects?: Array<{ type: string; value: number; target?: string; duration?: number }>;
  description?: string;
  quality?: string;
  category?: string;
  customData?: Record<string, unknown>;
}): ItemDisplayData {
  const cd = item.customData;
  const rawDisplayStats = cd?.displayStats ?? item.stats;
  const rawDisplayEffects = cd?.displayEffects;

  return {
    displayType: item.category,
    displayRarity: item.quality,
    displayStats: normalizeDisplayStats(rawDisplayStats),
    displayEffects: isStringArray(rawDisplayEffects) ? rawDisplayEffects : undefined,
    displayDescription: item.description,
  };
}
