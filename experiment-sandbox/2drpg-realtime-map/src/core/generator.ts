/**
 * 地图生成器端口接口 + 生成器路由（镜像模块2 §3.3.5 GeneratorRouter）
 * - procedural：ProceduralMapGenerator（即时 <50ms，Perlin 噪声 + 实体分布，LLM 失败兜底）
 * - mock_llm：MockMapGenerator（模块7 §2.4.1 mock 模式，模拟 LLM 延迟 + 丰富地形，不消耗额度）
 * - auto：按 locationHint（区域类型）路由 —— city/quest/dungeon → mock_llm，wilderness → procedural
 */

import type { ChunkTileSlice, GeneratorKind, OutputFormat, RegionInfo } from '@/types/tile-map';
import type { NeighborBoundary } from './boundary-strategy';
import { generateProcedural } from './procedural-gen';
import { generateMockLLM, estimateTokens } from './mock-llm-gen';

export interface GenerationInput {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly chunkSize: number;
  readonly seed: number;
  readonly region: RegionInfo;
  /** 已 ready 邻居边界（context_aware 策略时非空） */
  readonly neighborBoundaries: readonly NeighborBoundary[];
  readonly outputFormat: OutputFormat;
  /** 模拟 LLM 延迟（ms，mock_llm 用） */
  readonly mockLlmLatencyMs: number;
  readonly onLog?: (line: string) => void;
}

export interface GenerationResult {
  readonly slice: ChunkTileSlice;
  readonly durationMs: number;
  readonly generatorType: 'llm' | 'procedural' | 'mock';
  readonly tokenUsage: { prompt: number; completion: number; total: number } | null;
  /** 附录E §2.4 增强：LLM 输出建筑物放置提示 */
  readonly placementHints: readonly { x: number; y: number; buildingType: string }[];
}

export interface IMapGenerator {
  readonly type: 'llm' | 'procedural' | 'mock';
  generate(input: GenerationInput): Promise<GenerationResult>;
}

class ProceduralGenerator implements IMapGenerator {
  readonly type = 'procedural' as const;
  async generate(input: GenerationInput): Promise<GenerationResult> {
    const t0 = performance.now();
    const slice = generateProcedural(input);
    return {
      slice,
      durationMs: performance.now() - t0,
      generatorType: 'procedural',
      tokenUsage: null,
      placementHints: [],
    };
  }
}

class MockLLMGenerator implements IMapGenerator {
  readonly type = 'mock' as const;
  async generate(input: GenerationInput): Promise<GenerationResult> {
    return generateMockLLM(input);
  }
}

const procedural = new ProceduralGenerator();
const mockLLM = new MockLLMGenerator();

/**
 * GeneratorRouter.selectGenerator（模块2 §3.3.5 选择规则）：
 * - 'llm'（沙箱 mock_llm）→ MockLLMGenerator
 * - 'procedural' → ProceduralMapGenerator
 * - 'auto' + locationHint ∈ {city, dungeon} → mock_llm；其余（wilderness）→ procedural
 */
export function selectGenerator(kind: GeneratorKind, regionType: string): IMapGenerator {
  if (kind === 'mock_llm') return mockLLM;
  if (kind === 'procedural') return procedural;
  // auto 路由
  return regionType === 'city' || regionType === 'dungeon' ? mockLLM : procedural;
}

export { estimateTokens };
export type { NeighborBoundary };
