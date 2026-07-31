/**
 * 共享字段定义 — 初始化映射与实时映射的单一数据源
 *
 * 新增字段时只需修改此处，两个映射路径自动同步。
 * 每个字段定义包含：字段名、默认值、是否需要 JSON 解析。
 */

// ─── 技能字段 ────────────────────────────────────────────

export interface SkillFieldDef {
  key: string;
  defaultValue: unknown;
  /** 后端存储为 JSON 字符串，需要 parseJsonField */
  jsonParse?: boolean;
}

export const SKILL_FIELDS: readonly SkillFieldDef[] = [
  { key: 'id', defaultValue: undefined },
  { key: 'skill_id', defaultValue: undefined },
  { key: 'name', defaultValue: '' },
  { key: 'type', defaultValue: undefined },
  { key: 'description', defaultValue: undefined },
  { key: 'level', defaultValue: 1 },
  { key: 'maxLevel', defaultValue: undefined },
  { key: 'experience', defaultValue: undefined },
  { key: 'cost', defaultValue: undefined },
  { key: 'cooldown', defaultValue: undefined },
  { key: 'unlocked', defaultValue: true },
  { key: 'element', defaultValue: undefined },
  { key: 'effects', defaultValue: undefined },
  { key: 'customData', defaultValue: undefined },
  // §13.3: ownerType 必填，无 defaultValue（缺失由 assertOwnerType 抛错）
  { key: 'ownerType', defaultValue: undefined },
  { key: 'ownerId', defaultValue: '' },
  { key: 'visible', defaultValue: true },
] as const;

/** 技能字段名列表（用于快速校验） */
export const SKILL_FIELD_KEYS = SKILL_FIELDS.map(f => f.key);

// ─── 物品字段 ────────────────────────────────────────────

export const INVENTORY_FIELDS: readonly SkillFieldDef[] = [
  { key: 'id', defaultValue: undefined },
  { key: 'saveId', defaultValue: '' },
  { key: 'itemId', defaultValue: undefined },
  { key: 'poolId', defaultValue: '' },
  { key: 'name', defaultValue: undefined },
  { key: 'description', defaultValue: '' },
  { key: 'category', defaultValue: 'misc' },
  { key: 'quantity', defaultValue: undefined },
  { key: 'quality', defaultValue: 'common' },
  { key: 'durability', defaultValue: 0 },
  { key: 'maxDurability', defaultValue: 0 },
  { key: 'inventorySlot', defaultValue: null },
  { key: 'equippedSlot', defaultValue: null },
  { key: 'equipped', defaultValue: false },
  { key: 'weight', defaultValue: 0 },
  { key: 'maxStack', defaultValue: 1 },
  { key: 'stats', defaultValue: {}, jsonParse: true },
  { key: 'effects', defaultValue: [], jsonParse: true },
  { key: 'value', defaultValue: {}, jsonParse: true },
  { key: 'tags', defaultValue: [], jsonParse: true },
  { key: 'customData', defaultValue: {}, jsonParse: true },
  { key: 'visible', defaultValue: true },
  // §13.3: ownerType 必填，无 defaultValue（缺失由 assertOwnerType 抛错，禁止 ?? 'character' 兜底）
  { key: 'ownerType', defaultValue: undefined },
  { key: 'ownerId', defaultValue: '' },
] as const;

/** 物品字段名列表 */
export const INVENTORY_FIELD_KEYS = INVENTORY_FIELDS.map(f => f.key);

// ─── 任务字段 ────────────────────────────────────────────

export const QUEST_FIELDS: readonly SkillFieldDef[] = [
  { key: 'id', defaultValue: undefined },
  { key: 'save_id', defaultValue: '' },
  { key: 'name', defaultValue: '' },
  { key: 'type', defaultValue: undefined },
  { key: 'description', defaultValue: '' },
  { key: 'status', defaultValue: undefined },
  { key: 'visible', defaultValue: true },
  { key: 'giver_npc_id', defaultValue: undefined },
  { key: 'giver_location_id', defaultValue: undefined },
  { key: 'quest_chain_id', defaultValue: undefined },
  { key: 'prerequisite_quest_ids', defaultValue: [] },
  { key: 'conditions', defaultValue: undefined },
  { key: 'objectives', defaultValue: undefined },
  { key: 'rewards', defaultValue: undefined },
  { key: 'time_limit', defaultValue: 0 },
  { key: 'custom_data', defaultValue: undefined },
  { key: 'created_at', defaultValue: undefined },
  { key: 'updated_at', defaultValue: undefined },
] as const;

/** 任务字段名列表 */
export const QUEST_FIELD_KEYS = QUEST_FIELDS.map(f => f.key);
