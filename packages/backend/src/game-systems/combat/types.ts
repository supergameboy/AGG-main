import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type {
  ChallengeMode,
  ChallengeState,
  ChallengeAction,
  ChallengeStepResult,
  ChallengeEndResult,
  ChallengeParticipant,
  EnemyStrategy,
  StatusEffect as ChallengeStatusEffect,
} from '@ai-rpg/shared';

export interface CombatParticipant {
  id: ID;
  name: string;
  isPlayer: boolean;
  /** 13.3 数据归属保守处理：与 ChallengeParticipant.ownerType 对齐，禁止缺失 */
  ownerType: 'character' | 'npc';
  /** 13.3 数据归属保守处理：玩家为 characterId，敌人为 npcId，禁止缺失 */
  ownerId: ID;
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  statusEffects: StatusEffect[];
  isDefending: boolean;
  element?: string;
  skills?: Array<{
    name: string;
    baseDamage: number;
    multiplier?: number;
    manaCost?: number;
    type?: string;
    element?: string;
  }>;
  expReward?: number;
  goldReward?: number;
}

export interface EnemyTemplate {
  id: string;
  name: string;
  level: number;
  currentHP: number;
  maxHP: number;
  attack: number;
  defense: number;
  speed: number;
  skills: Array<{
    name: string;
    baseDamage: number;
    multiplier?: number;
    manaCost?: number;
    type?: string;
  }>;
  loot: Array<{
    item: string;
    chance: number;
    quantity: number;
  }>;
  expReward: number;
  goldReward: number;
}

export interface CombatAction {
  type: 'attack' | 'skill' | 'defend' | 'item' | 'flee';
  targetId?: ID;
  skillName?: string;
  skillId?: string;
  itemId?: string;
}

export interface CombatState {
  combatId: ID;
  saveId: ID;
  active: boolean;
  turn: number;
  round: number;
  currentActorIndex: number;
  participants: CombatParticipant[];
  log: CombatLogEntry[];
  startedAt: Timestamp;
  lastActionAt: Timestamp;
  combatType: string;
  /**
   * 敌人策略（仅 turn_based_combat / dynamic_combat 模式使用，DF-007 持久化）
   *
   * 期望效果：
   * - 由 handleGenerateEnemyStrategy 工具方法写入（一次性，禁止覆盖）
   * - 随 combat_data JSON 一起持久化到 combat_states 表
   * - combatStateToChallengeState 读取此字段填充 ChallengeState.enemyStrategy
   * - narrative_combat 模式不使用（GM 全权控制）
   */
  enemyStrategy?: EnemyStrategy;
  /**
   * 挑战元数据（与 ChallengeState.metadata 对应，DF-007 持久化）
   *
   * 期望效果：
   * - 存储模式专属元数据（如 dynamic_combat 的 actionQueue）
   * - queue_action 工具方法写入 metadata.actionQueue
   * - 随 combat_data JSON 一起持久化到 combat_states 表
   * - combatStateToChallengeState 读取此字段填充 ChallengeState.metadata
   *
   * 历史遗留：原 combatStateToChallengeState 将 combatId/combatType/log 等字段
   * 组装成 ChallengeState.metadata，现新增此字段后可直接存储扩展元数据。
   */
  metadata?: Record<string, unknown>;
}

export interface CombatResult {
  victory: boolean;
  fled: boolean;
  defeat: boolean;
  permadeath?: boolean;
  experience: number;
  currency: Record<string, number>;
  drops: Array<{ item: string; quantity: number }>;
  turnsElapsed: number;
  participantResults: ParticipantResult[];
}

export interface TurnResult {
  actorName: string;
  actionType: string;
  targetName?: string;
  damage?: number;
  healed?: number;
  effect?: string;
  isCritical?: boolean;
  killed?: boolean;
  logMessage: string;
}

export interface StatusEffect {
  name: string;
  type: 'buff' | 'debuff';
  remainingTurns: number;
  power: number;
  source: string;
}

export interface DamageBreakdown {
  baseAttack: number;
  skillMultiplier: number;
  levelBonus: number;
  defenseReduction: number;
  variance: number;
  criticalMultiplier: number;
  elementMultiplier: number;
  finalDamage: number;
  isCritical: boolean;
}

export interface CombatLogEntry {
  turn: number;
  round: number;
  actor: string;
  action: string;
  target?: string;
  result: Record<string, unknown>;
  timestamp: Timestamp;
}

export interface ParticipantResult {
  id: ID;
  name: string;
  isPlayer: boolean;
  finalHP: number;
  finalMP: number;
  survived: boolean;
  damageDealt: number;
  damageTaken: number;
}

// ============================================================================
// S3-2: Repository 端口接口 + Row/Input 类型
// ============================================================================

/**
 * combat_states 表行映射类型。
 *
 * combat_data 是 JSON 字符串，映射时反序列化为 CombatState 实体。
 */
export interface CombatStateRow {
  id: ID;
  saveId: string;
  status: string;
  /**
   * 挑战模式（combat_states.mode 列，migration 007）。
   * 三层覆盖优先级决策后的持久化结果，G2 路径据此构建对应策略（跨请求可见）。
   */
  mode: string;
  combatData: CombatState;
  createdAt: number;
  updatedAt: number;
}

/**
 * combat_history 表插入输入类型。
 *
 * result_data 是 JSON 字符串，插入时序列化 CombatResult。
 */
export interface CombatHistoryInsertInput {
  id: ID;
  saveId: string;
  resultData: CombatResult;
  createdAt: number;
}

/**
 * Combat 领域 Repository 端口接口（combat_states 表）。
 *
 * D7: 一表一 Repository，本接口只操作 combat_states 表。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * combat_states 表有 save_id 字段，所有查询按 saveId 过滤。
 */
export interface ICombatRepository {
  /**
   * 按 saveId 查询战斗状态（覆盖 getCombatState L198 + finalizeCombat L962 + saveCombatState 隐式 first）。
   * where save_id + first。
   */
  findBySaveId(saveId: string, trx?: Knex.Transaction): Promise<CombatStateRow | null>;

  /**
   * 插入或更新战斗状态（覆盖 startCombat L158-178 existing? update : insert + saveCombatState L893 update）。
   * 存在则 update（combat_data + updated_at + 可选 status），不存在则 insert。
   * status 可选：startCombat 传入 'active'，saveCombatState 不传（仅更新数据）。
   *
   * 阶段二扩展：state 类型扩展为 `CombatState | ChallengeState`，支持策略实现类
   * （TurnBasedCombatStrategy/DynamicCombatStrategy）直接持久化 ChallengeState。
   * 运行时 combat_data 为 JSON 字符串，存储结构由调用方决定。
   * 现有调用方（CombatService）继续传 CombatState，类型兼容。
   */
  upsert(saveId: string, state: CombatState | ChallengeState, status?: string, trx?: Knex.Transaction): Promise<void>;

  /**
   * 按 saveId 删除战斗状态（覆盖 finalizeCombat L973-975 del）。
   * where save_id + del。S4-D6: 统一返回 Promise<void>，调用方不需要删除数量。
   */
  deleteBySaveId(saveId: string, trx?: Knex.Transaction): Promise<void>;

  /**
   * 轻量存在性检查（P1.2）：仅查 combat_states 表是否存在记录，不读取 combat_data。
   * 用于 AgentRuntime inCombat 检查，避免创建完整 CombatService（22 次 DB query + 11 次 YAML 解析）。
   * where save_id + select id + first。
   */
  existsBySaveId(saveId: string, trx?: Knex.Transaction): Promise<boolean>;
}

/**
 * Combat 领域 Repository 端口接口（combat_history 表）。
 *
 * D7: 一表一 Repository，本接口只操作 combat_history 表。
 * D9: 写操作支持可选 trx 参数。
 * combat_history 表有 save_id 字段，插入时记录 saveId。
 */
export interface ICombatHistoryRepository {
  /**
   * 插入战斗历史记录（覆盖 finalizeCombat L966-971 insert）。
   */
  insert(record: CombatHistoryInsertInput, trx?: Knex.Transaction): Promise<void>;

  /**
   * 按 saveId 删除战斗历史记录（rollbackSave 回滚存档时清理 combat_history 表）。
   * S4-D6: 统一返回 Promise<void>，调用方不需要删除数量。
   * D9: 支持可选 trx 参数，事务由 Service 层管理。
   */
  deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void>;
}

/**
 * Combat 领域 Service 端口接口。
 *
 * D-S3-2-1: 从 agents/types.ts 迁入 combat/types.ts 并扩展为 CombatService 完整公共方法端口接口。
 * 供跨领域消费方注入使用（如 GM Agent 内部 AgentRuntime 调用 getCombatState 检查战斗状态）。
 *
 * 实现：game-systems/combat/CombatService.ts（implements ICombatService）。
 */
export interface ICombatService {
  /**
   * 开始战斗（覆盖 startCombat L54）。D9: 支持可选 trx 参数。
   *
   * 挑战模式由组合根（CombatServiceTool）按三层覆盖优先级决策后通过策略构造注入，
   * 本方法不再接收 combatType/modeOverride 参数（2026-07-25 模式选择链修复，删除死字段链路）。
   */
  startCombat(saveId: ID, enemies: EnemyTemplate[], trx?: Knex.Transaction): Promise<CombatState>;
  /** 查询当前战斗状态（覆盖 getCombatState L193，AgentRuntime 跨领域调用） */
  getCombatState(saveId: ID): Promise<{ state: CombatState | null; hint?: string }>;
  /** 执行回合（覆盖 executeTurn L219）。D9: 支持可选 trx 参数。 */
  executeTurn(saveId: ID, action: CombatAction, trx?: Knex.Transaction): Promise<TurnResult[]>;
  /** 检查战斗是否结束（覆盖 checkCombatEnd L396） */
  checkCombatEnd(saveId: ID): Promise<{ ended: boolean; result?: CombatResult }>;
  /** 结束战斗（覆盖 endCombat L408）。D9: 支持可选 trx 参数。 */
  endCombat(saveId: ID, result: CombatResult, trx?: Knex.Transaction): Promise<void>;
  /** 尝试逃跑（覆盖 fleeAttempt L445）。D9: 支持可选 trx 参数。 */
  fleeAttempt(saveId: ID, trx?: Knex.Transaction): Promise<{ success: boolean; chance: number; message: string }>;
  /** 查询战斗日志（覆盖 getCombatLog L492） */
  getCombatLog(saveId: ID, limit?: number): Promise<{ log: CombatLogEntry[]; hint?: string }>;
  /** 战斗中使用物品（覆盖 useItemInCombat L506）。D9: 支持可选 trx 参数。 */
  useItemInCombat(saveId: ID, itemId: ID, trx?: Knex.Transaction): Promise<TurnResult>;
  /** 防御动作（覆盖 defend L579）。D9: 支持可选 trx 参数。 */
  defend(saveId: ID, trx?: Knex.Transaction): Promise<TurnResult>;
  /** 查询状态效果（覆盖 getStatusEffects L611） */
  getStatusEffects(saveId: ID): Promise<{ effects: Array<{ participantName: string; effects: StatusEffect[] }>; hint?: string }>;
}

// ============================================================================
// 挑战模式策略端口接口（code-design §3.1，新增）
// ============================================================================

/**
 * 挑战模式策略端口接口
 *
 * 期望效果：
 * - 所有挑战模式（战斗/解密/小游戏/潜行）的策略实现必须实现此接口
 * - CombatService 委托 startChallenge/executeStep/endChallenge 给策略
 * - 策略实现可选择不持久化状态（如叙事模式）
 * - 策略实现可选择不 emit 事件（如叙事模式不 emit combat_end）
 *
 * 注意：此接口用于挑战模式策略实现（TurnBasedCombatStrategy/DynamicCombatStrategy/NarrativeCombatStrategy），
 * 与现有 ICombatService（领域 Service 端口接口）并存。阶段二 CombatService 重构后，
 * CombatService 将委托给 IChallengeStrategy 实现。
 */
export interface IChallengeStrategy {
  /** 挑战模式标识 */
  readonly mode: ChallengeMode;

  /**
   * 开始挑战
   *
   * 期望效果：
   * - 输入：saveId + 参与者列表 + 选项
   * - 输出：初始化的 ChallengeState
   * - 副作用：策略可选择持久化状态（叙事模式不持久化）
   * - 错误：参与者列表为空时抛错
   */
  startChallenge(
    saveId: ID,
    participants: ChallengeParticipant[],
    options: ChallengeOptions,
    trx?: Knex.Transaction
  ): Promise<ChallengeState>;

  /**
   * 执行回合/步骤
   *
   * 期望效果：
   * - 输入：saveId + 当前状态 + 动作
   * - 输出：步骤结果 + 是否结束
   * - 副作用：策略可选择修改角色状态（叙事模式不修改）
   */
  executeStep(
    saveId: ID,
    state: ChallengeState,
    action: ChallengeAction,
    trx?: Knex.Transaction
  ): Promise<ChallengeStepResult>;

  /**
   * 结束挑战
   *
   * 期望效果：
   * - 输入：saveId + 状态 + 结果
   * - 输出：结束结果（含奖励）
   * - 副作用：策略可选择 emit 事件（叙事模式不 emit）
   */
  endChallenge(
    saveId: ID,
    state: ChallengeState,
    result: ChallengeEndResult['result'],
    trx?: Knex.Transaction
  ): Promise<ChallengeEndResult>;

  /**
   * 检查挑战是否结束
   *
   * 期望效果：
   * - 输入：当前状态
   * - 输出：是否结束 + 结果（若结束）
   * - 无副作用
   * - 注意：策略实现有义务在 ended=true 时同时返回 result
   *   违反契约为策略实现 bug（CombatService 会抛 StrategyCheckEndError）
   */
  checkEnd(state: ChallengeState): { ended: boolean; result?: ChallengeEndResult['result'] };
}

/**
 * 战斗模式策略端口接口（IChallengeStrategy 的子接口）
 *
 * 期望效果：
 * - 三种战斗模式（叙事/回合制/动态）的策略实现必须实现此接口
 * - 暴露 calculateDamage 供 CombatService 委托（叙事模式不实现）
 * - processPlayerAction / processEnemyTurn / tickStatusEffects 是策略内部辅助方法，
 *   不在端口接口中暴露（签名因策略实现而异，子类共享 protected 方法即可）
 *
 * 设计偏差（小偏差，就地修复）:
 * - 原设计将 processPlayerAction/processEnemyTurn/tickStatusEffects 放在接口中
 * - 实际 CombatStrategyBase 使用 CombatState（内部状态）+ TurnResult（业务层类型），
 *   与接口签名（ChallengeState + ChallengeTurnResult）不一致
 * - 这些方法仅由策略 executeStep 内部调用，不需要外部访问，移至策略实现内部
 */
export interface ICombatModeStrategy extends IChallengeStrategy {
  /**
   * 伤害计算（纯计算，不修改状态）
   *
   * 期望效果：
   * - 输入：攻击者 + 防御者 + 可选技能参数
   * - 输出：伤害分解（含 finalDamage / isCritical / elementMultiplier 等）
   * - 副作用：无（纯计算）
   *
   * code-design §5.1: CombatService.calculateDamage 委托到策略实现
   * 叙事模式不实现（GM 全权控制伤害）
   *
   * 注：参数使用 CombatParticipant（业务层类型），非 ChallengeParticipant（共享层类型），
   * 因为伤害计算需要 attack/defense/speed/level 等数值字段，这些字段在 ChallengeParticipant 中可选。
   */
  calculateDamage?(
    attacker: CombatParticipant,
    defender: CombatParticipant,
    skill?: { baseDamage?: number; multiplier?: number; element?: string },
  ): DamageBreakdown;
}

/**
 * 挑战选项（startChallenge 入参）
 *
 * 期望效果：
 * - customRules: 模式专属自定义规则
 * - persistState: 是否持久化状态（叙事模式为 false）
 * - emitEndEvent: 是否 emit 结束事件（叙事模式为 false）
 *
 * 注：原 modeOverride 字段已删除（2026-07-25 模式选择链修复）。
 * 策略实例的 mode 在组合根按三层覆盖优先级决策后经构造注入固定，
 * startChallenge 不再接收模式覆盖（原字段传入后被策略忽略，属死字段）。
 */
export interface ChallengeOptions {
  /** 自定义规则 */
  customRules?: Record<string, unknown>;
  /** 是否持久化状态（叙事模式为 false） */
  persistState?: boolean;
  /** 是否 emit 结束事件（叙事模式为 false） */
  emitEndEvent?: boolean;
}

/**
 * CombatServiceTool 端口接口说明：
 * ICombatServiceTool 已按 DF-029 修复移至工具层 I
 * 实际定义位置：packages/backend/src/game-systems/combat/CombatServiceTool.ts
 * G2 层 ChallengeProgram 应从该文件 type import
 * （符合 architecture-standards §1.1 "G2 层 → 工具层 I（仅 type import 端口接口）"）
 *
 * 此处仅保留指向说明，避免误把端口接口放在业务层 F。
 */

// ============================================================================
// 挑战模式错误类型（code-design §5.1 DF-022 + §4.1 EnemyStrategyMissingError）
// ============================================================================

/**
 * 挑战状态不存在错误
 *
 * 期望效果：
 * - CombatService.executeTurn / executeStepOnly 在 state 不存在时抛出
 * - CombatServiceTool.queryChallengeState 在 state 不存在时抛出
 * - 错误信息包含 saveId 上下文，让问题尽早暴露（DF-015 修复：禁止 fallback 掩盖缺陷）
 */
export class CombatStateNotFoundError extends Error {
  constructor(public readonly saveId: ID) {
    super(`挑战状态不存在: saveId=${saveId}`);
    this.name = 'CombatStateNotFoundError';
  }
}

/**
 * 挑战未激活错误
 *
 * 期望效果：
 * - CombatService.executeTurn / executeStepOnly 在 state.active=false 时抛出
 * - 错误信息包含 saveId 上下文
 */
export class CombatNotActiveError extends Error {
  constructor(public readonly saveId: ID) {
    super(`挑战未激活: saveId=${saveId}`);
    this.name = 'CombatNotActiveError';
  }
}

/**
 * 策略结束检测错误
 *
 * 期望效果：
 * - CombatService.executeTurn 在 strategy.checkEnd 返回 { ended: true, result: undefined } 时抛出
 * - CombatServiceTool.checkChallengeEnd 在同样情况抛出（DF-022 修复：禁止死循环，DF-032 修复：明确抛错位置）
 * - 错误信息包含 mode + saveId 上下文
 * - 策略实现有义务在 ended=true 时同时返回 result，违反契约为策略实现 bug
 */
export class StrategyCheckEndError extends Error {
  constructor(
    public readonly saveId: ID,
    public readonly mode: ChallengeMode
  ) {
    super(`策略结束检测异常: saveId=${saveId}, mode=${mode}（ended=true 但 result 未确定，禁止死循环）`);
    this.name = 'StrategyCheckEndError';
  }
}

/**
 * 敌人策略缺失错误
 *
 * 期望效果：
 * - TurnBasedCombatStrategy.processEnemyTurn 在 state.enemyStrategy 缺失时抛出
 * - DynamicCombatStrategy.executeStep 在 state.enemyStrategy 缺失时抛出
 * - 错误信息包含 saveId + mode 上下文
 * - 禁止静默 fallback（如使用默认策略），必须尽早暴露问题
 *
 * 设计契约（满足用户原始需求"战斗开始时 Combat AGENT 输出敌人策略"）:
 * - 仅 turn_based_combat / dynamic_combat 模式抛出
 * - narrative_combat 模式不使用 enemyStrategy，不抛出
 */
export class EnemyStrategyMissingError extends Error {
  constructor(
    public readonly saveId: ID,
    public readonly mode: ChallengeMode
  ) {
    super(`敌人策略缺失: saveId=${saveId}, mode=${mode}（战斗开始时未调用 generate_enemy_strategy 写入 enemyStrategy，禁止静默 fallback）`);
    this.name = 'EnemyStrategyMissingError';
  }
}

// ============================================================================
// CombatState ↔ ChallengeState 适配映射（阶段二，code-design §2.3 并存 + 渐进统一）
// ============================================================================

/**
 * CombatParticipant → ChallengeParticipant 适配。
 *
 * 期望效果：
 * - isPlayer=true → type='player'
 * - isPlayer=false → type='enemy'
 * - ownerType/ownerId 直接从 CombatParticipant 透传（13.3 数据归属保守处理）
 * - currentHP/maxHP/currentMP/maxMP → hp/maxHp/mp/maxMp（可选）
 *
 * 2026-07-25 修复 B7: ownerType/ownerId 现在是 CombatParticipant 的必填字段，
 * 不再需要调用方单独传入 ownerId（消除归属数据与实体分离的脆弱设计）。
 */
export function combatParticipantToChallengeParticipant(
  p: CombatParticipant,
): ChallengeParticipant {
  return {
    id: p.id,
    name: p.name,
    type: p.isPlayer ? 'player' : 'enemy',
    ownerType: p.ownerType,
    ownerId: p.ownerId,
    hp: p.currentHP,
    maxHp: p.maxHP,
    mp: p.currentMP,
    maxMp: p.maxMP,
    isDefending: p.isDefending,
    statusEffects: p.statusEffects.map(combatStatusToChallengeStatus),
  };
}

/**
 * ChallengeParticipant → CombatParticipant 适配（数值计算用）。
 *
 * 期望效果：
 * - type='player' → isPlayer=true
 * - type!='player' → isPlayer=false
 * - hp/maxHp/mp/maxMp → currentHP/maxHP/currentMP/maxMP（缺失默认 0）
 * - ownerType/ownerId 透传（13.3 数据归属保守处理，禁止归属数据丢失）
 */
export function challengeParticipantToCombatParticipant(
  p: ChallengeParticipant,
): CombatParticipant {
  return {
    id: p.id,
    name: p.name,
    isPlayer: p.type === 'player',
    ownerType: p.ownerType,
    ownerId: p.ownerId,
    currentHP: p.hp ?? 0,
    maxHP: p.maxHp ?? 0,
    currentMP: p.mp ?? 0,
    maxMP: p.maxMp ?? 0,
    attack: 0,
    defense: 0,
    speed: 0,
    level: 1,
    statusEffects: (p.statusEffects ?? []).map(challengeStatusToCombatStatus),
    isDefending: p.isDefending ?? false,
  };
}

/** 战斗内 StatusEffect（name/remainingTurns/power）→ 共享 StatusEffect（id/duration/potency） */
function combatStatusToChallengeStatus(s: StatusEffect): ChallengeStatusEffect {
  return {
    id: s.name as ID,
    name: s.name,
    type: s.type === 'buff' ? 'buff' : 'debuff',
    duration: s.remainingTurns,
    potency: s.power,
    sourceActorId: s.source as ID | undefined,
  };
}

/** 共享 StatusEffect → 战斗内 StatusEffect */
function challengeStatusToCombatStatus(s: ChallengeStatusEffect): StatusEffect {
  return {
    name: s.name,
    type: s.type === 'buff' ? 'buff' : 'debuff',
    remainingTurns: s.duration,
    power: s.potency ?? 0,
    source: s.sourceActorId ? String(s.sourceActorId) : '',
  };
}

/**
 * CombatState → ChallengeState 适配。
 *
 * 期望效果：
 * - mode 由调用方提供（CombatState.combatType 不直接映射到 mode）
 * - combatId/log/startedAt/currentActorIndex/combatType 存入 metadata
 * - enemyStrategy 由调用方提供（仅 turn_based_combat/dynamic_combat 模式）
 *
 * 字段映射（设计 §2.3）:
 * - combatId → metadata.combatId
 * - combatType → metadata.combatType
 * - log → metadata.log
 * - startedAt → metadata.startedAt
 * - currentActorIndex → metadata.currentActorIndex
 * - lastActionAt → lastActionAt（直接映射）
 * - turn/round → turn/round（直接映射，注意 CombatState.turn 是回合数）
 */
export function combatStateToChallengeState(
  state: CombatState,
  mode: ChallengeMode,
  enemyStrategyOverride?: EnemyStrategy,
): ChallengeState {
  // 基础元数据：将 CombatState 字段映射到 ChallengeState.metadata
  const baseMetadata: Record<string, unknown> = {
    combatId: state.combatId,
    combatType: state.combatType,
    log: state.log,
    startedAt: state.startedAt,
    currentActorIndex: state.currentActorIndex,
    combatTurn: state.turn,  // CombatState.turn（回合数）存入 metadata 避免与 ChallengeState.turn（行动者索引）冲突
  };
  // 合并 CombatState.metadata 中的扩展元数据（如 actionQueue）
  // CombatState.metadata 优先级高于 baseMetadata（扩展字段可覆盖基础字段）
  const mergedMetadata = { ...baseMetadata, ...(state.metadata ?? {}) };

  return {
    saveId: state.saveId,
    mode,
    active: state.active,
    participants: state.participants.map(p =>
      combatParticipantToChallengeParticipant(p),
    ),
    turn: state.currentActorIndex,
    round: state.round,
    lastActionAt: state.lastActionAt,
    metadata: mergedMetadata,
    // 优先使用 override 参数（向后兼容），否则从 CombatState 持久化字段读取
    enemyStrategy: enemyStrategyOverride ?? state.enemyStrategy,
  };
}

/**
 * ChallengeState → CombatState 适配（持久化用）。
 *
 * 期望效果：
 * - 从 metadata 重建 combatId/log/startedAt/currentActorIndex/combatType
 * - participants 转换为 CombatParticipant[]
 * - turn 字段从 metadata.combatTurn 取（CombatState.turn 是回合数，不是行动者索引）
 *
 * 缺失字段使用默认值，保证向后兼容。
 */
export function challengeStateToCombatState(state: ChallengeState): CombatState {
  const metadata = (state.metadata ?? {}) as Record<string, unknown>;
  return {
    combatId: (metadata.combatId as ID) ?? (`combat-${String(state.saveId).substring(0, 8)}` as ID),
    saveId: state.saveId,
    active: state.active,
    turn: (metadata.combatTurn as number) ?? 1,
    round: state.round,
    currentActorIndex: (metadata.currentActorIndex as number) ?? state.turn,
    participants: state.participants.map(challengeParticipantToCombatParticipant),
    log: (metadata.log as CombatLogEntry[]) ?? [],
    startedAt: (metadata.startedAt as Timestamp) ?? state.lastActionAt,
    lastActionAt: state.lastActionAt,
    combatType: (metadata.combatType as string) ?? 'encounter',
    // DF-007: enemyStrategy 随 CombatState 一起持久化
    enemyStrategy: state.enemyStrategy,
    // DF-007: 扩展元数据（如 actionQueue）原样保留，供 combatStateToChallengeState 读取
    // 注意：combatId/combatType/log/startedAt/currentActorIndex/combatTurn 这些字段
    // 已在 CombatState 的独立字段中持久化，这里只保留扩展元数据（去除基础字段避免冗余）
    metadata: filterExtendedMetadata(metadata),
  };
}

/**
 * 过滤 ChallengeState.metadata 中的基础字段，只保留扩展元数据。
 *
 * 基础字段（combatId/combatType/log/startedAt/currentActorIndex/combatTurn）
 * 已映射到 CombatState 的独立字段，无需重复存储在 CombatState.metadata 中。
 * 扩展字段（如 actionQueue）保留原样。
 */
function filterExtendedMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const BASE_FIELDS = new Set(['combatId', 'combatType', 'log', 'startedAt', 'currentActorIndex', 'combatTurn']);
  const extended: Record<string, unknown> = {};
  for (const key of Object.keys(metadata)) {
    if (!BASE_FIELDS.has(key)) {
      extended[key] = metadata[key];
    }
  }
  return Object.keys(extended).length > 0 ? extended : undefined;
}
