/**
 * 错误处理共享工具——从 backend/utils/error.ts 迁移
 *
 * 提取 unknown 类型错误中的可读消息。
 * ai 包独立实现，不依赖 backend/utils/error。
 */

/**
 * 从 unknown 类型的错误中提取可读消息。
 *
 * - Error 实例返回 `error.message`
 * - null/undefined 返回 'Unknown error'
 * - 其他类型返回 `String(error)`
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error == null) {
    return 'Unknown error';
  }
  return String(error);
}
