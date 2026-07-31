/**
 * handleProgramAction 集成测试
 *
 * 设计意图（fractal-design-20260724-g2-program-execution-layer §5.1）:
 * - 验证从 ChallengeOrchestrator 迁移到服务层 E handleProgramAction 的路由编排逻辑
 * - 验证状态校验（state null / state.active=false / NON_COMBAT_MODES）
 * - 验证路由决策（ended=true → handleChallengeEnd / ended=false → formatOrchestratorResult）
 * - 验证错误封装（G2_ORCHESTRATION_FAILED / INVALID_CHALLENGE_ACTION）
 *
 * 测试方式：mock AgentRuntime + IChallengeProgram + StagingKnex + RequestScope，
 * 验证 handleProgramAction 的编排逻辑（不调用真实 Agent / 不调 LLM）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock createStagingKnex 返回原始 db（测试不验证 StagingKnex 代理行为，由独立测试覆盖）
vi.mock('@ai-rpg/shared/tool-core', () => ({
  createStagingKnex: vi.fn((db: unknown) => db),
}));

// Mock RequestScope 简化为持有 db 的对象
vi.mock('../RequestScope.js', () => ({
  RequestScope: class {
    constructor(private db: unknown) {}
    getDb() { return this.db; }
    async getOrCompute<T>(key: string, factory: () => Promise<T>): Promise<T> {
      return factory();
    }
  },
}));

// Mock logger 避免输出日志
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock config 避免 readFileSync 调用
vi.mock('../../utils/config.js', () => ({
  config: {
    timeout: { chat: 30000 },
  },
}));

import { processChat, type ChatDeps } from '../game-service.js';
import type { IChallengeProgram } from '../../programs/types.js';
import type { IModeRouter } from '../../game-systems/shared/mode-router/types.js';
import type {
  ChallengeAction,
  ChallengeState,
  ChallengeStepResult,
  ChallengeEndResult,
} from '@ai-rpg/shared';
import type { AgentRuntime } from '../../agents/AgentRuntime.js';
import type { GameServiceDeps } from '../game-service.js';

const SAVE_ID = 'save-1';

// 创建 mock IChallengeProgram
function makeMockChallengeProgram() {
  return {
    queryState: vi.fn(),
    executeTurn: vi.fn(),
    checkEnd: vi.fn(),
    collectEndResult: vi.fn(),
  } as unknown as IChallengeProgram;
}

// 创建 mock AgentRuntime（仅 mock handleProgramAction 使用的方法）
function makeMockAgentRuntime() {
  const mockStagingPool = { hasWrites: () => false, flush: vi.fn(), writeCount: 0, clear: vi.fn() };
  const mockShadowState = { ensureSnapshot: vi.fn() };
  const mockScoped = {
    applyRequestScope: vi.fn(),
    processMessage: vi.fn(),
  };
  return {
    createRequestRuntime: vi.fn().mockResolvedValue({
      stagingPool: mockStagingPool,
      shadowState: mockShadowState,
    }),
    createRequestScopedCopy: vi.fn().mockReturnValue(mockScoped),
    flushRequestRuntime: vi.fn().mockResolvedValue(undefined),
    // 供其他可能调用的方法使用
    _mockScoped: mockScoped,
    _mockStagingPool: mockStagingPool,
  } as unknown as AgentRuntime & {
    _mockScoped: { applyRequestScope: ReturnType<typeof vi.fn>; processMessage: ReturnType<typeof vi.fn> };
    _mockStagingPool: { hasWrites: () => false; flush: ReturnType<typeof vi.fn>; writeCount: number; clear: ReturnType<typeof vi.fn> };
  };
}

// 创建基础 ChatDeps（含最小必需字段）
function makeChatDeps(overrides: Partial<ChatDeps> = {}): ChatDeps {
  const challengeProgram = makeMockChallengeProgram();
  const modeRouter = { routeMode: vi.fn() } as unknown as IModeRouter;
  const coordinatorAgent = makeMockAgentRuntime();

  const baseDeps = {
    coordinatorAgent,
    db: {} as never,
    challengeProgram,
    modeRouter,
  } as unknown as ChatDeps;

  // 填充 GameServiceDeps 必需字段为最小 mock
  // saveService.getSave 返回有效 saveRecord 让 processChat 通过前置校验进入 handleProgramAction
  const gameServiceDeps = {
    characterService: {},
    locationRepo: {},
    saveService: { getSave: vi.fn().mockResolvedValue({ id: SAVE_ID }) },
    skillService: {},
    rollbackRepos: {},
    txManager: {},
    entityGraphBuilder: {},
    entityGraphBuildContext: {},
  } as unknown as GameServiceDeps;

  return { ...baseDeps, ...gameServiceDeps, ...overrides } as ChatDeps;
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

function makeAction(): ChallengeAction {
  return {
    type: 'attack',
    actorId: 'char-1',
    targetIds: ['enemy-1'],
  };
}

function makeStepResult(overrides: Partial<ChallengeStepResult> = {}): ChallengeStepResult {
  return {
    actionResult: {
      success: true,
      description: '攻击命中',
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

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    message: 'attack',
    saveId: SAVE_ID,
    action: 'combat-program',
    data: { challengeAction: makeAction() },
    requestId: 'req-1',
    ...overrides,
  };
}

describe('handleProgramAction 路由编排（从 ChallengeOrchestrator 迁移）', () => {
  let deps: ChatDeps;
  let challengeProgram: IChallengeProgram;
  let coordinatorAgent: ReturnType<typeof makeMockAgentRuntime>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeChatDeps();
    challengeProgram = deps.challengeProgram;
    coordinatorAgent = deps.coordinatorAgent as unknown as ReturnType<typeof makeMockAgentRuntime>;
  });

  it('用例1: state=null 时返回 G2_STATE_QUERY_FAILED，错误信息"未处于挑战中"', async () => {
    // 设计意图：路由编排职责——状态校验（从 ChallengeOrchestrator.executeStep 迁移）
    // 2026-07-25 B4 修复: 错误码细分，state_query 阶段失败 → G2_STATE_QUERY_FAILED
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(null);

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('G2_STATE_QUERY_FAILED');
    expect(result.error).toContain('未处于挑战中');
    // 未执行程序执行方法
    expect(challengeProgram.executeTurn).not.toHaveBeenCalled();
    expect(challengeProgram.checkEnd).not.toHaveBeenCalled();
    expect(challengeProgram.collectEndResult).not.toHaveBeenCalled();
    // 失败路径不 flush
    expect(coordinatorAgent.flushRequestRuntime).not.toHaveBeenCalled();
  });

  it('用例2: state.active=false 时返回 G2_STATE_QUERY_FAILED，错误信息"挑战已结束"', async () => {
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState({ active: false }));

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('G2_STATE_QUERY_FAILED');
    expect(result.error).toContain('挑战已结束');
    expect(challengeProgram.executeTurn).not.toHaveBeenCalled();
  });

  it('用例3: narrative_combat 模式时返回 G2_STATE_QUERY_FAILED，错误信息"不支持 G2 快速路径"', async () => {
    // 设计意图：NON_COMBAT_MODES 拦截从 ChallengeOrchestrator 迁移到 handleProgramAction
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(
      makeState({ mode: 'narrative_combat' }),
    );

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('G2_STATE_QUERY_FAILED');
    expect(result.error).toContain('narrative_combat');
    expect(result.error).toContain('不支持 G2 快速路径');
    expect(challengeProgram.executeTurn).not.toHaveBeenCalled();
  });

  it('用例4: puzzle 模式时返回 G2_STATE_QUERY_FAILED', async () => {
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState({ mode: 'puzzle' }));

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('G2_STATE_QUERY_FAILED');
    expect(result.error).toContain('puzzle');
  });

  it('用例5: mini_game 模式时返回 G2_STATE_QUERY_FAILED', async () => {
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState({ mode: 'mini_game' }));

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('G2_STATE_QUERY_FAILED');
    expect(result.error).toContain('mini_game');
  });

  it('用例6: stealth 模式时返回 G2_STATE_QUERY_FAILED', async () => {
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState({ mode: 'stealth' }));

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('G2_STATE_QUERY_FAILED');
    expect(result.error).toContain('stealth');
  });

  it('用例7: challengeAction 缺失时返回 INVALID_CHALLENGE_ACTION', async () => {
    // 设计意图：解析 ChallengeAction 失败时不调用任何 ChallengeProgram 方法
    const result = await processChat(
      deps,
      makeParams({ data: {} }), // 无 challengeAction
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_CHALLENGE_ACTION');
    expect(challengeProgram.queryState).not.toHaveBeenCalled();
  });

  it('用例8: 正常未结束流程 → 调用 4 个原子方法 + flush + 返回 routeToAgent=false', async () => {
    // 设计意图：路由编排组合 ChallengeProgram 的 4 个方法
    const state = makeState();
    const stepResult = makeStepResult();
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(state);
    vi.spyOn(challengeProgram, 'executeTurn').mockResolvedValue(stepResult);
    vi.spyOn(challengeProgram, 'checkEnd').mockResolvedValue({ ended: false });

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(true);
    expect(result.metadata?.routeToAgent).toBe(false);
    expect(result.metadata?.challengeEnded).toBeUndefined();
    // 4 个原子方法按序调用
    expect(challengeProgram.queryState).toHaveBeenCalledTimes(1);
    expect(challengeProgram.executeTurn).toHaveBeenCalledTimes(1);
    expect(challengeProgram.checkEnd).toHaveBeenCalledTimes(1);
    expect(challengeProgram.collectEndResult).not.toHaveBeenCalled(); // 未结束不收集
    // 未结束路径显式 flush
    expect(coordinatorAgent.flushRequestRuntime).toHaveBeenCalledTimes(1);
  });

  it('用例9: dynamic_combat 模式正常执行（不在 NON_COMBAT_MODES）', async () => {
    // 设计意图：dynamic_combat 是战斗模式，支持 G2 快速路径
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState({ mode: 'dynamic_combat' }));
    vi.spyOn(challengeProgram, 'executeTurn').mockResolvedValue(makeStepResult());
    vi.spyOn(challengeProgram, 'checkEnd').mockResolvedValue({ ended: false });

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(true);
    expect(result.metadata?.routeToAgent).toBe(false);
  });

  it('用例10: 战斗结束（victory）→ 调用 collectEndResult + handleChallengeEnd（routeToAgent=true）', async () => {
    // 设计意图：ended=true 时收集数据并切换到 Agent 路径（不显式 flush，由 processMessage 内部 flush）
    const state = makeState();
    const stepResult = makeStepResult();
    const endResult = makeEndResult({
      result: 'victory',
      rewards: { experience: 100, currency: { gold: 50 } },
    });
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(state);
    vi.spyOn(challengeProgram, 'executeTurn').mockResolvedValue(stepResult);
    vi.spyOn(challengeProgram, 'checkEnd').mockResolvedValue({ ended: true, result: 'victory' });
    vi.spyOn(challengeProgram, 'collectEndResult').mockResolvedValue(endResult);

    // mock scopedCoordinator.processMessage 返回成功响应
    coordinatorAgent._mockScoped.processMessage.mockResolvedValue({
      success: true,
      data: { narrative: '战斗胜利！' },
    });

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(true);
    expect(result.metadata?.challengeEnded).toBe(true);
    expect(result.metadata?.challengeResult).toBe('victory');
    // 调用 collectEndResult 收集数据
    expect(challengeProgram.collectEndResult).toHaveBeenCalledWith(
      SAVE_ID,
      'victory',
      expect.anything(),
    );
    // 调用 processMessage 切换到 Agent 路径
    expect(coordinatorAgent._mockScoped.processMessage).toHaveBeenCalledTimes(1);
    // 结束路径不显式 flush（由 processMessage 内部 flush）
    expect(coordinatorAgent.flushRequestRuntime).not.toHaveBeenCalled();
  });

  it('用例11: 战斗结束（defeat）→ 调用 collectEndResult + handleChallengeEnd', async () => {
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState());
    vi.spyOn(challengeProgram, 'executeTurn').mockResolvedValue(makeStepResult());
    vi.spyOn(challengeProgram, 'checkEnd').mockResolvedValue({ ended: true, result: 'defeat' });
    vi.spyOn(challengeProgram, 'collectEndResult').mockResolvedValue(
      makeEndResult({ result: 'defeat' }),
    );

    coordinatorAgent._mockScoped.processMessage.mockResolvedValue({
      success: true,
      data: { narrative: '战斗失败...' },
    });

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(true);
    expect(result.metadata?.challengeResult).toBe('defeat');
    expect(challengeProgram.collectEndResult).toHaveBeenCalledWith(
      SAVE_ID,
      'defeat',
      expect.anything(),
    );
  });

  it('用例12: challengeProgram.executeTurn 抛错 → 透传封装为 G2_EXECUTE_FAILED，不 flush', async () => {
    // 设计意图：失败路径不 flush，避免脏数据落盘
    // 2026-07-25 B4 修复: 错误码细分，execute 阶段失败 → G2_EXECUTE_FAILED
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState());
    vi.spyOn(challengeProgram, 'executeTurn').mockRejectedValue(new Error('CombatServiceTool 内部错误'));

    const result = await processChat(deps, makeParams());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('G2_EXECUTE_FAILED');
    expect(result.error).toContain('CombatServiceTool 内部错误');
    expect(coordinatorAgent.flushRequestRuntime).not.toHaveBeenCalled();
  });

  it('用例13: 从 playerAction 解析 ChallengeAction（回退路径）', async () => {
    // 设计意图：parseChallengeAction 优先 data.challengeAction，回退到 playerAction
    vi.spyOn(challengeProgram, 'queryState').mockResolvedValue(makeState());
    vi.spyOn(challengeProgram, 'executeTurn').mockResolvedValue(makeStepResult());
    vi.spyOn(challengeProgram, 'checkEnd').mockResolvedValue({ ended: false });

    const result = await processChat(
      deps,
      makeParams({
        data: {}, // 无显式 challengeAction
        playerAction: makeAction(), // 回退到 playerAction
      }),
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.routeToAgent).toBe(false);
    expect(challengeProgram.executeTurn).toHaveBeenCalledWith(
      SAVE_ID,
      expect.objectContaining({ type: 'attack', actorId: 'char-1' }),
      expect.anything(),
    );
  });
});
