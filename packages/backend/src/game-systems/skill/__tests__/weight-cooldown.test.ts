import { describe, expect, it } from 'vitest';
import type { WeightCooldownConfig } from '../../../../../shared/src/types/template.js';

/**
 * Pure function tests for the weight cooldown calculation logic.
 * These tests verify the mathematical correctness of the cooldown multiplier
 * without requiring database access.
 */
describe('Weight Cooldown — calculateWeightedCooldown', () => {
  // Replicate the private method as a standalone function for testing
  function calculateWeightedCooldown(baseCooldown: number, consecutiveUses: number, config: WeightCooldownConfig): number {
    if (consecutiveUses <= 1) return baseCooldown;
    const multiplier = Math.min(config.max_multiplier, Math.pow(config.weight_factor, consecutiveUses - 1));
    return Math.floor(baseCooldown * multiplier);
  }

  const defaultConfig: WeightCooldownConfig = {
    enabled: true,
    weight_factor: 1.5,
    max_multiplier: 3.0,
    reset_after: 3,
    reset_unit: 'turn',
  };

  it('first use returns base cooldown (no weight applied)', () => {
    const result = calculateWeightedCooldown(2, 1, defaultConfig);
    expect(result).toBe(2);
  });

  it('second consecutive use applies weight factor once', () => {
    // base=2, consecutiveUses=2, multiplier = 1.5^1 = 1.5, result = 2*1.5 = 3
    const result = calculateWeightedCooldown(2, 2, defaultConfig);
    expect(result).toBe(3);
  });

  it('third consecutive use applies weight factor twice', () => {
    // base=2, consecutiveUses=3, multiplier = 1.5^2 = 2.25, result = 2*2.25 = 4.5 -> floor = 4
    const result = calculateWeightedCooldown(2, 3, defaultConfig);
    expect(result).toBe(4);
  });

  it('fourth consecutive use applies weight factor three times', () => {
    // base=2, consecutiveUses=4, multiplier = 1.5^3 = 3.375, capped at 3.0, result = 2*3.0 = 6
    const result = calculateWeightedCooldown(2, 4, defaultConfig);
    expect(result).toBe(6);
  });

  it('fifth consecutive use is capped at max_multiplier', () => {
    // base=2, consecutiveUses=5, multiplier = 1.5^4 = 5.0625, capped at 3.0, result = 2*3.0 = 6
    const result = calculateWeightedCooldown(2, 5, defaultConfig);
    expect(result).toBe(6);
  });

  it('zero consecutive uses returns base cooldown', () => {
    const result = calculateWeightedCooldown(2, 0, defaultConfig);
    expect(result).toBe(2);
  });

  it('negative consecutive uses returns base cooldown', () => {
    const result = calculateWeightedCooldown(2, -1, defaultConfig);
    expect(result).toBe(2);
  });

  it('weight factor of 1.0 always returns base cooldown', () => {
    const config: WeightCooldownConfig = { ...defaultConfig, weight_factor: 1.0 };
    expect(calculateWeightedCooldown(2, 1, config)).toBe(2);
    expect(calculateWeightedCooldown(2, 2, config)).toBe(2);
    expect(calculateWeightedCooldown(2, 5, config)).toBe(2);
  });

  it('high weight factor with low max_multiplier caps early', () => {
    const config: WeightCooldownConfig = { ...defaultConfig, weight_factor: 3.0, max_multiplier: 2.0 };
    // base=2, consecutiveUses=2, multiplier = 3.0^1 = 3.0, capped at 2.0, result = 2*2.0 = 4
    expect(calculateWeightedCooldown(2, 2, config)).toBe(4);
  });

  it('works with time-based cooldown values (ms)', () => {
    // base=3000ms, consecutiveUses=3, multiplier = 1.5^2 = 2.25, result = 3000*2.25 = 6750
    const result = calculateWeightedCooldown(3000, 3, defaultConfig);
    expect(result).toBe(6750);
  });

  it('works with large max_multiplier (no cap reached)', () => {
    const config: WeightCooldownConfig = { ...defaultConfig, max_multiplier: 10.0 };
    // base=2, consecutiveUses=5, multiplier = 1.5^4 = 5.0625, result = 2*5.0625 = 10.125 -> floor = 10
    const result = calculateWeightedCooldown(2, 5, config);
    expect(result).toBe(10);
  });
});

describe('Weight Cooldown — TemplateRuleParser integration', () => {
  it('returns null when weight_cooldown is not configured', async () => {
    const { TemplateRuleParser } = await import('../../shared/rule-parser/TemplateRuleParser.js');
    const parser = new TemplateRuleParser({});
    expect(parser.getWeightCooldownConfig()).toBeNull();
  });

  it('returns null when weight_cooldown is disabled', async () => {
    const { TemplateRuleParser } = await import('../../shared/rule-parser/TemplateRuleParser.js');
    const parser = new TemplateRuleParser({
      game_rules: {
        skill_system: {
          weight_cooldown: {
            enabled: false,
            weight_factor: 1.5,
            max_multiplier: 3.0,
            reset_after: 3,
            reset_unit: 'turn',
          },
        },
      },
    });
    expect(parser.getWeightCooldownConfig()).toBeNull();
  });

  it('returns config when weight_cooldown is enabled', async () => {
    const { TemplateRuleParser } = await import('../../shared/rule-parser/TemplateRuleParser.js');
    const parser = new TemplateRuleParser({
      game_rules: {
        skill_system: {
          weight_cooldown: {
            enabled: true,
            weight_factor: 2.0,
            max_multiplier: 5.0,
            reset_after: 2,
            reset_unit: 'time',
          },
        },
      },
    });
    const config = parser.getWeightCooldownConfig();
    expect(config).not.toBeNull();
    expect(config!.enabled).toBe(true);
    expect(config!.weight_factor).toBe(2.0);
    expect(config!.max_multiplier).toBe(5.0);
    expect(config!.reset_after).toBe(2);
    expect(config!.reset_unit).toBe('time');
  });

  it('fills defaults for missing optional fields', async () => {
    const { TemplateRuleParser } = await import('../../shared/rule-parser/TemplateRuleParser.js');
    const parser = new TemplateRuleParser({
      game_rules: {
        skill_system: {
          weight_cooldown: {
            enabled: true,
          },
        },
      },
    });
    const config = parser.getWeightCooldownConfig();
    expect(config).not.toBeNull();
    expect(config!.weight_factor).toBe(1.5);
    expect(config!.max_multiplier).toBe(3.0);
    expect(config!.reset_after).toBe(3);
    expect(config!.reset_unit).toBe('turn');
  });
});
