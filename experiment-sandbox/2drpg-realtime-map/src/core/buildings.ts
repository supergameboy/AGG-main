/**
 * 建筑物系统（镜像模块6 §2.1 模板库/放置/绘制 + §2.2 内部双方案 + 附录C 布局清单）
 * - BuildingTemplateLibrary：附录C §3.1 的 10 个预置模板（沙箱实装 6 个代表模板）
 * - PlacementScanner/Validator/Painter：扫描可放置区域 → 校验 → 绘制外观瓦片
 * - InteriorMapGenerator：按附录C 内部布局程序化生成（<50ms，LLM 模式在主项目为 stub）
 * - 方案A/B：enter/exit 语义由 WorldEngine 编排，本模块提供数据
 */

import type { TileType } from '@/types/tile-map';
import { TILE_PROPERTIES } from '@/types/tile-map';
import { createRng } from './noise';

// ---------------------------------------------------------------------------
// 模板定义（附录C §二 字符表：W墙 .地板 D门 S楼梯 F家具 H宝箱 ~水 ^熔岩 空格void）
// ---------------------------------------------------------------------------

export interface BuildingTemplate {
  readonly templateId: string;
  readonly buildingType: 'house' | 'shop' | 'tavern' | 'temple' | 'tower' | 'warehouse';
  readonly shape: 'rectangle' | 'L_shape' | 'T_shape' | 'U_shape';
  readonly width: number;
  readonly height: number;
  /** 层数（1=单层无楼梯；2=双层含楼梯，方案B 可切层） */
  readonly floors: 1 | 2;
  /** 外观布局（附录C Z=1 层） */
  readonly exterior: readonly string[];
  /** 内部布局（每层一段；附录C 方案A InteriorMap / 方案B Z≥2 层，内外等大） */
  readonly interiorFloors: readonly (readonly string[])[];
  readonly stairsPos: { x: number; y: number } | null;
  readonly spawn: { x: number; y: number };
}

export const BUILDING_TEMPLATES: readonly BuildingTemplate[] = [
  {
    templateId: 'small_house',
    buildingType: 'house',
    shape: 'rectangle',
    width: 3,
    height: 4,
    floors: 1,
    // 门在南面底行正中（协议 v3 §3 可视面约束：固定等距相机仅西南/东南面可见，北面门会被屋顶遮挡）
    exterior: ['WWW', 'WWW', 'WWW', 'WDW'],
    interiorFloors: [['WWW', 'W.W', 'WFW', 'WDW']],
    stairsPos: null,
    spawn: { x: 1, y: 1 },
  },
  {
    templateId: 'medium_house',
    buildingType: 'house',
    shape: 'rectangle',
    width: 5,
    height: 4,
    floors: 1,
    exterior: ['WWWWW', 'WWWWW', 'WWWWW', 'WWDWW'],
    interiorFloors: [['WWWWW', 'W...W', 'WFBTW', 'WWDWW']],
    stairsPos: null,
    spawn: { x: 2, y: 1 },
  },
  {
    templateId: 'shop',
    buildingType: 'shop',
    shape: 'rectangle',
    width: 5,
    height: 4,
    floors: 1,
    exterior: ['WWWWW', 'WWWWW', 'WWWWW', 'WWDWW'],
    interiorFloors: [['WWWWW', 'W...W', 'W.C.W', 'WWDWW']],
    stairsPos: null,
    spawn: { x: 2, y: 1 },
  },
  {
    templateId: 'tavern',
    buildingType: 'tavern',
    // 协议 v3 §3 外壳拉伸以矩形占地为前提（屋顶=占地平行四边形整体仿射），L 缺口矩形化
    shape: 'rectangle',
    width: 5,
    height: 4,
    floors: 1,
    exterior: ['WWWWW', 'WWWWW', 'WWWWW', 'WWDWW'],
    interiorFloors: [['WWWWW', 'W...W', 'WTRTW', 'WWDWW']],
    stairsPos: null,
    spawn: { x: 2, y: 1 },
  },
  {
    templateId: 'temple',
    buildingType: 'temple',
    shape: 'rectangle',
    width: 5,
    height: 5,
    floors: 1,
    exterior: ['WWWWW', 'WWWWW', 'WWWWW', 'WWWWW', 'WWDWW'],
    interiorFloors: [['WWWWW', 'W...W', 'W.A.W', 'W...W', 'WWDWW']],
    stairsPos: null,
    spawn: { x: 2, y: 1 },
  },
  {
    templateId: 'tower',
    buildingType: 'tower',
    shape: 'rectangle',
    width: 3,
    height: 5,
    floors: 2,
    exterior: ['WWW', 'WWW', 'WWW', 'WWW', 'WDW'],
    // 附录C §3.8：第1层含上行楼梯 S(1,3)；第2层含下行楼梯 S(1,3) + 家具（双层楼梯同位，切层不卡墙）
    interiorFloors: [
      ['WWW', 'W.W', 'W.W', 'WSW', 'WDW'],
      ['WWW', 'W.W', 'WFW', 'WSW', 'WWW'],
    ],
    stairsPos: { x: 1, y: 3 },
    spawn: { x: 1, y: 1 },
  },
];

export function getTemplateByType(buildingType: string, rng: () => number): BuildingTemplate {
  const candidates = BUILDING_TEMPLATES.filter((t) => t.buildingType === buildingType);
  if (candidates.length > 0) return candidates[Math.floor(rng() * candidates.length)];
  return BUILDING_TEMPLATES[Math.floor(rng() * BUILDING_TEMPLATES.length)];
}

// ---------------------------------------------------------------------------
// 字符 → TileType（附录C §二 BuildingTile 字符表）
// ---------------------------------------------------------------------------

export function charToTile(ch: string): TileType {
  switch (ch) {
    case 'W': return 'wall';
    case '.': return 'floor';
    case 'D': return 'door';
    case 'S': return 'stairs';
    case '~': return 'water';
    case '^': return 'lava';
    case ' ': return 'void';
    default: return 'floor'; // F/C/B/T/R/A/H/P 家具类 → 地板 + 实体
  }
}

export function isFurnitureChar(ch: string): boolean {
  return 'FCBTRAHP'.includes(ch);
}

// ---------------------------------------------------------------------------
// 已放置建筑物（模块6 §3.2.6 PlacedBuilding）
// ---------------------------------------------------------------------------

export interface PlacedBuilding {
  readonly buildingId: string;
  readonly templateId: string;
  readonly buildingType: string;
  /** 世界坐标（左上角） */
  readonly worldX: number;
  readonly worldY: number;
  readonly width: number;
  readonly height: number;
  readonly floors: 1 | 2;
  readonly doorWorld: { x: number; y: number };
  readonly template: BuildingTemplate;
}

/** 内部地图（模块6 §2.2.1 InteriorMap；方案A 独立地图 / 方案B Z层共用数据） */
export interface InteriorMapData {
  readonly buildingId: string;
  readonly name: string;
  readonly floors: TileType[][][]; // [floor][y][x]
  readonly furniture: { x: number; y: number; ch: string; floor: number }[];
  readonly width: number;
  readonly height: number;
  readonly spawn: { x: number; y: number };
  readonly stairsPos: { x: number; y: number } | null;
}

// ---------------------------------------------------------------------------
// PlacementScanner + PlacementValidator + BuildingTilePainter（模块6 §2.1.3-2.1.5）
// ---------------------------------------------------------------------------

const PLACEABLE_TERRAIN: readonly TileType[] = ['grass', 'sand', 'road', 'snow'];

/** 在区块内为模板寻找可放置位置（扫描 + 校验：边界/重叠/地形） */
export function findPlacement(
  tiles: TileType[][],
  chunkX: number,
  chunkY: number,
  chunkSize: number,
  template: BuildingTemplate,
  existing: readonly PlacedBuilding[],
  rng: () => number,
): { localX: number; localY: number } | null {
  const w = template.width;
  const h = template.height;
  const attempts = 40;
  for (let i = 0; i < attempts; i += 1) {
    const localX = 1 + Math.floor(rng() * (chunkSize - w - 2));
    const localY = 1 + Math.floor(rng() * (chunkSize - h - 2));
    // 地形校验：全部占地瓦片可放置
    let ok = true;
    for (let y = 0; y < h && ok; y += 1) {
      for (let x = 0; x < w && ok; x += 1) {
        if (!PLACEABLE_TERRAIN.includes(tiles[localY + y][localX + x])) ok = false;
      }
    }
    if (!ok) continue;
    // 重叠校验（含 1 瓦片缓冲区，模块6 §2.1.3 步骤3）
    const wx = chunkX * chunkSize + localX;
    const wy = chunkY * chunkSize + localY;
    for (const b of existing) {
      if (
        wx - 1 < b.worldX + b.width &&
        wx + w + 1 > b.worldX &&
        wy - 1 < b.worldY + b.height &&
        wy + h + 1 > b.worldY
      ) {
        ok = false;
        break;
      }
    }
    if (ok) return { localX, localY };
  }
  return null;
}

/** BuildingTilePainter：外观瓦片写入区块 tiles + 生成 PlacedBuilding 记录 */
export function paintBuilding(
  tiles: TileType[][],
  chunkX: number,
  chunkY: number,
  chunkSize: number,
  template: BuildingTemplate,
  localX: number,
  localY: number,
  buildingSeq: number,
): PlacedBuilding {
  const worldX = chunkX * chunkSize + localX;
  const worldY = chunkY * chunkSize + localY;
  let doorWorld = { x: worldX, y: worldY };
  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      const ch = template.exterior[y][x];
      const tile = charToTile(ch);
      if (tile !== 'void') tiles[localY + y][localX + x] = tile;
      if (ch === 'D') doorWorld = { x: worldX + x, y: worldY + y };
      // 门上方补一排"门框"墙（附录C small_house 外观 DWD 语义：中央为入口）
      if (ch === 'W') tiles[localY + y][localX + x] = 'wall';
    }
  }
  return {
    buildingId: `bld_${chunkX}_${chunkY}_${buildingSeq}`,
    templateId: template.templateId,
    buildingType: template.buildingType,
    worldX,
    worldY,
    width: template.width,
    height: template.height,
    floors: template.floors,
    doorWorld,
    template,
  };
}

/** InteriorMapGenerator（程序化模式，模块6 §2.2.3 + §3.2.4） */
export function generateInterior(building: PlacedBuilding): InteriorMapData {
  const { template } = building;
  const floors: TileType[][][] = [];
  const furniture: InteriorMapData['furniture'] = [];
  template.interiorFloors.forEach((layout, floorIdx) => {
    const grid: TileType[][] = [];
    layout.forEach((row, y) => {
      const tilesRow: TileType[] = [];
      for (let x = 0; x < row.length; x += 1) {
        const ch = row[x];
        tilesRow.push(charToTile(ch));
        if (isFurnitureChar(ch)) furniture.push({ x, y, ch, floor: floorIdx });
      }
      grid.push(tilesRow);
    });
    floors.push(grid);
  });
  return {
    buildingId: building.buildingId,
    name: template.templateId,
    floors,
    furniture,
    width: template.width,
    height: template.height,
    spawn: template.spawn,
    stairsPos: template.stairsPos,
  };
}

/** 建筑物内部可通行判定（方案A/B 共用） */
export function interiorWalkable(interior: InteriorMapData, floor: number, x: number, y: number): boolean {
  const grid = interior.floors[floor];
  if (!grid || y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) return false;
  return TILE_PROPERTIES[grid[y][x]].walkable;
}

/** 放置用确定性 RNG（同 seed 同区块放置一致） */
export function placementRng(seed: number, chunkX: number, chunkY: number): () => number {
  return createRng(seed ^ (chunkX * 2246822519) ^ (chunkY * 3266489917) ^ 0x85ebca6b);
}
