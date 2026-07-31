import type { TokenBucketConfig } from './TokenBucket.js';
import { TokenBucket } from './TokenBucket.js';
import { DEFAULT_TOKEN_BUCKET_CONFIG } from './constants.js';

/**
 * Key 健康状态快照
 */
export interface KeyHealthSnapshot {
  keyIndex: number;
  label: string;
  isInCooldown: boolean;
  cooldownEndsAt: number | null;
  isFailed: boolean;
  consecutive429: number;
  availableTokens: number;
  activeRequests: number;
}

/**
 * Provider 维度的 Key 健康追踪器
 *
 * 职责：
 * 1. 管理 Provider 下所有 key 的 TokenBucket 实例
 * 2. 提供选 key 算法（令牌最多优先）
 * 3. 周期性检查恢复（tryRestore）
 * 4. 配置变更时同步 TokenBucket
 */
export class KeyHealthTracker {
  private buckets: Map<number, TokenBucket> = new Map();
  private labels: Map<number, string> = new Map();
  private restoreTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * tracker 的 provider 身份由 LLMRequestDispatcher.trackers 的 Map key 持有，
   * 本类不重复存储（避免冗余字段）。
   */
  constructor(
    private readonly cooldownDefaultMs: number = 5 * 60 * 1000,
    private readonly failedRestoreMs: number = 5 * 60 * 1000,
  ) {
    // 每 60 秒检查一次恢复
    this.restoreTimer = setInterval(() => this.checkRestore(), 60 * 1000);
  }

  /**
   * 初始化 key 列表（配置加载时调用）
   */
  initializeKeys(keys: Array<{ key: string; label: string; rateLimit?: TokenBucketConfig }>): void {
    const oldBuckets = this.buckets;
    this.buckets = new Map();
    this.labels = new Map();

    keys.forEach((keyDef, idx) => {
      this.labels.set(idx, keyDef.label || `Key${idx}`);
      const config = keyDef.rateLimit ?? DEFAULT_TOKEN_BUCKET_CONFIG;

      // 保留旧 bucket 的状态（若 key 未变更）
      const oldBucket = oldBuckets.get(idx);
      if (oldBucket) {
        oldBucket.updateConfig(config);
        this.buckets.set(idx, oldBucket);
      } else {
        // B4 修复：使用顶部 import 的 TokenBucket，避免 CommonJS require
        this.buckets.set(idx, new TokenBucket(config, this.cooldownDefaultMs, this.failedRestoreMs));
      }
    });
  }

  /**
   * 选 key（令牌最多优先算法）
   *
   * @param excludeKeyIndices 本次 dispatch 已试过的 key 索引集合（避免重复尝试同一 key）
   * @returns 选中的 keyIndex，null 表示无可用 key
   */
  selectKey(excludeKeyIndices: Set<number> = new Set()): number | null {
    const candidates: Array<{ idx: number; tokens: number; activeRequests: number }> = [];

    for (const [idx, bucket] of this.buckets) {
      if (excludeKeyIndices.has(idx)) continue;       // 跳过已尝试的 key
      if (bucket.isInCooldown()) continue;
      const tokens = bucket.getAvailableTokens();
      const activeRequests = bucket.getSnapshot().activeRequests;
      candidates.push({ idx, tokens, activeRequests });
    }

    if (candidates.length === 0) return null;

    // 令牌最多优先，并列时取 idx 最小（round-robin 简化版）
    candidates.sort((a, b) => {
      if (b.tokens !== a.tokens) return b.tokens - a.tokens;
      return a.idx - b.idx;
    });

    return candidates[0].idx;
  }

  /**
   * 获取指定 key 的 TokenBucket
   */
  getBucket(keyIndex: number): TokenBucket | undefined {
    return this.buckets.get(keyIndex);
  }

  /**
   * 获取所有 key 的健康快照
   */
  getAllSnapshots(): KeyHealthSnapshot[] {
    const result: KeyHealthSnapshot[] = [];
    for (const [idx, bucket] of this.buckets) {
      const snapshot = bucket.getSnapshot();
      result.push({
        keyIndex: idx,
        label: this.labels.get(idx) ?? `Key${idx}`,
        isInCooldown: bucket.isInCooldown(),
        cooldownEndsAt: snapshot.cooldownUntil > 0 ? snapshot.cooldownUntil : null,
        isFailed: snapshot.failed,
        consecutive429: snapshot.consecutive429,
        availableTokens: snapshot.tokens,
        activeRequests: snapshot.activeRequests,
      });
    }
    return result;
  }

  /**
   * 获取最短冷静期剩余时间（用于"全不可用"时计算等待时间）
   */
  getMinCooldownRemainingMs(): number {
    let minRemaining = Infinity;
    const now = Date.now();
    for (const bucket of this.buckets.values()) {
      const snapshot = bucket.getSnapshot();
      if (snapshot.cooldownUntil > now) {
        minRemaining = Math.min(minRemaining, snapshot.cooldownUntil - now);
      }
      if (snapshot.failed && snapshot.failedAt) {
        const restoreAt = snapshot.failedAt + this.failedRestoreMs;
        if (restoreAt > now) {
          minRemaining = Math.min(minRemaining, restoreAt - now);
        }
      }
    }
    return minRemaining === Infinity ? 0 : minRemaining;
  }

  /**
   * 销毁（清理定时器）
   */
  destroy(): void {
    if (this.restoreTimer) {
      clearInterval(this.restoreTimer);
      this.restoreTimer = null;
    }
    this.buckets.clear();
    this.labels.clear();
  }

  private checkRestore(): void {
    for (const bucket of this.buckets.values()) {
      bucket.tryRestore();
    }
  }
}
