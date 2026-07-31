import type { ID, Timestamp } from './core';

/**
 * 挑战模式类型
 * 包含战斗挑战（叙事/回合制/动态）+ 预留非战斗挑战（解密/小游戏/潜行）
 *
 * 期望效果：
 * - 战斗挑战：narrative_combat / turn_based_combat / dynamic_combat
 * - 非战斗挑战（预留）：puzzle / mini_game / stealth
 * - GameTemplate.default_challenge_mode 字段使用此类型
 * - ChallengeState.mode 字段使用此类型
 */
export type ChallengeMode =
  | 'narrative_combat'    // 叙事战斗
  | 'turn_based_combat'   // 回合制战斗
  | 'dynamic_combat'      // 动态战斗
  | 'puzzle'              // 解密（预留）
  | 'mini_game'           // 小游戏（预留）
  | 'stealth';            // 潜行（预留）

/** 全部合法 ChallengeMode 值（与联合类型一一对应，用于运行时校验） */
export const CHALLENGE_MODES: readonly ChallengeMode[] = [
  'narrative_combat',
  'turn_based_combat',
  'dynamic_combat',
  'puzzle',
  'mini_game',
  'stealth',
];

/**
 * ChallengeMode 类型守卫。
 * 用于校验持久化字段（如 CombatState.combatType、saves.active_challenge_mode）中的模式值——
 * 历史数据可能是 'encounter' 等遗留值，必须先校验再作为 ChallengeMode 使用。
 */
export function isChallengeMode(value: unknown): value is ChallengeMode {
  return typeof value === 'string' && (CHALLENGE_MODES as readonly string[]).includes(value);
}

/**
 * 挑战模式兜底值（三层覆盖优先级最后一层）。
 *
 * 决策链：玩家显式选择 > GM覆盖(saves.active_challenge_mode) > 模板默认(default_challenge_mode) > 本兜底。
 * 单一数据源：所有兜底场景（组合根 resolveChallengeMode / resolveActiveCombatMode、
 * ModeRouter 等）统一引用此常量，禁止各自硬编码 'turn_based_combat'。
 */
export const FALLBACK_CHALLENGE_MODE: ChallengeMode = 'turn_based_combat';

/**
 * 状态效果（挑战参与者身上的状态效果）
 *
 * 期望效果：
 * - 描述中毒/燃烧/增益/减益等状态效果
 * - duration 为剩余回合数，-1 表示永久
 */
export interface StatusEffect {
  id: ID;
  name: string;
  type: 'buff' | 'debuff' | 'dot' | 'hot' | 'control';
  duration: number;
  potency?: number;
  sourceActorId?: ID;
}

/**
 * 挑战参与者
 *
 * 期望效果：
 * - 描述参与挑战的实体（玩家/敌人/NPC/物体）
 * - ownerType/ownerId 用于 13.3 数据归属保守处理
 * - hp/maxHp/mp/maxMp 可选（叙事模式可不携带数值）
 */
export interface ChallengeParticipant {
  id: ID;
  name: string;
  type: 'player' | 'enemy' | 'npc' | 'object';
  ownerType: 'character' | 'npc';  // 13.3 数据归属保守处理
  ownerId: ID;                      // 13.3 数据归属保守处理
  hp?: number;
  maxHp?: number;
  mp?: number;
  maxMp?: number;
  isDefending?: boolean;
  statusEffects?: StatusEffect[];
}

/**
 * 敌人策略（战斗开始时由 Combat Agent 输出的一次性策略决策）
 *
 * 期望效果：
 * - 战斗开始时由 combat_director Agent 基于战斗场景生成（一次性，整个战斗复用）
 * - 描述本次战斗敌人的整体行为倾向（如进攻倾向、技能优先级、目标选择策略）
 * - 回合制/动态战斗的 processEnemyTurn 读取此字段执行敌人决策
 * - 叙事战斗不使用此字段（GM 全权控制）
 *
 * 一次性写入约束：
 * - handleGenerateEnemyStrategy 工具方法校验 state.enemyStrategy 不存在才写入
 * - 禁止覆盖已存在的敌人策略
 */
export interface EnemyStrategy {
  /** 整体进攻倾向（aggressive 平衡进攻 / defensive 防御 / tactical 战术） */
  aggression: 'aggressive' | 'defensive' | 'tactical';
  /** 技能优先级（按优先级降序，未列出的技能按默认冷却可用时使用；元素为技能 ID 或名称，13.2 name/id 双兼容） */
  skillPriority?: (ID | string)[];
  /** 目标选择策略（nearest 最近 / weakest 最弱 / strongest 最强 / healer 优先治疗者） */
  targetPreference: 'nearest' | 'weakest' | 'strongest' | 'healer';
  /** 逃跑 HP 阈值（百分比，HP 低于此值时尝试逃跑，0 表示死战不逃） */
  fleeThreshold?: number;
  /** 是否优先使用物品 */
  preferItems?: boolean;
  /** 战术说明（Agent 输出的人类可读描述，供调试和日志参考） */
  description: string;
}

/**
 * 挑战状态
 *
 * 期望效果：
 * - 描述一次挑战的完整状态（持久化到 combat_states 表）
 * - mode 字段标识挑战模式（路由层 ModeRouter 用于判定是否在挑战中）
 * - enemyStrategy 字段仅 turn_based_combat / dynamic_combat 模式使用
 * - metadata 字段存储模式专属元数据（如叙事模式的 narrative_log）
 */
export interface ChallengeState {
  saveId: ID;
  mode: ChallengeMode;
  active: boolean;
  participants: ChallengeParticipant[];
  turn: number;                     // 当前行动者索引
  round: number;                    // 当前轮次
  lastActionAt: Timestamp;
  metadata?: Record<string, unknown>;  // 模式专属元数据
  /**
   * 敌人策略（仅 turn_based_combat / dynamic_combat 模式使用）
   * - 由 combat_director Agent 在战斗开始时输出
   * - 策略实现类（TurnBasedCombatStrategy / DynamicCombatStrategy）的 processEnemyTurn 读取此字段
   * - narrative_combat 模式不使用此字段（GM 全权控制）
   * - 缺失时策略实现抛 EnemyStrategyMissingError，禁止静默 fallback
   */
  enemyStrategy?: EnemyStrategy;
}

/**
 * 挑战动作
 *
 * 期望效果：
 * - 描述玩家或敌人执行的动作
 * - skillId / itemId / targetIds 支持 name/id 双兼容（13.2）
 * - description 用于叙事模式（GM 描述战斗动作）
 */
export interface ChallengeAction {
  type: string;                     // 动作类型（attack/skill/defend/flee/narrate/...）
  actorId: ID;                      // 执行者 ID
  targetIds?: (ID | string)[];      // 目标 ID 或名称列表（13.2 name/id 双兼容）
  skillId?: ID | string;            // 技能 ID 或名称（13.2 name/id 双兼容）
  itemId?: ID | string;             // 物品 ID 或名称（13.2 name/id 双兼容）
  description?: string;             // 叙事描述（叙事模式专用）
  customData?: Record<string, unknown>;
}

/**
 * 行动结果（单个参与者执行一次动作的结果）
 *
 * 期望效果：
 * - 描述一次动作（攻击/技能/防御/逃跑/物品）的执行结果
 * - success 标识动作是否成功执行
 * - description 提供给 Agent 用于叙事的人类可读描述
 * - damage/healing/mpCost 等数值字段可选，仅在动作产生对应效果时填充
 */
export interface ActionResult {
  success: boolean;
  description: string;
  actorId: ID;
  targetId?: ID;
  damage?: number;
  healing?: number;
  mpCost?: number;
  statusApplied?: StatusEffect[];
  errorReason?: string;
}

/**
 * 副作用（挑战过程中对非参与者实体产生的影响）
 *
 * 期望效果：
 * - 描述挑战过程中对角色 HP/MP/物品/技能等产生的影响
 * - 由策略实现产生，由 CombatService 收集
 * - 用于挑战结束后应用奖励和状态变更
 */
export interface SideEffect {
  type: 'hp_change' | 'mp_change' | 'item_consumed' | 'item_durability' | 'skill_used' | 'status_effect' | 'experience_gained';
  targetId: ID;
  targetType: 'character' | 'npc' | 'item' | 'skill';
  value: number | string;
  metadata?: Record<string, unknown>;
}

/**
 * 挑戔回合结果
 *
 * 期望效果：
 * - 描述一次 executeStep 的结果
 * - actionResult 为本次动作的结果
 * - sideEffects 为本次动作产生的副作用列表
 * - combatEnded 标识挑战是否已结束
 * - hint 为提供给 Agent 的提示信息
 */
export interface ChallengeStepResult {
  actionResult: ActionResult;
  sideEffects?: SideEffect[];
  combatEnded: boolean;
  hint?: string;
}

/**
 * 挑战结束结果
 *
 * 期望效果：
 * - 描述挑战结束时的最终结果
 * - result 标识结束原因（胜利/失败/逃跑/平局）
 * - participants 为参与者最终状态
 * - rewards 为奖励（经验/货币/物品）
 */
export interface ChallengeEndResult {
  result: 'victory' | 'defeat' | 'flee' | 'draw';
  participants: ChallengeParticipant[];
  rewards?: {
    experience?: number;
    currency?: Record<string, number>;
    items?: ID[];
  };
  sideEffects?: SideEffect[];
}

/**
 * 回合结果（单个参与者一回合的行动结果）
 *
 * 期望效果：
 * - 包含行动者、行动结果列表、状态变更
 * - 用于动态战斗模式下同时返回多个参与者的回合结果
 */
export interface TurnResult {
  actorId: ID;
  actionResults: ActionResult[];
  sideEffects: SideEffect[];
  combatEnded: boolean;
}

/**
 * 执行回合结果（CombatService.executeTurn 的返回类型）
 *
 * 期望效果：
 * - turnResults：本回合所有参与者的行动结果列表
 * - combatState：更新后的挑战状态（若挑战结束则为 null）
 * - combatEnded：挑战是否已结束
 * - endResult：若挑战结束，包含结束结果（含奖励、参与者最终状态）
 * - hint：提供给 Agent 的提示信息
 */
export interface ExecuteTurnResult {
  turnResults: TurnResult[];
  combatState: ChallengeState | null;
  combatEnded: boolean;
  endResult?: ChallengeEndResult;
  hint?: string;
}
