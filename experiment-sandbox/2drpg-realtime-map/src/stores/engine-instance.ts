/**
 * 引擎装配（组合根语义，对应主项目 init.ts 的组合根模式）
 * WorldEngine 为 React 外单例；Zustand store 通过 registerEngineNotify 订阅快照刷新。
 */

import { WorldEngine, type WorldConfig } from '@/core/world';
import { DEFAULT_DECISIONS } from '@/types/tile-map';

export function buildDefaultConfig(): WorldConfig {
  return {
    decisions: { ...DEFAULT_DECISIONS },
    seed: 20260729,
    buildingDensity: 0.55,
    moveTilesPerSec: 5,
    fovRadius: 6,
    fogMode: 'fog',
    scheduler: {
      enabledP0: true,
      enabledP1: true,
      enabledP3: true,
      maxConcurrent: 1,
      directionThreshold: 3,
      generatorKind: DEFAULT_DECISIONS.generatorKind,
      outputFormat: DEFAULT_DECISIONS.outputFormat,
      mockLlmLatencyMs: 2500,
    },
    streamLatencyMs: 120,
    bufferRadius: 2,
    evictThreshold: 4,
    lruCapacity: 256,
    autoWalk: { enabled: false, pattern: 'zigzag', speed: 5 },
  };
}

let notifyCb: () => void = () => {};

export function registerEngineNotify(cb: () => void): void {
  notifyCb = cb;
}

export const engine = new WorldEngine(buildDefaultConfig(), () => notifyCb());

// 沙箱调试句柄（仅 dev 构建存在，build 时 tree-shake；供浏览器自动化验证传送/进建筑）
if (import.meta.env.DEV) {
  (window as unknown as { __engine: WorldEngine }).__engine = engine;
}
