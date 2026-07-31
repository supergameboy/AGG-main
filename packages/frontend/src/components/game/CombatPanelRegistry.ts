/**
 * 战斗面板配置注册表（D5 方案 B 落地）
 *
 * 期望效果：
 * - 数据驱动 UI 渲染，新增 ChallengeMode 只需在 COMBAT_PANEL_REGISTRY 添加条目
 * - 替代 CombatPanel.tsx 内联 ACTION_CONFIG + shouldShowActionButtons/isDynamicCombat/isNarrativeCombat 三个条件判断函数
 * - 兼容旧存档（challengeMode 为 null/undefined 时使用 DEFAULT_COMBAT_PANEL_CONFIG）
 *
 * 设计契约（D5 方案 B）:
 * - 每种 ChallengeMode 对应一份 CombatPanelConfig
 * - actions 为空数组表示隐藏按钮组（叙事模式 GM 全权控制）
 * - simultaneousAction 为 true 时玩家始终可操作（动态战斗双方同时行动）
 *
 * 扩展指南：
 * - 新增 ChallengeMode（如未来实现 puzzle/mini_game/stealth 实际玩法）→ 在 COMBAT_PANEL_REGISTRY 添加条目
 * - 自定义按钮（如 puzzle 的"查看线索"/"使用道具"）→ 在 actions 数组添加 CombatActionButtonConfig
 * - 模式专属 UI 装饰（如潜行模式的"警戒值"指示器）→ 在 CombatPanelConfig 添加字段并在 CombatPanel 中消费
 */
import type { ComponentType } from 'react';
import { FireIcon, SparklesIcon, ShieldCheckIcon, ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import type { ChallengeMode } from '@/types';

/**
 * 战斗动作按钮配置
 */
export interface CombatActionButtonConfig {
  /** 动作 key（与 combatStore.availableActions 对应） */
  key: string;
  /** i18n 翻译键（namespace: game） */
  labelKey: string;
  /** 按钮图标 */
  icon: ComponentType<{ className?: string }>;
}

/**
 * 战斗面板配置（按 ChallengeMode 索引）
 *
 * 每个字段对应 CombatPanel 的一个 UI 决策点，禁止在 CombatPanel 内部再写条件判断
 */
export interface CombatPanelConfig {
  /**
   * 战斗动作按钮配置
   * - 空数组表示隐藏按钮组（叙事模式 / 预留模式）
   * - 默认 4 按钮（attack/skill/defend/flee）
   */
  actions: readonly CombatActionButtonConfig[];

  /**
   * 是否显示玩家数值区（HP/MP Progress 条）
   * - turn_based_combat / dynamic_combat / 默认 → true
   * - narrative_combat / 预留模式 → false（GM 全权控制，不展示数值）
   */
  showPlayerStats: boolean;

  /**
   * 是否显示敌人数值区（敌人卡片上的 HP/MP Progress 条）
   * - 与 showPlayerStats 同步，避免数值信息不对称
   */
  showEnemyStats: boolean;

  /**
   * 是否显示回合指示器（"你的回合/敌方回合" Badge）
   * - turn_based_combat / 默认 → true
   * - dynamic_combat → true（但 effectiveIsPlayerTurn 始终为 true，显示"你的回合"）
   * - narrative_combat / 预留模式 → false
   */
  showTurnIndicator: boolean;

  /**
   * 是否显示"同时攻击" Badge（仅 dynamic_combat）
   */
  showSimultaneousBadge: boolean;

  /**
   * 是否显示"叙事战斗" Badge + BookOpenIcon（仅 narrative_combat）
   */
  showNarrativeBadge: boolean;

  /**
   * 是否显示叙事提示条（"叙事战斗模式 - 通过对话框描述你的动作"）
   * - 仅 narrative_combat → true
   */
  showNarrativeHint: boolean;

  /**
   * 战斗日志区最大高度（CSS class）
   * - 数值模式 → 'max-h-[120px]'（日志较少）
   * - 叙事模式 → 'max-h-[200px]'（叙事文本较长）
   */
  combatLogMaxHeight: string;

  /**
   * 是否同时行动模式（玩家始终可操作，不等待敌方回合）
   * - 仅 dynamic_combat → true
   * - 其他模式 → false（按 isPlayerTurn 判断）
   */
  simultaneousAction: boolean;
}

/**
 * 默认 4 按钮动作配置（attack/skill/defend/flee）
 * 用于 turn_based_combat / dynamic_combat / 兼容旧存档
 */
const DEFAULT_ACTIONS: readonly CombatActionButtonConfig[] = [
  { key: 'attack', labelKey: 'combat.attack', icon: FireIcon },
  { key: 'skill', labelKey: 'combat.skill', icon: SparklesIcon },
  { key: 'defend', labelKey: 'combat.defend', icon: ShieldCheckIcon },
  { key: 'flee', labelKey: 'combat.flee', icon: ArrowUturnLeftIcon },
];

/**
 * 叙事模式空动作配置（隐藏按钮组）
 */
const EMPTY_ACTIONS: readonly CombatActionButtonConfig[] = [];

/**
 * 兼容旧存档的默认配置（challengeMode 为 null/undefined 时使用）
 * - 行为与 turn_based_combat 一致（4 按钮组 + 显示数值）
 */
export const DEFAULT_COMBAT_PANEL_CONFIG: CombatPanelConfig = {
  actions: DEFAULT_ACTIONS,
  showPlayerStats: true,
  showEnemyStats: true,
  showTurnIndicator: true,
  showSimultaneousBadge: false,
  showNarrativeBadge: false,
  showNarrativeHint: false,
  combatLogMaxHeight: 'max-h-[120px]',
  simultaneousAction: false,
};

/**
 * 战斗面板配置注册表（按 ChallengeMode 索引）
 *
 * 维护指南：
 * - 新增 ChallengeMode 实际玩法时，在下方注册表添加对应配置
 * - puzzle/mini_game/stealth 当前为预留值，使用叙事模式类似配置（隐藏数值+隐藏按钮组）
 * - 修改某模式配置时，需同步检查 CombatPanel.tsx 是否正确消费所有字段
 */
export const COMBAT_PANEL_REGISTRY: Record<ChallengeMode, CombatPanelConfig> = {
  /**
   * 回合制战斗：玩家先攻击，敌人后攻击
   * - 4 按钮组 + 完整数值显示
   */
  turn_based_combat: {
    ...DEFAULT_COMBAT_PANEL_CONFIG,
  },

  /**
   * 动态战斗：双方同时行动
   * - 4 按钮组 + 完整数值显示 + "同时攻击" Badge
   * - simultaneousAction=true，玩家始终可操作
   */
  dynamic_combat: {
    ...DEFAULT_COMBAT_PANEL_CONFIG,
    showSimultaneousBadge: true,
    simultaneousAction: true,
  },

  /**
   * 叙事战斗：GM 全权控制攻击顺序/伤害/状态效果
   * - 隐藏按钮组 + 隐藏数值 + 叙事 Badge + 叙事提示条
   * - 日志区加高（叙事文本较长）
   */
  narrative_combat: {
    actions: EMPTY_ACTIONS,
    showPlayerStats: false,
    showEnemyStats: false,
    showTurnIndicator: false,
    showSimultaneousBadge: false,
    showNarrativeBadge: true,
    showNarrativeHint: true,
    combatLogMaxHeight: 'max-h-[200px]',
    simultaneousAction: false,
  },

  /**
   * 解谜挑战（预留）
   * - 当前与叙事模式类似（隐藏数值+隐藏按钮组），待实际玩法设计后补充
   */
  puzzle: {
    actions: EMPTY_ACTIONS,
    showPlayerStats: false,
    showEnemyStats: false,
    showTurnIndicator: false,
    showSimultaneousBadge: false,
    showNarrativeBadge: false,
    showNarrativeHint: false,
    combatLogMaxHeight: 'max-h-[200px]',
    simultaneousAction: false,
  },

  /**
   * 小游戏挑战（预留）
   * - 当前与叙事模式类似，待实际玩法设计后补充
   */
  mini_game: {
    actions: EMPTY_ACTIONS,
    showPlayerStats: false,
    showEnemyStats: false,
    showTurnIndicator: false,
    showSimultaneousBadge: false,
    showNarrativeBadge: false,
    showNarrativeHint: false,
    combatLogMaxHeight: 'max-h-[200px]',
    simultaneousAction: false,
  },

  /**
   * 潜行挑战（预留）
   * - 当前与叙事模式类似，待实际玩法设计后补充
   */
  stealth: {
    actions: EMPTY_ACTIONS,
    showPlayerStats: false,
    showEnemyStats: false,
    showTurnIndicator: false,
    showSimultaneousBadge: false,
    showNarrativeBadge: false,
    showNarrativeHint: false,
    combatLogMaxHeight: 'max-h-[200px]',
    simultaneousAction: false,
  },
};

/**
 * 获取指定 ChallengeMode 的战斗面板配置
 *
 * 期望效果：
 * - challengeMode 为 null/undefined → 返回 DEFAULT_COMBAT_PANEL_CONFIG（兼容旧存档）
 * - challengeMode 为合法值 → 返回 COMBAT_PANEL_REGISTRY 中对应配置
 * - challengeMode 为非法值（类型守卫已保证不会发生）→ 返回 DEFAULT_COMBAT_PANEL_CONFIG
 *
 * @param challengeMode 当前挑战模式（来自 combatStore.challengeMode）
 * @returns 战斗面板配置
 */
export function getCombatPanelConfig(challengeMode: ChallengeMode | null | undefined): CombatPanelConfig {
  if (!challengeMode) {
    return DEFAULT_COMBAT_PANEL_CONFIG;
  }
  return COMBAT_PANEL_REGISTRY[challengeMode] ?? DEFAULT_COMBAT_PANEL_CONFIG;
}
