/**
 * 调度与结果池分区（模块2 §3.3 PrefetchScheduler + 模块4 §2.1 结果池）
 * P0-P3 触发开关与实时计数、并发、方向阈值、模拟 LLM 延迟、实时队列、命中率
 */

import React from 'react';
import { useConfigStore } from '@/stores/configStore';
import { useMapStore } from '@/stores/mapStore';
import { SliderRow, ToggleRow, StatRow, Hint } from './controls';
import { engine } from '@/stores/engine-instance';

export const SchedulerSection: React.FC = () => {
  const knobs = useConfigStore((s) => s.scheduler);
  const setScheduler = useConfigStore((s) => s.setScheduler);
  const stats = useMapStore((s) => s.scheduler);
  const pool = useMapStore((s) => s.pool);

  const hitRate = (p: number) => {
    const b = stats.byPriority[p];
    return b.triggered === 0 ? '—' : `${Math.round((b.completed / b.triggered) * 100)}%`;
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded bg-white/5 border border-white/10 p-1.5 text-center">
          <div className="text-[10px] text-gray-500">P0 邻居</div>
          <ToggleRow label="" checked={knobs.enabledP0} onChange={(v) => setScheduler({ enabledP0: v })} />
          <div className="text-[10px] font-mono text-emerald-400 mt-0.5">{stats.byPriority[0].completed}/{stats.byPriority[0].triggered} · {hitRate(0)}</div>
        </div>
        <div className="rounded bg-white/5 border border-white/10 p-1.5 text-center">
          <div className="text-[10px] text-gray-500">P1 方向预测</div>
          <ToggleRow label="" checked={knobs.enabledP1} onChange={(v) => setScheduler({ enabledP1: v })} />
          <div className="text-[10px] font-mono text-emerald-400 mt-0.5">{stats.byPriority[1].completed}/{stats.byPriority[1].triggered} · {hitRate(1)}</div>
        </div>
        <div className="rounded bg-white/5 border border-white/10 p-1.5 text-center">
          <div className="text-[10px] text-gray-500">P3 对角线</div>
          <ToggleRow label="" checked={knobs.enabledP3} onChange={(v) => setScheduler({ enabledP3: v })} />
          <div className="text-[10px] font-mono text-emerald-400 mt-0.5">{stats.byPriority[3].completed}/{stats.byPriority[3].triggered} · {hitRate(3)}</div>
        </div>
      </div>

      <SliderRow label="并发生成数" value={knobs.maxConcurrent} min={1} max={3} step={1} onChange={(v) => setScheduler({ maxConcurrent: v })} docRef="模块2 §3.3.3 默认 1" />
      <SliderRow label="P1 连续步数阈值" value={knobs.directionThreshold} min={2} max={5} step={1} unit=" 步" onChange={(v) => setScheduler({ directionThreshold: v })} docRef="§4.2.2" />
      <SliderRow label="模拟 LLM 延迟" value={knobs.mockLlmLatencyMs} min={200} max={10000} step={100} unit=" ms" onChange={(v) => setScheduler({ mockLlmLatencyMs: v })} docRef="真实 5-15s" />

      <div className="pt-1 border-t border-white/5 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400">实时队列（双层去重 §3.3.9）</span>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
            onClick={() => engine.cancelScheduler()}
          >
            cancelAll
          </button>
        </div>
        <StatRow label="队列 / 处理中" value={`${stats.queueSize} / ${stats.inFlight}`} />
        <StatRow label="触发 / 成功 / 失败" value={`${stats.totalTriggered} / ${stats.totalSucceeded} / ${stats.totalFailed}`} tone={stats.totalFailed > 0 ? 'warn' : 'ok'} />
        <div className="max-h-20 overflow-y-auto sb-scroll rounded bg-black/30 p-1.5 space-y-0.5">
          {stats.queue.length === 0 && <div className="text-[10px] text-gray-600">（队列空）</div>}
          {stats.queue.slice(0, 12).map((q) => (
            <div key={q.dedupeKey} className="flex justify-between text-[10px] font-mono text-gray-400">
              <span>P{q.priority} · chunk({q.chunkX},{q.chunkY})</span>
              <span className="text-gray-600">{q.triggerType}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-1 border-t border-white/5 space-y-1">
        <div className="text-[11px] text-gray-400">结果池 map_pool（模块4 §2.1.2）</div>
        <StatRow label="pending / consumed / expired" value={`${pool.mapPending} / ${pool.mapConsumed} / ${pool.mapExpired}`} />
        <StatRow label="命中 / 未命中" value={`${pool.hits} / ${pool.misses}`} />
        <StatRow label="命中率" value={`${Math.round((pool.hits / Math.max(1, pool.hits + pool.misses)) * 100)}%`} tone={pool.hits >= pool.misses ? 'ok' : 'warn'} />
      </div>

      <Hint>调低「模拟 LLM 延迟」→ P0 命中率逼近 100%；拉高到 8s 并快速移动 → 玩家将撞上「未知领域」占位（map_pool 未命中 → 实时生成兜底）。</Hint>
    </div>
  );
};
