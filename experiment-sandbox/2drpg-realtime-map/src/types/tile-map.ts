/**
 * 瓦片地图领域类型（镜像主项目 packages/shared/src/types/tile-map.ts）
 * 来源：模块1 §3.1 + 附录A §3.3（唯一权威来源）
 * 迁移说明：本文件与主项目 shared 类型保持字段级一致，迁移时直接替换 import 路径即可。
 */

// ---------------------------------------------------------------------------
// TileType（附录A §二，基线 15 种）
// ---------------------------------------------------------------------------

export type TileType =
  | 'grass'
  | 'forest'
  | 'mountain'
  | 'water'
  | 'road'
  | 'wall'
  | 'floor'
  | 'door'
  | 'stairs'
  | 'lava'
  | 'sand'
  | 'snow'
  | 'swamp'
  | 'bridge'
  | 'void';

export type TerrainCategory =
  | 'plain'
  | 'forest'
  | 'mountain'
  | 'water'
  | 'road'
  | 'indoor'
  | 'special'
  | 'hazard'
  | 'desert'
  | 'arctic'
  | 'swamp'
  | 'water_cross'
  | 'boundary';

/** 附录A §3.1 TileProperty 字段定义（沙箱追加 height/emitsLight 用于 2.5D 渲染） */
export interface TileProperty {
  readonly tileType: TileType;
  readonly walkable: boolean;
  readonly terrainCategory: TerrainCategory;
  /** 移动时间乘数（null = 不可通行）——模块3 MapProgram 耗时计算 */
  readonly timeMultiplier: number | null;
  readonly mvpColor: string;
  readonly mvpIcon: string;
  /** 精灵图资源 ID（附录A §4.1） */
  readonly spriteId: string;
  readonly isometricSpriteId: string;
  /** 2.5D 高度（0 = 平地，>0 抬升绘制，暗黑混合渲染用） */
  readonly height: number;
  /** 自发光强度（0-1，熔岩/水面反光等） */
  readonly emitsLight: number;
  readonly description?: string;
}

/** 附录A §3.3 完整属性表（15 种） */
export const TILE_PROPERTIES: Readonly<Record<TileType, TileProperty>> = {
  grass: { tileType: 'grass', walkable: true, terrainCategory: 'plain', timeMultiplier: 1.0, mvpColor: '#7ec850', mvpIcon: '🌿', spriteId: 'tile_grass', isometricSpriteId: 'iso_grass', height: 0, emitsLight: 0, description: '草地，常见于平原与森林边缘' },
  forest: { tileType: 'forest', walkable: true, terrainCategory: 'forest', timeMultiplier: 1.5, mvpColor: '#2d5a1e', mvpIcon: '🌲', spriteId: 'tile_forest', isometricSpriteId: 'iso_forest', height: 0.6, emitsLight: 0, description: '森林，移动耗时略高，遮挡视野' },
  mountain: { tileType: 'mountain', walkable: false, terrainCategory: 'mountain', timeMultiplier: null, mvpColor: '#8b7355', mvpIcon: '⛰️', spriteId: 'tile_mountain', isometricSpriteId: 'iso_mountain', height: 1.6, emitsLight: 0, description: '山脉，不可通行，可作为天然屏障' },
  water: { tileType: 'water', walkable: false, terrainCategory: 'water', timeMultiplier: null, mvpColor: '#4a90d9', mvpIcon: '🌊', spriteId: 'tile_water', isometricSpriteId: 'iso_water', height: -0.2, emitsLight: 0.15, description: '水域，不可通行（除非有桥/船）' },
  road: { tileType: 'road', walkable: true, terrainCategory: 'road', timeMultiplier: 0.8, mvpColor: '#c4a46c', mvpIcon: '🛤️', spriteId: 'tile_road', isometricSpriteId: 'iso_road', height: 0, emitsLight: 0, description: '道路，移动耗时低于平均' },
  wall: { tileType: 'wall', walkable: false, terrainCategory: 'indoor', timeMultiplier: null, mvpColor: '#555555', mvpIcon: '🧱', spriteId: 'tile_wall', isometricSpriteId: 'iso_wall', height: 1.2, emitsLight: 0, description: '墙壁，建筑物内部屏障' },
  floor: { tileType: 'floor', walkable: true, terrainCategory: 'indoor', timeMultiplier: 1.0, mvpColor: '#d4c4a8', mvpIcon: '▫️', spriteId: 'tile_floor', isometricSpriteId: 'iso_floor', height: 0, emitsLight: 0, description: '地板，建筑物内部地面' },
  door: { tileType: 'door', walkable: true, terrainCategory: 'indoor', timeMultiplier: 1.0, mvpColor: '#8b6914', mvpIcon: '🚪', spriteId: 'tile_door', isometricSpriteId: 'iso_door', height: 0, emitsLight: 0.1, description: '门，建筑物出入口' },
  stairs: { tileType: 'stairs', walkable: true, terrainCategory: 'special', timeMultiplier: 1.0, mvpColor: '#9b59b6', mvpIcon: '🔝', spriteId: 'tile_stairs', isometricSpriteId: 'iso_stairs', height: 0.2, emitsLight: 0, description: '楼梯，连接不同 Z 层（方案B 切层点）' },
  lava: { tileType: 'lava', walkable: false, terrainCategory: 'hazard', timeMultiplier: null, mvpColor: '#e74c3c', mvpIcon: '🔥', spriteId: 'tile_lava', isometricSpriteId: 'iso_lava', height: -0.1, emitsLight: 0.9, description: '熔岩，不可通行，危险地形' },
  sand: { tileType: 'sand', walkable: true, terrainCategory: 'desert', timeMultiplier: 1.2, mvpColor: '#f0d68a', mvpIcon: '🏜️', spriteId: 'tile_sand', isometricSpriteId: 'iso_sand', height: 0, emitsLight: 0, description: '沙地，沙漠地形，移动略慢' },
  snow: { tileType: 'snow', walkable: true, terrainCategory: 'arctic', timeMultiplier: 1.3, mvpColor: '#ecf0f1', mvpIcon: '❄️', spriteId: 'tile_snow', isometricSpriteId: 'iso_snow', height: 0, emitsLight: 0.05, description: '雪地，寒冷地形，移动耗时高' },
  swamp: { tileType: 'swamp', walkable: true, terrainCategory: 'swamp', timeMultiplier: 1.8, mvpColor: '#6b8e23', mvpIcon: '🏞️', spriteId: 'tile_swamp', isometricSpriteId: 'iso_swamp', height: 0, emitsLight: 0, description: '沼泽，移动耗时极高' },
  bridge: { tileType: 'bridge', walkable: true, terrainCategory: 'water_cross', timeMultiplier: 1.0, mvpColor: '#a0522d', mvpIcon: '🌉', spriteId: 'tile_bridge', isometricSpriteId: 'iso_bridge', height: 0.1, emitsLight: 0, description: '桥梁，跨越水域的可通行结构' },
  void: { tileType: 'void', walkable: false, terrainCategory: 'boundary', timeMultiplier: null, mvpColor: '#1a1a2e', mvpIcon: '·', spriteId: 'tile_void', isometricSpriteId: 'iso_void', height: 0, emitsLight: 0, description: '边界虚空，地图未生成区域占位' },
};

export function getTileProperty(t: TileType): TileProperty {
  return TILE_PROPERTIES[t];
}

// ---------------------------------------------------------------------------
// 区块索引常量（模块1 §3.1.2；附录E 决策：CHUNK_SIZE=64 基线，沙箱可调）
// ---------------------------------------------------------------------------

export const SUB_CHUNK_SIZE = 16;
export const MAX_RETRY_COUNT = 3;

export interface WorldCoordinates {
  readonly x: number;
  readonly y: number;
}

export interface ChunkCoordinates {
  readonly chunkX: number;
  readonly chunkY: number;
}

export interface SubChunkCoordinates extends ChunkCoordinates {
  readonly subX: number;
  readonly subY: number;
}

export type ChunkDirection =
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'northwest'
  | 'northeast'
  | 'southwest'
  | 'southeast';

// ---------------------------------------------------------------------------
// 区块状态机（模块1 §4.2.1：pending → generating → ready/failed，禁止 ready → pending）
// ---------------------------------------------------------------------------

export type ChunkStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface ChunkMetadata {
  readonly chunkId: string;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly status: ChunkStatus;
  readonly generatedBy: 'llm' | 'procedural' | 'hybrid';
  readonly failureReason: string | null;
  readonly retryCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** 所属区域（跨区域横幅用；null = 荒野） */
  readonly regionId: string | null;
}

// ---------------------------------------------------------------------------
// 区域（模块5 §2.2.1 区域特色装饰映射）
// ---------------------------------------------------------------------------

export type RegionType =
  | 'forest'
  | 'desert'
  | 'city'
  | 'dungeon'
  | 'cave'
  | 'mountain'
  | 'water'
  | 'plain';

export interface RegionInfo {
  readonly regionId: string;
  readonly regionName: string;
  readonly regionType: RegionType;
}

export const REGION_DECOR: Readonly<Record<RegionType, { icon: string; borderColor: string }>> = {
  forest: { icon: '🌲', borderColor: '#22c55e' },
  desert: { icon: '🏜️', borderColor: '#eab308' },
  city: { icon: '🏰', borderColor: '#f59e0b' },
  dungeon: { icon: '💀', borderColor: '#a855f7' },
  cave: { icon: '🕳️', borderColor: '#92400e' },
  mountain: { icon: '⛰️', borderColor: '#9ca3af' },
  water: { icon: '🌊', borderColor: '#3b82f6' },
  plain: { icon: '🌾', borderColor: '#84cc16' },
};

// ---------------------------------------------------------------------------
// 实体（模块1 §3.1.3.1 MapEntity）
// ---------------------------------------------------------------------------

export type MapEntityType = 'npc' | 'enemy' | 'item' | 'building' | 'portal' | 'chest';

export interface MapEntity {
  readonly id: string;
  readonly type: MapEntityType;
  readonly x: number;
  readonly y: number;
  readonly entityRefId: string;
  readonly spriteId: string | null;
  readonly interactable: boolean;
  readonly visible: boolean;
  readonly state: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// 瓦片事件（模块3 §2.2.4 + 附录B §B.5.1）
// ---------------------------------------------------------------------------

export type TileEventType =
  | 'combat'
  | 'dialogue'
  | 'discovery'
  | 'exit'
  | 'enter_building'
  | 'trap'
  | 'story'
  | 'ambient';

export interface TileEvent {
  readonly type: TileEventType;
  readonly position: WorldCoordinates;
  readonly payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 区块数据切片（模块1 §3.1.4 ChunkTileSlice）
// ---------------------------------------------------------------------------

export interface ChunkTileSlice {
  readonly chunkId: string;
  readonly chunkX: number;
  readonly chunkY: number;
  /** 行优先 tiles[localY][localX]，边长 = 当前 chunkSize 配置 */
  readonly tiles: TileType[][];
  readonly entities: MapEntity[];
  readonly regionId: string | null;
}

// ---------------------------------------------------------------------------
// 决策快照（模块7 §2.2.2 DecisionSnapshot 沙箱超集 —— 控制面板"决策分叉口"分区）
// ---------------------------------------------------------------------------

export type RendererKind = 'css_grid' | 'canvas_2d';
export type RenderStyle = 'top_down' | 'isometric' | 'isometric_25d';
export type BoundaryStrategyKind = 'hard_boundary' | 'context_aware';
export type BoundarySmoothing = 'none' | 'alpha_blend' | 'shader_mix';
export type InteriorScheme = 'A' | 'B';
export type ChunkSizeOption = 32 | 64 | 96;
export type GeneratorKind = 'procedural' | 'mock_llm' | 'auto';
export type OutputFormat = 'atl' | 'json';
export type MapScale = 'small' | 'medium' | 'large';

/**
 * 决策分叉口快照（报告生成时嵌入，与设计文档决策点一一对应）：
 * - rendererType/renderStyle ← 附录D §五 游戏模式→风格→渲染器映射
 * - boundaryStrategy ← 模块2 §3.4 LLM 边界处理策略 A/B
 * - boundarySmoothing ← 模块5 §2.1.5 渲染层边界美化（接管自模块2）
 * - interiorScheme ← 模块6 §2.2 方案A独立地图 / 方案B Z层
 * - chunkSize ← 附录E §三 区块大小评估（推荐 64）
 * - generatorKind ← 模块2 §3.3.5 GeneratorRouter
 * - outputFormat ← 模块2 §3.2 ATL/JSON 双格式
 * - llmMode ← 模块7 §2.4 mock/real 双模式（沙箱仅 mock）
 */
export interface DecisionSnapshot {
  readonly rendererType: RendererKind;
  readonly renderStyle: RenderStyle;
  readonly boundaryStrategy: BoundaryStrategyKind;
  readonly boundarySmoothing: BoundarySmoothing;
  readonly interiorScheme: InteriorScheme;
  readonly chunkSize: ChunkSizeOption;
  readonly generatorKind: GeneratorKind;
  readonly outputFormat: OutputFormat;
  readonly llmMode: 'mock';
  readonly mapScale: MapScale;
}

export const DEFAULT_DECISIONS: DecisionSnapshot = {
  rendererType: 'canvas_2d',
  renderStyle: 'isometric_25d',
  boundaryStrategy: 'context_aware',
  boundarySmoothing: 'alpha_blend',
  interiorScheme: 'B',
  chunkSize: 64,
  generatorKind: 'auto',
  outputFormat: 'atl',
  llmMode: 'mock',
  mapScale: 'small',
};

/** 地图规模 → 区块边长数（small≈100×100 瓦片、medium≈500×500、large≈1000×1000，按 64 区块换算取整） */
export const MAP_SCALE_CHUNKS: Readonly<Record<MapScale, number>> = {
  small: 2,
  medium: 8,
  large: 16,
};
