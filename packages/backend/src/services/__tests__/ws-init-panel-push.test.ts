/**
 * handleWSInitialize 统一面板变更推送机制测试
 *
 * 验证 ws-request-handler.ts 第 213-284 行 handleWSInitialize 函数中的
 * panelUpdateBroadcaster.pushPanelUpdate 推送机制（替代原 'map:update' 事件，路径 C 初始化推送）。
 *
 * 测试覆盖场景：
 * 1. 初始化成功后调用 pushPanelUpdate（含 newLocations 数组与 mapLocationToPanelData 真实映射验证）
 * 2. processInitialize 失败时不调用 pushPanelUpdate
 * 3. metadata 缺少 saveId / currentLocationId 时跳过推送
 * 4. locationRepo.findBySaveId 抛错时仅记录日志不阻断响应
 * 5. locationRepo.findBySaveId 返回空数组时 newLocations 为空数组不报错
 *
 * Mock 策略：
 * - vi.mock '../game-service.js'：控制 processInitialize 返回不同结果
 * - 使用真实 mapLocationToPanelData（@ai-rpg/shared/utils 导出），同时验证映射逻辑正确性
 * - mock locationRepo.findBySaveId 控制返回数据/抛错
 * - mock panelUpdateBroadcaster.pushPanelUpdate 验证调用契约
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import type { WSGameRequest, WSGameResult, WSGameError } from '@ai-rpg/shared';
import type { IWebSocketContext, IPanelUpdateBroadcaster } from '@ai-rpg/shared/messaging';

// ─── Mock 模块（vi.mock 会被提升到文件顶部，factory 内部 vi.fn 安全）──

vi.mock('../game-service.js', () => ({
  processInitialize: vi.fn(),
  processChat: vi.fn(),
}));

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

vi.mock('../game-systems/skill/SkillService.js', () => ({
  SkillService: vi.fn().mockImplementation(() => ({
    getCurrentResourceAmount: vi.fn().mockResolvedValue(100),
  })),
}));

vi.mock('../utils/npc-utils.js', () => ({
  normalizeExplicitNpcId: vi.fn().mockReturnValue(undefined),
}));

// 注：不 mock '@ai-rpg/shared/utils' —— 使用真实 mapLocationToPanelData 验证映射逻辑

// ─── Mock 工厂 ──────────────────────────────────────────────

function createMockWebSocket(): WebSocket {
  return { readyState: 1, send: vi.fn() } as unknown as WebSocket;
}

function createMockCoordinatorAgent() {
  return {
    processMessage: vi.fn().mockResolvedValue({
      success: true,
      data: {},
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
  return db;
}

const mockToolRegistry = {
  getTool: vi.fn().mockReturnValue(undefined),
};

/**
 * 创建符合 LocationDataLike 结构契约（packages/shared/src/utils/location-mapper.ts）的 mock 地点数据。
 *
 * mapLocationToPanelData 实际读取的字段：
 *   id/name/description/type/parentLocationId/locationLevel/coordinates/dangerLevel/customData
 * 其余字段（saveId/isExplored/events 等）对映射无影响，但保留以贴近真实 LocationData 结构。
 */
function createMockLocationDataList() {
  return [
    {
      id: 'loc-village-square',
      saveId: 'save-test-001',
      name: '白杨村广场',
      description: '村庄的中心广场，鹅卵石铺就的地面中央竖立着古老的喷泉。',
      type: 'town',
      parentLocationId: null,
      locationLevel: 2,
      coordinates: { x: 100, y: 200 },
      dangerLevel: 0,
      customData: { landmark: '喷泉' },
      isExplored: true,
      events: [],
      connections: ['loc-blacksmith-shop'],
      visible: true,
      childLocationIds: ['loc-blacksmith-shop'],
      isParent: true,
    },
    {
      id: 'loc-blacksmith-shop',
      saveId: 'save-test-001',
      name: '铁匠铺',
      description: '炉火通红的铁匠铺，叮当的打铁声不绝于耳。',
      type: 'shop',
      parentLocationId: 'loc-village-square',
      locationLevel: 3,
      coordinates: { x: 110, y: 200 },
      dangerLevel: 0,
      customData: { shopType: 'blacksmith' },
      isExplored: false,
      events: [],
      connections: ['loc-village-square'],
      visible: true,
      childLocationIds: [],
      isParent: false,
    },
  ];
}

// ─── 测试 ───────────────────────────────────────────────────

describe('handleWSInitialize 统一面板变更推送机制', () => {
  let mockWs: WebSocket;
  let mockCoordinator: ReturnType<typeof createMockCoordinatorAgent>;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockSendToClient: ReturnType<typeof vi.fn>;
  let mockGetClientIdByWs: ReturnType<typeof vi.fn>;
  let mockSubscribeClient: ReturnType<typeof vi.fn>;
  let mockCompletePendingRequest: ReturnType<typeof vi.fn>;
  let mockWebSocketContext: IWebSocketContext;
  let mockLocationRepo: { findBySaveId: ReturnType<typeof vi.fn> };
  let mockPanelBroadcaster: IPanelUpdateBroadcaster;
  let gameServiceDeps: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWs = createMockWebSocket();
    mockCoordinator = createMockCoordinatorAgent();
    mockDb = createMockDb();

    mockSendToClient = vi.fn();
    mockGetClientIdByWs = vi.fn().mockReturnValue('client-test-mock');
    mockSubscribeClient = vi.fn();
    mockCompletePendingRequest = vi.fn();

    mockWebSocketContext = {
      sendToClient: mockSendToClient,
      broadcastToClient: vi.fn(),
      getClientIdByWs: mockGetClientIdByWs,
      getClientIdBySaveId: vi.fn().mockReturnValue(null),
      subscribeClient: mockSubscribeClient,
      getAuthenticatedClientIds: vi.fn().mockReturnValue([]),
      completePendingRequest: mockCompletePendingRequest,
      getConnectedCount: vi.fn().mockReturnValue(0),
    };

    mockLocationRepo = {
      findBySaveId: vi.fn().mockResolvedValue(createMockLocationDataList()),
    };

    mockPanelBroadcaster = {
      pushPanelUpdates: vi.fn(),
      pushPanelUpdate: vi.fn(),
    };

    // gameServiceDeps 仅 locationRepo 参与 handleWSInitialize 推送逻辑；
    // processInitialize 已被 mock，其他字段不参与本次测试路径。
    gameServiceDeps = { locationRepo: mockLocationRepo };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * 构造 handler：注入统一 mock ctx。
   * panelUpdateBroadcaster 为新增必填字段，与本测试目标直接相关。
   */
  async function createHandler() {
    const { createWSGameHandler } = await import('../ws-request-handler.js');
    return createWSGameHandler({
      coordinatorAgent: mockCoordinator as never,
      db: mockDb as never,
      configLoader: {
        getAllProfilesFromDB: vi.fn(),
        getAllProfiles: vi.fn(() => []),
        getProfileWithDBFallback: vi.fn(),
        createProfile: vi.fn(),
        updateProfile: vi.fn(),
        deleteProfile: vi.fn(),
      } as never,
      clientId: 'test-client',
      toolRegistry: mockToolRegistry as never,
      webSocketService: mockWebSocketContext,
      gameServiceDeps: gameServiceDeps as never,
      saveService: undefined as never,
      panelUpdateBroadcaster: mockPanelBroadcaster,
    });
  }

  function createInitRequest(): WSGameRequest {
    return {
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
  }

  // ─── 场景 1：初始化成功后调用 pushPanelUpdate ─────────────

  it('初始化成功后调用 pushPanelUpdate 推送 location 面板（source=init）', async () => {
    const { processInitialize } = await import('../game-service.js');
    (processInitialize as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: {},
      metadata: {
        saveId: 'save-test-001',
        currentLocationId: 'loc-village-square',
        currentLocationName: '白杨村广场',
      },
    });

    const handler = await createHandler();
    await handler(createInitRequest(), mockWs);

    // 断言 pushPanelUpdate 被调用一次
    expect(mockPanelBroadcaster.pushPanelUpdate).toHaveBeenCalledOnce();

    // 断言参数契约：saveId / panelKey / partialUpdate / source
    const [saveId, panelKey, partialUpdate, source] = mockPanelBroadcaster.pushPanelUpdate.mock.calls[0];
    expect(saveId).toBe('save-test-001');
    expect(panelKey).toBe('location');
    expect(source).toBe('init');

    // 断言 partialUpdate 包含 currentLocationId/currentLocationName
    expect(partialUpdate).toMatchObject({
      currentLocationId: 'loc-village-square',
      currentLocationName: '白杨村广场',
    });

    // 断言 newLocations 是数组且长度 2（真实 mapLocationToPanelData 映射）
    expect(Array.isArray(partialUpdate.newLocations)).toBe(true);
    expect(partialUpdate.newLocations).toHaveLength(2);

    // 断言 newLocations 元素经 mapLocationToPanelData 映射后的字段
    // 关键映射：parentLocationId null→undefined、coordinates→x/y、locationLevel 强转
    const firstLoc = partialUpdate.newLocations[0];
    expect(firstLoc.id).toBe('loc-village-square');
    expect(firstLoc.name).toBe('白杨村广场');
    expect(firstLoc.description).toBe('村庄的中心广场，鹅卵石铺就的地面中央竖立着古老的喷泉。');
    expect(firstLoc.type).toBe('town');
    expect(firstLoc.parentLocationId).toBeUndefined(); // null → undefined
    expect(firstLoc.locationLevel).toBe(2);
    expect(firstLoc.x).toBe(100);
    expect(firstLoc.y).toBe(200);
    expect(firstLoc.dangerLevel).toBe(0);
    expect(firstLoc.customData).toEqual({ landmark: '喷泉' });

    const secondLoc = partialUpdate.newLocations[1];
    expect(secondLoc.id).toBe('loc-blacksmith-shop');
    expect(secondLoc.parentLocationId).toBe('loc-village-square'); // 非 null 保留
    expect(secondLoc.locationLevel).toBe(3);
    expect(secondLoc.customData).toEqual({ shopType: 'blacksmith' });

    // 断言 locationRepo.findBySaveId 被调用（saveId 作为参数）
    expect(mockLocationRepo.findBySaveId).toHaveBeenCalledOnce();
    expect(mockLocationRepo.findBySaveId).toHaveBeenCalledWith('save-test-001');

    // 断言 sendToClient 也被调用（发送 game:result 响应）
    expect(mockSendToClient).toHaveBeenCalledOnce();
    const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameResult;
    expect(sentMessage.type).toBe('game:result');
    expect(sentMessage.requestId).toBe('req-init-001');
    expect(sentMessage.module).toBe('game');
    expect(sentMessage.data?.success).toBe(true);
    expect(sentMessage.intentHint).toBe('initialize');

    // 断言 completePendingRequest 被调用（清理 pending 请求）
    expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-init-001');

    // 注：subscribeClient 由 processInitialize 内部 onSaveCreated 回调触发，
    // processInitialize 已被 mock，回调不会执行，故不在此断言 subscribeClient。
  });

  // ─── 场景 2：processInitialize 失败时不调用 pushPanelUpdate ──

  it('processInitialize 失败时不调用 pushPanelUpdate，发送 game:error', async () => {
    const { processInitialize } = await import('../game-service.js');
    (processInitialize as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      errorCode: 'GAME_INIT_FAILED',
      error: '游戏初始化失败',
      data: {},
    });

    const handler = await createHandler();
    await handler(createInitRequest(), mockWs);

    // 断言 pushPanelUpdate 未被调用
    expect(mockPanelBroadcaster.pushPanelUpdate).not.toHaveBeenCalled();
    // 断言 locationRepo.findBySaveId 也未被调用（success=false 提前 return）
    expect(mockLocationRepo.findBySaveId).not.toHaveBeenCalled();

    // 断言发送 game:error 响应
    expect(mockSendToClient).toHaveBeenCalledOnce();
    const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameError;
    expect(sentMessage.type).toBe('game:error');
    expect(sentMessage.requestId).toBe('req-init-001');
    expect(sentMessage.error).toContain('GAME_INIT_FAILED');

    // 断言 completePendingRequest 仍被调用（错误响应也清理 pending）
    expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-init-001');
  });

  // ─── 场景 3a：metadata 缺少 saveId 时跳过推送 ─────────────

  it('metadata 缺少 saveId 时不推送，但仍发送 game:result', async () => {
    const { processInitialize } = await import('../game-service.js');
    (processInitialize as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: {},
      metadata: {
        // 缺少 saveId
        currentLocationId: 'loc-village-square',
        currentLocationName: '白杨村广场',
      },
    });

    const handler = await createHandler();
    await handler(createInitRequest(), mockWs);

    // 断言跳过推送
    expect(mockPanelBroadcaster.pushPanelUpdate).not.toHaveBeenCalled();
    expect(mockLocationRepo.findBySaveId).not.toHaveBeenCalled();

    // 断言仍发送 game:result
    expect(mockSendToClient).toHaveBeenCalledOnce();
    const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameResult;
    expect(sentMessage.type).toBe('game:result');
    expect(sentMessage.data?.success).toBe(true);

    // 断言 completePendingRequest 被调用
    expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-init-001');
  });

  // ─── 场景 3b：metadata 缺少 currentLocationId 时跳过推送 ──

  it('metadata 缺少 currentLocationId 时不推送，但仍发送 game:result', async () => {
    const { processInitialize } = await import('../game-service.js');
    (processInitialize as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: {},
      metadata: {
        saveId: 'save-test-001',
        // 缺少 currentLocationId
      },
    });

    const handler = await createHandler();
    await handler(createInitRequest(), mockWs);

    expect(mockPanelBroadcaster.pushPanelUpdate).not.toHaveBeenCalled();
    expect(mockLocationRepo.findBySaveId).not.toHaveBeenCalled();

    expect(mockSendToClient).toHaveBeenCalledOnce();
    const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameResult;
    expect(sentMessage.type).toBe('game:result');
    expect(sentMessage.data?.success).toBe(true);
    expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-init-001');
  });

  // ─── 场景 4：locationRepo.findBySaveId 抛错时仅记录日志不阻断响应 ──

  it('locationRepo.findBySaveId 抛错时不调用 pushPanelUpdate，但仍发送 game:result', async () => {
    const { processInitialize } = await import('../game-service.js');
    (processInitialize as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: {},
      metadata: {
        saveId: 'save-test-001',
        currentLocationId: 'loc-village-square',
        currentLocationName: '白杨村广场',
      },
    });
    // 让 findBySaveId 抛错
    mockLocationRepo.findBySaveId.mockRejectedValue(new Error('DB connection failed'));

    const handler = await createHandler();
    await handler(createInitRequest(), mockWs);

    // 断言 locationRepo.findBySaveId 被调用
    expect(mockLocationRepo.findBySaveId).toHaveBeenCalledWith('save-test-001');

    // 断言 pushPanelUpdate 未被调用（catch 块跳过推送）
    expect(mockPanelBroadcaster.pushPanelUpdate).not.toHaveBeenCalled();

    // 断言错误被 catch，不传播，仍发送 game:result
    expect(mockSendToClient).toHaveBeenCalledOnce();
    const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameResult;
    expect(sentMessage.type).toBe('game:result');
    expect(sentMessage.data?.success).toBe(true);

    // 断言 completePendingRequest 仍被调用（错误未阻断响应链）
    expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-init-001');
  });

  // ─── 场景 5：locationRepo.findBySaveId 返回空数组时不报错 ──

  it('locationRepo.findBySaveId 返回空数组时 newLocations 为空数组，仍调 pushPanelUpdate', async () => {
    const { processInitialize } = await import('../game-service.js');
    (processInitialize as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: {},
      metadata: {
        saveId: 'save-test-empty',
        currentLocationId: 'loc-empty',
        currentLocationName: '空地点',
      },
    });
    // 关键 mock：返回空数组
    mockLocationRepo.findBySaveId.mockResolvedValue([]);

    const handler = await createHandler();
    await handler(createInitRequest(), mockWs);

    // 断言 pushPanelUpdate 仍被调用（location 面板含 currentLocationId/Name + newLocations: []）
    expect(mockPanelBroadcaster.pushPanelUpdate).toHaveBeenCalledOnce();
    const [saveId, panelKey, partialUpdate, source] = mockPanelBroadcaster.pushPanelUpdate.mock.calls[0];
    expect(saveId).toBe('save-test-empty');
    expect(panelKey).toBe('location');
    expect(source).toBe('init');

    // 关键断言：newLocations 为空数组，不报错
    expect(partialUpdate.newLocations).toEqual([]);
    expect(Array.isArray(partialUpdate.newLocations)).toBe(true);

    // 断言 currentLocationId/currentLocationName 仍正常传递
    expect(partialUpdate.currentLocationId).toBe('loc-empty');
    expect(partialUpdate.currentLocationName).toBe('空地点');

    // 断言仍发送 game:result 响应
    expect(mockSendToClient).toHaveBeenCalledOnce();
    const sentMessage = mockSendToClient.mock.calls[0][1] as WSGameResult;
    expect(sentMessage.type).toBe('game:result');
    expect(sentMessage.data?.success).toBe(true);

    // 断言 completePendingRequest 被调用
    expect(mockCompletePendingRequest).toHaveBeenCalledWith('req-init-001');
  });
});
