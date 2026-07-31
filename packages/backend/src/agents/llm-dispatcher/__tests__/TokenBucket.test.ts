import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TokenBucket, type TokenBucketConfig } from '../TokenBucket.js';

/**
 * TokenBucket 单元测试
 *
 * 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §2.3
 *
 * 时间控制策略：vi.useFakeTimers() 同时 mock Date.now 与 setTimeout，
 * 使 refill（懒补充）、等待超时、冷静期/failed 恢复的断言完全确定。
 */

const DEFAULT_CONFIG: TokenBucketConfig = {
  capacity: 5,
  refillRatePerSec: 1,
  maxConcurrent: 3,
};

const COOLDOWN_DEFAULT_MS = 5 * 60 * 1000;
const FAILED_RESTORE_MS = 5 * 60 * 1000;

function makeBucket(
  config: Partial<TokenBucketConfig> = {},
  cooldownMs: number = COOLDOWN_DEFAULT_MS,
  restoreMs: number = FAILED_RESTORE_MS,
): TokenBucket {
  return new TokenBucket({ ...DEFAULT_CONFIG, ...config }, cooldownMs, restoreMs);
}

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('acquire', () => {
    it('初始状态可立即获取令牌', async () => {
      const bucket = makeBucket();

      const acquired = await bucket.acquire(1000);

      expect(acquired).toBe(true);
      const snapshot = bucket.getSnapshot();
      expect(snapshot.tokens).toBe(4);
      expect(snapshot.activeRequests).toBe(1);
      expect(snapshot.totalUsed).toBe(1);
    });

    it('令牌不足时进入等待队列，唤醒时按补充后的令牌重新评估', async () => {
      // capacity=1 且 refill 极快：第一个 acquire 耗尽令牌；
      // 第二个 acquire 在同一时刻（elapsed=0，无补充）进入等待队列；
      // release 唤醒时 refill 补充令牌，等待者获取成功。
      const bucket = makeBucket({ capacity: 1, refillRatePerSec: 1000, maxConcurrent: 3 });
      expect(await bucket.acquire(1000)).toBe(true);

      let resolved: boolean | null = null;
      const pending = bucket.acquire(1000).then((r) => {
        resolved = r;
      });

      // 仍在等待（令牌为 0 且未超时）
      await vi.advanceTimersByTimeAsync(10);
      expect(resolved).toBeNull();

      // release 触发 notifyNextWaiter → refill（10ms × 1000/s 补充，capped=1）→ 获取成功
      bucket.release();
      await pending;
      expect(resolved).toBe(true);
    });

    it('超时返回 false', async () => {
      // refillRate=0：令牌耗尽后永不补充，等待者只能等超时
      const bucket = makeBucket({ capacity: 1, refillRatePerSec: 0, maxConcurrent: 3 });
      expect(await bucket.acquire(1000)).toBe(true);

      let resolved: boolean | null = null;
      const pending = bucket.acquire(500).then((r) => {
        resolved = r;
      });

      await vi.advanceTimersByTimeAsync(499);
      expect(resolved).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(resolved).toBe(false);
    });

    it('并发超限时进入等待队列', async () => {
      // 令牌充足但 maxConcurrent=1：第二个请求因并发槽满进入队列
      const bucket = makeBucket({ capacity: 5, refillRatePerSec: 0, maxConcurrent: 1 });
      expect(await bucket.acquire(1000)).toBe(true);

      let resolved: boolean | null = null;
      const pending = bucket.acquire(1000).then((r) => {
        resolved = r;
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(resolved).toBeNull();

      bucket.release();
      await pending;
      expect(resolved).toBe(true);
      // 唤醒的等待者占用了并发槽
      expect(bucket.getSnapshot().activeRequests).toBe(1);
    });
  });

  describe('release', () => {
    it('release 后唤醒队首等待者', async () => {
      const bucket = makeBucket({ capacity: 5, refillRatePerSec: 0, maxConcurrent: 1 });
      await bucket.acquire(1000);

      const order: string[] = [];
      const waiter1 = bucket.acquire(1000).then((r) => {
        order.push(`waiter1:${r}`);
      });
      const waiter2 = bucket.acquire(1000).then((r) => {
        order.push(`waiter2:${r}`);
      });

      bucket.release();
      await waiter1;
      expect(order).toEqual(['waiter1:true']);

      bucket.release();
      await waiter2;
      expect(order).toEqual(['waiter1:true', 'waiter2:true']);
    });

    it('release 不会使 activeRequests 变负', () => {
      const bucket = makeBucket();

      bucket.release();
      bucket.release();

      expect(bucket.getSnapshot().activeRequests).toBe(0);
    });
  });

  describe('markCooldown', () => {
    it('429 后 isInCooldown 返回 true', () => {
      const bucket = makeBucket();

      bucket.markCooldown(1000);

      expect(bucket.isInCooldown()).toBe(true);
      expect(bucket.getSnapshot().consecutive429).toBe(1);
      expect(bucket.getSnapshot().total429).toBe(1);
    });

    it('Retry-After 头设置的冷静期正确', () => {
      const bucket = makeBucket();
      const before = Date.now();

      bucket.markCooldown(1500);

      expect(bucket.getSnapshot().cooldownUntil).toBe(before + 1500);
    });

    it('无 Retry-After 时使用默认 5 分钟', () => {
      const bucket = makeBucket();
      const before = Date.now();

      bucket.markCooldown(0);

      expect(bucket.getSnapshot().cooldownUntil).toBe(before + COOLDOWN_DEFAULT_MS);
    });

    it('冷静期触发时拒绝所有等待者', async () => {
      const bucket = makeBucket({ capacity: 5, refillRatePerSec: 0, maxConcurrent: 1 });
      await bucket.acquire(1000);

      const results: boolean[] = [];
      const waiter1 = bucket.acquire(5000).then((r) => results.push(r));
      const waiter2 = bucket.acquire(5000).then((r) => results.push(r));
      await vi.advanceTimersByTimeAsync(0);

      bucket.markCooldown(1000);
      await Promise.all([waiter1, waiter2]);

      expect(results).toEqual([false, false]);
    });
  });

  describe('markFailed', () => {
    it('401 后 isInCooldown 返回 true', () => {
      const bucket = makeBucket();

      bucket.markFailed('401 Unauthorized');

      expect(bucket.isInCooldown()).toBe(true);
      expect(bucket.getSnapshot().failed).toBe(true);
      expect(bucket.getSnapshot().failedAt).not.toBeNull();
    });

    it('failed 状态下 acquire 立即返回 false', async () => {
      const bucket = makeBucket();
      bucket.markFailed('401 Unauthorized');

      const acquired = await bucket.acquire(1000);

      expect(acquired).toBe(false);
    });
  });

  describe('tryRestore', () => {
    it('冷静期结束后 tryRestore 返回 true', () => {
      const bucket = makeBucket();
      bucket.markCooldown(1000);

      vi.advanceTimersByTime(1001);
      const restored = bucket.tryRestore();

      expect(restored).toBe(true);
      expect(bucket.isInCooldown()).toBe(false);
      expect(bucket.getSnapshot().cooldownUntil).toBe(0);
    });

    it('冷静期结束后 consecutive429 重置为 0（M3 修复）', () => {
      const bucket = makeBucket();
      bucket.markCooldown(1000);
      bucket.markCooldown(1000);
      expect(bucket.getSnapshot().consecutive429).toBe(2);

      vi.advanceTimersByTime(1001);
      bucket.tryRestore();

      expect(bucket.getSnapshot().consecutive429).toBe(0);
    });

    it('failed 5 分钟后 tryRestore 返回 true', () => {
      const bucket = makeBucket();
      bucket.markFailed('401 Unauthorized');

      vi.advanceTimersByTime(FAILED_RESTORE_MS + 1);
      const restored = bucket.tryRestore();

      expect(restored).toBe(true);
      expect(bucket.getSnapshot().failed).toBe(false);
      expect(bucket.getSnapshot().failedAt).toBeNull();
    });

    it('未到时间 tryRestore 返回 false', () => {
      const bucket = makeBucket();
      bucket.markFailed('401 Unauthorized');

      vi.advanceTimersByTime(60 * 1000);
      const restored = bucket.tryRestore();

      expect(restored).toBe(false);
      expect(bucket.isInCooldown()).toBe(true);
    });

    it('B3 修复：failed 到期后 acquire 入口 tryRestore 立即可用（不必等 60s 定时器）', async () => {
      const bucket = makeBucket();
      bucket.markFailed('401 Unauthorized');

      vi.advanceTimersByTime(FAILED_RESTORE_MS + 1);
      const acquired = await bucket.acquire(1000);

      expect(acquired).toBe(true);
    });

    it('B3 修复：冷静期结束后 acquire 入口 tryRestore 立即可用', async () => {
      const bucket = makeBucket();
      bucket.markCooldown(1000);

      vi.advanceTimersByTime(1001);
      const acquired = await bucket.acquire(1000);

      expect(acquired).toBe(true);
    });

    it('S1 修复：队列为空时 tryRestore 调用 notifyNextWaiter 无副作用', () => {
      const bucket = makeBucket();
      bucket.markCooldown(1000);
      vi.advanceTimersByTime(1001);

      // 队列为空时调用不抛错、不改变状态
      expect(() => bucket.tryRestore()).not.toThrow();
      expect(bucket.isInCooldown()).toBe(false);
    });
  });

  describe('refill', () => {
    it('1 秒后补充 refillRatePerSec 个令牌', () => {
      const bucket = makeBucket({ capacity: 10, refillRatePerSec: 2, maxConcurrent: 5 });
      // 消耗 5 个令牌
      for (let i = 0; i < 5; i++) {
        bucket.acquire(0).catch(() => undefined);
      }
      // acquire 是 async，但立即路径同步完成；直接读快照
      expect(bucket.getSnapshot().tokens).toBe(5);

      vi.advanceTimersByTime(1000);

      expect(bucket.getAvailableTokens()).toBe(7);
    });

    it('补充不超过 capacity', () => {
      const bucket = makeBucket({ capacity: 5, refillRatePerSec: 10 });

      vi.advanceTimersByTime(60 * 1000);

      expect(bucket.getAvailableTokens()).toBe(5);
    });
  });

  describe('updateConfig', () => {
    it('capacity 减小时裁剪 tokens', () => {
      const bucket = makeBucket({ capacity: 10, refillRatePerSec: 0 });
      expect(bucket.getSnapshot().tokens).toBe(10);

      bucket.updateConfig({ capacity: 3, refillRatePerSec: 0, maxConcurrent: 3 });

      expect(bucket.getSnapshot().tokens).toBe(3);
      expect(bucket.getSnapshot().config.capacity).toBe(3);
    });

    it('保留 activeRequests 状态', async () => {
      const bucket = makeBucket({ capacity: 10, refillRatePerSec: 0, maxConcurrent: 5 });
      await bucket.acquire(1000);
      await bucket.acquire(1000);
      expect(bucket.getSnapshot().activeRequests).toBe(2);

      bucket.updateConfig({ capacity: 3, refillRatePerSec: 1, maxConcurrent: 1 });

      expect(bucket.getSnapshot().activeRequests).toBe(2);
      expect(bucket.getSnapshot().config.maxConcurrent).toBe(1);
    });
  });

  describe('resetCooldown', () => {
    it('清除冷静期 + failed 状态', () => {
      const bucket = makeBucket();
      bucket.markCooldown(60 * 1000);
      bucket.markFailed('401');
      expect(bucket.isInCooldown()).toBe(true);

      bucket.resetCooldown();

      expect(bucket.isInCooldown()).toBe(false);
      const snapshot = bucket.getSnapshot();
      expect(snapshot.cooldownUntil).toBe(0);
      expect(snapshot.failed).toBe(false);
      expect(snapshot.failedAt).toBeNull();
      expect(snapshot.consecutive429).toBe(0);
    });
  });

  describe('getSnapshot', () => {
    it('返回完整状态快照且 config 为拷贝', async () => {
      const bucket = makeBucket();
      await bucket.acquire(1000);

      const snapshot = bucket.getSnapshot();

      expect(snapshot.config).toEqual(DEFAULT_CONFIG);
      expect(snapshot.config).not.toBe(DEFAULT_CONFIG);
      expect(snapshot.tokens).toBe(4);
      expect(snapshot.activeRequests).toBe(1);
      expect(snapshot.totalUsed).toBe(1);
      expect(snapshot.failed).toBe(false);
      expect(snapshot.cooldownUntil).toBe(0);
    });
  });
});
