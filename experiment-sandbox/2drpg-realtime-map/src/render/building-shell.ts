/**
 * 建筑物外壳渲染（协议 v3 §3 拉伸方案：与地面相同的仿射拉伸，替代逐瓦片棱柱/逐瓦片垂直精灵）
 *
 * 旧方案问题：程序化棱柱逐瓦片画 3 个矢量面（每建筑每帧数十次 path 绘制），
 * sheet 模式逐瓦片垂直墙精灵彼此独立、屋脊无覆盖 —— "生成与映射不理想"根因。
 * 拉伸方案（用户决策：与地面同一仿射数学）：
 * - 屋顶：屋顶纹理以 pattern 仿射平铺到建筑占地平行四边形（w×h 瓦片），一次 fillRect；
 * - 外墙：墙面纹理沿两个可见面（西南面 y+h 边 / 东南面 x+w 边）仿射平铺，每面一次 fillRect；
 * - 剖面（cutaway，方案B 玩家进入建筑）：外墙降 35% 高度 + 不画屋顶，露出内部瓦片；
 * - 北面（背向相机）不绘制 —— 等距视角恒不可见。
 * 性能：纹理 canvas 按来源缓存（程序化一次性生成 / 图集按 url 缓存），
 * 每建筑每帧固定 3~5 次 transform+fillRect，与建筑尺寸无关；zoom 由外层变换复合缩放。
 * 纹理来源：sheet 模式取垂直层 wall 格与平面层 roof 格（features.roof=false 的旧图集回退程序化）；
 * 程序化模式用确定性砖墙/板岩瓦生成纹理（零资源依赖基线）。
 */

import type { PlacedBuilding } from '@/core/buildings';
import { spriteSheet, VERTICAL_MAPPING } from './sprite-sheet';
import { TILE_OVERLAP_PX } from './tile-sprites';

/** 纹理空间分辨率（每瓦片映射的纹理像素数；仿射变换的 u/v 基准） */
const TEX = 256;
/** 墙高（真实瓦片倍数，与协议 v3 §2 SPRITE_HEIGHT_UNITS.wall = 1.2 一致） */
const WALL_HEIGHT_UNITS = 1.2;
/** 剖面墙高比例（方案B 内部模式：墙体降半露内部） */
const CUTAWAY_HEIGHT_RATIO = 0.35;

export interface ShellDrawOptions {
  /** 瓦片中心投影（Canvas2DRenderer.tileToScreen；含 zoom/dpr/相机） */
  readonly project: (x: number, y: number) => { sx: number; sy: number };
  /** 等距瓦片像素宽（ISO_W × zoom） */
  readonly tileW: number;
  /** 剖面模式（玩家在该建筑内：墙降半 + 去屋顶） */
  readonly cutaway: boolean;
  /** 综合不透明度（迷雾三态 × 玩家遮挡穿透；0 = 不绘制） */
  readonly alpha: number;
  /** 贴图来源（sheet = 精灵图集取样；false = 程序化纹理） */
  readonly sheetMode: boolean;
}

// ---------------------------------------------------------------------------
// 程序化纹理（确定性图案，无随机源 —— 同 seed 一致性与零资源依赖基线）
// ---------------------------------------------------------------------------

/** 砖墙纹理：错缝砖行 + 明暗扰动（暗黑冷灰棕调） */
function makeWallTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext('2d')!;
  g.fillStyle = '#332c24';
  g.fillRect(0, 0, TEX, TEX);
  const rowH = TEX / 8;
  const brickW = TEX / 4;
  for (let row = 0; row < 8; row += 1) {
    const y = row * rowH;
    const off = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < 5; col += 1) {
      const x = col * brickW + off;
      // 确定性明暗扰动（位置哈希，无随机源）
      const shade = 0.82 + 0.18 * ((((col * 7 + row * 13) % 11) + 11) % 11) / 10;
      g.fillStyle = `rgb(${Math.round(96 * shade)},${Math.round(84 * shade)},${Math.round(68 * shade)})`;
      g.fillRect(x + 1.5, y + 1.5, brickW - 3, rowH - 3);
      // 顶缘高光（砖块立体感）
      g.fillStyle = `rgba(210,190,160,${0.10 * shade})`;
      g.fillRect(x + 1.5, y + 1.5, brickW - 3, 2.5);
    }
  }
  return c;
}

/** 板岩瓦屋顶纹理：叠瓦扇形行（暗石板蓝灰调） */
function makeRoofTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext('2d')!;
  g.fillStyle = '#262232';
  g.fillRect(0, 0, TEX, TEX);
  const rowH = TEX / 8;
  const tileW = TEX / 8;
  for (let row = 0; row < 9; row += 1) {
    const y = row * rowH;
    const off = row % 2 === 0 ? 0 : tileW / 2;
    for (let col = -1; col < 9; col += 1) {
      const x = col * tileW + off;
      const shade = 0.8 + 0.2 * ((((col * 5 + row * 11) % 9) + 9) % 9) / 8;
      g.fillStyle = `rgb(${Math.round(64 * shade)},${Math.round(58 * shade)},${Math.round(88 * shade)})`;
      g.beginPath();
      g.arc(x + tileW / 2, y + rowH, tileW / 2 - 1, Math.PI, 0);
      g.lineTo(x + tileW - 1, y);
      g.lineTo(x + 1, y);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(10,8,16,0.5)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// 建筑外壳渲染器
// ---------------------------------------------------------------------------

export class BuildingShellRenderer {
  private procWall: HTMLCanvasElement | null = null;
  private procRoof: HTMLCanvasElement | null = null;
  /** 图集取样纹理缓存（key = 图集 url；图集热切换后自动重建） */
  private sheetWallCache = new Map<string, HTMLCanvasElement>();
  private sheetRoofCache = new Map<string, HTMLCanvasElement>();

  private wallTexture(sheetMode: boolean): HTMLCanvasElement {
    if (sheetMode && spriteSheet.isReady()) {
      const url = spriteSheet.getState().verticalUrl ?? '';
      const cached = this.sheetWallCache.get(url);
      if (cached) return cached;
      const bounds = spriteSheet.boundsAt(VERTICAL_MAPPING.wall.col, VERTICAL_MAPPING.wall.row);
      const img = spriteSheet.getImage();
      let tex: HTMLCanvasElement;
      if (bounds && img) {
        tex = document.createElement('canvas');
        tex.width = bounds.w;
        tex.height = bounds.h;
        tex.getContext('2d')!.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
      } else {
        tex = this.procWallTexture();
      }
      this.sheetWallCache.set(url, tex);
      return tex;
    }
    return this.procWallTexture();
  }

  private roofTexture(sheetMode: boolean): HTMLCanvasElement {
    if (sheetMode && spriteSheet.isReady() && spriteSheet.getState().features.roof) {
      const url = spriteSheet.getState().planeUrl ?? '';
      const cached = this.sheetRoofCache.get(url);
      if (cached) return cached;
      const tex = document.createElement('canvas');
      tex.width = TEX;
      tex.height = TEX;
      spriteSheet.samplePlane(tex.getContext('2d')!, 'roof', 0, 0, TEX, TEX);
      this.sheetRoofCache.set(url, tex);
      return tex;
    }
    if (!this.procRoof) this.procRoof = makeRoofTexture();
    return this.procRoof;
  }

  private procWallTexture(): HTMLCanvasElement {
    if (!this.procWall) this.procWall = makeWallTexture();
    return this.procWall;
  }

  /** 内墙纹理直取（方案A 室内墙面拉伸用；与外墙同一纹理来源，保证内外视觉一致） */
  wallTextureFor(sheetMode: boolean): HTMLCanvasElement {
    return this.wallTexture(sheetMode);
  }

  /**
   * 绘制建筑外壳（西南面 + 东南面 + 屋顶，pattern 仿射平铺）。
   * 占地平行四边形四角：T=北角（wx,wy 瓦片上顶点）、R=东角、B=南角、L=西角。
   */
  drawShell(ctx: CanvasRenderingContext2D, b: PlacedBuilding, opts: ShellDrawOptions): void {
    if (opts.alpha <= 0) return;
    const hw = opts.tileW / 2; // 单瓦片菱形半宽
    const hh = opts.tileW / 4; // 单瓦片菱形半高
    const wallH = WALL_HEIGHT_UNITS * opts.tileW * (opts.cutaway ? CUTAWAY_HEIGHT_RATIO : 1);

    const T0 = opts.project(b.worldX, b.worldY);
    const R0 = opts.project(b.worldX + b.width - 1, b.worldY);
    const B0 = opts.project(b.worldX + b.width - 1, b.worldY + b.height - 1);
    const L0 = opts.project(b.worldX, b.worldY + b.height - 1);
    const T = { x: T0.sx, y: T0.sy - hh };
    const R = { x: R0.sx + hw, y: R0.sy };
    const B = { x: B0.sx, y: B0.sy + hh };
    const L = { x: L0.sx - hw, y: L0.sy };

    const wall = this.wallTexture(opts.sheetMode);
    const roof = opts.cutaway ? null : this.roofTexture(opts.sheetMode);
    const wallPat = ctx.createPattern(wall, 'repeat');
    const roofPat = roof ? ctx.createPattern(roof, 'repeat') : null;
    if (!wallPat) return;

    ctx.save();
    ctx.globalAlpha = opts.alpha;

    // —— 西南面（y+h 边，L→B，沿世界 +x 方向 b.width 瓦片）——
    // 纹理空间：u = 沿面方向（每 TEX px 一瓦片），v = 墙高（TEX px = wallH）
    ctx.save();
    ctx.transform((B.x - L.x) / (b.width * TEX), (B.y - L.y) / (b.width * TEX), 0, wallH / TEX, L.x, L.y - wallH);
    ctx.fillStyle = wallPat;
    ctx.fillRect(0, 0, b.width * TEX, TEX);
    ctx.restore();

    // —— 东南面（x+w 边，R→B，沿世界 +y 方向 b.height 瓦片；背光压暗）——
    ctx.save();
    ctx.transform((B.x - R.x) / (b.height * TEX), (B.y - R.y) / (b.height * TEX), 0, wallH / TEX, R.x, R.y - wallH);
    ctx.fillStyle = wallPat;
    ctx.fillRect(0, 0, b.height * TEX, TEX);
    ctx.fillStyle = 'rgba(8,6,12,0.22)';
    ctx.fillRect(0, 0, b.height * TEX, TEX);
    ctx.restore();

    // —— 屋顶（剖面模式不画；微外扩 TILE_OVERLAP_PX*0.5 覆盖与墙面的光栅缝隙）——
    if (roofPat) {
      ctx.save();
      ctx.transform(
        (R.x - T.x) / (b.width * TEX),
        (R.y - T.y) / (b.width * TEX),
        (L.x - T.x) / (b.height * TEX),
        (L.y - T.y) / (b.height * TEX),
        T.x,
        T.y - wallH,
      );
      ctx.fillStyle = roofPat;
      ctx.fillRect(-TILE_OVERLAP_PX * 0.5, -TILE_OVERLAP_PX * 0.5, b.width * TEX + TILE_OVERLAP_PX, b.height * TEX + TILE_OVERLAP_PX);
      ctx.restore();
    }

    ctx.restore();
  }
}

export const buildingShell = new BuildingShellRenderer();
