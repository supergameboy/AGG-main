import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyHealthTracker } from '../KeyHealthTracker.js';
import type { TokenBucketConfig } from '../TokenBucket.js';

/**
 * KeyHealthTracker 单元测试
 *
 * 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §3
 *
 * 注意：KeyHealthTracker 构造函数启动 60s restore 定时器，
 * 每个测试结束必须 destroy() 清理（afterEach 统一处理）。
 */

interface KeyDef {
  key: string;
  label: string;
  rateLimit?: TokenBucketConfig;
}

function makeKeys(count: number, rateLimit?: TokenBucketConfig): KeyDef[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `sk-key${i}`,
    label: `Key${i}`,
    rateLimit,
  }));
}

const COOLDOWN_MS = 5 * 60 * 1000;
const RESTORE_MS = 5 * 60 * 1000;

describe('KeyHealthTracker', () => {
  let tracker: KeyHealthTracker;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    tracker?.destroy();
    vi.useRealTimers();
  });

  function createTracker(cooldownMs = COOLDOWN_MS, restoreMs = RESTORE_MS): KeyHealthTracker {
    tracker = new KeyHealthTracker(cooldownMs, restoreMs);
    return tracker;
  }

  describe('initializeKeys', () => {
    it('创建正确数量的 bucket 与 label', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(3));

      const snapshots = t.getAllSnapshots();

      expect(snapshots).toHaveLength(3);
      expect(snapshots.map((s) => s.keyIndex)).toEqual([0, 1, 2]);
      expect(snapshots.map((s) => s.label)).toEqual(['Key0', 'Key1', 'Key2']);
    });

    it('空 label 使用默认 Key{idx}', () => {
      const t = createTracker();
      t.initializeKeys([{ key: 'sk-a', label: '' }]);

      expect(t.getAllSnapshots()[0].label).toBe('Key0');
    });

    it('未配置 rateLimit 时使用默认令牌桶配置', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(1));

      const snapshot = t.getAllSnapshots()[0];
      // DEFAULT_TOKEN_BUCKET_CONFIG: capacity=5
      expect(snapshot.availableTokens).toBe(5);
    });

    it('重新初始化保留旧 bucket 状态（tokens/activeRequests）', async () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 }));
      const bucket0 = t.getBucket(0)!;
      await bucket0.acquire(1000);
      await bucket0.acquire(1000);
      expect(bucket0.getSnapshot().tokens).toBe(3);
      expect(bucket0.getSnapshot().activeRequests).toBe(2);

      // 同 key 数量重新初始化：旧 bucket 保留
      t.initializeKeys(makeKeys(2, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 }));

      const after = t.getBucket(0)!;
      expect(after).toBe(bucket0);
      expect(after.getSnapshot().tokens).toBe(3);
      expect(after.getSnapshot().activeRequests).toBe(2);
    });

    it('新增 key 时创建新 TokenBucket 且不影响已有 bucket', async () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(1, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 }));
      await t.getBucket(0)!.acquire(1000);

      t.initializeKeys(makeKeys(2, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 }));

      expect(t.getBucket(0)!.getSnapshot().tokens).toBe(4); // 旧状态保留
      expect(t.getBucket(1)!.getSnapshot().tokens).toBe(5); // 新 bucket 满令牌
    });

    it('删除 key 时对应 bucket 被移除', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(3));

      t.initializeKeys(makeKeys(1));

      expect(t.getAllSnapshots()).toHaveLength(1);
      expect(t.getBucket(1)).toBeUndefined();
      expect(t.getBucket(2)).toBeUndefined();
    });
  });

  describe('selectKey', () => {
    it('令牌最多优先', async () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 }));
      // key0 消耗 2 个令牌
      await t.getBucket(0)!.acquire(1000);
      await t.getBucket(0)!.acquire(1000);

      expect(t.selectKey()).toBe(1);
    });

    it('令牌并列时取 idx 最小', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(3));

      expect(t.selectKey()).toBe(0);
    });

    it('冷静期的 key 被跳过', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2));
      t.getBucket(0)!.markCooldown(60 * 1000);

      expect(t.selectKey()).toBe(1);
    });

    it('failed 的 key 被跳过', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2));
      t.getBucket(0)!.markFailed('401');

      expect(t.selectKey()).toBe(1);
    });

    it('excludeKeyIndices 中的 key 被跳过', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(3));

      expect(t.selectKey(new Set([0, 1]))).toBe(2);
    });

    it('全部不可用返回 null', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2));
      t.getBucket(0)!.markCooldown(60 * 1000);
      t.getBucket(1)!.markFailed('401');

      expect(t.selectKey()).toBeNull();
    });

    it('全部在 excludeKeyIndices 中返回 null', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2));

      expect(t.selectKey(new Set([0, 1]))).toBeNull();
    });
  });

  describe('getMinCooldownRemainingMs', () => {
    it('无冷静期返回 0', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2));

      expect(t.getMinCooldownRemainingMs()).toBe(0);
    });

    it('返回最短冷静期剩余时间', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2));
      t.getBucket(0)!.markCooldown(5000);
      t.getBucket(1)!.markCooldown(2000);

      expect(t.getMinCooldownRemainingMs()).toBe(2000);
    });

    it('failed key 的恢复时间计入', () => {
      const t = createTracker(COOLDOWN_MS, 3000);
      t.initializeKeys(makeKeys(1));
      t.getBucket(0)!.markFailed('401');

      expect(t.getMinCooldownRemainingMs()).toBe(3000);
    });

    it('冷静期随时间递减', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(1));
      t.getBucket(0)!.markCooldown(5000);

      vi.advanceTimersByTime(2000);

      expect(t.getMinCooldownRemainingMs()).toBe(3000);
    });
  });

  describe('getAllSnapshots', () => {
    it('返回所有 key 的完整健康快照', async () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2, { capacity: 5, refillRatePerSec: 0, maxConcurrent: 3 }));
      await t.getBucket(0)!.acquire(1000);
      t.getBucket(1)!.markCooldown(60 * 1000);

      const snapshots = t.getAllSnapshots();

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]).toMatchObject({
        keyIndex: 0,
        label: 'Key0',
        isInCooldown: false,
        isFailed: false,
        availableTokens: 4,
        activeRequests: 1,
      });
      expect(snapshots[1]).toMatchObject({
        keyIndex: 1,
        isInCooldown: true,
        isFailed: false,
        consecutive429: 1,
      });
      expect(snapshots[1].cooldownEndsAt).not.toBeNull();
    });
  });

  describe('周期性恢复', () => {
    it('60s 定时器触发 checkRestore 恢复到期冷静期', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(1));
      t.getBucket(0)!.markCooldown(30 * 1000);
      expect(t.selectKey()).toBeNull();

      // 推进 61 秒：60s 定时器触发 checkRestore → 冷静期（30s）已结束
      vi.advanceTimersByTime(61 * 1000);

      expect(t.selectKey()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('destroy 后快照为空且定时器被清理', () => {
      const t = createTracker();
      t.initializeKeys(makeKeys(2));

      t.destroy();

      expect(t.getAllSnapshots()).toHaveLength(0);
      // 定时器已清理：推进时间不会有任何效果（无残留回调抛错）
      expect(() => vi.advanceTimersByTime(120 * 1000)).not.toThrow();
    });
  });
});
