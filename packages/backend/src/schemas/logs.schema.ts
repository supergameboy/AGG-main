import { z } from 'zod';

// ==================== Logs路由 Zod Schema 定义 ====================
//
// 本文件为Logs API的端点提供完整的Zod Schema定义：
// - POST /            → LogEntriesRequestBody
// - GET /             → LogQueryParams
// - GET /stats        → 无参数
// - DELETE /          → LogDeleteParams

// ==================== 1. POST / - 批量保存前端日志 ====================

/**
 * 单条前端日志条目Schema
 */
export const logEntrySchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug'], {
    message: 'level must be one of: error, warn, info, debug'
  }).describe('日志级别'),

  category: z.enum(['system', 'api', 'websocket', 'agent', 'error', 'ui', 'performance', 'snapshot', 'consistency', 'state', 'network'], {
    message: 'category must be one of: system, api, websocket, agent, error, ui, performance, snapshot, consistency, state, network'
  })
    .describe('日志分类'),

  source: z.string()
    .min(1, 'source is required')
    .max(200, 'source must be at most 200 characters')
    .describe('日志来源'),

  message: z.string()
    .min(1, 'message is required')
    .max(10000, 'message must be at most 10000 characters')
    .describe('日志消息'),

  data: z.preprocess(
    (val) => {
      if (typeof val === 'object' && val !== null) {
        try {
          return JSON.stringify(val);
        } catch {
          return '[unserializable]';
        }
      }
      return val;
    },
    z.string()
      .max(50000, 'data must be at most 50000 characters')
      .optional()
  )
    .describe('附加数据（JSON字符串或对象，可选）'),

  stackTrace: z.string()
    .max(50000, 'stackTrace must be at most 50000 characters')
    .optional()
    .describe('堆栈跟踪（可选）'),

  timestamp: z.number()
    .int('timestamp must be an integer')
    .describe('日志时间戳（毫秒）'),
});

/** LogEntry 类型导出 */
export type LogEntry = z.infer<typeof logEntrySchema>;

/**
 * 批量保存前端日志请求体Schema
 *
 * @example
 * ```typescript
 * // 有效请求
 * {
 *   entries: [
 *     { level: "error", category: "api", source: "GameService", message: "Failed to load", timestamp: 1712630400000 },
 *     { level: "info", category: "ui", source: "CharacterPanel", message: "Panel rendered", timestamp: 1712630401000 }
 *   ]
 * }
 *
 * // 无效请求
 * {}                          // 缺少entries
 * { entries: [] }             // entries不能为空
 * { entries: [{}] }           // 条目缺少必填字段
 * ```
 */
export const logEntriesSchema = z.object({
  entries: z.array(logEntrySchema)
    .min(1, 'At least one log entry is required')
    .max(100, 'At most 100 log entries per request')
    .describe('日志条目数组'),
});

/** LogEntriesRequestBody 类型导出 */
export type LogEntriesRequestBody = z.infer<typeof logEntriesSchema>;

// ==================== 2. GET / - 查询前端日志 ====================

/**
 * 查询前端日志参数Schema
 *
 * @example
 * ```typescript
 * // 有效查询
 * ?level=error&limit=50&offset=0
 * ?category=api&search=failed
 * ?sessionId=abc123&limit=100
 * ```
 */
export const logQuerySchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug'], {
    message: 'level must be one of: error, warn, info, debug'
  }).optional()
    .describe('按日志级别过滤'),

  category: z.string()
    .max(100, 'category must be at most 100 characters')
    .optional()
    .describe('按分类过滤'),

  limit: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number({
      message: '必须是数字'
    })
      .int('必须是整数')
      .min(1, '最小值为1')
      .max(1000, '最大值为1000')
      .default(50)
  )
  .optional()
  .describe('每页数量，默认50，最大1000'),

  offset: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number({
      message: '必须是数字'
    })
      .int('必须是整数')
      .min(0, '不能为负数')
      .default(0)
  )
  .optional()
  .describe('偏移量，默认0'),

  sessionId: z.string()
    .max(200, 'sessionId must be at most 200 characters')
    .optional()
    .describe('按会话ID过滤'),

  search: z.string()
    .max(500, 'search must be at most 500 characters')
    .optional()
    .describe('搜索关键词（匹配message字段）'),
});

/** LogQueryParams 类型导出 */
export type LogQueryParams = z.infer<typeof logQuerySchema>;

// ==================== 3. GET /stats - 日志统计 ====================
// 无参数端点，无需Schema

// ==================== 4. DELETE / - 清除日志 ====================

/**
 * 清除日志参数Schema
 *
 * @example
 * ```typescript
 * // 清除7天前的日志
 * ?beforeTimestamp=1712544000000
 *
 * // 清除特定级别的日志
 * ?level=debug
 *
 * // 清除特定分类的日志
 * ?category=api
 * ```
 */
export const logDeleteSchema = z.object({
  beforeTimestamp: z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      }
      return val;
    },
    z.number({
      message: '必须是数字'
    })
      .int('必须是整数')
      .min(0, '不能为负数')
  )
  .optional()
  .describe('清除此时间戳之前的日志（毫秒）'),

  level: z.enum(['error', 'warn', 'info', 'debug'], {
    message: 'level must be one of: error, warn, info, debug'
  }).optional()
    .describe('按日志级别清除'),

  category: z.string()
    .max(100, 'category must be at most 100 characters')
    .optional()
    .describe('按分类清除'),
});

/** LogDeleteParams 类型导出 */
export type LogDeleteParams = z.infer<typeof logDeleteSchema>;
