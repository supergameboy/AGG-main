/**
 * 性能仪表盘分区（镜像模块7 §2.2 PerformanceDashboard）
 * - FPS 曲线 / 流式直方图 / 预生成命中率表 / LLM 调用列表（模块7 §2.2.1 五要素）
 * - 自动巡游（§3.2.5）+ S1-S8 测试场景预设（§2.5.5）
 * - 采集控制 + Markdown 报告下载（§2.3 + §2.2.4 操作流程）
 */

import React, { useEffect, useState } from 'react';
import { useConfigStore } from '@/stores/configStore';
import { useMapStore } from '@/stores/mapStore';
import { perfCollector, type LLMCallSample } from '@/core/perf';
import { FpsChart } from '../perf/FpsChart';
import { StreamHistogram } from '../perf/Histogram';
import { generateReport } from '../perf/report';
import { Segmented, StatRow, Hint } from './controls';

/** S1-S8 测试场景预设（模块7 §2.5.5 测试场景矩阵） */
interface ScenarioPreset {
  id: string;
  label: string;
  scale: 'small' | 'medium' | 'large';
  walk: boolean;
  duration: number;
  fast?: boolean;
}
const SCENARIOS: readonly ScenarioPreset[] = [
  { id: 'S1', label: 'S1 小·mock·静止', scale: 'small', walk: false, duration: 30 },
  { id: 'S2', label: 'S2 小·mock·巡游', scale: 'small', walk: true, duration: 60 },
  { id: 'S3', label: 'S3 中·mock·巡游', scale: 'medium', walk: true, duration: 60 },
  { id: 'S4', label: 'S4 大·mock·巡游', scale: 'large', walk: true, duration: 60 },
  { id: 'S8', label: 'S8 中·高频跨区块', scale: 'medium', walk: true, duration: 60, fast: true },
];

export const PerfSection: React.FC = () => {
  const autoWalk = useConfigStore((s) => s.autoWalk);
  const setAutoWalk = useConfigStore((s) => s.setAutoWalk);
  const setDecisions = useConfigStore((s) => s.setDecisions);
  const scheduler = useMapStore((s) => s.scheduler);
  const [collecting, setCollecting] = useState(false);
  const [llmCalls, setLlmCalls] = useState<readonly LLMCallSample[]>([]);
  const [scenario, setScenario] = useState<string>('手动采集');

  useEffect(() => {
    const timer = window.setInterval(() => setLlmCalls(perfCollector.snapshotMetrics().llmCalls.slice(-8)), 500);
    return () => window.clearInterval(timer);
  }, []);

  const applyScenario = (s: (typeof SCENARIOS)[number]) => {
    setDecisions({ mapScale: s.scale, generatorKind: 'mock_llm' });
    setAutoWalk({ enabled: s.walk, pattern: s.id === 'S8' ? 'zigzag' : autoWalk.pattern, speed: s.fast ? 10 : 5 });
    setScenario(`${s.label}（${s.duration}s）`);
    perfCollector.start();
    setCollecting(true);
    if (s.duration > 0) {
      window.setTimeout(() => {
        stopAndReport(s.label);
      }, s.duration * 1000);
    }
  };

  const stopAndReport = (label?: string) => {
    const metrics = perfCollector.finalize();
    setCollecting(false);
    const md = generateReport(metrics, useConfigStore.getState().decisions, scheduler, label ?? scenario);
    // 浏览器 Blob 下载（模块7 §2.2.4 步骤9；主项目落地时复制到 docs/performance/）
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `perf-report-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-2.5">
      <FpsChart />
      <StreamHistogram />

      <div className="rounded bg-black/30 p-2 space-y-1">
        <div className="text-[10px] text-gray-500 mb-1">预生成命中率（模块7 §2.5.4 目标）</div>
        {[0, 1, 3].map((p) => {
          const b = scheduler.byPriority[p];
          const rate = b.triggered === 0 ? null : b.completed / b.triggered;
          const target = p === 0 ? 0.9 : p === 1 ? 0.75 : 0.5;
          return (
            <StatRow
              key={p}
              label={`P${p}（目标 ≥${Math.round(target * 100)}%）`}
              value={rate === null ? '—' : `${b.completed}/${b.triggered} · ${Math.round(rate * 100)}%`}
              tone={rate === null ? 'plain' : rate >= target ? 'ok' : 'warn'}
            />
          );
        })}
      </div>

      <div className="rounded bg-black/30 p-2 space-y-1">
        <div className="text-[10px] text-gray-500">LLM 调用（mock 模拟，real 模式主项目落地）</div>
        {llmCalls.length === 0 && <div className="text-[10px] text-gray-600">（暂无调用 —— 切换生成器为 mock_llm 后移动触发）</div>}
        {llmCalls.map((c, i) => (
          <div key={i} className="flex justify-between text-[10px] font-mono text-gray-400">
            <span>{c.chunkKey}</span>
            <span>{c.durationMs.toFixed(0)}ms · {(c.tokens / 1000).toFixed(1)}K tok · ${c.cost.toFixed(4)}</span>
          </div>
        ))}
      </div>

      <div className="pt-1 border-t border-white/5 space-y-2">
        <div className="text-[11px] text-gray-400">自动巡游（AutoWalkController §3.2.5）</div>
        <Segmented
          label="路径模式"
          value={autoWalk.pattern}
          onChange={(v) => setAutoWalk({ pattern: v as typeof autoWalk.pattern })}
          options={[
            { value: 'zigzag', label: '之字形', hint: '验证跨区块流式加载' },
            { value: 'spiral', label: '螺旋', hint: '验证大范围探索' },
            { value: 'random', label: '随机', hint: '模拟真实玩家' },
          ]}
        />
        <div className="flex gap-1.5">
          <button
            className={`flex-1 px-2 py-1.5 rounded text-[11px] border ${autoWalk.enabled ? 'bg-red-500/20 border-red-500/50 text-red-200' : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'}`}
            onClick={() => setAutoWalk({ enabled: !autoWalk.enabled })}
          >
            {autoWalk.enabled ? '⏹ 停止巡游' : '▶ 开始巡游'}
          </button>
          <select
            className="bg-white/5 border border-white/10 rounded text-[11px] px-1.5 text-gray-300"
            value={autoWalk.speed}
            onChange={(e) => setAutoWalk({ speed: Number(e.target.value) })}
          >
            {[3, 5, 8, 10].map((v) => (
              <option key={v} value={v}>{v} 瓦片/s</option>
            ))}
          </select>
        </div>
      </div>

      <div className="pt-1 border-t border-white/5 space-y-1.5">
        <div className="text-[11px] text-gray-400">测试场景预设（模块7 §2.5.5）</div>
        <div className="grid grid-cols-2 gap-1">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className="px-1.5 py-1 rounded bg-white/5 border border-white/10 text-[10px] text-gray-300 hover:bg-purple-500/20 hover:border-purple-500/40"
              onClick={() => applyScenario(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {!collecting ? (
            <button
              className="flex-1 px-2 py-1.5 rounded bg-purple-500/25 border border-purple-400/50 text-purple-100 text-[11px]"
              onClick={() => {
                setScenario('手动采集');
                perfCollector.start();
                setCollecting(true);
              }}
            >
              ● 开始性能采集
            </button>
          ) : (
            <button className="flex-1 px-2 py-1.5 rounded bg-amber-500/25 border border-amber-400/50 text-amber-100 text-[11px]" onClick={() => stopAndReport()}>
              ⏹ 停止并生成报告 ↓
            </button>
          )}
        </div>
      </div>

      <Hint>报告含决策快照 + ASCII 图表，自动下载 .md。流程：选场景 S2 → 自动巡游 60s → 自动出报告，与 S4（大规模）对比即可评估规模影响。</Hint>
    </div>
  );
};
