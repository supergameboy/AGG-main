import type { Character, FrontendInventoryItem, Quest } from '@/types';

export interface ConditionContext {
  character: Character | null;
  inventory: FrontendInventoryItem[];
  quests: Quest[];
  skills: Array<{ id: string; skill_id: string; name?: string; unlocked?: boolean; cooldownRemaining?: number }>;
  factions?: Record<string, number>;
  statusEffects?: string[];
  inCombat?: boolean;
}

type ComparisonOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

interface AtomCondition {
  type: 'hasItem' | 'hasSkill' | 'hasQuest' | 'faction' | 'level' | 'stat'
    | 'hasStatusEffect' | 'inCombat' | 'resourceAbove' | 'resourceBelow'
    | 'cooldownReady' | 'locationIs' | 'chance';
  key: string;
  op?: ComparisonOp;
  value?: number;
  probability?: number;
}

interface AndCondition {
  type: 'AND';
  left: ConditionNode;
  right: ConditionNode;
}

interface OrCondition {
  type: 'OR';
  left: ConditionNode;
  right: ConditionNode;
}

interface NotCondition {
  type: 'NOT';
  operand: ConditionNode;
}

type ConditionNode = AtomCondition | AndCondition | OrCondition | NotCondition;

function compare(left: number, op: ComparisonOp, right: number): boolean {
  switch (op) {
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '<': return left < right;
    case '==': return left === right;
    case '!=': return left !== right;
  }
}

function parseAtom(token: string): AtomCondition {
  const colonIdx = token.indexOf(':');
  if (colonIdx === -1) {
    if (token.startsWith('level')) {
      const opMatch = token.slice(5).match(/^(>=|<=|>|<|==|!=)(\d+)$/);
      if (opMatch) {
        return { type: 'level', key: '', op: opMatch[1] as ComparisonOp, value: Number(opMatch[2]) };
      }
      return { type: 'level', key: '' };
    }
    if (token === 'inCombat') {
      return { type: 'inCombat', key: '' };
    }
    return { type: 'stat', key: token };
  }

  const prefix = token.slice(0, colonIdx);
  const rest = token.slice(colonIdx + 1);

  switch (prefix) {
    case 'hasItem':
      return { type: 'hasItem', key: rest };
    case 'hasSkill':
      return { type: 'hasSkill', key: rest };
    case 'hasQuest':
      return { type: 'hasQuest', key: rest };
    case 'hasStatusEffect':
      return { type: 'hasStatusEffect', key: rest };
    case 'cooldownReady':
      return { type: 'cooldownReady', key: rest };
    case 'locationIs':
      return { type: 'locationIs', key: rest };
    case 'inCombat':
      return { type: 'inCombat', key: rest };
    case 'chance': {
      const prob = Number(rest);
      return { type: 'chance', key: '', probability: isNaN(prob) ? 0 : prob };
    }
    case 'resourceAbove': {
      const opMatch = rest.match(/^(\w+)(>=|<=|>|<|==|!=)(\d+)$/);
      if (opMatch) {
        return { type: 'resourceAbove', key: opMatch[1], op: opMatch[2] as ComparisonOp, value: Number(opMatch[3]) };
      }
      return { type: 'resourceAbove', key: rest };
    }
    case 'resourceBelow': {
      const opMatch = rest.match(/^(\w+)(>=|<=|>|<|==|!=)(\d+)$/);
      if (opMatch) {
        return { type: 'resourceBelow', key: opMatch[1], op: opMatch[2] as ComparisonOp, value: Number(opMatch[3]) };
      }
      return { type: 'resourceBelow', key: rest };
    }
    case 'faction': {
      const opMatch = rest.match(/^(\w+)(>=|<=|>|<|==|!=)(\d+)$/);
      if (opMatch) {
        return { type: 'faction', key: opMatch[1], op: opMatch[2] as ComparisonOp, value: Number(opMatch[3]) };
      }
      return { type: 'faction', key: rest };
    }
    case 'stat': {
      const opMatch = rest.match(/^(\w+)(>=|<=|>|<|==|!=)(\d+)$/);
      if (opMatch) {
        return { type: 'stat', key: opMatch[1], op: opMatch[2] as ComparisonOp, value: Number(opMatch[3]) };
      }
      return { type: 'stat', key: rest };
    }
    case 'level': {
      const opMatch = rest.match(/^(>=|<=|>|<|==|!=)(\d+)$/);
      if (opMatch) {
        return { type: 'level', key: '', op: opMatch[1] as ComparisonOp, value: Number(opMatch[2]) };
      }
      return { type: 'level', key: rest };
    }
    default:
      return { type: 'stat', key: token };
  }
}

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let i = 0;

  while (i < expression.length) {
    // Handle parentheses as separate tokens
    if (expression[i] === '(' || expression[i] === ')') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push(expression[i] === '(' ? 'LPAREN' : 'RPAREN');
      current = '';
      i++;
      continue;
    }
    if (expression.slice(i, i + 4) === ' AND') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('AND');
      current = '';
      i += 4;
      continue;
    }
    if (expression.slice(i, i + 3) === ' OR') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('OR');
      current = '';
      i += 3;
      continue;
    }
    if (expression.slice(i, i + 4) === ' NOT') {
      if (current.trim()) tokens.push(current.trim());
      tokens.push('NOT');
      current = '';
      i += 4;
      continue;
    }
    if (i === 0 && expression.slice(i, i + 3) === 'NOT') {
      tokens.push('NOT');
      current = '';
      i += 3;
      continue;
    }
    // Handle NOT right after LPAREN (e.g., "(NOT hasItem:sword)")
    if (tokens.length > 0 && tokens[tokens.length - 1] === 'LPAREN' && expression.slice(i, i + 3) === 'NOT' && (i + 3 >= expression.length || expression[i + 3] === ' ' || expression[i + 3] === ')')) {
      tokens.push('NOT');
      current = '';
      i += 3;
      continue;
    }
    current += expression[i];
    i++;
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

export function parseCondition(expression: string): ConditionNode {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { type: 'level', key: '' };
  }

  const tokens = tokenize(trimmed);

  if (tokens.length === 0) {
    return { type: 'level', key: '' };
  }

  if (tokens.length === 1) {
    return parseAtom(tokens[0]);
  }

  let pos = 0;

  function parseNot(): ConditionNode {
    if (tokens[pos] === 'NOT') {
      pos++;
      const operand = parseNot();
      return { type: 'NOT', operand };
    }
    return parseAtomOrParens();
  }

  function parseAtomOrParens(): ConditionNode {
    if (tokens[pos] === 'LPAREN') {
      pos++; // consume LPAREN
      const inner = parseOr(); // recursively parse the expression inside parentheses
      if (pos < tokens.length && tokens[pos] === 'RPAREN') {
        pos++; // consume RPAREN
      }
      return inner;
    }
    return parseAtom(tokens[pos++]);
  }

  function parseAnd(): ConditionNode {
    let left = parseNot();
    while (pos < tokens.length && tokens[pos] === 'AND') {
      pos++;
      const right = parseNot();
      left = { type: 'AND', left, right };
    }
    return left;
  }

  function parseOr(): ConditionNode {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos] === 'OR') {
      pos++;
      const right = parseAnd();
      left = { type: 'OR', left, right };
    }
    return left;
  }

  return parseOr();
}

export function evaluateCondition(node: ConditionNode, ctx: ConditionContext): boolean {
  switch (node.type) {
    case 'hasItem': {
      if (!ctx.inventory) return false;
      return ctx.inventory.some(
        (item) => item.itemId === node.key || item.id === node.key
      );
    }
    case 'hasSkill': {
      if (!ctx.skills) return false;
      return ctx.skills.some(
        (skill) => skill.skill_id === node.key || skill.id === node.key
      );
    }
    case 'hasQuest': {
      if (!ctx.quests) return false;
      return ctx.quests.some(
        (quest) => quest.id === node.key || quest.name === node.key
      );
    }
    case 'faction': {
      const factionValue = ctx.factions?.[node.key] ?? 0;
      if (node.op && node.value !== undefined) {
        return compare(factionValue, node.op, node.value);
      }
      return factionValue > 0;
    }
    case 'level': {
      if (!ctx.character) return false;
      const level = ctx.character.level;
      if (node.op && node.value !== undefined) {
        return compare(level, node.op, node.value);
      }
      return level > 0;
    }
    case 'stat': {
      if (!ctx.character) return false;
      const statValue = ctx.character.attributes?.[node.key]
        ?? ctx.character.derivedAttributes?.[node.key as keyof typeof ctx.character.derivedAttributes]
        ?? 0;
      if (node.op && node.value !== undefined) {
        return compare(statValue, node.op, node.value);
      }
      return statValue > 0;
    }
    case 'hasStatusEffect': {
      return ctx.statusEffects?.includes(node.key) ?? false;
    }
    case 'inCombat': {
      return ctx.inCombat === true;
    }
    case 'resourceAbove': {
      if (!ctx.character) return false;
      const actual = getResourceValue(ctx, node.key);
      if (node.op && node.value !== undefined) {
        return compare(actual, node.op, node.value);
      }
      return actual > 0;
    }
    case 'resourceBelow': {
      if (!ctx.character) return false;
      const actual = getResourceValue(ctx, node.key);
      if (node.op && node.value !== undefined) {
        return compare(actual, node.op, node.value);
      }
      return actual <= 0;
    }
    case 'cooldownReady': {
      if (!ctx.skills) return false;
      return ctx.skills.some(
        (skill) => (skill.skill_id === node.key || skill.id === node.key) && (skill.cooldownRemaining ?? 0) <= 0
      );
    }
    case 'locationIs': {
      if (!ctx.character) return false;
      return ctx.character.currentLocationId === node.key;
    }
    case 'chance': {
      return Math.random() < (node.probability ?? 0);
    }
    case 'AND':
      return evaluateCondition(node.left, ctx) && evaluateCondition(node.right, ctx);
    case 'OR':
      return evaluateCondition(node.left, ctx) || evaluateCondition(node.right, ctx);
    case 'NOT':
      return !evaluateCondition(node.operand, ctx);
  }
}

function getResourceValue(ctx: ConditionContext, resource: string): number {
  const char = ctx.character;
  if (!char) return 0;
  switch (resource) {
    case 'hp': return char.currentHP;
    case 'mp': return char.currentMP;
    case 'maxHp': return char.maxHP;
    case 'maxMp': return char.maxMP;
    default: return char.attributes?.[resource] ?? 0;
  }
}

export function evaluateConditionExpression(
  expression: string,
  ctx: ConditionContext
): boolean {
  try {
    const ast = parseCondition(expression);
    return evaluateCondition(ast, ctx);
  } catch {
    return false;
  }
}
