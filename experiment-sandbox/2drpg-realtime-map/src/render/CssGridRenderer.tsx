/**
 * CSS Grid 渲染器（镜像模块5 §2.1.3 CssGridRenderer，附录D Phase 1 MVP）
 * - DOM div + mvpColor + emoji（附录A mvpColor/mvpIcon 字段消费）
 * - 视口裁剪（仅渲染玩家周围 viewportRadius 瓦片，模块5 §3.2.1）
 * - 迷雾三态 + WCAG：容器 tabindex=0 + aria-label（模块5 §2.1.8）
 * 定位：与 Canvas 2D 渲染器形成"决策分叉口"A/B 对比（DOM vs Canvas 视觉/性能差异）
 */

import React, { useMemo } from 'react';
import type { WorldEngine } from '@/core/world';
import { TILE_PROPERTIES, type TileType } from '@/types/tile-map';

interface Props {
  engine: WorldEngine;
  tileSize: number; // 单瓦片像素（缩放）
  fogMode: 'off' | 'fog' | 'dark';
  viewportRadius: number;
  tick: number; // 强制刷新（移动后）
}

const ENTITY_ICONS: Readonly<Record<string, string>> = {
  enemy: '🐺',
  npc: '🧙',
  chest: '📦',
  item: '🎁',
  portal: '🌀',
  building: '🏠',
};

export const CssGridRenderer: React.FC<Props> = ({ engine, tileSize, fogMode, viewportRadius }) => {
  const player = engine.getPlayerSnapshot();

  const { tiles, offsetX, offsetY } = useMemo(() => {
    const r = viewportRadius;
    const cx = player.tileX;
    const cy = player.tileY;
    const rows: { tile: TileType; x: number; y: number }[][] = [];
    for (let y = cy - r; y <= cy + r; y += 1) {
      const row: { tile: TileType; x: number; y: number }[] = [];
      for (let x = cx - r; x <= cx + r; x += 1) {
        row.push({ tile: engine.getTileAt(x, y), x, y });
      }
      rows.push(row);
    }
    return { tiles: rows, offsetX: cx - r, offsetY: cy - r };
  }, [engine, player.tileX, player.tileY, viewportRadius]);

  const entities = engine.getEntitiesInRect(
    player.tileX - viewportRadius,
    player.tileY - viewportRadius,
    player.tileX + viewportRadius,
    player.tileY + viewportRadius,
  );

  const dim = viewportRadius * 2 + 1;
  return (
    <div
      className="relative overflow-hidden w-full h-full bg-[#0b0b12]"
      role="application"
      aria-label={`瓦片地图（CSS Grid MVP），当前位于 ${player.regionName}，坐标 (${player.tileX}, ${player.tileY})`}
      tabIndex={0}
    >
      <div
        className="absolute"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${dim}, ${tileSize}px)`,
          gridTemplateRows: `repeat(${dim}, ${tileSize}px)`,
          left: '50%',
          top: '50%',
          transform: `translate(${-((player.x - offsetX + 0.5) * tileSize)}px, ${-((player.y - offsetY + 0.5) * tileSize)}px)`,
        }}
      >
        {tiles.flatMap((row) =>
          row.map(({ tile, x, y }) => {
            const prop = TILE_PROPERTIES[tile];
            const visible = engine.isVisibleNow(x, y);
            const explored = engine.isExplored(x, y);
            let overlay: string | null = null;
            if (fogMode !== 'off' && !visible) {
              overlay = explored ? 'rgba(4,4,10,0.5)' : fogMode === 'dark' ? 'rgba(4,4,10,0.96)' : 'rgba(4,4,10,0.82)';
            }
            return (
              <div
                key={`${x},${y}`}
                className="relative flex items-center justify-center select-none"
                style={{ width: tileSize, height: tileSize, background: prop.mvpColor, outline: '1px solid rgba(0,0,0,0.25)' }}
                aria-label={`${tile} (${x},${y})`}
              >
                {tileSize >= 20 && <span style={{ fontSize: tileSize * 0.55, lineHeight: 1 }}>{prop.mvpIcon}</span>}
                {overlay && <div className="absolute inset-0" style={{ background: overlay }} />}
              </div>
            );
          }),
        )}
        {/* 实体层 */}
        {entities.map((e) => (
          <div
            key={e.id}
            className="absolute pointer-events-none"
            style={{
              left: (e.x - offsetX) * tileSize,
              top: (e.y - offsetY) * tileSize,
              width: tileSize,
              height: tileSize,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: tileSize * 0.6,
            }}
          >
            {ENTITY_ICONS[e.type] ?? '❔'}
          </div>
        ))}
        {/* 玩家 */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: (player.x - offsetX) * tileSize,
            top: (player.y - offsetY) * tileSize,
            width: tileSize,
            height: tileSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'left 60ms linear, top 60ms linear',
          }}
        >
          <div
            style={{
              width: tileSize * 0.62,
              height: tileSize * 0.62,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 30%, #6b5a9e, #3a2f4a)',
              border: '2px solid rgba(255,210,120,0.85)',
              boxShadow: '0 0 8px rgba(255,190,90,0.6)',
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CssGridRenderer;
