/**
 * 坐标索引纯函数（镜像模块1 §3.1.6 下沉到 shared 的纯函数）
 * 关键不变量（模块1 §4.2.2）：
 * - worldToChunk(63,63).chunkX === 0（chunkSize=64 时）
 * - worldToChunk(-1,-1).chunkX === -1（支持负象限）
 * 沙箱说明：chunkSize 为决策点（附录E），故函数显式接收 chunkSize 参数。
 */

import type { ChunkCoordinates, ChunkDirection, SubChunkCoordinates, WorldCoordinates } from '@/types/tile-map';
import { SUB_CHUNK_SIZE } from '@/types/tile-map';

export function getChunkId(chunkX: number, chunkY: number): string {
  return `chunk_${chunkX}_${chunkY}`;
}

export function worldToChunk(x: number, y: number, chunkSize: number): ChunkCoordinates {
  return { chunkX: Math.floor(x / chunkSize), chunkY: Math.floor(y / chunkSize) };
}

export function worldToLocal(x: number, y: number, chunkSize: number): ChunkCoordinates & { localX: number; localY: number } {
  const { chunkX, chunkY } = worldToChunk(x, y, chunkSize);
  return {
    chunkX,
    chunkY,
    localX: x - chunkX * chunkSize,
    localY: y - chunkY * chunkSize,
  };
}

export function chunkToWorld(chunkX: number, chunkY: number, localX: number, localY: number, chunkSize: number): WorldCoordinates {
  if (localX < 0 || localX >= chunkSize || localY < 0 || localY >= chunkSize) {
    throw new RangeError(`localX/localY 越界: (${localX}, ${localY})，chunkSize=${chunkSize}`);
  }
  return { x: chunkX * chunkSize + localX, y: chunkY * chunkSize + localY };
}

/** 全局子区块坐标（模块3 §2.4.2 SubChunkGlobalCoordinates） */
export function worldToSubChunk(x: number, y: number): { subChunkX: number; subChunkY: number } {
  return { subChunkX: Math.floor(x / SUB_CHUNK_SIZE), subChunkY: Math.floor(y / SUB_CHUNK_SIZE) };
}

export function subChunkKey(c: SubChunkCoordinates): string {
  return `${c.chunkX}:${c.chunkY}:${c.subX}:${c.subY}`;
}

export const DIRECTION_OFFSETS: Readonly<Record<ChunkDirection, { dx: number; dy: number }>> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
  northeast: { dx: 1, dy: -1 },
  northwest: { dx: -1, dy: -1 },
  southeast: { dx: 1, dy: 1 },
  southwest: { dx: -1, dy: 1 },
};

/** 8 方向邻居（模块1 §3.1.6 getChunkNeighbors，按 N/S/E/W/NW/NE/SW/SE 顺序） */
export function getChunkNeighbors(chunkX: number, chunkY: number): Array<{ direction: ChunkDirection } & ChunkCoordinates> {
  const order: ChunkDirection[] = ['north', 'south', 'east', 'west', 'northwest', 'northeast', 'southwest', 'southeast'];
  return order.map((direction) => {
    const { dx, dy } = DIRECTION_OFFSETS[direction];
    return { direction, chunkX: chunkX + dx, chunkY: chunkY + dy };
  });
}

/** 跨区块方向判定（模块3 §3.2.6） */
export function chunkDirectionBetween(prev: ChunkCoordinates, curr: ChunkCoordinates): ChunkDirection | null {
  const dx = curr.chunkX - prev.chunkX;
  const dy = curr.chunkY - prev.chunkY;
  if (dx === 0 && dy === 0) return null;
  if (dx > 0 && dy < 0) return 'northeast';
  if (dx > 0 && dy > 0) return 'southeast';
  if (dx < 0 && dy < 0) return 'northwest';
  if (dx < 0 && dy > 0) return 'southwest';
  if (dx > 0) return 'east';
  if (dx < 0) return 'west';
  if (dy > 0) return 'south';
  return 'north';
}
