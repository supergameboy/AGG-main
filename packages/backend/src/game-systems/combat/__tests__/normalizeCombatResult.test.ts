import { describe, expect, it } from 'vitest';
import { normalizeCombatResult } from '../CombatServiceTool.js';

/**
 * Bug fix: combat end_combat 结果反转
 *
 * LLM 传入简化格式 { result: "victory" } 时，
 * CombatResult 接口期望 { victory: boolean, ... }，
 * 导致 result.victory 为 undefined → falsy → 走到 defeat 分支。
 *
 * normalizeCombatResult 负责将简化格式转换为标准 CombatResult。
 */
describe('normalizeCombatResult', () => {
  const defaultResult = {
    experience: 0,
    currency: {},
    drops: [],
    turnsElapsed: 0,
    participantResults: [],
  };

  describe('标准格式输入（victory 为 boolean）', () => {
    it('victory: true 时直接返回，不转换', () => {
      const input = { victory: true, fled: false, defeat: false, ...defaultResult };
      const result = normalizeCombatResult(input);
      expect(result.victory).toBe(true);
      expect(result.fled).toBe(false);
      expect(result.defeat).toBe(false);
    });

    it('victory: false, defeat: true 时直接返回', () => {
      const input = { victory: false, fled: false, defeat: true, ...defaultResult };
      const result = normalizeCombatResult(input);
      expect(result.victory).toBe(false);
      expect(result.defeat).toBe(true);
    });

    it('fled: true 时直接返回', () => {
      const input = { victory: false, fled: true, defeat: false, ...defaultResult };
      const result = normalizeCombatResult(input);
      expect(result.fled).toBe(true);
    });
  });

  describe('LLM 简化格式输入 { result: "victory" }', () => {
    it('result: "victory" 转换为 victory: true', () => {
      const result = normalizeCombatResult({ result: 'victory' });
      expect(result.victory).toBe(true);
      expect(result.fled).toBe(false);
      expect(result.defeat).toBe(false);
    });

    it('result: "fled" 转换为 fled: true', () => {
      const result = normalizeCombatResult({ result: 'fled' });
      expect(result.victory).toBe(false);
      expect(result.fled).toBe(true);
      expect(result.defeat).toBe(false);
    });

    it('result: "defeat" 转换为 defeat: true', () => {
      const result = normalizeCombatResult({ result: 'defeat' });
      expect(result.victory).toBe(false);
      expect(result.fled).toBe(false);
      expect(result.defeat).toBe(true);
    });
  });

  describe('边界情况', () => {
    it('null 输入返回默认 defeat 结果', () => {
      const result = normalizeCombatResult(null);
      expect(result.victory).toBe(false);
      expect(result.fled).toBe(false);
      expect(result.defeat).toBe(true);
    });

    it('undefined 输入返回默认 defeat 结果', () => {
      const result = normalizeCombatResult(undefined);
      expect(result.victory).toBe(false);
      expect(result.defeat).toBe(true);
    });

    it('字符串输入返回默认 defeat 结果', () => {
      const result = normalizeCombatResult('victory');
      expect(result.victory).toBe(false);
      expect(result.defeat).toBe(true);
    });

    it('数字输入返回默认 defeat 结果', () => {
      const result = normalizeCombatResult(42);
      expect(result.defeat).toBe(true);
    });

    it('空对象返回默认 defeat 结果', () => {
      const result = normalizeCombatResult({});
      expect(result.defeat).toBe(true);
    });

    it('未知 result 字符串值时三个标志均为 false', () => {
      const result = normalizeCombatResult({ result: 'unknown' });
      expect(result.victory).toBe(false);
      expect(result.fled).toBe(false);
      expect(result.defeat).toBe(false);
    });
  });

  describe('转换后结构完整性', () => {
    it('简化格式转换后包含所有必需字段', () => {
      const result = normalizeCombatResult({ result: 'victory' });
      expect(result).toHaveProperty('victory');
      expect(result).toHaveProperty('fled');
      expect(result).toHaveProperty('defeat');
      expect(result).toHaveProperty('experience');
      expect(result).toHaveProperty('currency');
      expect(result).toHaveProperty('drops');
      expect(result).toHaveProperty('turnsElapsed');
      expect(result).toHaveProperty('participantResults');
    });

    it('简化格式转换后默认值正确', () => {
      const result = normalizeCombatResult({ result: 'victory' });
      expect(result.experience).toBe(0);
      expect(result.currency).toEqual({});
      expect(result.drops).toEqual([]);
      expect(result.turnsElapsed).toBe(0);
      expect(result.participantResults).toEqual([]);
    });
  });
});
