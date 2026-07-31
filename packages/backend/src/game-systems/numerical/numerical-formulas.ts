/**
 * 数值公式共享常量与函数
 *
 * 从 NumericalService 和 NumericalTool 中提取的共享数值计算逻辑，
 * 确保两处使用完全相同的公式和常量，消除影子副本。
 *
 * @module game-systems/numerical/numerical-formulas
 */

// ============================================================================
// 经验值常量
// ============================================================================

export const LEVEL_EXP_BASE = 100;
export const LEVEL_EXP_GROWTH = 1.5;

// ============================================================================
// 伤害系数
// ============================================================================

export const DAMAGE_COEFFICIENTS = {
    physicalDefenseReduction: 0.5,
    magicalDefenseReduction: 0.3,
    physicalLevelDiffBonus: 0.05,
    magicalLevelDiffBonus: 0.03,
} as const;

// ============================================================================
// 经验奖励基础值
// ============================================================================

export const EXPERIENCE_BASE_REWARDS: Record<string, number> = {
    combat: 50,
    quest: 80,
    exploration: 30,
    crafting: 25,
    social: 20,
};

export const DEFAULT_EXPERIENCE_BASE_REWARD = 30;

// ============================================================================
// 衍生属性 Fallback 公式
// ============================================================================

export const DERIVED_ATTRIBUTE_FALLBACK_FORMULAS: Record<string, { base: number; coefficients: Record<string, number>; max?: number }> = {
    maxHealth:      { base: 100, coefficients: { endurance: 15, physical_power: 5 } },
    maxMana:        { base: 50,  coefficients: { mental_power: 10, endurance: 2 } },
    attack:         { base: 10,  coefficients: { physical_power: 2, agility: 0.5 } },
    defense:        { base: 5,   coefficients: { endurance: 1.5, physical_power: 0.5 } },
    magicAttack:    { base: 8,   coefficients: { mental_power: 2.5, perception: 0.3 } },
    magicDefense:   { base: 4,   coefficients: { mental_power: 1, endurance: 0.3 } },
    speed:          { base: 10,  coefficients: { agility: 1.5, influence: 0.2 } },
    critRate:       { base: 0.05, coefficients: { agility: 0.01, influence: 0.005 }, max: 0.5 },
    critDamage:     { base: 1.5,  coefficients: { physical_power: 0.02, influence: 0.01 } },
    dodgeRate:      { base: 0.05, coefficients: { agility: 0.008 }, max: 0.3 },
    blockRate:      { base: 0.9,  coefficients: { agility: 0.005, perception: 0.002 } },
};

// ============================================================================
// 共享计算函数
// ============================================================================

/**
 * 使用 Fallback 公式计算衍生属性
 * 当模板规则中没有自定义衍生属性公式时使用
 */
export function calculateDerivedAttributesFallback(roleToAttr: Record<string, number>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [attrName, formula] of Object.entries(DERIVED_ATTRIBUTE_FALLBACK_FORMULAS)) {
        let value = formula.base;
        for (const [role, coefficient] of Object.entries(formula.coefficients)) {
            value += (roleToAttr[role] || 10) * coefficient;
        }
        if ('max' in formula && formula.max !== undefined) {
            value = Math.min(formula.max, value);
        }
        if (['maxHealth', 'maxMana', 'attack', 'defense', 'magicAttack', 'magicDefense', 'speed'].includes(attrName)) {
            value = Math.floor(value);
        } else {
            value = parseFloat(value.toFixed(4));
        }
        result[attrName] = value;
    }
    return result;
}

/**
 * 计算到达指定等级所需的总经验值
 */
export function calculateTotalExpForLevel(level: number): number {
    if (level <= 1) return 0;
    let totalExp = 0;
    for (let i = 1; i < level; i++) {
        totalExp += Math.floor(LEVEL_EXP_BASE * Math.pow(LEVEL_EXP_GROWTH, i - 1));
    }
    return totalExp;
}

/**
 * 计算物理伤害
 */
export function calculatePhysicalDamage(basePower: number, attackerStat: number | undefined, scalingRatio: number | undefined, defenderDefense: number | undefined, attackerLevel: number, defenderLevel: number): number {
    let damage = basePower;
    if (attackerStat !== undefined && scalingRatio !== undefined) {
        damage += attackerStat * scalingRatio;
    }
    if (defenderDefense) {
        damage = Math.max(1, damage - defenderDefense * DAMAGE_COEFFICIENTS.physicalDefenseReduction);
    }
    const levelDiff = attackerLevel - defenderLevel;
    if (levelDiff > 0) damage *= 1 + (levelDiff * DAMAGE_COEFFICIENTS.physicalLevelDiffBonus);
    return Math.floor(damage);
}

/**
 * 计算魔法伤害
 */
export function calculateMagicalDamage(basePower: number, attackerStat: number | undefined, scalingRatio: number | undefined, defenderDefense: number | undefined, attackerLevel: number, defenderLevel: number): number {
    let damage = basePower;
    if (attackerStat !== undefined && scalingRatio !== undefined) {
        damage += attackerStat * scalingRatio;
    }
    if (defenderDefense) {
        damage = Math.max(1, damage - defenderDefense * DAMAGE_COEFFICIENTS.magicalDefenseReduction);
    }
    const levelDiff = attackerLevel - defenderLevel;
    if (levelDiff > 0) damage *= 1 + (levelDiff * DAMAGE_COEFFICIENTS.magicalLevelDiffBonus);
    return Math.floor(damage);
}

/**
 * 计算升级时的属性增长
 */
export function calculateStatGrowth(currentLevel: number): Record<string, number> {
    const growthBase = Math.floor(currentLevel / 5) + 1;
    return {
        physical_power: growthBase + Math.floor(Math.random() * 2),
        agility: growthBase + Math.floor(Math.random() * 2),
        mental_power: growthBase + Math.floor(Math.random() * 2),
        endurance: growthBase + 1 + Math.floor(Math.random() * 2),
        perception: Math.floor(growthBase / 2) + Math.floor(Math.random() * 2),
        influence: Math.floor(growthBase / 2) + Math.floor(Math.random() * 2),
    };
}
