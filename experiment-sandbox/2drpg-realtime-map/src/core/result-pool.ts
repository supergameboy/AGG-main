/**
 * 结果池（镜像模块4 §2.1 分类结果池：map_pool + narrative_pool）
 * 状态机：pending → consumed / expired（模块4 §2.1.5）
 * 命中查询语义（模块4 §3.2.1）：saveId + locationId(chunkId) + status='pending'。
 */

import { EventBus } from './events';

export type PoolStatus = 'pending' | 'consumed' | 'expired';

export interface MapPoolEntry {
  readonly id: string;
  readonly chunkKey: string;
  readonly priority: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  status: PoolStatus;
  consumedAt: number | null;
}

export interface PoolStats {
  mapPending: number;
  mapConsumed: number;
  mapExpired: number;
  hits: number;
  misses: number;
}

/**
 * 沙箱版 ResultPoolService：
 * - 模块2 PrefetchScheduler 是唯一写入方（putMap）
 * - 模块3 ChunkStreamLoader 语义的消费方（getMap / consumeMap）
 */
export class ResultPool {
  private mapPool = new Map<string, MapPoolEntry>();
  private hits = 0;
  private misses = 0;
  private static MAP_TTL_MS = 24 * 60 * 60 * 1000; // 模块4 §2.1.2：默认 24h

  putMap(chunkKey: string, priority: number): void {
    this.mapPool.set(chunkKey, {
      id: `pool_${chunkKey}`,
      chunkKey,
      priority,
      createdAt: Date.now(),
      expiresAt: Date.now() + ResultPool.MAP_TTL_MS,
      status: 'pending',
      consumedAt: null,
    });
  }

  /** 玩家进入区块前命中检查（模块4 §2.5.1 getMapFromPool） */
  getMap(chunkKey: string): MapPoolEntry | null {
    const e = this.mapPool.get(chunkKey);
    if (!e || e.status !== 'pending') {
      this.misses += 1;
      EventBus.emit('result_pool.miss', { poolType: 'map', key: chunkKey, fallbackAction: 'sync_generate' });
      return null;
    }
    this.hits += 1;
    EventBus.emit('result_pool.hit', { poolType: 'map', key: chunkKey, hitTimeMs: 0 });
    return e;
  }

  consumeMap(chunkKey: string): void {
    const e = this.mapPool.get(chunkKey);
    if (e && e.status === 'pending') {
      e.status = 'consumed';
      e.consumedAt = Date.now();
    }
  }

  expireAll(): void {
    this.mapPool.forEach((e) => {
      if (e.status === 'pending') e.status = 'expired';
    });
  }

  getStats(): PoolStats {
    let mapPending = 0;
    let mapConsumed = 0;
    let mapExpired = 0;
    this.mapPool.forEach((e) => {
      if (e.status === 'pending') mapPending += 1;
      else if (e.status === 'consumed') mapConsumed += 1;
      else mapExpired += 1;
    });
    return { mapPending, mapConsumed, mapExpired, hits: this.hits, misses: this.misses };
  }

  hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 1 : this.hits / total;
  }

  clear(): void {
    this.mapPool.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
