import type { TokenBucketConfig } from './TokenBucket.js';

export const DEFAULT_TOKEN_BUCKET_CONFIG: TokenBucketConfig = {
  capacity: 5,
  refillRatePerSec: 1,
  maxConcurrent: 3,
};

export const COOLDOWN_DEFAULT_MS = 5 * 60 * 1000;  // 5 分钟
export const FAILED_RESTORE_MS = 5 * 60 * 1000;    // 5 分钟
export const ACQUIRE_TIMEOUT_DEFAULT_MS = 30 * 1000; // 30 秒
export const MAX_LLM_CALL_ATTEMPTS = 3;              // 最大 LLM 调用尝试次数（不含令牌等待失败）

/**
 * 计算本次 dispatch 的最大尝试次数。
 * 决策点 2：min(key 总数, 3)，避免 key 数量较少时无效循环。
 */
export function computeMaxAttempts(keyCount: number): number {
  return Math.max(1, Math.min(keyCount, MAX_LLM_CALL_ATTEMPTS));
}

/** 前端预设模板 */
export const PRESET_TEMPLATES = {
  local: { capacity: 10, refillRatePerSec: 5, maxConcurrent: 5 },
  free: { capacity: 2, refillRatePerSec: 0.5, maxConcurrent: 1 },
  paid: { capacity: 5, refillRatePerSec: 1, maxConcurrent: 3 },
} as const;
