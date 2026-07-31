/**
 * 精灵图集加载与资源映射（附录A §4 精灵图资源规范 + §6.4 渲染器消费契约）
 *
 * ── 精灵图集协议 v3（RPG Maker 分层模型 + 直立精灵尺寸比例约定）──
 * 1. 双图集分离（同 v2）：
 *    - 平面层 plane-tiles-v3.jpg（4×4 网格，1024×1024，单格 256×256）：方形俯视平铺纹理，仿射扭曲到等距菱形。
 *    - 垂直层 vertical-tiles-v3.png（4×4 网格，纯黑背景）：直立精灵，chroma-key 抠图，底边中点锚定。
 * 2. 直立精灵尺寸比例约定（v3 新增）：
 *    真实世界 1 瓦片 = 1.0 单位（等距菱形对角线 = 64px 基准）。
 *    垂直层图集格 256×256px，映射比 = 256px / 1.0 单位 = 256:1。
 *    各精灵类型约定高度（单位：真实瓦片高度倍数）：
 *      player  1.75（人形身高，包围盒高 ≈ 448px，脚底到底边中点）
 *      npc     1.75（同 player）
 *      enemy   1.50（狼/怪物，略矮于人形）
 *      chest   1.00（宝箱，齐腰高）
 *      trees   2.50（树/森林，高于人形，遮挡上方瓦片）
 *      peak    2.00（山峰，高于树但低于墙）
 *      wall    1.20（建筑墙，略高于人形，阻挡视线）
 *      door    1.00（门，与人形同高）
 *      stairs  0.80（楼梯，低于人形，可通行）
 *    图集生成提示词必须按此比例绘制，禁止"玩家比树高""宝箱比人大"等失调。
 * 3. 瓦片渲染配方 TILE_RECIPE（同 v2）：TileType → 平面层堆叠 + 垂直层覆盖。
 * 4. 平面层接缝处理：菱形外扩 0.6px 微重叠 + INSET=1 内缩 + expandTileEdges 后处理。
 * 5. 垂直层锚点归一化：包围盒底边中点 = 脚底，按 §2 约定高度缩放（等距/俯视/实体统一）。
 * 6. 亮度与色彩：中性日光、中等亮度（明度 ≥40%）、暗黑氛围用冷灰/深棕/暗金；禁止整体低明度。
 * 7. 实体锚点（entity-sheet.ts）：底部中心（脚底）；玩家精灵寄生于垂直层 PLAYER_REGION (1,1) 格。
 * 8. 黑底抠图（v3 重写）：泛洪填充连通域检测 —— 只抠与图集边界连通的近黑背景，
 *    精灵内部暗色内容（黑斗篷/描边）与背景不连通 → 完整保留（修复人物暗部被误抠破洞）。
 * 9. 建筑屋顶格位：平面层 (2,2) = roof，供 building-shell 仿射拉伸；旧图集无此格 → features.roof=false 回退程序化。
 */

import type { TileType } from '@/types/tile-map';
import { TILE_PROPERTIES } from '@/types/tile-map';
import { TILE_OVERLAP_PX } from './tile-sprites';

/**
 * 迷雾三态（模块5 §3.2.2）：渲染期逐瓦片求值，门控一切"高出地面菱形"的内容。
 * 地面平面层由迷雾 mask（菱形）负责压暗；垂直层/实体/家具超出菱形区域，
 * 必须在绘制时按状态门控 —— 未探索完全不画，已探索降暗，可见全亮。
 */
export type FogState = 'visible' | 'explored' | 'unexplored';

/** 垂直层在迷雾三态下的不透明度（未探索=不绘制） */
export const FOG_VERTICAL_ALPHA: Readonly<Record<FogState, number>> = { visible: 1, explored: 0.5, unexplored: 0 };

export interface SpriteRegion {
  readonly col: number;
  readonly row: number;
}

// ---------------------------------------------------------------------------
// 图集格位映射（4×4 网格约定，生成提示词同序）
// ---------------------------------------------------------------------------

/** 平面层纹理 ID（方形俯视平铺纹理，仿射扭曲到菱形；roof 供建筑外壳拉伸，不参与 TILE_RECIPE） */
export type PlaneId = 'grass' | 'water' | 'road' | 'sand' | 'snow' | 'swamp' | 'floor' | 'lava' | 'rock' | 'bridge' | 'roof';

/** 垂直层精灵 ID（直立精灵，直接覆盖） */
export type VerticalId = 'trees' | 'peak' | 'wall' | 'door' | 'stairs';

/** 平面层格位：行1 grass/water/road/sand；行2 snow/swamp/floor/lava；行3 rock/bridge/roof */
export const PLANE_MAPPING: Readonly<Record<PlaneId, SpriteRegion>> = {
  grass: { col: 0, row: 0 },
  water: { col: 1, row: 0 },
  road: { col: 2, row: 0 },
  sand: { col: 3, row: 0 },
  snow: { col: 0, row: 1 },
  swamp: { col: 1, row: 1 },
  floor: { col: 2, row: 1 },
  lava: { col: 3, row: 1 },
  rock: { col: 0, row: 2 },
  bridge: { col: 1, row: 2 },
  roof: { col: 2, row: 2 },
};

/** 垂直层格位：行1 trees/peak/wall/door；行2 stairs/player */
export const VERTICAL_MAPPING: Readonly<Record<VerticalId, SpriteRegion>> = {
  trees: { col: 0, row: 0 },
  peak: { col: 1, row: 0 },
  wall: { col: 2, row: 0 },
  door: { col: 3, row: 0 },
  stairs: { col: 0, row: 1 },
};

/** 玩家精灵格（垂直层图集行2列2；entity-sheet.ts 复用） */
export const PLAYER_REGION: SpriteRegion = { col: 1, row: 1 };

/**
 * 直立精灵尺寸比例约定（协议 v3 §2）：
 * 真实世界 1 瓦片 = 1.0 单位（等距菱形对角线 = 64px 基准）。
 * 垂直层图集格 256×256px，映射比 = 256px / 1.0 单位。
 * 高度 = 包围盒高度（脚底到头顶），占格高的比例由生成提示词控制。
 */
export const SPRITE_HEIGHT_UNITS: Readonly<Record<VerticalId | 'player', number>> = {
  player: 1.75,
  trees: 2.50,
  peak: 2.00,
  wall: 1.20,
  door: 1.00,
  stairs: 0.80,
};

/** 实体精灵高度约定（entity-sheet 2×3 图集，格 512×512px，映射比 512:1） */
export const ENTITY_HEIGHT_UNITS: Readonly<Record<string, number>> = {
  player: 1.75,
  enemy: 1.50,
  npc: 1.75,
  chest: 1.00,
  item: 0.60,
  portal: 2.00,
};

/**
 * 瓦片渲染配方（协议 v2 §2）：TileType → 平面层堆叠 + 垂直层覆盖。
 * void 无任何层 → 不绘制（透出底色）。
 */
export const TILE_RECIPE: Readonly<Record<TileType, { planes: readonly PlaneId[]; vertical: VerticalId | null }>> = {
  grass: { planes: ['grass'], vertical: null },
  forest: { planes: ['grass'], vertical: 'trees' },
  mountain: { planes: ['rock'], vertical: 'peak' },
  water: { planes: ['water'], vertical: null },
  road: { planes: ['road'], vertical: null },
  wall: { planes: ['floor'], vertical: 'wall' },
  floor: { planes: ['floor'], vertical: null },
  door: { planes: ['floor'], vertical: 'door' },
  stairs: { planes: ['floor'], vertical: 'stairs' },
  lava: { planes: ['lava'], vertical: null },
  sand: { planes: ['sand'], vertical: null },
  snow: { planes: ['snow'], vertical: null },
  swamp: { planes: ['swamp'], vertical: null },
  bridge: { planes: ['bridge'], vertical: null },
  void: { planes: [], vertical: null },
};

/** 格内容包围盒（整图像素坐标；垂直层锚点归一化用） */
export interface CellBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 扫描抠图后画布中指定格的非透明包围盒。空格返回 null。供垂直层/实体图集做锚点归一化。
 * 防污染双闸（修复"异常覆盖贴图"：生成图集暗角/柔光经抠图软边带残留低 alpha 噪点，
 * 曾把包围盒撑到全格 → 锚点漂移、实体缩放基准失真）：
 * 1. 只统计 alpha > 128 的实体核心像素（柔边/噪点 alpha 均 <128）；
 * 2. 格边界内缩 GUARD 像素（格间接缝/串色不计入）。
 */
export function scanCellBounds(canvas: HTMLCanvasElement, col: number, row: number, cellW: number, cellH: number): CellBounds | null {
  const GUARD = 4;
  const SOLID_ALPHA = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const x0 = Math.round(col * cellW) + GUARD;
  const y0 = Math.round(row * cellH) + GUARD;
  const x1 = Math.min(canvas.width, Math.round((col + 1) * cellW)) - GUARD;
  const y1 = Math.min(canvas.height, Math.round((row + 1) * cellH)) - GUARD;
  if (x1 <= x0 || y1 <= y0) return null;
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let minX = x1 - x0;
  let minY = y1 - y0;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < y1 - y0; y += 1) {
    for (let x = 0; x < x1 - x0; x += 1) {
      if (data[(y * (x1 - x0) + x) * 4 + 3] > SOLID_ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface SpriteSheetState {
  readonly loaded: boolean;
  readonly planeUrl: string | null;
  readonly verticalUrl: string | null;
  /** 平面层格宽（方形纹理格，仿射扭曲基准） */
  readonly cellW: number;
  readonly cellH: number;
  /** 垂直层格宽（直立精灵格，缩放基准 —— 双图集分辨率可不同，禁止与平面层混用） */
  readonly verticalCellW: number;
  readonly verticalCellH: number;
  /** 图集能力位（协议 v3 §9：roof 格位是否可用；旧图集无 roof 格 → false 回退程序化屋顶） */
  readonly features: { readonly roof: boolean };
  readonly error: string | null;
}

const IDLE_STATE: SpriteSheetState = { loaded: false, planeUrl: null, verticalUrl: null, cellW: 0, cellH: 0, verticalCellW: 0, verticalCellH: 0, features: { roof: false }, error: null };

/**
 * 黑底抠图（协议 v3 §8 泛洪填充背景检测；entity-sheet 共用同一实现，禁止复制变体）
 * 阈值抠图会把精灵内部暗色内容（黑斗篷/描边/投影）误判为背景抠穿 —— 人物渲染破洞根因。
 * 改为连通域检测：AI 生成背景必为与图集边界连通的整块近黑区域，
 * 仅对边界连通的 CORE 阈值像素泛洪标记为背景；精灵内部暗色像素不连通 → 完整保留。
 * 软过渡只作用于背景单像素邻接环带（FRINGE），不向精灵内部扩散。
 */
export function chromaKeyBlack(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const w = c.width;
  const h = c.height;
  const CORE = 36; // 背景核心阈值：maxC < CORE 且与边界连通 → 背景
  const FRINGE = 84; // 背景邻接环带软化上限
  const maxC = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    maxC[i] = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  }
  const isBg = new Uint8Array(w * h); // 0=未判定 1=背景
  const queue: number[] = [];
  const seed = (i: number) => {
    if (!isBg[i] && maxC[i] < CORE) {
      isBg[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x += 1) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y += 1) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  // 仅沿 CORE 像素 4 邻域扩散 —— 暗色精灵内容（≥CORE）阻断泛洪，保护内部
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  for (let i = 0; i < w * h; i += 1) {
    if (isBg[i]) {
      px[i * 4 + 3] = 0;
      continue;
    }
    // 背景单像素邻接环带：边缘软过渡（只吃 1 圈 fringe，不侵蚀内部）
    if (maxC[i] < FRINGE) {
      const x = i % w;
      const y = (i / w) | 0;
      const nearBg =
        (x > 0 && isBg[i - 1]) || (x < w - 1 && isBg[i + 1]) || (y > 0 && isBg[i - w]) || (y < h - 1 && isBg[i + w]);
      if (nearBg) {
        px[i * 4 + 3] = Math.min(px[i * 4 + 3], ((maxC[i] - CORE) / (FRINGE - CORE)) * 255);
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

export class SpriteSheet {
  /** 平面层图集（加载后转 canvas 并去除瓦片边界灰线） */
  private planeImage: HTMLCanvasElement | null = null;
  /** 垂直层图集（黑底抠图后画布） */
  private verticalImage: HTMLCanvasElement | null = null;
  private state: SpriteSheetState = IDLE_STATE;
  private listeners = new Set<() => void>();
  /** 垂直层格内容包围盒缓存（协议 §4 锚点归一化；加载时一次性扫描） */
  private cellBounds = new Map<string, CellBounds | null>();
  /** 加载代际令牌（风格切换并发重入：仅最新一代允许写入状态，忽略过期完成） */
  private loadSeq = 0;

  /** 加载双图集（协议 v2 §1：plane/vertical 需同时就绪，缺一整体回退程序化；features 声明图集能力位 §9） */
  async load(sources: { plane: readonly string[]; vertical: readonly string[]; features?: { roof: boolean } }): Promise<void> {
    const seq = ++this.loadSeq;
    const [planeImg, verticalUrl] = await Promise.all([
      this.tryLoadImage(sources.plane),
      this.tryLoadVertical(sources.vertical, seq),
    ]);
    if (seq !== this.loadSeq) return; // 已有更新的加载在进行/完成，丢弃本代结果
    if (planeImg && verticalUrl && this.verticalImage) {
      // 平面层：转 canvas + 去除瓦片边界灰线（AI生成图集常见：瓦片间有1px灰色网格线）
      const planeCanvas = document.createElement('canvas');
      planeCanvas.width = planeImg.img.width;
      planeCanvas.height = planeImg.img.height;
      const pctx = planeCanvas.getContext('2d')!;
      pctx.drawImage(planeImg.img, 0, 0);
      this.expandTileEdges(planeCanvas, planeImg.img.width / 4, planeImg.img.height / 4);
      this.planeImage = planeCanvas;
      this.state = {
        loaded: true,
        planeUrl: planeImg.url,
        verticalUrl,
        cellW: this.planeImage.width / 4,
        cellH: this.planeImage.height / 4,
        verticalCellW: this.verticalImage.width / 4,
        verticalCellH: this.verticalImage.height / 4,
        features: { roof: sources.features?.roof ?? false },
        error: null,
      };
    } else {
      const missing = [!planeImg && 'plane', !verticalUrl && 'vertical'].filter(Boolean).join(' + ');
      this.state = { ...IDLE_STATE, error: `未找到精灵图集（${missing} 缺失，可用控制面板生成）` };
    }
    this.notify();
  }

  /** 加载图集并返回 {img, url}，失败尝试下一候选 */
  private tryLoadImage(candidates: readonly string[]): Promise<{ img: HTMLImageElement; url: string } | null> {
    const attempt = (idx: number): Promise<{ img: HTMLImageElement; url: string } | null> => {
      if (idx >= candidates.length) return Promise.resolve(null);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ img, url: candidates[idx] });
        img.onerror = () => resolve(attempt(idx + 1));
        img.src = candidates[idx];
      });
    };
    return attempt(0);
  }

  private tryLoadVertical(candidates: readonly string[], seq: number): Promise<string | null> {
    return this.tryLoadFirst(candidates, (img) => {
      if (seq !== this.loadSeq) return; // 过期代际禁止写画布/包围盒（防串代污染）
      this.verticalImage = chromaKeyBlack(img);
      this.scanAllCells(img.width / 4, img.height / 4);
    });
  }

  private tryLoadFirst(candidates: readonly string[], onLoad: (img: HTMLImageElement) => void): Promise<string | null> {
    const attempt = (idx: number): Promise<string | null> => {
      if (idx >= candidates.length) return Promise.resolve(null);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          onLoad(img);
          resolve(candidates[idx]);
        };
        img.onerror = () => resolve(attempt(idx + 1));
        img.src = candidates[idx];
      });
    };
    return attempt(0);
  }

  /** 扫描垂直层全部映射格的内容包围盒（VERTICAL_MAPPING + 玩家格），供锚点归一化 */
  private scanAllCells(cellW: number, cellH: number): void {
    this.cellBounds.clear();
    if (!this.verticalImage) return;
    const cells = new Set<string>();
    for (const id of Object.keys(VERTICAL_MAPPING) as VerticalId[]) {
      const r = VERTICAL_MAPPING[id];
      cells.add(`${r.col},${r.row}`);
    }
    cells.add(`${PLAYER_REGION.col},${PLAYER_REGION.row}`);
    for (const key of cells) {
      const [col, row] = key.split(',').map(Number);
      this.cellBounds.set(key, scanCellBounds(this.verticalImage, col, row, cellW, cellH));
    }
  }

  /** 垂直层指定格的内容包围盒（无内容格 → null；实体图集玩家格复用此接口） */
  boundsAt(col: number, row: number): CellBounds | null {
    return this.cellBounds.get(`${col},${row}`) ?? null;
  }

  /** 垂直层抠图画布（entity-sheet 玩家精灵复用） */
  getImage(): HTMLCanvasElement | null {
    return this.verticalImage;
  }

  /**
   * 去除瓦片边界灰线：AI生成图集常见瓦片间有1px灰色网格线。
   * 将每个瓦片边缘向内1px的像素复制到边界上，覆盖灰线；
   * 渲染时配合 INSET=1 裁掉边界，采样到的是干净的内部像素。
   */
  private expandTileEdges(canvas: HTMLCanvasElement, cellW: number, cellH: number): void {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    // 垂直边界：左瓦片右边缘 → 边界左1px；右瓦片左边缘 → 边界右1px
    for (let col = 1; col < 4; col++) {
      const bx = Math.round(col * cellW);
      for (let y = 0; y < h; y++) {
        const leftEdge = (y * w + (bx - 1)) * 4;
        const rightEdge = (y * w + bx) * 4;
        const srcLeft = leftEdge - 4; // 左瓦片倒数第2列
        d[leftEdge] = d[srcLeft]; d[leftEdge + 1] = d[srcLeft + 1]; d[leftEdge + 2] = d[srcLeft + 2]; d[leftEdge + 3] = d[srcLeft + 3];
        const srcRight = rightEdge + 4; // 右瓦片第1列
        d[rightEdge] = d[srcRight]; d[rightEdge + 1] = d[srcRight + 1]; d[rightEdge + 2] = d[srcRight + 2]; d[rightEdge + 3] = d[srcRight + 3];
      }
    }
    // 水平边界：上瓦片底边缘 → 边界上1px；下瓦片顶边缘 → 边界下1px
    for (let row = 1; row < 4; row++) {
      const by = Math.round(row * cellH);
      for (let x = 0; x < w; x++) {
        const topEdge = ((by - 1) * w + x) * 4;
        const bottomEdge = (by * w + x) * 4;
        const srcTop = topEdge - w * 4; // 上瓦片倒数第2行
        d[topEdge] = d[srcTop]; d[topEdge + 1] = d[srcTop + 1]; d[topEdge + 2] = d[srcTop + 2]; d[topEdge + 3] = d[srcTop + 3];
        const srcBottom = bottomEdge + w * 4; // 下瓦片第1行
        d[bottomEdge] = d[srcBottom]; d[bottomEdge + 1] = d[srcBottom + 1]; d[bottomEdge + 2] = d[srcBottom + 2]; d[bottomEdge + 3] = d[srcBottom + 3];
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  getState(): SpriteSheetState {
    return this.state;
  }

  isReady(): boolean {
    return this.state.loaded && this.planeImage !== null && this.verticalImage !== null;
  }

  /** 逐瓦片映射状态（控制面板展示：平面层+垂直层配方 / 回退程序化） */
  mappingStatus(): { tile: TileType; spriteId: string; recipe: string; mapped: boolean }[] {
    return (Object.keys(TILE_PROPERTIES) as TileType[]).map((tile) => {
      const r = TILE_RECIPE[tile];
      const planeCells = r.planes.map((p) => `P(${PLANE_MAPPING[p].col},${PLANE_MAPPING[p].row})`).join('');
      const v = r.vertical ? VERTICAL_MAPPING[r.vertical] : null;
      const recipe = `${planeCells}${v ? `+V(${v.col},${v.row})` : ''}` || '—';
      return { tile, spriteId: TILE_PROPERTIES[tile].isometricSpriteId, recipe, mapped: this.isReady() };
    });
  }

  /**
   * 绘制指定瓦片（协议 v2 §2 分层渲染）：
   * 平面层逐层仿射扭曲到等距菱形（纹理 +u→世界 +x，+v→世界 +y）—— 平面层迷雾由渲染器菱形 mask 统一压暗；
   * 垂直层直立精灵直接覆盖，包围盒底边中点锚定菱形底顶点 (dx, dy+dh/2) —— 垂直层高出菱形，
   * 迷雾 mask 覆盖不到，必须按 fog 三态门控（§迷雾三态：未探索不画 / 已探索降暗 / 可见全亮）。
   */
  drawTile(
    ctx: CanvasRenderingContext2D,
    tile: TileType,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    fog: FogState = 'visible',
    alphaScale = 1,
  ): void {
    if (!this.isReady()) return;
    const recipe = TILE_RECIPE[tile];
    const s = this.state.cellW;
    // 源采样内缩：仅 1px 防跨格渗色（2px 会裁掉纹理边缘色，导致相邻瓦片色差接缝）
    const INSET = 1;
    for (const plane of recipe.planes) {
      const region = PLANE_MAPPING[plane];
      // 接缝扩张：菱形外扩 TILE_OVERLAP_PX，相邻瓦片微重叠消光栅缝隙（架构级统一常量）
      const hw = dw / 2 + TILE_OVERLAP_PX;
      // hh 向上取整：确保 dy - hh 为整数，Math.floor 无截断误差（消除 0.5px 偏差）
      const hh = Math.ceil(dh / 2 + TILE_OVERLAP_PX * 0.5);
      // 仿射：格内 (0,0)→菱形顶角，(s,0)→右角，(0,s)→左角，(s,s)→底角；
      // ctx.transform 与调用方既有变换（dpr 缩放）复合，不破坏外层状态
      // 像素对齐：平移分量取整，消除亚像素光栅缝隙
      ctx.save();
      ctx.transform(hw / s, hh / s, -hw / s, hh / s, Math.floor(dx), Math.floor(dy - hh));
      ctx.drawImage(this.planeImage!, region.col * s + INSET, region.row * s + INSET, s - INSET * 2, s - INSET * 2, 0, 0, s, s);
      ctx.restore();
    }
    const vAlpha = FOG_VERTICAL_ALPHA[fog] * alphaScale;
    if (recipe.vertical && vAlpha > 0) {
      const region = VERTICAL_MAPPING[recipe.vertical];
      const bounds = this.boundsAt(region.col, region.row);
      if (!bounds) return;
      // 协议 v3 尺寸比例：按约定高度（真实瓦片倍数）缩放，而非按格宽 —— 防止"玩家比树高"比例失调
      const targetH = SPRITE_HEIGHT_UNITS[recipe.vertical] * dw;
      const scale = targetH / bounds.h;
      const drawW = bounds.w * scale;
      const drawH = bounds.h * scale;
      const bottomY = dy + dh / 2;
      ctx.save();
      ctx.globalAlpha = vAlpha;
      ctx.drawImage(this.verticalImage!, bounds.x, bounds.y, bounds.w, bounds.h, dx - drawW / 2, bottomY - drawH, drawW, drawH);
      ctx.restore();
    }
  }

  /**
   * 仅绘制地面平面层（过渡地形混合采样 + 建筑占地内墙/门瓦片的地面替代绘制）：
   * 与 drawTile 的 planes 段同一数学，不含垂直层与迷雾门控。
   */
  drawGround(ctx: CanvasRenderingContext2D, tile: TileType, dx: number, dy: number, dw: number, dh: number): void {
    if (!this.isReady()) return;
    const recipe = TILE_RECIPE[tile];
    const s = this.state.cellW;
    const INSET = 1;
    for (const plane of recipe.planes) {
      const region = PLANE_MAPPING[plane];
      const hw = dw / 2 + TILE_OVERLAP_PX;
      // hh 向上取整：确保 dy - hh 为整数，Math.floor 无截断误差（消除过渡带 0.5px 上移）
      const hh = Math.ceil(dh / 2 + TILE_OVERLAP_PX * 0.5);
      ctx.save();
      ctx.transform(hw / s, hh / s, -hw / s, hh / s, Math.floor(dx), Math.floor(dy - hh));
      ctx.drawImage(this.planeImage!, region.col * s + INSET, region.row * s + INSET, s - INSET * 2, s - INSET * 2, 0, 0, s, s);
      ctx.restore();
    }
  }

  /** 平面层格位直采（建筑外壳墙面/屋顶纹理取样；planeId 任意，含 roof） */
  samplePlane(ctx: CanvasRenderingContext2D, plane: PlaneId, dx: number, dy: number, dw: number, dh: number): void {
    if (!this.isReady()) return;
    const region = PLANE_MAPPING[plane];
    const s = this.state.cellW;
    const INSET = 1;
    ctx.drawImage(this.planeImage!, region.col * s + INSET, region.row * s + INSET, s - INSET * 2, s - INSET * 2, dx, dy, dw, dh);
  }

  /**
   * 俯视模式绘制（协议 v2 §2 俯视变体：RPG Maker 正统形态）：
   * 平面层方形直接平铺（俯视地板角 = 无扭曲）；垂直层直立精灵锚定瓦片底边中点向上覆盖
   * （树/墙/门在俯视下仍是直立精灵，遮挡上方瓦片 —— RPG Maker A4/B/C 层语义）。
   * 迷雾三态门控与等距一致：垂直层高出瓦片方形，mask 覆盖不到，按 fog 门控。
   * 垂直层缩放同协议 v3 §2：按约定高度（size = 1 瓦片边长 = 1.0 单位），不按格宽。
   */
  drawTileTopDown(ctx: CanvasRenderingContext2D, tile: TileType, dx: number, dy: number, size: number, fog: FogState = 'visible', alphaScale = 1): void {
    if (!this.isReady()) return;
    const recipe = TILE_RECIPE[tile];
    const s = this.state.cellW;
    // 像素对齐 + 微重叠：消除亚像素光栅缝隙（背景色 #07070e 透出形成灰边）
    const px = Math.floor(dx);
    const py = Math.floor(dy);
    const overSize = Math.ceil(size) + TILE_OVERLAP_PX; // 微重叠，painters 算法后盖先画无缝
    const INSET = 1; // 与等距一致，1px 足够防渗色且不过度裁边
    for (const plane of recipe.planes) {
      const region = PLANE_MAPPING[plane];
      ctx.drawImage(this.planeImage!, region.col * s + INSET, region.row * s + INSET, s - INSET * 2, s - INSET * 2, px, py, overSize, overSize);
    }
    const vAlpha = FOG_VERTICAL_ALPHA[fog] * alphaScale;
    if (recipe.vertical && vAlpha > 0) {
      const region = VERTICAL_MAPPING[recipe.vertical];
      const bounds = this.boundsAt(region.col, region.row);
      if (!bounds) return;
      // 协议 v3 §2：俯视与等距同一高度约定（1 瓦片边长 = 1.0 单位）
      const targetH = SPRITE_HEIGHT_UNITS[recipe.vertical] * size;
      const scale = targetH / bounds.h;
      const drawW = bounds.w * scale;
      const drawH = bounds.h * scale;
      ctx.save();
      ctx.globalAlpha = vAlpha;
      ctx.drawImage(this.verticalImage!, bounds.x, bounds.y, bounds.w, bounds.h, px + size / 2 - drawW / 2, py + size - drawH, drawW, drawH);
      ctx.restore();
    }
  }

  /** 俯视仅地面平面层（过渡地形混合采样用，等价 drawTileTopDown 的 planes 段） */
  drawGroundTopDown(ctx: CanvasRenderingContext2D, tile: TileType, dx: number, dy: number, size: number): void {
    if (!this.isReady()) return;
    const recipe = TILE_RECIPE[tile];
    const s = this.state.cellW;
    const px = Math.floor(dx);
    const py = Math.floor(dy);
    const overSize = Math.ceil(size) + TILE_OVERLAP_PX;
    const INSET = 1;
    for (const plane of recipe.planes) {
      const region = PLANE_MAPPING[plane];
      ctx.drawImage(this.planeImage!, region.col * s + INSET, region.row * s + INSET, s - INSET * 2, s - INSET * 2, px, py, overSize, overSize);
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

export const spriteSheet = new SpriteSheet();
