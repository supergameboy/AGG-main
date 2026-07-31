/**
 * ModeRouter 端口接口（code-design §3.2）
 *
 * 期望效果：
 * - 输入：saveId + intentHint（来自 preprocessAction）
 * - 输出：候选 Agent 类型列表 + 当前模式信息
 * - 副作用：无（纯查询）
 * - 错误：saveId 不存在时抛错
 *
 * 架构约束:
 * - 位于业务层 F 的 shared 子目录（跨领域共享基础设施）
 * - 跨领域访问经端口接口（ISaveRepository 注入）
 */

import type { ID, GameMode, ChallengeMode } from '@ai-rpg/shared';

/**
 * 模式路由器端口接口
 *
 * 期望效果：
 * - 读取 save.game_mode
 * - 查 mode + intentHint → candidateAgents 映射表
 * - 返回候选 Agent 类型列表
 */
export interface IModeRouter {
  /**
   * 路由模式
   *
   * 期望效果：
   * - 读取 save.game_mode
   * - 查 mode + intentHint → candidateAgents 映射表
   * - 返回候选 Agent 类型列表
   */
  routeMode(saveId: ID, intentHint: string): Promise<ModeRouteResult>;
}

/**
 * 模式路由结果
 *
 * 期望效果：
 * - gameMode: 当前游戏模式（从 save.game_mode 读取）
 * - challengeMode: 当前挑战模式（从 save.active_challenge_mode 读取，若在挑战中）
 * - candidateAgentTypes: 候选 Agent 类型列表（空数组表示使用 universal 组）
 * - reason: 路由理由（用于调试）
 */
export interface ModeRouteResult {
  /** 当前游戏模式 */
  gameMode: GameMode;
  /** 当前挑战模式（若在挑战中） */
  challengeMode: ChallengeMode | null;
  /** 候选 Agent 类型列表（空数组表示使用 universal 组） */
  candidateAgentTypes: string[];
  /** 路由理由（用于调试） */
  reason: string;
}
