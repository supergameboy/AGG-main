import { describe, expect, it, vi } from 'vitest';
import { CombatService } from '../CombatService.js';
import type { CombatParticipant, DamageBreakdown } from '../types.js';

const FIRE_STRONG_AGAINST_SHADOW: Record<string, Record<string, number>> = {
  fire: { water: 0.75, shadow: 1.5 },
  water: { fire: 1.5, arcane: 0.75 },
  arcane: { water: 1.5, holy: 0.75 },
  holy: { shadow: 1.5, arcane: 0.75 },
  shadow: { holy: 1.5, fire: 0.75 },
};

const mockCombatRules = {
  defaults: {
    skill_cost_default: 10,
    skill_damage_multiplier: 1.5,
    skill_base_damage_factor: 2,
    potion_heal: 50,
    mana_potion_restore: 30,
    attribute_fallback: 10,
    enemy_speed_factor: 5,
  },
  damage_formula: {
    level_bonus_factor: 0.5,
    attack_contribution: 0.3,
    defense_reduction: 0.5,
    variance_min: 1.0,
    variance_range: 0.0,
  },
  defend: { damage_reduction: 0.5 },
  critical_hit: { threshold: 0, multiplier: 2 },
  enemy_ai: { skill_use_chance: 0 },
  element_affinities: FIRE_STRONG_AGAINST_SHADOW,
};

function createService(elementAffinities?: Record<string, Record<string, number>>) {
  const mockCombatRepo = {
    findBySaveId: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    deleteBySaveId: vi.fn().mockResolvedValue(undefined),
  };
  const mockTxManager = { transaction: vi.fn(async (work: (trx: unknown) => Promise<unknown>) => work({})) };
  const mockRuleParser = {
    getCombatRules: () => ({
      ...mockCombatRules,
      element_affinities: elementAffinities ?? FIRE_STRONG_AGAINST_SHADOW,
    }),
  };
  const mockNumericalService = {
    getElementMultiplier: (attackerElement: string, defenderElement: string, affinities?: Record<string, Record<string, number>>) => {
      if (!affinities || !attackerElement || !defenderElement) return 1.0;
      const attackerAffinities = affinities[attackerElement];
      if (!attackerAffinities) return 1.0;
      return attackerAffinities[defenderElement] ?? 1.0;
    },
  };

  // 阶段二：CombatService 委托给策略，calculateDamage 通过 strategy.calculateDamage 调用
  // 测试用最小化 mock strategy（仅实现 calculateDamage + mode 字段）
  const mockStrategy = {
    mode: 'turn_based_combat' as const,
    calculateDamage: (attacker: any, defender: any, skill?: any) => {
      const baseAttack = attacker.attack;
      const skillMult = skill?.multiplier || 1.0;
      const baseDamage = skill?.baseDamage || baseAttack;
      const combatRules = mockRuleParser.getCombatRules();
      const levelBonusFactor = combatRules.damage_formula.level_bonus_factor;
      const attackContribution = combatRules.damage_formula.attack_contribution;
      const defenseReductionCoeff = combatRules.damage_formula.defense_reduction;
      const defendReduction = combatRules.defend.damage_reduction;
      const varianceMin = combatRules.damage_formula.variance_min;
      const varianceRange = combatRules.damage_formula.variance_range;

      const levelBonus = Math.max(0, (attacker.level - defender.level) * levelBonusFactor);
      const rawDamage = baseDamage * skillMult + attacker.attack * attackContribution + levelBonus;
      const defenseReduction = defender.defense * defenseReductionCoeff;
      let reducedDamage = rawDamage - defenseReduction;
      if (defender.isDefending) {
        reducedDamage *= (1 - defendReduction);
      }
      reducedDamage = Math.max(1, reducedDamage);
      const variance = varianceMin + Math.random() * varianceRange;
      const varianceDamage = reducedDamage * variance;

      const elementAffinitiesMap = combatRules.element_affinities;
      const attackElement = skill?.element ?? attacker.element ?? '';
      const elementMultiplier = mockNumericalService.getElementMultiplier(
        attackElement,
        defender.element ?? '',
        elementAffinitiesMap,
      );
      const elementDamage = varianceDamage * elementMultiplier;

      const effectiveCriticalChance = (combatRules.critical_hit as any).threshold / 20;
      const effectiveCriticalMultiplier = (combatRules.critical_hit as any).multiplier;
      const isCritical = Math.random() < effectiveCriticalChance;
      const criticalMultiplier = isCritical ? effectiveCriticalMultiplier : 1;
      const finalDamage = Math.floor(elementDamage * criticalMultiplier);

      return {
        baseAttack,
        skillMultiplier: skillMult,
        levelBonus,
        defenseReduction: defender.defense * defenseReductionCoeff + (defender.isDefending ? reducedDamage * defendReduction : 0),
        variance: parseFloat(variance.toFixed(3)),
        criticalMultiplier,
        elementMultiplier: parseFloat(elementMultiplier.toFixed(3)),
        finalDamage,
        isCritical,
      };
    },
  };

  return new CombatService(
    mockStrategy as any,
    mockCombatRepo as any,
    mockTxManager as any,
  );
}

function createAttacker(overrides?: Partial<CombatParticipant>): CombatParticipant {
  return {
    id: 'attacker',
    name: 'Fire Mage',
    isPlayer: true,
    ownerType: 'character',
    ownerId: 'attacker',
    currentHP: 100,
    maxHP: 100,
    currentMP: 50,
    maxMP: 50,
    attack: 20,
    defense: 10,
    speed: 15,
    level: 5,
    statusEffects: [],
    isDefending: false,
    ...overrides,
  };
}

function createDefender(overrides?: Partial<CombatParticipant>): CombatParticipant {
  return {
    id: 'defender',
    name: 'Shadow Creature',
    isPlayer: false,
    ownerType: 'npc',
    ownerId: 'defender',
    currentHP: 100,
    maxHP: 100,
    currentMP: 30,
    maxMP: 30,
    attack: 15,
    defense: 5,
    speed: 10,
    level: 3,
    statusEffects: [],
    isDefending: false,
    ...overrides,
  };
}

describe('CombatService — 元素克制伤害计算', () => {
  it('技能元素克制防御方元素时，伤害乘以1.5', () => {
    const service = createService();
    const attacker = createAttacker();
    const defender = createDefender({ element: 'shadow' });

    const noElementBreakdown = service.calculateDamage(attacker, createDefender());
    const strongBreakdown = service.calculateDamage(attacker, defender, { element: 'fire' });

    expect(strongBreakdown.elementMultiplier).toBe(1.5);
    expect(strongBreakdown.finalDamage).toBe(Math.floor(noElementBreakdown.finalDamage * 1.5));
  });

  it('技能元素被防御方克制时，伤害乘以0.75', () => {
    const service = createService();
    const attacker = createAttacker();
    const defender = createDefender({ element: 'water' });

    const noElementBreakdown = service.calculateDamage(attacker, createDefender());
    const weakBreakdown = service.calculateDamage(attacker, defender, { element: 'fire' });

    expect(weakBreakdown.elementMultiplier).toBe(0.75);
    expect(weakBreakdown.finalDamage).toBe(Math.floor(noElementBreakdown.finalDamage * 0.75));
  });

  it('无元素克制关系时，倍率为1.0', () => {
    const service = createService();
    const attacker = createAttacker();
    const defender = createDefender({ element: 'holy' });

    const breakdown = service.calculateDamage(attacker, defender, { element: 'fire' });

    expect(breakdown.elementMultiplier).toBe(1.0);
  });

  it('攻击方无元素时，倍率为1.0', () => {
    const service = createService();
    const attacker = createAttacker();
    const defender = createDefender({ element: 'shadow' });

    const breakdown = service.calculateDamage(attacker, defender);

    expect(breakdown.elementMultiplier).toBe(1.0);
  });

  it('防御方无元素时，倍率为1.0', () => {
    const service = createService();
    const attacker = createAttacker();
    const defender = createDefender();

    const breakdown = service.calculateDamage(attacker, defender, { element: 'fire' });

    expect(breakdown.elementMultiplier).toBe(1.0);
  });

  it('无克制关系表时，倍率为1.0', () => {
    const service = createService({});
    const attacker = createAttacker();
    const defender = createDefender({ element: 'shadow' });

    const breakdown = service.calculateDamage(attacker, defender, { element: 'fire' });

    expect(breakdown.elementMultiplier).toBe(1.0);
  });

  it('DamageBreakdown 包含 elementMultiplier 字段', () => {
    const service = createService();
    const attacker = createAttacker();
    const defender = createDefender({ element: 'shadow' });

    const breakdown: DamageBreakdown = service.calculateDamage(attacker, defender, { element: 'fire' });

    expect(breakdown).toHaveProperty('elementMultiplier');
    expect(typeof breakdown.elementMultiplier).toBe('number');
  });

  it('攻击方自身元素作为回退：技能无元素时使用攻击者元素', () => {
    const service = createService();
    const attacker = createAttacker({ element: 'water' });
    const defender = createDefender({ element: 'fire' });

    const breakdown = service.calculateDamage(attacker, defender);

    expect(breakdown.elementMultiplier).toBe(1.5);
  });
});
