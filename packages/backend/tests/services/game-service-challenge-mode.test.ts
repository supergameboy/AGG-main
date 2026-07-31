/**
 * game-service processChat - challengeMode 输出验证测试
 *
 * 验证三条路径下 ServiceResult.metadata.challengeMode 是否正确输出：
 *
 * 路径1: 常规 Agent 路径 (action='chat')
 *   - 期望: metadata.challengeMode = saveRecord.active_challenge_mode ?? null
 *   - 覆盖 turn_based_combat / null / undefined 三种输入
 *
 * 路径2: G2 未结束路径 (action='combat-program')
 *   - 期望: metadata.challengeMode = state.mode（ChallengeState.mode）
 *   - 验证 routeToAgent=false（G2 路径直接返回数值结果，不切 Agent）
 *
 * 路径3: G2 结束路径 (action='combat-program' + ended=true)
 *   - 期望: metadata.challengeMode = state.mode
 *   - 验证 challengeEnded=true + challengeResult=ChallengeEndResult.result
 *   - 验证路由到 Agent 路径处理挑战结束剧情
 *
 * 设计理由：
 * - 阶段五（配置文件 + 前端模式感知）新增前端 combatStore.challengeMode 字段
 * - 前端通过 processChat 响应的 metadata.challengeMode 感知当前挑战模式
 * - 三条路径都必须输出 challengeMode（无遗漏）
 * - 不依赖 setup.ts 全局 app/db，使用 vi.hoisted mock 所有外部依赖
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processChat, type ChatDeps, type ChatParams, type ServiceResult } from '../../src/services/game-service.js';
import type { IChallengeProgram } from '../../src/programs/types.js';
import type { ChallengeEndCheck } from '../../src/programs/types.js';
import type { IModeRouter } from '../../src/game-systems/shared/mode-router/types.js';
import type { ISaveProvider, SaveRecord } from '../../src/game-systems/save/types.js';
import type { CharacterService } from '../../src/game-systems/character/CharacterService.js';
import type { ISkillService } from '../../src/game-systems/skill/types.js';
import type {
  ILocationRepository,
  ILocationConnectionRepository,
} from '../../src/game-systems/map/types.js';
import type { ICombatHistoryRepository, ICombatRepository } from '../../src/game-systems/combat/types.js';
import type { IDialogueRepository } from '../../src/game-systems/dialogue/types.js';
import type { ICharacterSkillRepository } from '../../src/game-systems/skill/types.js';
import type { IQuestRepository } from '../../src/game-systems/quest/types.js';
import type { INPCRepository } from '../../src/game-systems/npc/types.js';
import type { IInventoryRepository } from '../../src/game-systems/inventory/types.js';
import type {
  IEntityGraphRepository,
  EntityGraphBuildContext,
} from '../../src/game-systems/entity-graph/types.js';
import type { EntityGraphBuilder } from '../../src/game-systems/entity-graph/EntityGraphBuilder.js';
import type { ICharacterRepository } from '../../src/game-systems/character/types.js';
import type { ISaveRepository } from '../../src/game-systems/save/types.js';
import type { ITransactionManager } from '../../src/database/TransactionManager.js';
import type { AgentRuntime } from '../../src/agents/AgentRuntime.js';
import type { Knex } from 'knex';
import type {
  ChallengeState,
  ChallengeEndResult,
  ChallengeStepResult,
  ChallengeMode,
  ID,
} from '@ai-rpg/shared';
import type { IStagingPool, IShadowStateLayer } from '@ai-rpg/shared/tool-core';

// ============================================================================
// Mock 工厂
// ============================================================================

/** 创建完整 SaveRecord（覆盖测试所需字段，其余使用默认值） */
function makeSaveRecord(overrides: Partial<SaveRecord> = {}): SaveRecord {
  return {
    id: 'save-1' as ID,
    name: '测试存档',
    type: 'free',
    template_id: 'tpl-1' as ID,
    game_mode: 'text_adventure',
    chapter: '第一章',
    location: '起始村庄',
    level: 1,
    main_quest: '主线任务',
    play_time: 0,
    thumbnail: '',
    language: 'zh-CN',
    created_at: 0,
    updated_at: 0,
    active_challenge_mode: null,
    ...overrides,
  };
}

/** 创建 mock StagingPool（仅实现 processChat 路径用到的方法） */
function makeMockStagingPool(): IStagingPool & { stage: ReturnType<typeof vi.fn> } {
  return {
    stage: vi.fn().mockResolvedValue(undefined),
    writeCount: 0,
    rollbackFrom: vi.fn().mockReturnValue(0),
    getAllWrites: vi.fn().mockReturnValue([]),
    createProxyDb: vi.fn().mockReturnValue({} as Knex),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

/** 创建 mock ShadowStateLayer（read/readOne 均返回 undefined 表示未命中） */
function makeMockShadowState(): IShadowStateLayer {
  return {
    read: vi.fn().mockReturnValue(undefined),
    readOne: vi.fn().mockReturnValue(undefined),
  };
}

/** 创建 mock AgentRuntime（仅实现 processChat 路径用到的方法） */
function makeMockAgentRuntime(): AgentRuntime & {
  processMessage: ReturnType<typeof vi.fn>;
  createRequestScopedCopy: ReturnType<typeof vi.fn>;
  applyRequestScope: ReturnType<typeof vi.fn>;
  createRequestRuntime: ReturnType<typeof vi.fn>;
  flushRequestRuntime: ReturnType<typeof vi.fn>;
} {
  const stagingPool = makeMockStagingPool();
  const shadowState = makeMockShadowState();
  const scopedCopy = {
    applyRequestScope: vi.fn(),
    processMessage: vi.fn().mockResolvedValue({
      success: true,
      data: { dialogue: { messages: [] } },
    }),
  };
  return {
    processMessage: scopedCopy.processMessage,
    createRequestScopedCopy: vi.fn().mockReturnValue(scopedCopy),
    applyRequestScope: scopedCopy.applyRequestScope,
    createRequestRuntime: vi.fn().mockResolvedValue({ stagingPool, shadowState }),
    flushRequestRuntime: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentRuntime & {
    processMessage: ReturnType<typeof vi.fn>;
    createRequestScopedCopy: ReturnType<typeof vi.fn>;
    applyRequestScope: ReturnType<typeof vi.fn>;
    createRequestRuntime: ReturnType<typeof vi.fn>;
    flushRequestRuntime: ReturnType<typeof vi.fn>;
  };
}

/** 创建 mock ChallengeProgram（仅实现 4 个原子方法） */
function makeMockChallengeProgram(overrides: {
  state?: ChallengeState | null;
  stepResult?: ChallengeStepResult;
  endCheck?: ChallengeEndCheck;
  endResult?: ChallengeEndResult;
}): IChallengeProgram & {
  queryState: ReturnType<typeof vi.fn>;
  executeTurn: ReturnType<typeof vi.fn>;
  checkEnd: ReturnType<typeof vi.fn>;
  collectEndResult: ReturnType<typeof vi.fn>;
} {
  const defaultState: ChallengeState = {
    saveId: 'save-1' as ID,
    mode: 'turn_based_combat',
    active: true,
    participants: [],
    turn: 0,
    round: 1,
    lastActionAt: 0,
  };
  return {
    queryState: vi.fn().mockResolvedValue(overrides.state ?? defaultState),
    executeTurn: vi.fn().mockResolvedValue(
      overrides.stepResult ?? {
        actionResult: { success: true, description: 'attack', actorId: 'char-1' as ID },
        sideEffects: [],
        combatEnded: false,
      },
    ),
    checkEnd: vi.fn().mockResolvedValue(
      overrides.endCheck ?? { ended: false },
    ),
    collectEndResult: vi.fn().mockResolvedValue(
      overrides.endResult ?? {
        result: 'victory',
        participants: [],
        rewards: { experience: 100 },
      },
    ),
  } as unknown as IChallengeProgram & {
    queryState: ReturnType<typeof vi.fn>;
    executeTurn: ReturnType<typeof vi.fn>;
    checkEnd: ReturnType<typeof vi.fn>;
    collectEndResult: ReturnType<typeof vi.fn>;
  };
}

/** 创建 mock ChatDeps（仅填充 processChat 路径实际使用的字段，其余给最小化 stub） */
function makeMockDeps(overrides: {
  saveRecord?: SaveRecord | null;
  challengeProgram?: IChallengeProgram & {
    queryState: ReturnType<typeof vi.fn>;
    executeTurn: ReturnType<typeof vi.fn>;
    checkEnd: ReturnType<typeof vi.fn>;
    collectEndResult: ReturnType<typeof vi.fn>;
  };
  coordinatorAgent?: AgentRuntime & {
    processMessage: ReturnType<typeof vi.fn>;
    createRequestScopedCopy: ReturnType<typeof vi.fn>;
    applyRequestScope: ReturnType<typeof vi.fn>;
    createRequestRuntime: ReturnType<typeof vi.fn>;
    flushRequestRuntime: ReturnType<typeof vi.fn>;
  };
  modeRouter?: IModeRouter;
}): ChatDeps {
  // 注意: 用 !== undefined 而非 ?? ，否则 saveRecord=null 会回退到默认值
  const saveRecord = overrides.saveRecord === undefined ? makeSaveRecord() : overrides.saveRecord;
  const saveService = {
    getSave: vi.fn().mockResolvedValue(saveRecord),
  } as unknown as ISaveProvider;

  const characterService = {
    getCharacter: vi.fn().mockResolvedValue({
      id: 'char-1',
      name: '测试角色',
      currentLocationId: 'loc-1',
    }),
  } as unknown as CharacterService;

  const skillService = {
    validateUsage: vi.fn().mockResolvedValue(null),
  } as unknown as ISkillService;

  const modeRouter = overrides.modeRouter ?? {
    routeMode: vi.fn().mockResolvedValue({
      gameMode: 'text_adventure' as ChallengeMode extends never ? never : string,
      challengeMode: null,
      candidateAgentTypes: ['gamemaster'],
      reason: 'mock',
    }),
  } as IModeRouter;

  // RollbackRepos + 其他必填字段给最小 stub（processChat 不会用到）
  const stubRepo = {} as unknown;
  return {
    coordinatorAgent: overrides.coordinatorAgent ?? makeMockAgentRuntime(),
    characterService,
    saveService,
    skillService,
    modeRouter,
    challengeProgram: overrides.challengeProgram ?? makeMockChallengeProgram({}),
    locationRepo: stubRepo as ILocationRepository,
    rollbackRepos: {
      combatHistoryRepo: stubRepo as ICombatHistoryRepository,
      combatStateRepo: stubRepo as ICombatRepository,
      dialogueRepo: stubRepo as IDialogueRepository,
      characterSkillRepo: stubRepo as ICharacterSkillRepository,
      questRepo: stubRepo as IQuestRepository,
      npcRepo: stubRepo as INPCRepository,
      inventoryRepo: stubRepo as IInventoryRepository,
      locationConnectionRepo: stubRepo as ILocationConnectionRepository,
      locationRepo: stubRepo as ILocationRepository,
      entityGraphRepo: stubRepo as IEntityGraphRepository,
      characterRepo: stubRepo as ICharacterRepository,
      saveRepo: stubRepo as ISaveRepository,
    },
    txManager: stubRepo as ITransactionManager,
    entityGraphBuilder: stubRepo as EntityGraphBuilder,
    entityGraphBuildContext: stubRepo as EntityGraphBuildContext,
    db: {} as Knex,
  } as ChatDeps;
}

/** 创建 ChatParams（默认 action='chat'） */
function makeChatParams(overrides: Partial<ChatParams> = {}): ChatParams {
  return {
    message: '测试消息',
    saveId: 'save-1',
    action: 'chat',
    ...overrides,
  };
}

// ============================================================================
// 测试用例
// ============================================================================

describe('processChat - challengeMode 输出验证（阶段五前端模式感知）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('路径1: 常规 Agent 路径 (action=chat)', () => {
    it("active_challenge_mode='turn_based_combat' → metadata.challengeMode='turn_based_combat'", async () => {
      const deps = makeMockDeps({
        saveRecord: makeSaveRecord({ active_challenge_mode: 'turn_based_combat' }),
      });
      const params = makeChatParams({ action: 'chat' });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(result.metadata?.challengeMode).toBe('turn_based_combat');
    });

    it('active_challenge_mode=null → metadata.challengeMode=null', async () => {
      const deps = makeMockDeps({
        saveRecord: makeSaveRecord({ active_challenge_mode: null }),
      });
      const params = makeChatParams({ action: 'chat' });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(result.metadata?.challengeMode).toBeNull();
    });

    it('active_challenge_mode=undefined → metadata.challengeMode=null（nullish coalescing 兜底）', async () => {
      const saveRecord = makeSaveRecord();
      delete saveRecord.active_challenge_mode;
      const deps = makeMockDeps({ saveRecord });
      const params = makeChatParams({ action: 'chat' });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(result.metadata?.challengeMode).toBeNull();
    });
  });

  describe('路径2: G2 未结束路径 (action=combat-program)', () => {
    it("state.mode='turn_based_combat' + checkEnd.ended=false → metadata.challengeMode='turn_based_combat', routeToAgent=false", async () => {
      const challengeProgram = makeMockChallengeProgram({
        state: {
          saveId: 'save-1' as ID,
          mode: 'turn_based_combat',
          active: true,
          participants: [],
          turn: 0,
          round: 1,
          lastActionAt: 0,
        },
        endCheck: { ended: false },
      });
      const deps = makeMockDeps({ challengeProgram });
      const params = makeChatParams({
        action: 'combat-program',
        data: {
          challengeAction: { type: 'attack', actorId: 'char-1' as ID },
        },
      });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(result.metadata?.challengeMode).toBe('turn_based_combat');
      expect(result.metadata?.routeToAgent).toBe(false);
      // 未结束路径不应设置 challengeEnded
      expect(result.metadata?.challengeEnded).toBeUndefined();
      // 验证 G2 路径调用了 4 个原子方法
      expect(challengeProgram.queryState).toHaveBeenCalledTimes(1);
      expect(challengeProgram.executeTurn).toHaveBeenCalledTimes(1);
      expect(challengeProgram.checkEnd).toHaveBeenCalledTimes(1);
      expect(challengeProgram.collectEndResult).not.toHaveBeenCalled();
    });

    it("state.mode='dynamic_combat' + checkEnd.ended=false → metadata.challengeMode='dynamic_combat'", async () => {
      const challengeProgram = makeMockChallengeProgram({
        state: {
          saveId: 'save-1' as ID,
          mode: 'dynamic_combat',
          active: true,
          participants: [],
          turn: 0,
          round: 1,
          lastActionAt: 0,
        },
        endCheck: { ended: false },
      });
      const deps = makeMockDeps({ challengeProgram });
      const params = makeChatParams({
        action: 'combat-program',
        data: {
          challengeAction: { type: 'attack', actorId: 'char-1' as ID },
        },
      });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(result.metadata?.challengeMode).toBe('dynamic_combat');
      expect(result.metadata?.routeToAgent).toBe(false);
    });
  });

  describe('路径3: G2 结束路径 (action=combat-program + ended=true)', () => {
    it("checkEnd.ended=true, result='victory' → metadata.challengeMode='turn_based_combat', challengeEnded=true, challengeResult='victory'", async () => {
      const challengeProgram = makeMockChallengeProgram({
        state: {
          saveId: 'save-1' as ID,
          mode: 'turn_based_combat',
          active: true,
          participants: [],
          turn: 0,
          round: 1,
          lastActionAt: 0,
        },
        endCheck: { ended: true, result: 'victory' },
        endResult: {
          result: 'victory',
          participants: [],
          rewards: { experience: 100 },
        },
      });
      const coordinatorAgent = makeMockAgentRuntime();
      // handleChallengeEnd 调用 scopedCoordinator.processMessage → 返回成功响应
      coordinatorAgent.processMessage.mockResolvedValue({
        success: true,
        data: { dialogue: { messages: [{ speaker: 'GM', content: '战斗胜利' }] } },
      });
      const deps = makeMockDeps({ challengeProgram, coordinatorAgent });
      const params = makeChatParams({
        action: 'combat-program',
        data: {
          challengeAction: { type: 'attack', actorId: 'char-1' as ID },
        },
      });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(result.metadata?.challengeMode).toBe('turn_based_combat');
      expect(result.metadata?.challengeEnded).toBe(true);
      expect(result.metadata?.challengeResult).toBe('victory');
      // 验证 G2 结束路径调用了 collectEndResult
      expect(challengeProgram.collectEndResult).toHaveBeenCalledTimes(1);
      // 验证路由到 Agent 路径处理结束剧情
      expect(coordinatorAgent.createRequestScopedCopy).toHaveBeenCalledTimes(1);
      expect(coordinatorAgent.processMessage).toHaveBeenCalledTimes(1);
    });

    it("checkEnd.ended=true, result='defeat' → metadata.challengeMode='dynamic_combat', challengeResult='defeat'", async () => {
      const challengeProgram = makeMockChallengeProgram({
        state: {
          saveId: 'save-1' as ID,
          mode: 'dynamic_combat',
          active: true,
          participants: [],
          turn: 0,
          round: 1,
          lastActionAt: 0,
        },
        endCheck: { ended: true, result: 'defeat' },
        endResult: {
          result: 'defeat',
          participants: [],
        },
      });
      const coordinatorAgent = makeMockAgentRuntime();
      coordinatorAgent.processMessage.mockResolvedValue({
        success: true,
        data: { dialogue: { messages: [{ speaker: 'GM', content: '战斗失败' }] } },
      });
      const deps = makeMockDeps({ challengeProgram, coordinatorAgent });
      const params = makeChatParams({
        action: 'combat-program',
        data: {
          challengeAction: { type: 'attack', actorId: 'char-1' as ID },
        },
      });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(result.metadata?.challengeMode).toBe('dynamic_combat');
      expect(result.metadata?.challengeEnded).toBe(true);
      expect(result.metadata?.challengeResult).toBe('defeat');
    });
  });

  describe('边界场景', () => {
    it("action='chat' 但 ModeRouter 兜底返回战斗模式 → 切换 G2 路径，metadata.challengeMode 来自 state.mode", async () => {
      // 验证 ModeRouter 兜底判定为战斗模式时，会切换到 G2 路径
      // 触发条件: action 不是 chat/-LLM/-program 后缀（如 action='combat'）
      const challengeProgram = makeMockChallengeProgram({
        state: {
          saveId: 'save-1' as ID,
          mode: 'turn_based_combat',
          active: true,
          participants: [],
          turn: 0,
          round: 1,
          lastActionAt: 0,
        },
        endCheck: { ended: false },
      });
      const modeRouter = {
        routeMode: vi.fn().mockResolvedValue({
          gameMode: 'text_rpg' as unknown as ChallengeMode,
          challengeMode: 'turn_based_combat' as ChallengeMode,
          candidateAgentTypes: ['challenge', 'gamemaster'],
          reason: 'mock',
        }),
      } as unknown as IModeRouter;
      const deps = makeMockDeps({ challengeProgram, modeRouter });
      // 注意: action='combat'（非 chat 非 -LLM 非 -program）才会触发 ModeRouter 兜底
      // 必须传 data.challengeAction，否则 handleProgramAction 会返回 INVALID_CHALLENGE_ACTION
      const params = makeChatParams({
        action: 'combat',
        data: {
          challengeAction: { type: 'attack', actorId: 'char-1' as ID },
        },
      });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(true);
      expect(modeRouter.routeMode).toHaveBeenCalledTimes(1);
      // 切换到 G2 路径，metadata.challengeMode 来自 state.mode
      expect(result.metadata?.challengeMode).toBe('turn_based_combat');
      expect(result.metadata?.routeToAgent).toBe(false);
    });

    it('saveRecord 不存在 → 返回 SAVE_NOT_FOUND 错误，不输出 challengeMode', async () => {
      const deps = makeMockDeps({ saveRecord: null });
      const params = makeChatParams({ action: 'chat' });

      const result: ServiceResult = await processChat(deps, params);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SAVE_NOT_FOUND');
      expect(result.metadata?.challengeMode).toBeUndefined();
    });
  });
});
