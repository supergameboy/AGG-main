/**
 * G2 程序执行层桶导出
 *
 * 设计依据：fractal-design-20260724-g2-program-execution-layer
 * - G2 层从"挑战编排层"扩展为"程序执行层"
 * - 支持多个领域程序（ChallengeProgram / InventoryProgram / MapProgram 等）
 * - 当前仅 ChallengeProgram，后续按需扩展
 */

export { ChallengeProgram } from './ChallengeProgram.js';
export type {
  IChallengeProgram,
  ChallengeEndCheck,
} from './types.js';
