/**
 * 性能报告生成器（镜像模块7 §2.3 PerformanceReportGenerator）
 * 7 章 Markdown：测试概述 / 配置 / FPS / 流式延迟 / 预生成 / LLM / 结论建议
 * ASCII 图表便于版本控制 diff（§2.3.3）。DecisionSnapshot 嵌入第 1 章（§2.2.2）。
 */

import type { PerfMetrics } from '@/core/perf';
import type { DecisionSnapshot } from '@/types/tile-map';
import type { SchedulerStats } from '@/core/scheduler';

function asciiLine(values: readonly number[], width: number, height: number, maxV: number): string {
  if (values.length === 0) return '（无数据）';
  const sampled = values.slice(-width);
  const rows: string[] = [];
  for (let r = height - 1; r >= 0; r -= 1) {
    let line = '';
    for (let i = 0; i < sampled.length; i += 1) {
      const v = sampled[i] / maxV;
      line += v * height > r ? '·' : ' ';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

export function generateReport(
  metrics: PerfMetrics,
  decisions: DecisionSnapshot,
  scheduler: SchedulerStats,
  scenario: string,
): string {
  const dur = ((metrics.endedAt - metrics.startedAt) / 1000).toFixed(1);
  const fps = metrics.fpsStats;
  const stream = metrics.streamStats;
  const p = (v: number) => v.toFixed(1);

  const prefetchRows = [0, 1, 2, 3]
    .map((pri) => {
      const b = scheduler.byPriority[pri];
      const rate = b.triggered === 0 ? '—' : `${Math.round((b.completed / b.triggered) * 100)}%`;
      return `| P${pri} | ${b.triggered} | ${b.completed} | ${rate} |`;
    })
    .join('\n');

  const llmSection =
    metrics.llmCalls.length === 0
      ? 'mock 模式未启用 LLM（模块7 §2.4.1：不消耗额度，仅测前端渲染链路）'
      : `| 指标 | 值 |
|------|-----|
| 调用次数 | ${metrics.llmCalls.length} |
| 平均耗时 | ${(metrics.llmCalls.reduce((a, c) => a + c.durationMs, 0) / metrics.llmCalls.length).toFixed(0)} ms |
| 总成本估算 | $${metrics.llmTotalCost.toFixed(4)} |
| 失败次数 | ${metrics.llmCalls.filter((c) => !c.success).length} |`;

  const conclusions: string[] = [];
  conclusions.push(fps.avg >= 55 ? `✅ 平均 FPS ${p(fps.avg)} 达标（目标 ≥55）` : `⚠️ 平均 FPS ${p(fps.avg)} 低于目标 55，建议降低规模或关闭光照`);
  conclusions.push(stream.p95 <= 50 ? `✅ 流式延迟 P95 ${p(stream.p95)}ms 达标（large 目标 <50ms）` : `⚠️ 流式延迟 P95 ${p(stream.p95)}ms 偏高，建议增大缓冲区或 LRU 容量`);
  const p0 = scheduler.byPriority[0];
  const p0Rate = p0.triggered === 0 ? 1 : p0.completed / p0.triggered;
  conclusions.push(p0Rate >= 0.9 ? `✅ P0 预生成命中率 ${Math.round(p0Rate * 100)}% 达标（目标 ≥90%）` : `⚠️ P0 命中率 ${Math.round(p0Rate * 100)}% 偏低，建议降低模拟 LLM 延迟或提高并发`);

  return `# 2DRPG 实时地图性能测试报告

> 生成时间：${new Date().toISOString()}
> 场景：${scenario}
> 沙箱：experiment-sandbox/2drpg-realtime-map（mock LLM 模式）

## 1. 测试概述

| 项 | 值 |
|----|-----|
| 采集时长 | ${dur}s |
| UserAgent | ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'} |

**决策快照（DecisionSnapshot）**：

| 决策点 | 选项 | 设计依据 |
|--------|------|---------|
| 渲染器 | ${decisions.rendererType} | 附录D §四 |
| 渲染风格 | ${decisions.renderStyle} | 附录D §5.2 |
| 边界策略 | ${decisions.boundaryStrategy} | 模块2 §3.4 |
| 边界美化 | ${decisions.boundarySmoothing} | 模块5 §2.1.5 |
| 内部方案 | ${decisions.interiorScheme} | 模块6 §2.2 |
| 区块大小 | ${decisions.chunkSize} | 附录E §三 |
| 生成器 | ${decisions.generatorKind} | 模块2 §3.3.5 |
| 输出格式 | ${decisions.outputFormat} | 模块2 §3.2 |
| 地图规模 | ${decisions.mapScale} | 模块7 §2.5 |

## 2. FPS 性能

| min | max | avg | p95 | p99 |
|-----|-----|-----|-----|-----|
| ${p(fps.min)} | ${p(fps.max)} | ${p(fps.avg)} | ${p(fps.p95)} | ${p(fps.p99)} |

\`\`\`
${asciiLine(metrics.fpsSeries.map((s) => s.fps), 60, 8, 70)}
\`\`\`

## 3. 流式加载延迟

| min | max | avg | p95 | p99 | 缓存命中率 |
|-----|-----|-----|-----|-----|-----------|
| ${p(stream.min)}ms | ${p(stream.max)}ms | ${p(stream.avg)}ms | ${p(stream.p95)}ms | ${p(stream.p99)}ms | ${Math.round(metrics.streamCacheHitRate * 100)}% |

## 4. 预生成调度（模块2 §3.3）

| 优先级 | 触发数 | 完成数 | 命中率 |
|--------|--------|--------|--------|
${prefetchRows}

## 5. LLM 调用（mock 模拟）

${llmSection}

## 6. 错误列表

${metrics.errors.length === 0 ? '（无）' : metrics.errors.map((e) => `- ${e}`).join('\n')}

## 7. 结论与建议

${conclusions.map((c) => `- ${c}`).join('\n')}

---
*报告由 PerformanceReportGenerator 生成（模块7 §2.3），决策分叉口完整记录便于 A/B 对比。*
`;
}
