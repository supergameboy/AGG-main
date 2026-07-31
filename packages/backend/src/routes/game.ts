import { Router, Request, Response, NextFunction } from 'express';
import { TemplatePoolService } from '../services/template-pool.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger } from '../utils/logger.js';
import { isInitAction } from '../utils/constants.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { processInitialize, processChat } from '../services/game-service.js';
import type { GameServiceDeps } from '../services/game-service.js';
import type { Knex } from 'knex';
import type { AgentRuntime } from '../agents/AgentRuntime.js';
import { validateBody } from '../middlewares/validate.js';
import { chatSchema } from '../schemas/agent.schema.js';

const logger = createChildLogger('routes:game');

export function createGameRoutes(
  coordinatorAgent: AgentRuntime,
  db: Knex,
  gameServiceDeps: GameServiceDeps,
): Router {
  const router = Router();

  /**
   * POST /api/v1/game
   * 信息处理中枢：单一端点，根据 action 内部分发
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    const { action = 'chat' } = req.body;

    try {
      if (isInitAction(action)) {
        return await handleInitialize(req, res, requestId, coordinatorAgent, db, gameServiceDeps);
      }
      return await handleChat(req, res, requestId, coordinatorAgent, db, gameServiceDeps);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Game route error', { action, error: errorMessage });
      next(error);
      return;
    }
  });

  /**
   * POST /api/v1/game/chat - 对话请求（带 chatSchema 验证）
   */
  router.post('/chat', validateBody(chatSchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;

    try {
      return await handleChat(req, res, requestId, coordinatorAgent, db, gameServiceDeps);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Game chat route error', { error: errorMessage });
      next(error);
      return;
    }
  });

  // === DevTools: 池查询端点 ===

  // GET /:saveId/pool/template/skills — 查询模板技能池
  router.get('/:saveId/pool/template/skills', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const save = await db('saves').where({ id: saveId }).first('template_id');
      if (!save) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, { saveId }, requestId));
      }

      const templatePoolService = new TemplatePoolService(db);
      const skills = await templatePoolService.listSkills(save.template_id, {
        category: req.query.category as string | undefined,
        recommendedClass: req.query.recommendedClass as string | undefined,
      });
      return res.json(successResponse({ saveId, templateId: save.template_id, skills }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query template skill pool', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  // GET /:saveId/pool/template/items — 查询模板物品池
  router.get('/:saveId/pool/template/items', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const save = await db('saves').where({ id: saveId }).first('template_id');
      if (!save) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, { saveId }, requestId));
      }

      const templatePoolService = new TemplatePoolService(db);
      const items = await templatePoolService.listItems(save.template_id, {
        category: req.query.category as string | undefined,
        equippedSlot: req.query.equippedSlot as string | undefined,
        recommendedClass: req.query.recommendedClass as string | undefined,
        quality: req.query.quality as string | undefined,
      });
      return res.json(successResponse({ saveId, templateId: save.template_id, items }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query template item pool', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  // GET /:saveId/pool/save/skills — 查询存档技能池
  router.get('/:saveId/pool/save/skills', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const saveExists = await db('saves').where({ id: saveId }).first('id');
      if (!saveExists) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, { saveId }, requestId));
      }

      let query = db('skill_pool').where({ save_id: saveId });
      if (req.query.category) {
        query = query.where({ category: req.query.category as string });
      }
      if (req.query.learned !== undefined) {
        query = query.where({ learned: req.query.learned === 'true' });
      }
      const skills = await query.orderBy('created_at', 'asc');
      return res.json(successResponse({ saveId, skills }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query save skill pool', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  // GET /:saveId/pool/save/items — 查询存档物品池
  router.get('/:saveId/pool/save/items', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const saveExists = await db('saves').where({ id: saveId }).first('id');
      if (!saveExists) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, { saveId }, requestId));
      }

      let query = db('item_pool').where({ save_id: saveId });
      if (req.query.category) {
        query = query.where({ category: req.query.category as string });
      }
      if (req.query.taken !== undefined) {
        query = query.where({ taken: req.query.taken === 'true' });
      }
      const items = await query.orderBy('created_at', 'asc');
      return res.json(successResponse({ saveId, items }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query save item pool', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  // GET /:saveId/pool/stats — 池统计（模板 + 存档）
  router.get('/:saveId/pool/stats', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { saveId } = req.params;
      const save = await db('saves').where({ id: saveId }).first('template_id');
      if (!save) {
        return res.status(404).json(errorResponse('SAVE_NOT_FOUND', `Save not found: ${saveId}`, { saveId }, requestId));
      }

      const templatePoolService = new TemplatePoolService(db);
      const templateStats = await templatePoolService.getPoolStats(save.template_id);

      const [saveSkillCount, saveLearnedCount, saveItemCount, saveTakenCount] = await Promise.all([
        db('skill_pool').where({ save_id: saveId }).count('* as count').first(),
        db('skill_pool').where({ save_id: saveId, learned: 1 }).count('* as count').first(),
        db('item_pool').where({ save_id: saveId }).count('* as count').first(),
        db('item_pool').where({ save_id: saveId, taken: 1 }).count('* as count').first(),
      ]);

      return res.json(successResponse({
        templatePool: templateStats,
        savePool: {
          skillCount: Number(saveSkillCount?.count ?? 0),
          learnedCount: Number(saveLearnedCount?.count ?? 0),
          itemCount: Number(saveItemCount?.count ?? 0),
          takenCount: Number(saveTakenCount?.count ?? 0),
        },
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to query pool stats', { saveId: req.params.saveId, error: errorMessage });
      next(error);
      return;
    }
  });

  return router;
}

/**
 * 处理初始化请求：解析参数 → 调用共享服务 → 格式化HTTP响应
 */
async function handleInitialize(
  req: Request, res: Response, requestId: string | undefined,
  coordinatorAgent: AgentRuntime, db: Knex, gameServiceDeps: GameServiceDeps,
) {
  const body = req.body.data || req.body;
  const { templateId, characterData, language } = body;

  const result = await processInitialize(
    { coordinatorAgent, db, ...gameServiceDeps },
    { templateId, characterData, language, requestId },
  );

  if (!result.success) {
    const statusCode = result.errorCode === 'TEMPLATE_ID_REQUIRED' || result.errorCode === 'INVALID_CHARACTER_DATA'
      ? 400
      : 400;
    return res.status(statusCode).json(errorResponse(
      result.errorCode ?? 'GAME_INIT_FAILED',
      result.error ?? '游戏初始化失败',
      result.data,
      requestId,
    ));
  }

  return res.json(successResponse({
    success: true,
    data: result.data,
    metadata: result.metadata,
  }, requestId));
}

/**
 * 处理对话请求：解析参数 → 调用共享服务 → 格式化HTTP响应
 */
async function handleChat(
  req: Request, res: Response, requestId: string | undefined,
  coordinatorAgent: AgentRuntime, db: Knex, gameServiceDeps: GameServiceDeps,
) {
  const { message, saveId, action = 'chat', data, npcId, targetNpcIds, playerAction, context, dataChanges } = req.body;

  const result = await processChat(
    { coordinatorAgent, db, ...gameServiceDeps },
    { message, saveId, action, data, npcId, targetNpcIds, playerAction, context, dataChanges, requestId },
  );

  if (!result.success) {
    if (result.errorCode === 'INPUT_BLOCKED') {
      return res.status(400).json(errorResponse(
        'INPUT_BLOCKED',
        result.error || '输入异常',
        result.data,
        requestId,
      ));
    }
    // SAVE_ID_REQUIRED / SAVE_NOT_FOUND 等校验错误
    const statusCode = result.errorCode === 'SAVE_NOT_FOUND' ? 404 : 400;
    return res.status(statusCode).json(errorResponse(
      result.errorCode ?? 'UNKNOWN_ERROR',
      result.error ?? 'Unknown error',
      result.data,
      requestId,
    ));
  }

  // partialSuccess 场景
  if (result.metadata?.partialSuccess) {
    return res.status(200).json(successResponse(result.data, requestId));
  }

  return res.json(successResponse({
    ...result.data,
    metadata: result.metadata,
  }, requestId));
}
