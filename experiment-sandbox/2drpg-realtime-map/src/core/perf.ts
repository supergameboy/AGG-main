/**
 * 性能指标采集器（镜像模块7 §2.1 PerformanceMetricsCollector）
 * - FPS：rAF 每秒采样（§3.2.1）
 * - 流式加载延迟：recordStreamLoad（§3.2.2，cacheHit 判定 durationMs < 1ms）
 * - 预生成命中率：由 PrefetchScheduler 统计 + 区块进入事件换算（§3.2.3）
 * - LLM 调用：mock 模式记录模拟耗时 + token 成本估算（§2.4.2 Instrumented 语义）
 */

export interface DurationStats { min: number; max: number; avg: number; p95: number; p99: number }
export interface StreamLoadSample { at: number; durationMs: number; cacheHit: boolean }
export interface LLMCallSample { at: number; durationMs: number; success: boolean; cost: number; tokens: number; chunkKey: string }

export interface PerfMetrics {
  startedAt: number;
  endedAt: number;
  fpsSeries: readonly { at: number; fps: number }[];
  fpsStats: DurationStats;
  streamSeries: readonly StreamLoadSample[];
  streamStats: DurationStats;
  streamCacheHitRate: number;
  llmCalls: readonly LLMCallSample[];
  llmTotalCost: number;
  errors: readonly string[];
}

function summarize(values: readonly number[]): DurationStats {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    p95: pick(0.95),
    p99: pick(0.99),
  };
}

/** token → 成本（USD）粗估：$3 / 1M tokens（GPT-4o 量级参考价） */
const COST_PER_TOKEN = 3 / 1_000_000;

export class PerfCollector {
  private collecting = false;
  private startedAt = 0;
  private fpsSeries: { at: number; fps: number }[] = [];
  private streamSeries: StreamLoadSample[] = [];
  private llmCalls: LLMCallSample[] = [];
  private errors: string[] = [];
  private frameCount = 0;
  private lastFpsTick = 0;
  private currentFps = 0;
  private static MAX_POINTS = 3600;

  isCollecting(): boolean { return this.collecting; }

  start(): void {
    this.collecting = true;
    this.startedAt = Date.now();
    this.fpsSeries = [];
    this.streamSeries = [];
    this.llmCalls = [];
    this.errors = [];
    this.frameCount = 0;
    this.lastFpsTick = performance.now();
  }

  /** 每帧调用（渲染循环驱动，模块7 §3.2.1） */
  tickFrame(): void {
    this.frameCount += 1;
    const now = performance.now();
    const elapsed = now - this.lastFpsTick;
    if (elapsed >= 1000) {
      this.currentFps = (this.frameCount * 1000) / elapsed;
      this.frameCount = 0;
      this.lastFpsTick = now;
      if (this.collecting) {
        this.fpsSeries.push({ at: Date.now(), fps: this.currentFps });
        if (this.fpsSeries.length > PerfCollector.MAX_POINTS) this.fpsSeries.shift();
      }
    }
  }

  getCurrentFps(): number { return this.currentFps; }

  recordStreamLoad(sample: StreamLoadSample): void {
    if (!this.collecting) return;
    this.streamSeries.push(sample);
    if (this.streamSeries.length > 10000) this.streamSeries.shift();
  }

  recordLLMCall(durationMs: number, success: boolean, tokens: number, chunkKey: string): void {
    if (!this.collecting) return;
    this.llmCalls.push({ at: Date.now(), durationMs, success, cost: tokens * COST_PER_TOKEN, tokens, chunkKey });
  }

  recordError(msg: string): void {
    if (!this.collecting) return;
    this.errors.push(msg);
  }

  finalize(): PerfMetrics {
    this.collecting = false;
    return this.snapshotMetrics();
  }

  snapshotMetrics(): PerfMetrics {
    const fpsValues = this.fpsSeries.map((s) => s.fps);
    const streamValues = this.streamSeries.map((s) => s.durationMs);
    const hits = this.streamSeries.filter((s) => s.cacheHit).length;
    return {
      startedAt: this.startedAt,
      endedAt: Date.now(),
      fpsSeries: [...this.fpsSeries],
      fpsStats: summarize(fpsValues),
      streamSeries: [...this.streamSeries],
      streamStats: summarize(streamValues),
      streamCacheHitRate: this.streamSeries.length === 0 ? 1 : hits / this.streamSeries.length,
      llmCalls: [...this.llmCalls],
      llmTotalCost: this.llmCalls.reduce((a, c) => a + c.cost, 0),
      errors: [...this.errors],
    };
  }
}

export const perfCollector = new PerfCollector();
