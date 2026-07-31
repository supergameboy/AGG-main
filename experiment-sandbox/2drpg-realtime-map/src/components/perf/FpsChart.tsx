/**
 * FPS 实时曲线（镜像模块7 §2.2.1：SVG 折线图，最近 60 秒窗口）
 */

import React, { useEffect, useState } from 'react';
import { perfCollector } from '@/core/perf';

export const FpsChart: React.FC = () => {
  const [series, setSeries] = useState<readonly { at: number; fps: number }[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeries(perfCollector.snapshotMetrics().fpsSeries.slice(-60));
      setCurrent(perfCollector.getCurrentFps());
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const W = 220;
  const H = 48;
  const max = 70;
  const points = series.map((s, i) => {
    const x = (i / Math.max(1, series.length - 1)) * W;
    const y = H - Math.min(1, s.fps / max) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="rounded bg-black/30 p-2">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] text-gray-500">FPS（60s 窗口）</span>
        <span className={`text-sm font-mono font-bold ${current >= 55 ? 'text-emerald-400' : current >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
          {current.toFixed(0)}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
        <line x1="0" y1={H - (60 / max) * H} x2={W} y2={H - (60 / max) * H} stroke="rgba(52,211,153,0.3)" strokeDasharray="3 3" />
        <line x1="0" y1={H - (30 / max) * H} x2={W} y2={H - (30 / max) * H} stroke="rgba(239,68,68,0.3)" strokeDasharray="3 3" />
        {points.length > 1 && <polyline points={points.join(' ')} fill="none" stroke="#a78bfa" strokeWidth="1.5" />}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
        <span>60 目标线</span>
        <span>30 警戒线</span>
      </div>
    </div>
  );
};
