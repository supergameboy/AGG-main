import type { ConditionExpression, AdvancedCondition, CompositeCondition, ConditionOperator } from '@ai-rpg/shared';
import { isCompositeCondition } from '@ai-rpg/shared';

export interface ConditionContext {
  character?: {
    level: number;
    attributes: Record<string, unknown>;
    derivedAttributes: Record<string, unknown>;
    currentHp: number | null;
    maxHp: number | null;
    currentMp: number | null;
    maxMp: number | null;
    currentLocationId?: string;
    status?: Record<string, unknown>;
    customData?: Record<string, unknown>;
  };
  inventory?: Array<{ itemId: string; name?: string; quantity: number }>;
  skills?: Array<{ skillId: string; name?: string; level: number; cooldownRemaining?: number; unlocked?: boolean }>;
  quests?: Array<{ id: string; name?: string; status: string }>;
  factions?: Record<string, number>;
  statusEffects?: string[];
  inCombat?: boolean;
}

export class ConditionEvaluator {
  evaluate(expression: ConditionExpression, context: ConditionContext): boolean {
    if (isCompositeCondition(expression)) {
      return this.evaluateComposite(expression, context);
    }
    return this.evaluateAtomic(expression as AdvancedCondition, context);
  }

  evaluateAll(expressions: ConditionExpression[] | undefined, context: ConditionContext): boolean {
    if (!expressions || expressions.length === 0) return true;
    return expressions.every(expr => this.evaluate(expr, context));
  }

  private evaluateComposite(composite: CompositeCondition, context: ConditionContext): boolean {
    const { operator, conditions } = composite;
    if (operator === 'AND') {
      return conditions.every((c: ConditionExpression) => this.evaluate(c, context));
    }
    if (operator === 'OR') {
      return conditions.some((c: ConditionExpression) => this.evaluate(c, context));
    }
    // NOT
    return !this.evaluate(conditions[0], context);
  }

  private evaluateAtomic(condition: AdvancedCondition, context: ConditionContext): boolean {
    switch (condition.type) {
      case 'level':
        return this.compareNumber(
          context.character?.level ?? 0,
          condition.operator ?? '>=',
          Number(condition.value)
        );
      case 'has_item':
        return context.inventory?.some(
          i => i.itemId === condition.key || i.name === condition.key
        ) ?? false;
      case 'has_skill':
        return context.skills?.some(
          s => (s.skillId === condition.key || s.name === condition.key) && s.unlocked !== false
        ) ?? false;
      case 'quest_completed':
        return context.quests?.some(
          q => (q.id === condition.key || q.name === condition.key) && q.status === 'completed'
        ) ?? false;
      case 'location_visited':
        return context.character?.currentLocationId === condition.key;
      case 'talk_to_npc':
        return true;
      case 'has_status_effect':
        return context.statusEffects?.includes(condition.key ?? '') ?? false;
      case 'in_combat':
        return context.inCombat === true;
      case 'resource_above':
        return this.checkResource(
          context,
          condition.key ?? '',
          condition.operator ?? '>=',
          Number(condition.value)
        );
      case 'resource_below':
        return this.checkResource(
          context,
          condition.key ?? '',
          condition.operator ?? '<=',
          Number(condition.value)
        );
      case 'cooldown_ready':
        return context.skills?.some(
          s => (s.skillId === condition.key || s.name === condition.key) && (s.cooldownRemaining ?? 0) <= 0
        ) ?? false;
      case 'location_is':
        return context.character?.currentLocationId === condition.key;
      case 'faction_above':
        return this.compareNumber(
          context.factions?.[condition.key ?? ''] ?? 0,
          condition.operator ?? '>=',
          Number(condition.value)
        );
      case 'attribute_above':
        return this.compareNumber(
          (context.character?.attributes?.[condition.key ?? ''] as number) ?? 0,
          condition.operator ?? '>=',
          Number(condition.value)
        );
      case 'chance':
        return Math.random() < (condition.probability ?? 0);
      default:
        return true;
    }
  }

  private compareNumber(actual: number, op: ConditionOperator, expected: number): boolean {
    switch (op) {
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '==': return actual === expected;
      case '!=': return actual !== expected;
      default: return false;
    }
  }

  private checkResource(context: ConditionContext, resource: string, op: ConditionOperator, value: number): boolean {
    const char = context.character;
    if (!char) return false;

    let actual: number;
    switch (resource) {
      case 'hp': actual = char.currentHp ?? 0; break;
      case 'mp': actual = char.currentMp ?? 0; break;
      case 'maxHp': actual = char.maxHp ?? 0; break;
      case 'maxMp': actual = char.maxMp ?? 0; break;
      default: actual = (char.attributes?.[resource] as number) ?? 0;
    }
    return this.compareNumber(actual, op, value);
  }
}
