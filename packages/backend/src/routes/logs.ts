import { Router, Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { successResponse, errorResponse } from '../utils/response.js';
import { createChildLogger, frontendLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { validateBody, validateQuery } from '../middlewares/validate.js';
import {
  logEntriesSchema,
  logQuerySchema,
  logDeleteSchema,
} from '../schemas/logs.schema.js';
import type { Knex } from 'knex';

const logger = createChildLogger('routes:logs');

export function createLogRoutes(db: Knex): Router {
  const router = Router();

  /**
   * POST / - 批量保存前端日志条目
   *
   * 将前端日志同时写入数据库和Winston的frontend日志文件
   * 验证：使用logEntriesSchema验证请求体
   */
  router.post('/', validateBody(logEntriesSchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const { entries } = (req as any).validatedBody || req.body;

      logger.info('Received frontend log entries', { count: entries.length });

      const now = Date.now();
      const dbRows = entries.map((entry: any) => ({
        level: entry.level,
        category: entry.category,
        source: entry.source,
        message: entry.message,
        data: entry.data || null,
        stack_trace: entry.stackTrace || null,
        session_id: (req as any).sessionId || null,
        timestamp: entry.timestamp,
        created_at: now,
      }));

      let dbSaved = false;
      try {
        await db('frontend_logs').insert(dbRows);
        dbSaved = true;
      } catch (dbError) {
        const dbErrorMessage = dbError instanceof Error ? dbError.message : 'Unknown DB error';
        logger.error('Failed to write frontend logs to database', {
          error: dbErrorMessage,
          stack: dbError instanceof Error ? dbError.stack : undefined,
          rowCount: dbRows.length,
        });
      }

      // 同时写入Winston的frontend日志文件
      for (const entry of entries) {
        const logMeta: Record<string, unknown> = {
          category: entry.category,
          source: entry.source,
          frontend: true,
        };
        if (entry.data) {
          try {
            logMeta.data = JSON.parse(entry.data);
          } catch {
            logMeta.data = entry.data;
          }
        }
        if (entry.stackTrace) {
          logMeta.stackTrace = entry.stackTrace;
        }

        switch (entry.level) {
          case 'error':
            frontendLogger.error(entry.message, logMeta);
            break;
          case 'warn':
            frontendLogger.warn(entry.message, logMeta);
            break;
          case 'info':
            frontendLogger.info(entry.message, logMeta);
            break;
          case 'debug':
            frontendLogger.debug(entry.message, logMeta);
            break;
        }
      }

      return res.status(201).json(successResponse({
        saved: true,
        count: entries.length,
        dbPersisted: dbSaved,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const zodIssues = error instanceof ZodError ? error.issues : undefined;
      logger.error('Failed to save frontend log entries', {
        error: errorMessage,
        stack: errorStack,
        zodIssues,
      });
      next(error);
      return;
    }
  });

  /**
   * GET / - 查询前端日志
   *
   * 支持按level、category、sessionId过滤，支持分页和关键词搜索
   * 验证：使用logQuerySchema验证查询参数
   */
  router.get('/', validateQuery(logQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const {
        level,
        category,
        limit = 50,
        offset = 0,
        sessionId,
        search,
      } = (req as any).validatedQuery || req.query;

      logger.info('Querying frontend logs', { level, category, limit, offset, sessionId, search });

      let query = db('frontend_logs').select('*');

      if (level) {
        query = query.where('level', level);
      }
      if (category) {
        query = query.where('category', category);
      }
      if (sessionId) {
        query = query.where('session_id', sessionId);
      }
      if (search) {
        query = query.where('message', 'like', `%${search}%`);
      }

      // 获取总数
      const countQuery = query.clone();
      const [{ 'count(*)': total }] = await countQuery.count('* as count');

      // 分页查询，按时间戳倒序
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
      logger.error('Failed to query frontend logs', { error: errorMessage });
      next(error);
      return;
    }
  });

  /**
   * GET /stats - 获取日志统计信息
   *
   * 按level和category分组计数
   */
  router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      logger.info('Fetching frontend log stats');

      // 按level分组统计
      const byLevel = await db('frontend_logs')
        .select('level')
        .count('* as count')
        .groupBy('level');

      // 按category分组统计
      const byCategory = await db('frontend_logs')
        .select('category')
        .count('* as count')
        .groupBy('category')
        .orderBy('count', 'desc')
        .limit(20);

      // 总数
      const [{ 'count(*)': total }] = await db('frontend_logs').count('* as count');

      // 格式化结果
      const levelStats: Record<string, number> = {};
      for (const row of byLevel) {
        levelStats[row.level] = row.count as number;
      }

      const categoryStats: Record<string, number> = {};
      for (const row of byCategory) {
        categoryStats[row.category] = row.count as number;
      }

      return res.json(successResponse({
        total: total as number,
        byLevel: levelStats,
        byCategory: categoryStats,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to fetch frontend log stats', { error: errorMessage });
      next(error);
      return;
    }
  });

  /**
   * DELETE / - 清除日志
   *
   * 支持按beforeTimestamp、level、category条件清除
   * 验证：使用logDeleteSchema验证查询参数
   */
  router.delete('/', validateQuery(logDeleteSchema), async (req: Request, res: Response, next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    try {
      const {
        beforeTimestamp,
        level,
        category,
      } = (req as any).validatedQuery || req.query;

      logger.info('Deleting frontend logs', { beforeTimestamp, level, category });

      let query = db('frontend_logs');

      if (beforeTimestamp) {
        query = query.where('timestamp', '<', beforeTimestamp);
      }
      if (level) {
        query = query.where('level', level);
      }
      if (category) {
        query = query.where('category', category);
      }

      // 如果没有任何过滤条件，不允许删除全部日志（安全措施）
      if (!beforeTimestamp && !level && !category) {
        return res.status(400).json(
          errorResponse('INVALID_REQUEST', 'At least one filter condition (beforeTimestamp, level, or category) is required for deletion', undefined, requestId)
        );
      }

      const deleted = await query.del();

      return res.json(successResponse({
        deleted: true,
        count: deleted,
      }, requestId));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to delete frontend logs', { error: errorMessage });
      next(error);
      return;
    }
  });

  logger.info('Log routes initialized');

  return router;
}
