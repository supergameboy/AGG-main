/**
 * 世界状态分区：种子/密度/速度 + 区块状态网格（模块1 状态机实时观测）+ 玩家状态 + 区域横幅测试
 */

import React, { useMemo } from 'react';
import { useConfigStore } from '@/stores/configStore';
import { useMapStore } from '@/stores/mapStore';
import { engine } from '@/stores/engine-instance';
import { SliderRow, StatRow, Hint } from './controls';
import type { ChunkStatus } from '@/types/tile-map';

const STATUS_COLOR: Record<ChunkStatus, string> = {
  ready: '#34d399',
  generating: '#fbbf24',
  pending: '#4b5563',
  failed: '#ef4444',
};

export const WorldSection: React.FC = () => {
  const world = useConfigStore((s) => s.world);
  const setWorld = useConfigStore((s) => s.setWorld);
  const regenerateWorld = useConfigStore((s) => s.regenerateWorld);
  const player = useMapStore((s) => s.player);
  const chunks = useMapStore((s) => s.chunks);
  const worldChunks = engine.worldChunksCount;
  const chunkSize = useConfigStore((s) => s.decisions.chunkSize);

  const grid = useMemo(() => {
    const map = new Map<string, ChunkStatus>();
    chunks.forEach((c) => map.set(`${c.chunkX},${c.chunkY}`, c.status));
    const cells: { x: number; y: number; status: ChunkStatus | 'none' }[] = [];
    for (let y = 0; y < worldChunks; y += 1) {
      for (let x = 0; x < worldChunks; x += 1) {
        cells.push({ x, y, status: map.get(`${x},${y}`) ?? 'none' });
      }
    }
    return cells;
  }, [chunks, worldChunks]);

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <button
          className="flex-1 px-2 py-1.5 rounded bg-purple-500/25 border border-purple-400/50 text-purple-100 text-[11px] hover:bg-purple-500/35"
          onClick={regenerateWorld}
        >
          ⟳ 按当前配置重建世界
        </button>
        <button
          className="px-2 py-1.5 rounded bg-white/5 border border-white/10 text-gray-300 text-[11px] hover:bg-white/10"
          onClick={() => {
            const next = Math.floor(Math.random() * 100000);
            setWorld({ seed: next });
            regenerateWorld();
          }}
        >
          🎲 随机种子
        </button>
      </div>

      <SliderRow label="世界种子" value={world.seed} min={1} max={99999} step={1} onChange={(v) => setWorld({ seed: v })} docRef="同种子同世界" />
      <SliderRow label="建筑密度" value={world.buildingDensity} min={0} max={1} step={0.05} onChange={(v) => setWorld({ buildingDensity: v })} docRef="模块6 放置" />
      <SliderRow label="移动速度" value={world.moveTilesPerSec} min={2} max={12} step={1} unit=" 瓦片/s" onChange={(v) => setWorld({ moveTilesPerSec: v })} />

      <div className="pt-1 border-t border-white/5">
        <div className="text-[11px] text-gray-400 mb-1.5">区块状态网格（模块1 §4.2.1 状态机）</div>
        <div className="flex items-center gap-2">
          <div
            className="grid gap-[2px] shrink-0"
            style={{ gridTemplateColumns: `repeat(${worldChunks}, 1fr)`, width: Math.min(150, worldChunks * 12) }}
          >
            {grid.map((c) => (
              <div
                key={`${c.x},${c.y}`}
                title={`(${c.x},${c.y}) ${c.status}`}
                style={{
                  aspectRatio: '1',
                  background: c.status === 'none' ? '#26262f' : STATUS_COLOR[c.status],
                  borderRadius: 1.5,
                  outline: player.chunkX === c.x && player.chunkY === c.y ? '1.5px solid #fff' : 'none',
                }}
              />
            ))}
          </div>
          <div className="space-y-0.5 text-[10px] text-gray-500">
            <div><span style={{ color: STATUS_COLOR.ready }}>■</span> ready {chunks.filter((c) => c.status === 'ready').length}</div>
            <div><span style={{ color: STATUS_COLOR.generating }}>■</span> generating {chunks.filter((c) => c.status === 'generating').length}</div>
            <div><span style={{ color: STATUS_COLOR.pending }}>■</span> pending（未调度）</div>
            <div><span style={{ color: STATUS_COLOR.failed }}>■</span> failed {chunks.filter((c) => c.status === 'failed').length}</div>
          </div>
        </div>
      </div>

      <div className="pt-1 border-t border-white/5 space-y-1">
        <div className="text-[11px] text-gray-400 mb-1">玩家状态（PlayerMapState）</div>
        <StatRow label="瓦片坐标" value={`(${player.tileX}, ${player.tileY}) 朝向 ${player.facing}`} />
        <StatRow label="连续位置" value={`(${player.x.toFixed(2)}, ${player.y.toFixed(2)})`} />
        <StatRow label="区块" value={`chunk(${player.chunkX}, ${player.chunkY}) · ${chunkSize}×${chunkSize}`} />
        <StatRow label="区域" value={`${player.regionName}（${player.regionType}）`} />
        <StatRow label="模式" value={player.mode === 'overworld' ? '大地图' : player.mode === 'interiorA' ? '方案A 内部' : `方案B Z=${player.floor + 2}`} />
      </div>

      <button
        className="w-full px-2 py-1.5 rounded bg-white/5 border border-white/10 text-gray-300 text-[11px] hover:bg-white/10"
        onClick={() => {
          // 横幅测试（模块5 §2.2 区域横幅，不依赖移动）
          const regions = [
            { name: '翡翠森林', type: 'forest' as const },
            { name: '落霞城', type: 'city' as const },
            { name: '黄金沙漠', type: 'desert' as const },
          ];
          const r = regions[Math.floor(Math.random() * regions.length)];
          engine.testBanner(r.name, r.type);
        }}
      >
        🚩 测试区域横幅（模块5 §2.2）
      </button>
      <Hint>白圈 = 玩家所在区块。观察「mock_llm」生成时 generating（黄）按优先级逐块转 ready（绿）。</Hint>
    </div>
  );
};
