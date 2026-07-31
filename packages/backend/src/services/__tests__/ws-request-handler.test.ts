/**
 * WS 游戏请求处理器 — 端到端集成测试
 *
 * 验证 createWSGameHandler 的路由分发、消息格式、
 * processChat 的对话合并、processInitialize 的 onProgress 回调。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import type { WSGameRequest, WSGameResult, WSGameError } from '@ai-rpg/shared';
import type { IWebSocketContext } from '@ai-rpg/shared/messaging';

// ─── Mock 模块 ──────────────────────────────────────────────

const mockSendToClient = vi.fn();
const mockBroadcastToClient = vi.fn();
const mockGetClientIdByWs = vi.fn().mockReturnValue('client-test-mock');
const mockGetClientIdBySaveId = vi.fn().mockReturnValue(null);
const mockSubscribeClient = vi.fn();
const mockGetAuthenticatedClientIds = vi.fn().mockReturnValue([]);
const mockCompletePendingRequest = vi.fn();
const mockGetConnectedCount = vi.fn().mockReturnValue(0);

// P1-2: 移除模块级单例 vi.mock，改为构造 mock IWebSocketContext 实例传入 ctx
const mockWebSocketContext: IWebSocketContext = {
  sendToClient: mockSendToClient,
  broadcastToClient: mockBroadcastToClient,
  getClientIdByWs: mockGetClientIdByWs,
  getClientIdBySaveId: mockGetClientIdBySaveId,
  subscribeClient: mockSubscribeClient,
  getAuthenticatedClientIds: mockGetAuthenticatedClientIds,
  completePendingRequest: mockCompletePendingRequest,
  getConnectedCount: mockGetConnectedCount,
};

vi.mock('../utils/constants.js', () => ({
  INIT_ACTIONS: ['initialize', 'init', 'create_character', 'initialize_game', 'full_initialization', 'enrich_data'],
  isInitAction: (action: string) =>
    ['initialize', 'init', 'create_character', 'initialize_game', 'full_initialization', 'enrich_data'].includes(action),
}));

vi.mock('../utils/config.js', () => ({
  config: { timeout: { chat: 30000 } },
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../shared/src/types/game.js', () => ({
  parseCostArray: vi.fn().mockReturnValue(null),
}));

vi.mock('../game-systems/skill/SkillService.js', () => ({
  SkillService: vi.fn().mockImplementation(() => ({
    getCurrentResourceAmount: vi.fn().mockResolvedValue(100),
  })),
}));

vi.mock('../utils/npc-utils.js', () => ({
  normalizeExplicitNpcId: vi.fn().mockReturnValue(undefined),
}));

// ─── Mock 工厂 ──────────────────────────────────────────────

function createMockWebSocket(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket;
}

function createMockCoordinatorAgent() {
  return {
    processMessage: vi.fn().mockResolvedValue({
      success: true,
      data: {
        panelUpdates: {
          dialogue: {
            addedMessages: [
              { speaker: 'NPC', content: '欢迎来到游戏世界', emotion: 'neutral', messageType: 'npc' },
            ],
          },
        },
      },
    }),
    createRequestScopedCopy: vi.fn().mockReturnThis(),
    createRequestRuntime: vi.fn().mockResolvedValue({
      stagingPool: { stage: vi.fn().mockResolvedValue(undefined) },
      shadowState: {},
    }),
    applyRequestScope: vi.fn(),
    flushRequestRuntime: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * 创建 knex mock：db('table') 返回链式查询构建器
 *
 * game-service 内部通过 new SaveService(db) / new CharacterService(db, ...)
 * 使用 db，所以 db 必须是可调用函数并返回链式 API。
 */
function createMockDb(): ReturnType<typeof vi.fn> {
  const chainable = {
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ name: 'TestPlayer' }),
    insert: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(1),
    delete: vi.fn().mockResolvedValue(0),
    orderBy: vi.fn().mockReturnThis(),
  };

  const db = vi.fn().mockReturnValue(chainable);
  // 挂载 chainable 以便个别测试覆盖
  (db as unknown as Record<string, unknown>).chainable = chainable;
  return db;
}

/**
 * IToolRegistry 最小 mock：ws-request-handler 测试不触发 pool:generate-options
 * 路径（该路径在 ws-template-handler.test.ts 中验证），此处仅满足 ctx 类型契约。
 */
const mockToolRegistry = {
  getTool: vi.fn().mockReturnValue(undefined),
};

/**
 * 最小 SaveService mock（ISaveProvider 端口接口）。
 *
 * 期望效果：
 * - createSave 返回有效 SaveRecord（含 id），让 processInitialize A0 阶段通过
 * - getSave 返回有效记录，让 processChat saveService.getSave 校验通过
 * - loadSave 返回有效记录，让 ws-request-handler.ts:316 loadSave 路径通过
 */
function createMockSaveService() {
  return {
    createSave: vi.fn().mockResolvedValue({
      id: 'save-mock-001',
      name: 'TestPlayer',
      templateId: 'medieval-fantasy',
      gameMode: 'text_adventure',
    }),
    getSave: vi.fn().mockResolvedValue({
      id: 'save-mock-001',
      name: 'TestPlayer',
      templateId: 'medieval-fantasy',
      gameMode: 'text_adventure',
      activeChallengeMode: null,
    }),
    loadSave: vi.fn().mockResolvedValue({
      id: 'save-mock-001',
      name: 'TestPlayer',
      templateId: 'medieval-fantasy',
      gameMode: 'text_adventure',
      activeChallengeMode: null,
    }),
  };
}

/**
 * 最小 GameServiceDeps mock（processInitialize/processChat 端口依赖）。
 *
 * 期望效果：
 * - characterService.createCharacter/getCharacter/updateLocationId 让 init 流程通过
 * - locationRepo.findFirstBySaveId 返回有效起始地点
 * - entityGraphBuilder.ensureCharacterNode/enrichFromExistingData 静默通过
 * - modeRouter.route 返回空候选列表（不触发 Agent 路由分流）
 * - txManager/rollbackRepos/skillService/challengeProgram 满足类型契约（不触发实际路径）
 * - saveService 内嵌于 GameServiceDeps（handleWSInitialize 通过 ...ctx.gameServiceDeps 展开）
 */
function createMockGameServiceDeps() {
  return {
    characterService: {
      createCharacter: vi.fn().mockResolvedValue({ id: 'char-mock-001', name: 'TestHero' }),
      getCharacter: vi.fn().mockResolvedValue({ id: 'char-mock-001', currentLocationId: null }),
      updateLocationId: vi.fn().mockResolvedValue(undefined),
    },
    locationRepo: {
      findFirstBySaveId: vi.fn().mockResolvedValue({ id: 'loc-mock-001', name: '起始村庄' }),
      findById: vi.fn().mockResolvedValue({ id: 'loc-mock-001', name: '起始村庄' }),
      findBySaveId: vi.fn().mockResolvedValue([]),
    },
    saveService: createMockSaveService(),
    skillService: {},
    rollbackRepos: {},
    txManager: {
      withTransaction: vi.fn((fn: (trx: unknown) => Promise<unknown>) => fn({})),
    },
    entityGraphBuilder: {
      ensureCharacterNode: vi.fn().mockResolvedValue(undefined),
      enrichFromExistingData: vi.fn().mockResolvedValue(undefined),
    },
    entityGraphBuildContext: {},
    challengeProgram: {},
    modeRouter: {
      route: vi.fn().mockReturnValue({ candidateAgentTypes: [], challengeMode: null }),
    },
  };
}

/**
 * 最小 panelUpdateBroadcaster mock（IPanelUpdateBroadcaster 端口接口）。
 *
 * handleWSInitialize 在 processInitialize 成功后调用 pushPanelUpdate 推送初始 location 面板，
 * 此 mock 让该路径静默通过（不实际推送 WS 消息）。
 */
function createMockPanelUpdateBroadcaster() {
  return {
    pushPanelUpdate: vi.fn(),
  };
}

// ─── 测试 ───────────────────────────────────────────────────

describe('WS 游戏请求处理器', () => {
  let mockWs: WebSocket;
  let mockCoordinator: ReturnType<typeof createMockCoordinatorAgent>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWs = createMockWebSocket();
    mockCoordinator = createMockCoordinatorAgent();
    mockDb = createMockDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 1. createWSGameHandler 返回处理函数 ─────────────────

  describe('createWSGameHandler', () => {
    it('返回异步处理函数', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      expect(typeof handler).toBe('function');
      expect(handler.constructor.name).toBe('AsyncFunction');
    });
  });

  // ─── 2. 初始化请求路由 ──────────────────────────────────

  describe('handleWSGameRequest — 初始化路由', () => {
    it('action 为 initialize 时调用 handleWSInitialize 逻辑', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-init-001',
        module: 'game',
        action: 'initialize',
        clientId: 'test-client',
        payload: {
          templateId: 'medieval-fantasy',
          characterData: {
            name: 'TestHero',
            gender: 'male',
            race: 'human',
            classType: 'warrior',
            background: 'noble',
            attributes: { strength: 16 },
          },
        },
      };

      await handler(request, mockWs);

      // processInitialize 内部会调用 coordinatorAgent.processMessage
      expect(mockCoordinator.processMessage).toHaveBeenCalledOnce();
    });

    it('缺少 templateId 时发送 game:error', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-init-no-tpl',
        module: 'game',
        action: 'initialize',
        clientId: 'test-client',
        payload: {
          templateId: '',
          characterData: {
            name: 'TestHero',
            gender: 'male',
            race: 'human',
            classType: 'warrior',
            background: 'noble',
            attributes: { strength: 16 },
          },
        },
      };

      await handler(request, mockWs);

      expect(mockSendToClient).toHaveBeenCalledOnce();
      const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameError;
      expect(sentMessage.type).toBe('game:error');
      expect(sentMessage.requestId).toBe('req-init-no-tpl');
      expect(sentMessage.error).toContain('TEMPLATE_ID_REQUIRED');
      expect(sentMessage.recoverable).toBe(true);
    });
  });

  // ─── 3. 对话请求路由 ────────────────────────────────────

  describe('handleWSGameRequest — 对话路由', () => {
    it('action 为 chat 时调用 handleWSChat 逻辑', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-chat-001',
        module: 'game',
        action: 'chat',
        clientId: 'test-client',
        payload: {
          message: '你好',
          saveId: 'save-mock-001',
        },
      };

      await handler(request, mockWs);

      expect(mockCoordinator.processMessage).toHaveBeenCalledOnce();
    });

    it('缺少 saveId 时发送 game:error', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-chat-no-save',
        module: 'game',
        action: 'chat',
        clientId: 'test-client',
        payload: {
          message: '你好',
          saveId: '',
        },
      };

      await handler(request, mockWs);

      expect(mockSendToClient).toHaveBeenCalledOnce();
      const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameError;
      expect(sentMessage.type).toBe('game:error');
      expect(sentMessage.requestId).toBe('req-chat-no-save');
      expect(sentMessage.error).toContain('SAVE_ID_REQUIRED');
      expect(sentMessage.recoverable).toBe(true);
    });
  });

  // ─── 5. processInitialize 进度回传 ──────────

  describe('game-service processInitialize — 进度通过 Hook 自动触发', () => {
    it('不再需要 onProgress 回调参数', async () => {
      const { processInitialize } = await import('../game-service.js');

      // onProgress 已删除，进度通过 report_progress Hook 自动触发
      // 提供完整 GameServiceDeps mock，让 processInitialize 走完 A0→A1→A1.1→阶段B 完整路径
      await processInitialize(
        {
          coordinatorAgent: mockCoordinator,
          db: mockDb,
          ...createMockGameServiceDeps(),
        } as never,
        {
          templateId: 'medieval-fantasy',
          characterData: {
            name: 'TestHero',
            gender: 'male',
            race: 'human',
            classType: 'warrior',
            background: 'noble',
            attributes: { strength: 16 },
          },
        },
      );

      // 进度回传由 report_progress Hook 自动处理，无需手动回调
    });
  });

  // ─── 6. WS 消息协议类型验证 ─────────────────────────────

  describe('WS 消息协议格式', () => {
    it('game:result 消息格式包含 type/requestId/data/intentHint', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-result-fmt',
        module: 'game',
        action: 'initialize',
        clientId: 'test-client',
        payload: {
          templateId: 'medieval-fantasy',
          characterData: {
            name: 'TestHero',
            gender: 'male',
            race: 'human',
            classType: 'warrior',
            background: 'noble',
            attributes: { strength: 16 },
          },
        },
      };

      await handler(request, mockWs);

      // 初始化成功时发送 game:result
      const sentMessage = mockSendToClient.mock.calls.find(
        (call: [unknown, { type: string }]) => (call[1] as { type: string }).type === 'game:result',
      );
      expect(sentMessage).toBeDefined();

      const result = sentMessage![1] as WSGameResult;
      expect(result).toHaveProperty('type', 'game:result');
      expect(result).toHaveProperty('requestId', 'req-result-fmt');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('intentHint', 'initialize');
    });

    it('game:error 消息格式包含 type/requestId/error/recoverable', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-error-fmt',
        module: 'game',
        action: 'chat',
        clientId: 'test-client',
        payload: {
          message: '你好',
          saveId: '',
        },
      };

      await handler(request, mockWs);

      const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameError;
      expect(sentMessage).toHaveProperty('type', 'game:error');
      expect(sentMessage).toHaveProperty('requestId', 'req-error-fmt');
      expect(sentMessage).toHaveProperty('error');
      expect(typeof sentMessage.error).toBe('string');
      expect(sentMessage).toHaveProperty('recoverable');
      expect(typeof sentMessage.recoverable).toBe('boolean');
    });
  });

  // ─── 7. 模块I: pending 请求清理验证 ─────────────────────

  describe('模块I: 响应发送时清理 pending 请求', () => {
    it('成功响应时调用 completePendingRequest', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-cleanup-success',
        module: 'game',
        action: 'initialize',
        clientId: 'test-client',
        payload: {
          templateId: 'medieval-fantasy',
          characterData: {
            name: 'TestHero',
            gender: 'male',
            race: 'human',
            classType: 'warrior',
            background: 'noble',
            attributes: { strength: 16 },
          },
        },
      };

      await handler(request, mockWs);

      // 验证 completePendingRequest 被调用，且 requestId 正确
      expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-cleanup-success');
    });

    it('错误响应时调用 completePendingRequest', async () => {
      const { createWSGameHandler } = await import('../ws-request-handler.js');
      const handler = createWSGameHandler({
        coordinatorAgent: mockCoordinator as never,
        db: mockDb as never,
        configLoader: { getAllProfilesFromDB: vi.fn(), getAllProfiles: vi.fn(() => []), getProfileWithDBFallback: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn() } as never,
        clientId: 'test-client',
        toolRegistry: mockToolRegistry as never,
        webSocketService: mockWebSocketContext,
        gameServiceDeps: createMockGameServiceDeps() as never,
        saveService: createMockSaveService() as never,
        panelUpdateBroadcaster: createMockPanelUpdateBroadcaster() as never,
      });

      const request: WSGameRequest = {
        type: 'game:request',
        requestId: 'req-cleanup-error',
        module: 'game',
        action: 'chat',
        clientId: 'test-client',
        payload: {
          message: '你好',
          saveId: '',
        },
      };

      await handler(request, mockWs);

      // 验证错误响应也触发 completePendingRequest
      expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-cleanup-error');
    });
  });
});
