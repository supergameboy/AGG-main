import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';
import { 
  AppError, 
  ValidationError, 
  ErrorCode
} from '../errors/index.js';

/**
 * 全局错误处理中间件
 * 
 * 处理所有类型的错误并返回统一格式的响应
 */
export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 记录错误日志
  logger.error('Error occurred:', {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error instanceof AppError && {
      errorCode: error.errorCode,
      statusCode: error.statusCode,
      details: error.details,
    }),
  });

  // 处理 Zod 验证错误
  if (error instanceof ZodError) {
    const validationError = ValidationError.fromZodError(error);
    res.status(400).json(errorResponse(
      validationError.errorCode,
      validationError.message,
      validationError.details
    ));
    return;
  }

  // 处理请求体过大错误
  if ((error as any).type === 'entity.too.large' || error.message?.includes('PayloadTooLargeError') || (error as any).status === 413) {
    res.status(413).json(errorResponse(
      ErrorCode.PAYLOAD_TOO_LARGE,
      '请求体过大，请减少数据量后重试',
      process.env.NODE_ENV === 'development' ? { limit: (error as any).limit, length: (error as any).length } : undefined
    ));
    return;
  }

  // 处理 AppError 及其子类
  if (error instanceof AppError) {
    res.status(error.statusCode).json(errorResponse(
      error.errorCode,
      error.message,
      error.details
    ));
    return;
  }

  // 处理其他已知错误类型
  if (error.name === 'UnauthorizedError') {
    res.status(401).json(errorResponse(
      ErrorCode.UNAUTHORIZED,
      error.message || '未授权访问'
    ));
    return;
  }

  if (error.name === 'JsonWebTokenError') {
    res.status(401).json(errorResponse(
      ErrorCode.UNAUTHORIZED,
      'Token 无效'
    ));
    return;
  }

  if (error.name === 'TokenExpiredError') {
    res.status(401).json(errorResponse(
      ErrorCode.UNAUTHORIZED,
      'Token 已过期'
    ));
    return;
  }

  // 处理数据库错误
  if (error.name === 'SqliteError' || error.message.includes('SQLITE_')) {
    res.status(500).json(errorResponse(
      ErrorCode.DATABASE_ERROR,
      '数据库操作失败',
      process.env.NODE_ENV === 'development' ? { originalError: error.message } : undefined
    ));
    return;
  }

  // 处理网络/请求错误
  if (error.name === 'FetchError' || error.message.includes('fetch')) {
    res.status(503).json(errorResponse(
      ErrorCode.SERVICE_UNAVAILABLE,
      '外部服务不可用'
    ));
    return;
  }

  // 处理超时错误
  if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
    res.status(408).json(errorResponse(
      ErrorCode.REQUEST_TIMEOUT,
      '请求超时'
    ));
    return;
  }

  // 默认处理：内部服务器错误
  res.status(500).json(errorResponse(
    ErrorCode.INTERNAL_ERROR,
    process.env.NODE_ENV === 'production' 
      ? '服务器内部错误' 
      : error.message,
    process.env.NODE_ENV === 'development' 
      ? { stack: error.stack, name: error.name }
      : undefined
  ));
}

/**
 * 404 Not Found 中间件
 * 用于捕获未匹配的路由
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  res.status(404).json(errorResponse(
    ErrorCode.NOT_FOUND,
    `路由未找到: ${req.method} ${req.path}`,
    { method: req.method, path: req.path }
  ));
}

/**
 * 异步路由包装器
 * 自动捕获异步错误并传递给错误处理中间件
 * 
 * @example
 * ```typescript
 * router.get('/users/:id', asyncHandler(async (req, res) => {
 *   const user = await getUser(req.params.id);
 *   res.json(successResponse(user));
 * }));
 * ```
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// 重新导出错误类型，方便使用
export { 
  AppError, 
  ValidationError, 
  NotFoundError, 
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
  LLMError,
  DatabaseError,
  ErrorCode 
} from '../errors/index.js';
