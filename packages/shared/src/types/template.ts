import type { ItemEffect, ItemValue } from './game';
import type { ChallengeMode } from './challenge';

/**
 * 游戏模式类型（决定主要界面变化）
 *
 * 设计依据: code-design §2.2
 * - 移除 dynamic_combat / narrative_focus（属于战斗模式，应在 ChallengeMode）
 * - 新增 text_rpg（原 turn_based_rpg 重命名）
 * - 新增 rpg_2d（2DRPG）
 *
 * 兼容性说明（小偏差就地修复）:
 * - 保留 turn_based_rpg 作为已废弃别名（标注 @deprecated）
 * - 保留 dynamic_combat / narrative_focus 作为已废弃别名（标注 @deprecated）
 * - 现有 yaml 配置文件（medieval-fantasy/cyberpunk-mercenary/xianxia）保持原值不立即修改
 * - 阶段五配置改造时统一迁移到新值
 * - 后续版本完全移除废弃别名
 */
export type GameMode =
  | 'text_adventure'    // 文字冒险
  | 'text_rpg'          // 文字RPG（新值，原 turn_based_rpg 重命名）
  | 'visual_novel'      // 视觉小说
  | 'rpg_2d'            // 2DRPG（新增）
  | 'sandbox'           // 沙盒
  | 'story'             // 故事
  // @deprecated 以下为兼容旧存档的废弃别名，保留用于读取旧存档的 game_mode 字段
  // 所有内置 yaml 已迁移至规范 GameMode；新增存档使用规范值
  // 彻底移除需配套 save 迁移脚本（将旧 game_mode 转换为 规范 game_mode + active_challenge_mode），暂未实现
  | 'turn_based_rpg'    // 旧别名 → text_rpg
  | 'dynamic_combat'    // 旧别名 → text_rpg（挑战模式由 default_challenge_mode: dynamic_combat 单独承载）
  | 'narrative_focus';  // 旧别名 → text_rpg（挑战模式由 default_challenge_mode: narrative_combat 单独承载）

export type NumericalComplexity = 'simple' | 'medium' | 'complex';

export interface WorldSetting {
  name: string;
  description: string;
  era: string;
  genre?: string;
  magic_system: string;
  technology_level: string;
  custom_fields: Record<string, string>;
}

export interface RaceDefinition {
  id: string;
  name: string;
  description: string;
  bonuses: Record<string, number>;
  penalties: Record<string, number>;
  abilities: string[];
  available_classes: string[];
  /** 种族属性修正（与bonuses/penalties不同，用于模板解析时的属性覆盖） */
  stat_modifiers?: Record<string, number>;
}

export interface ClassDefinition {
  id: string;
  name: string;
  description: string;
  primary_attributes: string[];
  hit_die: string;
  skill_proficiencies: string[];
  starting_equipment: string[];
  /** 单数形式的主属性（兼容旧模板，优先使用 primary_attributes） */
  primary_attribute?: string;
  /** 职业初始技能（兼容旧模板，优先使用 skill_proficiencies） */
  starting_skills?: string[];
}

export interface BackgroundDefinition {
  id: string;
  name: string;
  description: string;
  skill_proficiencies: string[];
  languages: string[];
  equipment: string[];
  feature: string;
  attribute_bonuses: Record<string, number>;
  /** 背景奖励技能（兼容旧模板，优先使用 skill_proficiencies） */
  bonus_skills?: string[];
  /** 背景提供的额外初始金币 */
  starting_gold_bonus?: number;
}

export interface AttributeDefinition {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  min_value: number;
  default_value: number;
  max_value: number;
}

export interface CustomOption {
  id: string;
  name: string;
  description: string;
  type: 'text' | 'select' | 'number' | 'boolean';
  options: string[];
  default_value: string | number | boolean;
}

export type AgeMode = 'group' | 'number' | 'none';

export interface AgeNumberConfig {
  min: number;
  max: number;
  default?: number;
}

export interface AgeGroupDefinition {
  id: string;
  name: string;
  description: string;
  bonuses?: Record<string, number>;
  penalties?: Record<string, number>;
}

export interface CharacterCreationRules {
  races: RaceDefinition[];
  classes: ClassDefinition[];
  backgrounds: BackgroundDefinition[];
  attributes: AttributeDefinition[];
  attribute_points: number;
  attribute_role_mapping: AttributeRoleMapping;
  custom_options: CustomOption[];
  /** 全局属性最小值（用于验证，优先级低于 AttributeDefinition.min_value） */
  min_attribute?: number;
  /** 全局属性最大值（用于验证，优先级低于 AttributeDefinition.max_value） */
  max_attribute?: number;
  /** 允许的种族ID白名单（为空或不设置则允许所有） */
  allowed_races?: string[];
  /** 允许的职业ID白名单（为空或不设置则允许所有） */
  allowed_classes?: string[];
  /** 允许的背景ID白名单（为空或不设置则允许所有） */
  allowed_backgrounds?: string[];
  /** 年龄输入模式：group=卡片选择, number=数字输入, none=不显示 */
  age_mode?: AgeMode;
  /** 年龄段定义（age_mode=group 时生效） */
  age_groups?: AgeGroupDefinition[];
  /** 数字年龄配置（age_mode=number 时生效） */
  age_number?: AgeNumberConfig;
}

export interface ElementAffinities {
  /** 克制关系: attacker_element → {defender_element: multiplier} */
  [attackerElement: string]: {
    [defenderElement: string]: number;
  };
}

export interface CombatRuleSet {
  type: string;
  initiative_type: string;
  custom_initiative: string;
  action_points: number;
  critical_hit: {
    threshold: number;
    multiplier: number;
  };
  flee: {
    base_chance: number;
    per_dead_enemy_bonus: number;
  };
  defend: {
    damage_reduction: number;
  };
  damage_formula: {
    attack_contribution: number;
    defense_reduction: number;
    level_bonus_factor: number;
    variance_min: number;
    variance_range: number;
  };
  enemy_ai: {
    skill_use_chance: number;
  };
  element_affinities?: ElementAffinities;
  defaults: {
    potion_heal: number;
    mana_potion_restore: number;
    skill_cost_default: number;
    /** @deprecated Use skill_cost_default */
    skill_mana_cost?: number;
    skill_damage_multiplier: number;
    skill_base_damage_factor: number;
    attribute_fallback: number;
    enemy_speed_factor: number;
  };
}

export interface WeightCooldownConfig {
  enabled: boolean;
  /** Cooldown multiplier per consecutive use (e.g., 1.5 means 50% longer each time) */
  weight_factor: number;
  /** Maximum cooldown multiplier cap (e.g., 3.0 means cooldown won't exceed 3x base) */
  max_multiplier: number;
  /** Number of turns/time without using the skill before cooldown resets to base */
  reset_after: number;
  /** Reset unit: 'turn' or 'time' (ms) */
  reset_unit: 'turn' | 'time';
}

export interface SkillRuleSet {
  max_level: number;
  cooldown_system: string;
  upgrade_cost: {
    base: number;
    multiplier: number;
  };
  /** v2.3: Weight cooldown configuration */
  weight_cooldown?: WeightCooldownConfig;
}

export interface EquipmentSlotDefinition {
  id: string;
  name: string;
  icon: string;
  accepted_item_types: string[];
  /** 槽位容量；未定义或=1 表示单槽位；>1 表示数组化槽位（可装多个物品） */
  capacity?: number;
}

export interface InventoryRuleSet {
  max_slots: number;
  weight_system: boolean;
  stack_sizes: Record<string, number>;
  equipment_slots: EquipmentSlotDefinition[];
}

export interface CurrencySystem {
  id: string;
  name: string;
  icon: string;
}

export interface QuestRuleSet {
  max_active: number;
  time_system: boolean;
  fail_conditions: string[];
}

export interface CustomRule {
  name: string;
  description: string;
}

export interface DecayCurve {
  /** Curve type: linear, exponential, logarithmic */
  type: 'linear' | 'exponential' | 'logarithmic';
  /** Decay rate per tick (for linear: subtract this value; for exponential: multiply by (1-rate); for logarithmic: divide by log factor) */
  rate: number;
  /** Minimum value before decay stops (floor) */
  floor: number;
}

export interface DecayCurveConfig {
  /** Named decay curves that can be referenced by skills/effects */
  curves: Record<string, DecayCurve>;
  /** Default curve to use when not specified */
  default_curve?: string;
}

export interface GameRules {
  combat_system: CombatRuleSet;
  skill_system: SkillRuleSet;
  inventory_system: InventoryRuleSet;
  quest_system: QuestRuleSet;
  currency_system: CurrencySystem;
  custom_rules: CustomRule[];
  derived_attribute_formulas?: Record<string, {
    base: number;
    coefficients: Record<string, number>;
    max?: number;
  }> | null;
  /** v2.3: Decay curve configurations */
  decay_curves?: DecayCurveConfig;
}

export interface AIBehavior {
  response_style: string;
  detail_level: string;
  player_agency: string;
}

export interface AIConstraints {
  tone: string;
  custom_tone: string;
  content_rating: string;
  prohibited_topics: string[];
  required_elements: string[];
  ai_behavior: AIBehavior;
}

export type NPCStats = Record<string, number>;

export interface NPCDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  role: string;
  race: string;
  appearance: string;
  personality: string;
  dialogue: string[];
  stats: NPCStats;
  services: string[];
  custom_data: Record<string, unknown>;
}

export interface TemplateSkillCost {
  mp?: number;
  hp?: number;
  stamina?: number;
  [key: string]: number | undefined;
}

export interface SkillScalingEntry {
  attribute: string;
  multiplier: number;
}

export type SkillScaling = SkillScalingEntry | SkillScalingEntry[];

export interface TemplateSkillDamage {
  base?: number;
  scaling?: SkillScaling;
  min?: number;
  max?: number;
  scaling_attribute?: string;
  scaling_factor?: number;
}

export function parseScaling(scaling: unknown): SkillScalingEntry[] {
  if (Array.isArray(scaling)) {
    return scaling.filter(
      (s): s is SkillScalingEntry =>
        s && typeof s === 'object' && typeof s.attribute === 'string' && typeof s.multiplier === 'number'
    );
  }
  if (scaling && typeof scaling === 'object' && 'attribute' in scaling && 'multiplier' in scaling) {
    const s = scaling as SkillScalingEntry;
    if (typeof s.attribute === 'string' && typeof s.multiplier === 'number') {
      return [s];
    }
  }
  if (scaling && typeof scaling === 'object' && 'scaling_attribute' in scaling) {
    const legacy = scaling as { scaling_attribute?: string; scaling_factor?: number };
    if (typeof legacy.scaling_attribute === 'string' && typeof legacy.scaling_factor === 'number') {
      return [{ attribute: legacy.scaling_attribute, multiplier: legacy.scaling_factor }];
    }
  }
  return [];
}

export interface TemplateSkillEffect {
  type: string;
  value: number;
  duration?: number;
  chance?: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  element: string;
  target_type: string;
  cost: TemplateSkillCost;
  damage: TemplateSkillDamage;
  effects: TemplateSkillEffect[];
  cooldown: number;
  range: number;
  icon: string;
  custom_data: Record<string, unknown>;
}

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  subtype?: string;
  quality: string;
  stats: Record<string, number>;
  effects: ItemEffect[];
  value: ItemValue;
  stackable?: boolean;
  max_stack?: number;
  icon?: string;
  quantity: number;
  custom_data: Record<string, unknown>;
}

export interface TemplateQuestObjective {
  id: string;
  description: string;
  type: string;
  target: string;
  required: number;
}

export interface TemplateQuestReward {
  type: string;
  value: string | number;
  quantity?: number;
}

export interface QuestDefinition {
  id: string;
  name: string;
  description: string;
  type: string;
  objectives: TemplateQuestObjective[];
  rewards: TemplateQuestReward[];
  giver: string;
  time_limit: number;
  custom_data: Record<string, unknown>;
}

export interface ExplorableArea {
  id: string;
  name: string;
  description: string;
  type: string;
  danger_level: number;
  connections: string[];
}

export interface StartingScene {
  location: string;
  description: string;
  location_description?: string;
  npcs: NPCDefinition[];
  items: ItemDefinition[];
  quests: QuestDefinition[];
  explorable_areas: ExplorableArea[];
}

export interface InitialDataConfig {
  skills: Record<string, string[]>;
  items_by_class: Record<string, Array<{ item_id: string; quantity: number }>>;
  items_by_background: Record<string, Array<{ item_id: string; quantity: number }>>;
  equipment: Record<string, Record<string, string>>;
  gold: Record<string, number>;
}

export interface GradientColors {
  start: string;
  end: string;
  direction: string;
}

export interface UITheme {
  primary_color: string;
  font_family: string;
  background_style: string;
  gradient_colors: GradientColors;
  background_image: string;
  pattern_type: string;
  animated_type: string;
  custom_css: string;
}

export interface UILayout {
  show_minimap: boolean;
  show_combat_panel: boolean;
  show_skill_bar: boolean;
  show_party_panel: boolean;
  minimap_position: string;
  minimap_size: string;
  party_panel_position: string;
  skill_bar_slots: number;
  custom_layout: string;
}

export type SaveRestrictionType = 'free' | 'checkpoint_only' | 'manual_only' | 'ironman';

export const SAVE_RESTRICTION_TYPE = {
  FREE: 'free' as const,
  CHECKPOINT_ONLY: 'checkpoint_only' as const,
  MANUAL_ONLY: 'manual_only' as const,
  IRONMAN: 'ironman' as const,
};

export const FAIL_CONDITION_TYPES = {
  TIMEOUT: 'timeout',
  NPC_DEATH: 'npc_death',
  SANITY_LOSS: 'sanity_loss',
  RELATIONSHIP_BROKEN: 'relationship-broken',
  ALERT_TRIGGERED: 'alert-triggered',
  TRIBULATION_FAILED: 'tribulation-failed',
  DAO_HEART_BROKEN: 'dao-heart-broken',
} as const;
export type FailConditionType = typeof FAIL_CONDITION_TYPES[keyof typeof FAIL_CONDITION_TYPES];

export interface SpecialRules {
  has_kp: boolean;
  permadeath: boolean;
  save_restriction: SaveRestrictionType;
  custom_rules: string[];
}

export interface StoryTemplate {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  game_mode: GameMode;
  /**
   * 默认挑战模式（新增字段，code-design §2.2）
   *
   * 期望效果：
   * - 模板配置默认战斗/挑战模式
   * - 模式解析优先级（CombatServiceTool.resolveChallengeMode）：
   *   进行中挑战的持久化模式 > GM 覆盖（saves.active_challenge_mode）> 本字段（模板默认）> 兜底 turn_based_combat
   * - 未配置时回退到兜底 turn_based_combat（不做按游戏模式推断）
   */
  default_challenge_mode?: ChallengeMode;
  world_setting: WorldSetting;
  character_creation: CharacterCreationRules;
  game_rules: GameRules;
  ai_constraints: AIConstraints;
  skills: SkillDefinition[];
  items: ItemDefinition[];
  starting_scene: StartingScene;
  initial_data?: InitialDataConfig;
  ui_theme: UITheme;
  ui_layout: UILayout;
  numerical_complexity: NumericalComplexity;
  special_rules: SpecialRules;
  agent_profile?: string;
  source?: 'yaml' | 'database';
  is_builtin: boolean;
  created_at: number;
  updated_at: number;
}

/**
 * 属性角色映射 - 将语义角色映射到具体的属性ID
 * 用于将硬编码的属性引用转换为模板驱动的动态属性体系
 *
 * 映射关系:
 *   physical_power → str (力量)
 *   agility        → dex (敏捷)
 *   endurance      → con (体质)
 *   mental_power   → int (智力)
 *   perception     → wis (感知)
 *   influence      → cha (魅力)
 */
export interface AttributeRoleMapping {
  physical_power: string;  // 物理力量 → str
  agility: string;         // 敏捷 → dex
  endurance: string;       // 耐力/体质 → con
  mental_power: string;    // 精神力量/智力 → int
  perception: string;      // 感知 → wis
  influence: string;       // 影响力/魅力 → cha
}

export const DEFAULT_ATTRIBUTE_ROLE_MAPPING: AttributeRoleMapping = {
  physical_power: 'str',
  agility: 'dex',
  endurance: 'con',
  mental_power: 'int',
  perception: 'wis',
  influence: 'cha',
};

export const DEFAULT_EQUIPMENT_SLOTS: EquipmentSlotDefinition[] = [
  { id: 'main_hand', name: 'game:equipment.mainHand', icon: '⚔', accepted_item_types: ['weapon'] },
  { id: 'off_hand', name: 'game:equipment.offHand', icon: '🛡', accepted_item_types: ['weapon', 'accessory'] },
  { id: 'head', name: 'game:equipment.head', icon: '⛑', accepted_item_types: ['armor'] },
  { id: 'body', name: 'game:equipment.body', icon: '🛡', accepted_item_types: ['armor'] },
  { id: 'hands', name: 'game:equipment.hands', icon: '🧤', accepted_item_types: ['armor'] },
  { id: 'feet', name: 'game:equipment.feet', icon: '👢', accepted_item_types: ['armor'] },
  { id: 'accessory', name: 'game:equipment.accessory', icon: '💍', accepted_item_types: ['accessory'], capacity: 2 },
];

export const DEFAULT_ATTRIBUTE_DEFINITIONS: AttributeDefinition[] = [
  { id: 'str', name: 'game:character.strength', abbreviation: 'STR', description: 'game:character.strengthDesc', min_value: 1, default_value: 10, max_value: 20 },
  { id: 'dex', name: 'game:character.dexterity', abbreviation: 'DEX', description: 'game:character.dexterityDesc', min_value: 1, default_value: 10, max_value: 20 },
  { id: 'con', name: 'game:character.constitution', abbreviation: 'CON', description: 'game:character.constitutionDesc', min_value: 1, default_value: 10, max_value: 20 },
  { id: 'int', name: 'game:character.intelligence', abbreviation: 'INT', description: 'game:character.intelligenceDesc', min_value: 1, default_value: 10, max_value: 20 },
  { id: 'wis', name: 'game:character.perception', abbreviation: 'WIS', description: 'game:character.perceptionDesc', min_value: 1, default_value: 10, max_value: 20 },
  { id: 'cha', name: 'game:character.charisma', abbreviation: 'CHA', description: 'game:character.charismaDesc', min_value: 1, default_value: 10, max_value: 20 },
];

export function createDefaultTemplate(partial?: Partial<StoryTemplate>): StoryTemplate {
  const now = Date.now();
  return {
    id: `tpl_${now}`,
    name: 'template:newTemplate',
    description: '',
    version: '1.0.0',
    author: 'template:defaultAuthor',
    tags: [],
    game_mode: 'text_adventure',
    // 显式标注 default_challenge_mode 为 undefined（可选字段，未配置时由组合根回退到兜底 turn_based_combat）
    default_challenge_mode: undefined,
    world_setting: {
      name: '',
      description: '',
      era: '',
      genre: '',
      magic_system: '',
      technology_level: '',
      custom_fields: {},
    },
    character_creation: {
      races: [],
      classes: [],
      backgrounds: [],
      attributes: [...DEFAULT_ATTRIBUTE_DEFINITIONS],
      attribute_points: 12,
      attribute_role_mapping: { ...DEFAULT_ATTRIBUTE_ROLE_MAPPING },
      custom_options: [],
    },
    game_rules: {
      combat_system: {
        type: 'narrative',
        initiative_type: 'dexterity',
        custom_initiative: '',
        action_points: 1,
        critical_hit: { threshold: 20, multiplier: 2 },
        flee: { base_chance: 0.3, per_dead_enemy_bonus: 0.1 },
        defend: { damage_reduction: 0.5 },
        damage_formula: {
          attack_contribution: 0.5,
          defense_reduction: 0.5,
          level_bonus_factor: 2,
          variance_min: 0.9,
          variance_range: 0.2,
        },
        enemy_ai: { skill_use_chance: 0.3 },
        defaults: {
          potion_heal: 30,
          mana_potion_restore: 20,
          skill_cost_default: 10,
          skill_damage_multiplier: 1.5,
          skill_base_damage_factor: 2,
          attribute_fallback: 10,
          enemy_speed_factor: 2,
        },
      },
      skill_system: {
        max_level: 10,
        cooldown_system: 'turn',
        upgrade_cost: { base: 100, multiplier: 1.5 },
      },
      inventory_system: {
        max_slots: 20,
        weight_system: false,
        stack_sizes: {},
        equipment_slots: [...DEFAULT_EQUIPMENT_SLOTS],
      },
      quest_system: {
        max_active: 10,
        time_system: false,
        fail_conditions: [],
      },
      currency_system: {
        id: 'gold',
        name: 'game:inventory.gold',
        icon: '🪙',
      },
      custom_rules: [],
    },
    ai_constraints: {
      tone: 'serious',
      custom_tone: '',
      content_rating: 'everyone',
      prohibited_topics: [],
      required_elements: [],
      ai_behavior: {
        response_style: 'narrative',
        detail_level: 'normal',
        player_agency: 'balanced',
      },
    },
    skills: [],
     items: [],
     starting_scene: {
      location: '',
      description: '',
      npcs: [],
      items: [],
      quests: [],
      explorable_areas: [],
    },
    ui_theme: {
      primary_color: '#3b82f6',
      font_family: 'system',
      background_style: 'solid',
      gradient_colors: { start: '#1a1a2e', end: '#16213e', direction: 'to bottom' },
      background_image: '',
      pattern_type: 'dots',
      animated_type: 'particles',
      custom_css: '',
    },
    ui_layout: {
      show_minimap: true,
      show_combat_panel: true,
      show_skill_bar: true,
      show_party_panel: true,
      minimap_position: 'top-left',
      minimap_size: 'medium',
      party_panel_position: 'left',
      skill_bar_slots: 5,
      custom_layout: '',
    },
    numerical_complexity: 'medium',
    special_rules: {
      has_kp: false,
      permadeath: false,
      save_restriction: 'free',
      custom_rules: [],
    },
    is_builtin: false,
    created_at: now,
    updated_at: now,
    ...partial,
  };
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}
