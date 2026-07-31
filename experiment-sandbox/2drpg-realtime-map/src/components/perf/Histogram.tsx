/**
 * 流式加载延迟直方图（镜像模块7 §2.2.1：按耗时区间分桶 <1ms / <10ms / <100ms / >100ms）
 */

import React, { useEffect, useState } from 'react';
import { perfCollector } from '@/core/perf';

const BUCKETS = [
  { label: '<1ms 缓存命中', max: 1, color: '#34d399' },
  { label: '<10ms', max: 10, color: '#a3e635' },
  { label: '<100ms', max: 100, color: '#fbbf24' },
  { label: '>100ms 实时生成', max: Infinity, color: '#ef4444' },
];

export const StreamHistogram: React.FC = () => {
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0]);
  const [hitRate, setHitRate] = useState(1);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const m = perfCollector.snapshotMetrics();
      const c = [0, 0, 0, 0];
      m.streamSeries.forEach((s) => {
        const idx = BUCKETS.findIndex((b) => s.durationMs < b.max);
        c[idx === -1 ? 3 : idx] += 1;
      });
      setCounts(c);
      setHitRate(m.streamCacheHitRate);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const max = Math.max(1, ...counts);

  return (
    <div className="rounded bg-black/30 p-2 space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-gray-500">流式加载延迟分布</span>
        <span className="text-[10px] font-mono text-emerald-400">命中率 {(hitRate * 100).toFixed(0)}%</span>
      </div>
      {BUCKETS.map((b, i) => (
        <div key={b.label} className="flex items-center gap-1.5">
          <span className="text-[9px] text-gray-500 w-24 shrink-0">{b.label}</span>
          <div className="flex-1 h-2.5 bg-white/5 rounded-sm overflow-hidden">
            <div className="h-full rounded-sm transition-all" style={{ width: `${(counts[i] / max) * 100}%`, background: b.color }} />
          </div>
          <span className="text-[9px] font-mono text-gray-400 w-7 text-right">{counts[i]}</span>
        </div>
      ))}
    </div>
  );
};
