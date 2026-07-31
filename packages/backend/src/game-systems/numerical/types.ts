import type { ID } from '../../../../shared/src/types/core.js';
import type { ElementAffinities } from '../../../../shared/src/types/template.js';
import type { Knex } from 'knex';

// [旧版5属性接口 - 已弃用，改用动态属性体系]
// export interface BaseAttributes {
//   strength: number;
//   agility: number;
//   intelligence: number;
//   vitality: number;
//   luck: number;
// }
export type BaseAttributes = Record<string, number>;

export interface DerivedAttributes {
  attack: number;
  defense: number;
  speed: number;
  critRate: number;
  critDamage: number;
  dodgeRate: number;
  blockRate: number;
  magicAttack: number;
  magicDefense: number;
  maxHealth?: number;
  maxMana?: number;
  [key: string]: number | undefined;
}

export interface DamageFormula {
  type: 'physical' | 'magical' | 'true' | 'fixed';
  basePower: number;
  scaling?: Array<{
    attribute: string;
    multiplier: number;
  }>;
  multiplier?: number;
  flatBonus?: number;
}

export interface DamageParams {
  attackerLevel: number;
  defenderLevel: number;
  attackerStat?: number;
  defenderDefense?: number;
  resistance?: number;
  vulnerability?: number;
  critRate?: number;
  critMultiplier?: number;
}

export interface DamageResult {
  finalDamage: number;
  baseDamage: number;
  isCritical: boolean;
  criticalMultiplier: number;
  type: string;
  breakdown: Record<string, unknown>;
}

export interface ExperienceParams {
  actionType: 'combat' | 'quest' | 'exploration' | 'crafting' | 'social';
  difficulty: number;
  level: number;
  bonusMultiplier?: number;
}

export interface ExperienceResult {
  experience: number;
  breakdown: Record<string, unknown>;
}

export interface LevelProgress {
  currentLevel: number;
  currentExp: number;
  expForNextLevel: number;
  expToNextLevel: number;
  totalExpForLevel: number;
  progressPercent: number;
  canLevelUp: boolean;
}

export interface LevelUpResult {
  previousLevel: number;
  newLevel: number;
  statIncreases: Record<string, number>;
  newAttributes: BaseAttributes;
  newMaxHealth: number;
  newMaxMana: number;
  healthRestored: number;
  manaRestored: number;
  noLevelUp?: boolean;
}

export interface DropTableItem {
  id: string;
  name: string;
  quality: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface LootResult {
  drops: Array<{ id: string; name: string; quality: string; quantity: number }>;
  totalItems: number;
  uniqueItems: number;
  dropped: boolean;
}

/**
 * Numerical 领域 Service 端口接口。
 * 供跨领域消费方（inventory/combat 等）注入使用，切断直接 new NumericalService 依赖。
 * S1-5 偏差 A: 初版仅暴露 recalculateDerivedAttributes/recalculateNpcAttributes（inventory 装备变更用）。
 * S3-2 Phase C: 扩展 getElementMultiplier（combat calculateDamage 跨领域调用）。
 * NumericalService 完整 Repository 化在 S4 进行。
 */
export interface INumericalService {
  /** 重算角色派生属性并持久化（装备变更后触发）。D9: 支持可选 trx 参数。 */
  recalculateDerivedAttributes(saveId: ID, trx?: Knex.Transaction): Promise<DerivedAttributes>;
  /** 重算 NPC 派生属性并持久化（NPC 装备变更后触发）。D9: 支持可选 trx 参数。 */
  recalculateNpcAttributes(saveId: string, npcId: string, trx?: Knex.Transaction): Promise<DerivedAttributes>;
  /**
   * 纯计算派生属性（不持久化，不查 DB）。
   * 用于 NPCService.updateNPC 传入 attributes 时自动派生 HP/MP（P0-2）。
   * 等同于 NumericalService.calculateDerivedAttributes 的纯计算版本。
   */
  calculateDerivedAttributes(baseAttrs: Partial<BaseAttributes>): DerivedAttributes;
  /** 查询元素克制倍率（combat calculateDamage 跨领域调用，S3-2 Phase C 扩展）。 */
  getElementMultiplier(attackerElement: string, defenderElement: string, affinities?: ElementAffinities): number;
}
