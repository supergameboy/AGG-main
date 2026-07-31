/**
 * 游戏时间系统默认配置
 *
 * ⚠️ 已知技术债：当前仅硬编码默认值，无优先级解析机制。
 * - 模板 game_rules.time_system 配置：未实现（仅在 TemplateRuleParser 中作为 boolean 开关存在）
 * - Agent 系统根据动作复杂度动态计算：未实现
 * - 本文件中的默认值：当前唯一生效的配置来源
 *
 * GameTimeService 通过 `{ ...DEFAULT_TIME_CONFIG, ...config }` 简单合并，
 * 不存在按优先级逐级回退的解析逻辑。
 */

import type { GameTimeConfig, ActionType } from './types.js';

/** 默认时间配置 */
export const DEFAULT_TIME_CONFIG: GameTimeConfig = {
  startHour: 8,
  startMinute: 0,
  minutesPerDay: 24 * 60,
  variancePercent: 0.2
};

/** 动作类型到时间消耗的映射（默认值） */
export const ACTION_TIME_MAP: Record<ActionType, { baseMinutes: number; range?: number; description: string }> = {
  dialogue: { baseMinutes: 10, description: '与NPC交谈' },
  move: { baseMinutes: 15, range: 30, description: '移动到新位置' },
  explore: { baseMinutes: 20, range: 40, description: '探索区域' },
  combat: { baseMinutes: 30, range: 60, description: '战斗（含前后整理）' },
  trade: { baseMinutes: 10, description: '商店交易' },
  rest: { baseMinutes: 60, description: '休息（基础1小时，可指定）' },
  use_item: { baseMinutes: 5, description: '使用物品' },
  quest_complete: { baseMinutes: 10, description: '提交任务' },
  save: { baseMinutes: 0, description: '存档（不计入游戏时间）' },
  status: { baseMinutes: 0, description: '查看状态（不计入游戏时间）' },
  cast_skill: { baseMinutes: 0, description: '释放技能（包含在战斗/对话中）' },
  quest_accept: { baseMinutes: 5, description: '接取任务' }
};
