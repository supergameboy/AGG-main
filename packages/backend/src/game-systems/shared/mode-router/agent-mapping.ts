/**
 * mode + intentHint → candidateAgents 映射表（code-design §6）
 *
 * 期望效果：
 * - 输入：gameMode + intentHint
 * - 输出：候选 Agent 类型列表（空数组表示使用 universal 组）
 *
 * 设计约束:
 * - AgentType 与 fantasy_rpg.yaml 的 englishId 一致（如 'gamemaster' / 'challenge'）
 * - 阶段五 yaml 分组重构后，候选项与 yaml 配置一致（含 game_mode 维度差异化配置）
 *
 * 映射规则:
 * - gameMode 维度区分：text_adventure / text_rpg / visual_novel / rpg_2d / sandbox / story
 * - intentHint 维度区分：combat / explore / dialogue / quest / inventory / character 等
 * - 不同 gameMode 下同一 intentHint 可能映射到不同的 Agent
 *
 * 废弃别名处理（D3 修订 + 2026-07-26 别名清理）:
 * - GameMode 类型仍保留 turn_based_rpg / dynamic_combat / narrative_focus 三个废弃别名（旧存档读取兼容）
 * - 本映射表只保留 6 个规范 GameMode 条目（清爽）
 * - 旧存档读取时通过 normalizeGameMode 归一化为规范值后再查表（mode-router.ts 调用）
 * - 阶段五 save 迁移脚本落地后，GameMode 类型的废弃别名可彻底移除
 */

import type { GameMode } from '@ai-rpg/shared';

/**
 * intentHint → candidateAgentTypes 映射
 */
export type IntentAgentMap = Record<string, string[]>;

/**
 * 规范 GameMode 集合（不含废弃别名）
 *
 * 用于 MODE_AGENT_MAPPING 类型约束，确保映射表只覆盖规范值。
 * 废弃别名经 normalizeGameMode 归一化后再查表。
 */
export type CanonicalGameMode = Exclude<
  GameMode,
  'turn_based_rpg' | 'dynamic_combat' | 'narrative_focus'
>;

/**
 * 废弃 GameMode 别名 → 规范值 映射
 *
 * 用于读取旧存档 game_mode 字段时归一化为规范值。
 * - turn_based_rpg → text_rpg（原重命名）
 * - dynamic_combat → text_rpg（挑战模式由 default_challenge_mode: dynamic_combat 单独承载）
 * - narrative_focus → text_rpg（挑战模式由 default_challenge_mode: narrative_combat 单独承载）
 *
 * 阶段五 save 迁移脚本落地后，此映射可彻底移除。
 */
export const DEPRECATED_GAME_MODE_NORMALIZATION: Record<
  'turn_based_rpg' | 'dynamic_combat' | 'narrative_focus',
  CanonicalGameMode
> = {
  turn_based_rpg: 'text_rpg',
  dynamic_combat: 'text_rpg',
  narrative_focus: 'text_rpg',
};

/**
 * 将 GameMode 归一化为规范值
 *
 * 期望效果：
 * - 输入规范值（text_adventure/text_rpg/visual_novel/rpg_2d/sandbox/story）→ 原样返回
 * - 输入废弃别名（turn_based_rpg/dynamic_combat/narrative_focus）→ 返回对应的规范值
 * - 输入未知值（理论上不会发生，GameMode 类型已约束）→ 原样返回（让下游兜底处理）
 *
 * @param mode save.game_mode 读取的原始值（可能是废弃别名）
 * @returns 规范化的 GameMode（保证不是废弃别名）
 */
export function normalizeGameMode(mode: GameMode): CanonicalGameMode {
  if (mode in DEPRECATED_GAME_MODE_NORMALIZATION) {
    return DEPRECATED_GAME_MODE_NORMALIZATION[
      mode as 'turn_based_rpg' | 'dynamic_combat' | 'narrative_focus'
    ];
  }
  return mode as CanonicalGameMode;
}

/**
 * gameMode → (intentHint → candidateAgentTypes) 映射
 *
 * 设计说明：
 * - 仅覆盖 6 个规范 GameMode（废弃别名经 normalizeGameMode 归一化后查表）
 * - 未配置的 intentHint 返回空数组（→ 走 universal 组）
 * - 'universal' 是隐式兜底，所有未匹配的都走 universal 组
 */
export const MODE_AGENT_MAPPING: Record<CanonicalGameMode, IntentAgentMap> = {
  /**
   * 文字冒险模式：探索 + 对话为主
   * - 战斗较少，主要走 narrative_combat（GM 全权控制）
   * - 候选 Agent 以 gamemaster 为主
   */
  text_adventure: {
    combat: ['gamemaster'],
    explore: ['gamemaster'],
    dialogue: ['gamemaster'],
    quest: ['gamemaster'],
    inventory: ['gamemaster'],
    character: ['gamemaster'],
  },

  /**
   * 文字 RPG 模式：回合制战斗为主
   * - 战斗走 turn_based_combat（程序化数值计算）
   * - 战斗场景候选 challenge，非战斗场景候选 gamemaster
   */
  text_rpg: {
    combat: ['challenge', 'gamemaster'],
    explore: ['gamemaster'],
    dialogue: ['gamemaster'],
    quest: ['gamemaster'],
    inventory: ['gamemaster'],
    character: ['gamemaster'],
  },

  /**
   * 视觉小说模式：对话为主
   * - 几乎无战斗，全部走 gamemaster
   */
  visual_novel: {
    dialogue: ['gamemaster'],
    explore: ['gamemaster'],
    quest: ['gamemaster'],
    character: ['gamemaster'],
  },

  /**
   * 2D RPG 模式：动态战斗为主
   * - 战斗走 dynamic_combat（程序化数值计算）
   * - 战斗场景候选 challenge，非战斗场景候选 gamemaster
   */
  rpg_2d: {
    combat: ['challenge', 'gamemaster'],
    explore: ['gamemaster'],
    dialogue: ['gamemaster'],
    quest: ['gamemaster'],
    inventory: ['gamemaster'],
    character: ['gamemaster'],
  },

  /**
   * 沙盒模式：自由探索
   * - 全部走 gamemaster
   */
  sandbox: {
    combat: ['gamemaster'],
    explore: ['gamemaster'],
    dialogue: ['gamemaster'],
    quest: ['gamemaster'],
    inventory: ['gamemaster'],
    character: ['gamemaster'],
  },

  /**
   * 故事模式：剧情驱动
   * - 全部走 gamemaster
   */
  story: {
    dialogue: ['gamemaster'],
    explore: ['gamemaster'],
    quest: ['gamemaster'],
    character: ['gamemaster'],
  },
};
