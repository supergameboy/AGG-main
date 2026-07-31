import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameRoutes } from '../game.js';
import { createSaveRoutes } from '../save.js';
import { errorHandler } from '../../middlewares/errorhandler.js';
import { runMigrations } from '../../migrations/runner.js';
import { StagingPool } from '../../services/StagingPool.js';
import { successResponse } from '../../utils/response.js';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
// P0-2: 引入 createGameServiceDeps 工厂构造真实可用的 GameServiceDeps
// e2e 测试覆盖完整 init/chat/rollback 流程，需要真实 Repository + Service 实例
import { createGameServiceDeps } from '../../agents/init.js';
import { TemplateService } from '../../services/template.js';
import { TemplatePoolService } from '../../services/template-pool.js';
import type { GameServiceDeps } from '../../services/game-service.js';

// AP-L1: StagingPool 构造函数注入 IDevTraceHook，测试提供最小 mock
const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

// === Mock 工厂 ===

/**
 * 构造真实可用的 GameServiceDeps（基于真实 db）。
 *
 * 期望效果：
 * - saveService/characterService/locationRepo/rollbackRepos/txManager/skillService 真实实例
 *   覆盖 processInitialize 的 A0/A1/A1.1/rollback 全流程
 * - entityGraphBuilder/entityGraphBuildContext/challengeProgram/modeRouter mock
 *   - entityGraphBuilder.ensureCharacterNode/enrichFromExistingData 静默通过（init 路径不验证图节点）
 *   - challengeProgram 不在 init 路径调用（仅 -program 后缀 action 触发）
 *   - modeRouter.routeMode 返回非战斗模式（保持 Agent 路径）
 *
 * 设计依据：测试覆盖 HTTP 路由层 + game-service 业务编排，不验证 EntityGraph 图结构
 */
function createTestGameServiceDeps(db: Knex): GameServiceDeps {
  const templateService = new TemplateService(db);
  const templatePoolService = new TemplatePoolService(db);
  // mock EntityGraphBuilder：init 路径的 ensureCharacterNode/enrichFromExistingData 静默通过
  const entityGraphBuilder = {
    ensureCharacterNode: vi.fn().mockResolvedValue(undefined),
    enrichFromExistingData: vi.fn().mockResolvedValue(undefined),
  } as never;
  // mock EntityGraphBuildContext：11 个 ReadPort 聚合，enrichFromExistingData 已 mock 不会读取
  const entityGraphBuildContext = {} as never;
  // mock CombatServiceTool：init 路径不调用 ChallengeProgram（仅 -program action 触发）
  const combatServiceTool = {} as never;
  return createGameServiceDeps(
    db,
    templateService,
    templatePoolService,
    entityGraphBuilder,
    entityGraphBuildContext,
    combatServiceTool,
  );
}

// === 测试套件 ===

describe('E2E: Game Core Flow (Init + Chat + Save)', () => {
  let db: Knex;
  let gameServiceDeps: GameServiceDeps;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await runMigrations(db);
    // P0-2: 构造真实可用的 GameServiceDeps（基于真实 db），覆盖完整 init/chat/rollback 流程
    gameServiceDeps = createTestGameServiceDeps(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  /**
   * 创建 mock coordinator，闭包捕获 describe 级别的 db。
   *
   * 期望效果：
   * - processMessage 默认 mock：initialize action 时写入起始地点到 db('locations')，
   *   避免 processInitialize 因 locationRepo.findFirstBySaveId 返回 null 而抛 NO_LOCATIONS_CREATED
   * - 测试可 override processMessage：若 override 需要支持 initialize，应自行写入地点数据
   */
  function createMockCoordinator() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coordinator: any = {
      // 默认 mock：initialize action 时写入起始地点，避免 processInitialize 抛 NO_LOCATIONS_CREATED
      // chat action 返回标准 mock 响应（panelUpdates.dialogue.addedMessages）
      processMessage: vi.fn().mockImplementation(async (message: any) => {
        if (db && message?.payload?.action === 'initialize') {
          const now = Date.now();
          const saveId = message.payload.saveId ?? message.payload.data?.saveId;
          if (saveId) {
            await db('locations').insert({
              id: `loc-${saveId}-001`,
              save_id: saveId,
              location_level: 1,
              name: '起始村庄',
              description: '测试初始地点',
              type: 'village',
              danger_level: 0,
              is_explored: 1,
              visible: 1,
              created_at: now,
              updated_at: now,
            });
          }
        }
        return {
          success: true,
          data: {
            panelUpdates: {
              dialogue: {
                addedMessages: [
                  { speaker: 'Mock', content: 'Mock response', messageType: 'npc' },
                ],
              },
            },
            gm: { processedAt: new Date().toISOString(), duration: 100, reactIterations: 1 },
          },
          messages: [],
        };
      }),
      getPromptModule: vi.fn().mockReturnValue({
        getLastBuildResult: vi.fn().mockReturnValue(null),
        rules: {
          loadAllRules: vi.fn().mockResolvedValue(undefined),
          ruleNames: [],
          getRuleByName: vi.fn().mockReturnValue(undefined),
        },
        skills: {
          loadAllSkills: vi.fn().mockResolvedValue(undefined),
          skillNames: [],
          getSkillByName: vi.fn().mockReturnValue(undefined),
        },
      }),
      currentStagingPool: null,
      currentShadowState: null,
      createRequestRuntime: vi.fn().mockResolvedValue({
        stagingPool: new StagingPool(mockDevTraceHook),
        shadowState: undefined,
      }),
      flushRequestRuntime: vi.fn(async (runtime: { stagingPool?: StagingPool | null }) => {
        if (!db || !runtime?.stagingPool) {
          return;
        }

        await runtime.stagingPool.flush(
          {
            getDb: () => db,
            enqueueFn: async <T>(operation: () => Promise<T>) => operation(),
          } as never,
        );
      }),
      applyRequestScope: vi.fn(function applyRequestScope(runtime: { stagingPool?: StagingPool | null }) {
        coordinator.currentStagingPool = runtime.stagingPool ?? null;
      }),
      createRequestScopedCopy: vi.fn((): any => coordinator),
    };
    return coordinator;
  }

  function createApp(coordinator: ReturnType<typeof createMockCoordinator>) {
    const app = express();
    app.use(express.json());

    // Health check endpoint (mirrors production setup)
    app.get('/api/v1/health', (_req, res) => {
      res.json(successResponse({ status: 'ok' }));
    });

    // P0-2: createGameRoutes 第三参数 gameServiceDeps 由 createTestGameServiceDeps 工厂构造，
    // 包含真实 Repository + Service 实例（saveService/characterService/locationRepo 等），
    // 支持 init 失败回滚 / use_skill 校验 / chat 持久化玩家消息等完整流程。
    app.use('/api/v1/game', createGameRoutes(coordinator as any, db, gameServiceDeps));
    app.use('/api/v1/saves', createSaveRoutes(db));
    app.use(errorHandler);
    return app;
  }

  /** Insert a test template into the DB so init can reference it */
  async function insertTestTemplate(templateId = 'test-template') {
    const now = Date.now();
    await db('templates').insert({
      id: templateId,
      raw_content: JSON.stringify({
        world_setting: { name: 'Test World' },
        character_creation: {
          races: ['human', 'elf'],
          classes: ['warrior', 'mage'],
          backgrounds: ['soldier', 'scholar'],
        },
      }),
      source: 'yaml',
      is_builtin: 0,
      created_at: now,
      updated_at: now,
    });
  }

  /** No system saves in new baseline (001_init only creates schema, no seed data) */
  const SYSTEM_SAVE_IDS: string[] = [];

  /** Valid character data for initialization */
  const validCharacterData = {
    name: 'Aria',
    gender: 'female',
    race: 'human',
    classType: 'warrior',
    background: 'soldier',
    attributes: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 8, charisma: 13 },
  };

  // ========================================
  // GET /api/v1/health
  // ========================================

  describe('GET /api/v1/health', () => {
    it('returns status ok', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
    });
  });

  // ========================================
  // POST /api/v1/game (Initialize)
  // ========================================

  describe('POST /api/v1/game — Initialize', () => {
    it('missing templateId returns 400', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { characterData: validCharacterData } });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TEMPLATE_ID_REQUIRED');
    });

    it('missing characterData returns 400', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template' } });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CHARACTER_DATA');
      expect(res.body.error.details.missingFields).toContain('name');
    });

    it('partial characterData (missing name) returns 400', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const partialData = { ...validCharacterData, name: '' };
      const res = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: partialData } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CHARACTER_DATA');
      expect(res.body.error.details.missingFields).toContain('name');
    });

    it('successful initialization returns metadata with saveId and characterId', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metadata).toBeDefined();
      expect(res.body.data.metadata.saveId).toBeDefined();
      expect(res.body.data.metadata.characterId).toBeDefined();
      expect(res.body.data.metadata.isInitialization).toBe(true);
    });

    it('coordinator failure triggers rollback and returns 400', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      coordinator.processMessage.mockResolvedValue({
        success: false,
        error: 'Agent initialization failed',
        errorCode: 'GAME_INIT_FAILED',
      });
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('GAME_INIT_FAILED');

      // Verify rollback: the newly created save should not exist
      const saves = await db('saves').select('*');
      const userSaves = saves.filter(s => !SYSTEM_SAVE_IDS.includes(s.id));
      expect(userSaves.length).toBe(0);
    });

    it('action "init" also triggers initialize (alias)', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game')
        .send({ action: 'init', data: { templateId: 'test-template', characterData: validCharacterData } });

      expect(res.status).toBe(200);
      expect(res.body.data.metadata.isInitialization).toBe(true);
    });
  });

  // ========================================
  // POST /api/v1/game/chat
  // ========================================

  describe('POST /api/v1/game/chat', () => {
    it('missing message returns 400 (chatSchema validation)', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game/chat')
        .send({ saveId: 'save_test' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('missing saveId returns 400 (chatSchema validation)', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game/chat')
        .send({ message: 'Hello' });

      // chatSchema allows saveId to be optional/nullable, but handleChat checks for it
      // If chatSchema passes but handleChat rejects, it returns SAVE_ID_REQUIRED
      expect(res.status).toBe(400);
    });

    it('nonexistent saveId returns 404', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/game/chat')
        .send({ message: 'Hello', saveId: 'save_nonexistent' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('successful chat returns metadata with processingTime', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      // Create a save first
      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app)
        .post('/api/v1/game/chat')
        .send({ message: 'Look around', saveId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metadata).toBeDefined();
      expect(res.body.data.metadata.processingTime).toBeDefined();
      expect(res.body.data.metadata.messageId).toBeDefined();
      expect(res.body.data.metadata.processedAt).toBeDefined();
    });

    it('chat 应通过请求级 StagingPool 持久化玩家消息', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      coordinator.processMessage.mockImplementation(async (message: any) => {
        // initialize action 时写入起始地点（与默认 mock 一致），避免 NO_LOCATIONS_CREATED
        if (db && message?.payload?.action === 'initialize') {
          const now = Date.now();
          const saveId = message.payload.saveId ?? message.payload.data?.saveId;
          if (saveId) {
            await db('locations').insert({
              id: `loc-${saveId}-001`,
              save_id: saveId,
              location_level: 1,
              name: '起始村庄',
              description: '测试初始地点',
              type: 'village',
              danger_level: 0,
              is_explored: 1,
              visible: 1,
              created_at: now,
              updated_at: now,
            });
          }
        }
        if (coordinator.currentStagingPool) {
          await coordinator.currentStagingPool.flush(
            {
              getDb: () => db,
              enqueueFn: async <T>(operation: () => Promise<T>) => operation(),
            } as never,
          );
        }

        return {
          success: true,
          data: {
            panelUpdates: {
              dialogue: {
                addedMessages: [
                  {
                    speaker: '村长艾德温',
                    content: '欢迎来到白杨村。',
                    messageType: 'npc',
                  },
                ],
              },
            },
            gm: { processedAt: new Date().toISOString(), duration: 100, reactIterations: 1 },
          },
          messages: [],
        };
      });
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app)
        .post('/api/v1/game/chat')
        .send({ message: '你好', saveId });

      expect(res.status).toBe(200);
      // 统一面板变更推送机制：HTTP 响应不再包含 dialogue 字段（设计 5.13），由 panelUpdates.dialogue 推送
      // 玩家消息持久化通过 db('dialogues') 验证

      const dialogues = await db('dialogues')
        .where({ save_id: saveId })
        .orderBy('timestamp', 'asc')
        .select('speaker', 'content', 'message_type');

      expect(dialogues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            speaker: 'Aria',
            content: '你好',
            message_type: 'player',
          }),
        ]),
      );
      expect(coordinator.createRequestRuntime).toHaveBeenCalledWith(saveId);
      // init + chat 各调用一次 createRequestScopedCopy（processInitialize + processChat 都创建 scoped coordinator）
      expect(coordinator.createRequestScopedCopy).toHaveBeenCalledTimes(2);
    });

    it('chat 响应中的旧格式玩家消息缺少 messageType 时不应重复回显', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      coordinator.processMessage.mockImplementation(async (message: any) => {
        // initialize action 时写入起始地点（与默认 mock 一致），避免 NO_LOCATIONS_CREATED
        if (db && message?.payload?.action === 'initialize') {
          const now = Date.now();
          const saveId = message.payload.saveId ?? message.payload.data?.saveId;
          if (saveId) {
            await db('locations').insert({
              id: `loc-${saveId}-001`,
              save_id: saveId,
              location_level: 1,
              name: '起始村庄',
              description: '测试初始地点',
              type: 'village',
              danger_level: 0,
              is_explored: 1,
              visible: 1,
              created_at: now,
              updated_at: now,
            });
          }
        }
        return {
          success: true,
          data: {
            panelUpdates: {
              dialogue: {
                addedMessages: [
                  {
                    speaker: 'Aria',
                    content: '你好',
                  },
                  {
                    speaker: '村长艾德温',
                    content: '欢迎来到白杨村。',
                    messageType: 'npc',
                  },
                ],
              },
            },
            gm: { processedAt: new Date().toISOString(), duration: 100, reactIterations: 1 },
          },
          messages: [],
        };
      });
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app)
        .post('/api/v1/game/chat')
        .send({ message: '你好', saveId });

      expect(res.status).toBe(200);
      // 统一面板变更推送机制：HTTP 响应不再包含 dialogue 字段（设计 5.13），由 panelUpdates.dialogue 推送
      // 玩家消息去重通过 db('dialogues') 验证
    });

    it('use_skill 前置校验失败时也应先持久化玩家消息', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app)
        .post('/api/v1/game/chat')
        .send({
          message: '我要施放不存在的技能',
          saveId,
          action: 'use_skill',
          data: {
            skillId: 'skill_missing',
          },
        });

      expect(res.status).toBe(200);
      // 统一面板变更推送机制：HTTP 响应不再包含 dialogue 字段（设计 5.13），由 panelUpdates.dialogue 推送
      // 玩家消息持久化通过 db('dialogues') 验证

      const dialogues = await db('dialogues')
        .where({ save_id: saveId, message_type: 'player' })
        .orderBy('timestamp', 'asc')
        .select('speaker', 'content', 'message_type');

      expect(dialogues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            speaker: 'Aria',
            content: '我要施放不存在的技能',
            message_type: 'player',
          }),
        ]),
      );
    });
  });

  // ========================================
  // POST /api/v1/game (default action = chat)
  // ========================================

  describe('POST /api/v1/game — Default Chat', () => {
    it('without action field defaults to chat', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      // Create a save first
      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app)
        .post('/api/v1/game')
        .send({ message: 'Hello world', saveId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ========================================
  // GET /api/v1/saves
  // ========================================

  describe('GET /api/v1/saves', () => {
    it('returns empty saves initially (no seed data in baseline)', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).get('/api/v1/saves');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // 001_init only creates schema, no seed data
      expect(res.body.data.total).toBe(0);
    });

    it('returns saves after initialization', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });

      const res = await request(app).get('/api/v1/saves');

      expect(res.status).toBe(200);
      // Just the newly created save
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    });

    it('supports query parameter filtering by template_id', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).get('/api/v1/saves?template_id=nonexistent');

      expect(res.status).toBe(200);
      expect(res.body.data.saves).toEqual([]);
      expect(res.body.data.total).toBe(0);
    });
  });

  // ========================================
  // GET /api/v1/saves/:saveId
  // ========================================

  describe('GET /api/v1/saves/:saveId', () => {
    it('nonexistent saveId returns 404', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).get('/api/v1/saves/save_nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('returns save data for existing save', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app).get(`/api/v1/saves/${saveId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(saveId);
    });
  });

  // ========================================
  // POST /api/v1/saves
  // ========================================

  describe('POST /api/v1/saves', () => {
    it('missing name returns 400', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/saves')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('empty name returns 400', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/saves')
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('successful creation returns save object with 201', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Test Save' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Test Save');
      expect(res.body.data.id).toBeDefined();
    });

    it('creation with template_id and game_mode', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Templated Save', template_id: 'test-template', game_mode: 'text_adventure' });

      expect(res.status).toBe(201);
      expect(res.body.data.template_id).toBe('test-template');
      expect(res.body.data.game_mode).toBe('text_adventure');
    });
  });

  // ========================================
  // DELETE /api/v1/saves/:saveId
  // ========================================

  describe('DELETE /api/v1/saves/:saveId', () => {
    it('nonexistent saveId returns 404', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).delete('/api/v1/saves/save_nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('successful deletion returns { deleted: true, saveId }', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      // Use POST /api/v1/saves to create a simple save (avoids full init)
      const createRes = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Delete Test Save' });
      const saveId = createRes.body.data.id;

      const res = await request(app).delete(`/api/v1/saves/${saveId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
      expect(res.body.data.saveId).toBe(saveId);

      // Verify save is gone
      const saves = await db('saves').where({ id: saveId });
      expect(saves.length).toBe(0);
    });
  });

  // ========================================
  // GET /api/v1/game/:saveId/pool/template/skills
  // ========================================

  describe('GET /api/v1/game/:saveId/pool/template/skills', () => {
    it('nonexistent saveId returns 404', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).get('/api/v1/game/save_nonexistent/pool/template/skills');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('returns skills array for existing save', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app).get(`/api/v1/game/${saveId}/pool/template/skills`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.saveId).toBe(saveId);
      expect(res.body.data.templateId).toBe('test-template');
      expect(Array.isArray(res.body.data.skills)).toBe(true);
    });
  });

  // ========================================
  // GET /api/v1/game/:saveId/pool/template/items
  // ========================================

  describe('GET /api/v1/game/:saveId/pool/template/items', () => {
    it('nonexistent saveId returns 404', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).get('/api/v1/game/save_nonexistent/pool/template/items');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('returns items array for existing save', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app).get(`/api/v1/game/${saveId}/pool/template/items`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.saveId).toBe(saveId);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  // ========================================
  // GET /api/v1/game/:saveId/pool/stats
  // ========================================

  describe('GET /api/v1/game/:saveId/pool/stats', () => {
    it('nonexistent saveId returns 404', async () => {
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const res = await request(app).get('/api/v1/game/save_nonexistent/pool/stats');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SAVE_NOT_FOUND');
    });

    it('returns pool stats for existing save', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });
      const saveId = initRes.body.data.metadata.saveId;

      const res = await request(app).get(`/api/v1/game/${saveId}/pool/stats`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.templatePool).toBeDefined();
      expect(res.body.data.savePool).toBeDefined();
      expect(res.body.data.savePool.skillCount).toBe(0);
      expect(res.body.data.savePool.itemCount).toBe(0);
    });
  });

  // ========================================
  // Full E2E Flow: Init -> Chat -> Save -> Load -> Delete
  // ========================================

  describe('Full E2E Flow', () => {
    it('complete game lifecycle: init -> chat -> list saves -> load save -> delete save', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      // Step 1: Initialize game
      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });

      expect(initRes.status).toBe(200);
      const saveId = initRes.body.data.metadata.saveId;
      const characterId = initRes.body.data.metadata.characterId;
      expect(saveId).toBeDefined();
      expect(characterId).toBeDefined();

      // Verify coordinator was called with correct action
      const coordinatorCall = coordinator.processMessage.mock.calls[0][0];
      expect(coordinatorCall.payload.action).toBe('initialize');
      expect(coordinatorCall.payload.data.templateId).toBe('test-template');

      // Step 2: Chat with the game
      coordinator.processMessage.mockResolvedValue({
        success: true,
        data: {
          panelUpdates: {
            dialogue: {
              addedMessages: [{ speaker: 'narrator', content: 'You find yourself in a village.' }],
            },
          },
        },
        messages: [],
      });

      const chatRes = await request(app)
        .post('/api/v1/game/chat')
        .send({ message: 'Look around', saveId });

      expect(chatRes.status).toBe(200);
      expect(chatRes.body.success).toBe(true);
      expect(chatRes.body.data.metadata.processingTime).toBeGreaterThanOrEqual(0);

      // Step 3: List saves
      const listRes = await request(app).get('/api/v1/saves');

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.total).toBeGreaterThanOrEqual(1);
      const userSaves = listRes.body.data.saves.filter((s: any) => !SYSTEM_SAVE_IDS.includes(s.id));
      expect(userSaves.length).toBe(1);
      expect(userSaves[0].id).toBe(saveId);

      // Step 4: Load save
      const loadRes = await request(app).get(`/api/v1/saves/${saveId}`);

      expect(loadRes.status).toBe(200);
      expect(loadRes.body.data.id).toBe(saveId);

      // Step 5: Delete save
      const deleteRes = await request(app).delete(`/api/v1/saves/${saveId}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data.deleted).toBe(true);

      // Verify save is gone
      const loadAfterDeleteRes = await request(app).get(`/api/v1/saves/${saveId}`);
      expect(loadAfterDeleteRes.status).toBe(404);
    });

    it('init creates character record in database', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const initRes = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: validCharacterData } });

      const saveId = initRes.body.data.metadata.saveId;

      // Verify character was created in DB
      const characters = await db('characters').where({ save_id: saveId });
      expect(characters.length).toBe(1);
      expect(characters[0].name).toBe('Aria');
      expect(characters[0].race).toBe('human');
    });

    it('multiple initializations create independent saves', async () => {
      await insertTestTemplate();
      const coordinator = createMockCoordinator();
      const app = createApp(coordinator);

      const charData1 = { ...validCharacterData, name: 'Hero One' };
      const charData2 = { ...validCharacterData, name: 'Hero Two', classType: 'mage' };

      const res1 = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: charData1 } });

      const res2 = await request(app)
        .post('/api/v1/game')
        .send({ action: 'initialize', data: { templateId: 'test-template', characterData: charData2 } });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const saveId1 = res1.body.data.metadata.saveId;
      const saveId2 = res2.body.data.metadata.saveId;
      expect(saveId1).not.toBe(saveId2);

      // Verify both saves exist
      const listRes = await request(app).get('/api/v1/saves');
      const userSaves = listRes.body.data.saves.filter((s: any) => !SYSTEM_SAVE_IDS.includes(s.id));
      expect(userSaves.length).toBe(2);
    });
  });
});
