/**
 * ModeRouter 实现（code-design §6）
 *
 * 期望效果：
 * - 读取 save.game_mode + save.active_challenge_mode
 * - 查 mode + intentHint → candidateAgents 映射表
 * - 返回候选 Agent 类型列表
 * - 纯查询，无副作用
 *
 * 架构约束:
 * - 位于业务层 F 的 shared 子目录（跨领域共享基础设施）
 * - 跨领域访问经端口接口（ISaveRepository 注入，D3 决策）
 */

import type { ID, GameMode, ChallengeMode } from '@ai-rpg/shared';
import type { ISaveRepository } from '../../save/types.js';
import type { IModeRouter, ModeRouteResult } from './types.js';
import { MODE_AGENT_MAPPING, normalizeGameMode } from './agent-mapping.js';

/**
 * ModeRouter 实现
 *
 * 期望效果：
 * - 构造函数注入 ISaveRepository（端口接口，跨领域访问经端口）
 * - routeMode 方法读取 save + 查映射表
 * - save 不存在时抛错（禁止 fallback）
 * - 纯查询，无副作用
 *
 * DF-007 修复：
 * - challengeMode 从 save.active_challenge_mode 列读取（持久化跨请求）
 * - 不再从内存读取（会丢失）
 */
export class ModeRouter implements IModeRouter {
  constructor(
    private readonly saveRepository: ISaveRepository,
  ) {}

  async routeMode(saveId: ID, intentHint: string): Promise<ModeRouteResult> {
    const save = await this.saveRepository.findById(saveId);
    if (!save) {
      throw new Error(`存档不存在: ${saveId}`);
    }

    const rawGameMode = save.game_mode as GameMode;
    // DF-007 修复：从持久化字段读取挑战模式（跨请求可见）
    const challengeMode = (save.active_challenge_mode as ChallengeMode | null) ?? null;

    // 废弃别名归一化（turn_based_rpg/dynamic_combat/narrative_focus → text_rpg）
    // 旧存档 game_mode 字段可能是废弃别名，归一化后再查映射表
    const gameMode = normalizeGameMode(rawGameMode);

    // 查映射表：未配置的 gameMode 或 intentHint → 空候选 → 走 universal 组
    const modeMapping = MODE_AGENT_MAPPING[gameMode] || {};
    const candidateAgentTypes = modeMapping[intentHint] || [];

    return {
      gameMode,
      challengeMode,
      candidateAgentTypes,
      reason: `game_mode=${rawGameMode}${rawGameMode !== gameMode ? `→${gameMode}` : ''} + intentHint=${intentHint} → ${candidateAgentTypes.length} 个候选 Agent`,
    };
  }
}
