import { ErrorCode, ErrorCodeToHttpStatus, ErrorCodeDefaultMessage } from './errorCodes.js';

/**
 * 错误详情类型
 */
export interface ErrorDetails {
  [key: string]: unknown;
}

/**
 * 应用错误基类
 * 
 * 所有自定义错误类型都应继承此类
 * 
 * @example
 * ```typescript
 * throw new AppError(ErrorCode.NOT_FOUND, '用户不存在', { userId: '123' });
 * ```
 */
export class AppError extends Error {
  /** 错误码 */
  public readonly errorCode: ErrorCode;
  
  /** HTTP 状态码 */
  public readonly statusCode: number;
  
  /** 错误详情 */
  public readonly details?: ErrorDetails;
  
  /** 是否为操作错误（可预期的错误） */
  public readonly isOperational: boolean;
  
  /** 错误发生时间 */
  public readonly timestamp: number;

  constructor(
    errorCode: ErrorCode,
    message?: string,
    details?: ErrorDetails,
    isOperational: boolean = true
  ) {
    super(message || ErrorCodeDefaultMessage[errorCode]);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.statusCode = ErrorCodeToHttpStatus[errorCode];
    this.details = details;
    this.isOperational = isOperational;
    this.timestamp = Date.now();

    // 确保原型链正确
    Object.setPrototypeOf(this, new.target.prototype);
    
    // 捕获堆栈跟踪
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * 转换为 JSON 格式
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      errorCode: this.errorCode,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /**
   * 转换为 API 响应格式
   */
  toApiResponse(): { code: string; message: string; details?: ErrorDetails } {
    const response: { code: string; message: string; details?: ErrorDetails } = {
      code: this.errorCode,
      message: this.message,
    };
    
    if (this.details) {
      response.details = this.details;
    }
    
    return response;
  }

  /**
   * 从普通错误创建 AppError
   */
  static fromError(error: Error, errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR): AppError {
    if (error instanceof AppError) {
      return error;
    }
    return new AppError(errorCode, error.message, { originalError: error.name });
  }
}
