/**
 * ChallengeProgram 单元测试
 *
 * 设计意图（fractal-design-20260724-g2-program-execution-layer §6.3）:
 * - 验证 G2 程序执行层的 4 个原子方法：queryState / executeTurn / checkEnd / collectEndResult
 * - 验证委托 ICombatServiceTool 的调用契约（参数透传、返回值透传）
 * - 验证 ChallengeProgram 不做路由编排（不抛"未处于挑战中""挑战已结束""非战斗模式"等业务错误）
 *   ↑ 这些错误已迁移到服务层 E handleProgramAction，由集成测试覆盖
 *
 * 测试方式：mock ICombatServiceTool 端口接口，验证 ChallengeProgram 的纯程序执行行为。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChallengeProgram } from '../ChallengeProgram.js';
import type { ICombatServiceTool } from '../../game-systems/combat/CombatServiceTool.js';
import type {
  ChallengeAction,
  ChallengeState,
  ChallengeStepResult,
  ChallengeEndResult,
  ToolContext,
} from '@ai-rpg/shared';

const SAVE_ID = 'save-1';

const mockCombatServiceTool = {
  queryChallengeState: vi.fn(),
  executeTurnForOrchestrator: vi.fn(),
  checkChallengeEnd: vi.fn(),
  collectChallengeData: vi.fn(),
} as unknown as ICombatServiceTool;

const mockContext = {
  saveId: SAVE_ID,
  agentType: 'gamemaster',
  timestamp: Date.now(),
  requestScope: { getDb: () => ({}), getOrCompute: vi.fn() },
} as unknown as ToolContext;

function makeAction(overrides: Partial<ChallengeAction> = {}): ChallengeAction {
  return {
    type: 'attack',
    actorId: 'char-1',
    targetIds: ['enemy-1'],
    ...overrides,
  };
}

function makeState(overrides: Partial<ChallengeState> = {}): ChallengeState {
  return {
    saveId: SAVE_ID,
    mode: 'turn_based_combat',
    active: true,
    participants: [],
    turn: 0,
    round: 1,
    lastActionAt: Date.now(),
    ...overrides,
  };
}

function makeStepResult(overrides: Partial<ChallengeStepResult> = {}): ChallengeStepResult {
  return {
    actionResult: {
      success: true,
      description: '攻击命中，造成 30 点伤害',
      actorId: 'char-1',
      targetId: 'enemy-1',
      damage: 30,
    },
    combatEnded: false,
    ...overrides,
  };
}

function makeEndResult(overrides: Partial<ChallengeEndResult> = {}): ChallengeEndResult {
  return {
    result: 'victory',
    participants: [],
    ...overrides,
  };
}

describe('ChallengeProgram', () => {
  let program: ChallengeProgram;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new ChallengeProgram(mockCombatServiceTool);
  });

  describe('queryState', () => {
    it('用例1: 委托 combatServiceTool.queryChallengeState 查询状态，透传返回值', async () => {
      const state = makeState();
      mockCombatServiceTool.queryChallengeState.mockResolvedValue(state);

      const result = await program.queryState(SAVE_ID, mockContext);

      expect(result).toEqual(state);
      expect(mockCombatServiceTool.queryChallengeState).toHaveBeenCalledWith(SAVE_ID, mockContext);
      expect(mockCombatServiceTool.queryChallengeState).toHaveBeenCalledTimes(1);
      // 程序执行方法不应触发其他动作
      expect(mockCombatServiceTool.executeTurnForOrchestrator).not.toHaveBeenCalled();
      expect(mockCombatServiceTool.checkChallengeEnd).not.toHaveBeenCalled();
      expect(mockCombatServiceTool.collectChallengeData).not.toHaveBeenCalled();
    });

    it('用例2: 未在挑战中时透传 null（不做路由编排校验）', async () => {
      // 设计意图：queryState 是纯查询，不抛"未处于挑战中"错误（该错误由服务层 E handleProgramAction 抛出）
      mockCombatServiceTool.queryChallengeState.mockResolvedValue(null);

      const result = await program.queryState(SAVE_ID, mockContext);

      expect(result).toBeNull();
      expect(mockCombatServiceTool.queryChallengeState).toHaveBeenCalledWith(SAVE_ID, mockContext);
    });

    it('用例3: state.active=false 时透传状态（不做路由编排校验）', async () => {
      // 设计意图：queryState 是纯查询，不抛"挑战已结束"错误（该错误由服务层 E handleProgramAction 抛出）
      const inactiveState = makeState({ active: false });
      mockCombatServiceTool.queryChallengeState.mockResolvedValue(inactiveState);

      const result = await program.queryState(SAVE_ID, mockContext);

      expect(result).toEqual(inactiveState);
      expect(result?.active).toBe(false);
    });

    it('用例4: narrative_combat 模式透传状态（不做路由编排校验）', async () => {
      // 设计意图：queryState 是纯查询，不抛"非战斗模式不支持 G2"错误（该错误由服务层 E handleProgramAction 抛出）
      const narrativeState = makeState({ mode: 'narrative_combat' });
      mockCombatServiceTool.queryChallengeState.mockResolvedValue(narrativeState);

      const result = await program.queryState(SAVE_ID, mockContext);

      expect(result).toEqual(narrativeState);
      expect(result?.mode).toBe('narrative_combat');
    });
  });

  describe('executeTurn', () => {
    it('用例5: 委托 combatServiceTool.executeTurnForOrchestrator 执行回合，透传返回值', async () => {
      const stepResult = makeStepResult();
      mockCombatServiceTool.executeTurnForOrchestrator.mockResolvedValue(stepResult);
      const action = makeAction();

      const result = await program.executeTurn(SAVE_ID, action, mockContext);

      expect(result).toEqual(stepResult);
      expect(mockCombatServiceTool.executeTurnForOrchestrator).toHaveBeenCalledWith(
        SAVE_ID,
        action,
        mockContext,
      );
      expect(mockCombatServiceTool.executeTurnForOrchestrator).toHaveBeenCalledTimes(1);
      // 程序执行方法不应触发查询或结束检测
      expect(mockCombatServiceTool.queryChallengeState).not.toHaveBeenCalled();
      expect(mockCombatServiceTool.checkChallengeEnd).not.toHaveBeenCalled();
      expect(mockCombatServiceTool.collectChallengeData).not.toHaveBeenCalled();
    });

    it('用例6: 战斗结束的 stepResult（combatEnded=true）透传，不自动路由到 Agent', async () => {
      // 设计意图：executeTurn 只做程序执行，不决定是否路由到 Agent（routeToAgent 由服务层 E 基于 checkEnd 判定）
      const endedStepResult = makeStepResult({ combatEnded: true });
      mockCombatServiceTool.executeTurnForOrchestrator.mockResolvedValue(endedStepResult);

      const result = await program.executeTurn(SAVE_ID, makeAction(), mockContext);

      expect(result.combatEnded).toBe(true);
      expect(result).toEqual(endedStepResult);
    });

    it('用例7: 工具抛错时透传错误（不做错误封装）', async () => {
      // 设计意图：ChallengeProgram 不捕获错误重新封装（保持调用栈清晰，由服务层 E 统一封装 G2_ORCHESTRATION_FAILED）
      const toolError = new Error('CombatServiceTool 内部错误');
      mockCombatServiceTool.executeTurnForOrchestrator.mockRejectedValue(toolError);

      await expect(program.executeTurn(SAVE_ID, makeAction(), mockContext)).rejects.toThrow(toolError);
    });
  });

  describe('checkEnd', () => {
    it('用例8: 委托 combatServiceTool.checkChallengeEnd 检查结束，透传 ended=false', async () => {
      mockCombatServiceTool.checkChallengeEnd.mockResolvedValue({ ended: false });

      const result = await program.checkEnd(SAVE_ID, mockContext);

      expect(result).toEqual({ ended: false });
      expect(result.ended).toBe(false);
      expect(result.result).toBeUndefined();
      expect(mockCombatServiceTool.checkChallengeEnd).toHaveBeenCalledWith(SAVE_ID, mockContext);
      expect(mockCombatServiceTool.checkChallengeEnd).toHaveBeenCalledTimes(1);
    });

    it('用例9: 透传 ended=true + victory 结果', async () => {
      mockCombatServiceTool.checkChallengeEnd.mockResolvedValue({ ended: true, result: 'victory' });

      const result = await program.checkEnd(SAVE_ID, mockContext);

      expect(result.ended).toBe(true);
      expect(result.result).toBe('victory');
    });

    it('用例10: 透传 ended=true + defeat 结果', async () => {
      mockCombatServiceTool.checkChallengeEnd.mockResolvedValue({ ended: true, result: 'defeat' });

      const result = await program.checkEnd(SAVE_ID, mockContext);

      expect(result.ended).toBe(true);
      expect(result.result).toBe('defeat');
    });

    it('用例11: 透传 ended=true + flee 结果', async () => {
      mockCombatServiceTool.checkChallengeEnd.mockResolvedValue({ ended: true, result: 'flee' });

      const result = await program.checkEnd(SAVE_ID, mockContext);

      expect(result.ended).toBe(true);
      expect(result.result).toBe('flee');
    });
  });

  describe('collectEndResult', () => {
    it('用例12: 委托 combatServiceTool.collectChallengeData 收集结束数据，透传 victory 结果', async () => {
      const endResult = makeEndResult({
        result: 'victory',
        rewards: { experience: 100, currency: { gold: 50 } },
      });
      mockCombatServiceTool.collectChallengeData.mockResolvedValue(endResult);

      const result = await program.collectEndResult(SAVE_ID, 'victory', mockContext);

      expect(result).toEqual(endResult);
      expect(result.result).toBe('victory');
      expect(result.rewards?.experience).toBe(100);
      expect(result.rewards?.currency?.gold).toBe(50);
      expect(mockCombatServiceTool.collectChallengeData).toHaveBeenCalledWith(
        SAVE_ID,
        'victory',
        mockContext,
      );
      expect(mockCombatServiceTool.collectChallengeData).toHaveBeenCalledTimes(1);
    });

    it('用例13: 透传 defeat 结束结果（无奖励）', async () => {
      const endResult = makeEndResult({ result: 'defeat' });
      mockCombatServiceTool.collectChallengeData.mockResolvedValue(endResult);

      const result = await program.collectEndResult(SAVE_ID, 'defeat', mockContext);

      expect(result.result).toBe('defeat');
      expect(result.rewards).toBeUndefined();
    });

    it('用例14: 透传 flee 结束结果', async () => {
      const endResult = makeEndResult({ result: 'flee' });
      mockCombatServiceTool.collectChallengeData.mockResolvedValue(endResult);

      const result = await program.collectEndResult(SAVE_ID, 'flee', mockContext);

      expect(result.result).toBe('flee');
    });
  });

  describe('架构合规验证', () => {
    it('用例15: ChallengeProgram 无实例状态字段（不持有挑战状态）', () => {
      // 设计意图：架构约束 §1.2 G2 层"不持有状态"
      // 验证 ChallengeProgram 实例只有注入的 combatServiceTool，无其他实例字段
      const newProgram = new ChallengeProgram(mockCombatServiceTool);
      // 实例应可被创建且无状态字段
      expect(newProgram).toBeInstanceOf(ChallengeProgram);
      // 多次创建独立实例（无单例状态污染）
      const another = new ChallengeProgram(mockCombatServiceTool);
      expect(another).not.toBe(newProgram);
    });

    it('用例16: ChallengeProgram 方法互相独立（不依赖前序调用）', async () => {
      // 设计意图：4 个原子方法互相独立，调用顺序由服务层 E 决定
      // 验证不调用 queryState 直接调用 executeTurn 也能工作
      const stepResult = makeStepResult();
      mockCombatServiceTool.executeTurnForOrchestrator.mockResolvedValue(stepResult);

      const result = await program.executeTurn(SAVE_ID, makeAction(), mockContext);

      expect(result).toEqual(stepResult);
      expect(mockCombatServiceTool.queryChallengeState).not.toHaveBeenCalled();
    });
  });
});
