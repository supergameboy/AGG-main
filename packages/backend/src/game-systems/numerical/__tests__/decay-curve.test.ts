import { describe, expect, it } from 'vitest';
import { DecayCurveCalculator } from '../DecayCurveCalculator.js';
import type { DecayCurve } from '@ai-rpg/shared';

describe('DecayCurveCalculator', () => {
  describe('applyDecay', () => {
    it('linear: decreases value by rate per tick', () => {
      const curve: DecayCurve = { type: 'linear', rate: 5, floor: 0 };
      expect(DecayCurveCalculator.applyDecay(100, curve, 1)).toBe(95);
      expect(DecayCurveCalculator.applyDecay(95, curve, 1)).toBe(90);
    });

    it('linear: respects deltaTime', () => {
      const curve: DecayCurve = { type: 'linear', rate: 3, floor: 0 };
      expect(DecayCurveCalculator.applyDecay(100, curve, 3)).toBe(91);
    });

    it('exponential: decreases value by percentage per tick', () => {
      const curve: DecayCurve = { type: 'exponential', rate: 0.1, floor: 0 };
      const result = DecayCurveCalculator.applyDecay(100, curve, 1);
      expect(result).toBeCloseTo(90, 1);
    });

    it('exponential: respects deltaTime with power', () => {
      const curve: DecayCurve = { type: 'exponential', rate: 0.1, floor: 0 };
      const result = DecayCurveCalculator.applyDecay(100, curve, 2);
      expect(result).toBeCloseTo(81, 1);
    });

    it('logarithmic: decreases value by log factor', () => {
      const curve: DecayCurve = { type: 'logarithmic', rate: 1, floor: 0 };
      const result = DecayCurveCalculator.applyDecay(100, curve, 1);
      // 100 / (1 + 1 * Math.log(2)) = 100 / (1 + 0.693) = 100 / 1.693
      expect(result).toBeCloseTo(59.07, 1);
    });

    it('floor: value never goes below floor', () => {
      const curve: DecayCurve = { type: 'linear', rate: 50, floor: 10 };
      expect(DecayCurveCalculator.applyDecay(30, curve, 1)).toBe(10);
      expect(DecayCurveCalculator.applyDecay(10, curve, 1)).toBe(10);
      expect(DecayCurveCalculator.applyDecay(5, curve, 1)).toBe(10);
    });

    it('exponential floor: value never goes below floor', () => {
      const curve: DecayCurve = { type: 'exponential', rate: 0.5, floor: 5 };
      const result = DecayCurveCalculator.applyDecay(10, curve, 1);
      expect(result).toBeGreaterThanOrEqual(5);
    });

    it('returns floor immediately when currentValue is already at floor', () => {
      const curve: DecayCurve = { type: 'linear', rate: 5, floor: 10 };
      expect(DecayCurveCalculator.applyDecay(10, curve, 1)).toBe(10);
    });

    it('returns floor immediately when currentValue is below floor', () => {
      const curve: DecayCurve = { type: 'linear', rate: 5, floor: 10 };
      expect(DecayCurveCalculator.applyDecay(3, curve, 1)).toBe(10);
    });
  });

  describe('ticksToFloor', () => {
    it('returns 0 when value is already at or below floor', () => {
      const curve: DecayCurve = { type: 'linear', rate: 5, floor: 10 };
      expect(DecayCurveCalculator.ticksToFloor(10, curve)).toBe(0);
      expect(DecayCurveCalculator.ticksToFloor(5, curve)).toBe(0);
    });

    it('counts ticks correctly for linear decay', () => {
      const curve: DecayCurve = { type: 'linear', rate: 10, floor: 0 };
      // 100 -> 90 -> 80 -> ... -> 0 = 10 ticks
      expect(DecayCurveCalculator.ticksToFloor(100, curve)).toBe(10);
    });

    it('counts ticks correctly for linear decay with non-zero floor', () => {
      const curve: DecayCurve = { type: 'linear', rate: 10, floor: 20 };
      // 100 -> 90 -> 80 -> 70 -> 60 -> 50 -> 40 -> 30 -> 20 = 8 ticks
      expect(DecayCurveCalculator.ticksToFloor(100, curve)).toBe(8);
    });

    it('counts ticks for exponential decay', () => {
      const curve: DecayCurve = { type: 'exponential', rate: 0.5, floor: 1 };
      const ticks = DecayCurveCalculator.ticksToFloor(100, curve);
      // Exponential decay should take more ticks than linear with same rate
      expect(ticks).toBeGreaterThan(0);
      expect(ticks).toBeLessThanOrEqual(1000);
    });

    it('counts ticks for logarithmic decay', () => {
      const curve: DecayCurve = { type: 'logarithmic', rate: 2, floor: 1 };
      const ticks = DecayCurveCalculator.ticksToFloor(100, curve);
      expect(ticks).toBeGreaterThan(0);
      expect(ticks).toBeLessThanOrEqual(1000);
    });
  });

  describe('getCurve', () => {
    const curves: Record<string, DecayCurve> = {
      fast_decay: { type: 'linear', rate: 10, floor: 0 },
      slow_decay: { type: 'exponential', rate: 0.05, floor: 1 },
      buff_fade: { type: 'logarithmic', rate: 0.5, floor: 0 },
    };

    it('returns named curve when found', () => {
      const result = DecayCurveCalculator.getCurve(curves, 'fast_decay');
      expect(result).toEqual({ type: 'linear', rate: 10, floor: 0 });
    });

    it('returns default curve when name not found but default exists', () => {
      const result = DecayCurveCalculator.getCurve(curves, 'nonexistent', 'slow_decay');
      expect(result).toEqual({ type: 'exponential', rate: 0.05, floor: 1 });
    });

    it('returns fallback when neither name nor default found', () => {
      const result = DecayCurveCalculator.getCurve(curves, 'nonexistent', 'also_nonexistent');
      expect(result).toEqual({ type: 'linear', rate: 1, floor: 0 });
    });

    it('returns fallback when config is undefined', () => {
      const result = DecayCurveCalculator.getCurve(undefined, 'fast_decay');
      expect(result).toEqual({ type: 'linear', rate: 1, floor: 0 });
    });

    it('returns fallback when curveName is undefined', () => {
      const result = DecayCurveCalculator.getCurve(curves, undefined);
      expect(result).toEqual({ type: 'linear', rate: 1, floor: 0 });
    });

    it('returns named curve even when default is also provided', () => {
      const result = DecayCurveCalculator.getCurve(curves, 'buff_fade', 'slow_decay');
      expect(result).toEqual({ type: 'logarithmic', rate: 0.5, floor: 0 });
    });
  });
});
