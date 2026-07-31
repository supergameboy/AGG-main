/**
 * 地图状态 Store（镜像模块5 §2.3 mapStore 扩展：瓦片地图状态 + 流式加载状态 + 横幅状态）
 * 数据来源：WorldEngine 快照（引擎 notify 时同步，500ms 定时兜底刷新统计区）。
 */

import { create } from 'zustand';
import type { ChunkMetadata, RegionType } from '@/types/tile-map';
import { engine, registerEngineNotify } from './engine-instance';
import type { PlayerSnapshot } from '@/core/world';
import type { SchedulerStats } from '@/core/scheduler';
import type { PoolStats } from '@/core/result-pool';

export interface BannerState {
  seq: number;
  regionName: string;
  regionType: RegionType;
  fromName: string | null;
  at: number;
}

interface MapState {
  player: PlayerSnapshot;
  banner: BannerState | null;
  chunks: readonly ChunkMetadata[];
  scheduler: SchedulerStats;
  pool: PoolStats;
  cache: { size: number; capacity: number; hits: number; misses: number; evicted: number; hitRate: number };
  syncFromEngine: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  player: engine.getPlayerSnapshot(),
  banner: null,
  chunks: [],
  scheduler: engine.getSchedulerStats(),
  pool: engine.getPoolStats(),
  cache: engine.getCacheStats(),
  syncFromEngine: () => {
    set({
      player: engine.getPlayerSnapshot(),
      banner: engine.getBanner(),
      chunks: engine.getChunksMetadata(),
      scheduler: engine.getSchedulerStats(),
      pool: engine.getPoolStats(),
      cache: engine.getCacheStats(),
    });
  },
}));

// 引擎 → store 订阅（组合根）
registerEngineNotify(() => useMapStore.getState().syncFromEngine());

// 统计区定时刷新（调度队列/缓存/结果池在后台异步变化，引擎不一定 notify）
if (typeof window !== 'undefined') {
  window.setInterval(() => useMapStore.getState().syncFromEngine(), 500);
}
