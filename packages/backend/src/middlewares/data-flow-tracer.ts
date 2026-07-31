import { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../utils/logger.js';

// 扩展 Express Request 类型
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      traceData?: (stepName: string, data: Record<string, unknown>) => void;
      _traceContext?: TraceContext;
    }
  }
}

// 追踪级别类型
type TraceLevel = 'full' | 'basic' | 'off';

// 数据截断配置
const TRUNCATE_CONFIG = {
  requestBodyFieldMaxLength: 500,
  responseBodyPreviewLength: 200,
};

// 追踪上下文接口
interface TraceContext {
  traceId: string;
  startTime: number;
  logger: ReturnType<typeof createChildLogger>;
  lastTraceData: {
    stepName: string;
    data: Record<string, unknown>;
    keys: string[];
  } | null;
  level: TraceLevel;
}

/**
 * 截断字符串到指定长度
 */
function truncateString(value: unknown, maxLength: number): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  const str = typeof value === 'string' ? value : JSON.stringify(value);

  if (str.length <= maxLength) {
    return str;
  }

  return str.substring(0, maxLength) + `... [truncated, total ${str.length} chars]`;
}

/**
 * 截断对象中的所有字符串值
 */
function truncateObject(obj: Record<string, unknown>, maxFieldLength: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = truncateObject(value as Record<string, unknown>, maxFieldLength);
    } else if (typeof value === 'string' && value.length > maxFieldLength) {
      result[key] = truncateString(value, maxFieldLength);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 获取追踪日志级别
 */
function getTraceLevel(): TraceLevel {
  const envLevel = process.env.LOG_TRACE_LEVEL?.toLowerCase();

  if (envLevel === 'basic') {
    return 'basic';
  }

  if (envLevel === 'off' || envLevel === 'false' || envLevel === '0') {
    return 'off';
  }

  // 默认返回 full（开发环境）
  return 'full';
}

/**
 * 检测数据差异并输出警告
 */
function detectDataLoss(
  context: TraceContext,
  stepName: string,
  currentData: Record<string, unknown>,
  currentKeys: string[]
): void {
  if (!context.lastTraceData) {
    // 第一次调用，只记录数据不检测差异
    context.lastTraceData = {
      stepName,
      data: currentData,
      keys: currentKeys,
    };
    return;
  }

  const { stepName: lastStepName, keys: lastKeys } = context.lastTraceData;

  // 检查是否有 key 丢失
  const missingKeys = lastKeys.filter(key => !currentKeys.includes(key));

  if (missingKeys.length > 0) {
    context.logger.warn(
      `[TRACE-${context.traceId}] [DATA LOSS] ${lastStepName}->${stepName}: missing keys: [${missingKeys.join(', ')}]`
    );

    // 输出丢失 key 的详细信息
    if (context.level === 'full') {
      for (const missingKey of missingKeys) {
        const lostValue = context.lastTraceData!.data[missingKey];
        context.logger.debug(
          `[TRACE-${context.traceId}] [LOST DATA] Key "${missingKey}" was: ${truncateString(lostValue, 100)}`
        );
      }
    }
  }

  // 更新最后一次追踪数据
  context.lastTraceData = {
    stepName,
    data: currentData,
    keys: currentKeys,
  };
}

/**
 * 数据流追踪中间件
 *
 * 功能：
 * 1. 复用 requestId 作为 traceId
 * 2. 记录请求/响应数据快照
 * 3. 提供数据 diff 检测功能
 * 4. 性能计时
 * 5. 可配置的日志级别控制
 *
 * 使用示例：
 * ```typescript
 * // 在 route handler 中使用
 * req.traceData('agent-message', agentMessage);
 * ```
 */
export function dataFlowTracer(req: Request, res: Response, next: NextFunction): void {
  // 获取追踪级别
  const level = getTraceLevel();

  // 如果是 off 模式，直接跳过所有追踪逻辑
  if (level === 'off') {
    next();
    return;
  }

  // 复用 requestLogger 生成的 requestId
  const traceId = req.requestId || 'unknown';

  // 创建带 traceId 的 child logger
  const logger = createChildLogger(`tracer:${traceId}`);

  // 初始化追踪上下文
  const context: TraceContext = {
    traceId,
    startTime: Date.now(),
    logger,
    lastTraceData: null,
    level,
  };

  // 将上下文挂载到 req 对象上
  req._traceContext = context;

  // 注入自定义 header
  res.setHeader('x-trace-id', traceId);

  // ==================== 请求数据快照 ====================
  if (level === 'full') {
    // 记录请求方法、路径
    logger.info(
      `[TRACE-${traceId}] [REQUEST] ${req.method} ${req.originalUrl || req.path}`
    );

    // 记录 query 参数
    if (req.query && Object.keys(req.query).length > 0) {
      logger.debug(
        `[TRACE-${traceId}] [QUERY] ${JSON.stringify(truncateObject(req.query as Record<string, unknown>, TRUNCATE_CONFIG.requestBodyFieldMaxLength))}`
      );
    }

    // 记录 params 参数
    if (req.params && Object.keys(req.params).length > 0) {
      logger.debug(
        `[TRACE-${traceId}] [PARAMS] ${JSON.stringify(req.params)}`
      );
    }

    // 记录 body（截断长字段值）
    if (req.body && Object.keys(req.body).length > 0) {
      const truncatedBody = truncateObject(
        req.body as Record<string, unknown>,
        TRUNCATE_CONFIG.requestBodyFieldMaxLength
      );
      logger.debug(
        `[TRACE-${traceId}] [BODY] ${JSON.stringify(truncatedBody)}`
      );
    }
  } else if (level === 'basic') {
    // basic 模式只记录基本信息
    logger.info(
      `[TRACE-${traceId}] [REQUEST] ${req.method} ${req.originalUrl || req.path}`
    );
  }

  // ==================== 响应拦截 ====================
  // 保存原始的 res.json 方法
  const originalJson = res.json.bind(res);

  // 包装 res.json 方法
  res.json = function(body: unknown): Response {
    // 记录响应数据
    const statusCode = res.statusCode;

    if (level === 'full') {
        // 截断响应体预览
        const bodyPreview = truncateString(
          body,
          TRUNCATE_CONFIG.responseBodyPreviewLength
        );
        logger.info(
          `[TRACE-${traceId}] [RESPONSE] ${statusCode} ${bodyPreview}`
        );
      } else if (level === 'basic') {
        // basic 模式只记录状态码和简短预览
        const bodyPreview = truncateString(body, 50);
        logger.info(
          `[TRACE-${traceId}] [RESPONSE] ${statusCode} ${bodyPreview}`
        );
      }

    // 调用原始方法发送响应
    return originalJson(body);
  };

  // ==================== 性能计时 ====================
  // 监听 finish 事件（响应完成后触发）
  res.on('finish', () => {
    const duration = Date.now() - context.startTime;

    if (level === 'full' || level === 'basic') {
      logger.info(
        `[TRACE-${traceId}] [DURATION] ${duration}ms`
      );
    }
  });

  // ==================== 挂载 traceData 方法 ====================
  /**
   * 在 route handler 中调用的数据追踪函数
   *
   * @param stepName - 当前处理步骤名称（如 'agent-message', 'llm-response'）
   * @param data - 当前步骤的数据对象
   *
   * @example
   * ```typescript
   * req.traceData('agent-message', agentMessage);
   * req.traceData('llm-response', llmResponse);  // 自动与上一次对比，检测数据丢失
   * ```
   */
  req.traceData = function(stepName: string, data: Record<string, unknown>): void {
    if (!req._traceContext) {
      return;
    }

    const currentKeys = Object.keys(data);

    if (level === 'full') {
      // 截断后记录完整数据
      const truncatedData = truncateObject(data, TRUNCATE_CONFIG.requestBodyFieldMaxLength);
      req._traceContext.logger.debug(
        `[TRACE-${traceId}] [DATA] ${stepName}: ${JSON.stringify(truncatedData)}`
      );
    }

    // 检测数据差异（核心功能）
    detectDataLoss(req._traceContext, stepName, data, currentKeys);
  };

  // 继续下一个中间件
  next();
}

/**
 * 导出辅助函数供测试使用
 */
export {
  getTraceLevel,
  truncateString,
  truncateObject,
  detectDataLoss,
};

export type {
  TraceContext,
  TraceLevel,
};
