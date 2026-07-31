/**
 * 事件日志分区（附录B 事件清单实时流）
 * 34 类事件的沙箱子集：chunk.* / prefetch.* / player.* / result_pool.* / building.* / tile_event.* / narrative.push
 */

import React, { useEffect, useState } from 'react';
import { EventBus, type GameEvent } from '@/core/events';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'chunk', label: '区块' },
  { value: 'prefetch', label: '调度' },
  { value: 'player', label: '玩家' },
  { value: 'result_pool', label: '结果池' },
  { value: 'building', label: '建筑' },
  { value: 'narrative', label: '叙事' },
] as const;

const TYPE_COLOR: Record<string, string> = {
  'chunk.ready': 'text-emerald-400',
  'chunk.failed': 'text-red-400',
  'chunk.status_changed': 'text-amber-400',
  'prefetch.scheduled': 'text-sky-400',
  'prefetch.completed': 'text-sky-300',
  'player.cross_region': 'text-fuchsia-400',
  'player.cross_chunk': 'text-gray-400',
  'result_pool.hit': 'text-emerald-300',
  'result_pool.miss': 'text-amber-300',
  'building.entered': 'text-purple-300',
  'building.exited': 'text-purple-400',
  'building.placed': 'text-violet-400',
  'zlayer.changed': 'text-indigo-300',
  'tile_event.triggered': 'text-rose-300',
  'narrative.push': 'text-teal-300',
  'renderer.note': 'text-gray-500',
};

function summarize(e: GameEvent): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case 'chunk.ready': return `chunk(${p.chunkX},${p.chunkY}) ${p.generatedBy} ${Number(p.durationMs).toFixed(0)}ms`;
    case 'chunk.failed': return `chunk(${p.chunkX},${p.chunkY}) ${p.failureReason}`;
    case 'prefetch.scheduled': return `P${String(p.priority).replace('P', '')} chunk(${p.chunkX},${p.chunkY}) ← ${p.trigger}`;
    case 'prefetch.completed': return `chunk(${p.chunkX},${p.chunkY}) ${p.success ? '✓' : '✗'} ${Number(p.durationMs).toFixed(0)}ms`;
    case 'player.cross_region': return `→ ${p.toRegionName}`;
    case 'player.cross_chunk': return `(${JSON.stringify(p.toChunk)})`;
    case 'result_pool.hit': return `map_pool 命中 ${p.key}`;
    case 'result_pool.miss': return `map_pool 未命中 ${p.key} → ${p.fallbackAction}`;
    case 'building.placed': return `${p.buildingType} @ chunk(${p.chunkX},${p.chunkY})`;
    case 'building.entered': return `方案${p.scheme} 进入 ${p.buildingId}`;
    case 'building.exited': return `退出 ${p.buildingId}`;
    case 'zlayer.changed': return `Z ${p.fromZ} → ${p.toZ}（${p.trigger}）`;
    case 'tile_event.triggered': return `${p.eventType} @ (${(p.position as { x: number; y: number }).x},${(p.position as { x: number; y: number }).y})`;
    case 'narrative.push': return String(p.text).slice(0, 42);
    case 'renderer.note': return String(p.line).slice(0, 48);
    default: return JSON.stringify(p).slice(0, 48);
  }
}

export const EventLogSection: React.FC = () => {
  const [events, setEvents] = useState<readonly GameEvent[]>([]);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    const update = () => setEvents([...EventBus.getRecent()].reverse());
    const off = EventBus.on('*', update);
    const timer = window.setInterval(update, 1000);
    update();
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, []);

  const filtered = events.filter((e) => filter === 'all' || e.type.startsWith(filter));

  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-1.5 py-0.5 rounded text-[10px] border ${filter === f.value ? 'bg-purple-500/25 border-purple-400/50 text-purple-100' : 'bg-white/5 border-white/10 text-gray-500'}`}
          >
            {f.label}
          </button>
        ))}
        <button className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 text-gray-500" onClick={() => EventBus.clearRecent()}>
          清空
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto sb-scroll rounded bg-black/30 p-1.5 space-y-0.5 font-mono">
        {filtered.length === 0 && <div className="text-[10px] text-gray-600 p-1">（暂无事件 —— 移动/跨区块/进建筑触发）</div>}
        {filtered.slice(0, 80).map((e, i) => (
          <div key={`${e.at}-${i}`} className="flex gap-2 text-[10px] leading-4">
            <span className="text-gray-600 shrink-0">{new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <span className={`shrink-0 ${TYPE_COLOR[e.type] ?? 'text-gray-400'}`}>{e.type}</span>
            <span className="text-gray-500 truncate">{summarize(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
