/**
 * 战斗策略桶导出（code-design §1.1）
 *
 * 仅导出本模块内容（架构规范 3.2 桶导出禁令）。
 * 消费方直接从本文件 import 策略类，不通过跨层桶导出。
 */

export { CombatStrategyBase } from './combat-strategy-base.js';
export { NarrativeCombatStrategy } from './narrative-strategy.js';
export { TurnBasedCombatStrategy } from './turn-based-strategy.js';
export { DynamicCombatStrategy } from './dynamic-strategy.js';
