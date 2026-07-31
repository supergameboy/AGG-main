import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './utils/config.js';
import { logger, clearSessionLog } from './utils/logger.js';
import { successResponse } from './utils/response.js';
import { createDatabaseConnection, testConnection, closeDatabase, getDatabase } from './database/connection.js';
import { ensureDirectories } from './database/storage.js';
import { runMigrations, getMigrationStatus } from './migrations/runner.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { dataFlowTracer } from './middlewares/data-flow-tracer.js';
import { errorHandler } from './middlewares/errorhandler.js';
import { initializeAgentSystem } from './agents/index.js';
import { createAgentRoutes } from './routes/agent.js';
import { createGameRoutes } from './routes/game.js';
import { createSaveRoutes } from './routes/save.js';
import { createConfigRouter } from './routes/config.js';
import { createTemplateRouter } from './routes/template.js';
import { createModelConfigRouter } from './routes/model-config.js';
import { createOAuthRouter } from './routes/oauth.js';
import { createLogRoutes } from './routes/logs.js';
import { createDevRoutes } from './routes/dev.js';
import { ModelConfigService, OAuthCredentialService } from '@ai-rpg/ai';
// M1: LLMMetricsService/KnexModelConfigStore 为 E 层实现（端口-适配器）
// M2-B3: KnexOAuthCredentialStore 为 IOAuthCredentialStore 端口实现（oauth_credentials 表）
import { LLMMetricsService, KnexModelConfigStore, KnexOAuthCredentialStore } from './services/llm-metrics/index.js';
import { TemplateService } from './services/template.js';
import { TemplatePoolService } from './services/template-pool.js';
import { DevModeService } from './services/DevModeService.js';
import { initDevTraceCollector, getDevTraceCollector } from './services/DevTraceCollector.js';
import type { WebSocketService } from './services/WebSocketService.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import type { BusEvent } from '@ai-rpg/shared/messaging';
import { requestEventBridge } from './services/RequestEventBridge.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { initCleanupScheduler, registerToolEventEmitter } from '@ai-rpg/shared/tool-core';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = config.server.port;
let agentSystemRef: Awaited<ReturnType<typeof initializeAgentSystem>> | null = null;
// P1-2: 模块级 WebSocketService 实例（从组合根获取，替代原模块级单例 value import）
// null 表示服务未初始化（health 路由在服务启动前可能被访问）
let webSocketService: WebSocketService | null = null;

const corsOrigins = config.server.corsOrigins
  ? config.server.corsOrigins.split(',').map((origin: string) => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(requestLogger);

// Root route: 生产模式返回前端 index.html，否则返回 JSON 状态
app.get('/', (_req, res) => {
  const frontendIndex = path.resolve(__dirname, '../../frontend/dist/index.html');
  if (fs.existsSync(frontendIndex)) {
    res.sendFile(frontendIndex);
  } else {
    res.json({ name: 'AGG Backend', version: '1.0.0', status: 'running', api: '/api/v1' });
  }
});

app.get('/api/v1/health', async (_req, res, next) => {
  try {
    const requestId = (res.locals as any).requestId as string | undefined;
    const dbConnected = await testConnection();
    const migrationStatus = await getMigrationStatus(createDatabaseConnection());
    
    res.json(successResponse({ 
      status: dbConnected ? 'ok' : 'error',
      database: dbConnected ? 'connected' : 'disconnected',
      migrations: {
        applied: migrationStatus.applied.length,
        pending: migrationStatus.pending.length,
      },
      websocket: {
        connectedClients: webSocketService?.getConnectedCount() ?? 0,
      },
    }, requestId));
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/database/status', async (_req, res, next) => {
  try {
    const requestId = (res.locals as any).requestId as string | undefined;
    const db = createDatabaseConnection();
    const status = await getMigrationStatus(db);
    res.json(successResponse({
      connected: await testConnection(),
      migrations: status,
      databasePath: config.database.filename,
    }, requestId));
  } catch (error) {
    next(error);
  }
});

async function initializeApp() {
  clearSessionLog();
  logger.info('Initializing AI-generated Games Backend...');

  // 启动工具结果缓存清理定时器（替代原模块级 setInterval）
  initCleanupScheduler();
  
  logger.info('Ensuring data directories...');
  ensureDirectories();
  
  logger.info('Creating database connection...');
  const db = createDatabaseConnection();
  
  logger.info('Testing database connection...');
  const connected = await testConnection();
  if (!connected) {
    throw new Error('Failed to connect to database');
  }
  logger.info('Database connected successfully');
  
  logger.info('Running migrations...');
  await runMigrations(db);

  logger.info('Initializing Agent system (YAML-driven)...');
  // ModelConfigService 必须为进程级单例：路由层（updateProvider 等写入操作）与 Agent 层
  // （LLMService.getProviderInstance 读取操作）必须共享同一实例，否则 providerCache/keyStates
  // 缓存隔离会导致前端更新 KEY 后后端 LLM 调用仍使用旧 KEY。
  // M1: ModelConfigService 无状态化——行级数据访问经 IModelConfigStore 端口（E 层 Knex 适配器）
  // M9: 注入 eventBus，updateProvider/deleteProvider 发送 provider_config_changed 事件（§8.3）
  // M2-B3: OAuthCredentialService 装配链（KnexOAuthCredentialStore → service），
  //   消费方：oauth 路由（登录编排）、ModelConfigService（testConnection 取真实 key）、
  //   initializeAgentSystem → LLMRequestDispatcher（运行时 key 解析 + 401 强制刷新）
  const oauthCredentialService = new OAuthCredentialService(new KnexOAuthCredentialStore(db));
  const modelConfigService = new ModelConfigService(new KnexModelConfigStore(db), eventBus, oauthCredentialService);
  const agentSystem = await initializeAgentSystem(db, modelConfigService, oauthCredentialService);
  agentSystemRef = agentSystem;
  webSocketService = agentSystem.webSocketService;

  // M6 D6.6：工具事件发射器注册（与 registerTimeoutConfig 同模式的静态注入）。
  // BaseTool 发布的 before/after_tool_execute 经此薄适配进入 EventBus；
  // 无条件注册（生产/开发一致），未注册时 BaseTool 降级 logger.debug。
  registerToolEventEmitter((eventType, event) => eventBus.emit(eventType, event));

  // FOLLOWUP-3: bootstrap QuestService/EventService 已在 initializeAgentSystem 内创建
  // （init.ts 组合根），通过 agentSystem.bootstrapEventHandlers 返回。
  // 订阅器改为转发模式：有 per-request 上下文时入队（post-flush 处理），无上下文时回退直接处理。
  const { questService, eventService } = agentSystem.bootstrapEventHandlers;

  const questForwarder = async (event: BusEvent): Promise<void> => {
    if (requestEventBridge.hasState()) {
      requestEventBridge.pushEvent(event);
    } else {
      await questService.handleGameEvent(event);
    }
  };

  const eventForwarder = async (event: BusEvent): Promise<void> => {
    if (requestEventBridge.hasState()) {
      requestEventBridge.pushEvent(event);
    } else {
      await eventService.handleBusEvent(event);
    }
  };

  const questEventTypes = ['kill', 'item_change', 'dialogue', 'location_enter', 'equip_item', 'use_item'] as const;
  for (const eventType of questEventTypes) {
    eventBus.subscribe(eventType, questForwarder);
  }
  logger.info('QuestService forwarder subscribed to EventBus events');

  const eventBusEventTypes = ['kill', 'dialogue', 'location_enter', 'quest_update'] as const;
  for (const eventType of eventBusEventTypes) {
    eventBus.subscribe(eventType, eventForwarder);
  }
  logger.info('EventService forwarder subscribed to EventBus events');

  // StoryKernel subscribes to EventBus for story projection updates
  const storyKernel = agentSystem.coordinator.getStoryKernel();
  if (storyKernel) {
    eventBus.subscribe('trigger_resolved', storyKernel.onTriggerResolved.bind(storyKernel));
    eventBus.subscribe('story_progress', storyKernel.onStoryProgress.bind(storyKernel));
    logger.info('StoryKernel subscribed to EventBus events');
  }

  app.use('/api/v1/agent', dataFlowTracer);

  app.use('/api/v1/agent', createAgentRoutes(agentSystem.coordinator, agentSystem.decisionLogService, db));
  logger.info('Agent routes registered at /api/v1/agent');

  app.use('/api/v1/game', dataFlowTracer);
  app.use('/api/v1/game', createGameRoutes(agentSystem.coordinator, db, agentSystem.gameServiceDeps));
  logger.info('Game routes registered at /api/v1/game');

  app.use('/api/v1/saves', createSaveRoutes(db, agentSystem.coordinator));
  logger.info('Save routes registered at /api/v1/saves');

  app.use('/api/v1/templates', createTemplateRouter(db, agentSystem.configLoader, agentSystem.coordinator));
  logger.info('Template routes registered at /api/v1/templates');

  try {
    logger.info('Loading templates from YAML config...');
    const templatePoolService = new TemplatePoolService(db);
    const templateService = new TemplateService(db, undefined, agentSystem.configLoader);
    templateService.setTemplatePoolService(templatePoolService);
    await templateService.loadAll();
    logger.info('Templates loaded from YAML config');
  } catch (error) {
    logger.warn(`Template YAML loading skipped: ${getErrorMessage(error)}`);
  }

  app.use('/api/v1/config', createConfigRouter(agentSystem.agentFactory, agentSystem.configLoader));
  logger.info('Config routes registered at /api/v1/config');

  app.use('/api/v1/model-config', createModelConfigRouter(modelConfigService));
  logger.info('Model config routes registered at /api/v1/model-config');

  // M2-B3 D6：OAuth 登录/状态/注销路由（异步轮询 + 状态查询）
  app.use('/api/v1/oauth', createOAuthRouter(oauthCredentialService));
  logger.info('OAuth routes registered at /api/v1/oauth');

  app.use('/api/v1/logs', createLogRoutes(db));
  logger.info('Log routes registered at /api/v1/logs');

  const devModeTemplatePoolService = new TemplatePoolService(db);
  const devModeTemplateService = new TemplateService(db, undefined, agentSystem.configLoader);
  devModeTemplateService.setTemplatePoolService(devModeTemplatePoolService);
  const devModeLlmMetricsService = new LLMMetricsService(db);
  const devModeService = new DevModeService(devModeTemplateService, devModeLlmMetricsService);
  agentSystem.coordinator.setDevModeService(devModeService);

  // Initialize DevTraceCollector in dev mode
  if (process.env.DEV_MODE === 'true' || process.env.NODE_ENV !== 'production') {
    initDevTraceCollector();
    logger.info('DevTraceCollector initialized for dev mode');

    // AP-L1: EventBus dev hook 改用统一 DevTraceHook 端口（与 Agent 内部共享同一实例）。
    // 原 v1.7 内联逻辑（collector.addTrace + broadcastToClient + try-catch + warn）
    // 已收敛到 DevTraceHook.emit 内部，组合根不再重复实现。
    eventBus.setDevHooks({
      onPublish: (eventType, event) => {
        if (!event.saveId) return;
        agentSystem.devTraceHook.emit({
          type: 'event_bus_publish',
          saveId: event.saveId,
          data: { eventType, eventData: event.data },
          timestamp: event.timestamp,
          requestId: event.requestId,
        });
      },
    });
    logger.info('EventBus dev hooks injected (via DevTraceHook)');
  }

  app.use('/api/v1/dev', createDevRoutes(db, agentSystem.coordinator, devModeService, agentSystem.helpRegistry, getDevTraceCollector() ?? undefined, agentSystem.npcServiceTool, agentSystem.entityGraphService));
  logger.info('Dev routes registered at /api/v1/dev');

  // 生产模式：服务前端静态文件（同源部署，消除跨域和 WS 端口问题）
  const frontendDist = process.env.FRONTEND_DIST_PATH
    || path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
    logger.info(`Serving frontend static files from ${frontendDist}`);
  }

  app.use(errorHandler);

  logger.info('Initialization complete');
}

async function startServer() {
  try {
    await initializeApp();

    const server = app.listen(PORT, () => {
      logger.info(`AI-generated Games Backend server running on port ${PORT}`);
      logger.info(`Database: ${config.database.filename}`);
    });

    // webSocketService 已在 initializeApp 中赋值，此处非 null
    if (!webSocketService) {
      throw new Error('WebSocketService not initialized');
    }
    webSocketService.initialize(server);
    logger.info('WebSocket service initialized on /ws');

    // 注册 WS 游戏请求处理器
    if (agentSystemRef) {
      const { createWSGameHandler } = await import('./services/ws-request-handler.js');
      const wsGameHandler = createWSGameHandler({
        coordinatorAgent: agentSystemRef.coordinator,
        db: getDatabase(),
        configLoader: agentSystemRef.configLoader,
        // v2 模块E: clientId 在 handler 内部通过 getClientIdByWs 动态获取，此处传空字符串占位
        clientId: '',
        // P3-S7: ToolRegistry 端口实例（ws-template-handler pool:generate-options 使用）
        toolRegistry: agentSystemRef.toolRegistry,
        // P1-2: WebSocket 消息层上下文（IWebSocketContext 类型，D8 决策）
        webSocketService,
        // P0-2: game-service 所需的端口依赖（locationRepo/skillService/rollbackRepos/txManager）
        gameServiceDeps: agentSystemRef.gameServiceDeps,
        // S5: SaveService 端口实例（ws handlers 共享，消除 new SaveService(ctx.db)）
        saveService: agentSystemRef.gameServiceDeps.saveService,
        // 统一面板变更推送机制: handleWSInitialize 完成后调 pushPanelUpdate 推送初始 location 面板
        panelUpdateBroadcaster: agentSystemRef.panelUpdateBroadcaster,
      });
      webSocketService.setRequestHandler(wsGameHandler);
      logger.info('WS game request handler registered');
    }

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down...');
      if (agentSystemRef) await agentSystemRef.agentFactory.destroyFlushQueue();
      // M9: 清理 Dispatcher 定时器/事件订阅 + Dispatch 指标 sink 最后一次 flush
      agentSystemRef?.llmRequestDispatcher.destroy();
      if (agentSystemRef) await agentSystemRef.llmDispatchMetricsSink.destroy();
      webSocketService?.shutdown();
      server.close();
      await closeDatabase();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down...');
      if (agentSystemRef) await agentSystemRef.agentFactory.destroyFlushQueue();
      // M9: 清理 Dispatcher 定时器/事件订阅 + Dispatch 指标 sink 最后一次 flush
      agentSystemRef?.llmRequestDispatcher.destroy();
      if (agentSystemRef) await agentSystemRef.llmDispatchMetricsSink.destroy();
      webSocketService?.shutdown();
      server.close();
      await closeDatabase();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
