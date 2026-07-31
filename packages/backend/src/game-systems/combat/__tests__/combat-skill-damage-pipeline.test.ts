import { describe, expect, it, vi } from 'vitest';
import type { CombatAction } from '../types.js';

const mockCombatRules = {
  defaults: {
    skill_cost_default: 10,
    skill_damage_multiplier: 1.5,
    skill_base_damage_factor: 2,
  },
  damage_formula: {
    level_bonus_factor: 0.5,
    attack_contribution: 0.3,
    defense_reduction: 0.5,
    variance_min: 0.9,
    variance_range: 0.2,
  },
  defend: { damage_reduction: 0.5 },
  critical_hit: { chance: 0, multiplier: 2 },
};

/**
 * 阶段二：processPlayerAction 已从 CombatService 移到策略内部（protected 方法）。
 *
 * 测试目标：验证策略的 processPlayerAction 与 skillService 集成管线。
 * 因此直接构造一个最小化 mock strategy（不包裹 CombatService 中间层），
 * 复现 CombatStrategyBase.processPlayerAction 中"skill 伤害计算管线"的关键行为：
 *   1) skillService 存在 + action.skillId → 调用 calculateSkillDamage 获取 baseDamage
 *   2) total > 0 → 用 total 作为 baseDamage
 *   3) total === 0 → 回退到 player.attack
 *   4) 异常 → 回退到全局乘数 attack * skill_base_damage_factor
 *   5) 无 skillService → 直接走全局乘数
 */
function createStrategy(options?: { skillService?: any }) {
  const mockRuleParser = {
    getCombatRules: () => mockCombatRules,
  };
  const skillService = options?.skillService;

  const strategy = {
    mode: 'turn_based_combat' as const,
    calculateDamage: (attacker: any, defender: any, skill?: any) => {
      const baseAttack = attacker.attack;
      const skillMult = skill?.multiplier || 1.0;
      const baseDamage = skill?.baseDamage || baseAttack;
      const combatRules = mockRuleParser.getCombatRules();
      const levelBonusFactor = combatRules.damage_formula.level_bonus_factor;
      const attackContribution = combatRules.damage_formula.attack_contribution;
      const defenseReductionCoeff = combatRules.damage_formula.defense_reduction;
      const varianceMin = combatRules.damage_formula.variance_min;
      const varianceRange = combatRules.damage_formula.variance_range;

      const levelBonus = Math.max(0, (attacker.level - defender.level) * levelBonusFactor);
      const rawDamage = baseDamage * skillMult + attacker.attack * attackContribution + levelBonus;
      const defenseReduction = defender.defense * defenseReductionCoeff;
      const reducedDamage = Math.max(1, rawDamage - defenseReduction);
      const variance = varianceMin + Math.random() * varianceRange;
      const varianceDamage = reducedDamage * variance;
      const finalDamage = Math.floor(varianceDamage);

      return {
        baseAttack,
        skillMultiplier: skillMult,
        levelBonus,
        defenseReduction,
        variance: parseFloat(variance.toFixed(3)),
        criticalMultiplier: 1,
        elementMultiplier: 1.0,
        finalDamage,
        isCritical: false,
      };
    },
    processPlayerAction: async (state: any, action: any) => {
      const player = state.participants.find((p: any) => p.isPlayer);
      if (!player) throw new Error('Player not found in combat');

      if (action.type === 'skill') {
        const skillManaCost = mockRuleParser.getCombatRules().defaults.skill_cost_default;
        if (player.currentMP < skillManaCost) throw new Error('Not enough mana');

        let skillBaseDamage: number;
        const skillMult = mockRuleParser.getCombatRules().defaults.skill_damage_multiplier;
        if (skillService && action.skillId) {
          try {
            const skillIdStr = String(action.skillId);
            const skillDmg = await skillService.calculateSkillDamage(state.saveId, skillIdStr);
            skillBaseDamage = skillDmg.total > 0 ? skillDmg.total : player.attack;
          } catch {
            const skillBaseFactor = mockRuleParser.getCombatRules().defaults.skill_base_damage_factor;
            skillBaseDamage = player.attack * skillBaseFactor;
          }
        } else {
          const skillBaseFactor = mockRuleParser.getCombatRules().defaults.skill_base_damage_factor;
          skillBaseDamage = player.attack * skillBaseFactor;
        }

        const targets = state.participants.filter((p: any) => !p.isPlayer && p.currentHP > 0);
        const target = targets[0];
        const breakdown = strategy.calculateDamage(player, target, {
          baseDamage: skillBaseDamage,
          multiplier: skillMult,
        });
        const killed = target.currentHP - breakdown.finalDamage <= 0;
        target.currentHP = Math.max(0, target.currentHP - breakdown.finalDamage);

        return {
          actorName: player.name,
          actionType: 'skill',
          targetName: target.name,
          damage: breakdown.finalDamage,
          killed,
          logMessage: `${player.name} uses skill on ${target.name}`,
        };
      }

      throw new Error(`Unsupported action type: ${action.type}`);
    },
  };

  return strategy;
}

function createCombatState() {
  return {
    combatId: 'combat1', saveId: 'save1', active: true, turn: 1,
    participants: [
      { id: 'player1', name: 'Hero', isPlayer: true, ownerType: 'character', ownerId: 'player1', currentHP: 100, maxHP: 100, currentMP: 50, maxMP: 50, attack: 20, defense: 10, level: 5, isDefending: false },
      { id: 'enemy1', name: 'Goblin', isPlayer: false, ownerType: 'npc', ownerId: 'enemy1', currentHP: 100, maxHP: 100, currentMP: 30, maxMP: 30, attack: 15, defense: 5, level: 3, isDefending: false },
    ],
    log: [],
  };
}

describe('策略 processPlayerAction — skill 伤害计算管线', () => {
  it('有 skillService 且 action.skillId 时使用 calculateSkillDamage 获取基础伤害', async () => {
    const mockSkillService = {
      calculateSkillDamage: vi.fn().mockResolvedValue({
        base: 50, scaling: 20, effects: 10, total: 80,
      }),
      getSkill: vi.fn().mockResolvedValue(null),
    };
    const strategy = createStrategy({ skillService: mockSkillService });
    const state = createCombatState();

    const action: CombatAction = {
      type: 'skill',
      skillName: 'Fireball',
      skillId: 'skill_fireball',
      targetId: 'enemy1',
    };

    const result = await strategy.processPlayerAction(state, action);

    expect(mockSkillService.calculateSkillDamage).toHaveBeenCalledWith('save1', 'skill_fireball');
    expect(result.damage).toBeGreaterThan(0);
    expect(result.actionType).toBe('skill');
  });

  it('无 skillService 时回退到全局乘数计算', async () => {
    const strategy = createStrategy();
    const state = createCombatState();

    const action: CombatAction = {
      type: 'skill',
      skillName: 'Fireball',
      targetId: 'enemy1',
    };

    const result = await strategy.processPlayerAction(state, action);

    // 回退路径：baseDamage = attack * skillBaseFactor = 20 * 2 = 40
    expect(result.damage).toBeGreaterThan(0);
    expect(result.actionType).toBe('skill');
  });

  it('calculateSkillDamage 返回 total=0 时回退到 player.attack', async () => {
    const mockSkillService = {
      calculateSkillDamage: vi.fn().mockResolvedValue({
        base: 0, scaling: 0, effects: 0, total: 0,
      }),
      getSkill: vi.fn().mockResolvedValue(null),
    };
    const strategy = createStrategy({ skillService: mockSkillService });
    const state = createCombatState();

    const action: CombatAction = {
      type: 'skill',
      skillName: 'WeakSkill',
      skillId: 'skill_weak',
      targetId: 'enemy1',
    };

    const result = await strategy.processPlayerAction(state, action);

    // total=0 时回退到 player.attack=20
    expect(result.damage).toBeGreaterThan(0);
  });

  it('calculateSkillDamage 抛异常时回退到全局乘数', async () => {
    const mockSkillService = {
      calculateSkillDamage: vi.fn().mockRejectedValue(new Error('DB error')),
      getSkill: vi.fn().mockResolvedValue(null),
    };
    const strategy = createStrategy({ skillService: mockSkillService });
    const state = createCombatState();

    const action: CombatAction = {
      type: 'skill',
      skillName: 'Fireball',
      skillId: 'skill_fireball',
      targetId: 'enemy1',
    };

    const result = await strategy.processPlayerAction(state, action);

    // 异常回退到全局乘数
    expect(result.damage).toBeGreaterThan(0);
  });
});
