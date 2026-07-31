/**
 * 日志记录器抽象层（P3-S0 新增）
 *
 * shared/ 层定义 ILogger 接口与 getChildLogger 工厂，
 * backend 启动时通过 registerChildLoggerFactory 注册 winston 实现。
 *
 * 设计理由：logger.ts 重度依赖 backend 内部服务（winston/winston-daily-rotate-file/path/fs/config），
 * 无法直接迁移到 shared/。通过接口抽象让迁移到 shared/ 的模块（BaseTool/toolResultCache/StagingKnex）
 * 能够使用日志而不引入 shared→backend 跨层依赖。
 */

/** 日志级别 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

/** 日志记录器接口（shared/ 层定义，backend 层实现） */
export interface ILogger {
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  verbose(message: string, data?: Record<string, unknown>): void;
  child(source: string): ILogger;
}

/** 子 logger 工厂函数类型 */
export type ChildLoggerFactory = (source: string) => ILogger;

/**
 * 默认占位实现（避免 shared/ 在未注册时崩溃）
 *
 * backend 启动前或未注册工厂时，所有日志调用被静默丢弃。
 * 这是防御而非脆弱：shared/ 不应崩溃于日志缺失，但 backend 启动时必须注册真实实现。
 */
class NullLogger implements ILogger {
  error(_message: string, _data?: Record<string, unknown>): void {}
  warn(_message: string, _data?: Record<string, unknown>): void {}
  info(_message: string, _data?: Record<string, unknown>): void {}
  debug(_message: string, _data?: Record<string, unknown>): void {}
  verbose(_message: string, _data?: Record<string, unknown>): void {}
  child(_source: string): ILogger {
    return this;
  }
}

let registeredFactory: ChildLoggerFactory = () => new NullLogger();

/**
 * 注册子 logger 工厂（backend 启动时调用）
 *
 * backend 启动时将 winston 的 createChildLogger 包装为 ChildLoggerFactory 并注册，
 * 此后 shared/ 中的 getChildLogger 调用将返回真实的 winston logger 实例。
 */
export function registerChildLoggerFactory(factory: ChildLoggerFactory): void {
  registeredFactory = factory;
}

/**
 * 获取子 logger（shared/tool-core 等模块使用）
 *
 * 在 backend 注册工厂前返回 NullLogger（静默丢弃日志）；
 * 注册后返回真实的 winston logger 实例。
 */
export function getChildLogger(source: string): ILogger {
  return registeredFactory(source);
}
