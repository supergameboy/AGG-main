import { createChildLogger } from '../../utils/logger.js';
import { ID } from '../../../../shared/src/types/core.js';
import type { Knex } from 'knex';
import type { AttributeRoleMapping, ElementAffinities } from '../../../../shared/src/types/template.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import { DecayCurveCalculator } from './DecayCurveCalculator.js';
import {
  EXPERIENCE_BASE_REWARDS,
  DEFAULT_EXPERIENCE_BASE_REWARD,
  calculateDerivedAttributesFallback,
  calculateTotalExpForLevel as sharedCalcTotalExpForLevel,
  calculatePhysicalDamage as sharedCalcPhysicalDamage,
  calculateMagicalDamage as sharedCalcMagicalDamage,
  calculateStatGrowth as sharedCalcStatGrowth,
} from './numerical-formulas.js';
import type {
  BaseAttributes,
  DerivedAttributes,
  DamageFormula,
  DamageParams,
  DamageResult,
  ExperienceParams,
  ExperienceResult,
  LevelProgress,
  LevelUpResult,
  DropTableItem,
  LootResult,
  INumericalService
} from './types.js';
import type { ICharacterRepository } from '../character/types.js';
import type { IInventoryRepository, InventoryItem } from '../inventory/types.js';
import type { INPCRepository } from '../npc/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';

export {
  BaseAttributes,
  DerivedAttributes,
  DamageFormula,
  DamageParams,
  DamageResult,
  ExperienceParams,
  ExperienceResult,
  LevelProgress,
  LevelUpResult,
  DropTableItem,
  LootResult
};

/**
 * NumericalService（S4 重构：移除 db 字段，注入 Repository + TransactionManager）。
 *
 * 依赖注入：
 * - ICharacterRepository: characters 表读写（recalculateDerivedAttributes/processLevelUp/addExperience/heal）
 * - IInventoryRepository: inventory 表只读查询装备（recalculateDerivedAttributes/recalculateNpcAttributes）
 * - INPCRepository: npcs 表读写（recalculateNpcAttributes）
 * - ITransactionManager: heal 事务边界管理（D10）
 * - TemplateRuleParser: 纯计算依赖，无 db 调用（保留构造函数注入）
 *
 * 13 处 db 调用全部迁移到 Repository：
 * - recalculateDerivedAttributes: characters 读+写 + inventory 读
 * - recalculateNpcAttributes: npcs 读+写 + inventory 读
 * - processLevelUp: characters 读+写
 * - addExperience: characters 读+写
 * - heal: characters 事务内读+写
 */
export class NumericalService implements INumericalService {
  private logger: ReturnType<typeof createChildLogger>;
  private ruleParser: TemplateRuleParser;
  private characterRepo: ICharacterRepository;
  private inventoryRepo: IInventoryRepository;
  private npcRepo: INPCRepository;
  private txManager: ITransactionManager;

  constructor(
    characterRepo: ICharacterRepository,
    inventoryRepo: IInventoryRepository,
    npcRepo: INPCRepository,
    txManager: ITransactionManager,
    ruleParser?: TemplateRuleParser,
  ) {
    this.logger = createChildLogger('service:numerical');
    this.ruleParser = ruleParser ?? new TemplateRuleParser();
    this.characterRepo = characterRepo;
    this.inventoryRepo = inventoryRepo;
    this.npcRepo = npcRepo;
    this.txManager = txManager;
  }

  getAttributeRoleMapping(): AttributeRoleMapping {
    return this.ruleParser.getAttributeRoleMapping();
  }

  calculateDerivedAttributes(baseAttrs: Partial<BaseAttributes>): DerivedAttributes {
    const mapping: AttributeRoleMapping = this.ruleParser.getAttributeRoleMapping();

    const roleToAttr: Record<string, number> = {
      physical_power: baseAttrs[mapping.physical_power] || 10,
      agility: baseAttrs[mapping.agility] || 10,
      mental_power: baseAttrs[mapping.mental_power] || 10,
      endurance: baseAttrs[mapping.endurance] || 10,
      perception: baseAttrs[mapping.perception] || 10,
      influence: baseAttrs[mapping.influence] || 10,
    };

    const derivedFormulas = this.ruleParser.getDerivedAttributeFormulas();
    if (derivedFormulas) {
      return this.calculateFromFormulas(roleToAttr, derivedFormulas);
    }

    return calculateDerivedAttributesFallback(roleToAttr) as unknown as DerivedAttributes;
  }

  parseItemBonusStats(item: { stats: unknown }): Record<string, number> {
    const bonuses: Record<string, number> = {};
    try {
      const stats = typeof item.stats === 'string' ? JSON.parse(item.stats) : item.stats;
      if (stats && typeof stats === 'object') {
        for (const [key, value] of Object.entries(stats as Record<string, unknown>)) {
          if (typeof value === 'number') {
            bonuses[key] = (bonuses[key] || 0) + value;
          }
        }
      }
    } catch {
      this.logger.warn('Failed to parse item stats', { itemId: (item as Record<string, unknown>).item_id });
    }
    return bonuses;
  }

  parseDisplayStatsBonus(customDataRaw: unknown): Record<string, number> {
    const bonuses: Record<string, number> = {};
    try {
      const customData = typeof customDataRaw === 'string' ? JSON.parse(customDataRaw) : customDataRaw;
      const displayStats = customData?.displayStats;
      if (!Array.isArray(displayStats)) return bonuses;
      for (const stat of displayStats) {
        if (!stat.key) continue;
        let numValue: number;
        if (typeof stat.value === 'number') {
          numValue = stat.value;
        } else if (typeof stat.value === 'string') {
          const parsed = parseFloat(stat.value.replace('+', ''));
          if (isNaN(parsed)) continue;
          numValue = parsed;
        } else {
          continue;
        }
        bonuses[stat.key] = (bonuses[stat.key] || 0) + numValue;
      }
    } catch {
      this.logger.warn('Failed to parse displayStats from custom_data');
    }
    return bonuses;
  }

  applyEquipmentBonuses(derived: DerivedAttributes, bonuses: Record<string, number>): DerivedAttributes {
    const finalDerived = { ...derived };
    for (const [key, bonus] of Object.entries(bonuses)) {
      if (key in finalDerived && typeof finalDerived[key as keyof DerivedAttributes] === 'number') {
        (finalDerived as Record<string, number>)[key] = (finalDerived[key as keyof DerivedAttributes] as number) + bonus;
      }
    }
    return finalDerived;
  }

  /**
   * 根据 saveId 重新计算角色派生属性并持久化。
   * 读取角色 base attributes + 已装备物品 bonuses，计算 derived attributes，写入 characters 表。
   *
   * 装备查询策略：先查 character.id（characters 表主键），再用 ownerId 查 inventory 表。
   * 这比原代码（不指定 owner_id）更精确，符合 InventoryService.addItem 的 owner_id=character.id 约定。
   */
  async recalculateDerivedAttributes(saveId: ID, trx?: Knex.Transaction): Promise<DerivedAttributes> {
    const character = await this.characterRepo.findById(saveId, trx);
    if (!character) {
      throw new Error(`Character not found for save: ${saveId}`);
    }

    const baseAttrs: Partial<BaseAttributes> = JSON.parse(character.attributes);
    const derived = this.calculateDerivedAttributes(baseAttrs);

    const equippedItems = await this.inventoryRepo.findEquippedBySaveIdAndOwner(
      saveId,
      'character',
      character.id,
      trx,
    );

    const equipmentBonuses = this.collectEquipmentBonuses(equippedItems);
    const finalDerived = this.applyEquipmentBonuses(derived, equipmentBonuses);

    await this.characterRepo.updateDerivedAttributes(
      saveId,
      finalDerived as unknown as Record<string, unknown>,
      finalDerived.maxHealth ?? 0,
      finalDerived.maxMana ?? 0,
      derived.maxHealth ?? 0,
      derived.maxMana ?? 0,
      undefined,
      undefined,
      trx,
    );

    this.logger.info('Derived attributes recalculated with equipment bonuses', { saveId, equipmentBonuses });

    return finalDerived;
  }

  /**
   * 根据 npcId 重新计算 NPC 派生属性并持久化。
   * 读取 NPC base attributes + 已装备物品 bonuses，计算 derived attributes，写入 npcs 表。
   * 同时更新 current_hp/current_mp（clamp 到新 maxHp/maxMp）。
   */
  async recalculateNpcAttributes(saveId: string, npcId: string, trx?: Knex.Transaction): Promise<DerivedAttributes> {
    const npc = await this.npcRepo.findById(npcId as ID, saveId as ID, trx);
    if (!npc) {
      throw new Error(`NPC not found: ${npcId}`);
    }

    const baseAttrs: Partial<BaseAttributes> = (npc.attributes as Partial<BaseAttributes>) || {};
    const derived = this.calculateDerivedAttributes(baseAttrs);

    const equippedItems = await this.inventoryRepo.findEquippedBySaveIdAndOwner(
      saveId,
      'npc',
      npcId,
      trx,
    );

    const equipmentBonuses = this.collectEquipmentBonuses(equippedItems);
    const finalDerived = this.applyEquipmentBonuses(derived, equipmentBonuses);

    const newMaxHp = finalDerived.maxHealth ?? 100;
    const newMaxMp = finalDerived.maxMana ?? 50;
    const currentHp = npc.currentHp != null ? Math.min(npc.currentHp, newMaxHp) : newMaxHp;
    const currentMp = npc.currentMp != null ? Math.min(npc.currentMp, newMaxMp) : newMaxMp;

    await this.npcRepo.update(npcId as ID, saveId as ID, {
      derivedAttributes: finalDerived as unknown as Record<string, unknown>,
      maxHp: newMaxHp,
      maxMp: newMaxMp,
      currentHp,
      currentMp,
    }, trx);

    this.logger.info('NPC attributes recalculated with equipment bonuses', { saveId, npcId, equipmentBonuses });

    return finalDerived;
  }

  /**
   * 从已装备物品列表收集装备 bonuses（stats + displayStats fallback）。
   * 提取共享逻辑，供 character 和 NPC 重算使用。
   */
  private collectEquipmentBonuses(equippedItems: InventoryItem[]): Record<string, number> {
    const equipmentBonuses: Record<string, number> = {};
    for (const item of equippedItems) {
      let itemBonuses = this.parseItemBonusStats(item);
      if (Object.keys(itemBonuses).length === 0 && item.customData) {
        itemBonuses = this.parseDisplayStatsBonus(item.customData);
      }
      for (const [key, value] of Object.entries(itemBonuses)) {
        equipmentBonuses[key] = (equipmentBonuses[key] || 0) + value;
      }
    }
    return equipmentBonuses;
  }

  private calculateFromFormulas(roleToAttr: Record<string, number>, derivedFormulas: Record<string, { base: number; coefficients: Record<string, number>; max?: number }>): DerivedAttributes {
    const result: Record<string, number> = {};

    for (const [attrName, formula] of Object.entries(derivedFormulas)) {
      let value = formula.base;
      for (const [role, coefficient] of Object.entries(formula.coefficients)) {
        value += (roleToAttr[role] || 10) * coefficient;
      }
      if (formula.max !== undefined) {
        value = Math.min(formula.max, value);
      }
      if (['maxHealth', 'maxMana', 'attack', 'defense', 'magicAttack', 'magicDefense', 'speed'].includes(attrName)) {
        value = Math.floor(value);
      } else {
        value = parseFloat(value.toFixed(4));
      }
      result[attrName] = value;
    }

    return result as unknown as DerivedAttributes;
  }

  calculateDamage(formula: DamageFormula, params: DamageParams): DamageResult {
    let damage: number;

    switch (formula.type) {
      case 'physical':
        damage = this.calcPhysicalDamage(formula, params);
        break;
      case 'magical':
        damage = this.calcMagicalDamage(formula, params);
        break;
      case 'true':
        damage = formula.basePower;
        break;
      case 'fixed':
        damage = formula.basePower;
        break;
      default:
        throw new Error(`Unknown damage type: ${formula.type}`);
    }

    if (formula.flatBonus) damage += formula.flatBonus;
    if (formula.multiplier) damage = Math.floor(damage * formula.multiplier);
    if (params.resistance) damage = Math.floor(damage * (1 - params.resistance));
    if (params.vulnerability) damage = Math.floor(damage * (1 + params.vulnerability));

    damage = Math.max(1, damage);

    const isCritical = Math.random() < (params.critRate ?? 0.1);
    const criticalMultiplier = params.critMultiplier ?? 1.5;
    const finalDamage = isCritical ? Math.floor(damage * criticalMultiplier) : damage;

    return {
      finalDamage,
      baseDamage: damage,
      isCritical,
      criticalMultiplier: isCritical ? 1.5 : 1,
      type: formula.type,
      breakdown: {
        formulaType: formula.type,
        basePower: formula.basePower,
        scaling: formula.scaling,
        resistanceApplied: params.resistance || 0,
        vulnerabilityApplied: params.vulnerability || 0
      }
    };
  }

  calculateExperience(params: ExperienceParams): ExperienceResult {
    const baseValue = EXPERIENCE_BASE_REWARDS[params.actionType] || DEFAULT_EXPERIENCE_BASE_REWARD;
    const difficultyMultiplier = 1 + (params.difficulty - 1) * 0.5;
    const levelPenalty = Math.max(0.1, 1 - ((params.level - 1) * 0.02));

    let expReward = baseValue * difficultyMultiplier * levelPenalty;
    if (params.bonusMultiplier) expReward *= params.bonusMultiplier;

    expReward = Math.floor(expReward);
    const variance = 0.9 + Math.random() * 0.2;
    const finalExp = Math.floor(expReward * variance);

    return {
      experience: finalExp,
      breakdown: {
        baseValue,
        difficultyMultiplier: parseFloat(difficultyMultiplier.toFixed(2)),
        levelPenalty: parseFloat(levelPenalty.toFixed(2)),
        beforeVariance: expReward,
        variance: parseFloat(variance.toFixed(3))
      }
    };
  }

  getLevelProgress(currentExp: number, level: number): LevelProgress {
    const totalExpForLevel = this.calcTotalExpForLevel(level);
    const totalExpForNextLevel = this.calcTotalExpForLevel(level + 1);
    const expToNextLevel = totalExpForNextLevel - currentExp;
    const expForThisLevel = totalExpForNextLevel - totalExpForLevel;
    const expInCurrentLevel = currentExp - totalExpForLevel;
    const progressPercent = Math.min(100, Math.max(0, (expInCurrentLevel / expForThisLevel) * 100));

    return {
      currentLevel: level,
      currentExp,
      expForNextLevel: totalExpForNextLevel,
      expToNextLevel: Math.max(0, expToNextLevel),
      totalExpForLevel,
      progressPercent: parseFloat(progressPercent.toFixed(2)),
      canLevelUp: currentExp >= totalExpForNextLevel
    };
  }

  /**
   * 处理角色升级。
   * 读取角色当前等级和经验，若满足升级条件则提升等级、增长属性、重算派生属性。
   *
   * 更新策略：分两次 Repository 调用（updateLevel + updateBaseAttributes），
   * 因为 Repository 接口按字段职责分方法，不提供合并更新。
   */
  async processLevelUp(saveId: ID): Promise<LevelUpResult> {
    const character = await this.characterRepo.findById(saveId);
    if (!character) {
      throw new Error(`Character not found for save: ${saveId}`);
    }

    const currentLevel = character.level;
    const currentExp = character.experience;
    const expNeeded = this.calcTotalExpForLevel(currentLevel + 1);

    if (currentExp < expNeeded) {
      return {
        previousLevel: currentLevel,
        newLevel: currentLevel,
        statIncreases: {},
        newAttributes: JSON.parse(character.attributes),
        newMaxHealth: 0,
        newMaxMana: 0,
        healthRestored: 0,
        manaRestored: 0,
        noLevelUp: true
      };
    }

    const newLevel = currentLevel + 1;
    const statGrowth = this.calcStatGrowth(currentLevel);

    const oldAttrs: BaseAttributes = JSON.parse(character.attributes);
    const mapping: AttributeRoleMapping = this.ruleParser.getAttributeRoleMapping();

    const newAttrs: BaseAttributes = {};
    for (const [role, attrId] of Object.entries(mapping) as [string, string][]) {
      newAttrs[attrId] = (oldAttrs[attrId] || 10) + (statGrowth[role] || 0);
    }

    const derived = this.calculateDerivedAttributes(newAttrs);

    await this.characterRepo.updateLevel(saveId, newLevel);
    await this.characterRepo.updateBaseAttributes(
      saveId,
      newAttrs as unknown as Record<string, unknown>,
      derived.maxHealth ?? 0,
      derived.maxMana ?? 0,
    );

    const finalDerived = await this.recalculateDerivedAttributes(saveId);

    this.logger.info(`Character leveled up to ${newLevel}`, { saveId });

    return {
      previousLevel: currentLevel,
      newLevel,
      statIncreases: statGrowth,
      newAttributes: newAttrs,
      newMaxHealth: finalDerived.maxHealth ?? 0,
      newMaxMana: finalDerived.maxMana ?? 0,
      healthRestored: (finalDerived.maxHealth ?? 0) - character.current_hp,
      manaRestored: (finalDerived.maxMana ?? 0) - character.current_mp
    };
  }

  /**
   * 增加角色经验值，若满足升级条件则自动触发升级。
   */
  async addExperience(saveId: ID, amount: number): Promise<{ leveledUp: boolean; newLevel?: number }> {
    const character = await this.characterRepo.findById(saveId);
    if (!character) {
      throw new Error(`Character not found for save: ${saveId}`);
    }

    const newExp = character.experience + amount;
    const expNeeded = this.calcTotalExpForLevel(character.level + 1);

    await this.characterRepo.updateExperience(saveId, newExp);

    if (newExp >= expNeeded) {
      const result = await this.processLevelUp(saveId);
      return { leveledUp: true, newLevel: result.newLevel };
    }

    return { leveledUp: false };
  }

  calculateLoot(dropTable: DropTableItem[]): LootResult {
    const drops: Array<{ id: string; name: string; quality: string; quantity: number }> = [];

    for (const item of dropTable) {
      if (Math.random() * 100 <= item.chance) {
        const quantity = item.minQuantity === item.maxQuantity
          ? item.minQuantity
          : Math.floor(Math.random() * (item.maxQuantity - item.minQuantity + 1)) + item.minQuantity;

        drops.push({ id: item.id, name: item.name, quality: item.quality, quantity });
      }
    }

    return {
      drops,
      totalItems: drops.reduce((sum, d) => sum + d.quantity, 0),
      uniqueItems: drops.length,
      dropped: drops.length > 0
    };
  }

  /**
   * 治疗角色（恢复 HP 和 MP）。
   * 在事务内读取当前 HP/MP，计算恢复值，写回 characters 表。
   * HP 恢复 100%，MP 恢复 50%（向下取整）。
   */
  async heal(saveId: ID, amount: number): Promise<{ amount: number; healthHealed: number; manaRestored: number; newHealth: number; newMana: number }> {
    return this.txManager.transaction(async (trx) => {
      const character = await this.characterRepo.findById(saveId, trx);
      if (!character) throw new Error(`Character not found: ${saveId}`);

      const newHealth = Math.min(character.max_hp, character.current_hp + amount);
      const newMana = Math.min(character.max_mp, character.current_mp + Math.floor(amount * 0.5));

      await this.characterRepo.updateHealth(saveId, newHealth, newMana, trx);

      return {
        amount,
        healthHealed: newHealth - character.current_hp,
        manaRestored: newMana - character.current_mp,
        newHealth,
        newMana
      };
    });
  }

  private calcPhysicalDamage(formula: DamageFormula, params: DamageParams): number {
    const totalScalingRatio = formula.scaling?.reduce((sum, s) => sum + s.multiplier, 0);
    return sharedCalcPhysicalDamage(
      formula.basePower,
      params.attackerStat,
      totalScalingRatio,
      params.defenderDefense,
      params.attackerLevel || 1,
      params.defenderLevel || 1
    );
  }

  private calcMagicalDamage(formula: DamageFormula, params: DamageParams): number {
    const totalScalingRatio = formula.scaling?.reduce((sum, s) => sum + s.multiplier, 0);
    return sharedCalcMagicalDamage(
      formula.basePower,
      params.attackerStat,
      totalScalingRatio,
      params.defenderDefense,
      params.attackerLevel || 1,
      params.defenderLevel || 1
    );
  }

  private calcTotalExpForLevel(level: number): number {
    return sharedCalcTotalExpForLevel(level);
  }

  private calcStatGrowth(currentLevel: number): Record<string, number> {
    return sharedCalcStatGrowth(currentLevel);
  }

  /**
   * Apply a named decay curve to a value, reducing it by one tick.
   * Falls back to the default curve if curveName is not found, or to a simple
   * linear decay if no curves are configured.
   */
  applyDecay(currentValue: number, curveName?: string, deltaTime: number = 1): number {
    const decayConfig = this.ruleParser.getDecayCurves();
    const curve = DecayCurveCalculator.getCurve(
      decayConfig?.curves,
      curveName,
      decayConfig?.default_curve
    );
    return DecayCurveCalculator.applyDecay(currentValue, curve, deltaTime);
  }

  /**
   * 计算元素克制倍率
   * @param attackerElement 攻击方元素
   * @param defenderElement 防御方元素
   * @param affinities 元素克制关系表（来自模板 game_rules.combat_system.element_affinities）
   * @returns 倍率（1.0=无修正, 1.5=强克制, 0.75=被克制）
   */
  getElementMultiplier(attackerElement: string, defenderElement: string, affinities?: ElementAffinities): number {
    if (!affinities || !attackerElement || !defenderElement) return 1.0;
    const attackerAffinities = affinities[attackerElement];
    if (!attackerAffinities) return 1.0;
    const multiplier = attackerAffinities[defenderElement];
    return multiplier ?? 1.0;
  }
}
