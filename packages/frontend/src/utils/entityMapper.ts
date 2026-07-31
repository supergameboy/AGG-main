import type { GameMode, ChallengeMode } from '@/types';

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  text_adventure: '文字冒险',
  text_rpg: '文字RPG',
  rpg_2d: '2DRPG',
  visual_novel: '视觉小说',
  sandbox: '沙盒模式',
  story: '故事模式',
  // @deprecated 以下为兼容旧 yaml 的废弃别名，阶段五迁移后移除
  turn_based_rpg: '回合制RPG（已废弃）',
  dynamic_combat: '动态战斗（已废弃）',
  narrative_focus: '叙事驱动（已废弃）',
};

/**
 * 挑战模式标签映射（6 种 ChallengeMode）
 * 用于模板编辑器下拉选项展示与卡片 Badge 显示
 */
export const CHALLENGE_MODE_LABELS: Record<ChallengeMode, string> = {
  narrative_combat: '叙事战斗',
  turn_based_combat: '回合制战斗',
  dynamic_combat: '动态战斗',
  puzzle: '解谜挑战',
  mini_game: '小游戏挑战',
  stealth: '潜行挑战',
};

/**
 * 按 GameMode 推荐的默认挑战模式
 * 用于 game_mode 切换时自动推荐 default_challenge_mode（用户可手动覆盖）
 * - 旧 @deprecated GameMode 别名按其语义映射对应挑战模式
 */
export const RECOMMENDED_CHALLENGE_MODE: Record<GameMode, ChallengeMode> = {
  text_adventure: 'narrative_combat',
  text_rpg: 'turn_based_combat',
  rpg_2d: 'turn_based_combat',
  visual_novel: 'narrative_combat',
  sandbox: 'narrative_combat',
  story: 'narrative_combat',
  // @deprecated 旧别名按其语义映射
  turn_based_rpg: 'turn_based_combat',
  dynamic_combat: 'dynamic_combat',
  narrative_focus: 'narrative_combat',
};

export const COMPLEXITY_LABELS: Record<string, string> = {
  simple: '简单',
  medium: '中等',
  complex: '复杂',
};

export const TONE_LABELS: Record<string, string> = {
  serious: '严肃',
  humorous: '幽默',
  dark: '黑暗',
  lighthearted: '轻松',
  mysterious: '神秘',
  romantic: '浪漫',
  custom: '自定义',
};

export const RATING_LABELS: Record<string, string> = {
  everyone: '全年龄',
  teen: '青少年',
  mature: '成人',
};

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

export const EQUIPMENT_SLOT_LABELS: Record<string, string> = {
  main_hand: '主手',
  off_hand: '副手',
  body: '胸甲',
  head: '头盔',
  hands: '手套',
  feet: '靴子',
  accessory: '饰品',
  weapon: '武器',
  armor: '护甲',
};

export const SKILL_TYPE_LABELS: Record<string, string> = {
  passive: '被动',
  attack: '攻击',
  defense: '防御',
  healing: '治疗',
  buff: '增益',
  debuff: '减益',
  utility: '辅助',
};

export const SKILL_ELEMENT_LABELS: Record<string, string> = {
  fire: '火',
  ice: '冰',
  lightning: '雷',
  earth: '地',
  wind: '风',
  water: '水',
  light: '光',
  dark: '暗',
  neutral: '无',
  physical: '物理',
};

export const QUEST_TYPE_LABELS: Record<string, string> = {
  main: '主线',
  side: '支线',
  daily: '日常',
  weekly: '周常',
  chain: '连锁',
  repeatable: '重复',
};

export const MAP_TYPE_LABELS: Record<string, string> = {
  village: '村庄',
  town: '城镇',
  city: '城市',
  forest: '森林',
  mountain: '山脉',
  dungeon: '地下城',
  cave: '洞穴',
  desert: '沙漠',
  plains: '平原',
  swamp: '沼泽',
  coast: '海岸',
  ruins: '遗迹',
};

export const LOCATION_TYPE_LABELS: Record<string, string> = {
  village: '村庄',
  town: '城镇',
  city: '城市',
  forest: '森林',
  dungeon: '地下城',
  cave: '洞穴',
  mountain: '山脉',
  plains: '平原',
  swamp: '沼泽',
  desert: '沙漠',
  coast: '海岸',
  ruins: '遗迹',
  temple: '神殿',
  tavern: '酒馆',
  shop: '商店',
  building: '建筑',
  area: '区域',
};

export const NPC_ROLE_LABELS: Record<string, string> = {
  merchant: '商人',
  blacksmith: '铁匠',
  healer: '治疗师',
  guard: '守卫',
  innkeeper: '旅店老板',
  quest_giver: '任务发布者',
  companion: '同伴',
  enemy: '敌人',
  neutral: '中立NPC',
  elder: '长老',
  scholar: '学者',
  priest: '祭司',
  guide: '向导',
  trainer: '训练师',
  leader: '领袖',
};

/** 属性全名映射 - 作为回退使用，模板 attributeNames 优先 */
export const ATTRIBUTE_FULL_NAMES: Record<string, string> = {
  str: '力量',
  dex: '敏捷',
  int: '智力',
  con: '体质',
  wis: '感知',
  cha: '魅力',
};

export const DERIVED_ATTRIBUTE_NAMES: Record<string, string> = {
  attack: '攻击力',
  defense: '防御力',
  speed: '速度',
  critRate: '暴击率',
  critDamage: '暴击伤害',
  dodgeRate: '闪避率',
  blockRate: '格挡率',
  magicAttack: '魔攻',
  magicDefense: '魔防',
  maxHealth: '最大生命',
  maxMana: '最大法力',
};

/** 属性颜色映射 - 作为回退使用，模板配置优先 */
export const ATTRIBUTE_COLORS: Record<string, string> = {
  str: 'var(--str)',
  dex: 'var(--dex)',
  int: 'var(--int)',
  con: 'var(--con)',
  wis: 'var(--wis)',
  cha: 'var(--cha)',
};

export function getAttributeColor(attrId: string): string {
  return ATTRIBUTE_COLORS[attrId] || 'var(--accent)';
}

export const ITEM_STAT_LABELS: Record<string, string> = {
  attack: '攻击力',
  defense: '防御力',
  magic_power: '魔法攻击',
  magic_defense: '魔法防御',
  speed: '速度',
  critical: '暴击率',
  crit_rate: '暴击率',
  crit_damage: '暴击伤害',
  armor_penetration: '穿甲',
  healing_power: '治疗力',
  dodge_rate: '闪避率',
  block_rate: '格挡率',
  hp: '生命值',
  mp: '法力值',
  heal: '治疗量',
  mana_restore: '法力恢复',
  fire_damage: '火焰伤害',
  ice_damage: '冰霜伤害',
  lightning_damage: '雷电伤害',
  poison_damage: '毒素伤害',
  holy_damage: '神圣伤害',
  shadow_damage: '暗影伤害',
  physical_power: '物理强度',
  mental_power: '精神强度',
  endurance: '耐力',
  agility: '敏捷',
  perception: '感知',
  influence: '影响力',
  str: '力量',
  dex: '敏捷',
  int: '智力',
  con: '体质',
  wis: '感知',
  cha: '魅力',
};

export function formatItemStat(key: string, value: number): string {
  const label = ITEM_STAT_LABELS[key] || key;
  if (value > 0) return `${label}+${value}`;
  return `${label}${value}`;
}

export function formatBonuses(
  bonuses: Record<string, number>,
  attributeNameMap?: Record<string, string>
): string {
  return Object.entries(bonuses)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => {
      const name = attributeNameMap?.[k] || ITEM_STAT_LABELS[k] || k.toUpperCase();
      return `${name}+${v}`;
    })
    .join('，');
}

export function formatPenalties(
  penalties: Record<string, number>,
  attributeNameMap?: Record<string, string>
): string {
  return Object.entries(penalties)
    .filter(([, v]) => v < 0)
    .map(([k, v]) => {
      const name = attributeNameMap?.[k] || ITEM_STAT_LABELS[k] || k.toUpperCase();
      return `${name}${v}`;
    })
    .join('，');
}
