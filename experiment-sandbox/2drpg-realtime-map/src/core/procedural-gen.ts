/**
 * 程序化地图生成器（镜像模块2 §3.3.8 ProceduralMapGenerator：Perlin 噪声 + 实体分布）
 * 定位：LLM 失败兜底 / 野外区块（auto 路由下 wilderness 区域）。
 * 目标性能：单区块 <50ms（模块6 §3.4 对齐）。
 */

import type { ChunkTileSlice, MapEntity, RegionType, TileType } from '@/types/tile-map';
import { TILE_PROPERTIES } from '@/types/tile-map';
import { fbm2, createRng } from './noise';
import type { GenerationInput } from './generator';
import { dominantTerrain } from './boundary-strategy';

/** 区域类型 → 地形基调（阈值映射见 biomeAt） */
const REGION_BIOME: Readonly<Record<RegionType, { base: TileType; rough: TileType; wet: TileType; hot?: TileType }>> = {
  forest: { base: 'grass', rough: 'forest', wet: 'water' },
  plain: { base: 'grass', rough: 'forest', wet: 'water' },
  desert: { base: 'sand', rough: 'mountain', wet: 'water', hot: 'sand' },
  mountain: { base: 'grass', rough: 'mountain', wet: 'water' },
  water: { base: 'sand', rough: 'grass', wet: 'water' },
  city: { base: 'grass', rough: 'forest', wet: 'water' },
  dungeon: { base: 'grass', rough: 'mountain', wet: 'lava' },
  cave: { base: 'grass', rough: 'mountain', wet: 'water' },
};

/** 单瓦片地形判定（fbm 高度 + 湿度 + 温度三通道） */
export function biomeAt(wx: number, wy: number, region: RegionType, seed: number): TileType {
  const biome = REGION_BIOME[region] ?? REGION_BIOME.plain;
  const e = fbm2(wx * 0.045, wy * 0.045, seed); // 高度
  const m = fbm2(wx * 0.06 + 1000, wy * 0.06 + 1000, seed + 7); // 湿度
  if (region === 'water') {
    if (e < 0.05) return 'water';
    if (e < 0.18) return 'sand';
    return m > 0.35 ? 'forest' : 'grass';
  }
  if (region === 'desert') {
    if (e > 0.52) return 'mountain';
    if (m > 0.62) return 'water'; // 绿洲
    if (m > 0.5) return 'grass';
    return 'sand';
  }
  if (region === 'mountain' || region === 'cave') {
    if (e > 0.32) return 'mountain';
    if (m > 0.55) return 'water';
    if (e > 0.08) return m > 0.1 ? 'forest' : 'grass';
    return 'grass';
  }
  if (region === 'dungeon') {
    if (e > 0.5) return 'mountain';
    if (m > 0.66) return 'lava'; // 熔岩裂谷（暗黑氛围）
    if (e > 0.15) return 'forest';
    return 'grass';
  }
  // forest / plain / city 默认
  if (e > 0.58) return 'mountain';
  if (m > 0.58) return 'water';
  if (e > 0.1) return m > -0.1 ? biome.rough : biome.base;
  return m > 0.35 ? biome.rough : biome.base;
}

/** 在可通行瓦片上确定性散布实体（模块2 §3.3.8 实体分布） */
export function scatterEntities(
  tiles: TileType[][],
  chunkX: number,
  chunkY: number,
  chunkSize: number,
  seed: number,
  density: number,
): MapEntity[] {
  const rng = createRng(seed ^ (chunkX * 73856093) ^ (chunkY * 19349663));
  const entities: MapEntity[] = [];
  let id = 0;
  const walkable = (x: number, y: number) => tiles[y]?.[x] && TILE_PROPERTIES[tiles[y][x]].walkable;
  for (let y = 0; y < chunkSize; y += 1) {
    for (let x = 0; x < chunkSize; x += 1) {
      if (!walkable(x, y)) continue;
      const roll = rng();
      if (roll > density) continue;
      const kind = rng();
      const wx = chunkX * chunkSize + x;
      const wy = chunkY * chunkSize + y;
      id += 1;
      if (kind < 0.45) {
        entities.push({ id: `e_${chunkX}_${chunkY}_${id}`, type: 'enemy', x: wx, y: wy, entityRefId: 'wolf', spriteId: null, interactable: true, visible: true, state: null });
      } else if (kind < 0.65) {
        entities.push({ id: `e_${chunkX}_${chunkY}_${id}`, type: 'chest', x: wx, y: wy, entityRefId: 'wooden_chest', spriteId: null, interactable: true, visible: true, state: null });
      } else if (kind < 0.8) {
        entities.push({ id: `e_${chunkX}_${chunkY}_${id}`, type: 'item', x: wx, y: wy, entityRefId: 'herb', spriteId: null, interactable: true, visible: true, state: null });
      } else if (kind < 0.9) {
        entities.push({ id: `e_${chunkX}_${chunkY}_${id}`, type: 'npc', x: wx, y: wy, entityRefId: 'traveling_merchant', spriteId: null, interactable: true, visible: true, state: null });
      } else {
        entities.push({ id: `e_${chunkX}_${chunkY}_${id}`, type: 'portal', x: wx, y: wy, entityRefId: 'ancient_portal', spriteId: null, interactable: true, visible: true, state: null });
      }
    }
  }
  return entities;
}

export function generateProcedural(input: GenerationInput): ChunkTileSlice {
  const { chunkX, chunkY, chunkSize, seed, region, neighborBoundaries } = input;
  const tiles: TileType[][] = [];
  for (let y = 0; y < chunkSize; y += 1) {
    const row: TileType[] = [];
    for (let x = 0; x < chunkSize; x += 1) {
      row.push(biomeAt(chunkX * chunkSize + x, chunkY * chunkSize + y, region.regionType, seed));
    }
    tiles.push(row);
  }

  // 策略B context_aware：边缘 2 列向已 ready 邻居主导地形靠拢（模块2 §3.4.2 策略B 风格协调）
  for (const nb of neighborBoundaries) {
    if (!nb.ready) continue;
    const dom = dominantTerrain(nb.edgeTiles);
    if (!dom) continue;
    for (let i = 0; i < chunkSize; i += 1) {
      const n = fbm2(i * 0.3, chunkX + chunkY, seed + 31) > 0 ? 2 : 1; // 1-2 列渗透
      for (let d = 0; d < n; d += 1) {
        if (nb.direction === 'west') tiles[i][d] = blendTile(tiles[i][d], dom);
        else if (nb.direction === 'east') tiles[i][chunkSize - 1 - d] = blendTile(tiles[i][chunkSize - 1 - d], dom);
        else if (nb.direction === 'north') tiles[d][i] = blendTile(tiles[d][i], dom);
        else if (nb.direction === 'south') tiles[chunkSize - 1 - d][i] = blendTile(tiles[chunkSize - 1 - d][i], dom);
      }
    }
  }

  const entities = scatterEntities(tiles, chunkX, chunkY, chunkSize, seed, 0.012);
  return {
    chunkId: `chunk_${chunkX}_${chunkY}`,
    chunkX,
    chunkY,
    tiles,
    entities,
    regionId: region.regionId,
  };
}

/** 地形渗透混合：仅同类地形替换（水/山等硬地形不被覆盖） */
function blendTile(current: TileType, dom: TileType): TileType {
  const hard: readonly TileType[] = ['water', 'mountain', 'lava', 'void'];
  if (hard.includes(current) || hard.includes(dom)) return current;
  return dom;
}
