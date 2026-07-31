/**
 * 工具结果缓存（从 backend/services/tool-result-cache.ts 迁移）
 *
 * v1.3 改动：
 * - createChildLogger → getChildLogger（shared/utils/logger 的端口接口）
 * - 模块级 setInterval → initCleanupScheduler() 方法，backend 启动入口调用
 *
 * 设计理由：模块级 setInterval 是副作用，迁移到 shared/ 后不应在模块加载时启动。
 * backend 启动入口显式调用 initCleanupScheduler() 确保定时器启动。
 */

import { getChildLogger } from '../utils/logger.js';

const logger = getChildLogger('tool-result-cache');

interface CacheEntry {
  result: unknown;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES_PER_SAVE = 100;
const MAX_RESULT_SIZE_BYTES = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;

/** _service 写操作 → 需要失效的关联 _data tool 类型映射 */
const WRITE_TO_DATA_MAP: Record<string, string[]> = {
  inventory_service: ['inventory_data'],
  skill_service: ['skill_data'],
  map_service: ['map_data'],
  quest_service: ['quest_data'],
  npc_service: ['npc_party_data'],
  event_service: ['event_data'],
  story_service: [],
  dialogue_service: [],
  challenge_service: ['combat_data'],
  time_service: ['time_data'],
  character_service: [],
  numerical: [],
  batch_query: [],
};

export class ToolResultCache {
  private cache: Map<string, Map<string, CacheEntry>> = new Map();

  private makeKey(toolType: string, method: string, params?: Record<string, unknown>): string {
    const paramsStr = params ? JSON.stringify(params) : '';
    return `${toolType}:${method}:${paramsStr}`;
  }

  get(saveId: string, toolType: string, method: string, params?: Record<string, unknown>): unknown | undefined {
    const saveCache = this.cache.get(saveId);
    if (!saveCache) return undefined;

    const key = this.makeKey(toolType, method, params);
    const entry = saveCache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      saveCache.delete(key);
      return undefined;
    }

    logger.debug('Cache hit', { saveId, toolType, method });
    return entry.result;
  }

  set(saveId: string, toolType: string, method: string, params: Record<string, unknown> | undefined, result: unknown, ttlMs?: number): void {
    const serialized = JSON.stringify(result);
    if (serialized.length > MAX_RESULT_SIZE_BYTES) {
      logger.debug('Cache skip: result too large', { saveId, toolType, method, size: serialized.length });
      return;
    }

    let saveCache = this.cache.get(saveId);
    if (!saveCache) {
      saveCache = new Map();
      this.cache.set(saveId, saveCache);
    }

    if (saveCache.size >= MAX_ENTRIES_PER_SAVE) {
      const oldestKey = saveCache.keys().next().value;
      if (oldestKey) saveCache.delete(oldestKey);
    }

    const key = this.makeKey(toolType, method, params);
    saveCache.set(key, {
      result,
      expiresAt: Date.now() + (ttlMs ?? DEFAULT_TTL_MS),
    });
  }

  /** 写操作后失效：自身 + 关联 _data tool 类型的缓存 */
  invalidateAfterWrite(saveId: string, toolType: string): void {
    const typesToInvalidate = [toolType, ...(WRITE_TO_DATA_MAP[toolType] ?? [])];
    let totalInvalidated = 0;

    for (const type of typesToInvalidate) {
      totalInvalidated += this.invalidateToolType(saveId, type);
    }

    if (totalInvalidated > 0) {
      logger.debug('Cache invalidated after write', { saveId, toolType, totalInvalidated });
    }
  }

  invalidateSave(saveId: string): void {
    this.cache.delete(saveId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [saveId, saveCache] of this.cache) {
      for (const [key, entry] of saveCache) {
        if (now > entry.expiresAt) {
          saveCache.delete(key);
        }
      }
      if (saveCache.size === 0) {
        this.cache.delete(saveId);
      }
    }
  }

  getStats(): { saves: number; totalEntries: number } {
    let totalEntries = 0;
    for (const saveCache of this.cache.values()) {
      totalEntries += saveCache.size;
    }
    return { saves: this.cache.size, totalEntries };
  }

  private invalidateToolType(saveId: string, toolType: string): number {
    const saveCache = this.cache.get(saveId);
    if (!saveCache) return 0;

    let invalidated = 0;
    for (const [key] of saveCache) {
      if (key.startsWith(`${toolType}:`)) {
        saveCache.delete(key);
        invalidated++;
      }
    }
    return invalidated;
  }
}

export const toolResultCache = new ToolResultCache();

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

/**
 * 启动缓存清理定时器（v1.3 新增）
 *
 * 替代原模块级 setInterval。backend 启动入口调用此方法确保定时器启动。
 * 重复调用安全：会先清除已有定时器再启动新定时器。
 */
export function initCleanupScheduler(): void {
  if (cleanupTimer !== undefined) {
    clearInterval(cleanupTimer);
  }
  cleanupTimer = setInterval(() => toolResultCache.cleanup(), CLEANUP_INTERVAL_MS);
}
