/**
 * 回合制战斗策略（code-design §4.1）
 *
 * 期望效果：
 * - 玩家先攻击，敌人后攻击
 * - 调用 CharacterService/InventoryService/SkillService/NumericalService 进行数值计算
 * - 写 combat_states + combat_history
 * - emit combat_end 事件
 *
 * 敌人策略数据源（满足用户"战斗开始时 Combat Agent 输出敌人策略"需求）:
 * - processEnemyTurn 从 state.enemyStrategy 读取敌人策略（一次性，战斗开始时由 combat_director Agent 生成）
 * - 基于 state.enemyStrategy.aggression / skillPriority / targetPreference / fleeThreshold 执行敌人回合决策
 * - 若 state.enemyStrategy 缺失，抛 EnemyStrategyMissingError 暴露问题，禁止静默 fallback
 *
 * 适配映射（阶段二并存策略，code-design §2.3）:
 * - 接口签名使用 ChallengeState 类型（满足 IChallengeStrategy 契约）
 * - 内部状态使用 CombatState 类型（复用现有数值计算逻辑 + 兼容现有 Repository）
 * - 入口/出口通过 challengeStateToCombatState / combatStateToChallengeState 适配
 *
 * 实现说明：
 * - 继承 CombatStrategyBase 复用 startChallenge/endChallenge/checkEnd/processPlayerAction/processEnemyTurn/tickStatusEffects 等通用方法
 * - 仅实现 executeStep 定义回合制流程：玩家先攻 → 检测结束 → 状态效果 → 敌人后攻 → 检测结束 → 保存
 */

import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../../../shared/src/types/core.js';
import type {
  ChallengeState,
  ChallengeAction,
  ChallengeStepResult,
} from '@ai-rpg/shared';
import { challengeStateToCombatState } from '../types.js';
import { CombatStrategyBase } from './combat-strategy-base.js';

/**
 * 回合制战斗策略
 *
 * 回合编排（executeStep 差异化）:
 * 1. 玩家先攻击（processPlayerAction）
 * 2. 检测结束（玩家行动后）
 * 3. 状态效果 tick（玩家行动后）
 * 4. 敌人后攻（processEnemyTurn 读取 enemyStrategy）
 * 5. 状态效果 tick（敌人行动后）
 * 6. 推进回合 + 重置防御状态
 * 7. 最终结束检测
 * 8. 保存状态
 */
export class TurnBasedCombatStrategy extends CombatStrategyBase {
  readonly mode = 'turn_based_combat' as const;

  constructor(
    characterService: import('../../character/types.js').ICharacterService,
    inventoryService: import('../../inventory/types.js').IInventoryService,
    skillService: import('../../skill/types.js').ISkillService,
    numericalService: import('../../numerical/types.js').INumericalService,
    combatRepository: import('../types.js').ICombatRepository,
    historyRepository: import('../types.js').ICombatHistoryRepository,
    ruleParser: import('../../shared/rule-parser/TemplateRuleParser.js').TemplateRuleParser,
    eventBus: import('@ai-rpg/shared/messaging').EventBus,
    txManager: import('../../../database/TransactionManager.js').ITransactionManager,
    saveRepository: import('../../save/types.js').ISaveRepository,
  ) {
    super(
      characterService, inventoryService, skillService, numericalService,
      combatRepository, historyRepository, ruleParser, eventBus, txManager,
      saveRepository,
      'turn_based_combat',
    );
  }

  async executeStep(
    saveId: ID,
    state: ChallengeState,
    action: ChallengeAction,
    trx?: Knex.Transaction,
  ): Promise<ChallengeStepResult> {
    return this.runInTransaction(trx, async (t) => {
      // ChallengeState → CombatState（数值计算用）
      const combatState = challengeStateToCombatState(state);

      // 1. 玩家先攻击
      const playerResult = await this.processPlayerAction(combatState, action);
      const sideEffects: NonNullable<ChallengeStepResult['sideEffects']> = [];

      // 2. 检测结束（玩家行动后）
      const endCheck = this.checkEndInternal(combatState);
      if (endCheck.ended && endCheck.result) {
        await this.endChallenge(saveId, state, endCheck.result, t);
        return {
          actionResult: {
            success: true,
            description: playerResult.logMessage,
            actorId: action.actorId,
            killed: playerResult.killed,
            damage: playerResult.damage,
          },
          sideEffects,
          combatEnded: true,
          hint: `战斗结束: ${endCheck.result}`,
        };
      }

      // 3. 状态效果 tick（玩家行动后）
      this.tickStatusEffectsInternal(combatState);

      // 4. 敌人后攻（读取 state.enemyStrategy，缺失抛 EnemyStrategyMissingError）
      const enemyResults = await this.processEnemyTurn(saveId, combatState, state.enemyStrategy);
      for (const er of enemyResults) {
        if (er.damage) {
          sideEffects.push({
            type: 'hp_change',
            targetId: combatState.participants.find(p => p.name === er.targetName)?.id ?? ('' as ID),
            targetType: 'character',
            value: -er.damage,
          });
        }
      }

      // 5. 状态效果 tick（敌人行动后）
      this.tickStatusEffectsInternal(combatState);

      // 6. 推进回合 + 重置防御状态
      combatState.turn++;
      const aliveCount = combatState.participants.filter(p => p.currentHP > 0).length;
      if (combatState.turn > aliveCount) {
        combatState.round++;
        combatState.turn = 1;
      }
      combatState.lastActionAt = Date.now() as Timestamp;
      for (const p of combatState.participants) {
        p.isDefending = false;
      }

      // 7. 最终结束检测
      const finalEndCheck = this.checkEndInternal(combatState);
      if (finalEndCheck.ended && finalEndCheck.result) {
        await this.endChallenge(saveId, state, finalEndCheck.result, t);
        return {
          actionResult: {
            success: true,
            description: playerResult.logMessage,
            actorId: action.actorId,
            killed: playerResult.killed,
            damage: playerResult.damage,
          },
          sideEffects,
          combatEnded: true,
          hint: `战斗结束: ${finalEndCheck.result}`,
        };
      }

      // 8. 保存状态
      await this.combatRepository.upsert(saveId, combatState, undefined, t);

      return {
        actionResult: {
          success: true,
          description: playerResult.logMessage,
          actorId: action.actorId,
          killed: playerResult.killed,
          damage: playerResult.damage,
        },
        sideEffects,
        combatEnded: false,
        hint: `回合 ${combatState.turn}/${combatState.round} 结束`,
      };
    });
  }
}
