import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateRuleParser } from '../TemplateRuleParser.js';

const YAML_CONTENT = `
game_rules:
  combat_system:
    type: turn_based
    action_points: 3
character_creation:
  classes:
    - warrior
    - mage
special_rules:
  rest_heal_percent: 0.5
`;

function createMockDb(templateRow: Record<string, unknown>) {
  const saveRow = { id: 'save1', template_id: 'tpl-1' };

  return vi.fn().mockImplementation((table: string) => {
    const chain = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        if (table === 'saves') return Promise.resolve(saveRow);
        if (table === 'templates') return Promise.resolve(templateRow);
        return Promise.resolve(null);
      }),
    };
    return chain;
  });
}

describe('TemplateRuleParser.fromSaveId — 死代码路径清理', () => {
  // 静态缓存隔离：每个用例独立解析，避免 fromTemplateId 缓存命中导致跨用例污染
  beforeEach(() => {
    TemplateRuleParser.clearCache();
  });

  it('从 raw_content 解析模板规则', async () => {
    const mockDb = createMockDb({
      id: 'tpl-1',
      raw_content: YAML_CONTENT,
    });

    const parser = await TemplateRuleParser.fromSaveId(mockDb as any, 'save1');

    const combatRules = parser.getCombatRules();
    expect(combatRules.type).toBe('turn_based');
    expect(combatRules.action_points).toBe(3);
  });

  it('不依赖 game_rules/character_creation/special_rules 列', async () => {
    // 模拟迁移067后的数据库：这些列不存在，templateRow 只有 raw_content
    const mockDb = createMockDb({
      id: 'tpl-1',
      raw_content: YAML_CONTENT,
      // 不包含 game_rules、character_creation、special_rules 字段
    });

    const parser = await TemplateRuleParser.fromSaveId(mockDb as any, 'save1');

    const combatRules = parser.getCombatRules();
    expect(combatRules.type).toBe('turn_based');

    const inventoryRules = parser.getInventoryRules();
    expect(inventoryRules).toBeDefined();
  });

  it('raw_content 为空时使用默认值', async () => {
    const mockDb = createMockDb({
      id: 'tpl-1',
      raw_content: null,
    });

    const parser = await TemplateRuleParser.fromSaveId(mockDb as any, 'save1');

    const combatRules = parser.getCombatRules();
    expect(combatRules).toBeDefined();
    // 使用默认值（默认 type 是 encounter）
    expect(combatRules.type).toBe('encounter');
  });

  it('saveId 无 template_id 时返回空解析器', async () => {
    const mockDb = vi.fn().mockImplementation((table: string) => {
      const chain = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(() => {
          if (table === 'saves') return Promise.resolve({ id: 'save2', template_id: null });
          return Promise.resolve(null);
        }),
      };
      return chain;
    });

    const parser = await TemplateRuleParser.fromSaveId(mockDb as any, 'save2');

    // 应返回默认值
    const combatRules = parser.getCombatRules();
    expect(combatRules).toBeDefined();
  });

  it('raw_content 解析失败时使用默认值', async () => {
    const mockDb = createMockDb({
      id: 'tpl-1',
      raw_content: '{invalid yaml: [unclosed',
    });

    const parser = await TemplateRuleParser.fromSaveId(mockDb as any, 'save1');

    const combatRules = parser.getCombatRules();
    expect(combatRules).toBeDefined();
  });
});
