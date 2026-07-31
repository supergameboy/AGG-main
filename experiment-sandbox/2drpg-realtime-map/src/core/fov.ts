/**
 * FOV 圆形视野（镜像模块3 §2.3 FOVCalculator + §3.2.4 射线投射算法）
 * - 圆形半径，不可通行瓦片（mountain/wall/forest 高密度遮挡）阻挡视野
 * - 已探索持久化由 WorldEngine 持有（exploredTiles Set<"x,y">）
 * - 连续坐标模型：原点为玩家浮点位置，可见区随连续位移平滑变化（渲染侧每 tick 重算）
 * 性能目标：半径 5 <2ms（模块3 §6.4）。
 */

import { TILE_PROPERTIES, type TileType } from '@/types/tile-map';

/** 遮挡判定：不可通行且非"低洼"的瓦片遮挡视线（水/熔岩不挡视线但不可通行） */
function isOpaque(tile: TileType): boolean {
  const p = TILE_PROPERTIES[tile];
  if (tile === 'water' || tile === 'lava' || tile === 'bridge' || tile === 'void') return false;
  if (tile === 'forest') return true; // 附录A：森林遮挡视野
  return !p.walkable;
}

/** 浮点位置 → 所在瓦片（瓦片中心=整数点，与 WorldEngine.tileX/tileY 同一约定） */
function posToTile(v: number): number {
  return Math.floor(v + 0.5);
}

/**
 * 计算视野内可见瓦片集合（"x,y" 格式）
 * 算法：以浮点位置 (cx,cy) 为圆心，对半径内每个候选瓦片中心作浮点射线，
 * 按 1/4 瓦片步长采样路径遮挡（起点/终点所在瓦片不遮挡自身）。
 */
export function computeVisibleTiles(
  cx: number,
  cy: number,
  radius: number,
  getTile: (x: number, y: number) => TileType | null,
): Set<string> {
  const visible = new Set<string>();
  const baseX = posToTile(cx);
  const baseY = posToTile(cy);
  visible.add(`${baseX},${baseY}`);
  const r2 = radius * radius;

  for (let ty = baseY - radius; ty <= baseY + radius; ty += 1) {
    for (let tx = baseX - radius; tx <= baseX + radius; tx += 1) {
      const dx = tx - cx;
      const dy = ty - cy;
      if (dx * dx + dy * dy > r2) continue;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(dist / 0.25));
      let blocked = false;
      for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        const sx = posToTile(cx + dx * t);
        const sy = posToTile(cy + dy * t);
        if (sx === tx && sy === ty) continue; // 终点瓦片不遮挡自身（墙体边缘可见）
        if (sx === baseX && sy === baseY) continue; // 起点瓦片不遮挡
        const tile = getTile(sx, sy);
        if (tile === null || isOpaque(tile)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) visible.add(`${tx},${ty}`);
    }
  }
  return visible;
}
