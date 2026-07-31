import { Router, Request, Response, NextFunction } from 'express';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger, logger as rootLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { validateBody, validateQuery } from '../middlewares/validate.js';
import {
  snapshotCreateSchema,
  snapshotQuerySchema,
  snapshotCompareSchema,
  consistencyReportSchema,
  debugExportSchema,
  llmMetricsQuerySchema,
} from '../schemas/dev.schema.js';
import { config } from '../utils/config.js';
import type { Knex } from 'knex';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LLMMetricsService } from '../services/llm-metrics/index.js';
import { StoryService } from '../game-systems/story/StoryService.js';
import { StoryEventRepository } from '../game-systems/story/StoryEventRepository.js';
import { AgentContextRepository } from '../game-systems/story/AgentContextRepository.js';
import { SaveRepository } from '../game-systems/save/index.js';
import { KnexTransactionManager } from '../database/TransactionManager.js';
import { DevModeService } from '../services/DevModeService.js';
import type { DevTraceCollector } from '../services/DevTraceCollector.js';
import type { HelpRegistry } from '../services/help-registry.js';
import type { NPCServiceTool } from '../game-systems/npc/NPCServiceTool.js';
import type { EntityGraphService } from '../game-systems/entity-graph/EntityGraphService.js';
import { RequestScope } from '../services/RequestScope.js';
import type { AgentType } from '../../../shared/src/types/agent.js';
import type { PromptModule } from '../agents/prompt/index.js';
import type { PromptContext, SystemPromptBuildResult, UserPromptBuildResult } from '../agents/prompt/types.js';

const logger = createChildLogger('routes:dev');

const VALID_AGENT_TYPES: ReadonlySet<string> = new Set<AgentType>([
  'gamemaster', 'output', 'challenge', 'quest',
  'map', 'npc_party', 'inventory', 'skill', 'numerical', 'event', 'time',
]);

interface CoordinatorLike {
  getPromptModule(): PromptModule;
  getPromptAgentConfig?(agentKey: string): PromptContext['agentConfig'] | null;
  // v2 模块F D5: 请求级实例化——返回带 processMessage 的对象
  createRequestScopedCopy?(): { processMessage(msg: any): Promise<any> };
}

function readSingleQueryParam(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : null;
}

export function createDevRoutes(db: Knex, coordinatorAgent?: CoordinatorLike & { processMessage?: (msg: any) => Promise<any> }, devModeService?: DevModeService, helpRegistry?: HelpRegistry, devTraceCollector?: DevTraceCollector, npcServiceTool?: NPCServiceTool, entityGraphService?: EntityGraphService): Router {
  const router = Router();
  const llmMetricsService = new LLMMetricsService(db);
  const storyEventRepo = new StoryEventRepository(db);
  const agentContextRepo = new AgentContextRepository(db);
  const saveRepo = new SaveRepository(db);
  const txManager = new KnexTransactionManager(db);
  const storyService = new StoryService(storyEventRepo, agentContextRepo, saveRepo, txManager);

  // EG-OUT-2 修复: 复用 init.ts 单例（共享 entityGraphCache），未传入时兜底回退（保证测试不破坏）
  // 兜底路径使用 NullEntityGraphCache（无缓存），仅 dev 测试场景使用
  const getGraphService = async (): Promise<EntityGraphService> => {
    if (entityGraphService) return entityGraphService;
    const { EntityGraphService: EGS } = await import('../game-systems/entity-graph/EntityGraphService.js');
    const { EntityGraphRepository } = await import('../game-systems/entity-graph/EntityGraphRepository.js');
    const { AwarenessRepository } = await import('../game-systems/entity-graph/AwarenessRepository.js');
    const { RelationshipRepository } = await import('../game-systems/entity-graph/RelationshipRepository.js');
    const { NullEntityGraphCache } = await import('../game-systems/entity-graph/EntityGraphCache.js');
    return new EGS(
      new EntityGraphRepository(db), new NullEntityGraphCache(),
      new AwarenessRepository(db), new RelationshipRepository(db),
    );
  };

  // S2-1 D8：dev 路由内 NPCService 工厂闭包（按 saveId 创建 per-request 实例）
  // agentType/timestamp 为 ToolContext 必填字段但工厂内部不使用
  const createNPCServiceForDev = (saveId: string) => {
    if (!npcServiceTool) return null;
    return npcServiceTool.createNPCService({
      saveId, agentType: 'gamemaster', timestamp: Date.now(), requestScope: new RequestScope(db),
    });
  };

  // === 环境保护中间件：生产环境禁用，可选 API Key 校验 ===
  router.use((_req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ error: 'Dev API disabled in production' });
      return;
    }
    if (process.env.DEV_API_KEY) {
      const key = _req.headers['x-dev-api-key'];
      if (key !== process.env.DEV_API_KEY) {
        res.status(401).json({ error: 'Invalid dev API key' });
        return;
      }
    }
    next();
  });

  // === POST /quick-init — 快速初始化游戏 ===
  router.post('/quick-init', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { preset } = req.body;
      if (!preset || typeof preset !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'preset is required and must be a string', undefined, requestId));
      }

      if (!coordinatorAgent?.processMessage || !devModeService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'Coordinator or DevModeService not available', undefined, requestId));
      }

      const presetData = await devModeService.loadPreset(preset);
      const templateId = await devModeService.resolveTemplateId(presetData);
      const validation = await devModeService.validatePreset(presetData, templateId);
      if (!validation.valid) {
        return res.status(400).json(errorResponse('INVALID_PRESET', 'Preset validation failed', { errors: validation.errors, warnings: validation.warnings }, requestId));
      }

      const ctxId = devModeService.createRequestContext();
      const startTime = Date.now();
      // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
      const scopedAgent = coordinatorAgent.createRequestScopedCopy!();
      const result = await scopedAgent.processMessage({
        to: 'gamemaster',
        payload: {
          action: 'initialize',
          data: { preset, ...presetData, templateId, _devRequestId: ctxId },
        },
      });
      const processingTime = Date.now() - startTime;

      if (!result.success) {
        return res.status(400).json(errorResponse(result.errorCode ?? 'INIT_ERROR', result.error ?? 'Initialization failed', undefined, requestId));
      }

      const ctx = devModeService.getRequestContext(ctxId);
      const agentTrace = ctx?.agentTrace;
      const summary = agentTrace ? {
        totalIterations: agentTrace.agentTraces.reduce((s: number, a: any) => s + a.iterations, 0),
        totalToolCalls: agentTrace.agentTraces.reduce((s: number, a: any) => s + a.toolCalls.length, 0),
        totalTokens: agentTrace.agentTraces.reduce((s: any, a: any) => ({
          input: s.input + a.tokenUsage.input,
          output: s.output + a.tokenUsage.output,
          total: s.total + a.tokenUsage.total,
          cacheHit: (s.cacheHit ?? 0) + (a.tokenUsage.cacheHit ?? 0),
          cacheMiss: (s.cacheMiss ?? 0) + (a.tokenUsage.cacheMiss ?? 0),
        }), { input: 0, output: 0, total: 0, cacheHit: 0, cacheMiss: 0 }),
        redundantReads: devModeService.detectRedundantReads(agentTrace.agentTraces),
      } : null;

      devModeService.cleanupRequestContext(ctxId);

      return res.json(successResponse({
        success: true,
        metadata: {
          saveId: result.data?.saveId ?? `save_${Date.now()}`,
          preset,
          templateId,
          processingTime,
        },
        trace: agentTrace ?? null,
        summary,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to quick-init', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === POST /agent-trace — 发送消息并获取 trace ===
  router.post('/agent-trace', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { message, saveId, agentType, action } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'message is required and must be a string', undefined, requestId));
      }
      if (!saveId || typeof saveId !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId is required and must be a string', undefined, requestId));
      }

      if (!coordinatorAgent?.processMessage || !devModeService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'Coordinator or DevModeService not available', undefined, requestId));
      }

      const ctxId = devModeService.createRequestContext();
      const payload: Record<string, any> = {
        action: action ?? 'chat',
        data: { message, saveId, _devRequestId: ctxId },
      };
      if (agentType) {
        payload.data._devTargetAgentType = agentType;
      }

      // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
      const scopedAgent = coordinatorAgent.createRequestScopedCopy!();
      const result = await scopedAgent.processMessage({
        to: 'gamemaster',
        payload,
      });

      const ctx = devModeService.getRequestContext(ctxId);
      const agentTrace = ctx?.agentTrace;
      const coordinatorDecisions = ctx?.coordinatorDecisions ?? [];

      const summary = agentTrace ? {
        totalIterations: agentTrace.agentTraces.reduce((s: number, a: any) => s + a.iterations, 0),
        totalToolCalls: agentTrace.agentTraces.reduce((s: number, a: any) => s + a.toolCalls.length, 0),
        totalTokens: agentTrace.agentTraces.reduce((s: any, a: any) => ({
          input: s.input + a.tokenUsage.input,
          output: s.output + a.tokenUsage.output,
          total: s.total + a.tokenUsage.total,
          cacheHit: (s.cacheHit ?? 0) + (a.tokenUsage.cacheHit ?? 0),
          cacheMiss: (s.cacheMiss ?? 0) + (a.tokenUsage.cacheMiss ?? 0),
        }), { input: 0, output: 0, total: 0, cacheHit: 0, cacheMiss: 0 }),
        redundantReads: devModeService.detectRedundantReads(agentTrace.agentTraces),
      } : null;

      devModeService.cleanupRequestContext(ctxId);

      return res.json(successResponse({
        result: result.data ?? result,
        trace: agentTrace ?? null,
        summary,
        coordinatorDecisions,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to agent-trace', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === POST /ab-test — A/B 测试 ===
  router.post('/ab-test', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { preset, message, label, dryRun, action } = req.body;
      if (!preset || typeof preset !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'preset is required and must be a string', undefined, requestId));
      }
      if (!message || typeof message !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'message is required and must be a string', undefined, requestId));
      }
      if (!label || typeof label !== 'string') {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'label is required and must be a string', undefined, requestId));
      }

      if (!coordinatorAgent?.processMessage || !devModeService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'Coordinator or DevModeService not available', undefined, requestId));
      }

      const presetData = await devModeService.loadPreset(preset);
      const templateId = await devModeService.resolveTemplateId(presetData);
      const validation = await devModeService.validatePreset(presetData, templateId);

      if (dryRun) {
        return res.json(successResponse({
          dryRun: true,
          label,
          validation,
        }, requestId));
      }

      if (!validation.valid) {
        return res.status(400).json(errorResponse('INVALID_PRESET', 'Preset validation failed', { errors: validation.errors, warnings: validation.warnings }, requestId));
      }

      // Step 1: Init
      const initCtxId = devModeService.createRequestContext();
      // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
      const initScopedAgent = coordinatorAgent.createRequestScopedCopy!();
      const initResult = await initScopedAgent.processMessage({
        to: 'gamemaster',
        payload: {
          action: 'initialize',
          data: { preset, ...presetData, templateId, _devRequestId: initCtxId },
        },
      });

      if (!initResult.success) {
        devModeService.cleanupRequestContext(initCtxId);
        return res.status(400).json(errorResponse('AB_TEST_INIT_FAILED', initResult.error ?? 'Init failed', undefined, requestId));
      }

      devModeService.cleanupRequestContext(initCtxId);

      // Step 2: Chat
      const chatCtxId = devModeService.createRequestContext();
      // v2 模块F D5: 请求级实例化——每个请求创建独立的 GM Agent 副本
      const chatScopedAgent = coordinatorAgent.createRequestScopedCopy!();
      await chatScopedAgent.processMessage({
        to: 'gamemaster',
        payload: {
          action: action ?? 'chat',
          data: { message, saveId: initResult.data?.saveId, _devRequestId: chatCtxId },
        },
      });

      const chatCtx = devModeService.getRequestContext(chatCtxId);
      const chatTrace = chatCtx?.agentTrace ?? null;
      const coordinatorDecisions = chatCtx?.coordinatorDecisions ?? [];
      devModeService.cleanupRequestContext(chatCtxId);

      // Build snapshot
      const snapshotId = `snapshot_${Date.now()}`;
      const overallProcessingTime = 0;

      // Agent breakdown from trace
      const agentBreakdown = chatTrace?.agentTraces.map((a: any) => ({
        agentType: a.agentType,
        iterations: a.iterations,
        toolCalls: a.toolCalls.length,
        tokens: a.tokenUsage.total,
      })) ?? [];

      const summary = chatTrace ? {
        totalIterations: chatTrace.agentTraces.reduce((s: number, a: any) => s + a.iterations, 0),
        totalToolCalls: chatTrace.agentTraces.reduce((s: number, a: any) => s + a.toolCalls.length, 0),
        totalTokens: chatTrace.agentTraces.reduce((s: any, a: any) => ({
          input: s.input + a.tokenUsage.input,
          output: s.output + a.tokenUsage.output,
          total: s.total + a.tokenUsage.total,
          cacheHit: (s.cacheHit ?? 0) + (a.tokenUsage.cacheHit ?? 0),
          cacheMiss: (s.cacheMiss ?? 0) + (a.tokenUsage.cacheMiss ?? 0),
        }), { input: 0, output: 0, total: 0, cacheHit: 0, cacheMiss: 0 }),
        redundantReads: devModeService.detectRedundantReads(chatTrace.agentTraces),
        agentBreakdown,
      } : null;

      return res.json(successResponse({
        label,
        init: { success: true, data: initResult.data },
        trace: chatTrace,
        summary,
        coordinatorDecisions,
        snapshotId,
        overallProcessingTime,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to ab-test', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /presets — 列出可用预设 ===
  router.get('/presets', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      if (!devModeService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'DevModeService not available', undefined, requestId));
      }

      const presets = devModeService.listPresets();
      return res.json(successResponse(presets, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to list presets', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /presets/:template/:preset — 加载预设详情 ===
  router.get('/presets/:template/:preset', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      if (!devModeService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'DevModeService not available', undefined, requestId));
      }

      const { template, preset } = req.params;
      const presetName = `${template}/${preset}`;
      const presetData = await devModeService.loadPreset(presetName);
      return res.json(successResponse(presetData, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('not found') || errorMessage.includes('Invalid preset format')) {
        return res.status(404).json(errorResponse('PRESET_NOT_FOUND', errorMessage, undefined, requestId));
      }
      logger.error('Failed to load preset', { template: req.params.template, preset: req.params.preset, error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/post-react-traces', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string | undefined;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const requestedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
      if (!devTraceCollector) {
        return res.status(503).json(errorResponse(
          'SERVICE_UNAVAILABLE',
          'DevTraceCollector not available',
          { traceType: 'story_post_react' },
          requestId,
        ));
      }
      const postReactTraces = devTraceCollector.getTraces(saveId, 'story_post_react', limit);

      return res.json(successResponse({
        saveId,
        postReactTraces,
        traceCount: postReactTraces.length,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get post-react traces', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/runtime-snapshots', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string | undefined;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const requestedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
      if (!devTraceCollector) {
        return res.status(503).json(errorResponse(
          'SERVICE_UNAVAILABLE',
          'DevTraceCollector not available',
          { traceType: 'runtime_snapshot' },
          requestId,
        ));
      }
      const runtimeSnapshots = devTraceCollector.getTraces(saveId, 'runtime_snapshot', limit);

      return res.json(successResponse({
        saveId,
        runtimeSnapshots,
        traceCount: runtimeSnapshots.length,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get runtime snapshot traces', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /runtime-events — 获取运行时事件时间线 ===
  router.get('/runtime-events', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string | undefined;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      if (!devTraceCollector) {
        return res.status(503).json(errorResponse(
          'SERVICE_UNAVAILABLE',
          'DevTraceCollector not available',
          { traceType: 'runtime_events' },
          requestId,
        ));
      }

      const type = req.query.type as string | undefined;
      const requestIdFilter = req.query.requestId as string | undefined;
      const requestedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 50;

      let events = requestIdFilter
        ? devTraceCollector.getRuntimeEventsByRequestId(saveId, requestIdFilter)
        : devTraceCollector.getRuntimeEvents(saveId, type as any, limit);

      if (type && requestIdFilter) {
        events = events.filter(e => e.type === type);
      }

      if (!requestIdFilter && !type) {
        events = events.slice(-limit);
      }

      return res.json(successResponse({
        saveId,
        events,
        eventCount: events.length,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get runtime events', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === 以下为原有端点，保持不变 ===

  router.post('/snapshots', validateBody(snapshotCreateSchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { type, data, storeNames, sessionId, timestamp } = (req as any).validatedBody || req.body;
      const now = Date.now();
      const id = uuidv4();

      await db('dev_snapshots').insert({
        id,
        type,
        data,
        store_names: storeNames,
        session_id: sessionId || null,
        timestamp,
        created_at: now,
      });

      rootLogger.info('Dev snapshot saved', { id, type, storeNames, sessionId });

      return res.status(201).json(successResponse({
        id,
        type,
        storeNames,
        timestamp,
        createdAt: now,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to save dev snapshot', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/snapshots', validateQuery(snapshotQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const {
        type,
        sessionId,
        limit = 50,
        offset = 0,
      } = (req as any).validatedQuery || req.query;

      let query = db('dev_snapshots').select('*');

      if (type) {
        query = query.where('type', type);
      }
      if (sessionId) {
        query = query.where('session_id', sessionId);
      }

      const countQuery = query.clone();
      const [{ 'count(*)': total }] = await countQuery.count('* as count');

      const data = await query
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .offset(offset);

      return res.json(successResponse({
        data,
        total: total as number,
        limit,
        offset,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query dev snapshots', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/snapshots/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const snapshot = await db('dev_snapshots').where({ id }).first();

      if (!snapshot) {
        return res.status(404).json(errorResponse('SNAPSHOT_NOT_FOUND', `Snapshot not found: ${id}`, undefined, requestId));
      }

      return res.json(successResponse(snapshot, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get dev snapshot', { id: req.params.id, error: errorMessage });
      next(error);
      return;
    }
  });

  router.delete('/snapshots/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { id } = req.params;
      const snapshot = await db('dev_snapshots').where({ id }).first();

      if (!snapshot) {
        return res.status(404).json(errorResponse('SNAPSHOT_NOT_FOUND', `Snapshot not found: ${id}`, undefined, requestId));
      }

      await db('dev_snapshots').where({ id }).del();

      return res.json(successResponse({
        deleted: true,
        id,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete dev snapshot', { id: req.params.id, error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/snapshots/compare', validateBody(snapshotCompareSchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { snapshotId1, snapshotId2 } = (req as any).validatedBody || req.body;

      const snapshot1 = await db('dev_snapshots').where({ id: snapshotId1 }).first();
      const snapshot2 = await db('dev_snapshots').where({ id: snapshotId2 }).first();

      if (!snapshot1) {
        return res.status(404).json(errorResponse('SNAPSHOT_NOT_FOUND', `Snapshot not found: ${snapshotId1}`, undefined, requestId));
      }
      if (!snapshot2) {
        return res.status(404).json(errorResponse('SNAPSHOT_NOT_FOUND', `Snapshot not found: ${snapshotId2}`, undefined, requestId));
      }

      let data1: Record<string, any>;
      let data2: Record<string, any>;
      try {
        data1 = JSON.parse(snapshot1.data);
      } catch {
        return res.status(400).json(errorResponse('INVALID_DATA', `Snapshot ${snapshotId1} contains invalid JSON data`, undefined, requestId));
      }
      try {
        data2 = JSON.parse(snapshot2.data);
      } catch {
        return res.status(400).json(errorResponse('INVALID_DATA', `Snapshot ${snapshotId2} contains invalid JSON data`, undefined, requestId));
      }

      const differences = computeDiff(data1, data2);

      return res.json(successResponse({
        snapshot1: {
          id: snapshot1.id,
          type: snapshot1.type,
          timestamp: snapshot1.timestamp,
          storeNames: snapshot1.store_names,
        },
        snapshot2: {
          id: snapshot2.id,
          type: snapshot2.type,
          timestamp: snapshot2.timestamp,
          storeNames: snapshot2.store_names,
        },
        differences,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to compare dev snapshots', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/consistency-check', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const saveExists = await db('saves').where({ id: saveId }).first();
      if (!saveExists) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, undefined, requestId));
      }

      const characters = await db('characters').where({ save_id: saveId });
      const inventory = await db('inventory').where({ save_id: saveId });
      const itemPool = await db('item_pool').where({ save_id: saveId });
      const quests = await db('quests').where({ save_id: saveId });
      const npcs = await db('npcs').where({ save_id: saveId });
      const locations = await db('locations').where({ save_id: saveId });

      // 新增7张表
      const characterSkills = await db('character_skills').where({ save_id: saveId });
      const skillPool = await db('skill_pool').where({ save_id: saveId });
      const storyEvents = await db('story_events').where({ save_id: saveId });
      const npcGoals = await db('npc_goals').where({ save_id: saveId });
      const npcCurrencies = await db('npc_currencies').where({ save_id: saveId });
      const entityGraphNodes = await db('entity_graph_nodes').where({ save_id: saveId });
      const entityGraphEdges = await db('entity_graph_edges').where({ save_id: saveId });

      return res.json(successResponse({
        saveId,
        characters,
        inventory,
        itemPool,
        quests,
        npcs,
        locations,
        characterSkills,
        skillPool,
        storyEvents,
        npcGoals,
        npcCurrencies,
        entityGraphNodes,
        entityGraphEdges,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get consistency check data', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/consistency-reports', validateBody(consistencyReportSchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { checkTime, totalChecks, mismatchCount, details, sessionId } = (req as any).validatedBody || req.body;
      const now = Date.now();

      const [report] = await db('dev_consistency_reports').insert({
        check_time: checkTime,
        total_checks: totalChecks,
        mismatch_count: mismatchCount,
        details,
        session_id: sessionId || null,
        created_at: now,
      }).returning('id');

      return res.status(201).json(successResponse({
        id: report?.id || report,
        checkTime,
        totalChecks,
        mismatchCount,
        createdAt: now,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to save consistency report', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/debug-export', validateBody(debugExportSchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { data, sessionId } = (req as any).validatedBody || req.body;

      const devExportsDir = path.join(config.logs.dir, 'dev-exports');
      if (!fs.existsSync(devExportsDir)) {
        fs.mkdirSync(devExportsDir, { recursive: true });
      }

      const timestamp = Date.now();
      const filename = `debug-export-${timestamp}${sessionId ? `-${sessionId}` : ''}.json`;
      const filePath = path.join(devExportsDir, filename);

      fs.writeFileSync(filePath, data, 'utf-8');

      rootLogger.info('Debug export saved', { filename, sessionId });

      return res.status(201).json(successResponse({
        saved: true,
        filename,
        path: filePath,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to save debug export', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/llm-metrics/summary', validateQuery(llmMetricsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const {
        timeRange = '24h',
        stage,
      } = (req as any).validatedQuery || req.query;

      const data = await llmMetricsService.getSummary({
        timeRange,
        stage,
      });

      return res.json(successResponse(data, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query LLM metrics summary', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/llm-metrics/recent', validateQuery(llmMetricsQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const {
        timeRange = '24h',
        stage,
        limit = 20,
      } = (req as any).validatedQuery || req.query;

      const data = await llmMetricsService.getRecent({
        timeRange,
        stage,
        limit,
      });

      return res.json(successResponse(data, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query recent LLM metrics', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/story-orchestration', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const [contextResult, historyResult, runtimeStateRow] = await Promise.all([
        storyService.getContext(saveId).catch(() => null),
        storyService.getHistory(saveId, { page: 1, pageSize: 10 }).catch(() => ({ events: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } })),
        db('agent_contexts').where({ save_id: saveId, agent_type: 'story' }).select('state').first().catch(() => null),
      ]);

      const parsedState = runtimeStateRow?.state
        ? (typeof runtimeStateRow.state === 'string' ? JSON.parse(runtimeStateRow.state) : runtimeStateRow.state)
        : {};
      const runtimeState = parsedState?.runtimeState || null;

      const importanceCounts = await db('story_events')
        .where({ save_id: saveId })
        .select('importance')
        .count('* as count')
        .groupBy('importance');

      const stats: Record<string, number> = {};
      for (const row of importanceCounts as any[]) {
        stats[row.importance] = Number(row.count);
      }

      const chapter = (contextResult as any)?.saveInfo?.chapter ?? null;
      const recentEvents = historyResult.events.map((e: any) => ({
        id: e.id,
        eventType: e.event_type,
        title: e.title,
        importance: e.importance,
        chapter: e.chapter,
        timestamp: e.timestamp,
      }));

      const responseData: Record<string, unknown> = {
        saveId,
        chapter,
        eventStats: stats,
        totalEvents: Object.values(stats).reduce((a: number, b: number) => a + b, 0),
        recentEvents,
        pagination: historyResult.pagination,
        runtimeState,
      };

      try {
        const graphService = await getGraphService();
        const fullGraph = await graphService.getFullGraph(saveId);

        const nodesByType: Record<string, number> = {};
        for (const node of fullGraph.nodes) {
          nodesByType[node.entityType] = (nodesByType[node.entityType] || 0) + 1;
        }

        const edgesByRelation: Record<string, number> = {};
        for (const edge of fullGraph.edges) {
          edgesByRelation[edge.relation] = (edgesByRelation[edge.relation] || 0) + 1;
        }

        // 模块3：从 PERCEIVES 边提取 NPC 感知数据（替代 InformationBoundary）
        const awareness: Array<{
          entityId: string;
          entityType: string;
          label: string;
          perceptions: Array<{
            targetLabel: string;
            targetType: string;
            awarenessScore?: unknown;
            awarenessNote?: unknown;
            relationshipScore?: unknown;
            relationshipNote?: unknown;
          }>;
        }> = [];
        const npcNodes = fullGraph.nodes.filter(n => n.entityType === 'npc');
        const nodeById = new Map(fullGraph.nodes.map(n => [n.id, n]));
        for (const node of npcNodes) {
          const perceivesEdges = fullGraph.edges.filter(
            e => e.relation === 'PERCEIVES' && e.fromNodeId === node.id
          );
          if (perceivesEdges.length === 0) continue;
          const perceptions = perceivesEdges.map(e => {
            const target = nodeById.get(e.toNodeId);
            const props = (e.properties ?? {}) as Record<string, unknown>;
            return {
              targetLabel: target?.label ?? e.toNodeId,
              targetType: target?.entityType ?? 'unknown',
              awarenessScore: props.awarenessScore,
              awarenessNote: props.awarenessNote,
              relationshipScore: props.relationshipScore,
              relationshipNote: props.relationshipNote,
            };
          });
          awareness.push({
            entityId: node.entityId,
            entityType: 'npc',
            label: node.label,
            perceptions,
          });
        }

        const snapshots = [];
        const latestSnapshot = await graphService.getLatestSnapshot(saveId);
        if (latestSnapshot) {
          snapshots.push({
            id: latestSnapshot.id,
            snapshotType: latestSnapshot.snapshotType,
            chapterNumber: latestSnapshot.chapterNumber,
            nodesCount: latestSnapshot.nodesCount,
            edgesCount: latestSnapshot.edgesCount,
            createdAt: latestSnapshot.createdAt,
          });
        }

        responseData.entityGraph = {
          nodeCount: fullGraph.nodes.length,
          edgeCount: fullGraph.edges.length,
          nodesByType,
          edgesByRelation,
          awareness,
          snapshots,
        };
      } catch (_graphError) {
        // Entity Graph 数据获取失败不影响主流程
      }

      return res.json(successResponse(responseData, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get story orchestration data', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/entity-graph', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId required', undefined, requestId));
      }
      const graphService = await getGraphService();
      const graph = await graphService.getFullGraph(saveId);
      return res.json(successResponse(graph, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get entity graph', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/entity-graph/subgraph', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      const centerNodeId = req.query.centerNodeId as string;
      const depth = parseInt(req.query.depth as string) || 1;
      if (!saveId || !centerNodeId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId and centerNodeId required', undefined, requestId));
      }
      const graphService = await getGraphService();
      const graph = await graphService.getSubgraph(saveId, centerNodeId, depth);
      return res.json(successResponse(graph, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get entity graph subgraph', { error: errorMessage });
      next(error);
      return;
    }
  });

  // 模块3: /entity-graph/awareness — 查询实体感知关系（基于 PERCEIVES 边，替代旧 /boundary）
  router.get('/entity-graph/awareness', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      const entityType = req.query.entityType as string;
      const entityId = req.query.entityId as string;
      if (!saveId || !entityType || !entityId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId, entityType and entityId required', undefined, requestId));
      }
      const { buildEntityNodeId } = await import('@ai-rpg/shared/utils/entity-graph-id');
      const graphService = await getGraphService();
      const observerNodeId = buildEntityNodeId(entityType, saveId, entityId);
      const fullGraph = await graphService.getFullGraph(saveId);
      const nodeById = new Map(fullGraph.nodes.map(n => [n.id, n]));
      const observerNode = nodeById.get(observerNodeId);
      if (!observerNode) {
        return res.status(404).json(errorResponse('NOT_FOUND', `Observer node not found: ${observerNodeId}`, undefined, requestId));
      }
      const outgoingPerceives = fullGraph.edges.filter(e =>
        e.fromNodeId === observerNodeId && e.relation === 'PERCEIVES'
      );
      const awareness = outgoingPerceives
        .map(edge => {
          const targetNode = nodeById.get(edge.toNodeId);
          if (!targetNode) return null;
          const props = (edge.properties ?? {}) as Record<string, unknown>;
          return {
            target: targetNode.label,
            targetType: targetNode.entityType,
            targetId: targetNode.entityId,
            awarenessScore: props.awarenessScore ?? null,
            awarenessNote: props.awarenessNote ?? null,
            relationshipScore: props.relationshipScore ?? null,
            relationshipNote: props.relationshipNote ?? null,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);
      return res.json(successResponse({
        observer: { id: entityId, type: entityType, label: observerNode.label },
        awareness,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get entity awareness', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.get('/entity-graph/snapshots', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId required', undefined, requestId));
      }
      const graphService = await getGraphService();
      const snapshots = await graphService.getAllSnapshots(saveId);
      return res.json(successResponse(snapshots, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get entity graph snapshots', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === NPC Goal API ===
  router.get('/npc-goals', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      const npcId = req.query.npcId as string;
      const status = req.query.status as string | undefined;
      if (!saveId || !npcId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId and npcId are required', undefined, requestId));
      }
      const npcService = await createNPCServiceForDev(saveId);
      if (!npcService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'NPCServiceTool not available', undefined, requestId));
      }
      const goals = await npcService.getGoals(saveId, npcId, status);
      return res.json(successResponse(goals, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get NPC goals', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/npc-goals', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId, npcId, type, category, description, priority, relatedEntityIds } = req.body;
      if (!saveId || !npcId || !type || !category || !description) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId, npcId, type, category, and description are required', undefined, requestId));
      }
      const npcService = await createNPCServiceForDev(saveId);
      if (!npcService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'NPCServiceTool not available', undefined, requestId));
      }
      const goalId = await npcService.createGoal(saveId, npcId, { type, category, description, priority, relatedEntityIds });
      return res.json(successResponse({ goalId }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to create NPC goal', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.patch('/npc-goals/:goalId', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { goalId } = req.params;
      const { saveId, status, priority, progress, description } = req.body;
      if (!saveId || !goalId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId and goalId are required', undefined, requestId));
      }
      const npcService = await createNPCServiceForDev(saveId);
      if (!npcService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'NPCServiceTool not available', undefined, requestId));
      }
      await npcService.updateGoal(saveId, goalId, { status, priority, progress, description });
      return res.json(successResponse({ goalId, updated: true }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to update NPC goal', { error: errorMessage });
      next(error);
      return;
    }
  });

  router.post('/npc-currency/modify', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId, npcId, currencyType, delta } = req.body;
      if (!saveId || !npcId || !currencyType || delta === undefined) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId, npcId, currencyType, and delta are required', undefined, requestId));
      }
      const npcService = await createNPCServiceForDev(saveId);
      if (!npcService) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'NPCServiceTool not available', undefined, requestId));
      }
      const currency = await npcService.modifyCurrency(saveId, npcId, currencyType, delta);
      return res.json(successResponse(currency, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to modify NPC currency', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /prompt-composition — 查看 Prompt 组合结构 ===
  router.get('/prompt-composition', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      if (!coordinatorAgent) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'CoordinatorAgent not available', undefined, requestId));
      }

      const promptModule = coordinatorAgent.getPromptModule();
      const rawSaveId = readSingleQueryParam(req.query.saveId);
      const rawAgentKey = readSingleQueryParam(req.query.agentKey);
      const rawIntentHint = readSingleQueryParam(req.query.intentHint);

      if (rawSaveId === null) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId must be a string', undefined, requestId));
      }
      if (rawAgentKey === null) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'agentKey must be a string', undefined, requestId));
      }
      if (rawIntentHint === null) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'intentHint must be a string', undefined, requestId));
      }

      const saveId = rawSaveId;
      const agentKey = rawAgentKey;
      const intentHint = rawIntentHint;

      const hasAgentKeyParam = agentKey !== undefined;
      const hasIntentHintParam = intentHint !== undefined;
      const hasCustomParams = hasAgentKeyParam || hasIntentHintParam;

      if (hasAgentKeyParam && agentKey.trim() === '') {
        return res.status(400).json(errorResponse(
          'INVALID_REQUEST',
          'agentKey cannot be empty',
          { validAgentTypes: [...VALID_AGENT_TYPES] },
          requestId,
        ));
      }

      let effectiveAgentKey = hasAgentKeyParam ? agentKey : 'gamemaster';
      let lastResult: import('../agents/prompt/types.js').PromptBuildResult | null;

      if (hasCustomParams) {
        if (!VALID_AGENT_TYPES.has(effectiveAgentKey)) {
          return res.status(400).json(errorResponse(
            'INVALID_REQUEST',
            `Invalid agentKey: ${effectiveAgentKey}`,
            { validAgentTypes: [...VALID_AGENT_TYPES] },
            requestId,
          ));
        }
        if (!coordinatorAgent.getPromptAgentConfig) {
          return res.status(503).json(errorResponse(
            'SERVICE_UNAVAILABLE',
            'CoordinatorAgent does not support prompt agentConfig previews',
            undefined,
            requestId,
          ));
        }
        const agentConfig = coordinatorAgent.getPromptAgentConfig(effectiveAgentKey);
        if (!agentConfig) {
          return res.status(400).json(errorResponse(
            'INVALID_REQUEST',
            `Agent config not found for agentKey: ${effectiveAgentKey}`,
            { validAgentTypes: [...VALID_AGENT_TYPES] },
            requestId,
          ));
        }
        const ctx: PromptContext = {
          agentKey: effectiveAgentKey,
          agentConfig,
          excludedMethods: [],
          language: null,
          message: {
            payload: {
              action: 'chat',
              intentHint: intentHint || undefined,
            },
          },
          templateContext: null,
          domain: { db, saveId: saveId || undefined },
          options: {},
        };
        lastResult = await promptModule.buildPreview(ctx);
      } else {
        lastResult = promptModule.getLastBuildResult();
      }

      if (!lastResult?.systemPromptTrace || !lastResult?.userPromptTrace) {
        return res.json(successResponse({
          agentKey: effectiveAgentKey,
          intentHint: intentHint || null,
          action: null,
          timestamp: null,
          systemPrompt: null,
          userPrompt: null,
          tools: null,
        }, requestId));
      }

      const systemTrace: SystemPromptBuildResult = lastResult.systemPromptTrace;
      const userTrace: UserPromptBuildResult = lastResult.userPromptTrace;
      const apiTools = lastResult.apiTools as Array<{ type: string; methods?: string[] }>;
      const toolExposureTrace = lastResult.toolExposureTrace;
      const runtimeToolExposureBudget = !hasCustomParams
        ? (coordinatorAgent as any).getRuntimeSnapshot?.()?.toolVisibilitySnapshot.toolExposureBudget
        : undefined;
      const visibleTools = toolExposureTrace?.visibleTools ?? [];
      const deferredTools = toolExposureTrace?.deferredTools ?? [];
      const visibleToolTypes = new Set(visibleTools.map((entry) => entry.toolType));
      const deferredToolTypes = new Set(deferredTools.map((entry) => entry.toolType));
      const allToolTypes = new Set([
        ...visibleToolTypes,
        ...deferredToolTypes,
      ]);

      return res.json(successResponse({
        agentKey: effectiveAgentKey,
        intentHint: userTrace.intentHint,
        action: userTrace.action,
        timestamp: Date.now(),
        systemPrompt: {
          totalTokens: systemTrace.totalTokens,
          layers: systemTrace.layers,
        },
        userPrompt: {
          totalTokens: userTrace.totalTokens,
          action: userTrace.action,
          intentHint: userTrace.intentHint,
          blocks: userTrace.blocks,
        },
        tools: {
          totalTools: allToolTypes.size > 0 ? allToolTypes.size : apiTools.length,
          totalMethods: visibleTools.length + deferredTools.length,
          visibleTools: visibleToolTypes.size,
          deferredTools: deferredToolTypes.size,
          maxOnDemandLoads: runtimeToolExposureBudget?.maxOnDemandLoadsPerTurn ?? toolExposureTrace?.budget.maxOnDemandLoadsPerTurn ?? 0,
          usedOnDemandLoads: runtimeToolExposureBudget?.usedOnDemandLoads ?? toolExposureTrace?.budget.usedOnDemandLoads ?? 0,
          visibleToolNames: visibleTools.map((entry) => entry.functionName),
          deferredToolNames: deferredTools.map((entry) => entry.functionName),
          trimmedReasons: toolExposureTrace?.trimmedReasons ?? [],
        },
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get prompt composition', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /prompt-config — 查看 Rules 和 Skills 配置 ===
  router.get('/prompt-config', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      if (!coordinatorAgent) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'CoordinatorAgent not available', undefined, requestId));
      }

      const promptModule = coordinatorAgent.getPromptModule();
      const rulesEngine = promptModule.rules;
      const skillRegistry = promptModule.skills;

      await rulesEngine.loadAllRules();
      await skillRegistry.loadAllSkills();

      const allRuleNames = rulesEngine.ruleNames;
      const rules = allRuleNames.map(name => {
        const rule = rulesEngine.getRuleByName(name)!;
        return {
          name: rule.name,
          alwaysApply: rule.alwaysApply,
          hook: rule.hook,
          targetAgent: rule.targetAgent,
          description: rule.description,
          priority: rule.priority,
          enabled: rule.enabled,
          filePath: rule.filePath,
        };
      });

      const allSkillNames = skillRegistry.skillNames;
      const skills = allSkillNames.map(name => {
        const skill = skillRegistry.getSkillByName(name)!;
        return {
          name: skill.name,
          description: skill.description,
          targetAgent: skill.targetAgent,
          trigger: skill.trigger,
          whenToUse: skill.whenToUse,
          recommendedTools: skill.recommendedTools,
          relatedRules: skill.relatedRules,
          enabled: skill.enabled,
          filePath: skill.filePath,
        };
      });

      const alwaysApplyCount = rules.filter(r => r.alwaysApply).length;
      const hookedCount = rules.filter(r => !r.alwaysApply && r.hook.length > 0).length;

      return res.json(successResponse({
        rules: {
          totalRules: rules.length,
          alwaysApplyCount,
          hookedCount,
          rules,
        },
        skills: {
          totalSkills: skills.length,
          skills,
        },
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get prompt config', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /knowledge/:type/:name — 获取知识条目全文 ===
  router.get('/knowledge/:type/:name', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { type, name } = req.params;

      if (!['skill', 'rule', 'help'].includes(type)) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'type must be skill, rule, or help', undefined, requestId));
      }

      if (!coordinatorAgent) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'CoordinatorAgent not available', undefined, requestId));
      }

      const promptModule = coordinatorAgent.getPromptModule();

      if (type === 'skill') {
        const skillRegistry = promptModule.skills;
        await skillRegistry.loadAllSkills();
        const skill = skillRegistry.getSkillByName(name);
        if (!skill) {
          return res.status(404).json(errorResponse('NOT_FOUND', `Skill not found: ${name}`, undefined, requestId));
        }
        const content = await skillRegistry.loadSkillContent(name);
        const stat = fs.statSync(skill.filePath);
        return res.json(successResponse({
          type: 'skill',
          name: skill.name,
          filePath: skill.filePath,
          content: content ?? '',
          frontmatter: {
            name: skill.name,
            description: skill.description,
            targetAgent: skill.targetAgent,
            trigger: skill.trigger,
            whenToUse: skill.whenToUse,
            recommendedTools: skill.recommendedTools,
            relatedRules: skill.relatedRules,
            completionCriteria: skill.completionCriteria,
            version: skill.version,
            enabled: skill.enabled,
          },
          lastModified: stat.mtime.toISOString(),
        }, requestId));
      }

      if (type === 'rule') {
        const rulesEngine = promptModule.rules;
        await rulesEngine.loadAllRules();
        const rule = rulesEngine.getRuleByName(name);
        if (!rule) {
          return res.status(404).json(errorResponse('NOT_FOUND', `Rule not found: ${name}`, undefined, requestId));
        }
        const stat = fs.statSync(rule.filePath);
        return res.json(successResponse({
          type: 'rule',
          name: rule.name,
          filePath: rule.filePath,
          content: rule.content,
          frontmatter: {
            name: rule.name,
            alwaysApply: rule.alwaysApply,
            hook: rule.hook,
            targetAgent: rule.targetAgent,
            description: rule.description,
            priority: rule.priority,
            enabled: rule.enabled,
          },
          lastModified: stat.mtime.toISOString(),
        }, requestId));
      }

      if (type === 'help') {
        if (!helpRegistry) {
          return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'HelpRegistry not available', undefined, requestId));
        }
        // 先按 method 名查找单个条目
        const entry = helpRegistry.getHelpEntryByName(name);
        if (entry) {
          const content = await helpRegistry.getHelp(entry.tool, entry.method);
          const stat = fs.statSync(entry.filePath);
          return res.json(successResponse({
            type: 'help',
            name: entry.method,
            filePath: entry.filePath,
            content: content ?? '',
            frontmatter: {
              tool: entry.tool,
              method: entry.method,
              description: entry.description,
            },
            lastModified: stat.mtime.toISOString(),
          }, requestId));
        }
        // 按 method 名找不到时，按 service 名查找该 service 下的所有 help 文档并聚合
        const serviceEntries = helpRegistry.getHelpDocsByService(name);
        if (serviceEntries.length === 0) {
          return res.status(404).json(errorResponse('NOT_FOUND', `Help doc not found: ${name}`, undefined, requestId));
        }
        const aggregatedContent = await Promise.all(
          serviceEntries.map(async (e) => {
            const content = await helpRegistry.getHelp(e.tool, e.method);
            return `## ${e.method}\n\n${content ?? ''}`;
          })
        );
        const stat = fs.statSync(serviceEntries[0].filePath);
        return res.json(successResponse({
          type: 'help',
          name,
          filePath: serviceEntries[0].filePath,
          content: aggregatedContent.join('\n\n'),
          frontmatter: {
            tool: name,
            methodCount: serviceEntries.length,
            methods: serviceEntries.map(e => e.method),
            description: `${name} service - ${serviceEntries.length} methods`,
          },
          lastModified: stat.mtime.toISOString(),
        }, requestId));
      }

      return res.status(400).json(errorResponse('INVALID_REQUEST', 'type must be skill, rule, or help', undefined, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get knowledge item', { type: req.params.type, name: req.params.name, error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /help-registry — 获取 HelpRegistry 配置概览 ===
  router.get('/help-registry', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      if (!helpRegistry) {
        return res.status(503).json(errorResponse('SERVICE_UNAVAILABLE', 'HelpRegistry not available', undefined, requestId));
      }

      const docs = helpRegistry.getAllHelpDocs();
      return res.json(successResponse({
        totalDocs: docs.length,
        docs,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get help registry', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /staging-pool — 获取 StagingPool 状态 ===
  router.get('/staging-pool', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const traces = devTraceCollector?.getTraces(saveId, 'staging_write', 50) ?? [];
      return res.json(successResponse({
        saveId,
        stagingWriteTraces: traces,
        traceCount: traces.length,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get staging pool state', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /continuity-audit — 获取审计日志 ===
  router.get('/continuity-audit', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      const limit = parseInt(req.query.limit as string) || 20;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const traces = devTraceCollector?.getTraces(saveId, 'audit_decision', limit) ?? [];
      return res.json(successResponse({
        saveId,
        auditTraces: traces,
        traceCount: traces.length,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get continuity audit traces', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /event-bus — 获取 EventBus 事件 ===
  router.get('/event-bus', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      const limit = parseInt(req.query.limit as string) || 50;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const traces = devTraceCollector?.getTraces(saveId, 'event_bus_publish', limit) ?? [];
      return res.json(successResponse({
        saveId,
        eventBusTraces: traces,
        traceCount: traces.length,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get event bus traces', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === GET /entity-graph-changes — 获取实体图变更 ===
  router.get('/entity-graph-changes', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const saveId = req.query.saveId as string;
      const limit = parseInt(req.query.limit as string) || 50;
      if (!saveId) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'saveId query parameter is required', undefined, requestId));
      }

      const traces = devTraceCollector?.getTraces(saveId, 'graph_change', limit) ?? [];
      return res.json(successResponse({
        saveId,
        graphChangeTraces: traces,
        traceCount: traces.length,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to get entity graph change traces', { error: errorMessage });
      next(error);
      return;
    }
  });

  logger.info('Dev routes initialized');

  return router;
}

function computeDiff(obj1: Record<string, any>, obj2: Record<string, any>, prefix: string = ''): any[] {
  const differences: any[] = [];
  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

  for (const key of allKeys) {
    const fullPath = prefix ? `${prefix}.${key}` : key;

    if (!(key in obj1)) {
      differences.push({ path: fullPath, type: 'added', value: obj2[key] });
      continue;
    }
    if (!(key in obj2)) {
      differences.push({ path: fullPath, type: 'removed', value: obj1[key] });
      continue;
    }

    const val1 = obj1[key];
    const val2 = obj2[key];

    if (typeof val1 !== typeof val2) {
      differences.push({ path: fullPath, type: 'changed', oldValue: val1, newValue: val2 });
      continue;
    }

    if (val1 === null || val2 === null || typeof val1 !== 'object') {
      if (val1 !== val2) {
        differences.push({ path: fullPath, type: 'changed', oldValue: val1, newValue: val2 });
      }
      continue;
    }

    if (Array.isArray(val1) && Array.isArray(val2)) {
      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        differences.push({ path: fullPath, type: 'changed', oldValue: val1, newValue: val2 });
      }
      continue;
    }

    if (typeof val1 === 'object' && typeof val2 === 'object') {
      differences.push(...computeDiff(val1, val2, fullPath));
    }
  }

  return differences;
}