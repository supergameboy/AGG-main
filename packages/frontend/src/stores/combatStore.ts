import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { ChallengeMode, FrontendCombatEnemy, FrontendCombatLog, FrontendCombatState } from '@/types';

export type CombatEnemy = FrontendCombatEnemy;
export type CombatLog = FrontendCombatLog;
export type CombatState = FrontendCombatState;

const initialCombat: CombatState = {
  active: false,
  enemies: [],
  playerHP: 0,
  playerMaxHP: 0,
  playerMP: 0,
  playerMaxMP: 0,
  currentTurn: 0,
  isPlayerTurn: false,
  log: [],
  availableActions: ['attack', 'skill', 'defend', 'flee'],
  challengeMode: null,
};

/**
 * 战斗动作请求参数（code-design §7.2.1 getActionRequest 返回值）
 *
 * 期望效果：
 * - 根据 combat.combatMode 决定 action 后缀（combat-LLM / combat-program）
 * - gameStore.combatAction 消费此结构调用 wsManager.sendRequest
 * - turn_based_combat / dynamic_combat 走 G2 快速路径
 * - narrative_combat / null / 其他模式 走 Agent G 路径
 */
export interface CombatActionRequest {
  action: string;
  intentHint: string;
  payload: Record<string, unknown>;
}

interface CombatStoreState {
  combat: CombatState;

  setCombat: (combat: Partial<CombatState>) => void;
  updateCombat: (updates: Partial<CombatState>) => void;
  clearCombat: () => void;
  startCombat: (enemies: CombatEnemy[], playerHP: number, playerMaxHP: number, playerMP?: number, playerMaxMP?: number) => void;
  /** 阶段五新增：设置当前挑战模式 */
  setChallengeMode: (mode: ChallengeMode | null) => void;
  /**
   * 根据当前 combatMode 解析玩家战斗动作为 WS 请求参数（code-design §7.2.1）
   *
   * 期望效果：
   * - turn_based_combat / dynamic_combat → action='combat-program' 走 G2 快速路径
   * - narrative_combat / puzzle / mini_game / stealth / null → action='combat-LLM' 走 Agent G
   * - actorId 由调用方（gameStore）传入（来自 player.id）
   * - targetIds 仅在玩家显式选择目标时填充
   * - saveId 由调用方（gameStore）注入到返回的 payload 中
   */
  getActionRequest: (action: string, params: { actorId: string; targetId?: string; skillId?: string; itemId?: string }) => CombatActionRequest;
}

export const useCombatStore = create<CombatStoreState>()(
  devtools(
    immer((set, get) => ({
      combat: initialCombat,

      setCombat: (combat) =>
        set((state) => {
          // 如果本次更新明确设置了 active: true 但没有提供 enemies，保留现有 enemies
          if (combat.active === true && combat.enemies === undefined && state.combat.enemies.length > 0) {
            const { enemies: _omit, ...rest } = combat;
            Object.assign(state.combat, rest);
          } else {
            Object.assign(state.combat, combat);
          }
          // 安全保护：active 为 true 但 enemies 确实为空且非玩家回合时关闭
          if (state.combat.active && state.combat.enemies.length === 0 && !state.combat.isPlayerTurn) {
            state.combat.active = false;
          }
        }),

      updateCombat: (updates) =>
        set((state) => {
          Object.assign(state.combat, updates);
        }),

      clearCombat: () =>
        set((state) => {
          state.combat = initialCombat;
        }),

      startCombat: (enemies, playerHP, playerMaxHP, playerMP?, playerMaxMP?) =>
        set((state) => {
          if (!enemies || enemies.length === 0) {
            state.combat = initialCombat;
            return;
          }
          state.combat = {
            active: true,
            enemies,
            playerHP,
            playerMaxHP,
            playerMP,
            playerMaxMP,
            currentTurn: 1,
            isPlayerTurn: true,
            log: [],
            availableActions: ['attack', 'skill', 'defend', 'flee'],
          };
        }),

      setChallengeMode: (mode) =>
        set((state) => {
          state.combat.challengeMode = mode;
        }),

      getActionRequest: (action, params) => {
        const mode = get().combat.challengeMode;
        // 回合制 / 动态战斗 → G2 快速路径
        if (mode === 'turn_based_combat' || mode === 'dynamic_combat') {
          const challengeAction: Record<string, unknown> = {
            type: action,
            actorId: params.actorId,
          };
          if (params.targetId) challengeAction.targetIds = [params.targetId];
          if (params.skillId) challengeAction.skillId = params.skillId;
          if (params.itemId) challengeAction.itemId = params.itemId;
          return {
            action: 'combat-program',
            intentHint: action,
            payload: {
              message: '',
              data: { challengeAction },
            },
          };
        }
        // 叙事战斗 / puzzle / mini_game / stealth / null → Agent G 路径
        return {
          action: 'combat-LLM',
          intentHint: mode === 'narrative_combat' ? 'narrate_combat' : action,
          payload: {
            message: '',
            action: 'combat',
            data: { action, targetId: params.targetId, skillId: params.skillId, itemId: params.itemId },
          },
        };
      },
    })),
    { name: 'CombatStore' }
  )
);

export { initialCombat };
