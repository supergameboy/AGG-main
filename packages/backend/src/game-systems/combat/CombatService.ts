/**
 * CombatService（code-design §5.1 重构后）
 *
 * 期望效果：
 * - 持有 IChallengeStrategy 实例，委托 startChallenge/executeStep/endChallenge 给策略
 * - 不直接处理战斗业务逻辑（数值计算/状态管理/事件发布迁移到策略实现）
 * - 保留 ICombatService 接口兼容（现有调用方 CombatServiceTool 不破坏）
 * - 新增 executeStepOnly 方法供 G2 路径调用
 *
 * 依赖约束（code-design §5.1）:
 * - 核心依赖：IChallengeStrategy + ICombatRepository + ITransactionManager
 * - 可选依赖：ruleParser（fleeAttempt 用）、inventoryService（useItemInCombat 用）
 * - 移除依赖：ICharacterService / ISkillService / INumericalService（迁移到策略实现）
 *
 * 类型迁移（code-design §2.3 并存 + 渐进统一）:
 * - 接口签名保留 CombatState/CombatAction 类型（向后兼容）
 * - 内部做 CombatAction → ChallengeAction 适配映射
 * - 策略返回 ChallengeState，CombatService 做 ChallengeState → CombatState 转换
 */

import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../../shared/src/types/core.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import { runInTransaction } from '../../database/transactionHelper.js';
import type { IInventoryService } from '../inventory/types.js';
import {
  combatStateToChallengeState,
  challengeStateToCombatState,
} from './types.js';
import type {
  ICombatRepository,
  ICombatService,
  ICombatModeStrategy,
  CombatParticipant,
  EnemyTemplate,
  CombatAction,
  CombatState,
  CombatResult,
  TurnResult,
  StatusEffect,
  DamageBreakdown,
  CombatLogEntry,
  ParticipantResult,
} from './types.js';
import {
  CombatStateNotFoundError,
  CombatNotActiveError,
  StrategyCheckEndError,
} from './types.js';
import type {
  ChallengeAction,
  ChallengeStepResult,
  ChallengeEndResult,
  ChallengeParticipant,
  ChallengeMode,
  ChallengeState,
  EnemyStrategy,
} from '@ai-rpg/shared';

// 重新导出类型（保持现有 import 来源兼容）
export {
  CombatParticipant,
  EnemyTemplate,
  CombatAction,
  CombatState,
  CombatResult,
  TurnResult,
  StatusEffect,
  DamageBreakdown,
  CombatLogEntry,
  ParticipantResult,
};

export class CombatService implements ICombatService {
  private readonly logger: ReturnType<typeof createChildLogger>;
  /**
   * 持有策略实例（ICombatModeStrategy 扩展 IChallengeStrategy，含 calculateDamage）
   *
   * 注：CombatService 仅服务于战斗领域，策略实例必然实现 ICombatModeStrategy。
   * IChallengeStrategy 用于通用挑战语义（含未来 puzzle/mini_game/stealth），
   * 但那些非战斗挑战由 Agent G 路径处理，不走 CombatService。
   */
  private readonly strategy: ICombatModeStrategy;
  private readonly combatRepo: ICombatRepository;
  private readonly txManager: ITransactionManager;
  /** fleeAttempt 专用（计算逃跑概率需要 ruleParser.getCombatRules().flee） */
  private readonly ruleParser?: TemplateRuleParser;
  /** useItemInCombat 专用（获取物品信息 + 消耗物品） */
  private readonly inventoryService?: IInventoryService;
  private combatStateCache: Map<ID, CombatState> = new Map();

  constructor(
    strategy: ICombatModeStrategy,
    combatRepo: ICombatRepository,
    txManager: ITransactionManager,
    ruleParser?: TemplateRuleParser,
    inventoryService?: IInventoryService,
  ) {
    this.strategy = strategy;
    this.combatRepo = combatRepo;
    this.txManager = txManager;
    this.ruleParser = ruleParser;
    this.inventoryService = inventoryService;
    this.logger = createChildLogger('service:combat');
  }

  /**
   * 事务执行辅助：统一处理外部事务复用与自建事务。
   */
  private runInTransaction<T>(
    externalTrx: Knex.Transaction | undefined,
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.txManager, externalTrx, work);
  }

  // ============================================================================
  // 核心流程方法（委托给策略，code-design §5.1）
  // ============================================================================

  /**
   * 开始战斗（委托 strategy.startChallenge）
   *
   * 类型适配：
   * - 入参：EnemyTemplate[] → ChallengeParticipant[]（补充 attack/defense/speed/level 等数值字段）
   * - 出参：ChallengeState → CombatState（metadata 存储扩展字段）
   *
   * 挑战模式由组合根按三层覆盖优先级决策后经策略构造注入（this.strategy.mode），
   * 本方法不再接收 combatType 参数（2026-07-25 模式选择链修复）。
   */
  async startCombat(saveId: ID, enemies: EnemyTemplate[], trx?: Knex.Transaction): Promise<CombatState> {
    return this.runInTransaction(trx, async (t) => {
      try {
        // EnemyTemplate → ChallengeParticipant（附带数值字段的 customData）
        const participants: ChallengeParticipant[] = enemies.map((e, idx) => {
          const raw = e as unknown as Record<string, unknown>;
          const currentHP = e.currentHP ?? raw.hp as number | undefined;
          const maxHP = e.maxHP ?? raw.maxHp as number | undefined;
          const hpFallback = (e.level || 1) * 50;

          return {
            id: (e.id || `enemy-${idx}`) as ID,
            name: e.name,
            type: 'enemy' as const,
            ownerType: 'npc' as const,
            ownerId: (e.id || `enemy-${idx}`) as ID,
            hp: currentHP || hpFallback,
            maxHp: maxHP || hpFallback,
            mp: 0,
            maxMp: 0,
            isDefending: false,
            statusEffects: [],
            customData: {
              attack: e.attack || (e.level || 1) * 10,
              defense: e.defense || (e.level || 1) * 5,
              speed: e.speed || (e.level || 1) * 2,
              level: e.level,
              skills: e.skills,
              expReward: e.expReward,
              goldReward: e.goldReward,
            },
          };
        });

        // 模式已由组合根经策略构造注入（this.strategy.mode），startChallenge 无需模式参数
        const challengeState = await this.strategy.startChallenge(
          saveId,
          participants,
          {},
          t,
        );

        // ChallengeState → CombatState（持久化 + 缓存）
        const combatState = challengeStateToCombatState(challengeState);
        await this.combatRepo.upsert(saveId, combatState, 'active', t);
        this.setCachedState(saveId, combatState);

        this.logger.info(`Combat started: ${enemies.length} enemies`, {
          saveId,
          mode: this.strategy.mode,
        });

        return combatState;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to start combat', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 执行回合（委托 strategy.executeStep + checkEnd + endChallenge）
   *
   * 类型适配：
   * - 入参：CombatAction → ChallengeAction（补充 actorId/targetIds）
   * - 流程：读取 state → executeStep → checkEnd → 若结束则 endChallenge
   *
   * 设计 §5.1 流程图:
   * 1. 读取 ChallengeState
   * 2. state 不存在 → 抛 CombatStateNotFoundError（DF-015）
   * 3. state.active=false → 抛 CombatNotActiveError
   * 4. 委托 strategy.executeStep
   * 5. 调用 strategy.checkEnd（类型守卫 ended && result）
   * 6. 若 ended=true && !result → 抛 StrategyCheckEndError（DF-022/DF-032）
   * 7. 若结束 → 委托 strategy.endChallenge + 返回空结果（战斗已结束）
   * 8. 若未结束 → 保存状态 + 返回 stepResult 中的 turnResults
   */
  async executeTurn(saveId: ID, action: CombatAction, trx?: Knex.Transaction): Promise<TurnResult[]> {
    return this.runInTransaction(trx, async (t) => {
      try {
        const { state } = await this.getCombatState(saveId);
        if (!state) {
          // DF-015 修复：禁止 fallback 掩盖缺陷，state 不存在即抛错
          throw new CombatStateNotFoundError(saveId);
        }
        if (!state.active) {
          throw new CombatNotActiveError(saveId);
        }

        // CombatState → ChallengeState + CombatAction → ChallengeAction
        const challengeState = combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
        const challengeAction = this.combatActionToChallengeAction(saveId, action);

        // 委托 strategy.executeStep
        const stepResult = await this.strategy.executeStep(saveId, challengeState, challengeAction, t);

        // 调用 strategy.checkEnd
        const endCheck = this.strategy.checkEnd(challengeState);
        if (endCheck.ended) {
          // 类型守卫：ended=true 时必须有 result（DF-022/DF-032 修复）
          if (!endCheck.result) {
            throw new StrategyCheckEndError(saveId, this.strategy.mode);
          }
          // 战斗结束 → 委托 strategy.endChallenge
          await this.strategy.endChallenge(saveId, challengeState, endCheck.result, t);
          this.clearCachedState(saveId);
          // 返回 stepResult 中的回合结果（已结束，无后续回合）
          return this.extractTurnResults(stepResult);
        }

        // 战斗未结束 → 保存状态
        const updatedCombatState = challengeStateToCombatState(challengeState);
        await this.saveCombatState(saveId, updatedCombatState, t);

        return this.extractTurnResults(stepResult);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to execute turn', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 执行步骤（G2 路径专用，code-design §5.1）
   *
   * 期望效果：
   * - 读取 ChallengeState → 委托 strategy.executeStep → 保存状态 → 返回 ChallengeStepResult
   * - 不调用 checkEnd（结束检测由 G2 通过 checkEnd 分离调用）
   * - 不调用 endChallenge（结束流程由 G2 通过 endCombat 分离调用）
   *
   * 错误场景:
   * - state 不存在 → CombatStateNotFoundError
   * - state.active=false → CombatNotActiveError
   */
  async executeStepOnly(saveId: ID, action: ChallengeAction, trx?: Knex.Transaction): Promise<ChallengeStepResult> {
    return this.runInTransaction(trx, async (t) => {
      try {
        const { state } = await this.getCombatState(saveId);
        if (!state) {
          throw new CombatStateNotFoundError(saveId);
        }
        if (!state.active) {
          throw new CombatNotActiveError(saveId);
        }

        const challengeState = combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
        const stepResult = await this.strategy.executeStep(saveId, challengeState, action, t);

        // 保存状态（executeStep 内部可能已通过 strategy 的 repo 持久化，这里确保缓存同步）
        const updatedCombatState = challengeStateToCombatState(challengeState);
        this.setCachedState(saveId, updatedCombatState);

        return stepResult;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to execute step (G2 path)', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  // ============================================================================
  // G2 路径专用方法（供 CombatServiceTool 实现 ICombatServiceTool，code-design §5.1/§5.2）
  // ============================================================================

  /**
   * 获取 ChallengeState（G2 路径专用，code-design §5.2 queryChallengeState）
   *
   * 期望效果：
   * - 读取 CombatState → 转换为 ChallengeState 返回
   * - 不存在 → 返回 null（G2 路径需自行处理"无进行中挑战"场景）
   * - 不抛错（query 语义）
   */
  async getChallengeState(saveId: ID): Promise<ChallengeState | null> {
    const { state } = await this.getCombatState(saveId);
    if (!state) return null;
    return combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
  }

  /**
   * 检查挑战结束（G2 路径专用，code-design §5.2 checkChallengeEnd）
   *
   * 期望效果：
   * - 委托 strategy.checkEnd，返回 ChallengeEndResult['result'] 类型（不含数值字段）
   * - ended=true && !result → 抛 StrategyCheckEndError（DF-032 修复）
   * - state 不存在 → 返回 { ended: false }（G2 路径需自行处理）
   *
   * 与 checkCombatEnd 的差异：
   * - checkCombatEnd 返回 CombatResult（含 experience/currency/drops 等数值字段，Agent 路径用）
   * - checkEnd 返回 ChallengeEndResult['result']（纯结果类型，G2 路径用，数值收集由 collectChallengeData 负责）
   */
  async checkEnd(saveId: ID): Promise<{ ended: boolean; result?: ChallengeEndResult['result'] }> {
    const { state } = await this.getCombatState(saveId);
    if (!state) return { ended: false };

    const challengeState = combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
    const endCheck = this.strategy.checkEnd(challengeState);

    if (!endCheck.ended) return { ended: false };
    if (!endCheck.result) {
      throw new StrategyCheckEndError(saveId, this.strategy.mode);
    }
    return { ended: true, result: endCheck.result };
  }

  /**
   * 结束挑战（G2 路径专用，code-design §5.2 collectChallengeData）
   *
   * 期望效果：
   * - 委托 strategy.endChallenge，返回 ChallengeEndResult（含 rewards）
   * - state 不存在 → 抛 CombatStateNotFoundError（G2 路径调用时必须存在进行中挑战）
   *
   * 与 endCombat 的差异：
   * - endCombat 入参是 CombatResult（含 victory/fled/defeat 布尔字段），返回 void
   * - endChallenge 入参是 ChallengeEndResult['result']（纯结果类型），返回 ChallengeEndResult
   */
  async endChallenge(
    saveId: ID,
    result: ChallengeEndResult['result'],
    trx?: Knex.Transaction,
  ): Promise<ChallengeEndResult> {
    return this.runInTransaction(trx, async (t) => {
      const { state } = await this.getCombatState(saveId);
      if (!state) {
        throw new CombatStateNotFoundError(saveId);
      }
      const challengeState = combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
      const endResult = await this.strategy.endChallenge(saveId, challengeState, result, t);
      this.clearCachedState(saveId);
      return endResult;
    });
  }

  /**
   * 更新敌人策略（G2/Agent 路径共用，code-design §5.2 generate_enemy_strategy）
   *
   * 期望效果：
   * - 读取 CombatState → 校验存在 + active + mode ∈ {turn_based_combat, dynamic_combat}
   * - 校验 state.enemyStrategy 不存在（禁止覆盖，一次性写入）
   * - 写入 enemyStrategy 到 CombatState 并持久化（经 StagingKnex 代理走 StagingPool）
   * - 返回写入后的 ChallengeState（供调用方确认）
   *
   * 错误场景:
   * - state 不存在 → CombatStateNotFoundError
   * - state.active=false → CombatNotActiveError
   * - mode 为 narrative_combat → 抛错"叙事战斗不支持敌人策略"
   * - state.enemyStrategy 已存在 → 抛错"敌人策略已生成，禁止重复设置"
   */
  async updateEnemyStrategy(
    saveId: ID,
    strategy: EnemyStrategy,
    trx?: Knex.Transaction,
  ): Promise<ChallengeState> {
    return this.runInTransaction(trx, async (t) => {
      const { state } = await this.getCombatState(saveId);
      if (!state) {
        throw new CombatStateNotFoundError(saveId);
      }
      if (!state.active) {
        throw new CombatNotActiveError(saveId);
      }

      const mode = this.strategy.mode as ChallengeMode;
      if (mode === 'narrative_combat') {
        throw new Error(`叙事战斗不支持敌人策略（saveId=${saveId}，GM 全权控制）`);
      }
      if (mode !== 'turn_based_combat' && mode !== 'dynamic_combat') {
        throw new Error(`挑战模式 ${mode} 不支持敌人策略（saveId=${saveId}）`);
      }
      if (state.enemyStrategy) {
        throw new Error(`敌人策略已生成，禁止重复设置（saveId=${saveId}）`);
      }

      // 写入 enemyStrategy 并持久化
      const updatedState: CombatState = { ...state, enemyStrategy: strategy };
      await this.saveCombatState(saveId, updatedState, t);

      this.logger.info('Enemy strategy set', { saveId, aggression: strategy.aggression });
      return combatStateToChallengeState(updatedState, mode);
    });
  }

  /**
   * 更新挑战状态 metadata（G2/Agent 路径共用，code-design §5.2 queue_action）
   *
   * 期望效果：
   * - 读取 CombatState → 合并 metadata → 持久化（经 StagingKnex 代理走 StagingPool）
   * - 仅合并 metadata 字段，不修改其他字段
   * - state 不存在 → 抛 CombatStateNotFoundError
   *
   * 应用场景:
   * - queue_action 工具方法写入 metadata.actionQueue（动态战斗模式）
   */
  async updateMetadata(
    saveId: ID,
    metadata: Record<string, unknown>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    return this.runInTransaction(trx, async (t) => {
      const { state } = await this.getCombatState(saveId);
      if (!state) {
        throw new CombatStateNotFoundError(saveId);
      }
      // CombatState.metadata 与 ChallengeState.metadata 对应
      // 合并传入的 metadata（浅合并，调用方负责字段级别合并）
      const updatedState: CombatState = {
        ...state,
        metadata: { ...(state.metadata ?? {}), ...metadata },
      };
      await this.saveCombatState(saveId, updatedState, t);

      this.logger.debug('Metadata updated', { saveId, metadataKeys: Object.keys(metadata) });
    });
  }

  /**
   * 结束战斗（委托 strategy.endChallenge）
   *
   * 类型适配：
   * - 入参：CombatResult → 'victory' | 'defeat' | 'flee' | 'draw'
   */
  async endCombat(saveId: ID, result: CombatResult, trx?: Knex.Transaction): Promise<void> {
    return this.runInTransaction(trx, async (t) => {
      try {
        const { state } = await this.getCombatState(saveId);
        if (!state) {
          this.logger.info('Combat already ended (auto-finalized)', { saveId });
          return;
        }

        const challengeState = combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
        const resultType: ChallengeEndResult['result'] = result.victory
          ? 'victory'
          : result.fled
            ? 'flee'
            : result.defeat
              ? 'defeat'
              : 'draw';

        await this.strategy.endChallenge(saveId, challengeState, resultType, t);
        this.clearCachedState(saveId);

        this.logger.info(`Combat ended: ${resultType}`, { saveId });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to end combat', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 检查战斗是否结束（委托 strategy.checkEnd）
   *
   * 类型适配：
   * - 出参：ChallengeEndResult['result'] → CombatResult（补充 experience/currency/drops 等字段）
   */
  async checkCombatEnd(saveId: ID): Promise<{ ended: boolean; result?: CombatResult }> {
    try {
      const { state } = await this.getCombatState(saveId);
      if (!state) return { ended: false };

      const challengeState = combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
      const endCheck = this.strategy.checkEnd(challengeState);

      if (!endCheck.ended) return { ended: false };

      // 类型守卫：ended=true 时必须有 result（DF-022 修复）
      if (!endCheck.result) {
        throw new StrategyCheckEndError(saveId, this.strategy.mode);
      }

      // ChallengeEndResult['result'] → CombatResult（补充数值字段）
      const combatResult = this.buildCombatResultFromState(state, endCheck.result);
      return { ended: true, result: combatResult };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check combat end', { saveId, error: errorMessage });
      throw error;
    }
  }

  // ============================================================================
  // 查询方法（仅依赖 combatRepo，不委托策略）
  // ============================================================================

  async getCombatState(saveId: ID): Promise<{ state: CombatState | null; hint?: string }> {
    try {
      const cached = this.getCachedState(saveId);
      if (cached) return { state: cached };

      const row = await this.combatRepo.findBySaveId(saveId);
      if (!row) return { state: null, hint: "当前无进行中的战斗. 建议：使用 start_combat 开始新战斗" };

      this.setCachedState(saveId, row.combatData);
      return { state: row.combatData };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get combat state', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getCombatLog(saveId: ID, limit?: number): Promise<{ log: CombatLogEntry[]; hint?: string }> {
    try {
      const { state } = await this.getCombatState(saveId);
      if (!state) return { log: [], hint: "当前无战斗日志. 建议：使用 start_combat 开始新战斗" };
      const logLimit = limit || 50;
      return { log: state.log.slice(-logLimit) };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get combat log', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getStatusEffects(saveId: ID): Promise<{ effects: Array<{ participantName: string; effects: StatusEffect[] }>; hint?: string }> {
    try {
      const { state } = await this.getCombatState(saveId);
      if (!state) return { effects: [], hint: "当前无战斗状态效果" };

      const effects = state.participants
        .filter(p => p.statusEffects.length > 0)
        .map(p => ({ participantName: p.name, effects: [...p.statusEffects] }));

      if (effects.length === 0) return { effects: [], hint: "当前无战斗状态效果" };
      return { effects };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get status effects', { saveId, error: errorMessage });
      throw error;
    }
  }

  // ============================================================================
  // 非核心动作方法（使用可选依赖 ruleParser / inventoryService）
  // ============================================================================

  /**
   * 逃跑尝试（需要 ruleParser 计算逃跑概率）
   *
   * 期望效果：
   * - 基于 ruleParser.getCombatRules().flee 计算逃跑概率
   * - 成功 → 委托 strategy.endChallenge(result='flee')
   * - 失败 → 保存状态 + 返回失败结果
   */
  async fleeAttempt(saveId: ID, trx?: Knex.Transaction): Promise<{ success: boolean; chance: number; message: string }> {
    return this.runInTransaction(trx, async (t) => {
      try {
        if (!this.ruleParser) {
          throw new Error('fleeAttempt 需要 ruleParser 依赖（CombatService 构造时未注入）');
        }

        const { state } = await this.getCombatState(saveId);
        if (!state) throw new CombatStateNotFoundError(saveId);
        if (!state.active) throw new CombatNotActiveError(saveId);

        const deadEnemies = state.participants.filter(p => !p.isPlayer && p.currentHP <= 0).length;
        const fleeBaseChance = this.ruleParser.getCombatRules().flee.base_chance;
        const fleeBonus = this.ruleParser.getCombatRules().flee.per_dead_enemy_bonus;
        const fleeChance = fleeBaseChance + (deadEnemies * fleeBonus);
        const success = Math.random() < fleeChance;

        if (success) {
          const challengeState = combatStateToChallengeState(state, this.strategy.mode as ChallengeMode);
          await this.strategy.endChallenge(saveId, challengeState, 'flee', t);
          this.clearCachedState(saveId);

          this.logger.info('Flee successful', { saveId, fleeChance });
          return { success: true, chance: parseFloat(fleeChance.toFixed(2)), message: 'Successfully fled from combat!' };
        }

        // 逃跑失败：记录日志 + 保存状态
        state.log.push({
          turn: state.turn,
          round: state.round,
          actor: 'player',
          action: 'flee',
          result: { success: false, fleeChance },
          timestamp: Date.now() as Timestamp,
        });
        await this.saveCombatState(saveId, state, t);

        this.logger.info('Flee failed', { saveId, fleeChance });
        return { success: false, chance: parseFloat(fleeChance.toFixed(2)), message: 'Failed to flee!' };
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to attempt flee', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 防御动作（仅修改 state，不委托策略）
   *
   * 期望效果：
   * - 设置 player.isDefending = true
   * - 保存状态 + 返回 TurnResult
   */
  async defend(saveId: ID, trx?: Knex.Transaction): Promise<TurnResult> {
    return this.runInTransaction(trx, async (t) => {
      try {
        const { state } = await this.getCombatState(saveId);
        if (!state) throw new CombatStateNotFoundError(saveId);
        if (!state.active) throw new CombatNotActiveError(saveId);

        const player = state.participants.find(p => p.isPlayer);
        if (!player) throw new Error('Player not found in combat');

        player.isDefending = true;

        const result: TurnResult = {
          actorName: player.name,
          actionType: 'defend',
          effect: 'defense_boosted',
          logMessage: `${player.name} takes a defensive stance`,
        };

        state.log.push({
          turn: state.turn,
          round: state.round,
          actor: player.name,
          action: 'defend',
          target: undefined,
          result: { actionType: 'defend', effect: 'defense_boosted' },
          timestamp: Date.now() as Timestamp,
        });

        await this.saveCombatState(saveId, state, t);
        return result;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to defend', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 战斗中使用物品（需要 inventoryService 获取物品信息 + 消耗物品）
   *
   * 期望效果：
   * - 读取物品信息（inventoryService.getItemForCombat）
   * - 应用 HP/MP 恢复效果
   * - 消耗物品（inventoryService.consumeItem）
   * - 保存状态 + 返回 TurnResult
   */
  async useItemInCombat(saveId: ID, itemId: ID, trx?: Knex.Transaction): Promise<TurnResult> {
    return this.runInTransaction(trx, async (t) => {
      try {
        if (!this.inventoryService) {
          throw new Error('useItemInCombat 需要 inventoryService 依赖（CombatService 构造时未注入）');
        }

        const { state } = await this.getCombatState(saveId);
        if (!state) throw new CombatStateNotFoundError(saveId);
        if (!state.active) throw new CombatNotActiveError(saveId);

        const item = await this.inventoryService.getItemForCombat(saveId, itemId, t);
        if (!item) throw new Error(`Item not found: ${itemId}`);

        const player = state.participants.find(p => p.isPlayer);
        if (!player) throw new Error('Player not found in combat');

        let effect = '';
        let healed = 0;

        if (item.manaAmount > 0 && item.healAmount === 0) {
          const manaRestored = Math.min(item.manaAmount, player.maxMP - player.currentMP);
          player.currentMP += manaRestored;
          effect = `restored ${manaRestored} MP`;
        } else if (item.healAmount > 0 || item.category === 'consumable') {
          const healAmount = item.healAmount || (this.ruleParser?.getCombatRules().defaults.potion_heal ?? 50);
          healed = Math.min(healAmount, player.maxHP - player.currentHP);
          player.currentHP += healed;
          effect = `healed ${healed} HP`;
        } else {
          throw new Error(`Cannot use item type '${item.category}' in combat`);
        }

        await this.inventoryService.consumeItem(saveId, itemId, 1, t);

        const result: TurnResult = {
          actorName: player.name,
          actionType: 'item',
          effect,
          healed: healed || undefined,
          logMessage: `${player.name} used ${item.name || itemId}, ${effect}`,
        };

        state.log.push({
          turn: state.turn,
          round: state.round,
          actor: player.name,
          action: 'item',
          target: undefined,
          result: { actionType: 'item', effect, healed },
          timestamp: Date.now() as Timestamp,
        });

        await this.saveCombatState(saveId, state, t);
        return result;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to use item in combat', { saveId, itemId, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 伤害计算（委托 strategy.calculateDamage）
   *
   * 期望效果：
   * - 委托给策略的 calculateDamage 方法（策略持有 ruleParser + numericalService）
   * - 叙事模式策略不实现此方法 → 抛错提示
   */
  calculateDamage(
    attacker: CombatParticipant,
    defender: CombatParticipant,
    skill?: { baseDamage?: number; multiplier?: number; element?: string },
  ): DamageBreakdown {
    if (!this.strategy.calculateDamage) {
      throw new Error(`策略 ${this.strategy.mode} 不支持 calculateDamage（叙事模式由 GM 全权控制伤害）`);
    }
    return this.strategy.calculateDamage(attacker, defender, skill);
  }

  // ============================================================================
  // 类型适配辅助方法（CombatAction ↔ ChallengeAction / CombatResult 构建）
  // ============================================================================

  /**
   * CombatAction → ChallengeAction 适配
   *
   * 期望效果：
   * - type 直接映射
   * - targetId → targetIds[]（数组化）
   * - skillId / itemId 直接映射
   * - actorId 从 state.participants 中查找玩家 ID
   */
  private combatActionToChallengeAction(saveId: ID, action: CombatAction): ChallengeAction {
    // 查找玩家 ID 作为 actorId
    const cachedState = this.getCachedState(saveId);
    const player = cachedState?.participants.find(p => p.isPlayer);
    const actorId = (player?.id ?? saveId) as ID;

    const targetIds: (ID | string)[] = [];
    if (action.targetId) targetIds.push(action.targetId);

    return {
      type: action.type,
      actorId,
      targetIds: targetIds.length > 0 ? targetIds : undefined,
      skillId: action.skillId,
      itemId: action.itemId,
    };
  }

  /**
   * 从 ChallengeStepResult 提取 TurnResult[]（向后兼容 ICombatService.executeTurn 返回类型）
   *
   * 期望效果：
   * - stepResult.actionResult → TurnResult（含 actorName/actionType/damage/description）
   * - stepResult.sideEffects 中的 hp_change → 额外 TurnResult（敌人造成的伤害）
   */
  private extractTurnResults(stepResult: ChallengeStepResult): TurnResult[] {
    const results: TurnResult[] = [];

    // 主行动结果
    const action = stepResult.actionResult;
    results.push({
      actorName: String(action.actorId ?? 'unknown'),
      actionType: action.description?.includes('attacks') ? 'attack'
        : action.description?.includes('uses') ? 'skill'
        : action.description?.includes('defensive') ? 'defend'
        : 'action',
      targetName: action.targetId ? String(action.targetId) : undefined,
      damage: action.damage,
      killed: (action as unknown as Record<string, unknown>).killed as boolean | undefined,
      logMessage: action.description,
    });

    // sideEffects 中的敌人伤害（value 类型为 number | string，hp_change 语义下应为 number）
    if (stepResult.sideEffects) {
      for (const effect of stepResult.sideEffects) {
        const hpDelta = typeof effect.value === 'number' ? effect.value : Number(effect.value);
        if (effect.type === 'hp_change' && hpDelta < 0) {
          results.push({
            actorName: 'enemy',
            actionType: 'attack',
            targetName: String(effect.targetId),
            damage: Math.abs(hpDelta),
            logMessage: `Enemy deals ${Math.abs(hpDelta)} damage to ${effect.targetId}`,
          });
        }
      }
    }

    return results;
  }

  /**
   * 从 CombatState 构建 CombatResult（checkCombatEnd 返回类型适配）
   */
  private buildCombatResultFromState(state: CombatState, result: ChallengeEndResult['result']): CombatResult {
    const totalExp = state.participants
      .filter(p => !p.isPlayer)
      .reduce((sum, e) => sum + (e.expReward ?? 0), 0);
    const totalGold = state.participants
      .filter(p => !p.isPlayer)
      .reduce((sum, e) => sum + (e.goldReward ?? 0), 0);

    const participantResults: ParticipantResult[] = state.participants.map(p => ({
      id: p.id,
      name: p.name,
      isPlayer: p.isPlayer,
      finalHP: p.currentHP,
      finalMP: p.currentMP,
      survived: p.currentHP > 0,
      damageDealt: 0,
      damageTaken: 0,
    }));

    return {
      victory: result === 'victory',
      fled: result === 'flee',
      defeat: result === 'defeat',
      experience: result === 'victory' ? totalExp : 0,
      currency: result === 'victory' ? { gold: totalGold } : {},
      drops: [],
      turnsElapsed: state.turn + ((state.round - 1) * state.participants.length),
      participantResults,
    };
  }

  // ============================================================================
  // 缓存辅助方法
  // ============================================================================

  private async saveCombatState(saveId: ID, state: CombatState, trx?: Knex.Transaction): Promise<void> {
    await this.combatRepo.upsert(saveId, state, undefined, trx);
    this.setCachedState(saveId, state);
  }

  private getCachedState(saveId: ID): CombatState | null {
    return this.combatStateCache.get(saveId) ?? null;
  }

  private setCachedState(saveId: ID, state: CombatState): void {
    this.combatStateCache.set(saveId, state);
  }

  private clearCachedState(saveId: ID): void {
    this.combatStateCache.delete(saveId);
  }
}
