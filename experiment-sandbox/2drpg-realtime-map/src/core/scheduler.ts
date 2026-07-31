/**
 * 预生成调度器（镜像模块2 §3.3 PrefetchScheduler + TriggerEvaluator P0-P3）
 * 保留设计的关键机制：
 * - 四级触发：P0 4邻居 / P1 方向预测 / P2 任务相关（沙箱未启用）/ P3 对角线（空闲时）
 * - 双层去重：PriorityQueue.has() + inFlightChunks（§3.3.9）
 * - 状态机驱动：pending → generating → ready/failed（模块1 §4.2.1）
 * - 重试：retryCount < MAX_RETRY_COUNT 重新入队
 * - 结果池写入：processNext 成功后 putMapToPool（模块4 §2.5.1）
 */

import type { ChunkCoordinates, ChunkStatus, GeneratorKind, OutputFormat, RegionInfo } from '@/types/tile-map';
import { MAX_RETRY_COUNT } from '@/types/tile-map';
import { PriorityQueue, type QueueItem } from './priority-queue';
import { getChunkNeighbors, DIRECTION_OFFSETS } from './chunk-utils';
import { EventBus } from './events';

export type PrefetchTriggerType = 'neighbor_p0' | 'direction_p1' | 'quest_p2' | 'diagonal_p3' | 'manual';

export interface PrefetchRequest extends QueueItem {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly triggerType: PrefetchTriggerType;
  retryCount: number;
}

export interface SchedulerConfig {
  enabledP0: boolean;
  enabledP1: boolean;
  enabledP3: boolean;
  maxConcurrent: number;
  directionThreshold: number;
  generatorKind: GeneratorKind;
  outputFormat: OutputFormat;
  mockLlmLatencyMs: number;
}

export interface SchedulerStats {
  queueSize: number;
  inFlight: number;
  totalTriggered: number;
  totalSucceeded: number;
  totalFailed: number;
  byPriority: Record<number, { triggered: number; completed: number }>;
  queue: readonly PrefetchRequest[];
}

/** 调度器依赖（由 WorldEngine 注入，端口接口语义） */
export interface SchedulerDeps {
  getChunkStatus(chunkX: number, chunkY: number): ChunkStatus | null;
  generateChunk(chunkX: number, chunkY: number, generatorKind: GeneratorKind, outputFormat: OutputFormat, mockLlmLatencyMs: number, triggerType: PrefetchTriggerType): Promise<boolean>;
  getRegionFor(chunkX: number, chunkY: number): RegionInfo;
  putMapToPool(chunkKey: string, priority: number): void;
}

export class PrefetchScheduler {
  private queue = new PriorityQueue<PrefetchRequest>();
  private inFlightChunks = new Set<string>();
  private activeWorkers = 0;
  private stats = {
    totalTriggered: 0,
    totalSucceeded: 0,
    totalFailed: 0,
    byPriority: { 0: { triggered: 0, completed: 0 }, 1: { triggered: 0, completed: 0 }, 2: { triggered: 0, completed: 0 }, 3: { triggered: 0, completed: 0 } } as Record<number, { triggered: number; completed: number }>,
  };
  private stopped = false;

  constructor(private readonly deps: SchedulerDeps, private config: SchedulerConfig) {}

  updateConfig(config: SchedulerConfig): void {
    this.config = config;
  }

  private key(x: number, y: number): string {
    return `${x}:${y}`;
  }

  /** TriggerEvaluator：玩家进入新区块 / 移动事件触发评估（模块2 §4.2.1-4.2.4） */
  evaluateAndEnqueue(current: ChunkCoordinates, moveHistory: readonly ('north' | 'south' | 'east' | 'west')[]): number {
    const requests: PrefetchRequest[] = [];
    const mk = (chunkX: number, chunkY: number, priority: number, triggerType: PrefetchTriggerType): PrefetchRequest => ({
      chunkX,
      chunkY,
      priority,
      triggerType,
      retryCount: 0,
      enqueuedAt: Date.now(),
      dedupeKey: this.key(chunkX, chunkY),
    });
    const needGen = (x: number, y: number): boolean => {
      const s = this.deps.getChunkStatus(x, y);
      return s === null || s === 'pending' || s === 'failed';
    };

    // P0：4 正交邻居（pending/failed 才入队，§4.2.1 排除 ready/generating）
    if (this.config.enabledP0) {
      for (const n of getChunkNeighbors(current.chunkX, current.chunkY).slice(0, 4)) {
        if (needGen(n.chunkX, n.chunkY)) requests.push(mk(n.chunkX, n.chunkY, 0, 'neighbor_p0'));
      }
    }

    // P1：连续 N 步同方向 → 预测前进方向 2 个区块（§4.2.2）
    if (this.config.enabledP1 && moveHistory.length >= this.config.directionThreshold) {
      const recent = moveHistory.slice(-this.config.directionThreshold);
      if (recent.every((d) => d === recent[0])) {
        const dir = recent[0];
        const { dx, dy } = DIRECTION_OFFSETS[dir];
        for (const dist of [1, 2]) {
          const tx = current.chunkX + dx * dist;
          const ty = current.chunkY + dy * dist;
          if (needGen(tx, ty)) requests.push(mk(tx, ty, 1, 'direction_p1'));
        }
      }
    }

    // P3：对角线邻居（仅资源空闲时，§4.2.4）
    if (this.config.enabledP3 && this.queue.size() === 0 && this.inFlightChunks.size === 0) {
      for (const n of getChunkNeighbors(current.chunkX, current.chunkY).slice(4)) {
        if (needGen(n.chunkX, n.chunkY)) requests.push(mk(n.chunkX, n.chunkY, 3, 'diagonal_p3'));
      }
    }

    return this.enqueueBatch(requests);
  }

  enqueueManual(chunkX: number, chunkY: number, priority = 0): boolean {
    return this.enqueue({
      chunkX,
      chunkY,
      priority,
      triggerType: 'manual',
      retryCount: 0,
      enqueuedAt: Date.now(),
      dedupeKey: this.key(chunkX, chunkY),
    });
  }

  /** 双层去重入队（§3.3.9 enqueuePrefetch） */
  private enqueue(req: PrefetchRequest): boolean {
    if (this.inFlightChunks.has(req.dedupeKey)) return false;
    const ok = this.queue.enqueue(req);
    if (ok) {
      this.stats.totalTriggered += 1;
      this.stats.byPriority[req.priority].triggered += 1;
      EventBus.emit('prefetch.scheduled', { chunkX: req.chunkX, chunkY: req.chunkY, priority: `P${req.priority}`, trigger: req.triggerType });
      this.pump();
    }
    return ok;
  }

  enqueueBatch(requests: PrefetchRequest[]): number {
    let n = 0;
    for (const r of requests) if (this.enqueue(r)) n += 1;
    return n;
  }

  /** worker 泵：maxConcurrent 并发处理 */
  private pump(): void {
    if (this.stopped) return;
    while (this.activeWorkers < this.config.maxConcurrent && this.queue.size() > 0) {
      const req = this.queue.dequeue();
      if (!req) break;
      void this.processNext(req);
    }
  }

  /** processNext（§3.3.9）：in-flight 跟踪 + 生成 + 结果池写入 + 重试 */
  private async processNext(req: PrefetchRequest): Promise<void> {
    if (this.inFlightChunks.has(req.dedupeKey)) return;
    this.inFlightChunks.add(req.dedupeKey);
    this.activeWorkers += 1;
    const t0 = performance.now();
    try {
      const ok = await this.deps.generateChunk(req.chunkX, req.chunkY, this.config.generatorKind, this.config.outputFormat, this.config.mockLlmLatencyMs, req.triggerType);
      if (ok) {
        this.stats.totalSucceeded += 1;
        this.stats.byPriority[req.priority].completed += 1;
        this.deps.putMapToPool(req.dedupeKey, req.priority);
        EventBus.emit('prefetch.completed', { chunkX: req.chunkX, chunkY: req.chunkY, durationMs: performance.now() - t0, success: true });
      } else if (req.retryCount < MAX_RETRY_COUNT) {
        this.enqueue({ ...req, retryCount: req.retryCount + 1, enqueuedAt: Date.now() });
      } else {
        this.stats.totalFailed += 1;
        EventBus.emit('prefetch.completed', { chunkX: req.chunkX, chunkY: req.chunkY, durationMs: performance.now() - t0, success: false });
      }
    } finally {
      this.inFlightChunks.delete(req.dedupeKey);
      this.activeWorkers -= 1;
      this.pump();
    }
  }

  /** cancelAll（§3.3.2）：清空队列（玩家退出/世界重建） */
  cancelAll(): void {
    this.queue.clear();
  }

  destroy(): void {
    this.stopped = true;
    this.queue.clear();
    this.inFlightChunks.clear();
  }

  getStats(): SchedulerStats {
    return {
      queueSize: this.queue.size(),
      inFlight: this.inFlightChunks.size,
      totalTriggered: this.stats.totalTriggered,
      totalSucceeded: this.stats.totalSucceeded,
      totalFailed: this.stats.totalFailed,
      byPriority: this.stats.byPriority,
      queue: this.queue.list(),
    };
  }
}
