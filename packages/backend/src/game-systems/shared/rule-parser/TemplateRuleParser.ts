import type {
  CombatRuleSet,
  SkillRuleSet,
  WeightCooldownConfig,
  InventoryRuleSet,
  QuestRuleSet,
  AttributeRoleMapping,
  DecayCurveConfig,
} from '../../../../../shared/src/types/template.js';
import { DEFAULT_ATTRIBUTE_ROLE_MAPPING } from '../../../../../shared/src/types/template.js';
import { createChildLogger } from '../../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('template-rule-parser');

const DEFAULT_COMBAT_RULES: Required<CombatRuleSet> = {
  type: 'encounter',
  initiative_type: 'speed',
  custom_initiative: '',
  action_points: 2,
  critical_hit: { threshold: 2, multiplier: 1.5 },
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
  element_affinities: {},
  defaults: {
    potion_heal: 30,
    mana_potion_restore: 20,
    skill_cost_default: 10,
    skill_damage_multiplier: 1.5,
    skill_base_damage_factor: 2,
    attribute_fallback: 10,
    enemy_speed_factor: 2,
  },
};

const DEFAULT_SKILL_RULES: SkillRuleSet = {
  max_level: 10,
  cooldown_system: 'time',
  upgrade_cost: { base: 100, multiplier: 1.5 },
};

const DEFAULT_INVENTORY_RULES: Required<InventoryRuleSet> = {
  max_slots: 30,
  weight_system: false,
  stack_sizes: {},
  equipment_slots: [],
};

const DEFAULT_QUEST_RULES: Required<QuestRuleSet> = {
  max_active: Infinity,
  time_system: false,
  fail_conditions: [],
};

interface TemplateRuleSource {
  game_rules?: Record<string, unknown>;
  character_creation?: Record<string, unknown>;
  special_rules?: Record<string, unknown>;
}

export class TemplateRuleParser {
  /**
   * 进程级 LRU 缓存（key = templateId）。
   *
   * Map 保持插入顺序，keys().next().value 返回最旧条目用于 LRU 淘汰。
   * 缓存 TemplateRuleParser 实例（含已解析的实例级规则缓存），
   * 避免同一 templateId 重复执行 DB query + YAML 解析。
   */
  private static readonly cache = new Map<string, TemplateRuleParser>();
  private static readonly CACHE_MAX_SIZE = 50;

  private source: TemplateRuleSource;
  private combatRulesCache: Required<CombatRuleSet> | null = null;
  private skillRulesCache: SkillRuleSet | null = null;
  private inventoryRulesCache: Required<InventoryRuleSet> | null = null;
  private questRulesCache: Required<QuestRuleSet> | null = null;
  private attributeRoleMappingCache: AttributeRoleMapping | null = null;
  private specialRulesCache: Record<string, unknown> | null = null;
  private decayCurvesCache: DecayCurveConfig | null = null;

  constructor(source: TemplateRuleSource = {}) {
    this.source = source;
  }

  /**
   * 核心缓存方法：按 templateId 获取 TemplateRuleParser（优先走进程级缓存）。
   *
   * 调用方应优先使用此方法（ToolContext 已有 templateId），
   * 仅在只有 saveId 时才用 fromSaveId（多 1 次 saves 表查询）。
   */
  static async fromTemplateId(db: import('knex').Knex, templateId: string): Promise<TemplateRuleParser> {
    if (!templateId) return new TemplateRuleParser({});

    const cached = TemplateRuleParser.cache.get(templateId);
    if (cached) return cached;

    const source = await TemplateRuleParser.loadTemplateSource(db, templateId);
    const parser = new TemplateRuleParser(source);

    if (TemplateRuleParser.cache.size >= TemplateRuleParser.CACHE_MAX_SIZE) {
      const oldestKey = TemplateRuleParser.cache.keys().next().value;
      if (oldestKey) {
        TemplateRuleParser.cache.delete(oldestKey);
      }
    }
    TemplateRuleParser.cache.set(templateId, parser);

    return parser;
  }

  /**
   * 兼容方法：按 saveId 获取 TemplateRuleParser。
   *
   * 内部先查 saves 表得到 templateId，再委托 fromTemplateId（走进程级缓存）。
   * 保留供旧调用点/测试使用，新代码应优先用 fromTemplateId。
   */
  static async fromSaveId(db: import('knex').Knex, saveId: string): Promise<TemplateRuleParser> {
    try {
      const saveRow = await db('saves').where({ id: saveId }).first();
      const templateId = saveRow?.template_id;
      if (!templateId) return new TemplateRuleParser({});
      return TemplateRuleParser.fromTemplateId(db, templateId);
    } catch (error) {
      logger.warn('Failed to load template rules from database, using defaults', {
        saveId,
        error: getErrorMessage(error),
      });
      return new TemplateRuleParser({});
    }
  }

  /**
   * 从 templates 表加载模板规则源（从原 fromSaveId 提取，供 fromTemplateId 复用）。
   *
   * 从 raw_content YAML 解析 game_rules/character_creation/special_rules
   * （迁移067后这些列已删除，统一从 raw_content 解析）。
   */
  private static async loadTemplateSource(db: import('knex').Knex, templateId: string): Promise<TemplateRuleSource> {
    const source: TemplateRuleSource = {};
    try {
      const templateRow = await db('templates').where({ id: templateId }).first();
      if (!templateRow) return source;

      if (templateRow.raw_content) {
        try {
          const yaml = await import('js-yaml');
          const parsed = yaml.load(templateRow.raw_content as string, { schema: yaml.DEFAULT_SCHEMA }) as Record<string, unknown>;
          source.game_rules = (parsed.game_rules as Record<string, unknown> | undefined) ?? undefined;
          source.character_creation = (parsed.character_creation as Record<string, unknown> | undefined) ?? undefined;
          source.special_rules = (parsed.special_rules as Record<string, unknown> | undefined) ?? undefined;
        } catch (parseError) {
          logger.warn('Failed to parse raw_content for template rules', {
            templateId,
            error: getErrorMessage(parseError),
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to load template from database', {
        templateId,
        error: getErrorMessage(error),
      });
    }
    return source;
  }

  /**
   * 主动失效：清除指定 templateId 的缓存（template 更新/删除时调用）。
   */
  static invalidate(templateId: string): void {
    TemplateRuleParser.cache.delete(templateId);
  }

  /**
   * 清空所有进程级缓存（测试用）。
   */
  static clearCache(): void {
    TemplateRuleParser.cache.clear();
  }

  getCombatRules(): Required<CombatRuleSet> {
    if (this.combatRulesCache) return this.combatRulesCache;

    const raw = this.source.game_rules?.combat_system as Partial<CombatRuleSet> | undefined;
    if (!raw) {
      this.combatRulesCache = { ...DEFAULT_COMBAT_RULES };
      return this.combatRulesCache;
    }

    this.combatRulesCache = {
      type: raw.type ?? DEFAULT_COMBAT_RULES.type,
      initiative_type: raw.initiative_type ?? DEFAULT_COMBAT_RULES.initiative_type,
      custom_initiative: raw.custom_initiative ?? DEFAULT_COMBAT_RULES.custom_initiative,
      action_points: raw.action_points ?? DEFAULT_COMBAT_RULES.action_points,
      critical_hit: {
        threshold: raw.critical_hit?.threshold ?? DEFAULT_COMBAT_RULES.critical_hit.threshold,
        multiplier: raw.critical_hit?.multiplier ?? DEFAULT_COMBAT_RULES.critical_hit.multiplier,
      },
      flee: {
        base_chance: raw.flee?.base_chance ?? DEFAULT_COMBAT_RULES.flee.base_chance,
        per_dead_enemy_bonus: raw.flee?.per_dead_enemy_bonus ?? DEFAULT_COMBAT_RULES.flee.per_dead_enemy_bonus,
      },
      defend: {
        damage_reduction: raw.defend?.damage_reduction ?? DEFAULT_COMBAT_RULES.defend.damage_reduction,
      },
      damage_formula: {
        attack_contribution: raw.damage_formula?.attack_contribution ?? DEFAULT_COMBAT_RULES.damage_formula.attack_contribution,
        defense_reduction: raw.damage_formula?.defense_reduction ?? DEFAULT_COMBAT_RULES.damage_formula.defense_reduction,
        level_bonus_factor: raw.damage_formula?.level_bonus_factor ?? DEFAULT_COMBAT_RULES.damage_formula.level_bonus_factor,
        variance_min: raw.damage_formula?.variance_min ?? DEFAULT_COMBAT_RULES.damage_formula.variance_min,
        variance_range: raw.damage_formula?.variance_range ?? DEFAULT_COMBAT_RULES.damage_formula.variance_range,
      },
      enemy_ai: {
        skill_use_chance: raw.enemy_ai?.skill_use_chance ?? DEFAULT_COMBAT_RULES.enemy_ai.skill_use_chance,
      },
      element_affinities: raw.element_affinities ?? DEFAULT_COMBAT_RULES.element_affinities,
      defaults: {
        potion_heal: raw.defaults?.potion_heal ?? DEFAULT_COMBAT_RULES.defaults.potion_heal,
        mana_potion_restore: raw.defaults?.mana_potion_restore ?? DEFAULT_COMBAT_RULES.defaults.mana_potion_restore,
        skill_cost_default: raw.defaults?.skill_cost_default ?? raw.defaults?.skill_mana_cost ?? DEFAULT_COMBAT_RULES.defaults.skill_cost_default,
        skill_damage_multiplier: raw.defaults?.skill_damage_multiplier ?? DEFAULT_COMBAT_RULES.defaults.skill_damage_multiplier,
        skill_base_damage_factor: raw.defaults?.skill_base_damage_factor ?? DEFAULT_COMBAT_RULES.defaults.skill_base_damage_factor,
        attribute_fallback: raw.defaults?.attribute_fallback ?? DEFAULT_COMBAT_RULES.defaults.attribute_fallback,
        enemy_speed_factor: raw.defaults?.enemy_speed_factor ?? DEFAULT_COMBAT_RULES.defaults.enemy_speed_factor,
      },
    };

    return this.combatRulesCache;
  }

  getSkillRules(): SkillRuleSet {
    if (this.skillRulesCache) return this.skillRulesCache;

    const raw = this.source.game_rules?.skill_system as Partial<SkillRuleSet> | undefined;
    if (!raw) {
      this.skillRulesCache = { ...DEFAULT_SKILL_RULES };
      return this.skillRulesCache;
    }

    this.skillRulesCache = {
      max_level: raw.max_level ?? DEFAULT_SKILL_RULES.max_level,
      cooldown_system: raw.cooldown_system ?? DEFAULT_SKILL_RULES.cooldown_system,
      upgrade_cost: {
        base: raw.upgrade_cost?.base ?? DEFAULT_SKILL_RULES.upgrade_cost.base,
        multiplier: raw.upgrade_cost?.multiplier ?? DEFAULT_SKILL_RULES.upgrade_cost.multiplier,
      },
      weight_cooldown: raw.weight_cooldown
        ? this.parseWeightCooldown(raw.weight_cooldown)
        : undefined,
    };

    return this.skillRulesCache;
  }

  private parseWeightCooldown(raw: Partial<WeightCooldownConfig>): WeightCooldownConfig | undefined {
    if (!raw || raw.enabled !== true) return undefined;
    return {
      enabled: true,
      weight_factor: raw.weight_factor ?? 1.5,
      max_multiplier: raw.max_multiplier ?? 3.0,
      reset_after: raw.reset_after ?? 3,
      reset_unit: raw.reset_unit ?? 'turn',
    };
  }

  getWeightCooldownConfig(): WeightCooldownConfig | null {
    const skillRules = this.getSkillRules();
    return skillRules.weight_cooldown ?? null;
  }

  getInventoryRules(): Required<InventoryRuleSet> {
    if (this.inventoryRulesCache) return this.inventoryRulesCache;

    const raw = this.source.game_rules?.inventory_system as Partial<InventoryRuleSet> | undefined;
    if (!raw) {
      this.inventoryRulesCache = { ...DEFAULT_INVENTORY_RULES };
      return this.inventoryRulesCache;
    }

    this.inventoryRulesCache = {
      max_slots: raw.max_slots ?? DEFAULT_INVENTORY_RULES.max_slots,
      weight_system: raw.weight_system ?? DEFAULT_INVENTORY_RULES.weight_system,
      stack_sizes: raw.stack_sizes ?? DEFAULT_INVENTORY_RULES.stack_sizes,
      equipment_slots: raw.equipment_slots ?? DEFAULT_INVENTORY_RULES.equipment_slots,
    };

    return this.inventoryRulesCache;
  }

  getQuestRules(): Required<QuestRuleSet> {
    if (this.questRulesCache) return this.questRulesCache;

    const raw = this.source.game_rules?.quest_system as Partial<QuestRuleSet> | undefined;
    if (!raw) {
      this.questRulesCache = { ...DEFAULT_QUEST_RULES };
      return this.questRulesCache;
    }

    this.questRulesCache = {
      max_active: raw.max_active ?? DEFAULT_QUEST_RULES.max_active,
      time_system: raw.time_system ?? DEFAULT_QUEST_RULES.time_system,
      fail_conditions: raw.fail_conditions ?? DEFAULT_QUEST_RULES.fail_conditions,
    };

    return this.questRulesCache;
  }

  getAttributeRoleMapping(): AttributeRoleMapping {
    if (this.attributeRoleMappingCache) return this.attributeRoleMappingCache;

    const raw = this.source.character_creation?.attribute_role_mapping as Partial<AttributeRoleMapping> | undefined;
    if (!raw) {
      this.attributeRoleMappingCache = { ...DEFAULT_ATTRIBUTE_ROLE_MAPPING };
      return this.attributeRoleMappingCache;
    }

    this.attributeRoleMappingCache = {
      physical_power: raw.physical_power ?? DEFAULT_ATTRIBUTE_ROLE_MAPPING.physical_power,
      agility: raw.agility ?? DEFAULT_ATTRIBUTE_ROLE_MAPPING.agility,
      endurance: raw.endurance ?? DEFAULT_ATTRIBUTE_ROLE_MAPPING.endurance,
      mental_power: raw.mental_power ?? DEFAULT_ATTRIBUTE_ROLE_MAPPING.mental_power,
      perception: raw.perception ?? DEFAULT_ATTRIBUTE_ROLE_MAPPING.perception,
      influence: raw.influence ?? DEFAULT_ATTRIBUTE_ROLE_MAPPING.influence,
    };

    return this.attributeRoleMappingCache;
  }

  getSpecialRules(): Record<string, unknown> {
    if (this.specialRulesCache) return this.specialRulesCache;

    const raw = this.source.special_rules as Record<string, unknown> | undefined;
    if (!raw) {
      this.specialRulesCache = {};
      return this.specialRulesCache;
    }

    this.specialRulesCache = { ...raw };
    return this.specialRulesCache;
  }

  getDerivedAttributeFormulas(): Record<string, { base: number; coefficients: Record<string, number>; max?: number }> | null {
    const formulas = this.source.game_rules?.derived_attribute_formulas as
      Record<string, { base: number; coefficients: Record<string, number>; max?: number }> | undefined;
    return formulas ?? null;
  }

  getDecayCurves(): DecayCurveConfig | null {
    if (this.decayCurvesCache !== null) return this.decayCurvesCache;

    const raw = this.source.game_rules?.decay_curves as DecayCurveConfig | undefined;
    this.decayCurvesCache = raw ?? null;
    return this.decayCurvesCache;
  }
}
