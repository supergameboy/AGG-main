/**
 * 叙事战斗策略（code-design §4.2）
 *
 * 期望效果：
 * - GM 全权控制攻击顺序、伤害、状态效果
 * - 不调用 CharacterService/InventoryService/SkillService/NumericalService
 * - 不写 combat_states（不持久化）
 * - 不写 combat_history
 * - 不 emit combat_end（不污染 entity_graph）
 * - 通过 narrate_combat 工具多轮交互
 *
 * 设计契约（code-design §4.2）:
 * - processPlayerAction / processEnemyTurn / tickStatusEffects 不实现（GM 直接控制）
 * - checkEnd 始终返回 { ended: false }（叙事模式由 GM 决定结束）
 *
 * checkEnd 接口契约桩说明（2026-07-26 死代码审查）:
 * - IChallengeStrategy.checkEnd 是必填方法（combat/types.ts:389），删除会导致 TSC 编译错误
 * - narrative_combat 在 game-service.ts:61 NON_COMBAT_MODES 中，G2 快速路径会拒绝处理
 *   （game-service.ts:802-805 抛错"挑战模式 narrative_combat 不支持 G2 快速路径"）
 * - 因此 NarrativeCombatStrategy.checkEnd 实际不会被 G2 路径调用
 * - 即使被调用（如 CombatService 数值路径），也返回 { ended: false }——叙事模式由 GM 决定结束
 * - 这是端口-适配器模式的"契约桩"（contract stub），不是死代码
 */

import type { Knex } from 'knex';
import type {
  ID,
  ChallengeState,
  ChallengeAction,
  ChallengeStepResult,
  ChallengeEndResult,
  ChallengeParticipant,
} from '@ai-rpg/shared';
import type { EventBus } from '@ai-rpg/shared/messaging';
import type { ICombatModeStrategy, ChallengeOptions } from '../types.js';
import type { ISaveRepository } from '../../save/types.js';

export class NarrativeCombatStrategy implements ICombatModeStrategy {
  readonly mode = 'narrative_combat' as const;

  constructor(
    /**
     * Save 表 Repository（端口接口注入，D3 禁止跨领域表直接访问）
     * - 用于 endChallenge 时重置 saves.active_challenge_mode 为 null
     * - 与 select_challenge_mode 工具的写入对称（战斗结束必须清除残留模式）
     * - 叙事模式虽然不持久化战斗状态，但 active_challenge_mode 仍由 select_challenge_mode 持久化
     */
    private readonly saveRepository: ISaveRepository,
    // 叙事模式无跨域 Service 依赖；EventBus 可选，用于自定义事件
    // 注：当前未使用，保留以备未来叙事战斗自定义事件扩展
    _eventBus?: EventBus,
  ) {}

  async startChallenge(
    saveId: ID,
    participants: ChallengeParticipant[],
    _options: ChallengeOptions,
    _trx?: Knex.Transaction,
  ): Promise<ChallengeState> {
    if (participants.length === 0) {
      throw new Error(`叙事战斗开始失败: saveId=${saveId} 参与者列表为空`);
    }

    // 不持久化，仅返回内存状态
    return {
      saveId,
      mode: 'narrative_combat',
      active: true,
      participants,
      turn: 0,
      round: 1,
      lastActionAt: Date.now(),
      metadata: { narrative_log: [] },
    };
  }

  async executeStep(
    _saveId: ID,
    _state: ChallengeState,
    action: ChallengeAction,
    _trx?: Knex.Transaction,
  ): Promise<ChallengeStepResult> {
    // 返回 GM 描述作为结果，不修改任何状态
    return {
      actionResult: {
        success: true,
        description: action.description || 'GM 叙事推进',
        actorId: action.actorId,
      },
      combatEnded: false,
      hint: '叙事战斗由 GM 控制，可继续 narrate_combat',
    };
  }

  // processPlayerAction / processEnemyTurn / tickStatusEffects 不实现（GM 直接控制）

  async endChallenge(
    saveId: ID,
    state: ChallengeState,
    result: ChallengeEndResult['result'],
    trx?: Knex.Transaction,
  ): Promise<ChallengeEndResult> {
    // 重置 saves.active_challenge_mode（与 select_challenge_mode 写入对称）
    // 叙事模式不写 history、不 emit combat_end，但仍需清除残留模式
    await this.saveRepository.updateFields(saveId, { active_challenge_mode: null }, trx);
    return {
      result,
      participants: state.participants,
    };
  }

  /**
   * 接口契约桩（IChallengeStrategy.checkEnd 必填方法）。
   *
   * 期望效果：
   * - 始终返回 { ended: false }——叙事模式由 GM 决定结束，不自动检测
   * - 实际不会被 G2 路径调用（narrative_combat 在 NON_COMBAT_MODES 中被拒绝）
   * - 详见类顶部注释"checkEnd 接口契约桩说明"
   */
  checkEnd(_state: ChallengeState): { ended: boolean; result?: ChallengeEndResult['result'] } {
    return { ended: false };
  }
}
