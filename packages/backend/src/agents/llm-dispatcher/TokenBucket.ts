import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('token-bucket');

/**
 * 令牌桶配置（per-key 维度）
 */
export interface TokenBucketConfig {
  /** 桶容量（最大突发请求数） */
  capacity: number;
  /** 每秒补充令牌数 */
  refillRatePerSec: number;
  /** 最大并发数（独立于令牌桶的信号量） */
  maxConcurrent: number;
}

/**
 * 令牌桶快照（用于指标暴露）
 */
export interface TokenBucketSnapshot {
  config: TokenBucketConfig;
  tokens: number;
  lastRefillTime: number;
  activeRequests: number;
  cooldownUntil: number;
  failed: boolean;
  failedAt: number | null;
  consecutive429: number;
  totalUsed: number;
  total429: number;
}

/**
 * 等待队列项（Promise 队列唤醒机制）
 */
interface WaitQueueItem {
  resolve: (acquired: boolean) => void;
  timer: ReturnType<typeof setTimeout> | null;
  enqueuedAt: number;
}

/**
 * per-key 令牌桶
 *
 * 算法：
 * 1. 懒补充：acquire 时根据时间差补充令牌（无需定时器）
 * 2. Promise 队列唤醒：并发超限/令牌不足时进入 FIFO 队列，release 时唤醒队首
 * 3. 动态冷静期：429 时根据 Retry-After 设置冷静期
 * 4. failed 自动恢复：5 分钟后自动恢复
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillTime: number;
  private activeRequests: number = 0;
  private cooldownUntil: number = 0;
  private failed: boolean = false;
  private failedAt: number | null = null;
  private consecutive429: number = 0;
  private totalUsed: number = 0;
  private total429: number = 0;

  /** 等待队列（FIFO） */
  private waitQueue: WaitQueueItem[] = [];

  constructor(
    private config: TokenBucketConfig,
    private readonly cooldownDefaultMs: number = 5 * 60 * 1000,
    private readonly failedRestoreMs: number = 5 * 60 * 1000,
  ) {
    this.tokens = config.capacity;
    this.lastRefillTime = Date.now();
  }

  /**
   * 获取令牌（带超时）
   *
   * B3 修复：入口先调用 tryRestore()，确保 failed/cooldown 到期后立即可用，
   * 不必等待 KeyHealthTracker 的 60 秒周期定时器。
   *
   * @returns true=获取成功，false=超时或 key 不可用
   */
  async acquire(timeoutMs: number): Promise<boolean> {
    // 1. 尝试恢复（清理已到期的 failed/cooldown 状态）
    this.tryRestore();

    // 2. 检查冷静期
    if (this.isInCooldown()) {
      return false;
    }

    // 3. 懒补充令牌
    this.refill();

    // 4. 检查是否立即可获取
    if (this.canAcquireImmediately()) {
      this.consumeToken();
      return true;
    }

    // 5. 进入等待队列
    return this.enqueueAndWait(timeoutMs);
  }

  /**
   * 释放令牌（请求完成时调用）
   */
  release(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.notifyNextWaiter();
  }

  /**
   * 标记冷静期（429 触发）
   *
   * @param retryAfterMs 从 Retry-After 头解析的毫秒数，0 表示使用默认值
   */
  markCooldown(retryAfterMs: number): void {
    const cooldownMs = retryAfterMs > 0 ? retryAfterMs : this.cooldownDefaultMs;
    this.cooldownUntil = Date.now() + cooldownMs;
    this.consecutive429 += 1;
    this.total429 += 1;
    // 冷静期触发时，唤醒所有等待者（让它们重新选 key 或失败）
    this.rejectAllWaiters(false);
    logger.warn('TokenBucket cooldown triggered', {
      cooldownMs,
      consecutive429: this.consecutive429,
      cooldownUntil: new Date(this.cooldownUntil).toISOString(),
    });
  }

  /**
   * 标记 failed（401/403 触发）
   */
  markFailed(error: string): void {
    this.failed = true;
    this.failedAt = Date.now();
    this.rejectAllWaiters(false);
    logger.error('TokenBucket marked failed', { error, failedAt: new Date(this.failedAt).toISOString() });
  }

  /**
   * 尝试恢复（定时器或 acquire 前调用）
   *
   * S1 修复：恢复成功后调用 notifyNextWaiter()，确保 failed/cooldown 到期时
   * 等待队列中的请求被立即唤醒重试，避免等待者只能等超时或下一次 release 才被唤醒。
   */
  tryRestore(): boolean {
    const now = Date.now();

    // failed 恢复
    if (this.failed && this.failedAt && now - this.failedAt > this.failedRestoreMs) {
      this.failed = false;
      this.failedAt = null;
      this.consecutive429 = 0;
      logger.info('TokenBucket restored from failed state');
      // S1 修复：failed 恢复后唤醒队首等待者，让其重新尝试获取令牌
      this.notifyNextWaiter();
      return true;
    }

    // 冷静期结束
    if (this.cooldownUntil > 0 && now > this.cooldownUntil) {
      this.cooldownUntil = 0;
      // M3 修复：冷静期结束时也重置 consecutive429，避免计数器长期累积
      // 导致后续阶梯冷静期决策失真。
      this.consecutive429 = 0;
      logger.info('TokenBucket cooldown ended, consecutive429 reset');
      // S1 修复：冷静期结束后唤醒队首等待者，让其重新尝试获取令牌
      this.notifyNextWaiter();
      return true;
    }

    return false;
  }

  /**
   * 手动重置冷静期（调试用）
   */
  resetCooldown(): void {
    this.cooldownUntil = 0;
    this.failed = false;
    this.failedAt = null;
    this.consecutive429 = 0;
    this.rejectAllWaiters(false);
  }

  /**
   * 更新配置（配置变更时调用）
   * 保留状态（tokens/activeRequests），仅更新 config
   *
   * M1 修复：移除 as cast，改 Object.assign 增量更新
   */
  updateConfig(newConfig: TokenBucketConfig): void {
    // 若 capacity 减小，需裁剪 tokens
    if (newConfig.capacity < this.config.capacity) {
      this.tokens = Math.min(this.tokens, newConfig.capacity);
    }
    Object.assign(this.config, newConfig);
  }

  /**
   * 是否在冷静期
   */
  isInCooldown(): boolean {
    return this.cooldownUntil > Date.now() || this.failed;
  }

  /**
   * 获取可用令牌数（懒补充后）
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * 获取快照（指标暴露）
   */
  getSnapshot(): TokenBucketSnapshot {
    return {
      config: { ...this.config },
      tokens: this.tokens,
      lastRefillTime: this.lastRefillTime,
      activeRequests: this.activeRequests,
      cooldownUntil: this.cooldownUntil,
      failed: this.failed,
      failedAt: this.failedAt,
      consecutive429: this.consecutive429,
      totalUsed: this.totalUsed,
      total429: this.total429,
    };
  }

  // ============== 私有方法 ==============

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillTime) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(
      this.config.capacity,
      this.tokens + elapsedSec * this.config.refillRatePerSec,
    );
    this.lastRefillTime = now;
  }

  private canAcquireImmediately(): boolean {
    return this.tokens >= 1 && this.activeRequests < this.config.maxConcurrent;
  }

  private consumeToken(): void {
    this.tokens -= 1;
    this.activeRequests += 1;
    this.totalUsed += 1;
  }

  private async enqueueAndWait(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const item: WaitQueueItem = {
        resolve,
        timer: null,
        enqueuedAt: Date.now(),
      };

      // 超时定时器
      item.timer = setTimeout(() => {
        const idx = this.waitQueue.indexOf(item);
        if (idx >= 0) {
          this.waitQueue.splice(idx, 1);
        }
        resolve(false);
      }, timeoutMs);

      this.waitQueue.push(item);
    });
  }

  /**
   * 唤醒队首等待者
   * 在 release() 和 tryRestore() 后调用
   */
  private notifyNextWaiter(): void {
    while (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      if (next.timer) {
        clearTimeout(next.timer);
      }

      // 重新检查是否可获取
      this.refill();
      if (this.isInCooldown()) {
        next.resolve(false);
        continue;
      }
      if (this.canAcquireImmediately()) {
        this.consumeToken();
        next.resolve(true);
        return;
      }
      // 仍不可获取，放回队首
      this.waitQueue.unshift(next);
      return;
    }
  }

  /**
   * 拒绝所有等待者（冷静期/failed 触发时）
   */
  private rejectAllWaiters(result: boolean): void {
    while (this.waitQueue.length > 0) {
      const item = this.waitQueue.shift()!;
      if (item.timer) {
        clearTimeout(item.timer);
      }
      item.resolve(result);
    }
  }
}
