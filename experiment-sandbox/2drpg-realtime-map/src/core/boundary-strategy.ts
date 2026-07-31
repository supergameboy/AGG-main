/**
 * LLM 边界处理策略（镜像模块2 §3.4）
 * - 策略A hard_boundary：不感知邻居，区块独立生成（可能出现硬接缝，由渲染层美化兜底）
 * - 策略B context_aware：读取已 ready 邻居边界 1 列，生成时与邻居风格协调 + 道路对齐
 * Fallback：4 邻居均未 ready 时策略B 自动降级策略A（模块2 §4.2.7）。
 */

import type { ChunkDirection, TileType } from '@/types/tile-map';

export interface NeighborBoundary {
  readonly direction: ChunkDirection;
  readonly ready: boolean;
  /** 边界 1 列瓦片（长度 = chunkSize；north 为邻居南边一列，以此类推） */
  readonly edgeTiles: readonly TileType[];
  /** 边界上道路出口坐标（用于对齐，模块2 §3.4.6 roadAlignment） */
  readonly roadExits: readonly number[];
}

export function summarizeEdge(
  direction: ChunkDirection,
  edgeTiles: readonly TileType[] | null,
): NeighborBoundary {
  if (!edgeTiles) return { direction, ready: false, edgeTiles: [], roadExits: [] };
  const roadExits: number[] = [];
  edgeTiles.forEach((t, i) => {
    if (t === 'road' || t === 'bridge') roadExits.push(i);
  });
  return { direction, ready: true, edgeTiles, roadExits };
}

/** 边界列主导地形（策略B Prompt 摘要的程序化等价） */
export function dominantTerrain(edgeTiles: readonly TileType[]): TileType | null {
  if (edgeTiles.length === 0) return null;
  const counts = new Map<TileType, number>();
  edgeTiles.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  let best: TileType | null = null;
  let bestN = 0;
  counts.forEach((n, t) => {
    if (n > bestN) {
      bestN = n;
      best = t;
    }
  });
  return best;
}
