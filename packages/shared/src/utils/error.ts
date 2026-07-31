/**
 * 错误处理共享工具（P3-S0 从 backend/src/utils/error.ts 迁移）
 *
 * 提取全项目 ~423 处 `error instanceof Error ? error.message : 'Unknown error'` 重复模式。
 * 纯函数，零依赖。
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
