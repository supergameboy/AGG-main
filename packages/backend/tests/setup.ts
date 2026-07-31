import { beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import cors from 'cors';
import knex, { type Knex } from 'knex';
import { runMigrations } from '../src/migrations/runner.js';
import { runSeeds } from '../src/seeds/runner.js';
import { initializeAgentSystem, initializeYamlAgentSystem } from '../src/agents/index.js';
import { createAgentRoutes } from '../src/routes/agent.js';
import { createGameRoutes } from '../src/routes/game.js';
import { createSaveRoutes } from '../src/routes/save.js';
import { createTemplateRouter } from '../src/routes/template.js';
import { createConfigRouter } from '../src/routes/config.js';
import { dataFlowTracer } from '../src/middlewares/data-flow-tracer.js';
import { requestLogger } from '../src/middlewares/requestLogger.js';
import { errorHandler } from '../src/middlewares/errorhandler.js';
import { successResponse } from '../src/utils/response.js';
import { TemplateService } from '../src/services/template.js';
import { ModelConfigService } from '@ai-rpg/ai';
import { eventBus } from '@ai-rpg/shared/messaging';
// M1: ModelConfigService 无状态化——行级数据访问经 IModelConfigStore 端口（E 层 Knex 适配器）
// 与生产路径 src/index.ts 保持同一构造方式，否则 store 缺端口方法会在初始化期抛错
import { KnexModelConfigStore } from '../src/services/llm-metrics/index.js';

declare module 'vitest' {
  export interface TestContext {
    app: express.Application;
    db: Knex;
  }
}

let app: express.Application;
let db: Knex;

function createMockLLMResponse(content: string = '{"targetAgents":["dialogue"],"confidence":0.9,"reasoning":"Test response","contextConditions":{}}') {
  return {
    content,
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
    finishReason: 'stop' as const,
    toolCalls: undefined,
  };
}

vi.mock('../src/services/llm.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/services/llm.js')>();

  return {
    ...original,
    LLMService: class MockLLMService extends original.LLMService {
      async chat(
        _systemPrompt: string,
        _userMessage: string,
        _options?: unknown,
        _saveId?: unknown,
        _agentType?: unknown
      ) {
        return createMockLLMResponse();
      }

      async *stream(
        _systemPrompt: string,
        _userMessage: string,
        _options?: unknown
      ) {
        yield { type: 'content' as const, content: 'Mock streaming response' };
      }

      async chatWithTools(
        _systemPrompt: string,
        _userMessage: string,
        _tools: unknown,
        _maxIterations?: number,
        _saveId?: unknown,
        _agentType?: unknown
      ) {
        return createMockLLMResponse();
      }
    },
  };
});

// Mock @ai-rpg/ai 包的 LLMService（Agent 核心使用的真实 LLM 服务）
vi.mock('@ai-rpg/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ai-rpg/ai')>();

  return {
    ...original,
    LLMService: class MockLLMService {
      constructor(_modelConfigService: unknown, _db: unknown) {
        // no-op
      }

      async chat(
        _messages: unknown[],
        _options?: unknown,
        _saveId?: unknown,
        _agentType?: unknown
      ) {
        return createMockLLMResponse();
      }

      async chatRaw(
        _messages: unknown[],
        _options?: unknown,
        _saveId?: unknown
      ) {
        return createMockLLMResponse();
      }

      async chatWithFastModel(
        _messages: unknown[],
        _options?: unknown,
        _saveId?: unknown,
        _agentType?: unknown
      ) {
        return createMockLLMResponse();
      }

      async *stream(
        _messages: unknown[],
        _options?: unknown
      ) {
        yield { type: 'content' as const, content: 'Mock streaming response' };
      }

      async *streamWithTools(
        _messages: unknown[],
        _tools: unknown,
        _options?: unknown
      ) {
        yield { type: 'content' as const, content: 'Mock streaming response' };
      }

      resolveProvider(_providerId?: unknown, _model?: unknown) {
        return Promise.resolve({
          client: {},
          resolvedProviderId: 'mock-provider',
          resolvedModel: 'mock-model',
          activeKeyIndex: 0,
        });
      }

      resolveFastProvider(_model?: unknown) {
        return Promise.resolve(null);
      }

      executeWithRetry(
        _client: unknown,
        _messages: unknown[],
        _options: unknown,
        _providerId: unknown,
        _model: unknown,
        _saveId?: unknown,
        _agentType?: unknown,
        _activeKeyIndex?: unknown
      ) {
        return Promise.resolve(createMockLLMResponse());
      }
    },
  };
});

beforeAll(async () => {
  console.log('🧪 Setting up comprehensive test environment...');

  db = knex({
    client: 'better-sqlite3',
    connection: {
      filename: ':memory:',
    },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
    },
  });

  await db.raw('SELECT 1');
  console.log('✅ Database connected');

  await runMigrations(db);
  console.log('✅ Migrations completed');

  await runSeeds(db);
  console.log('✅ Seeds completed');

  const modelConfigService = new ModelConfigService(new KnexModelConfigStore(db), eventBus);
  const agentSystem = await initializeAgentSystem(db, modelConfigService);
  console.log(`✅ Agent system initialized with ${agentSystem.coordinator.getRegisteredAgents().length} agents`);

  let yamlAgentSystem = null;
  try {
    yamlAgentSystem = await initializeYamlAgentSystem(db, agentSystem.coordinator);
    console.log('✅ YAML Agent system initialized');
  } catch (error) {
    console.log(`⚠️ YAML Agent system skipped: ${error instanceof Error ? error.message : error}`);
  }

  app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(requestLogger);

  app.get('/api/v1/health', async (_req, res) => {
    const requestId = (res.locals as any).requestId as string | undefined;
    res.json(successResponse({
      status: 'ok',
      database: 'connected',
      migrations: { applied: 22, pending: 0 },
      websocket: { connectedClients: 0 },
    }, requestId));
  });

  app.get('/api/v1/database/status', async (_req, res) => {
    const requestId = (res.locals as any).requestId as string | undefined;
    res.json(successResponse({
      connected: true,
      migrations: { applied: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22], pending: [] },
      databasePath: ':memory:',
    }, requestId));
  });

  app.use('/api/v1/agent', dataFlowTracer);
  app.use('/api/v1/agent', createAgentRoutes(agentSystem.coordinator, agentSystem.decisionLogService, db));

  app.use('/api/v1/game', createGameRoutes(agentSystem.coordinator, db, agentSystem.gameServiceDeps));

  app.use('/api/v1/saves', createSaveRoutes(db));

  // 创建共享的 TemplateService 实例并加载缓存
  // 模板路由每次请求都 new TemplateService(db)，但新实例缓存为空
  // 需要在 setup 阶段调用 loadAll() 将 YAML 模板同步到 DB
  try {
    const templateService = new TemplateService(db);
    await templateService.loadAll();
    console.log('✅ Template YAML loaded and synced to DB');
  } catch (error) {
    console.log(`⚠️ Template YAML loading skipped: ${error instanceof Error ? error.message : error}`);
  }

  app.use('/api/v1/templates', createTemplateRouter(db));

  if (yamlAgentSystem) {
    app.use('/api/v1/config', createConfigRouter(yamlAgentSystem.agentFactory, yamlAgentSystem.configLoader));
  }

  app.use(errorHandler);

  console.log('✅ Test environment setup complete');
});

afterAll(async () => {
  if (db) {
    await db.destroy();
    console.log('✅ Database connection closed');
  }
});

export { app, db };
