import type { IEntityGraphCache } from './types.js';

/**
 * 缓存条目（EG-M3-2 新增）。
 *
 * expireAt = 0 表示永不过期（ ttlSeconds <= 0 时使用）。
 */
interface CacheEntry<T> {
  value: T;
  expireAt: number;
  createdAt: number;
}

/**
 * EntityGraphCache — per-saveId LRU 缓存层（EG-M3-2 新增）。
 *
 * 设计依据：
 * - per-saveId 隔离：不同存档的缓存互不干扰，失效时 O(1) 删除整个 saveId Map
 * - 按查询类型分键：fullGraph / subgraph:{centerNodeId}:{depth} / edges:{nodeId}
 * - LRU 淘汰：每个 saveId 内部使用 Map 维护插入顺序，超过 maxSize 时淘汰最久未访问
 * - TTL 过期：默认 300 秒（5 分钟），覆盖一次 ReAct 循环；flush 后主动失效，不依赖 TTL 兜底
 *
 * LRU 实现：
 * - JavaScript Map 维护插入顺序（FIFO 性质）
 * - get() 命中时 delete + set 重新插入到末尾，更新访问顺序
 * - set() 时若 key 已存在先 delete（重新插入到末尾）；超过 maxSize 删除 Map 第一个条目（最久未访问）
 *
 * 线程安全：Node.js 单线程事件循环，无并发问题。异步操作间不会有竞态。
 */
export class EntityGraphCache implements IEntityGraphCache {
  /** saveId → key → entry */
  private readonly cache = new Map<string, Map<string, CacheEntry<unknown>>>();
  private hitCount = 0;
  private missCount = 0;
  private readonly maxSize: number;
  private readonly defaultTtl: number;

  /**
   * @param maxSizePerSave 每个 saveId 的最大缓存条目数（默认 100）
   * @param defaultTtlSeconds 默认 TTL 秒数（默认 300，即 5 分钟）
   */
  constructor(maxSizePerSave = 100, defaultTtlSeconds = 300) {
    if (maxSizePerSave < 1) {
      throw new Error(`EntityGraphCache: maxSizePerSave must be >= 1, got ${maxSizePerSave}`);
    }
    if (defaultTtlSeconds < 0) {
      throw new Error(`EntityGraphCache: defaultTtlSeconds must be >= 0, got ${defaultTtlSeconds}`);
    }
    this.maxSize = maxSizePerSave;
    this.defaultTtl = defaultTtlSeconds;
  }

  get<T>(saveId: string, key: string): T | null {
    const saveCache = this.cache.get(saveId);
    if (!saveCache) {
      this.missCount++;
      return null;
    }

    const entry = saveCache.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }

    // 检查过期
    if (entry.expireAt > 0 && Date.now() > entry.expireAt) {
      saveCache.delete(key);
      this.missCount++;
      return null;
    }

    // LRU 更新访问顺序：删除后重新插入到 Map 末尾
    saveCache.delete(key);
    saveCache.set(key, entry);

    this.hitCount++;
    return entry.value as T;
  }

  set<T>(saveId: string, key: string, value: T, ttlSeconds?: number): void {
    let saveCache = this.cache.get(saveId);
    if (!saveCache) {
      saveCache = new Map();
      this.cache.set(saveId, saveCache);
    }

    // 若 key 已存在，先删除（保证重新插入到末尾，更新访问顺序）
    if (saveCache.has(key)) {
      saveCache.delete(key);
    } else if (saveCache.size >= this.maxSize) {
      // LRU 淘汰：超过 maxSize 时删除 Map 第一个条目（最久未访问）
      const oldestKey = saveCache.keys().next().value;
      if (oldestKey) saveCache.delete(oldestKey);
    }

    const ttl = ttlSeconds ?? this.defaultTtl;
    saveCache.set(key, {
      value,
      expireAt: ttl > 0 ? Date.now() + ttl * 1000 : 0,
      createdAt: Date.now(),
    });
  }

  invalidate(saveId: string): void {
    this.cache.delete(saveId);
  }

  invalidateKey(saveId: string, key: string): void {
    const saveCache = this.cache.get(saveId);
    if (saveCache) {
      saveCache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  getStats(): { size: number; hitCount: number; missCount: number } {
    let size = 0;
    for (const saveCache of this.cache.values()) {
      size += saveCache.size;
    }
    return { size, hitCount: this.hitCount, missCount: this.missCount };
  }
}

/**
 * NullEntityGraphCache — 空对象模式实现（EG-M3-2 新增）。
 *
 * 用于不需要缓存的场景（如审计专用 EntityGraphService）。
 * 所有方法均为 no-op，不影响 EntityGraphService 的行为。
 *
 * 这不是 fallback：EntityGraphService 的 cache 参数必填，
 * NullEntityGraphCache 显式表达"无缓存"语义，而非可选参数静默降级。
 *
 * 审计场景使用临时 EntityGraphService 实例（基于 StagingKnex 代理 db），
 * 查询走 ShadowState，缓存无意义（每次审计都是新实例，无复用机会）。
 */
export class NullEntityGraphCache implements IEntityGraphCache {
  get<T>(_saveId: string, _key: string): T | null {
    return null;
  }
  set<T>(_saveId: string, _key: string, _value: T, _ttlSeconds?: number): void {
    // no-op
  }
  invalidate(_saveId: string): void {
    // no-op
  }
  invalidateKey(_saveId: string, _key: string): void {
    // no-op
  }
  clear(): void {
    // no-op
  }
  getStats(): { size: number; hitCount: number; missCount: number } {
    return { size: 0, hitCount: 0, missCount: 0 };
  }
}
