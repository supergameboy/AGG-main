import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevRoutes } from '../dev.js';
import { errorHandler } from '../../middlewares/errorhandler.js';
import type { DevModeService } from '../../services/DevModeService.js';
import { DevTraceCollector } from '../../services/DevTraceCollector.js';
import type { StoryPostReactDevtoolsTrace } from '../../agents/story/types.js';
import type { AgentTraceData } from '../../services/TraceCollector.js';

// === Mock 工厂 ===

function createPromptBuildResult() {
  return {
    systemPrompt: 'system prompt',
    userPrompt: 'user prompt',
    apiTools: [
      {
        type: 'function',
        function: {
          name: 'map_service__get_current_top_location',
          description: '查询玩家当前位置',
          parameters: {},
        },
      },
    ],
    allowedFunctionNames: new Set(['map_service__get_current_top_location']),
    toolVisibilityTrace: [
      {
        toolType: 'map_service',
        methodNames: ['get_current_top_location'],
      },
    ],
    toolExposureTrace: {
      visibleTools: [
        {
          toolType: 'map_service',
          methodName: 'get_current_top_location',
          functionName: 'map_service__get_current_top_location',
          summary: '查询玩家当前位置',
          riskLevel: 'read_only',
        },
      ],
      deferredTools: [
        {
          toolType: 'map_service',
          methodName: 'move_to',
          functionName: 'map_service__move_to',
          summary: '查询并执行地点移动',
          riskLevel: 'write_high',
        },
      ],
      visibleHelpSummaries: [],
      budget: {
        maxVisibleTools: 1,
        usedVisibleTools: 1,
        maxVisibleHelpDocs: 1,
        usedVisibleHelpDocs: 1,
        maxToolSummaryTokens: 100,
        usedToolSummaryTokens: 20,
        maxHelpSummaryTokens: 100,
        usedHelpSummaryTokens: 20,
        maxOnDemandLoadsPerTurn: 2,
        usedOnDemandLoads: 1,
      },
      trimmedReasons: ['maxVisibleTools exceeded'],
    },
    systemPromptTrace: {
      content: 'system prompt',
      totalTokens: 10,
      layers: [],
    },
    userPromptTrace: {
      content: 'user prompt',
      totalTokens: 5,
      action: 'chat',
      intentHint: 'travel',
      blocks: [],
    },
  };
}

function createMockCoordinator() {
  const promptModule = {
    build: vi.fn().mockResolvedValue(createPromptBuildResult()),
    buildPreview: vi.fn().mockResolvedValue(createPromptBuildResult()),
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
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coordinator: any = {
    processMessage: vi.fn().mockResolvedValue({ success: true, data: { result: 'ok' } }),
    getPromptModule: vi.fn().mockReturnValue(promptModule),
    getPromptAgentConfig: vi.fn().mockImplementation((agentKey: string) => {
      if (agentKey === 'gamemaster') {
        return {
          tools: ['map_service'],
          maxIterations: 9,
          toolBudget: {
            maxVisibleTools: 1,
            maxVisibleHelpDocs: 1,
            maxToolSummaryTokens: 100,
            maxHelpSummaryTokens: 100,
            maxOnDemandLoadsPerTurn: 2,
          },
        };
      }
      return null;
    }),
    // v2 模块F D5: 请求级实例化——返回 coordinator 自身（scoped agent 用完即丢）
    createRequestScopedCopy: vi.fn((): any => coordinator),
  };
  return coordinator;
}

function createMockDevModeService(overrides?: Partial<DevModeService>): DevModeService {
  const traceData: AgentTraceData = {
    requestId: 'test-req-id',
    agentTraces: [
      {
        agentType: 'output',
        iterations: 2,
        maxIterations: 5,
        reachedMax: false,
        toolCalls: [
          { iteration: 1, tool: 'dialogue_service', args: { npcId: 'npc-1' }, resultPreview: '...', duration: 10, isReadOperation: true },
        ],
        tokenUsage: { input: 100, output: 50, total: 150, cacheHit: 20, cacheMiss: 80 },
        finalAnswer: 'test answer',
        llmInputs: [],
      },
    ],
    coordinatorDecisions: [{ intent: 'chat', routedAgents: ['output'] }],
  };

  return {
    createRequestContext: vi.fn().mockReturnValue('mock-ctx-id'),
    getRequestContext: vi.fn().mockReturnValue({
      requestId: 'mock-ctx-id',
      createdAt: Date.now(),
      agentTrace: traceData,
      coordinatorDecisions: traceData.coordinatorDecisions,
    }),
    cleanupRequestContext: vi.fn(),
    loadPreset: vi.fn().mockResolvedValue({
      templateId: 'medieval-fantasy',
      name: 'Test Warrior',
      gender: 'male' as const,
      race: 'human',
      classType: 'warrior',
      background: 'soldier',
      attributes: { strength: 16 },
      language: 'zh-CN',
    }),
    listPresets: vi.fn().mockReturnValue([
      { template: 'medieval-fantasy', preset: 'warrior' },
      { template: 'medieval-fantasy', preset: 'mage' },
    ]),
    validatePreset: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    resolveTemplateId: vi.fn().mockResolvedValue('medieval-fantasy'),
    getTokenUsageForSave: vi.fn().mockResolvedValue({
      input: 100, output: 50, total: 150, cacheHit: 20, cacheMiss: 80,
    }),
    detectRedundantReads: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as DevModeService;
}

// === 测试套件 ===

describe('Dev Mode API — 5 个新端点', () => {
  let db: Knex;
  let originalNodeEnv: string | undefined;
  let originalDevApiKey: string | undefined;

  beforeEach(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    originalDevApiKey = process.env.DEV_API_KEY;
    // 测试默认在开发环境
    process.env.NODE_ENV = 'development';
    delete process.env.DEV_API_KEY;

    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable('dev_snapshots', (table) => {
      table.text('id').primary();
      table.text('type');
      table.text('data');
      table.text('store_names');
      table.text('session_id');
      table.integer('timestamp');
      table.integer('created_at');
    });
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDevApiKey !== undefined) {
      process.env.DEV_API_KEY = originalDevApiKey;
    } else {
      delete process.env.DEV_API_KEY;
    }
    await db.destroy();
  });

  function createApp(
    coordinator?: ReturnType<typeof createMockCoordinator>,
    devModeService?: DevModeService,
    devTraceCollector?: DevTraceCollector,
  ) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/dev', createDevRoutes(db, coordinator, devModeService, undefined, devTraceCollector));
    app.use(errorHandler);
    return app;
  }

  // ========================================
  // 环境保护中间件
  // ========================================

  describe('环境保护中间件', () => {
    it('生产环境返回 403', async () => {
      process.env.NODE_ENV = 'production';
      const app = createApp();

      const res = await request(app).get('/api/v1/dev/presets');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Dev API disabled in production');
    });

    it('非生产环境允许访问', async () => {
      process.env.NODE_ENV = 'development';
      const devService = createMockDevModeService();
      const app = createApp(undefined, devService);

      const res = await request(app).get('/api/v1/dev/presets');

      expect(res.status).toBe(200);
    });
  });

  // ========================================
  // API Key 校验
  // ========================================

  describe('API Key 校验', () => {
    it('设置了 DEV_API_KEY 但请求无 key 头时返回 401', async () => {
      process.env.DEV_API_KEY = 'test-secret';
      const devService = createMockDevModeService();
      const app = createApp(undefined, devService);

      const res = await request(app).get('/api/v1/dev/presets');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid dev API key');
    });

    it('设置了 DEV_API_KEY 且 key 头正确时允许访问', async () => {
      process.env.DEV_API_KEY = 'test-secret';
      const devService = createMockDevModeService();
      const app = createApp(undefined, devService);

      const res = await request(app)
        .get('/api/v1/dev/presets')
        .set('x-dev-api-key', 'test-secret');

      expect(res.status).toBe(200);
    });

    it('设置了 DEV_API_KEY 但 key 头错误时返回 401', async () => {
      process.env.DEV_API_KEY = 'test-secret';
      const devService = createMockDevModeService();
      const app = createApp(undefined, devService);

      const res = await request(app)
        .get('/api/v1/dev/presets')
        .set('x-dev-api-key', 'wrong-key');

      expect(res.status).toBe(401);
    });

    it('未设置 DEV_API_KEY 时不校验 key', async () => {
      delete process.env.DEV_API_KEY;
      const devService = createMockDevModeService();
      const app = createApp(undefined, devService);

      const res = await request(app).get('/api/v1/dev/presets');

      expect(res.status).toBe(200);
    });
  });

  // ========================================
  // POST /quick-init
  // ========================================

  describe('POST /quick-init', () => {
    it('缺少 preset 字段返回 400', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/quick-init')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('coordinator 或 devModeService 不可用时返回 503', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/v1/dev/quick-init')
        .send({ preset: 'medieval-fantasy/warrior' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('预设校验失败返回 400', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService({
        validatePreset: vi.fn().mockResolvedValue({
          valid: false,
          errors: ['Race "orc" not in template'],
          warnings: [],
        }),
      } as unknown as Partial<DevModeService>);
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/quick-init')
        .send({ preset: 'medieval-fantasy/warrior' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PRESET');
    });

    it('成功初始化返回 200 及完整响应结构', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/quick-init')
        .send({ preset: 'medieval-fantasy/warrior' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.metadata).toBeDefined();
      expect(res.body.data.metadata.saveId).toMatch(/^save_/);
      expect(res.body.data.metadata.preset).toBe('medieval-fantasy/warrior');
      expect(res.body.data.trace).toBeDefined();
    });

    it('coordinator 返回失败时返回 400', async () => {
      const coordinator = createMockCoordinator();
      coordinator.processMessage.mockResolvedValue({
        success: false,
        error: 'Init failed',
        errorCode: 'INIT_ERROR',
      });
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/quick-init')
        .send({ preset: 'medieval-fantasy/warrior' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INIT_ERROR');
    });

    it('调用 coordinator 时 to 字段为 gamemaster', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      await request(app)
        .post('/api/v1/dev/quick-init')
        .send({ preset: 'medieval-fantasy/warrior' });

      const callArg = coordinator.processMessage.mock.calls[0][0];
      expect(callArg.to).toBe('gamemaster');
      expect(callArg.payload.action).toBe('initialize');
    });
  });

  // ========================================
  // POST /agent-trace
  // ========================================

  describe('POST /agent-trace', () => {
    it('缺少 message 或 saveId 返回 400', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('缺少 message 返回 400', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ saveId: 'save-1' });

      expect(res.status).toBe(400);
    });

    it('coordinator 或 devModeService 不可用时返回 503', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1' });

      expect(res.status).toBe(503);
    });

    it('to 字段始终为 gamemaster，agentType 作为 _devTargetAgentType 传递', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1', agentType: 'challenge' });

      const callArg = coordinator.processMessage.mock.calls[0][0];
      // to 始终为 gamemaster，不绕过路由
      expect(callArg.to).toBe('gamemaster');
      // agentType 作为 _devTargetAgentType 在 data 中传递
      expect(callArg.payload.data._devTargetAgentType).toBe('challenge');
    });

    it('无效 agentType 不阻止请求，仍作为 _devTargetAgentType 传递', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1', agentType: 'invalid-type' });

      // 请求仍然成功（无效 agentType 仅记录 warn，不阻止）
      expect(res.status).toBe(200);
      // 无效 agentType 仍然作为 _devTargetAgentType 传递
      const callArg = coordinator.processMessage.mock.calls[0][0];
      expect(callArg.payload.data._devTargetAgentType).toBe('invalid-type');
    });

    it('成功返回包含 summary 聚合字段', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1' });

      expect(res.status).toBe(200);
      expect(res.body.data.summary).toBeDefined();
      expect(res.body.data.summary.totalIterations).toBe(2);
      expect(res.body.data.summary.totalToolCalls).toBe(1);
      expect(res.body.data.summary.totalTokens).toEqual({
        input: 100,
        output: 50,
        total: 150,
        cacheHit: 20,
        cacheMiss: 80,
      });
      expect(res.body.data.summary.redundantReads).toBe(0);
    });

    it('成功返回包含 coordinatorDecisions 字段', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1' });

      expect(res.status).toBe(200);
      expect(res.body.data.coordinatorDecisions).toEqual([
        { intent: 'chat', routedAgents: ['output'] },
      ]);
    });

    it('trace 为空时 summary 为 null', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService({
        getRequestContext: vi.fn().mockReturnValue({
          requestId: 'mock-ctx-id',
          createdAt: Date.now(),
          // 无 agentTrace
        }),
      } as unknown as Partial<DevModeService>);
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1' });

      expect(res.status).toBe(200);
      expect(res.body.data.summary).toBeNull();
      expect(res.body.data.coordinatorDecisions).toEqual([]);
    });

    it('默认 action 为 chat', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1' });

      const callArg = coordinator.processMessage.mock.calls[0][0];
      expect(callArg.payload.action).toBe('chat');
    });

    it('可自定义 action', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      await request(app)
        .post('/api/v1/dev/agent-trace')
        .send({ message: 'hello', saveId: 'save-1', action: 'attack' });

      const callArg = coordinator.processMessage.mock.calls[0][0];
      expect(callArg.payload.action).toBe('attack');
    });
  });

  // ========================================
  // POST /ab-test
  // ========================================

  describe('POST /ab-test', () => {
    it('缺少必填字段返回 400', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/ab-test')
        .send({ preset: 'medieval-fantasy/warrior' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('coordinator 或 devModeService 不可用时返回 503', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/v1/dev/ab-test')
        .send({ preset: 'p', message: 'm', label: 'l' });

      expect(res.status).toBe(503);
    });

    it('dryRun 模式仅校验预设不调用 LLM', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/ab-test')
        .send({ preset: 'medieval-fantasy/warrior', message: 'hello', label: 'test-label', dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.label).toBe('test-label');
      expect(res.body.data.validation).toBeDefined();
      expect(res.body.data.validation.valid).toBe(true);
      // dryRun 不应调用 coordinator
      expect(coordinator.processMessage).not.toHaveBeenCalled();
    });

    it('dryRun 预设校验失败时仍返回 200（dryRun 不阻止）', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService({
        validatePreset: vi.fn().mockResolvedValue({
          valid: false,
          errors: ['Invalid race'],
          warnings: [],
        }),
      } as unknown as Partial<DevModeService>);
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/ab-test')
        .send({ preset: 'medieval-fantasy/warrior', message: 'hello', label: 'test-label', dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.data.validation.valid).toBe(false);
    });

    it('正式模式成功返回完整结构含 summary.agentBreakdown', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/ab-test')
        .send({ preset: 'medieval-fantasy/warrior', message: 'hello', label: 'test-label' });

      expect(res.status).toBe(200);
      expect(res.body.data.label).toBe('test-label');
      expect(res.body.data.init).toBeDefined();
      expect(res.body.data.init.success).toBe(true);
      expect(res.body.data.trace).toBeDefined();
      expect(res.body.data.summary).toBeDefined();
      expect(res.body.data.summary.agentBreakdown).toBeDefined();
      expect(res.body.data.summary.agentBreakdown.length).toBeGreaterThan(0);
      expect(res.body.data.summary.agentBreakdown[0]).toEqual(
        expect.objectContaining({
          agentType: expect.any(String),
          iterations: expect.any(Number),
          toolCalls: expect.any(Number),
          tokens: expect.any(Number),
        }),
      );
      expect(res.body.data.snapshotId).toBeDefined();
      expect(res.body.data.overallProcessingTime).toBeDefined();
    });

    it('正式模式 init 失败返回 400', async () => {
      const coordinator = createMockCoordinator();
      // 第一次调用（init）失败
      coordinator.processMessage
        .mockResolvedValueOnce({ success: false, error: 'Init failed' })
        .mockResolvedValueOnce({ success: true, data: { result: 'ok' } });
      const devService = createMockDevModeService();
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/ab-test')
        .send({ preset: 'medieval-fantasy/warrior', message: 'hello', label: 'test-label' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AB_TEST_INIT_FAILED');
    });

    it('正式模式预设校验失败返回 400', async () => {
      const coordinator = createMockCoordinator();
      const devService = createMockDevModeService({
        validatePreset: vi.fn().mockResolvedValue({
          valid: false,
          errors: ['Invalid race'],
          warnings: [],
        }),
      } as unknown as Partial<DevModeService>);
      const app = createApp(coordinator, devService);

      const res = await request(app)
        .post('/api/v1/dev/ab-test')
        .send({ preset: 'medieval-fantasy/warrior', message: 'hello', label: 'test-label' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PRESET');
    });
  });

  // ========================================
  // GET /presets
  // ========================================

  describe('GET /presets', () => {
    it('返回预设列表', async () => {
      const devService = createMockDevModeService();
      const app = createApp(undefined, devService);

      const res = await request(app).get('/api/v1/dev/presets');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([
        { template: 'medieval-fantasy', preset: 'warrior' },
        { template: 'medieval-fantasy', preset: 'mage' },
      ]);
    });

    it('devModeService 不可用时返回 503', async () => {
      const app = createApp();

      const res = await request(app).get('/api/v1/dev/presets');

      expect(res.status).toBe(503);
    });
  });

  // ========================================
  // GET /presets/:preset
  // ========================================

  describe('GET /presets/:template/:preset', () => {
    it('返回预设详情', async () => {
      const devService = createMockDevModeService();
      const app = createApp(undefined, devService);

      const res = await request(app).get('/api/v1/dev/presets/medieval-fantasy/warrior');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Test Warrior');
      expect(res.body.data.race).toBe('human');
    });

    it('预设不存在返回 404', async () => {
      const devService = createMockDevModeService({
        loadPreset: vi.fn().mockRejectedValue(new Error('Preset not found: "nonexistent/preset"')),
      } as unknown as Partial<DevModeService>);
      const app = createApp(undefined, devService);

      const res = await request(app).get('/api/v1/dev/presets/nonexistent/preset');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
    });

    it('无效预设格式返回 404', async () => {
      const devService = createMockDevModeService({
        loadPreset: vi.fn().mockRejectedValue(new Error('Invalid preset format: "bad"')),
      } as unknown as Partial<DevModeService>);
      const app = createApp(undefined, devService);

      const res = await request(app).get('/api/v1/dev/presets/bad/preset');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRESET_NOT_FOUND');
    });

    it('devModeService 不可用时返回 503', async () => {
      const app = createApp();

      const res = await request(app).get('/api/v1/dev/presets/test/preset');

      expect(res.status).toBe(503);
    });
  });

  // ========================================
  // GET /post-react-traces
  // ========================================

  describe('GET /post-react-traces', () => {
    it('返回 post-react traces，并按 story_post_react 类型过滤', async () => {
      const devTraceCollector = new DevTraceCollector();
      const postReactTrace: StoryPostReactDevtoolsTrace = {
        phase: 'post-react',
        repairRoundCount: 1,
        requiresRepair: false,
        decisionSummary: {
          todoCompletion: 'partial',
          auditPassed: false,
          auditRootCause: 'context_injection_error',
          storyConsistency: 'partial_match',
          secondLayerDecisionValid: true,
        },
        repairReasons: [],
        resolvedLayer1Agents: ['npc_party'],
        needAgentReasons: ['需要补齐 NPC 反应'],
        runtimeCommitSummary: {
          wrotePostReviewDecision: true,
          wroteContinuityAudit: true,
          wroteTodoCompletion: true,
          wroteRepairMetadata: true,
        },
      };
      devTraceCollector.addTrace('save-1', {
        type: 'story_post_react',
        data: postReactTrace as any,
        timestamp: 1718000000000,
      });
      devTraceCollector.addTrace('save-1', {
        type: 'staging_commit',
        data: { total: 1, succeeded: 1, failed: 0 },
        timestamp: 1718000001000,
      });
      const app = createApp(undefined, createMockDevModeService(), devTraceCollector);

      const res = await request(app)
        .get('/api/v1/dev/post-react-traces')
        .query({ saveId: 'save-1', limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        saveId: 'save-1',
        traceCount: 1,
      });
      expect(res.body.data.postReactTraces).toEqual([
        expect.objectContaining({
          type: 'story_post_react',
          timestamp: 1718000000000,
          data: expect.objectContaining({
            phase: 'post-react',
            repairRoundCount: 1,
            decisionSummary: expect.objectContaining({
              storyConsistency: 'partial_match',
            }),
          }),
        }),
      ]);
    });

    it('collector 不可用时应返回 503，而不是伪装成空数据', async () => {
      const app = createApp(undefined, createMockDevModeService(), undefined);

      const res = await request(app)
        .get('/api/v1/dev/post-react-traces')
        .query({ saveId: 'save-1', limit: 10 });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('GET /runtime-snapshots', () => {
    it('返回 runtime snapshot traces，并按 runtime_snapshot 类型过滤', async () => {
      const devTraceCollector = new DevTraceCollector();
      const runtimeSnapshotTrace = {
        requestId: 'req-1',
        agentKey: 'gamemaster',
        parentAgentRunId: 'parent-run-1',
        model: {
          providerId: 'openai',
          model: 'gpt-4o-mini',
        },
        permissions: {
          configuredTools: ['event_service', 'map_service'],
          defaultDeny: true,
          visibleToolTypes: ['event_service'],
          visibleFunctionCount: 1,
          deferredFunctionCount: 1,
        },
        toolExposureBudget: {
          maxVisibleTools: 1,
          usedVisibleTools: 1,
          maxVisibleHelpDocs: 1,
          usedVisibleHelpDocs: 1,
          maxToolSummaryTokens: 100,
          usedToolSummaryTokens: 20,
          maxHelpSummaryTokens: 100,
          usedHelpSummaryTokens: 20,
          maxOnDemandLoadsPerTurn: 2,
          usedOnDemandLoads: 1,
        },
        deferredTools: ['map_service__move_to'],
        knowledge: {
          ruleNames: ['gm-rule'],
          skillNames: ['gm-skill'],
          helpMethods: ['event_service.get_event_snapshot'],
        },
        prompt: {
          systemPromptLength: 1200,
          userPromptLength: 320,
        },
        context: {
          language: 'zh-CN',
          templateId: 'template-parent',
        },
        debug: {
          source: 'parent-runtime',
        },
      };
      devTraceCollector.addTrace('save-1', {
        type: 'runtime_snapshot',
        data: runtimeSnapshotTrace,
        timestamp: 1718000002000,
      });
      devTraceCollector.addTrace('save-1', {
        type: 'story_post_react',
        data: { phase: 'post-react' },
        timestamp: 1718000003000,
      });
      const app = createApp(undefined, createMockDevModeService(), devTraceCollector);

      const res = await request(app)
        .get('/api/v1/dev/runtime-snapshots')
        .query({ saveId: 'save-1', limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        saveId: 'save-1',
        traceCount: 1,
      });
      expect(res.body.data.runtimeSnapshots).toEqual([
        expect.objectContaining({
          type: 'runtime_snapshot',
          timestamp: 1718000002000,
          data: expect.objectContaining({
            requestId: 'req-1',
            agentKey: 'gamemaster',
            permissions: expect.objectContaining({
              visibleToolTypes: ['event_service'],
              visibleFunctionCount: 1,
              deferredFunctionCount: 1,
            }),
            toolExposureBudget: expect.objectContaining({
              usedOnDemandLoads: 1,
            }),
            deferredTools: ['map_service__move_to'],
            knowledge: expect.objectContaining({
              ruleNames: ['gm-rule'],
            }),
          }),
        }),
      ]);
    });

    it('collector 不可用时应返回 503，而不是伪装成空数据', async () => {
      const app = createApp(undefined, createMockDevModeService(), undefined);

      const res = await request(app)
        .get('/api/v1/dev/runtime-snapshots')
        .query({ saveId: 'save-1', limit: 10 });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('GET /prompt-composition', () => {
    it('带 agentKey 或 intentHint 时使用真实 agentConfig 构建 prompt，而不是伪造空配置', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: 'gamemaster', intentHint: 'travel' });

      expect(res.status).toBe(200);
      expect(promptModule.buildPreview).toHaveBeenCalledWith(expect.objectContaining({
        agentKey: 'gamemaster',
        agentConfig: {
          tools: ['map_service'],
          maxIterations: 9,
          toolBudget: {
            maxVisibleTools: 1,
            maxVisibleHelpDocs: 1,
            maxToolSummaryTokens: 100,
            maxHelpSummaryTokens: 100,
            maxOnDemandLoadsPerTurn: 2,
          },
        },
        message: {
          payload: {
            action: 'chat',
            intentHint: 'travel',
          },
        },
      }));
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(res.body.data.tools).toEqual(expect.objectContaining({
        totalTools: 1,
        totalMethods: 2,
        visibleTools: 1,
        deferredTools: 1,
        visibleToolNames: ['map_service__get_current_top_location'],
        deferredToolNames: ['map_service__move_to'],
      }));
    });

    it('自定义 prompt 预览不应覆盖最后一次真实构建结果', async () => {
      const originalResult = createPromptBuildResult();
      const previewResult = {
        ...createPromptBuildResult(),
        userPromptTrace: {
          ...createPromptBuildResult().userPromptTrace,
          intentHint: 'chat',
        },
      };
      let lastBuildResult = originalResult;
      const promptModule = {
        build: vi.fn(async () => {
          lastBuildResult = previewResult;
          return previewResult;
        }),
        buildPreview: vi.fn().mockResolvedValue(previewResult),
        getLastBuildResult: vi.fn().mockImplementation(() => lastBuildResult),
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
      };
      const coordinator = {
        ...createMockCoordinator(),
        getPromptModule: vi.fn().mockReturnValue(promptModule),
        getPromptAgentConfig: vi.fn().mockReturnValue({
          tools: ['map_service'],
          maxIterations: 9,
          toolBudget: {
            maxVisibleTools: 1,
            maxVisibleHelpDocs: 1,
            maxToolSummaryTokens: 100,
            maxHelpSummaryTokens: 100,
            maxOnDemandLoadsPerTurn: 2,
          },
        }),
      };
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: 'gamemaster', intentHint: 'chat' });

      expect(res.status).toBe(200);
      expect(promptModule.buildPreview).toHaveBeenCalledTimes(1);
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(promptModule.getLastBuildResult()).toBe(originalResult);
    });

    it('无效 agentKey 应返回 400，而不是伪造空配置继续构建', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: 'unknown-agent' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expect(promptModule.build).not.toHaveBeenCalled();
    });

    it('合法 agentKey 但缺少真实 agentConfig 时应返回 400，而不是回退到空配置', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: 'output' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(promptModule.buildPreview).not.toHaveBeenCalled();
    });

    it('coordinator 不支持读取 prompt agentConfig 时应返回 503', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const { getPromptAgentConfig, ...coordinatorWithoutCapability } = coordinator;
      const app = createApp(coordinatorWithoutCapability as any);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: 'gamemaster' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(promptModule.buildPreview).not.toHaveBeenCalled();
    });

    it('空字符串 agentKey 应返回 400，而不是回退到默认 gamemaster', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(promptModule.buildPreview).not.toHaveBeenCalled();
    });

    it('空字符串 agentKey 搭配 intentHint 时也应返回 400', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: '', intentHint: 'travel' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(promptModule.buildPreview).not.toHaveBeenCalled();
    });

    it('重复传入 agentKey 时应返回 400，而不是抛 500 或继续预览', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', agentKey: ['gamemaster', 'output'] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(promptModule.buildPreview).not.toHaveBeenCalled();
    });

    it('重复传入 intentHint 时应返回 400，而不是继续预览', async () => {
      const coordinator = createMockCoordinator();
      const promptModule = coordinator.getPromptModule();
      const app = createApp(coordinator);

      const res = await request(app)
        .get('/api/v1/dev/prompt-composition')
        .query({ saveId: 'save-1', intentHint: ['travel', 'chat'] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
      expect(promptModule.build).not.toHaveBeenCalled();
      expect(promptModule.buildPreview).not.toHaveBeenCalled();
    });
  });
});
