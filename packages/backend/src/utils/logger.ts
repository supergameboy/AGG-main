import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import { registerChildLoggerFactory, type ILogger } from '@ai-rpg/shared/utils/logger';

const logsDir = config.logs.dir;

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ─── 统一 JSON 日志格式 ───────────────────────────────────────────
// 所有日志文件统一输出纯 JSON，每行一条记录。
// 固定字段：timestamp, level, source, tag?, requestId?, iteration?, message, data?

/**
 * safeJsonStringify: 带循环引用 + Timer 对象保护的 JSON 序列化。
 *
 * 防御性最后一道防线：即使业务代码误传含循环引用或 Timer（setInterval/setTimeout
 * 返回的 Timeout 对象，内部 _idlePrev/_idleNext 形成环）的对象给 logger，日志记录
 * 也不会因 JSON.stringify 抛 TypeError 而失败。logger 是可观测性的底线，不应崩溃。
 *
 * 策略：
 * 1. WeakSet 检测循环引用，遇到环返回 '[Circular]'
 * 2. constructor.name 检测 Node.js 内部 Timer 对象（Timeout/TimersList），返回占位符
 * 3. 函数对象返回 '[Function]'
 * 4. symbol key 跳过
 */
function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'function') return '[Function]';
    if (typeof val === 'object' && val !== null) {
      // 检测 Node.js Timer 对象（Timeout/TimersList），避免遍历其循环链表
      const ctorName = val.constructor?.name;
      if (ctorName === 'Timeout' || ctorName === 'TimersList' || ctorName === 'TimeoutImpl') {
        return `[${ctorName}]`;
      }
      // 检测循环引用
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

const structuredLogFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, source, tag, requestId, iteration, ...rest } = info;
    const record: Record<string, unknown> = {
      timestamp,
      level,
      source: source || 'unknown',
      message: typeof message === 'string' ? message : String(message),
    };
    if (tag) record.tag = tag;
    if (requestId) record.requestId = requestId;
    if (iteration !== undefined && iteration !== null) record.iteration = iteration;

    // 将剩余字段归入 data（排除 winston 内部字段）
    const internalKeys = new Set(['timestamp', 'level', 'message', 'source', 'tag', 'requestId', 'iteration', 'stack', 'Symbol(level)']);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (!internalKeys.has(k) && typeof k === 'string' && !k.startsWith('Symbol')) {
        data[k] = v;
      }
    }
    if (Object.keys(data).length > 0) {
      record.data = data;
    }
    if (info.stack) {
      record.stack = info.stack;
    }
    return safeJsonStringify(record);
  })
);

// ─── 控制台格式（人类可读，保留截断） ─────────────────────────────

const CONSOLE_TRUNCATE_LIMIT = 200;
const TRUNCATABLE_KEYS = new Set(['messages', 'deltaMessages', 'tools', 'content', 'reasoningContent', 'toolCalls', 'resultData', 'args']);

function truncateForConsole(value: unknown, depth: number = 0): unknown {
  if (depth > 3) return '...';
  if (typeof value === 'string') {
    return value.length > CONSOLE_TRUNCATE_LIMIT
      ? value.slice(0, CONSOLE_TRUNCATE_LIMIT) + `... (${value.length} chars)`
      : value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    const truncated = value.slice(0, 2).map(item => truncateForConsole(item, depth + 1));
    if (value.length > 2) truncated.push(`... (${value.length} items)`);
    return truncated;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = TRUNCATABLE_KEYS.has(k)
        ? truncateForConsole(v, depth + 1)
        : v;
    }
    return result;
  }
  return value;
}

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf((info) => {
    const { timestamp, level, message, source, tag, requestId, iteration, ...rest } = info;
    const tagStr = tag ? `[${tag}]` : '';
    const iterStr = iteration ? ` iter=${iteration}` : '';
    const reqId = requestId ? String(requestId) : '';
    const reqStr = reqId ? ` ${reqId.slice(0, 8)}` : '';
    let msg = `${timestamp} [${level}] ${tagStr} ${message}${iterStr}${reqStr}`;

    // 截断大字段用于控制台显示
    const displayData = truncateForConsole(rest) as Record<string, unknown>;
    const internalKeys = new Set(['timestamp', 'level', 'message', 'source', 'tag', 'requestId', 'iteration', 'stack', 'Symbol(level)']);
    const filteredData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(displayData)) {
      if (!internalKeys.has(k) && typeof k === 'string' && !k.startsWith('Symbol')) {
        filteredData[k] = v;
      }
    }
    if (Object.keys(filteredData).length > 0) {
      msg += ' ' + JSON.stringify(filteredData);
    }
    return msg;
  })
);

// ─── 日志轮转传输 ────────────────────────────────────────────────

const createRotateTransport = (
  filename: string,
  level?: string,
  maxDays: number = 7,
): DailyRotateFile => {
  return new DailyRotateFile({
    filename: path.join(logsDir, filename.replace('.log', '-%DATE%.log')),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: `${maxDays}d`,
    level,
    format: structuredLogFormat,
    options: { encoding: 'utf-8' },
  });
};

// 会话日志文件（每次启动覆盖，保留完整当次会话日志）
const sessionLogFile = path.join(logsDir, 'session.log');

export const clearSessionLog = (): void => {
  try {
    fs.writeFileSync(sessionLogFile, '', 'utf-8');
  } catch {
    // 文件不存在或无法写入，忽略
  }
};

const sessionTransport = new winston.transports.File({
  filename: sessionLogFile,
  format: structuredLogFormat,
  maxsize: 50 * 1024 * 1024,
  options: { encoding: 'utf-8' },
});

// 系统日志传输（保留7天）
const systemTransport = createRotateTransport('system.log', undefined, 7);

// AI日志传输（保留30天）
const aiTransport = createRotateTransport('ai.log', undefined, 30);

// Agent日志传输（保留30天）
const agentTransport = createRotateTransport('agent.log', undefined, 30);

// 错误日志传输（保留30天）
const errorTransport = createRotateTransport('error.log', 'error', 30);

// 前端日志传输（保留7天）
const frontendTransport = createRotateTransport('frontend.log', undefined, 7);

// ─── 日志记录器实例 ──────────────────────────────────────────────

export const logger = winston.createLogger({
  level: config.logs.level,
  levels: winston.config.npm.levels,
  format: structuredLogFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    sessionTransport,
    systemTransport,
    errorTransport,
  ],
});

export const aiLogger = winston.createLogger({
  level: config.logs.level,
  levels: winston.config.npm.levels,
  format: structuredLogFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    sessionTransport,
    aiTransport,
    errorTransport,
  ],
});

export const agentLogger = winston.createLogger({
  level: 'debug',
  levels: winston.config.npm.levels,
  format: structuredLogFormat,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    agentTransport,
    sessionTransport,
    errorTransport,
  ],
});

export const frontendLogger = winston.createLogger({
  level: 'debug',
  levels: winston.config.npm.levels,
  format: structuredLogFormat,
  transports: [
    sessionTransport,
    frontendTransport,
  ],
});

// ─── Agent 路由的 source 列表 ────────────────────────────────────

const AI_SOURCES = new Set([
  'llm', 'ai', 'llm-new', 'OpenAICompatible',
  'llm-service', 'embedding-provider', 'model-config',
]);
const AGENT_SOURCES = new Set([
  'agent', 'dag-scheduler', 'context-injector', 'gamemaster', 'base-agent',
  'react-engine', 'react-agent', 'react-loop', 'agent-runtime',
]);

export const createChildLogger = (source: string) => {
  if (AI_SOURCES.has(source)) {
    return aiLogger.child({ source });
  }
  if (AGENT_SOURCES.has(source)) {
    return agentLogger.child({ source });
  }
  return logger.child({ source });
};

// ─── shared/ ILogger 适配层（P3-S0 新增） ──────────────────────────
//
// 将 winston.Logger 适配为 shared/ 的 ILogger 接口，
// 供迁移到 shared/ 的模块（BaseTool/toolResultCache/StagingKnex）使用。
// 模块加载时自动注册，确保 shared/ 的 getChildLogger 调用返回真实的 winston 实例。

class WinstonLoggerAdapter implements ILogger {
  constructor(private readonly winstonLogger: winston.Logger) {}

  error(message: string, data?: Record<string, unknown>): void {
    this.winstonLogger.error(message, data ?? {});
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.winstonLogger.warn(message, data ?? {});
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.winstonLogger.info(message, data ?? {});
  }
  debug(message: string, data?: Record<string, unknown>): void {
    this.winstonLogger.debug(message, data ?? {});
  }
  verbose(message: string, data?: Record<string, unknown>): void {
    this.winstonLogger.verbose(message, data ?? {});
  }
  child(source: string): ILogger {
    return new WinstonLoggerAdapter(createChildLogger(source));
  }
}

registerChildLoggerFactory((source: string): ILogger => new WinstonLoggerAdapter(createChildLogger(source)));
