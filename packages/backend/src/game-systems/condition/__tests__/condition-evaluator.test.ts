import { describe, it, expect, vi } from 'vitest';
import { ConditionEvaluator } from '../ConditionEvaluator.js';
import type { ConditionContext } from '../ConditionEvaluator.js';
import type { ConditionExpression, AdvancedCondition, CompositeCondition } from '@ai-rpg/shared';

function makeContext(overrides: Partial<ConditionContext> = {}): ConditionContext {
  return {
    character: {
      level: 10,
      attributes: { strength: 15, intelligence: 8 },
      derivedAttributes: { attack: 20, defense: 12 },
      currentHp: 80,
      maxHp: 100,
      currentMp: 30,
      maxMp: 50,
      currentLocationId: 'loc_forest',
    },
    inventory: [
      { itemId: 'item_sword', name: 'Iron Sword', quantity: 1 },
      { itemId: 'item_potion', name: 'Health Potion', quantity: 3 },
    ],
    skills: [
      { skillId: 'skill_fireball', name: 'Fireball', level: 3, cooldownRemaining: 0, unlocked: true },
      { skillId: 'skill_shield', name: 'Shield', level: 2, cooldownRemaining: 5, unlocked: true },
      { skillId: 'skill_locked', name: 'Locked Skill', level: 0, cooldownRemaining: 0, unlocked: false },
    ],
    quests: [
      { id: 'quest_main_01', name: 'Main Quest', status: 'completed' },
      { id: 'quest_side_01', name: 'Side Quest', status: 'active' },
    ],
    factions: { guild: 75, thieves: 20 },
    statusEffects: ['poison', 'blessed'],
    inCombat: true,
    ...overrides,
  };
}

describe('ConditionEvaluator', () => {
  const evaluator = new ConditionEvaluator();

  // === Atomic Conditions ===

  describe('level', () => {
    it('passes when level meets threshold with >=', () => {
      const cond: AdvancedCondition = { type: 'level', operator: '>=', value: 10 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('fails when level does not meet threshold', () => {
      const cond: AdvancedCondition = { type: 'level', operator: '>=', value: 15 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('defaults to >= when no operator provided', () => {
      const cond: AdvancedCondition = { type: 'level', value: 10 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('handles missing character gracefully', () => {
      const cond: AdvancedCondition = { type: 'level', operator: '>=', value: 1 };
      expect(evaluator.evaluate(cond, makeContext({ character: undefined }))).toBe(false);
    });
  });

  describe('has_item', () => {
    it('finds item by itemId', () => {
      const cond: AdvancedCondition = { type: 'has_item', key: 'item_sword' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('finds item by name', () => {
      const cond: AdvancedCondition = { type: 'has_item', key: 'Health Potion' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('fails for missing item', () => {
      const cond: AdvancedCondition = { type: 'has_item', key: 'item_axe' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('handles missing inventory gracefully', () => {
      const cond: AdvancedCondition = { type: 'has_item', key: 'item_sword' };
      expect(evaluator.evaluate(cond, makeContext({ inventory: undefined }))).toBe(false);
    });
  });

  describe('has_skill', () => {
    it('finds unlocked skill by skillId', () => {
      const cond: AdvancedCondition = { type: 'has_skill', key: 'skill_fireball' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('finds unlocked skill by name', () => {
      const cond: AdvancedCondition = { type: 'has_skill', key: 'Shield' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('excludes locked skills', () => {
      const cond: AdvancedCondition = { type: 'has_skill', key: 'skill_locked' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('fails for missing skill', () => {
      const cond: AdvancedCondition = { type: 'has_skill', key: 'skill_teleport' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });
  });

  describe('quest_completed', () => {
    it('finds completed quest by id', () => {
      const cond: AdvancedCondition = { type: 'quest_completed', key: 'quest_main_01' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('finds completed quest by name', () => {
      const cond: AdvancedCondition = { type: 'quest_completed', key: 'Main Quest' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('fails for active (not completed) quest', () => {
      const cond: AdvancedCondition = { type: 'quest_completed', key: 'quest_side_01' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });
  });

  describe('has_status_effect', () => {
    it('detects active status effect', () => {
      const cond: AdvancedCondition = { type: 'has_status_effect', key: 'poison' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('fails for missing status effect', () => {
      const cond: AdvancedCondition = { type: 'has_status_effect', key: 'burning' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('handles missing statusEffects gracefully', () => {
      const cond: AdvancedCondition = { type: 'has_status_effect', key: 'poison' };
      expect(evaluator.evaluate(cond, makeContext({ statusEffects: undefined }))).toBe(false);
    });
  });

  describe('in_combat', () => {
    it('returns true when in combat', () => {
      const cond: AdvancedCondition = { type: 'in_combat' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('returns false when not in combat', () => {
      const cond: AdvancedCondition = { type: 'in_combat' };
      expect(evaluator.evaluate(cond, makeContext({ inCombat: false }))).toBe(false);
    });

    it('returns false when inCombat is undefined', () => {
      const cond: AdvancedCondition = { type: 'in_combat' };
      expect(evaluator.evaluate(cond, makeContext({ inCombat: undefined }))).toBe(false);
    });
  });

  describe('resource_above', () => {
    it('checks hp above threshold', () => {
      const cond: AdvancedCondition = { type: 'resource_above', key: 'hp', operator: '>=', value: 80 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('checks mp above threshold', () => {
      const cond: AdvancedCondition = { type: 'resource_above', key: 'mp', operator: '>=', value: 50 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('checks maxHp', () => {
      const cond: AdvancedCondition = { type: 'resource_above', key: 'maxHp', operator: '==', value: 100 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('returns false when character is missing', () => {
      const cond: AdvancedCondition = { type: 'resource_above', key: 'hp', operator: '>=', value: 10 };
      expect(evaluator.evaluate(cond, makeContext({ character: undefined }))).toBe(false);
    });
  });

  describe('resource_below', () => {
    it('checks mp below threshold', () => {
      const cond: AdvancedCondition = { type: 'resource_below', key: 'mp', operator: '<=', value: 30 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });
  });

  describe('cooldown_ready', () => {
    it('returns true when skill cooldown is 0', () => {
      const cond: AdvancedCondition = { type: 'cooldown_ready', key: 'skill_fireball' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('returns false when skill is on cooldown', () => {
      const cond: AdvancedCondition = { type: 'cooldown_ready', key: 'skill_shield' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('finds skill by name', () => {
      const cond: AdvancedCondition = { type: 'cooldown_ready', key: 'Fireball' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });
  });

  describe('location_is', () => {
    it('matches current location', () => {
      const cond: AdvancedCondition = { type: 'location_is', key: 'loc_forest' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('fails for different location', () => {
      const cond: AdvancedCondition = { type: 'location_is', key: 'loc_city' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });
  });

  describe('faction_above', () => {
    it('checks faction reputation threshold', () => {
      const cond: AdvancedCondition = { type: 'faction_above', key: 'guild', operator: '>=', value: 50 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('fails when faction is below threshold', () => {
      const cond: AdvancedCondition = { type: 'faction_above', key: 'thieves', operator: '>=', value: 50 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('defaults to 0 for unknown faction', () => {
      const cond: AdvancedCondition = { type: 'faction_above', key: 'unknown', operator: '>=', value: 1 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });
  });

  describe('attribute_above', () => {
    it('checks character attribute threshold', () => {
      const cond: AdvancedCondition = { type: 'attribute_above', key: 'strength', operator: '>=', value: 15 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('fails when attribute is below threshold', () => {
      const cond: AdvancedCondition = { type: 'attribute_above', key: 'intelligence', operator: '>=', value: 15 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });
  });

  describe('chance', () => {
    it('always passes with probability 1', () => {
      const cond: AdvancedCondition = { type: 'chance', probability: 1 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('always fails with probability 0', () => {
      const cond: AdvancedCondition = { type: 'chance', probability: 0 };
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
    });

    it('uses Math.random for probability checks', () => {
      const cond: AdvancedCondition = { type: 'chance', probability: 0.5 };
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.3);
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
      spy.mockReturnValue(0.8);
      expect(evaluator.evaluate(cond, makeContext())).toBe(false);
      spy.mockRestore();
    });
  });

  describe('location_visited', () => {
    it('checks current location as visited', () => {
      const cond: AdvancedCondition = { type: 'location_visited', key: 'loc_forest' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });
  });

  describe('talk_to_npc', () => {
    it('always returns true (simplified)', () => {
      const cond: AdvancedCondition = { type: 'talk_to_npc', key: 'npc_elder' };
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });
  });

  // === Composite Conditions ===

  describe('AND composite', () => {
    it('passes when all children pass', () => {
      const composite: CompositeCondition = {
        operator: 'AND',
        conditions: [
          { type: 'level', operator: '>=', value: 10 },
          { type: 'has_item', key: 'item_sword' },
        ],
      };
      expect(evaluator.evaluate(composite, makeContext())).toBe(true);
    });

    it('fails when any child fails', () => {
      const composite: CompositeCondition = {
        operator: 'AND',
        conditions: [
          { type: 'level', operator: '>=', value: 10 },
          { type: 'has_item', key: 'item_axe' },
        ],
      };
      expect(evaluator.evaluate(composite, makeContext())).toBe(false);
    });
  });

  describe('OR composite', () => {
    it('passes when any child passes', () => {
      const composite: CompositeCondition = {
        operator: 'OR',
        conditions: [
          { type: 'level', operator: '>=', value: 99 },
          { type: 'has_item', key: 'item_sword' },
        ],
      };
      expect(evaluator.evaluate(composite, makeContext())).toBe(true);
    });

    it('fails when all children fail', () => {
      const composite: CompositeCondition = {
        operator: 'OR',
        conditions: [
          { type: 'level', operator: '>=', value: 99 },
          { type: 'has_item', key: 'item_axe' },
        ],
      };
      expect(evaluator.evaluate(composite, makeContext())).toBe(false);
    });
  });

  describe('NOT composite', () => {
    it('inverts a passing condition', () => {
      const composite: CompositeCondition = {
        operator: 'NOT',
        conditions: [{ type: 'level', operator: '>=', value: 10 }],
      };
      expect(evaluator.evaluate(composite, makeContext())).toBe(false);
    });

    it('inverts a failing condition', () => {
      const composite: CompositeCondition = {
        operator: 'NOT',
        conditions: [{ type: 'level', operator: '>=', value: 99 }],
      };
      expect(evaluator.evaluate(composite, makeContext())).toBe(true);
    });
  });

  describe('nested composite', () => {
    it('AND containing OR conditions', () => {
      const composite: CompositeCondition = {
        operator: 'AND',
        conditions: [
          { type: 'level', operator: '>=', value: 5 },
          {
            operator: 'OR',
            conditions: [
              { type: 'has_item', key: 'item_sword' },
              { type: 'has_item', key: 'item_axe' },
            ],
          },
        ],
      };
      expect(evaluator.evaluate(composite, makeContext())).toBe(true);
    });

    it('NOT inside AND', () => {
      const composite: CompositeCondition = {
        operator: 'AND',
        conditions: [
          { type: 'level', operator: '>=', value: 10 },
          {
            operator: 'NOT',
            conditions: [{ type: 'in_combat' }],
          },
        ],
      };
      // inCombat is true, NOT inCombat is false, so AND fails
      expect(evaluator.evaluate(composite, makeContext())).toBe(false);
    });
  });

  // === evaluateAll ===

  describe('evaluateAll', () => {
    it('returns true for empty array', () => {
      expect(evaluator.evaluateAll([], makeContext())).toBe(true);
    });

    it('returns true for undefined', () => {
      expect(evaluator.evaluateAll(undefined, makeContext())).toBe(true);
    });

    it('returns true when all expressions pass', () => {
      const expressions: ConditionExpression[] = [
        { type: 'level', operator: '>=', value: 5 },
        { type: 'has_item', key: 'item_sword' },
      ];
      expect(evaluator.evaluateAll(expressions, makeContext())).toBe(true);
    });

    it('returns false when any expression fails', () => {
      const expressions: ConditionExpression[] = [
        { type: 'level', operator: '>=', value: 5 },
        { type: 'has_item', key: 'item_axe' },
      ];
      expect(evaluator.evaluateAll(expressions, makeContext())).toBe(false);
    });
  });

  // === Edge Cases ===

  describe('edge cases', () => {
    it('handles null character hp/mp', () => {
      const cond: AdvancedCondition = { type: 'resource_above', key: 'hp', operator: '>=', value: 1 };
      const ctx = makeContext({
        character: {
          level: 10,
          attributes: {},
          derivedAttributes: {},
          currentHp: null,
          maxHp: null,
          currentMp: null,
          maxMp: null,
        },
      });
      expect(evaluator.evaluate(cond, ctx)).toBe(false);
    });

    it('handles unknown condition type gracefully', () => {
      const cond = { type: 'unknown_type' } as unknown as AdvancedCondition;
      expect(evaluator.evaluate(cond, makeContext())).toBe(true);
    });

    it('handles compareNumber with all operators', () => {
      const ctx = makeContext();
      expect(evaluator.evaluate({ type: 'level', operator: '>', value: 9 }, ctx)).toBe(true);
      expect(evaluator.evaluate({ type: 'level', operator: '>', value: 10 }, ctx)).toBe(false);
      expect(evaluator.evaluate({ type: 'level', operator: '<', value: 11 }, ctx)).toBe(true);
      expect(evaluator.evaluate({ type: 'level', operator: '<', value: 10 }, ctx)).toBe(false);
      expect(evaluator.evaluate({ type: 'level', operator: '==', value: 10 }, ctx)).toBe(true);
      expect(evaluator.evaluate({ type: 'level', operator: '!=', value: 10 }, ctx)).toBe(false);
      expect(evaluator.evaluate({ type: 'level', operator: '<=', value: 10 }, ctx)).toBe(true);
      expect(evaluator.evaluate({ type: 'level', operator: '>=', value: 10 }, ctx)).toBe(true);
    });
  });
});
