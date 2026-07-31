/**
 * 实体映射常量副本（子集）—— 对应 packages/frontend/src/utils/entityMapper.ts。
 * DynamicUIRenderer 的 item-card 分支仅消费以下三个常量。
 */

export const ITEM_TYPE_LABELS: Record<string, string> = {
  weapon: '武器',
  armor: '防具',
  accessory: '饰品',
  consumable: '消耗品',
  material: '材料',
  misc: '杂项',
  quest: '任务物品',
  tool: '工具',
  unique: '独特',
};

export const ITEM_RARITY_LABELS: Record<string, string> = {
  common: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  unique: '独特',
};

export const RARITY_COLORS: Record<string, string> = {
  common: 'var(--common, #9ca3af)',
  uncommon: 'var(--uncommon, #22c55e)',
  rare: 'var(--rare, #3b82f6)',
  epic: 'var(--epic, #a855f7)',
  legendary: 'var(--legendary, #f59e0b)',
  unique: 'var(--unique, #ef4444)',
};
