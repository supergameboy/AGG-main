/**
 * 战斗策略抽象基类（code-design §4.1 + §4.3 共性提取）
 *
 * 期望效果：
 * - 提取回合制 / 动态两种战斗模式共用的数值计算 / 状态管理 / 事件发布逻辑
 * - 子类只重写 executeStep 实现差异化的回合编排（先玩家后敌人 / 同时攻击）
 * - 叙事模式不继承此基类（无跨域依赖、无副作用）
 *
 * 适配映射（阶段二并存策略，code-design §2.3）:
 * - 接口签名使用 ChallengeState 类型（满足 IChallengeStrategy 契约）
 * - 内部状态使用 CombatState 类型（复用现有数值计算逻辑 + 兼容现有 Repository）
 * - 入口/出口通过 challengeStateToCombatState / combatStateToChallengeState 适配
 *
 * 敌人策略数据源（满足用户"战斗开始时 Combat Agent 输出敌人策略"需求）:
 * - processEnemyTurn 从 state.enemyStrategy 读取敌人策略（一次性，战斗开始时由 combat_director Agent 生成）
 * - 基于 state.enemyStrategy.aggression / skillPriority / targetPreference / fleeThreshold 执行敌人回合决策
 * - 若 state.enemyStrategy 缺失，抛 EnemyStrategyMissingError 暴露问题，禁止静默 fallback
 */

import { createChildLogger } from '../../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp, generateReadableId } from '../../../../../shared/src/types/core.js';
import { TemplateRuleParser } from '../../shared/rule-parser/TemplateRuleParser.js';
import type { EventBus, CombatEndData } from '@ai-rpg/shared/messaging';
import type { ITransactionManager } from '../../../database/TransactionManager.js';
import { runInTransaction } from '../../../database/transactionHelper.js';
import type { INumericalService } from '../../numerical/types.js';
import type { ICharacterService } from '../../character/types.js';
import type { IInventoryService } from '../../inventory/types.js';
import type { ISkillService } from '../../skill/types.js';
import type { ISaveRepository } from '../../save/types.js';
import type {
  ICombatRepository,
  ICombatHistoryRepository,
  CombatParticipant,
  EnemyTemplate,
  CombatState,
  CombatResult,
  TurnResult,
  StatusEffect,
  DamageBreakdown,
  CombatLogEntry,
  ParticipantResult,
  CombatHistoryInsertInput,
  ICombatModeStrategy,
  ChallengeOptions,
} from '../types.js';
import {
  combatStateToChallengeState,
  challengeStateToCombatState,
  challengeParticipantToCombatParticipant,
} from '../types.js';
import type {
  ChallengeState,
  ChallengeAction,
  ChallengeStepResult,
  ChallengeEndResult,
  ChallengeParticipant,
  EnemyStrategy,
} from '@ai-rpg/shared';
import { EnemyStrategyMissingError } from '../types.js';

/**
 * 战斗策略抽象基类
 *
 * 实现说明：
 * - 提供共用方法（startChallenge / endChallenge / checkEnd / processPlayerAction / processEnemyTurn / tickStatusEffects）
 * - 子类重写 executeStep 实现差异化回合编排
 * - 内部使用 CombatState 类型（复用现有数值计算逻辑）
 * - 接口签名使用 ChallengeState 类型（满足 IChallengeStrategy 契约）
 */
export abstract class CombatStrategyBase implements ICombatModeStrategy {
  abstract readonly mode: 'turn_based_combat' | 'dynamic_combat';

  protected readonly logger: ReturnType<typeof createChildLogger>;

  constructor(
    protected readonly characterService: ICharacterService,
    protected readonly inventoryService: IInventoryService,
    protected readonly skillService: ISkillService,
    protected readonly numericalService: INumericalService,
    protected readonly combatRepository: ICombatRepository,
    protected readonly historyRepository: ICombatHistoryRepository,
    protected readonly ruleParser: TemplateRuleParser,
    protected readonly eventBus: EventBus,
    protected readonly txManager: ITransactionManager,
    /**
     * Save 表 Repository（端口接口注入，D3 禁止跨领域表直接访问）
     * - 用于 endChallenge 时重置 saves.active_challenge_mode 为 null
     * - 与 select_challenge_mode 工具的写入对称（战斗结束必须清除残留模式）
     */
    protected readonly saveRepository: ISaveRepository,
    /** 子类传入的 mode 标签（用于 logger 命名），避免构造函数内访问 abstract property */
    modeLabel: 'turn_based_combat' | 'dynamic_combat',
  ) {
    this.logger = createChildLogger(`strategy:${modeLabel}`);
  }

  // ============================================================================
  // IChallengeStrategy 接口实现（子类共享）
  // ============================================================================

  async startChallenge(
    saveId: ID,
    participants: ChallengeParticipant[],
    _options: ChallengeOptions,
    trx?: Knex.Transaction,
  ): Promise<ChallengeState> {
    return this.runInTransaction(trx, async (t) => {
      try {
        if (participants.length === 0) {
          throw new Error(`${this.mode} 战斗开始失败: saveId=${saveId} 参与者列表为空`);
        }

        // 玩家参与者由策略构建（策略持有 ICharacterService，code-design §5.1 依赖迁移）
        // 缺失时 checkEndInternal 会因 alivePlayers=0 立即误判 defeat，必须在此注入
        const playerCombatant = await this.buildPlayerParticipant(saveId, t);

        // ChallengeParticipant → CombatParticipant（补充 attack/defense/speed/level 等数值字段）
        const enemyCombatants = participants.map(p => {
          const cp = challengeParticipantToCombatParticipant(p);
          const customData = (p as ChallengeParticipant & { customData?: Record<string, unknown> }).customData;
          if (customData) {
            cp.attack = (customData.attack as number) ?? cp.attack;
            cp.defense = (customData.defense as number) ?? cp.defense;
            cp.speed = (customData.speed as number) ?? cp.speed;
            cp.level = (customData.level as number) ?? cp.level;
            cp.element = (customData.element as string) ?? cp.element;
            cp.skills = (customData.skills as CombatParticipant['skills']) ?? cp.skills;
            cp.expReward = (customData.expReward as number) ?? cp.expReward;
            cp.goldReward = (customData.goldReward as number) ?? cp.goldReward;
          }
          return cp;
        });

        const combatParticipants = [playerCombatant, ...enemyCombatants];
        const sortedBySpeed = this.sortByInitiative([...combatParticipants]);
        const currentActorIndex = sortedBySpeed.findIndex(p => p.isPlayer);

        const now = Date.now() as Timestamp;
        const combatId = generateReadableId('combat', String(saveId).substring(0, 8)) as ID;

        const combatState: CombatState = {
          combatId,
          saveId,
          active: true,
          turn: 1,
          round: 1,
          currentActorIndex: Math.max(0, currentActorIndex),
          participants: combatParticipants,
          log: [{
            turn: 1,
            round: 1,
            actor: 'system',
            action: 'combat_started',
            result: {
              participantCount: combatParticipants.length,
              combatType: this.mode,
            },
            timestamp: now,
          }],
          startedAt: now,
          lastActionAt: now,
          combatType: this.mode,
        };

        await this.combatRepository.upsert(saveId, combatState, 'active', t);

        this.logger.info(`${this.mode} combat started: ${combatParticipants.length} participants`, {
          saveId,
          combatId,
        });

        return combatStateToChallengeState(combatState, this.mode);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error(`Failed to start ${this.mode} combat`, { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  /**
   * 执行回合（子类必须实现）
   *
   * 差异点：
   * - TurnBasedCombatStrategy: 玩家先攻击 → 检测结束 → 状态效果 → 敌人攻击 → 检测结束
   * - DynamicCombatStrategy: 同时计算玩家和敌人伤害，不分先后顺序
   */
  abstract executeStep(
    saveId: ID,
    state: ChallengeState,
    action: ChallengeAction,
    trx?: Knex.Transaction,
  ): Promise<ChallengeStepResult>;

  async endChallenge(
    saveId: ID,
    state: ChallengeState,
    result: ChallengeEndResult['result'],
    trx?: Knex.Transaction,
  ): Promise<ChallengeEndResult> {
    return this.runInTransaction(trx, async (t) => {
      try {
        const combatState = challengeStateToCombatState(state);
        const player = combatState.participants.find(p => p.isPlayer);
        const defeatedEnemies = result === 'victory'
          ? combatState.participants.filter(p => !p.isPlayer)
          : [];

        // 事务外发布 kill 事件（与 EventService 模式一致）
        if (result === 'victory') {
          for (const enemy of defeatedEnemies) {
            this.eventBus.emit('kill', { type: 'kill', saveId, data: { npcId: enemy.id, npcName: enemy.name }, timestamp: Date.now() });
          }
        }

        // 1. 更新角色 HP/MP
        if (player) {
          await this.characterService.setVitals(saveId, player.currentHP, player.currentMP, t);
        }

        // 2. 战斗胜利：发放经验和货币
        const combatResult = this.buildCombatResult(combatState, result);
        if (result === 'victory') {
          await this.characterService.grantExperience(saveId, combatResult.experience, t);
          await this.characterService.mergeCurrency(saveId, combatResult.currency, t);
        }

        // 3. 战斗失败且开启 permadeath
        if (result === 'defeat' && this.ruleParser.getSpecialRules().permadeath) {
          await this.characterService.setPermadeath(saveId, t);
        }

        // 4. 写入战斗历史
        const historyRecord: CombatHistoryInsertInput = {
          id: generateReadableId('cblog', String(saveId).substring(0, 8)) as ID,
          saveId,
          resultData: combatResult,
          createdAt: Date.now(),
        };
        await this.historyRepository.insert(historyRecord, t);

        // 5. 删除战斗状态
        await this.combatRepository.deleteBySaveId(saveId, t);

        // 5.1 重置 saves.active_challenge_mode（与 select_challenge_mode 写入对称）
        // 战斗结束后必须清除残留模式，避免下一次战斗触发时 resolveChallengeMode 误读为"GM 覆盖"
        await this.saveRepository.updateFields(saveId, { active_challenge_mode: null }, t);

        // 6. emit combat_end 事件
        const participants = combatState.participants.map(p => ({
          type: p.isPlayer ? 'character' as const : 'npc' as const,
          id: String(p.id),
          name: p.name,
        }));
        const combatEndData: CombatEndData = {
          saveId: String(saveId),
          combatId: String(combatState.combatId),
          result,
          participants,
          duration: Date.now() - combatState.startedAt,
        };
        this.eventBus.emit('combat_end', {
          type: 'combat_end',
          saveId: String(saveId),
          data: { ...combatEndData },
          timestamp: Date.now(),
        });

        this.logger.info(`${this.mode} combat ended: ${result}`, { saveId });

        return {
          result,
          participants: combatState.participants.map(p =>
            combatStateToChallengeState({ ...combatState, participants: [p] }, this.mode).participants[0]
          ),
          rewards: {
            experience: combatResult.experience,
            currency: combatResult.currency,
          },
        };
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to end challenge', { saveId, error: errorMessage });
        throw error;
      }
    });
  }

  checkEnd(state: ChallengeState): { ended: boolean; result?: ChallengeEndResult['result'] } {
    const combatState = challengeStateToCombatState(state);
    return this.checkEndInternal(combatState);
  }

  // ============================================================================
  // 策略内部辅助方法（子类共享，protected，不在端口接口暴露）
  // ============================================================================

  /**
   * 处理玩家行动
   *
   * 期望效果：
   * - 处理 attack/skill/defend
   * - 调用数值计算（calculateDamage）
   * - 修改敌人 HP
   *
   * 注：item/flee 由 CombatService 专用方法处理（useItemInCombat/fleeAttempt），
   * 不在策略的 processPlayerAction 内实现（保持策略聚焦于战斗数值计算）
   */
  protected async processPlayerAction(
    state: CombatState,
    action: ChallengeAction,
  ): Promise<TurnResult> {
    const player = state.participants.find(p => p.isPlayer);
    if (!player) throw new Error('Player not found in combat');

    switch (action.type) {
      case 'attack': {
        const targets = state.participants.filter(p => !p.isPlayer && p.currentHP > 0);
        if (targets.length === 0) throw new Error('No valid targets');
        const target = this.resolveTarget(targets, action.targetIds);
        const breakdown = this.calculateDamage(player, target);
        const killed = this.applyDamage(target, breakdown.finalDamage);

        const result: TurnResult = {
          actorName: player.name,
          actionType: 'attack',
          targetName: target.name,
          damage: breakdown.finalDamage,
          isCritical: breakdown.isCritical,
          killed,
          logMessage: `${player.name} attacks ${target.name}, dealing ${breakdown.finalDamage} damage${breakdown.isCritical ? ' (CRITICAL!)' : ''}${killed ? ` - ${target.name} defeated!` : ''}`,
        };
        this.addLogEntry(state, player.name, 'attack', target.name, result, breakdown);
        return result;
      }

      case 'skill': {
        const skillManaCost = this.ruleParser.getCombatRules().defaults.skill_cost_default;
        if (player.currentMP < skillManaCost) throw new Error('Not enough mana');

        const targets = state.participants.filter(p => !p.isPlayer && p.currentHP > 0);
        if (targets.length === 0) throw new Error('No valid targets');
        const target = this.resolveTarget(targets, action.targetIds);

        // 优先使用 SkillService 计算技能伤害，回退到全局乘数
        let skillBaseDamage: number;
        let skillElement: string | undefined;
        const skillMult = this.ruleParser.getCombatRules().defaults.skill_damage_multiplier;
        if (this.skillService && action.skillId) {
          try {
            const skillIdStr = String(action.skillId);
            const skillDmg = await this.skillService.calculateSkillDamage(state.saveId, skillIdStr);
            skillBaseDamage = skillDmg.total > 0 ? skillDmg.total : player.attack;
            const skillInfo = await this.skillService.getSkill(state.saveId, skillIdStr);
            skillElement = skillInfo?.element;
          } catch {
            this.logger.warn('Failed to calculate skill damage via SkillService, falling back to global multiplier');
            const skillBaseFactor = this.ruleParser.getCombatRules().defaults.skill_base_damage_factor;
            skillBaseDamage = player.attack * skillBaseFactor;
          }
        } else {
          const skillBaseFactor = this.ruleParser.getCombatRules().defaults.skill_base_damage_factor;
          skillBaseDamage = player.attack * skillBaseFactor;
        }

        const breakdown = this.calculateDamage(player, target, { baseDamage: skillBaseDamage, multiplier: skillMult, element: skillElement });
        const killed = this.applyDamage(target, breakdown.finalDamage);
        player.currentMP = Math.max(0, player.currentMP - skillManaCost);

        const skillName = action.skillId ? String(action.skillId) : 'skill';
        const result: TurnResult = {
          actorName: player.name,
          actionType: 'skill',
          targetName: target.name,
          damage: breakdown.finalDamage,
          effect: skillName,
          isCritical: breakdown.isCritical,
          killed,
          logMessage: `${player.name} uses ${skillName} on ${target.name}, dealing ${breakdown.finalDamage} damage${breakdown.isCritical ? ' (CRITICAL!)' : ''}${killed ? ` - ${target.name} defeated!` : ''}`,
        };
        this.addLogEntry(state, player.name, 'skill', target.name, result, breakdown);
        return result;
      }

      case 'defend': {
        player.isDefending = true;
        const result: TurnResult = {
          actorName: player.name,
          actionType: 'defend',
          effect: 'defense_boosted',
          logMessage: `${player.name} takes a defensive stance`,
        };
        this.addLogEntry(state, player.name, 'defend', undefined, result, {});
        return result;
      }

      default:
        throw new Error(`Unsupported player action type: ${action.type}`);
    }
  }

  /**
   * 处理敌人回合（读取 state.enemyStrategy）
   *
   * 期望效果：
   * - 读取 state.enemyStrategy，基于 aggression/skillPriority/targetPreference/fleeThreshold 执行敌人决策
   * - 输出回合结果列表（每个敌人一个）
   * - 副作用：修改玩家 HP
   * - 错误：state.enemyStrategy 缺失时抛 EnemyStrategyMissingError（禁止静默 fallback）
   */
  protected async processEnemyTurn(
    saveId: ID,
    state: CombatState,
    enemyStrategy: EnemyStrategy | undefined,
  ): Promise<TurnResult[]> {
    if (!enemyStrategy) {
      throw new EnemyStrategyMissingError(saveId, this.mode);
    }

    const results: TurnResult[] = [];
    const aliveEnemies = state.participants.filter(p => !p.isPlayer && p.currentHP > 0);
    const alivePlayers = state.participants.filter(p => p.isPlayer && p.currentHP > 0);

    if (alivePlayers.length === 0 || aliveEnemies.length === 0) return results;

    const target = this.selectTargetByStrategy(alivePlayers, enemyStrategy);

    for (const enemy of aliveEnemies) {
      // 检查逃跑阈值
      if (enemyStrategy.fleeThreshold && enemyStrategy.fleeThreshold > 0) {
        const hpPercent = (enemy.currentHP / enemy.maxHP) * 100;
        if (hpPercent < enemyStrategy.fleeThreshold) {
          const result: TurnResult = {
            actorName: enemy.name,
            actionType: 'flee',
            logMessage: `${enemy.name} attempts to flee (HP < ${enemyStrategy.fleeThreshold}%)`,
          };
          results.push(result);
          this.addLogEntry(state, enemy.name, 'flee', undefined, result, {});
          continue;
        }
      }

      // 根据 aggression 决定使用技能还是普通攻击
      const enemySkills = enemy.skills || [];
      const skillUseChance = this.getSkillUseChanceByAggression(enemyStrategy.aggression);
      const useSkill = enemySkills.length > 0 && Math.random() < skillUseChance;

      if (useSkill && enemy.currentMP >= (enemySkills[0]?.manaCost || 0)) {
        // 优先使用 skillPriority 中的技能
        const chosenSkill = this.selectSkillByPriority(enemySkills, enemyStrategy.skillPriority);
        const breakdown = this.calculateDamage(enemy, target, {
          baseDamage: chosenSkill.baseDamage,
          multiplier: chosenSkill.multiplier,
          element: chosenSkill.element,
        });
        const killed = this.applyDamage(target, breakdown.finalDamage);
        enemy.currentMP -= chosenSkill.manaCost || 0;

        const result: TurnResult = {
          actorName: enemy.name,
          actionType: 'skill',
          targetName: target.name,
          damage: breakdown.finalDamage,
          effect: chosenSkill.type || chosenSkill.name,
          isCritical: breakdown.isCritical,
          killed,
          logMessage: `${enemy.name} uses ${chosenSkill.name} on ${target.name}, dealing ${breakdown.finalDamage} damage${breakdown.isCritical ? ' (CRITICAL!)' : ''}${killed ? ` - ${target.name} defeated!` : ''}`,
        };
        results.push(result);
        this.addLogEntry(state, enemy.name, 'skill', target.name, result, breakdown);
      } else {
        const breakdown = this.calculateDamage(enemy, target);
        const killed = this.applyDamage(target, breakdown.finalDamage);

        const result: TurnResult = {
          actorName: enemy.name,
          actionType: 'attack',
          targetName: target.name,
          damage: breakdown.finalDamage,
          isCritical: breakdown.isCritical,
          killed,
          logMessage: `${enemy.name} attacks ${target.name}, dealing ${breakdown.finalDamage} damage${breakdown.isCritical ? ' (CRITICAL!)' : ''}${killed ? ` - ${target.name} defeated!` : ''}`,
        };
        results.push(result);
        this.addLogEntry(state, enemy.name, 'attack', target.name, result, breakdown);
      }

      if (target.currentHP <= 0) break;
    }

    return results;
  }

  /**
   * 状态效果 Tick
   *
   * 期望效果：
   * - 应用 buff/debuff/dot/hot
   * - 修改参与者 HP/MP
   */
  protected async tickStatusEffects(state: ChallengeState, _trx?: Knex.Transaction): Promise<void> {
    const combatState = challengeStateToCombatState(state);
    this.tickStatusEffectsInternal(combatState);
    // 将 CombatState 的状态变化同步回 ChallengeState（HP/MP/状态效果）
    const updated = combatStateToChallengeState(combatState, this.mode, state.enemyStrategy);
    state.participants = updated.participants;
    state.metadata = updated.metadata;
  }

  // ============================================================================
  // protected 辅助方法（子类可用）
  // ============================================================================

  protected runInTransaction<T>(
    externalTrx: Knex.Transaction | undefined,
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return runInTransaction(this.txManager, externalTrx, work);
  }

  /**
   * 构建玩家战斗参与者（startChallenge 专用）
   *
   * 期望效果：
   * - 读取角色战斗信息（ICharacterService.getCharacterCombatInfo）
   * - attack/defense/speed 优先取派生属性，缺失时按属性角色映射回退到基础属性，最终 attribute_fallback 兜底
   * - isPlayer=true（checkEndInternal / processPlayerAction / processEnemyTurn 依赖此标记识别玩家）
   *
   * 错误场景：
   * - 角色不存在 → 抛错（13.3 禁止 fallback 掩盖缺陷；旧实现同样抛错）
   */
  protected async buildPlayerParticipant(saveId: ID, trx: Knex.Transaction): Promise<CombatParticipant> {
    const character = await this.characterService.getCharacterCombatInfo(saveId, trx);
    if (!character) {
      throw new Error(`${this.mode} 战斗开始失败: 角色不存在 saveId=${saveId}`);
    }

    const attrFallback = this.ruleParser.getCombatRules().defaults.attribute_fallback;
    const mapping = this.ruleParser.getAttributeRoleMapping();

    return {
      id: character.characterId,
      name: character.name,
      isPlayer: true,
      // 13.3 数据归属：玩家参与者的归属为 character + characterId
      ownerType: 'character',
      ownerId: character.characterId,
      currentHP: character.currentHP,
      maxHP: character.maxHP,
      currentMP: character.currentMP,
      maxMP: character.maxMP,
      attack: character.derivedAttributes.attack ?? (character.attributes[mapping.physical_power] ?? attrFallback),
      defense: character.derivedAttributes.defense ?? (character.attributes[mapping.endurance] ?? attrFallback),
      speed: character.derivedAttributes.speed ?? (character.attributes[mapping.agility] ?? attrFallback),
      level: character.level,
      statusEffects: [],
      isDefending: false,
    };
  }

  protected sortByInitiative(participants: CombatParticipant[]): CombatParticipant[] {
    const initiativeType = this.ruleParser.getCombatRules().initiative_type;
    switch (initiativeType) {
      case 'random':
        for (let i = participants.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [participants[i], participants[j]] = [participants[j], participants[i]];
        }
        return participants;
      case 'dexterity':
      case 'dex':
      default:
        return participants.sort((a, b) => b.speed - a.speed);
    }
  }

  /**
   * 伤害计算（public，供 CombatService 委托调用）。
   *
   * 期望效果：
   * - 输入：攻击者 + 防御者 + 可选技能参数
   * - 输出：伤害分解（含 finalDamage / isCritical / elementMultiplier 等）
   * - 副作用：无（纯计算）
   *
   * code-design §5.1: CombatService 移除 numericalService/ruleParser 依赖后，
   * calculate_damage 工具方法委托到策略实现。
   */
  calculateDamage(
    attacker: CombatParticipant,
    defender: CombatParticipant,
    skill?: { baseDamage?: number; multiplier?: number; element?: string },
  ): DamageBreakdown {
    const baseAttack = attacker.attack;
    const skillMult = skill?.multiplier || 1.0;
    const baseDamage = skill?.baseDamage || baseAttack;

    const combatRules = this.ruleParser.getCombatRules();
    const levelBonusFactor = combatRules.damage_formula.level_bonus_factor;
    const attackContribution = combatRules.damage_formula.attack_contribution;
    const defenseReductionCoeff = combatRules.damage_formula.defense_reduction;
    const defendReduction = combatRules.defend.damage_reduction;
    const varianceMin = combatRules.damage_formula.variance_min;
    const varianceRange = combatRules.damage_formula.variance_range;

    const levelBonus = Math.max(0, (attacker.level - defender.level) * levelBonusFactor);
    const rawDamage = baseDamage * skillMult + attacker.attack * attackContribution + levelBonus;
    const defenseReduction = defender.defense * defenseReductionCoeff;
    let reducedDamage = rawDamage - defenseReduction;
    if (defender.isDefending) {
      reducedDamage *= (1 - defendReduction);
    }
    reducedDamage = Math.max(1, reducedDamage);

    const variance = varianceMin + Math.random() * varianceRange;
    const varianceDamage = reducedDamage * variance;

    const elementAffinities = combatRules.element_affinities;
    const attackElement = skill?.element ?? attacker.element ?? '';
    const elementMultiplier = this.numericalService.getElementMultiplier(
      attackElement,
      defender.element ?? '',
      elementAffinities,
    );
    const elementDamage = varianceDamage * elementMultiplier;

    const effectiveCriticalChance = combatRules.critical_hit.threshold / 20;
    const effectiveCriticalMultiplier = combatRules.critical_hit.multiplier;
    const isCritical = Math.random() < effectiveCriticalChance;
    const criticalMultiplier = isCritical ? effectiveCriticalMultiplier : 1;
    const finalDamage = Math.floor(elementDamage * criticalMultiplier);

    return {
      baseAttack,
      skillMultiplier: skillMult,
      levelBonus,
      defenseReduction: defender.defense * defenseReductionCoeff + (defender.isDefending ? reducedDamage * defendReduction : 0),
      variance: parseFloat(variance.toFixed(3)),
      criticalMultiplier,
      elementMultiplier: parseFloat(elementMultiplier.toFixed(3)),
      finalDamage,
      isCritical,
    };
  }

  protected applyDamage(target: CombatParticipant, damage: number): boolean {
    target.currentHP = Math.max(0, target.currentHP - damage);
    return target.currentHP <= 0;
  }

  /**
   * 解析目标参与者（内存匹配，针对 state.participants 已加载到内存的场景）
   *
   * 期望效果：
   * - 无 targetIds 时选取第一个非玩家且存活的参与者（默认目标）
   * - 有 targetIds 时按 id 或 name 精确匹配
   * - 找不到时抛错（禁止 fallback 兜底，违反"错误数据比垃圾数据更严重"原则）
   *
   * 注：此方法不是 13.2 规则的 DB 实体引用解析场景。
   * state.participants 已在内存中，内存匹配即可，不需要走 resolveEntityRef（DB 查询）。
   * 13.2 规则的 name/id 双兼容 + 时间戳兼容约束落在领域 Service（skillService/inventoryService）内部，
   * 由阶段四统一收敛到 resolveEntityRef。
   */
  protected resolveTarget(targets: CombatParticipant[], targetIds?: (ID | string)[]): CombatParticipant {
    if (!targetIds || targetIds.length === 0) {
      const defaultTarget = targets.find(t => t.currentHP > 0);
      if (!defaultTarget) {
        throw new Error('resolveTarget 失败: 无可用目标（所有目标已死亡或 targets 为空）');
      }
      return defaultTarget;
    }
    const targetId = String(targetIds[0]);
    const found = targets.find(t => String(t.id) === targetId || t.name === targetId);
    if (!found) {
      throw new Error(`resolveTarget 失败: 未找到目标 id/name="${targetId}"（可用目标: ${targets.map(t => `${t.name}(${t.id})`).join(', ')}）`);
    }
    return found;
  }

  protected selectTargetByStrategy(players: CombatParticipant[], strategy: EnemyStrategy): CombatParticipant {
    switch (strategy.targetPreference) {
      case 'weakest':
        return [...players].sort((a, b) => a.currentHP - b.currentHP)[0];
      case 'strongest':
        return [...players].sort((a, b) => b.currentHP - a.currentHP)[0];
      case 'healer':
        return players.find(p => p.currentMP > 0) ?? players[0];
      case 'nearest':
      default:
        return players[0];
    }
  }

  protected getSkillUseChanceByAggression(aggression: EnemyStrategy['aggression']): number {
    const baseChance = this.ruleParser.getCombatRules().enemy_ai.skill_use_chance;
    switch (aggression) {
      case 'aggressive': return Math.min(1.0, baseChance * 1.5);
      case 'defensive': return baseChance * 0.5;
      case 'tactical': return baseChance;
      default: return baseChance;
    }
  }

  protected selectSkillByPriority(
    skills: NonNullable<CombatParticipant['skills']>,
    skillPriority?: (ID | string)[],
  ): NonNullable<CombatParticipant['skills']>[number] {
    if (skillPriority && skillPriority.length > 0) {
      for (const ref of skillPriority) {
        const refStr = String(ref);
        const found = skills.find(s => s.name === refStr);
        if (found) return found;
      }
    }
    return skills[Math.floor(Math.random() * skills.length)];
  }

  protected checkEndInternal(state: CombatState): { ended: boolean; result?: ChallengeEndResult['result'] } {
    const alivePlayers = state.participants.filter(p => p.isPlayer && p.currentHP > 0);
    const aliveEnemies = state.participants.filter(p => !p.isPlayer && p.currentHP > 0);

    if (aliveEnemies.length === 0) {
      return { ended: true, result: 'victory' };
    }
    if (alivePlayers.length === 0) {
      return { ended: true, result: 'defeat' };
    }
    return { ended: false };
  }

  protected buildCombatResult(state: CombatState, result: ChallengeEndResult['result']): CombatResult {
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
      permadeath: result === 'defeat' ? (this.ruleParser.getSpecialRules().permadeath as boolean) ?? false : false,
      experience: result === 'victory' ? totalExp : 0,
      currency: result === 'victory' ? { gold: totalGold } : {},
      drops: [],
      turnsElapsed: state.turn + ((state.round - 1) * state.participants.length),
      participantResults,
    };
  }

  protected tickStatusEffectsInternal(state: CombatState): void {
    for (const participant of state.participants) {
      if (participant.statusEffects.length === 0) continue;

      const stillActive: StatusEffect[] = [];
      for (const effect of participant.statusEffects) {
        effect.remainingTurns--;

        if (effect.type === 'buff' && effect.power !== 0) {
          if (effect.name.includes('regen') || effect.name.includes('heal')) {
            participant.currentHP = Math.min(participant.maxHP, participant.currentHP + effect.power);
          }
          if (effect.name.includes('mana') || effect.name.includes('restore')) {
            participant.currentMP = Math.min(participant.maxMP, participant.currentMP + effect.power);
          }
        }

        if (effect.type === 'debuff' && effect.power !== 0) {
          if (effect.name.includes('poison') || effect.name.includes('burn')) {
            participant.currentHP = Math.max(0, participant.currentHP - effect.power);
          }
        }

        if (effect.remainingTurns > 0) {
          stillActive.push(effect);
        }
      }

      participant.statusEffects = stillActive;
    }
  }

  protected addLogEntry(
    state: CombatState,
    actor: string,
    action: string,
    target: string | undefined,
    result: TurnResult,
    breakdown: Partial<DamageBreakdown>,
  ): void {
    state.log.push({
      turn: state.turn,
      round: state.round,
      actor,
      action,
      target,
      result: {
        actionType: result.actionType,
        damage: result.damage,
        healed: result.healed,
        effect: result.effect,
        isCritical: result.isCritical,
        killed: result.killed,
        ...(breakdown.finalDamage !== undefined ? { damageBreakdown: breakdown } : {}),
      } as Record<string, unknown>,
      timestamp: Date.now() as Timestamp,
    });
  }

  // 抑制未使用变量告警（EnemyTemplate 等类型可能在子类使用）
  protected _suppressUnusedTypes = (): void => {
    void (null as unknown as EnemyTemplate);
    void (null as unknown as CombatLogEntry);
  };
}
