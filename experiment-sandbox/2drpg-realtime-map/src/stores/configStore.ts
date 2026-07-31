/**
 * 配置 Store（控制面板各分区唯一数据源）
 * 所有旋钮 → 即时写入 WorldEngine（热更新），对应主项目 Profile YAML 的运行时等价物。
 */

import { create } from 'zustand';
import type { DecisionSnapshot } from '@/types/tile-map';
import { DEFAULT_DECISIONS } from '@/types/tile-map';
import { engine } from './engine-instance';
import type { RenderViewConfig } from '@/render/Canvas2DRenderer';
import { DEFAULT_ATLAS_STYLE } from '@/render/atlas-manifest';

export interface SchedulerKnobs {
  enabledP0: boolean;
  enabledP1: boolean;
  enabledP3: boolean;
  maxConcurrent: number;
  directionThreshold: number;
  mockLlmLatencyMs: number;
}

export interface StreamingKnobs {
  streamLatencyMs: number;
  bufferRadius: number;
  evictThreshold: number;
  lruCapacity: number;
}

export interface WorldKnobs {
  seed: number;
  buildingDensity: number;
  moveTilesPerSec: number;
  fovRadius: number;
}

export interface AutoWalkKnobs {
  enabled: boolean;
  pattern: 'zigzag' | 'spiral' | 'random';
  speed: number;
}

interface ConfigState {
  decisions: DecisionSnapshot;
  render: Omit<RenderViewConfig, 'style' | 'boundarySmoothing' | 'freeCamX' | 'freeCamY'> & {
    freeCamX: number;
    freeCamY: number;
    /** 图集风格 id（协议 v3 §10 多风格切换；atlas-manifest.ts ATLAS_STYLES 注册表） */
    atlasStyle: string;
  };
  scheduler: SchedulerKnobs;
  streaming: StreamingKnobs;
  world: WorldKnobs;
  autoWalk: AutoWalkKnobs;

  setDecisions: (patch: Partial<DecisionSnapshot>) => void;
  setRender: (patch: Partial<ConfigState['render']>) => void;
  setScheduler: (patch: Partial<SchedulerKnobs>) => void;
  setStreaming: (patch: Partial<StreamingKnobs>) => void;
  setWorld: (patch: Partial<WorldKnobs>) => void;
  setAutoWalk: (patch: Partial<AutoWalkKnobs>) => void;
  regenerateWorld: () => void;
}

/** 将 store 状态映射为引擎配置（DecisionSnapshot → scheduler 联动：模块2 §3.3.5 生成器路由由决策点驱动） */
function applyToEngine(s: Pick<ConfigState, 'decisions' | 'scheduler' | 'streaming' | 'world' | 'autoWalk'>): void {
  engine.updateConfig({
    decisions: s.decisions,
    seed: s.world.seed,
    buildingDensity: s.world.buildingDensity,
    moveTilesPerSec: s.world.moveTilesPerSec,
    fovRadius: s.world.fovRadius,
    scheduler: {
      enabledP0: s.scheduler.enabledP0,
      enabledP1: s.scheduler.enabledP1,
      enabledP3: s.scheduler.enabledP3,
      maxConcurrent: s.scheduler.maxConcurrent,
      directionThreshold: s.scheduler.directionThreshold,
      generatorKind: s.decisions.generatorKind,
      outputFormat: s.decisions.outputFormat,
      mockLlmLatencyMs: s.scheduler.mockLlmLatencyMs,
    },
    streamLatencyMs: s.streaming.streamLatencyMs,
    bufferRadius: s.streaming.bufferRadius,
    evictThreshold: s.streaming.evictThreshold,
    lruCapacity: s.streaming.lruCapacity,
    autoWalk: s.autoWalk,
  });
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  decisions: { ...DEFAULT_DECISIONS },
  render: {
    zoom: 1,
    cameraLocked: true,
    fogMode: 'fog',
    ambientLight: 0.55,
    dayNight: false,
    torchOn: true,
    torchRadius: 6,
    autoTile: true,
    spriteMode: 'procedural',
    showChunkGrid: false,
    freeCamX: 0,
    freeCamY: 0,
    atlasStyle: DEFAULT_ATLAS_STYLE,
  },
  scheduler: { enabledP0: true, enabledP1: true, enabledP3: true, maxConcurrent: 1, directionThreshold: 3, mockLlmLatencyMs: 2500 },
  streaming: { streamLatencyMs: 120, bufferRadius: 2, evictThreshold: 4, lruCapacity: 256 },
  world: { seed: 20260729, buildingDensity: 0.55, moveTilesPerSec: 5, fovRadius: 6 },
  autoWalk: { enabled: false, pattern: 'zigzag', speed: 5 },

  setDecisions: (patch) => {
    set((s) => ({ decisions: { ...s.decisions, ...patch } }));
    applyToEngine(get());
  },
  setRender: (patch) => set((s) => ({ render: { ...s.render, ...patch } })),
  setScheduler: (patch) => {
    set((s) => ({ scheduler: { ...s.scheduler, ...patch } }));
    applyToEngine(get());
  },
  setStreaming: (patch) => {
    set((s) => ({ streaming: { ...s.streaming, ...patch } }));
    applyToEngine(get());
  },
  setWorld: (patch) => {
    set((s) => ({ world: { ...s.world, ...patch } }));
    applyToEngine(get());
  },
  setAutoWalk: (patch) => {
    set((s) => ({ autoWalk: { ...s.autoWalk, ...patch } }));
    engine.setAutoWalk(get().autoWalk.enabled, get().autoWalk.pattern, get().autoWalk.speed);
  },
  regenerateWorld: () => {
    engine.regenerateWorld();
  },
}));
