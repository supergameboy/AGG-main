import { describe, it, expect } from 'vitest';
import {
  resolveItemDisplay,
  normalizeDisplayStats,
  DisplayStat,
} from '../customDataResolver';

// ============================================================
// normalizeDisplayStats — 将各种 displayStats 格式统一为数组
// ============================================================
describe('normalizeDisplayStats', () => {
  it('标准数组格式直接返回', () => {
    const input: DisplayStat[] = [
      { key: 'attack', label: '攻击力', value: '+5' },
      { key: 'defense', label: '防御力', value: '+3' },
    ];

    const result = normalizeDisplayStats(input);
    expect(result).toEqual(input);
  });

  it('Record<string, string> 格式自动转换为数组', () => {
    const input: Record<string, string> = {
      attack: '+5',
      defense: '+3',
    };

    const result = normalizeDisplayStats(input);
    expect(result).toEqual([
      { key: 'attack', label: 'attack', value: '+5' },
      { key: 'defense', label: 'defense', value: '+3' },
    ]);
  });

  it('Record<string, number> 格式自动转换，value 转为字符串', () => {
    const input = {
      attack: 5,
      defense: 3,
    };

    const result = normalizeDisplayStats(input);
    expect(result).toEqual([
      { key: 'attack', label: 'attack', value: '5' },
      { key: 'defense', label: 'defense', value: '3' },
    ]);
  });

  it('null/undefined 返回 undefined', () => {
    expect(normalizeDisplayStats(null)).toBeUndefined();
    expect(normalizeDisplayStats(undefined)).toBeUndefined();
  });

  it('空数组返回 undefined', () => {
    expect(normalizeDisplayStats([])).toBeUndefined();
  });

  it('空 Record 返回 undefined', () => {
    expect(normalizeDisplayStats({})).toBeUndefined();
  });

  it('数组中缺少字段的条目被过滤', () => {
    const input = [
      { key: 'attack', label: '攻击力', value: '+5' },
      { key: 'defense', label: '防御力' }, // 缺少 value
      { label: '速度', value: '+2' }, // 缺少 key
    ] as any;

    const result = normalizeDisplayStats(input);
    expect(result).toEqual([
      { key: 'attack', label: '攻击力', value: '+5' },
    ]);
  });

  it('数组中 value 为 number 时转为字符串', () => {
    const input = [
      { key: 'attack', label: '攻击力', value: 5 },
    ] as any;

    const result = normalizeDisplayStats(input);
    expect(result).toEqual([
      { key: 'attack', label: '攻击力', value: '5' },
    ]);
  });

  it('非对象非数组的值返回 undefined', () => {
    expect(normalizeDisplayStats('invalid')).toBeUndefined();
    expect(normalizeDisplayStats(42)).toBeUndefined();
    expect(normalizeDisplayStats(true)).toBeUndefined();
  });
});

// ============================================================
// resolveItemDisplay — 物品展示数据解析
// ============================================================
describe('resolveItemDisplay', () => {
  it('从 customData 读取 displayType', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: { displayType: '武器' },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayType).toBe('武器');
  });

  it('从 customData 读取 displayRarity', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: { displayRarity: '稀有' },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayRarity).toBe('稀有');
  });

  it('从 customData 读取数组格式的 displayStats', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: {
        displayStats: [
          { key: 'attack', label: '攻击力', value: '+5' },
          { key: 'defense', label: '防御力', value: '+3' },
        ],
      },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayStats).toEqual([
      { key: 'attack', label: '攻击力', value: '+5' },
      { key: 'defense', label: '防御力', value: '+3' },
    ]);
  });

  it('将 Record 格式的 displayStats 自动转换为数组', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: {
        displayStats: { attack: '+5', defense: '+3' },
      },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayStats).toEqual([
      { key: 'attack', label: 'attack', value: '+5' },
      { key: 'defense', label: 'defense', value: '+3' },
    ]);
  });

  it('将 Record<string, number> 格式的 displayStats 自动转换', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: {
        displayStats: { attack: 35, defense: 28 },
      },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayStats).toEqual([
      { key: 'attack', label: 'attack', value: '35' },
      { key: 'defense', label: 'defense', value: '28' },
    ]);
  });

  it('从 customData 读取 displayEffects', () => {
    const item = {
      id: 'item-1',
      name: '火焰剑',
      customData: {
        displayEffects: ['攻击时有20%概率点燃目标', '对冰属性敌人伤害+50%'],
      },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayEffects).toEqual(['攻击时有20%概率点燃目标', '对冰属性敌人伤害+50%']);
  });

  it('无 customData 时所有字段为 undefined', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayType).toBeUndefined();
    expect(display.displayRarity).toBeUndefined();
    expect(display.displayStats).toBeUndefined();
    expect(display.displayEffects).toBeUndefined();
  });

  it('customData 为空对象时所有字段为 undefined', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: {},
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayType).toBeUndefined();
    expect(display.displayRarity).toBeUndefined();
    expect(display.displayStats).toBeUndefined();
    expect(display.displayEffects).toBeUndefined();
  });

  it('displayType 非字符串时返回 undefined', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: { displayType: 123 },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayType).toBeUndefined();
  });

  it('displayEffects 非数组时返回 undefined', () => {
    const item = {
      id: 'item-1',
      name: '铁剑',
      customData: { displayEffects: 'not an array' },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayEffects).toBeUndefined();
  });

  it('LLM enrich 后的完整物品数据', () => {
    const item = {
      id: 'item-1',
      name: '烈焰之剑',
      customData: {
        displayType: '双手剑',
        displayRarity: '史诗',
        displayStats: [
          { key: 'attack', label: '攻击力', value: '+35' },
          { key: 'fire_damage', label: '火焰伤害', value: '+15' },
          { key: 'crit_rate', label: '暴击率', value: '+8%' },
        ],
        displayEffects: ['攻击时有20%概率点燃目标', '对冰属性敌人伤害+50%'],
        tags: ['fire', 'two-handed', 'epic'],
        locale: 'zh-CN',
      },
    } as any;

    const display = resolveItemDisplay(item);
    expect(display.displayType).toBe('双手剑');
    expect(display.displayRarity).toBe('史诗');
    expect(display.displayStats).toHaveLength(3);
    expect(display.displayStats![0]).toEqual({ key: 'attack', label: '攻击力', value: '+35' });
    expect(display.displayEffects).toHaveLength(2);
  });
});
