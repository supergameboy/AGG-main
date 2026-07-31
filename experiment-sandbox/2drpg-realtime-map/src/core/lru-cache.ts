/**
 * LRU 子区块缓存（镜像模块3 §2.4.3 SubChunkCache + §3.2.5 数据结构）
 * - 容量上限可配（主项目 1024，沙箱默认 256）
 * - set 超容时淘汰最久未访问 entry（O(1)，Map 迭代序）
 * - markLoading / markFailed 防重复请求（§3.3 并发控制）
 */

export interface CacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly lastAccessedAt: number;
  readonly state: 'ready' | 'loading' | 'failed';
}

export class SubChunkCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private evictedCount = 0;
  private hits = 0;
  private misses = 0;

  constructor(private capacity: number) {}

  setCapacity(capacity: number): void {
    this.capacity = capacity;
  }

  get(key: string): CacheEntry<T> | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // LRU：重新插入到末尾
    this.map.delete(key);
    this.map.set(key, { ...e, lastAccessedAt: Date.now() });
    return this.map.get(key);
  }

  set(key: string, value: T): string[] {
    const evicted: string[] = [];
    this.map.delete(key);
    this.map.set(key, { key, value, lastAccessedAt: Date.now(), state: 'ready' });
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
      evicted.push(oldest);
      this.evictedCount += 1;
    }
    return evicted;
  }

  markLoading(key: string): boolean {
    if (this.map.has(key)) return false;
    this.map.set(key, { key, value: null as unknown as T, lastAccessedAt: Date.now(), state: 'loading' });
    return true;
  }

  markFailed(key: string): void {
    this.map.set(key, { key, value: null as unknown as T, lastAccessedAt: Date.now(), state: 'failed' });
  }

  evictMany(keys: readonly string[]): void {
    keys.forEach((k) => this.map.delete(k));
  }

  has(key: string): boolean {
    const e = this.map.get(key);
    return !!e && e.state === 'ready';
  }

  size(): number {
    return this.map.size;
  }

  capacityLimit(): number {
    return this.capacity;
  }

  stats(): { size: number; capacity: number; hits: number; misses: number; evicted: number; hitRate: number } {
    const total = this.hits + this.misses;
    return { size: this.map.size, capacity: this.capacity, hits: this.hits, misses: this.misses, evicted: this.evictedCount, hitRate: total === 0 ? 1 : this.hits / total };
  }

  clear(): void {
    this.map.clear();
    this.evictedCount = 0;
    this.hits = 0;
    this.misses = 0;
  }
}
