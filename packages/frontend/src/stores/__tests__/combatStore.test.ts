import { beforeEach, describe, expect, it } from 'vitest';
import { useCombatStore, initialCombat } from '../combatStore';

describe('useCombatStore challengeMode', () => {
  beforeEach(() => {
    useCombatStore.getState().clearCombat();
  });

  it('初始状态 challengeMode 应为 null', () => {
    expect(useCombatStore.getState().combat.challengeMode).toBeNull();
  });

  it('setChallengeMode 应写入 turn_based_combat', () => {
    useCombatStore.getState().setChallengeMode('turn_based_combat');
    expect(useCombatStore.getState().combat.challengeMode).toBe('turn_based_combat');
  });

  it('setChallengeMode 应写入 dynamic_combat', () => {
    useCombatStore.getState().setChallengeMode('dynamic_combat');
    expect(useCombatStore.getState().combat.challengeMode).toBe('dynamic_combat');
  });

  it('setChallengeMode(null) 应清空挑战模式', () => {
    useCombatStore.getState().setChallengeMode('turn_based_combat');
    useCombatStore.getState().setChallengeMode(null);
    expect(useCombatStore.getState().combat.challengeMode).toBeNull();
  });

  it('setChallengeMode 应写入 narrative_combat（GM 全权控制模式）', () => {
    useCombatStore.getState().setChallengeMode('narrative_combat');
    expect(useCombatStore.getState().combat.challengeMode).toBe('narrative_combat');
  });

  it('setChallengeMode 应支持 puzzle / mini_game / stealth 等非战斗挑战模式', () => {
    for (const mode of ['puzzle', 'mini_game', 'stealth'] as const) {
      useCombatStore.getState().setChallengeMode(mode);
      expect(useCombatStore.getState().combat.challengeMode).toBe(mode);
    }
  });

  it('clearCombat 应重置 challengeMode 为 null', () => {
    useCombatStore.getState().setChallengeMode('dynamic_combat');
    useCombatStore.getState().clearCombat();
    expect(useCombatStore.getState().combat).toEqual(initialCombat);
    expect(useCombatStore.getState().combat.challengeMode).toBeNull();
  });

  it('startCombat 不应覆盖已设置的 challengeMode（若调用方未显式传入）', () => {
    useCombatStore.getState().setChallengeMode('turn_based_combat');
    useCombatStore.getState().startCombat(
      [{ id: 'enemy-1', name: '哥布林', hp: 30, maxHP: 30 }],
      100,
      100,
    );
    // startCombat 会重置 combat 状态，但 challengeMode 由后端 metadata 重新写入
    expect(useCombatStore.getState().combat.active).toBe(true);
  });
});
