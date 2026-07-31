/**
 * Mock LLM 地图生成器（镜像模块7 §2.4.1 MockMapGenerator + 模块2 MapGridAgent 输出质量模拟）
 * 定位：不消耗 LLM 额度，模拟真实 LLM 的三项特征：
 * 1. 生成延迟（配置驱动，控制面板"模拟 LLM 延迟"）
 * 2. 更丰富地形（河流贯通 / 道路联网 / 村庄聚合 —— 程序化生成器不具备）
 * 3. token 消耗估算（ATL vs JSON 双格式，模块2 §3.2：ATL 节省约 60% token）
 */

import type { ChunkTileSlice, MapEntity, OutputFormat, TileType } from '@/types/tile-map';
import { TILE_PROPERTIES } from '@/types/tile-map';
import { biomeAt, scatterEntities } from './procedural-gen';
import { createRng } from './noise';
import type { GenerationInput, GenerationResult } from './generator';

/** ATL/JSON token 估算（模块2 §3.2.1：字符图比 JSON 节省约 60% token） */
export function estimateTokens(chunkSize: number, entityCount: number, format: OutputFormat): { prompt: number; completion: number; total: number } {
  const tiles = chunkSize * chunkSize;
  const atlCompletion = Math.round(tiles * 1.05 + entityCount * 12 + 200);
  const jsonCompletion = Math.round(tiles * 2.6 + entityCount * 40 + 400);
  const completion = format === 'atl' ? atlCompletion : jsonCompletion;
  const prompt = format === 'atl' ? 1400 : 900; // ATL 需语法说明段，Prompt 更长
  return { prompt, completion, total: prompt + completion };
}

/** 河流刻画：正弦主河道横穿区块（context_aware 时对齐邻居河道出口） */
function carveRiver(tiles: TileType[][], input: GenerationInput, rng: () => number): void {
  const { chunkSize } = input;
  const hasRiver = rng() < 0.55;
  if (!hasRiver) return;

  // 西邻居有河道出口 → 河道从其出口延续；否则随机起点
  const west = input.neighborBoundaries.find((n) => n.direction === 'west' && n.ready);
  const startY = west && west.roadExits.length > 0 ? Math.floor(chunkSize / 2) : Math.floor(rng() * chunkSize);
  const phase = rng() * Math.PI * 2;
  const amplitude = 3 + rng() * (chunkSize / 8);

  for (let x = 0; x < chunkSize; x += 1) {
    const cy = Math.floor(startY + Math.sin((x / chunkSize) * Math.PI * 2 + phase) * amplitude * (x / chunkSize));
    const width = 1 + (rng() < 0.3 ? 1 : 0);
    for (let w = -width; w <= width; w += 1) {
      const y = cy + w;
      if (y >= 0 && y < chunkSize) tiles[y][x] = 'water';
    }
    // 河岸沙滩
    for (const y of [cy - width - 1, cy + width + 1]) {
      if (y >= 0 && y < chunkSize && tiles[y][x] === 'grass') tiles[y][x] = 'sand';
    }
  }
}

/** 道路网络：连接区块四边出口（context_aware 时优先对齐邻居道路） */
function carveRoads(tiles: TileType[][], input: GenerationInput, rng: () => number): void {
  const { chunkSize, neighborBoundaries } = input;
  const mid = Math.floor(chunkSize / 2);

  // 确定本区块四边道路出口：邻居有路则对齐，否则按 seed 定
  const exitFor = (dir: 'north' | 'south' | 'east' | 'west'): number | null => {
    const nb = neighborBoundaries.find((n) => n.direction === dir && n.ready);
    if (nb && nb.roadExits.length > 0) return nb.roadExits[Math.floor(nb.roadExits.length / 2)];
    return rng() < 0.55 ? Math.floor(chunkSize * (0.3 + rng() * 0.4)) : null;
  };

  const westExit = exitFor('west');
  const eastExit = exitFor('east');
  const northExit = exitFor('north');
  const southExit = exitFor('south');

  const setRoad = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= chunkSize || y >= chunkSize) return;
    const t = tiles[y][x];
    if (t === 'water') tiles[y][x] = 'bridge'; // 过桥（附录A water_cross）
    else if (TILE_PROPERTIES[t].walkable) tiles[y][x] = 'road';
  };

  // 东西向主路
  if (westExit !== null || eastExit !== null) {
    const y = westExit ?? eastExit ?? mid;
    for (let x = 0; x < chunkSize; x += 1) setRoad(x, y);
  }
  // 南北向主路
  if (northExit !== null || southExit !== null) {
    const x = northExit ?? southExit ?? mid;
    for (let y = 0; y < chunkSize; y += 1) setRoad(x, y);
  }
}

/** 村庄聚合：道路交汇处生成建筑物放置提示（附录E §2.4 building_placement_hints） */
function villageHints(tiles: TileType[][], input: GenerationInput, rng: () => number): { x: number; y: number; buildingType: string }[] {
  const { chunkSize, region } = input;
  if (region.regionType !== 'city' && rng() < 0.5) return [];
  const hints: { x: number; y: number; buildingType: string }[] = [];
  const mid = Math.floor(chunkSize / 2);
  const types = ['house', 'shop', 'tavern', 'tower'];
  const count = region.regionType === 'city' ? 3 : 1 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i += 1) {
    const x = mid + Math.floor((rng() - 0.5) * chunkSize * 0.4);
    const y = mid + Math.floor((rng() - 0.5) * chunkSize * 0.4);
    if (x > 2 && y > 2 && x < chunkSize - 6 && y < chunkSize - 6 && TILE_PROPERTIES[tiles[y][x]].walkable) {
      hints.push({ x, y, buildingType: types[Math.floor(rng() * types.length)] });
    }
  }
  return hints;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function generateMockLLM(input: GenerationInput): Promise<GenerationResult> {
  const { chunkX, chunkY, chunkSize, seed, region, outputFormat, mockLlmLatencyMs, onLog } = input;
  const t0 = performance.now();
  const rng = createRng(seed ^ (chunkX * 2654435761) ^ (chunkY * 40503) ^ 0x9e3779b9);
  const log = (s: string) => onLog?.(s);

  // —— 模拟 MapGridAgent 编排流程（模块2 §3.1.3）——
  log(`[MapGridAgent] 构造 Prompt（${outputFormat.toUpperCase()} 格式，区域=${region.regionName}）`);
  await delay(mockLlmLatencyMs * 0.15);
  log(`[LLMService.stream] 流式生成中…（模拟延迟 ${mockLlmLatencyMs}ms）`);

  // 基础地形（复用程序化噪声基底，模拟 LLM 的区域上下文理解）
  const tiles: TileType[][] = [];
  for (let y = 0; y < chunkSize; y += 1) {
    const row: TileType[] = [];
    for (let x = 0; x < chunkSize; x += 1) {
      row.push(biomeAt(chunkX * chunkSize + x, chunkY * chunkSize + y, region.regionType, seed));
    }
    tiles.push(row);
  }

  await delay(mockLlmLatencyMs * 0.35);
  carveRiver(tiles, input, rng);
  log('[MapGridAgent] 地形细化：河流刻画完成');
  await delay(mockLlmLatencyMs * 0.2);
  carveRoads(tiles, input, rng);
  log('[MapGridAgent] 地形细化：道路网络完成');
  const hints = villageHints(tiles, input, rng);

  await delay(mockLlmLatencyMs * 0.2);
  // 实体（LLM 倾向更密集 + 含建筑占位）
  const entities: MapEntity[] = scatterEntities(tiles, chunkX, chunkY, chunkSize, seed, 0.02);
  hints.forEach((h, i) => {
    entities.push({
      id: `b_hint_${chunkX}_${chunkY}_${i}`,
      type: 'building',
      x: chunkX * chunkSize + h.x,
      y: chunkY * chunkSize + h.y,
      entityRefId: h.buildingType,
      spriteId: null,
      interactable: true,
      visible: true,
      state: null,
    });
  });

  // —— TileMapValidator 三维校验模拟（模块2 §3.2.3）——
  log('[TileMapValidator] Parsable ✓ Logical ✓ Mappable ✓');
  await delay(mockLlmLatencyMs * 0.1);

  const tokens = estimateTokens(chunkSize, entities.length, outputFormat);
  log(`[MapGridAgent] 完成，token 估算：prompt=${tokens.prompt} completion=${tokens.completion}`);

  const slice: ChunkTileSlice = {
    chunkId: `chunk_${chunkX}_${chunkY}`,
    chunkX,
    chunkY,
    tiles,
    entities,
    regionId: region.regionId,
  };
  return {
    slice,
    durationMs: performance.now() - t0,
    generatorType: 'mock',
    tokenUsage: tokens,
    placementHints: hints,
  };
}
