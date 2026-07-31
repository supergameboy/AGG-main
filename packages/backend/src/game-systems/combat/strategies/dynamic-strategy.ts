/**
 * 动态战斗策略（code-design §4.3）
 *
 * 期望效果：
 * - 玩家和敌人同时攻击
 * - 同时计算双方伤害，同时应用
 * - 调用 CharacterService/InventoryService/SkillService/NumericalService
 * - 写 combat_states + combat_history
 * - emit combat_end 事件
 *
 * 敌人策略数据源（满足用户"战斗开始时 Combat Agent 输出敌人策略"需求）:
 * - executeStep 内的"敌人同时攻击"部分从 state.enemyStrategy 读取敌人策略
 * - 基于 state.enemyStrategy.aggression / skillPriority / targetPreference / fleeThreshold 执行敌人决策
 * - 若 state.enemyStrategy 缺失，抛 EnemyStrategyMissingError，禁止静默 fallback
 *
 * 与 TurnBasedCombatStrategy 的差异（executeStep 内同时攻击语义）:
 * - 回合制：玩家先攻击 → 检测结束 → 状态效果 → 敌人后攻 → 检测结束（先后顺序）
 * - 动态：同时计算玩家伤害（基于 action）+ 敌人伤害（基于 enemyStrategy），同时应用双方伤害（不分先后）
 *
 * 实现说明：
 * - 继承 CombatStrategyBase 复用 startChallenge/endChallenge/checkEnd/processPlayerAction/processEnemyTurn/tickStatusEffects 等通用方法
 * - 仅实现 executeStep 定义动态流程：同时计算双方伤害 → 同时应用 → 状态效果 → 检测结束 → 保存
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
 * 动态战斗策略
 *
 * 回合编排（executeStep 差异化，与 TurnBasedCombatStrategy 的差异）:
 * 1. 同时计算玩家伤害（processPlayerAction）+ 敌人伤害（processEnemyTurn）
 * 2. 同时应用双方伤害（玩家伤害已应用，敌人伤害已应用）
 * 3. 状态效果 tick（双方行动后）
 * 4. 推进回合 + 重置防御状态
 * 5. 最终结束检测
 * 6. 保存状态
 *
 * 与回合制的差异：
 * - 不在玩家行动后检测结束（双方同时行动，结束后统一检测）
 * - 状态效果 tick 在双方行动后统一应用一次
 */
export class DynamicCombatStrategy extends CombatStrategyBase {
  readonly mode = 'dynamic_combat' as const;

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
      'dynamic_combat',
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

      // 1. 同时计算玩家伤害 + 敌人伤害（不分先后顺序）
      //    - processPlayerAction 修改敌人 HP（玩家伤害应用）
      //    - processEnemyTurn 修改玩家 HP（敌人伤害应用）
      //    - 两者在 CombatState 上独立修改不同参与者，无写入冲突
      //    - enemyStrategy 缺失时 processEnemyTurn 抛 EnemyStrategyMissingError
      const [playerResult, enemyResults] = await Promise.all([
        this.processPlayerAction(combatState, action),
        this.processEnemyTurn(saveId, combatState, state.enemyStrategy),
      ]);

      // 收集副作用（玩家受到的敌人伤害）
      const sideEffects: NonNullable<ChallengeStepResult['sideEffects']> = [];
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

      // 2. 状态效果 tick（双方行动后统一应用一次）
      this.tickStatusEffectsInternal(combatState);

      // 3. 推进回合 + 重置防御状态
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

      // 4. 最终结束检测（双方行动后统一检测）
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

      // 5. 保存状态
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
