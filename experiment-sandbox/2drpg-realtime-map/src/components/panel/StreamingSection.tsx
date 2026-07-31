/**
 * 流式加载与缓存分区（模块3 §2.4 ViewportManager + ChunkStreamLoader + SubChunkCache）
 */

import React from 'react';
import { useConfigStore } from '@/stores/configStore';
import { useMapStore } from '@/stores/mapStore';
import { SliderRow, StatRow, Hint } from './controls';

export const StreamingSection: React.FC = () => {
  const streaming = useConfigStore((s) => s.streaming);
  const setStreaming = useConfigStore((s) => s.setStreaming);
  const cache = useMapStore((s) => s.cache);

  return (
    <div className="space-y-2.5">
      <SliderRow label="模拟网络延迟" value={streaming.streamLatencyMs} min={0} max={800} step={20} unit=" ms" onChange={(v) => setStreaming({ streamLatencyMs: v })} docRef="观测加载直方图" />
      <SliderRow label="缓冲区半径" value={streaming.bufferRadius} min={0} max={4} step={1} unit=" 子区块" onChange={(v) => setStreaming({ bufferRadius: v })} docRef="§2.4.2 默认 2" />
      <SliderRow label="淘汰阈值" value={streaming.evictThreshold} min={2} max={8} step={1} unit=" 子区块" onChange={(v) => setStreaming({ evictThreshold: v })} docRef="§2.4.6 默认 4" />
      <SliderRow label="LRU 容量" value={streaming.lruCapacity} min={64} max={1024} step={64} unit="" onChange={(v) => setStreaming({ lruCapacity: v })} docRef="主项目 1024" />

      <div className="pt-1 border-t border-white/5 space-y-1">
        <div className="text-[11px] text-gray-400">SubChunkCache 实时状态（16×16 子区块）</div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-400 transition-all"
            style={{ width: `${Math.min(100, (cache.size / Math.max(1, cache.capacity)) * 100)}%` }}
          />
        </div>
        <StatRow label="缓存占用" value={`${cache.size} / ${cache.capacity}`} />
        <StatRow label="命中 / 未命中" value={`${cache.hits} / ${cache.misses}`} />
        <StatRow label="命中率" value={`${Math.round(cache.hitRate * 100)}%`} tone={cache.hitRate > 0.8 ? 'ok' : 'warn'} />
        <StatRow label="累计淘汰" value={cache.evicted} />
      </div>

      <Hint>
        把「缓冲区半径」调到 0 并快速移动：未命中（直方图红桶）增多、跨区块有可见加载；调回 2 后预加载覆盖移动路径，命中率回升。
        把「LRU 容量」调到 64 并大规模巡游：淘汰数飙升，回退路径重新加载。
      </Hint>
    </div>
  );
};
