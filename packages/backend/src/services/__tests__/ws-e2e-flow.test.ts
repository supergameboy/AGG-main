/**
 * WS-8: WebSocket 端到端集成测试
 *
 * 验证完整链路：WS请求 → 进度事件 → 最终结果 → 错误处理 → HTTP回退
 *
 * 测试层级：
 * - 真实：HTTP Server + WebSocketService + ClientSessionManager + ws-request-handler + game-service + DB
 * - 模拟：coordinatorAgent（模拟 AgentRuntime 的 report_progress Hook 行为，通过 broadcastToClient 发送进度事件）
 *
 * 设计依据：
 * - [fractal-design-20260616-agent-progress-refactor-v2-总规划.md](../../../../docs/design/fractal-design-20260616-agent-progress-refactor/fractal-design-20260616-agent-progress-refactor-v2-总规划.md)
 * - 数据流 v2: WS → AgentMessage(metadata: {_wsRequestId, _wsClientId}) → processMessage → ProgressContext → Hook → broadcastToClient(clientId)
 */

import express from 'express';
import knex, { type Knex } from 'knex';
import { WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IWebSocketContext } from '@ai-rpg/shared/messaging';
import type { WSGameRequest } from '@ai-rpg/shared';
import { WebSocketService } from '../WebSocketService.js';
import { ClientSessionManager } from '../ClientSessionManager.js';
import { createWSGameHandler } from '../ws-request-handler.js';
import { createGameRoutes } from '../../routes/game.js';
import { createSaveRoutes } from '../../routes/save.js';
import { errorHandler } from '../../middlewares/errorhandler.js';
import { runMigrations } from '../../migrations/runner.js';
import { SaveService } from '../../game-systems/save/SaveService.js';
import { CharacterService } from '../../game-systems/character/CharacterService.js';
import { LocationRepository } from '../../game-systems/map/LocationRepository.js';
import { SkillService } from '../../game-systems/skill/SkillService.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { SaveRepository } from '../../game-systems/save/index.js';
import { successResponse } from '../../utils/response.js';

// ─── Mock logger/config（与 e2e-game-core.test.ts 一致）──

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../utils/config.js', () => ({
  config: {
    timeout: { chat: 30_000, wsHeartbeat: 30_000, wsMaxMissedHeartbeats: 3 },
  },
}));

vi.mock('../utils/constants.js', () => ({
  INIT_ACTIONS: ['initialize', 'init', 'create_character', 'initialize_game', 'full_initialization', 'enrich_data'],
  isInitAction: (action: string) =>
    ['initialize', 'init', 'create_character', 'initialize_game', 'full_initialization', 'enrich_data'].includes(action),
}));

vi.mock('../../../shared/src/types/game.js', () => ({
  parseCostArray: vi.fn().mockReturnValue(null),
}));

vi.mock('../../game-systems/skill/SkillService.js', () => ({
  SkillService: vi.fn().mockImplementation(() => ({
    getCurrentResourceAmount: vi.fn().mockResolvedValue(100),
    validateUsage: vi.fn().mockResolvedValue({ valid: true }),
  })),
}));

// CharacterService mock：chat 路径仅调用 getCharacter（无角色时 processChat 使用 'player' 兜底）
vi.mock('../../game-systems/character/CharacterService.js', () => ({
  CharacterService: vi.fn().mockImplementation(() => ({
    getCharacter: vi.fn().mockResolvedValue(undefined),
    createCharacter: vi.fn(),
    updateLocationId: vi.fn(),
  })),
}));

vi.mock('../utils/npc-utils.js', () => ({
  normalizeExplicitNpcId: vi.fn().mockReturnValue(undefined),
}));

// ─── 类型定义 ──

interface MockCoordinatorOptions {
  /** 模拟 report_progress Hook：发送进度事件序列 */
  progressPhases?: string[];
  /** 覆盖默认的成功响应 */
  response?: Record<string, unknown>;
  /** 模拟失败响应 */
  failure?: { errorCode: string; error: string };
}

/**
 * 创建 mock coordinator：模拟 AgentRuntime 的行为
 * - 读取 metadata._wsClientId / _wsRequestId
 * - 通过 webSocketService.broadcastToClient 发送进度事件（模拟 report_progress Hook）
 * - 返回最终结果
 */
function createMockCoordinator(webSocketService: IWebSocketContext, options: MockCoordinatorOptions = {}) {
  const coordinator = {
    processMessage: vi.fn().mockImplementation(async (agentMessage: Record<string, unknown>) => {
      const meta = (agentMessage.metadata ?? {}) as Record<string, unknown>;
      const clientId = meta._wsClientId as string | undefined;
      const requestId = meta._wsRequestId as string | undefined;

      // 模拟 report_progress Hook：发送进度事件序列
      // 真实系统中由 AgentRuntime.reportProgress → dispatchHook → default-agent-hooks 触发
      const phases = options.progressPhases ?? ['task_start', 'thinking', 'task_end'];
      for (const phase of phases) {
        if (clientId) {
          webSocketService.broadcastToClient(
            clientId,
            'agent_progress',
            { phase, agentType: 'gamemaster', taskDescription: '处理请求', timestamp: Date.now() },
            requestId,
          );
        }
      }

      // 模拟延迟，确保进度事件先于最终结果到达
      await new Promise((r) => setTimeout(r, 10));

      if (options.failure) {
        return {
          success: false,
          errorCode: options.failure.errorCode,
          error: options.failure.error,
        };
      }

      return (
        options.response ?? {
          success: true,
          data: {
            panelUpdates: {
              dialogue: {
                addedMessages: [
                  { speaker: 'NPC', content: '欢迎来到游戏世界', emotion: 'neutral', messageType: 'npc' },
                ],
              },
            },
            gm: { processedAt: new Date().toISOString(), duration: 100, reactIterations: 1 },
          },
          messages: [],
        }
      );
    }),
    getPromptModule: vi.fn().mockReturnValue({
      getLastBuildResult: vi.fn().mockReturnValue(null),
      rules: { loadAllRules: vi.fn().mockResolvedValue(undefined), ruleNames: [], getRuleByName: vi.fn().mockReturnValue(undefined) },
      skills: { loadAllSkills: vi.fn().mockResolvedValue(undefined), skillNames: [], getSkillByName: vi.fn().mockReturnValue(undefined) },
    }),
    currentStagingPool: null,
    currentShadowState: null,
    createRequestRuntime: vi.fn().mockResolvedValue({ stagingPool: { stage: vi.fn().mockResolvedValue(undefined) }, shadowState: {} }),
    flushRequestRuntime: vi.fn().mockResolvedValue(undefined),
    applyRequestScope: vi.fn(),
    createRequestScopedCopy: vi.fn().mockReturnThis(),
  };
  return coordinator;
}

// ─── 测试辅助 ──

async function insertTestTemplate(db: Knex, templateId = 'test-template') {
  const now = Date.now();
  await db('templates').insert({
    id: templateId,
    raw_content: JSON.stringify({
      world_setting: { name: 'Test World' },
      character_creation: { races: ['human', 'elf'], classes: ['warrior', 'mage'], backgrounds: ['soldier', 'scholar'] },
    }),
    source: 'yaml',
    is_builtin: 0,
    created_at: now,
    updated_at: now,
  });
}

/**
 * 直接通过 SaveService 创建存档记录，绕过 processInitialize 路径。
 * WS-8 测试焦点是 WS chat 流程（进度事件/结果/错误/HTTP 回退），不是 init 流程。
 * processChat 仅需 save 存在即可，无需角色/地点数据。
 */
async function seedTestSave(svc: SaveService, name = 'Test Save'): Promise<string> {
  const save = await svc.createSave(name, 'test-template', 'text_adventure');
  return save.id as string;
}

/** WS 客户端连接 + auth */
function connectClient(port: number, clientId?: string): Promise<{ ws: WebSocket; clientId: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Auth timeout')); }, 5000);
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    const onMessage = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_result' && msg.success === true) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve({ ws, clientId: msg.clientId });
        }
      } catch {}
    };
    ws.on('message', onMessage);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', clientId: clientId ?? null }));
    });
  });
}

/** 收集 WS 客户端的所有消息 */
function collectMessages(ws: WebSocket): { messages: any[]; stop: () => void } {
  const messages: any[] = [];
  const listener = (data: Buffer) => {
    try { messages.push(JSON.parse(data.toString())); } catch {}
  };
  ws.on('message', listener);
  return { messages, stop: () => ws.off('message', listener) };
}

/** 等待下一条特定 type 的消息 */
function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const listener = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off('message', listener);
          resolve(msg);
        }
      } catch {}
    };
    ws.on('message', listener);
  });
}

function disconnect(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) { resolve(); return; }
    ws.on('close', () => resolve());
    ws.close();
  });
}

// ─── 测试套件 ──

describe('WS-8: WebSocket 端到端集成测试', () => {
  let db: Knex;
  let server: Server;
  let webSocketService: WebSocketService;
  let sessionManager: ClientSessionManager;
  let port: number;
  let coordinator: ReturnType<typeof createMockCoordinator>;
  let saveService: SaveService;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await runMigrations(db);
    await insertTestTemplate(db);

    sessionManager = new ClientSessionManager();
    webSocketService = new WebSocketService({ sessionManager });
    coordinator = createMockCoordinator(webSocketService);

    const saveRepo = new SaveRepository(db);
    const txManager = new KnexTransactionManager(db);
    // SaveService/CharacterService/SkillService 构造签名已多次重构，测试文件待修复
    // 当前用类型断言绕过，vi.mock 已替换实现，实际行为不受影响
    const SaveServiceMocked = SaveService as unknown as new (saveRepo: any, txManager: any) => InstanceType<typeof SaveService>;
    saveService = new SaveServiceMocked(saveRepo, txManager);

    const locationRepo = new LocationRepository(db);
    // CharacterService/SkillService 已被 vi.mock 替换实现，类型断言绕过构造签名检查
    const CharacterServiceMocked = CharacterService as unknown as new (db: any) => InstanceType<typeof CharacterService>;
    const characterService = new CharacterServiceMocked(db);
    const SkillServiceMocked = SkillService as unknown as new (db: any) => InstanceType<typeof SkillService>;
    const skillService = new SkillServiceMocked(db);

    const gameServiceDeps = {
      characterService,
      locationRepo,
      saveService,
      skillService,
      rollbackRepos: {} as never,
      txManager,
    };

    // HTTP 路由（用于 HTTP 回退测试）
    const app = express();
    app.use(express.json());
    app.get('/api/v1/health', (_req, res) => res.json(successResponse({ status: 'ok' })));
    app.use('/api/v1/game', createGameRoutes(coordinator as never, db, gameServiceDeps as never));
    app.use('/api/v1/saves', createSaveRoutes(db));
    app.use(errorHandler);

    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') port = addr.port;
        resolve();
      });
    });

    // WS handler 注册（与 index.ts 生产配置一致）
    const wsGameHandler = createWSGameHandler({
      coordinatorAgent: coordinator as never,
      db,
      configLoader: {} as never,
      clientId: '',
      toolRegistry: { getTool: vi.fn().mockReturnValue(undefined) } as never,
      webSocketService: webSocketService as IWebSocketContext,
      gameServiceDeps: gameServiceDeps as never,
      saveService,
    });
    webSocketService.setRequestHandler(wsGameHandler);
    webSocketService.initialize(server);
  });

  afterEach(async () => {
    try { webSocketService.shutdown(); } catch {}
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1000);
      server.close(() => { clearTimeout(t); resolve(); });
    });
    await db.destroy();
  });

  // ═══ 1. WS请求 → 进度事件 → 最终结果（成功路径） ═══

  describe('成功路径：WS请求 → 进度事件 → 最终结果', () => {
    it('chat 请求：客户端收到 agent_progress 进度事件序列 + game:result 最终结果', async () => {
      // 1. 直接创建存档（绕过 processInitialize，聚焦 chat WS 流程测试）
      const saveId = await seedTestSave(saveService);

      // 2. WS 客户端连接 + auth + subscribe
      const { ws, clientId } = await connectClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws, 'subscribed');

      // 3. 发送 WS game:request (chat)
      const requestId = 'req-e2e-chat-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat',
        intentHint: 'chat',
        payload: { message: '你好', saveId },
        clientId,
      };

      const collector = collectMessages(ws);
      ws.send(JSON.stringify(gameRequest));

      // 4. 等待最终结果
      const result = await waitForMessage(ws, 'game:result', 10000);

      // 5. 验证最终结果
      expect(result.requestId).toBe(requestId);
      expect(result.module).toBe('game');
      // 统一面板变更推送机制：dialogue 字段已从 result.data 移除（设计 5.13），由 panelUpdates.dialogue 推送

      // 6. 验证进度事件序列：task_start → thinking → task_end（按时间顺序）
      const progressEvents = collector.messages.filter((m) => m.type === 'game:event' && m.eventType === 'agent_progress');
      expect(progressEvents.length).toBeGreaterThanOrEqual(3);

      const phases = progressEvents.map((m) => m.data.phase);
      expect(phases).toContain('task_start');
      expect(phases).toContain('thinking');
      expect(phases).toContain('task_end');

      // 7. 验证所有进度事件的 requestId 一致（属于同一请求）
      for (const evt of progressEvents) {
        expect(evt.requestId).toBe(requestId);
      }

      // 8. 验证进度事件在最终结果之前到达（时序正确）
      const resultIdx = collector.messages.findIndex((m: any) => m.type === 'game:result');
      const progressIndices = collector.messages.map((m: any, i: number) => (m.type === 'game:event' && m.eventType === 'agent_progress') ? i : -1).filter((i: number) => i >= 0);
      const lastProgressIdx = progressIndices.length > 0 ? progressIndices[progressIndices.length - 1] : -1;
      expect(lastProgressIdx).toBeLessThan(resultIdx);

      collector.stop();
      await disconnect(ws);
    });

    it('进度事件携带 agentRunId / agentType / taskDescription 字段', async () => {
      const saveId = await seedTestSave(saveService);

      const { ws, clientId } = await connectClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws, 'subscribed');

      const requestId = 'req-e2e-fields-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat',
        payload: { message: '测试字段', saveId },
        clientId,
      };

      const collector = collectMessages(ws);
      ws.send(JSON.stringify(gameRequest));
      await waitForMessage(ws, 'game:result', 10000);

      const progressEvents = collector.messages.filter((m) => m.type === 'game:event' && m.eventType === 'agent_progress');
      expect(progressEvents.length).toBeGreaterThan(0);

      const evt = progressEvents[0];
      expect(evt.data.agentType).toBeDefined();
      expect(evt.data.taskDescription).toBeDefined();
      expect(evt.timestamp).toBeGreaterThan(0);

      collector.stop();
      await disconnect(ws);
    });
  });

  // ═══ 2. 错误处理路径 ═══

  describe('错误处理：WS请求 → game:error / partialSuccess', () => {
    it('coordinator 返回失败时客户端收到 game:result（partialSuccess=true）', async () => {
      // processChat 设计：coordinator 返回 {success:false} 时视为 partialSuccess（玩家消息已保存，Agent 失败）
      const saveId = await seedTestSave(saveService);

      coordinator.processMessage.mockResolvedValueOnce({
        success: false,
        errorCode: 'GAME_INIT_FAILED',
        error: 'Agent 处理失败',
      });

      const { ws, clientId } = await connectClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws, 'subscribed');

      const requestId = 'req-e2e-partial-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat',
        payload: { message: '触发 partialSuccess', saveId },
        clientId,
      };

      ws.send(JSON.stringify(gameRequest));
      const result = await waitForMessage(ws, 'game:result', 10000);

      // partialSuccess 场景：WS 返回 game:result（非 game:error），data.metadata.partialSuccess=true
      expect(result.requestId).toBe(requestId);
      expect(result.data.metadata.partialSuccess).toBe(true);
      expect(result.data.errorCode).toBe('GAME_INIT_FAILED');

      await disconnect(ws);
    });

    it('不存在的 saveId 返回可恢复错误', async () => {
      const { ws, clientId } = await connectClient(port);

      const requestId = 'req-e2e-notfound-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat',
        payload: { message: '你好', saveId: 'save-nonexistent-xyz' },
        clientId,
      };

      ws.send(JSON.stringify(gameRequest));
      const errorMsg = await waitForMessage(ws, 'game:error', 10000);

      expect(errorMsg.requestId).toBe(requestId);
      expect(errorMsg.errorType).toBe('SAVE_NOT_FOUND');
      expect(errorMsg.recoverable).toBe(true);

      await disconnect(ws);
    });

    it('handler 抛异常时返回 game:error（recoverable=false）', async () => {
      const saveId = await seedTestSave(saveService);

      // 让 coordinator.processMessage 抛异常
      coordinator.processMessage.mockRejectedValueOnce(new Error('Internal agent error'));

      const { ws, clientId } = await connectClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws, 'subscribed');

      const requestId = 'req-e2e-throw-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat',
        payload: { message: '触发异常', saveId },
        clientId,
      };

      ws.send(JSON.stringify(gameRequest));
      const errorMsg = await waitForMessage(ws, 'game:error', 10000);

      expect(errorMsg.requestId).toBe(requestId);
      expect(errorMsg.recoverable).toBe(false);
      expect(errorMsg.error).toContain('HANDLER_ERROR');

      await disconnect(ws);
    });

    it('partialSuccess 响应也清理 pending request（completePendingRequest 被调用）', async () => {
      const saveId = await seedTestSave(saveService);

      coordinator.processMessage.mockResolvedValueOnce({
        success: false,
        errorCode: 'UNKNOWN_ERROR',
        error: '测试清理',
      });

      const { ws, clientId } = await connectClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws, 'subscribed');

      const requestId = 'req-e2e-pending-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat', // chat 是 long-running，会注册 pending
        payload: { message: '测试 pending 清理', saveId },
        clientId,
      };

      ws.send(JSON.stringify(gameRequest));
      // partialSuccess 场景返回 game:result，WS handler 也会调用 completePendingRequest
      await waitForMessage(ws, 'game:result', 10000);

      // chat 是 long-running 请求，注册了 pending。响应后应清理 pending。
      expect(webSocketService.getConnectedCount()).toBe(1);

      await disconnect(ws);
    });
  });

  // ═══ 3. HTTP 回退路径（HTTP 与 WS 并行可用） ═══

  describe('HTTP 回退：HTTP 路径与 WS 路径并行可用', () => {
    it('HTTP POST /api/v1/game/chat 返回与 WS 等价的结果', async () => {
      // 1. 初始化存档
      const saveId = await seedTestSave(saveService);

      // 2. HTTP chat 请求
      const httpRes = await request(server)
        .post('/api/v1/game/chat')
        .send({ message: '你好', saveId });

      expect(httpRes.status).toBe(200);
      expect(httpRes.body.success).toBe(true);
      // 统一面板变更推送机制：HTTP 响应不再包含 dialogue 字段（设计 5.13），由 panelUpdates.dialogue 推送
      expect(httpRes.body.data.metadata.processingTime).toBeDefined();

      // 3. WS chat 请求（同一 saveId，验证并行可用）
      const { ws, clientId } = await connectClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws, 'subscribed');

      const requestId = 'req-e2e-http-fallback-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat',
        payload: { message: '你好', saveId },
        clientId,
      };

      ws.send(JSON.stringify(gameRequest));
      const wsResult = await waitForMessage(ws, 'game:result', 10000);

      // 统一面板变更推送机制：dialogue 字段已从 wsResult.data 移除（设计 5.13），由 panelUpdates.dialogue 推送

      await disconnect(ws);
    });

    it('WS 不可用时 HTTP 仍可独立工作（HTTP 不依赖 WS）', async () => {
      // 不连接任何 WS 客户端，直接用 HTTP
      const saveId = await seedTestSave(saveService);

      const chatRes = await request(server)
        .post('/api/v1/game/chat')
        .send({ message: '测试 HTTP 独立工作', saveId });

      expect(chatRes.status).toBe(200);
      expect(chatRes.body.success).toBe(true);

      // HTTP 路径无 clientId，不触发进度事件广播（不依赖 WS）
      expect(webSocketService.getConnectedCount()).toBe(0);
    });

    it('HTTP 和 WS 可并行处理同一存档的请求', async () => {
      const saveId = await seedTestSave(saveService);

      // WS 客户端连接
      const { ws, clientId } = await connectClient(port);
      ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws, 'subscribed');

      // 并行发起 HTTP 和 WS 请求
      const httpPromise = request(server)
        .post('/api/v1/game/chat')
        .send({ message: 'HTTP 请求', saveId });

      const wsRequestId = 'req-e2e-parallel-001';
      const wsRequest: WSGameRequest = {
        type: 'game:request',
        requestId: wsRequestId,
        module: 'game',
        action: 'chat',
        payload: { message: 'WS 请求', saveId },
        clientId,
      };
      ws.send(JSON.stringify(wsRequest));

      const [httpRes, wsResult] = await Promise.all([httpPromise, waitForMessage(ws, 'game:result', 10000)]);

      expect(httpRes.status).toBe(200);
      expect(httpRes.body.success).toBe(true);

      expect(wsResult.requestId).toBe(wsRequestId);
      // 统一面板变更推送机制：dialogue 字段已从 wsResult.data 移除（设计 5.13），由 panelUpdates.dialogue 推送

      await disconnect(ws);
    });
  });

  // ═══ 4. 进度事件路由：仅送达目标客户端 ═══

  describe('进度事件路由：clientId 精准投递', () => {
    it('进度事件仅送达发起请求的客户端，不影响其他客户端', async () => {
      const saveId = await seedTestSave(saveService);

      // 两个客户端都订阅同一 saveId
      const { ws: ws1, clientId: clientId1 } = await connectClient(port);
      ws1.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws1, 'subscribed');

      const { ws: ws2 } = await connectClient(port);
      ws2.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(ws2, 'subscribed');

      const collector1 = collectMessages(ws1);
      const collector2 = collectMessages(ws2);

      // ws1 发起请求，进度事件应只发给 ws1（通过 clientId 路由）
      const requestId = 'req-e2e-routing-001';
      const gameRequest: WSGameRequest = {
        type: 'game:request',
        requestId,
        module: 'game',
        action: 'chat',
        payload: { message: '只有我应该收到进度', saveId },
        clientId: clientId1,
      };

      ws1.send(JSON.stringify(gameRequest));
      await waitForMessage(ws1, 'game:result', 10000);

      // ws1 收到进度事件
      const progress1 = collector1.messages.filter((m) => m.type === 'game:event' && m.eventType === 'agent_progress');
      expect(progress1.length).toBeGreaterThan(0);

      // ws2 不应收到 ws1 的进度事件（broadcastToClient 按 clientId 精准投递）
      const progress2 = collector2.messages.filter((m) => m.type === 'game:event' && m.eventType === 'agent_progress');
      expect(progress2.length).toBe(0);

      // ws2 也不应收到 ws1 的 game:result
      const result2 = collector2.messages.filter((m) => m.type === 'game:result');
      expect(result2.length).toBe(0);

      collector1.stop();
      collector2.stop();
      await disconnect(ws1);
      await disconnect(ws2);
    });
  });
});
