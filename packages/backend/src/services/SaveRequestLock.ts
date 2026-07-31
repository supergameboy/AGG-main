/**
 * Save 请求级锁（修复 B5 TOCTOU 竞态）。
 *
 * 期望效果：
 * - 同一 saveId 的请求串行执行，防止 queryState → executeTurn 之间的 TOCTOU 竞态
 * - 不同 saveId 的请求并行执行，不影响性能
 * - 锁的生命周期：请求开始时获取，请求完成（成功或失败）时释放
 * - 锁的错误处理：请求失败时自动释放锁，不影响后续请求
 *
 * 实现：
 * - 用 Map<saveId, Promise> 维护每个 saveId 的请求链
 * - 新请求等待前一个请求完成后再执行
 * - 基于 Promise chain（与 DatabaseWriteQueue 相同的 mutex pattern）
 *
 * 使用方式：
 * ```typescript
 * const result = await saveRequestLock.withLock(saveId, async () => {
 *   return await handleProgramAction(deps, params, startTime);
 * });
 * ```
 */

import type { ID } from '../../../shared/src/types/core.js';

export class SaveRequestLock {
  private readonly chains = new Map<ID, Promise<unknown>>();

  /**
   * 在 saveId 级别锁内执行函数。
   * 同一 saveId 的请求会串行执行，不同 saveId 的请求并行执行。
   *
   * @param saveId 存档 ID
   * @param fn 要执行的异步函数
   * @returns 函数的返回值
   */
  async withLock<T>(saveId: ID, fn: () => Promise<T>): Promise<T> {
    // 获取当前 saveId 的请求链尾部（如果存在）
    const previous = this.chains.get(saveId) ?? Promise.resolve();

    // 创建新的请求 Promise，等前一个完成后再执行 fn
    const current = previous.then(fn, fn); // 无论前一个成功或失败，都执行当前

    // 注册清理函数：当前请求完成后从 Map 中移除（如果 Map 中还是当前 Promise）
    this.chains.set(saveId, current);

    try {
      return await current;
    } finally {
      // 如果 Map 中的 Promise 还是当前 current，移除它（避免内存泄漏）
      // 如果中间有新请求加入，保留新请求
      if (this.chains.get(saveId) === current) {
        this.chains.delete(saveId);
      }
    }
  }

  /**
   * 获取当前正在排队的请求数量（用于监控/日志）。
   */
  get pendingCount(): number {
    return this.chains.size;
  }
}

/**
 * 进程级单例（纯内存协调原语，无外部依赖，与 logger 模式一致）。
 *
 * 同一进程内所有 handleProgramAction 调用共享此实例，确保同一 saveId 的请求串行执行。
 * 测试场景可直接 new SaveRequestLock() 创建独立实例避免交叉污染。
 */
export const saveRequestLock = new SaveRequestLock();
