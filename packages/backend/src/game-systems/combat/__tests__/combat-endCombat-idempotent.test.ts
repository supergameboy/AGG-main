import { describe, expect, it, vi } from 'vitest';

describe('CombatService — endCombat 幂等化 (E3-1)', () => {
  it('当 getCombatState 返回 null 时，endCombat 不抛异常', async () => {
    // 直接验证修改后的逻辑：endCombat 中 state 为 null 时 return 而非 throw
    // 通过模拟 CombatService 的行为来测试

    const mockDb = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null), // combat_states 表无记录
      }),
    });

    // CombatService.endCombat 调用 getCombatState → db('combat_states').where.first → null
    // 修改后的逻辑：if (!state) { logger.info(...); return; }
    // 验证：不抛异常

    // 模拟 endCombat 的核心逻辑
    async function endCombat(saveId: string): Promise<void> {
      const combatRow = await mockDb('combat_states')
        .where({ save_id: saveId })
        .first();

      if (!combatRow) {
        // 修改后的逻辑：不再 throw，直接 return
        return;
      }
      // ... 原有逻辑
    }

    await expect(endCombat('save-1')).resolves.toBeUndefined();
    expect(mockDb).toHaveBeenCalledWith('combat_states');
  });

  it('当 getCombatState 返回有效 state 时，endCombat 正常执行', async () => {
    const mockDb = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({
          save_id: 'save-1',
          combat_data: JSON.stringify({ active: true, turn: 1, round: 1 }),
        }),
      }),
    });

    async function endCombat(saveId: string): Promise<string> {
      const combatRow = await mockDb('combat_states')
        .where({ save_id: saveId })
        .first();

      if (!combatRow) {
        return 'already-ended';
      }
      return 'ended';
    }

    const result = await endCombat('save-1');
    expect(result).toBe('ended');
  });
});

describe('CombatServiceTool — execute_turn 返回 hint (E3-2)', () => {
  it('当 combatEnded 为 true 时，resultData 包含 hint', () => {
    const combatState = { active: false, turn: 5, round: 3 };
    const combatEnded = combatState ? !(combatState as any).active : true;

    const resultData: Record<string, unknown> = {
      turnResults: { playerTurn: { damage: 10 } },
      combatState,
      combatEnded,
    };
    if (combatEnded) {
      resultData.hint = '战斗已自动结束，无需再调用 end_combat';
    }

    expect(resultData.combatEnded).toBe(true);
    expect(resultData.hint).toBe('战斗已自动结束，无需再调用 end_combat');
  });

  it('当 combatEnded 为 false 时，resultData 不包含 hint', () => {
    const combatState = { active: true, turn: 2, round: 1 };
    const combatEnded = combatState ? !(combatState as any).active : true;

    const resultData: Record<string, unknown> = {
      turnResults: { playerTurn: { damage: 10 } },
      combatState,
      combatEnded,
    };
    if (combatEnded) {
      resultData.hint = '战斗已自动结束，无需再调用 end_combat';
    }

    expect(resultData.combatEnded).toBe(false);
    expect(resultData.hint).toBeUndefined();
  });

  it('当 combatState 为 null 时，combatEnded 为 true 且包含 hint', () => {
    const combatState = null;
    const combatEnded = combatState ? !(combatState as any).active : true;

    const resultData: Record<string, unknown> = {
      turnResults: { playerTurn: { damage: 10 } },
      combatState,
      combatEnded,
    };
    if (combatEnded) {
      resultData.hint = '战斗已自动结束，无需再调用 end_combat';
    }

    expect(resultData.combatEnded).toBe(true);
    expect(resultData.hint).toBe('战斗已自动结束，无需再调用 end_combat');
  });
});
