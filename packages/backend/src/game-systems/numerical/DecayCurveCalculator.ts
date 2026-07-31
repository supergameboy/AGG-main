import type { DecayCurve } from '../../../../shared/src/types/template.js';

const FALLBACK_CURVE: DecayCurve = { type: 'linear', rate: 1, floor: 0 };
const MAX_TICKS_TO_FLOOR = 1000;

export class DecayCurveCalculator {
  /**
   * Calculate the next value after applying one tick of decay.
   */
  static applyDecay(currentValue: number, curve: DecayCurve, deltaTime: number = 1): number {
    if (currentValue <= curve.floor) return curve.floor;

    let newValue: number;

    switch (curve.type) {
      case 'linear':
        newValue = currentValue - curve.rate * deltaTime;
        break;
      case 'exponential':
        newValue = currentValue * Math.pow(1 - curve.rate, deltaTime);
        break;
      case 'logarithmic':
        newValue = currentValue / (1 + curve.rate * Math.log(deltaTime + 1));
        break;
      default:
        newValue = currentValue - curve.rate * deltaTime;
    }

    return Math.max(curve.floor, newValue);
  }

  /**
   * Calculate remaining ticks until value reaches floor.
   */
  static ticksToFloor(currentValue: number, curve: DecayCurve): number {
    if (currentValue <= curve.floor) return 0;

    let value = currentValue;
    let ticks = 0;

    while (value > curve.floor && ticks < MAX_TICKS_TO_FLOOR) {
      value = this.applyDecay(value, curve, 1);
      ticks++;
    }

    return ticks;
  }

  /**
   * Get a predefined curve by name from config, or return a default linear curve.
   */
  static getCurve(
    config: Record<string, DecayCurve> | undefined,
    curveName: string | undefined,
    defaultCurve?: string
  ): DecayCurve {
    if (config && curveName && config[curveName]) {
      return config[curveName];
    }
    if (config && defaultCurve && config[defaultCurve]) {
      return config[defaultCurve];
    }
    return FALLBACK_CURVE;
  }
}
