/**
 * ai 包日志工具——委托给 shared 包的 getChildLogger
 *
 * 设计决策：
 * - ai 包已依赖 @ai-rpg/shared，复用 shared 的 logger 抽象层
 * - backend 启动时通过 registerChildLoggerFactory 注册 winston 工厂
 *   （packages/backend/src/utils/logger.ts:286），此后 ai 包内所有
 *   createChildLogger 调用自动接入 winston transport，写入
 *   ai-*.log + session.log + error.log
 * - ai 包独立运行时（如 pnpm test），shared 返回 NullLogger（静默丢弃），
 *   这是可接受的——ai 包定位是被 backend 调用的库
 *
 * 时序保证（已验证）：
 * backend/src/index.ts line 5 加载 ./utils/logger.ts（注册 winston 工厂）
 * → line 22 加载 @ai-rpg/ai（触发 ai 包模块加载）
 * → ai 包模块级 const logger = createChildLogger(tag) 调用 getChildLogger
 * → winston 工厂已注册，返回真实 winston logger 实例
 */

import { getChildLogger, type ILogger } from '@ai-rpg/shared/utils/logger';

export type Logger = ILogger;

export function createChildLogger(tag: string): Logger {
  return getChildLogger(tag);
}
