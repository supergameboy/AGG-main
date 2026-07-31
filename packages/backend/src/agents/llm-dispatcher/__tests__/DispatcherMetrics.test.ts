import { describe, it, expect, afterEach } from 'vitest';
import { DispatcherMetrics } from '../DispatcherMetrics.js';
import { KeyHealthTracker } from '../KeyHealthTracker.js';

/**
 * DispatcherMetrics 单元测试
 *
 * 设计文档：solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §6
 */

function makeTracker(keyCount: number): KeyHealthTracker {
  const tracker = new KeyHealthTracker();
  tracker.initializeKeys(
    Array.from({ length: keyCount }, (_, i) => ({ key: `sk-key${i}`, label: `Key${i}` })),
  );
  return tracker;
}

describe('DispatcherMetrics', () => {
  let tracker: KeyHealthTracker | null = null;

  afterEach(() => {
    tracker?.destroy();
    tracker = null;
  });

  describe('计数累计', () => {
    it('recordSuccess 累计 totalRequests/successCount/perKeyUsed', () => {
      const metrics = new DispatcherMetrics();

      metrics.recordSuccess('p1', 0, 100);
      metrics.recordSuccess('p1', 0, 150);
      metrics.recordSuccess('p1', 1, 80);

      tracker = makeTracker(2);
      const snapshot = metrics.getSnapshot('p1', tracker);
      expect(snapshot.totalRequests).toBe(3);
      expect(snapshot.successCount).toBe(3);
      expect(snapshot.perKeyMetrics[0].totalUsed).toBe(2);
      expect(snapshot.perKeyMetrics[1].totalUsed).toBe(1);
    });

    it('record429 累计 rateLimitedCount/perKey429', () => {
      const metrics = new DispatcherMetrics();

      metrics.record429('p1', 1);
      metrics.record429('p1', 1);

      tracker = makeTracker(2);
      const snapshot = metrics.getSnapshot('p1', tracker);
      expect(snapshot.rateLimitedCount).toBe(2);
      expect(snapshot.perKeyMetrics[1].total429).toBe(2);
      expect(snapshot.perKeyMetrics[0].total429).toBe(0);
    });

    it('recordAuthFailed 累计 authFailedCount', () => {
      const metrics = new DispatcherMetrics();

      metrics.recordAuthFailed('p1', 0);

      expect(metrics.getSnapshot('p1').authFailedCount).toBe(1);
    });

    it('recordError 累计 totalRequests/errorCount', () => {
      const metrics = new DispatcherMetrics();

      metrics.recordError('p1', 0, 'server_error');
      metrics.recordError('p1', 1, 'timeout');

      const snapshot = metrics.getSnapshot('p1');
      expect(snapshot.totalRequests).toBe(2);
      expect(snapshot.errorCount).toBe(2);
      expect(snapshot.successCount).toBe(0);
    });
  });

  describe('平均值计算', () => {
    it('recordAttempt 后 avgWaitMs/avgAttemptCount 正确', () => {
      const metrics = new DispatcherMetrics();
      metrics.recordSuccess('p1', 0, 100);
      metrics.recordSuccess('p1', 0, 200);
      metrics.recordAttempt('p1', 100, 1);
      metrics.recordAttempt('p1', 300, 2);

      const snapshot = metrics.getSnapshot('p1');
      // avgWaitMs = (100 + 300) / 2 次请求 = 200
      expect(snapshot.avgWaitMs).toBe(200);
      // avgAttemptCount = (1 + 2) / 2 = 1.5
      expect(snapshot.avgAttemptCount).toBe(1.5);
    });

    it('无请求时平均值为 0', () => {
      const metrics = new DispatcherMetrics();

      const snapshot = metrics.getSnapshot('p1');

      expect(snapshot.avgWaitMs).toBe(0);
      expect(snapshot.avgAttemptCount).toBe(0);
      expect(snapshot.totalRequests).toBe(0);
    });
  });

  describe('getSnapshot', () => {
    it('无 tracker 时 perKeyMetrics 为空', () => {
      const metrics = new DispatcherMetrics();
      metrics.recordSuccess('p1', 0, 100);

      const snapshot = metrics.getSnapshot('p1');

      expect(snapshot.providerId).toBe('p1');
      expect(snapshot.perKeyMetrics).toEqual([]);
    });

    it('带 tracker 时 perKeyMetrics 合并健康状态与计数', () => {
      const metrics = new DispatcherMetrics();
      tracker = makeTracker(2);
      metrics.recordSuccess('p1', 0, 100);
      metrics.record429('p1', 1);
      tracker.getBucket(1)!.markCooldown(60 * 1000);

      const snapshot = metrics.getSnapshot('p1', tracker);

      expect(snapshot.perKeyMetrics).toHaveLength(2);
      expect(snapshot.perKeyMetrics[0]).toMatchObject({
        keyIndex: 0,
        label: 'Key0',
        totalUsed: 1,
        total429: 0,
        isInCooldown: false,
      });
      expect(snapshot.perKeyMetrics[1]).toMatchObject({
        keyIndex: 1,
        label: 'Key1',
        totalUsed: 0,
        total429: 1,
        isInCooldown: true,
        consecutive429: 1,
      });
    });

    it('多 Provider 指标独立统计', () => {
      const metrics = new DispatcherMetrics();
      metrics.recordSuccess('p1', 0, 100);
      metrics.recordSuccess('p2', 0, 100);
      metrics.record429('p2', 0);

      const s1 = metrics.getSnapshot('p1');
      const s2 = metrics.getSnapshot('p2');
      expect(s1.totalRequests).toBe(1);
      expect(s1.rateLimitedCount).toBe(0);
      expect(s2.totalRequests).toBe(1);
      expect(s2.rateLimitedCount).toBe(1);
    });
  });
});
