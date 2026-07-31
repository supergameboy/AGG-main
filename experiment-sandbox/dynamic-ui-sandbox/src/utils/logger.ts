/**
 * 日志工具副本（最小子集）—— 对应 packages/frontend/src/utils/logger 的签名约定。
 * ErrorBoundary 依赖 logger.error(module, message, meta, stack)。
 */

type LogMeta = Record<string, unknown> | undefined;

function formatPrefix(module: string): string {
  return `[${module}]`;
}

export const logger = {
  debug(module: string, message: string, meta?: LogMeta): void {
    console.debug(formatPrefix(module), message, meta ?? '');
  },
  info(module: string, message: string, meta?: LogMeta): void {
    console.info(formatPrefix(module), message, meta ?? '');
  },
  warn(module: string, message: string, meta?: LogMeta): void {
    console.warn(formatPrefix(module), message, meta ?? '');
  },
  error(module: string, message: string, meta?: LogMeta, stack?: string): void {
    console.error(formatPrefix(module), message, meta ?? '', stack ?? '');
  },
};
