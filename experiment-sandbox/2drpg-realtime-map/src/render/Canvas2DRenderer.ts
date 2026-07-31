/**
 * Canvas 2D 渲染器（镜像模块5 §2.1.3 Canvas2DRenderer，附录D Phase 2 等距渲染）
 * 能力矩阵：
 * - top_down 俯视 / isometric 等距 / isometric_25d 等距+光照（暗黑类 2.5D 混合渲染）
 * - 画家算法深度排序（按 x+y 升序）、瓦片高度挤出（mountain/wall/forest）
 * - 迷雾三态（可见/已探索/未探索，模块5 §3.2.2）
 * - 边界美化 alpha_blend（模块5 §2.1.5 接管模块2 过渡地形职责）
 * - 光照叠加：环境光/火把闪烁/熔岩自发光/昼夜循环/暗角
 * - 缩放平移（zoom 0.4-2.5，跟随/自由双模式）
 * - 资源映射：程序化贴图 ↔ 精灵图集（附录A spriteId 链路）
 * - 建筑外壳拉伸（协议 v3 §3：墙/顶 pattern 仿射平铺，替代逐瓦片棱柱/垂直墙精灵）
 * - 玩家遮挡穿透（协议 v3 §4：被建筑阻挡时外壳半透明 + 幽灵轮廓）
 * 性能：贴图全部预渲染缓存，每帧仅 drawImage + 少量矢量，视口外零绘制。
 */

import type { BoundarySmoothing, RenderStyle, TileType } from '@/types/tile-map';
import { TILE_PROPERTIES } from '@/types/tile-map';
import type { WorldEngine } from '@/core/world';
import { ISO_W, ISO_H, ISO_SPRITE_H, SQ, getIsoSprite, getSquareSprite, variantAt, TILE_OVERLAP_PX } from './tile-sprites';
import { composeLighting, dayNightAmbient, drawVignette, torchFlicker, type LightSource } from './lighting';
import { spriteSheet, FOG_VERTICAL_ALPHA, type FogState } from './sprite-sheet';
import { entitySheet } from './entity-sheet';
import { buildingShell } from './building-shell';
import type { PlacedBuilding } from '@/core/buildings';

export interface RenderViewConfig {
  style: RenderStyle;
  zoom: number;
  cameraLocked: boolean;
  freeCamX: number; // 自由平移偏移（屏幕像素）
  freeCamY: number;
  boundarySmoothing: BoundarySmoothing;
  fogMode: 'off' | 'fog' | 'dark';
  ambientLight: number;
  dayNight: boolean;
  torchOn: boolean;
  torchRadius: number; // 瓦片数
  autoTile: boolean;
  spriteMode: 'procedural' | 'sheet';
  showChunkGrid: boolean;
}

const ENTITY_ICONS: Readonly<Record<string, string>> = {
  enemy: '🐺',
  npc: '🧙',
  chest: '📦',
  item: '🎁',
  portal: '🌀',
  building: '',
};

/**
 * emoji 字体栈（canvas 2D 对 'serif'/'sans-serif' 不做彩色 emoji 逐字形回退 ——
 * 缺字形时静默渲染空白，实体"程序化模式不可见"根因；必须显式声明 emoji 字体）
 */
const EMOJI_FONT = '"Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif';

/** 遮挡穿透系数（协议 v3 §4：玩家被建筑阻挡时外壳不透明度 —— 可辨轮廓又不喧宾夺主） */
const OCCLUSION_ALPHA = 0.38;

/** 过渡带检测的方向（协议 v3 §7：4 正交棱边 + 4 对角顶点） */
const EDGE_DIRS: readonly { dx: number; dy: number; kind: 'edge' | 'corner' }[] = [
  { dx: 1, dy: 0, kind: 'edge' },   // 东
  { dx: -1, dy: 0, kind: 'edge' },  // 西
  { dx: 0, dy: 1, kind: 'edge' },   // 南
  { dx: 0, dy: -1, kind: 'edge' },  // 北
  { dx: 1, dy: 1, kind: 'corner' }, // 东南
  { dx: -1, dy: 1, kind: 'corner' }, // 西南
  { dx: 1, dy: -1, kind: 'corner' }, // 东北
  { dx: -1, dy: -1, kind: 'corner' }, // 西北
];

/** 对角方向起始索引 */
const DIAGONAL_START = 4;

/** 过渡带缓存超采样倍率（zoom ≤ 2 清晰；2.0–2.5 轻微柔化可接受 —— 过渡带本是柔边） */
const BAND_SS = 2;
/** 过渡带缓存LRU上限（理论组合 15 瓦片 × 256 方向组合 × 4 变体，实际出现极少，超限防异常膨胀） */
const BAND_CACHE_LIMIT = 1024;

export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dark: HTMLCanvasElement;
  private fogMask: HTMLCanvasElement;
  /** 过渡带纹理缓存（协议 v3 §7 性能契约：key=瓦片:方向组合:变体 → 预渲染过渡带，逐帧仅 1 次 drawImage） */
  private bandCache = new Map<string, HTMLCanvasElement>();
  /** 缓存代指纹（风格/贴图源/强度变化 → 全量重建） */
  private bandEpoch = '';
  /** 过渡带掩码画布（生成期复用，避免每张带分配掩码画布） */
  private bandMask: HTMLCanvasElement | null = null;
  private dpr = 1;
  private camTX = 0; // 相机（瓦片坐标，zoom 无关）
  private camTY = 0;
  private lastTime = 0;
  private camInit = false;

  constructor() {
    this.dark = document.createElement('canvas');
    this.fogMask = document.createElement('canvas');
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  detach(): void {
    this.canvas = null;
    this.ctx = null;
    this.camInit = false;
  }

  resize(): void {
    if (!this.canvas) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.dark.width = this.canvas.width;
    this.dark.height = this.canvas.height;
    this.fogMask.width = this.canvas.width;
    this.fogMask.height = this.canvas.height;
  }

  // -------------------------------------------------------------------------
  // 投影（模块5 §2.1.6 等距坐标变换）
  // 设计要点：相机以「瓦片坐标」存储（camTX/camTY，zoom 无关），
  // 每帧用当前 zoom 投影到屏幕 —— 缩放时相机锚点不漂移（修复缩放跳变）。
  // freeCam 仅在「相机锁定关闭」时生效（锁定时缩放以玩家为锚点）。
  //
  // 整数对齐（架构修复 2026-07-31）：屏幕原点、瓦片尺寸、相机偏移均取整，
  // 所有瓦片屏幕坐标恒为整数 —— 消除逐瓦片 Math.floor 非对称取整
  // （非整数 zoom 下各瓦片小数部分不同，跨整数边界时刻不同 → 接缝抽搐）。
  // -------------------------------------------------------------------------

  private tileToScreen(x: number, y: number, cfg: RenderViewConfig): { sx: number; sy: number } {
    const w = this.canvas!.width / this.dpr;
    const h = this.canvas!.height / this.dpr;
    const freeX = cfg.cameraLocked ? 0 : cfg.freeCamX;
    const freeY = cfg.cameraLocked ? 0 : cfg.freeCamY;
    const ox = Math.round(w / 2 + freeX);
    const oy = Math.round(h / 2 + freeY);
    if (cfg.style === 'top_down') {
      const t = Math.round(SQ * cfg.zoom);
      const csx = Math.round(this.camTX * t);
      const csy = Math.round(this.camTY * t);
      return { sx: x * t - csx + ox, sy: y * t - csy + oy };
    }
    const hw = Math.round((ISO_W * cfg.zoom) / 2);
    const hh = Math.round((ISO_W * cfg.zoom) / 4);
    const csx = Math.round((-this.camTX + this.camTY) * hw);
    const csy = Math.round((-this.camTX - this.camTY) * hh);
    return {
      sx: (x - y) * hw + csx + ox,
      sy: (x + y) * hh + csy + oy,
    };
  }

  screenToTile(px: number, py: number, cfg: RenderViewConfig): { x: number; y: number } {
    const w = this.canvas!.width / this.dpr;
    const h = this.canvas!.height / this.dpr;
    const freeX = cfg.cameraLocked ? 0 : cfg.freeCamX;
    const freeY = cfg.cameraLocked ? 0 : cfg.freeCamY;
    const ox = Math.round(w / 2 + freeX);
    const oy = Math.round(h / 2 + freeY);
    const rx = px - ox;
    const ry = py - oy;
    if (cfg.style === 'top_down') {
      const t = Math.round(SQ * cfg.zoom);
      const csx = Math.round(this.camTX * t);
      const csy = Math.round(this.camTY * t);
      return { x: Math.floor((rx + csx) / t), y: Math.floor((ry + csy) / t) };
    }
    const hw = Math.round((ISO_W * cfg.zoom) / 2);
    const hh = Math.round((ISO_W * cfg.zoom) / 4);
    const csx = Math.round((-this.camTX + this.camTY) * hw);
    const csy = Math.round((-this.camTX - this.camTY) * hh);
    const fx = (rx - csx) / hw;
    const fy = (ry - csy) / hh;
    return { x: Math.floor((fx + fy) / 2), y: Math.floor((fy - fx) / 2) };
  }

  /** 视口瓦片范围（等距投影下屏幕矩形 ↔ 瓦片菱形：必须取四角的最小/最大值，否则斜角漏渲染） */
  private visibleTileRange(cfg: RenderViewConfig): { x0: number; y0: number; x1: number; y1: number } {
    const w = this.canvas!.width / this.dpr;
    const h = this.canvas!.height / this.dpr;
    const m = ISO_SPRITE_H * cfg.zoom; // 上缘余量（树/山向上延伸）
    const corners = [
      this.screenToTile(-m, -m, cfg),
      this.screenToTile(w + m, -m, cfg),
      this.screenToTile(-m, h + m, cfg),
      this.screenToTile(w + m, h + m, cfg),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      x0: Math.min(...xs) - 1,
      y0: Math.min(...ys) - 1,
      x1: Math.max(...xs) + 1,
      y1: Math.max(...ys) + 1,
    };
  }

  private updateCamera(engine: WorldEngine, cfg: RenderViewConfig, timeMs: number): void {
    const p = engine.getPlayerSnapshot();
    const dt = Math.min(100, timeMs - this.lastTime || 16) / 1000;
    this.lastTime = timeMs;
    if (!this.camInit) {
      this.camTX = p.x;
      this.camTY = p.y;
      this.camInit = true;
      return;
    }
    if (cfg.cameraLocked) {
      const k = Math.min(1, dt * 6);
      this.camTX += (p.x - this.camTX) * k;
      this.camTY += (p.y - this.camTY) * k;
    } else {
      this.camTX = p.x;
      this.camTY = p.y;
    }
  }

  // -------------------------------------------------------------------------
  // 主渲染入口
  // -------------------------------------------------------------------------

  render(engine: WorldEngine, cfg: RenderViewConfig, timeMs: number): void {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    this.updateCamera(engine, cfg, timeMs);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 背景（夜空底色）
    ctx.fillStyle = '#07070e';
    ctx.fillRect(0, 0, w, h);

    const player = engine.getPlayerSnapshot();
    const lights: LightSource[] = [];

    if (player.mode === 'interiorA') {
      this.renderInteriorA(engine, cfg, lights, timeMs);
    } else {
      this.renderOverworld(engine, cfg, lights, timeMs);
    }

    // —— 光照合成（2.5D 模式核心）——
    if (cfg.style === 'isometric_25d') {
      const ambient = cfg.dayNight ? dayNightAmbient(timeMs) : cfg.ambientLight;
      // 玩家火把（闪烁）
      if (cfg.torchOn) {
        const p = this.tileToScreen(player.x, player.y, cfg);
        const flick = torchFlicker(timeMs);
        lights.push({ sx: p.sx, sy: p.sy - 10 * cfg.zoom, radius: cfg.torchRadius * ISO_W * cfg.zoom * 0.5 * flick, intensity: 0.95, color: 'rgba(255,170,60,0.9)' });
      }
      composeLighting(ctx, this.dark, ambient, lights);
      drawVignette(ctx, w, h, 0.55);
    }
  }

  // -------------------------------------------------------------------------
  //  overworld（大地图）
  // -------------------------------------------------------------------------

  private renderOverworld(engine: WorldEngine, cfg: RenderViewConfig, lights: LightSource[], timeMs: number): void {
    const player = engine.getPlayerSnapshot();

    // 视口瓦片范围（四角逆投影取极值 —— 等距下屏幕矩形对应瓦片菱形，两角求法会漏掉斜角区域）
    const range = this.visibleTileRange(cfg);
    const x0 = Math.max(0, range.x0);
    const y0 = Math.max(0, range.y0);
    const x1 = range.x1;
    const y1 = range.y1;

    const buildings = engine.getBuildingsInRect(x0, y0, x1, y1);
    const interior = engine.getInterior();
    // 实体索引（每帧一次查询，按 "x,y" 聚合，避免瓦片循环内重复扫描）
    const entityByPos = new Map<string, { type: string }[]>();
    for (const e of engine.getEntitiesInRect(x0, y0, x1, y1)) {
      if (e.type === 'building') continue;
      const key = `${e.x},${e.y}`;
      if (!entityByPos.has(key)) entityByPos.set(key, []);
      entityByPos.get(key)!.push(e);
    }

    // 迷雾离屏 mask（软边：先绘 mask 再模糊合成，替代逐瓦片硬边覆盖）
    const fog = this.beginFogMask();

    // 画家算法：y 外层 x 内层 ⇒ (x+y) 升序
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const inInteriorFootprint =
          player.mode === 'interiorB' && interior
            ? x >= interior.building.worldX &&
              x < interior.building.worldX + interior.building.width &&
              y >= interior.building.worldY &&
              y < interior.building.worldY + interior.building.height
            : false;

        let tile: TileType;
        if (inInteriorFootprint && interior) {
          const lx = x - interior.building.worldX;
          const ly = y - interior.building.worldY;
          tile = interior.interior.floors[interior.floor][ly]?.[lx] ?? 'void';
        } else {
          tile = engine.getTileAt(x, y);
        }
        const { sx, sy } = this.tileToScreen(x, y, cfg);
        const fogState = this.fogStateAt(engine, x, y, cfg);
        this.drawTile(tile, x, y, sx, sy, cfg, lights, timeMs, fogState);

        // 迷雾 mask 收集（模块5 §3.2.2 三态）
        if (fog) this.collectFog(fog, engine, x, y, sx, sy, cfg);

        // 边界美化（接管模块2 过渡地形，模块5 §2.1.5）
        if (cfg.boundarySmoothing !== 'none') this.drawEdgeBlend(engine, tile, x, y, sx, sy, cfg);

        // 实体（按 x+y 顺序融入瓦片流；高出地面的实体按迷雾三态门控，未探索不渲染）
        const entsHere = entityByPos.get(`${x},${y}`);
        if (entsHere) {
          for (const e of entsHere) this.drawEntity(e.type, sx, sy, cfg, fogState);
        }
      }
    }

    // 建筑物外壳（协议 v3 §3 拉伸方案；方案B 内部模式时当前建筑剖面）
    // 必须在迷雾合成之前绘制 —— 迷雾覆盖未探索建筑（修复"未探索先渲染"）
    // 遮挡分区（协议 v3 §4）：玩家被建筑阻挡（深度键在建筑前缘之前 + 处于北侧视觉阴影区）时，
    // 先画玩家再以半透明外壳穿透 + 幽灵轮廓，保证玩家位置可辨。
    const playerKey = player.x + player.y;
    const occluding: { b: PlacedBuilding; cutaway: boolean }[] = [];
    const unobstructed: { b: PlacedBuilding; cutaway: boolean }[] = [];
    for (const b of buildings) {
      const cutaway = player.mode === 'interiorB' && interior !== null && b.buildingId === interior.building.buildingId;
      const frontKey = b.worldX + b.width - 1 + (b.worldY + b.height - 1);
      const blocked =
        !cutaway &&
        playerKey <= frontKey &&
        player.x > b.worldX - 1.2 &&
        player.x < b.worldX + b.width + 0.2 &&
        player.y > b.worldY - 2.6 &&
        player.y < b.worldY + b.height;
      (blocked ? occluding : unobstructed).push({ b, cutaway });
    }
    for (const { b, cutaway } of unobstructed) this.drawBuilding(engine, b, cfg, cutaway, 1);

    // 迷雾模糊合成（非方块软边）
    this.composeFogMask(cfg);

    // 区块占位（未生成区域 → "未知领域"暗色占位，模块5 空状态设计）
    this.drawChunkPlaceholders(engine, cfg, x0, y0, x1, y1, timeMs);

    // 区块网格（调试观测）
    if (cfg.showChunkGrid) this.drawChunkGrid(engine, cfg, x0, y0, x1, y1);

    // 门口交互提示 + 玩家（先玩家 → 遮挡建筑半透明穿透 → 幽灵轮廓）
    this.drawDoorHint(engine, cfg);
    this.drawPlayer(player.x, player.y, player.facing, cfg);
    for (const { b, cutaway } of occluding) this.drawBuilding(engine, b, cfg, cutaway, OCCLUSION_ALPHA);
    if (occluding.length > 0) this.drawPlayerGhost(player.x, player.y, player.facing, cfg);
  }

  private drawTile(
    tile: TileType,
    x: number,
    y: number,
    sx: number,
    sy: number,
    cfg: RenderViewConfig,
    lights: LightSource[],
    timeMs: number,
    fog: FogState = 'visible',
  ): void {
    const ctx = this.ctx!;
    const prop = TILE_PROPERTIES[tile];
    const z = cfg.zoom;
    if (cfg.style === 'top_down') {
      const size = SQ * z;
      // sx/sy 已由 tileToScreen 整数对齐 → Math.floor 为无开销 no-op（防御性保留）
      const px = Math.floor(sx);
      const py = Math.floor(sy);
      const overSize = Math.ceil(size) + TILE_OVERLAP_PX;
      if (cfg.spriteMode === 'sheet' && spriteSheet.isReady()) {
        spriteSheet.drawTileTopDown(ctx, tile, px, py, size, fog);
      } else {
        const sprite = getSquareSprite(tile, variantAt(x, y));
        ctx.drawImage(sprite, px, py, overSize, overSize);
      }
    } else {
      if (cfg.spriteMode === 'sheet' && spriteSheet.isReady()) {
        // 协议 v3 §3：wall 瓦片垂直层由建筑外壳拉伸接管，仅画地面（floor）—— 消除"外壳墙 + 逐瓦片墙精灵"双渲染
        if (tile === 'wall') {
          spriteSheet.drawGround(ctx, tile, sx, sy, ISO_W * z, (ISO_W / 2) * z);
        } else {
          spriteSheet.drawTile(ctx, tile, sx, sy, ISO_W * z, (ISO_W / 2) * z, fog);
        }
      } else {
        // 程序化贴图（64×96 画布：y64..96 地面菱形 / y0..64 向上延伸装饰）
        // 分两段绘制：地面段照常（迷雾菱形 mask 统一压暗）；
        // 装饰段高出菱形，按迷雾三态门控（未探索不画 / 已探索降暗）—— 与图集垂直层同语义
        // 协议 v3 §3：wall 装饰段由建筑外壳拉伸接管（砖墙 pattern），跳过逐瓦片墙块
        const sprite = getIsoSprite(tile, variantAt(x, y));
        // 锚点协议（附录A §4.2）：程序化画布 64×96，菱形中心=(ISO_W/2, ISO_SPRITE_H-ISO_H/2)=(32,80)
        // 须与 sprite-sheet.ts 图集锚点一致 —— tileToScreen(x,y)=菱形中心，双来源共用
        // sx/sy 已由 tileToScreen 整数对齐 → dx/dy 的小数部分帧内恒定（所有瓦片一致取整）
        const dx = sx - (ISO_W / 2) * z;
        const dy = sy - (ISO_SPRITE_H - ISO_H / 2) * z;
        const floorSrcY = ISO_SPRITE_H - ISO_H; // 64
        const leftX = Math.floor(dx);
        const topY = Math.floor(dy + floorSrcY * z);
        const overW = Math.ceil(ISO_W * z) + TILE_OVERLAP_PX * 2;
        const overH = Math.ceil(ISO_H * z) + TILE_OVERLAP_PX * 2;
        ctx.drawImage(sprite, 0, floorSrcY, ISO_W, ISO_H, leftX, topY, overW, overH);
        const decoAlpha = tile === 'wall' ? 0 : FOG_VERTICAL_ALPHA[fog];
        if (decoAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = decoAlpha;
          ctx.drawImage(sprite, 0, 0, ISO_W, floorSrcY, leftX, Math.floor(dy), overW, Math.ceil(floorSrcY * z) + TILE_OVERLAP_PX);
          ctx.restore();
        }
      }
      // 水面微光动画（等距模式）
      if (tile === 'water') {
        const a = 0.06 + 0.05 * Math.sin(timeMs / 700 + (x + y) * 1.3);
        this.fillDiamond(sx, sy, z, `rgba(140,190,240,${a})`);
      }
      // 熔岩脉动 + 光源注册
      if (tile === 'lava') {
        const a = 0.1 + 0.08 * Math.sin(timeMs / 500 + x * 2.1);
        this.fillDiamond(sx, sy, z, `rgba(255,120,30,${a})`);
        if (cfg.style === 'isometric_25d' && prop.emitsLight > 0) {
          lights.push({ sx, sy: sy - 4 * z, radius: 2.2 * ISO_W * z * 0.5, intensity: prop.emitsLight, color: 'rgba(255,110,30,0.95)' });
        }
      }
      if (tile === 'door' && cfg.style === 'isometric_25d') {
        lights.push({ sx, sy: sy - 6 * z, radius: 1.1 * ISO_W * z * 0.5, intensity: 0.5, color: 'rgba(255,200,110,0.8)' });
      }
    }
  }

  private fillDiamond(sx: number, sy: number, z: number, fill: string): void {
    const ctx = this.ctx!;
    const tw = (ISO_W / 2) * z;
    const th = (ISO_W / 4) * z;
    ctx.beginPath();
    ctx.moveTo(sx, sy - th);
    ctx.lineTo(sx + tw, sy);
    ctx.lineTo(sx, sy + th);
    ctx.lineTo(sx - tw, sy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // -------------------------------------------------------------------------
  // 迷雾系统（软边 mask：离屏绘制 → 模糊合成；替代逐瓦片硬边覆盖）
  // 三态：可见（无覆盖）/ 已探索（暗 0.5）/ 未探索（暗 0.85~0.96，模块5 §3.2.2）
  // 职责划分：mask 只管"地面平面"压暗（菱形不重叠，后合成安全）；
  // 高出地面的内容（垂直层精灵/实体/家具/墙棱柱）在绘制时按 fogStateAt 门控 ——
  // 否则未探索区域的墙体/树木会穿出菱形 mask 之上渲染（"未探索先渲染"根因）。
  // -------------------------------------------------------------------------

  /** 逐瓦片迷雾三态求值（fogMode=off 全部可见） */
  private fogStateAt(engine: WorldEngine, x: number, y: number, cfg: RenderViewConfig): FogState {
    if (cfg.fogMode === 'off') return 'visible';
    if (engine.isVisibleNow(x, y)) return 'visible';
    return engine.isExplored(x, y) ? 'explored' : 'unexplored';
  }

  private beginFogMask(): CanvasRenderingContext2D | null {
    if (!this.canvas) return null;
    const fog = this.fogMask.getContext('2d');
    if (!fog) return null;
    fog.setTransform(1, 0, 0, 1, 0, 0);
    fog.clearRect(0, 0, this.fogMask.width, this.fogMask.height);
    fog.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return fog;
  }

  private collectFog(fog: CanvasRenderingContext2D, engine: WorldEngine, x: number, y: number, sx: number, sy: number, cfg: RenderViewConfig): void {
    if (cfg.fogMode === 'off') return;
    if (engine.isVisibleNow(x, y)) return;
    const explored = engine.isExplored(x, y);
    const alpha = explored ? 0.5 : cfg.fogMode === 'dark' ? 0.96 : 0.85;
    const z = cfg.zoom;
    fog.fillStyle = `rgba(4,4,10,${alpha})`;
    if (cfg.style === 'top_down') {
      const t = SQ * z;
      fog.fillRect(sx, sy, t, t);
    } else {
      const tw = (ISO_W / 2) * z;
      const th = (ISO_W / 4) * z;
      fog.beginPath();
      fog.moveTo(sx, sy - th);
      fog.lineTo(sx + tw, sy);
      fog.lineTo(sx, sy + th);
      fog.lineTo(sx - tw, sy);
      fog.closePath();
      fog.fill();
    }
  }

  /** 模糊合成（ctx.filter blur，Chrome/Edge 硬件加速；不支持时直接硬贴） */
  private composeFogMask(cfg: RenderViewConfig): void {
    if (cfg.fogMode === 'off' || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas!.width / this.dpr;
    const h = this.canvas!.height / this.dpr;
    ctx.save();
    const blurPx = Math.max(4, Math.round(10 * cfg.zoom));
    try {
      ctx.filter = `blur(${blurPx}px)`;
    } catch {
      // 旧浏览器无 filter → 直接绘制（硬边兜底）
    }
    ctx.drawImage(this.fogMask, 0, 0, w, h);
    ctx.restore();
  }

  /**
   * 过渡地形混合（协议 v3 §7，接管模块2 过渡地形职责，模块5 §2.1.5）
   * 相邻异类地形（terrainCategory 不同）间：邻居地面贴图裁剪进本瓦片区域，
   * 沿共享棱边法线 destination-in 渐变 —— 贴图互相渗透，消除边界突兀感。
   *
   * 连续性契约（2026-07-31 修订，修复"锯齿棋盘"破碎感）：
   * 1. 渐变轴 = 棱边内法线（非"棱边中点→瓦片中心"方向）：等距菱形 2:1，
   *    中心方向与法线不重合，朝中心渐变会沿棱边斜向衰减（一端 0.5 一端 0），
   *    与邻居镜像带错位形成交替三角齿；法线渐变保证棱边上 alpha 恒 0.5。
   * 2. 棱边 alpha 统一 0.5：两侧对称渗透（A 内 50%B贴图 ↔ B 内 50%A贴图），
   *    跨棱边颜色数学级无缝；强弱档位仅用带宽区分，不用棱边 alpha。
   * 3. 带宽 clamp 到中心距（apothem = tw·th/hypot(tw,th)，等距 ≈14.3px）内，
   *    不穿中心，瓦片中心保留净色区。
   * 4. 全部异类分组逐组渲染（不多数决取舍）：每条棱边双侧都有带 → 无单侧接缝；
   *    同组多方向掩码 lighten 逐像素取 max 合并 —— 角部无 alpha 叠乘斑块。
   *
   * 性能契约：过渡带内容只依赖（邻居瓦片类型, 方向组合, 变体, 渲染形态, 贴图源, 强度），
   * 与相机位置/zoom/时间无关 —— zoom=1 基准 ×BAND_SS 超采样预渲染入 bandCache，
   * 逐帧每瓦片每组固定 1 次 drawImage 缩放合成，渐变/裁剪/逐像素合成全部移出逐帧路径。
   * 缓存代指纹 epoch 变化（风格/贴图源/强度）时全量重建；LRU 上限防异常膨胀。
   */
  private drawEdgeBlend(engine: WorldEngine, tile: TileType, x: number, y: number, sx: number, sy: number, cfg: RenderViewConfig): void {
    if (tile === 'void') return;
    const cat = TILE_PROPERTIES[tile].terrainCategory;
    const topDown = cfg.style === 'top_down';
    const z = cfg.zoom;
    const sheetReady = cfg.spriteMode === 'sheet' && spriteSheet.isReady();
    const epoch = `${cfg.style}|${cfg.spriteMode}|${cfg.boundarySmoothing}|${sheetReady ? spriteSheet.getState().planeUrl : 'proc'}`;
    if (epoch !== this.bandEpoch) {
      this.bandEpoch = epoch;
      this.bandCache.clear();
    }
    // 异类方向按邻居瓦片类型分组（同 nt 多方向合并渲染；bit i = EDGE_DIRS[i]）
    // 对角方向（bit 4-7）与正交方向（bit 0-3）可合并到同一组：同一邻居类型
    // 可能在多个方向上与当前瓦片相邻（如东南角被水域包围）
    const groups = new Map<TileType, { mask: number; variant: number }>();
    for (let i = 0; i < EDGE_DIRS.length; i += 1) {
      const n = EDGE_DIRS[i];
      const nt = engine.getTileAt(x + n.dx, y + n.dy);
      if (nt === tile || nt === 'void') continue;
      if (TILE_PROPERTIES[nt].terrainCategory === cat) continue;
      const g = groups.get(nt);
      if (g) {
        g.mask |= 1 << i;
      } else {
        groups.set(nt, { mask: 1 << i, variant: sheetReady ? 0 : variantAt(x + n.dx, y + n.dy) });
      }
    }
    if (groups.size === 0) return;
    // 全部异类分组逐组渲染：每条棱边双侧对称渗透，无单侧接缝（三向交汇处角部小范围叠色属正常混合）
    const cx = topDown ? sx + (SQ * z) / 2 : sx;
    const cy = topDown ? sy + (SQ * z) / 2 : sy;
    // 过渡带是柔边混合（非像素艺术），启用 imageSmoothing 消除缩放锯齿
    const prevSmooth = this.ctx!.imageSmoothingEnabled;
    this.ctx!.imageSmoothingEnabled = true;
    for (const [nt, g] of groups) {
      const band = this.bandAt(nt, g.mask, g.variant, topDown, cfg);
      const dw = (band.width / BAND_SS) * z;
      const dh = (band.height / BAND_SS) * z;
      // 瓦片中心 = 缓存内容锚点（俯视 sx,sy=左上角；等距 sx,sy=菱形中心）
      this.ctx!.drawImage(band, cx - dw / 2, cy - dh / 2, dw, dh);
    }
    this.ctx!.imageSmoothingEnabled = prevSmooth;
  }

  /** 取过渡带缓存（LRU 提升；未命中则预渲染入库） */
  private bandAt(nt: TileType, dirsMask: number, variant: number, topDown: boolean, cfg: RenderViewConfig): HTMLCanvasElement {
    const key = `${nt}:${dirsMask}:${variant}`;
    const hit = this.bandCache.get(key);
    if (hit) {
      this.bandCache.delete(key);
      this.bandCache.set(key, hit);
      return hit;
    }
    const band = this.renderTransitionBand(nt, dirsMask, variant, topDown, cfg);
    this.bandCache.set(key, band);
    if (this.bandCache.size > BAND_CACHE_LIMIT) {
      const oldest = this.bandCache.keys().next().value;
      if (oldest !== undefined) this.bandCache.delete(oldest);
    }
    return band;
  }

  /** 预渲染单张过渡带（可多方向合并；zoom=1 基准 × BAND_SS 超采样；一次性成本，入库后零分配） */
  private renderTransitionBand(nt: TileType, dirsMask: number, variant: number, topDown: boolean, cfg: RenderViewConfig): HTMLCanvasElement {
    const strong = cfg.boundarySmoothing === 'shader_mix';
    const tw = topDown ? SQ / 2 : ISO_W / 2; // 半宽
    const th = topDown ? SQ / 2 : ISO_W / 4; // 半高
    // 过渡带宽（基准 zoom=1 像素）：clamp 到中心到棱边垂直距离（apothem）内，不穿中心 ——
    // 等距菱形 apothem = tw·th/hypot(tw,th) ≈ 14.3（非半高 16！强档 1.0× 也不越中心）
    const apothem = topDown ? SQ / 2 : (tw * th) / Math.hypot(tw, th);
    const bandPx = (strong ? 1.0 : 0.6) * apothem;
    // 边距 +8（原 +4）：确保渐变完全衰减到 0 前不触及 canvas 边界，杜绝硬边裁切
    const W = Math.ceil(tw * 2) + 8;
    const H = Math.ceil(th * 2) + 8;

    // 1) 掩码（生成期复用单画布）：各方向沿棱边内法线渐变（棱边 0.5 → 中心 0）lighten 逐像素取 max 合并。
    //    法线方向：等距菱形中心方向 ≠ 棱边法线（菱形 2:1 非正方形），必须按棱边几何求法线 ——
    //    邻居 (dx,dy) 的内法线 = normalize(-th·(dx-dy), -tw·(dx+dy))；俯视正方形中心方向即法线。
    //    多方向重叠区取 max 而非叠乘，角部无斑块；棱边 0.5 使两侧渗透对称、跨棱边无缝。
    //    对角方向（bit 4-7）：从菱形顶点向中心渐变，顶点 alpha 0.5 → 中心 0，带宽同棱边。
    const mask = this.bandMask ?? (this.bandMask = document.createElement('canvas'));
    mask.width = W * BAND_SS;
    mask.height = H * BAND_SS;
    const mCtx = mask.getContext('2d')!;
    mCtx.setTransform(BAND_SS, 0, 0, BAND_SS, 0, 0);
    mCtx.clearRect(0, 0, W, H);
    mCtx.globalCompositeOperation = 'lighten';
    const mcx = W / 2; // 本瓦片中心（逻辑坐标）
    const mcy = H / 2;
    for (let i = 0; i < EDGE_DIRS.length; i += 1) {
      if ((dirsMask & (1 << i)) === 0) continue;
      const { dx, dy } = EDGE_DIRS[i];
      const isDiagonal = i >= DIAGONAL_START;
      if (isDiagonal) {
        // —— 对角方向：在共享顶点处生成小范围柔和斑点 ——
        // 等距菱形中，(x+dx,y+dy) 与当前瓦片共享的顶点 ≠ (dx·tw, dy·th)：
        // 共享顶点 = 中心 + ((dx-dy)·tw/2, (dx+dy)·th/2)。
        // 俯视方形中，共享顶点 = 中心 + (dx·tw, dy·th)。
        const vx = topDown ? mcx + dx * tw : mcx + ((dx - dy) * tw) / 2;
        const vy = topDown ? mcy + dy * th : mcy + ((dx + dy) * th) / 2;
        // 渐变轴：共享顶点 → 瓦片中心（对角内法线方向）
        const g = mCtx.createLinearGradient(vx, vy, mcx, mcy);
        g.addColorStop(0, 'rgba(255,255,255,0.38)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        mCtx.fillStyle = g;
        mCtx.fillRect(0, 0, W, H);
      } else {
        // —— 正交方向：沿棱边内法线渐变 ——
        // 棱边中点：等距 = 中心 + (dx-dy)·tw/2, (dx+dy)·th/2；俯视 = 中心 + dx·tw, dy·th
        const ex = topDown ? mcx + dx * tw : mcx + ((dx - dy) * tw) / 2;
        const ey = topDown ? mcy + dy * th : mcy + ((dx + dy) * th) / 2;
        // 棱边内法线（指向瓦片中心侧）：俯视 = (-dx,-dy)；等距 = normalize(-th·(dx-dy), -tw·(dx+dy))
        let nx = -dx;
        let ny = -dy;
        if (!topDown) {
          const rx = -th * (dx - dy);
          const ry = -tw * (dx + dy);
          const nLen = Math.hypot(rx, ry) || 1;
          nx = rx / nLen;
          ny = ry / nLen;
        }
        const g = mCtx.createLinearGradient(ex, ey, ex + nx * bandPx, ey + ny * bandPx);
        // 缓出曲线（ease-out）：棱边 0.5 → 快速衰减到 0.32 → 缓慢衰减到 0
        g.addColorStop(0, 'rgba(255,255,255,0.5)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.32)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        mCtx.fillStyle = g;
        mCtx.fillRect(0, 0, W, H);
      }
    }
    mCtx.globalCompositeOperation = 'source-over';

    // 2) 内容画布：邻居地面贴图画满瓦片区域（与 drawTile 地面段同一锚点/来源；菱形/方形内容自带边界，无需 clip）
    const off = document.createElement('canvas');
    off.width = W * BAND_SS;
    off.height = H * BAND_SS;
    const offCtx = off.getContext('2d')!;
    offCtx.setTransform(BAND_SS, 0, 0, BAND_SS, 0, 0);
    const cx = W / 2;
    const cy = H / 2;
    if (topDown) {
      if (cfg.spriteMode === 'sheet' && spriteSheet.isReady()) {
        spriteSheet.drawGroundTopDown(offCtx, nt, cx - tw, cy - th, tw * 2);
      } else {
        // 精确锚定：绘制中心 = 画布中心 (cx, cy)，消除 Math.floor(cx-tw) 的 0.5px 偏差
        const dw = Math.ceil(tw * 2) + TILE_OVERLAP_PX;
        const dh = Math.ceil(th * 2) + TILE_OVERLAP_PX;
        offCtx.drawImage(getSquareSprite(nt, variant), cx - dw / 2, cy - dh / 2, dw, dh);
      }
    } else if (cfg.spriteMode === 'sheet' && spriteSheet.isReady()) {
      spriteSheet.drawGround(offCtx, nt, cx, cy, ISO_W, ISO_W / 2);
    } else {
      // 精确锚定：绘制中心 = 画布中心 (cx, cy)，消除 Math.floor(cx-ISO_W/2) 的 1px 偏差
      const sprite = getIsoSprite(nt, variant);
      const floorSrcY = ISO_SPRITE_H - ISO_H;
      const dw = ISO_W + TILE_OVERLAP_PX * 2;
      const dh = ISO_H + TILE_OVERLAP_PX * 2;
      offCtx.drawImage(sprite, 0, floorSrcY, ISO_W, ISO_H, cx - dw / 2, cy - dh / 2, dw, dh);
    }

    // 3) destination-in 应用合并掩码（保留掩码非零区，alpha 按掩码衰减）
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(mask, 0, 0, W, H);
    offCtx.globalCompositeOperation = 'source-over';
    return off;
  }

  /** 实体绘制（迷雾三态门控：未探索不画 / 已探索降暗 / 可见全亮；图集锚点=脚底：等距=菱形中心，俯视=瓦片底边中点） */
  private drawEntity(type: string, sx: number, sy: number, cfg: RenderViewConfig, fog: FogState = 'visible'): void {
    // 未探索：实体不可见（emoji 回退也不允许穿雾）
    if (fog === 'unexplored') return;
    const ctx = this.ctx!;
    const z = cfg.zoom;
    const topDown = cfg.style === 'top_down';
    const ax = topDown ? sx + (SQ * z) / 2 : sx;
    const ay = topDown ? sy + SQ * z : sy;
    // 精灵图模式：实体图集映射（附录A 实体 spriteId 链路扩展）
    if (cfg.spriteMode === 'sheet' && entitySheet.isReady()) {
      const drawn = entitySheet.drawEntity(ctx, type, ax, ay, topDown ? SQ * z : ISO_W * z * 0.8, fog);
      if (drawn) return;
    }
    const icon = ENTITY_ICONS[type];
    if (!icon) return;
    ctx.save();
    ctx.font = `${Math.round(18 * z)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    if (fog === 'explored') ctx.globalAlpha = 0.35;
    const iy = topDown ? sy + SQ * z * 0.5 : ay - 6 * z; // emoji 视觉中心：俯视=瓦片中心，等距=略浮于菱形上方
    ctx.fillText(icon, ax, iy);
    ctx.restore();
  }

  /**
   * 建筑物外壳（协议 v3 §3 拉伸方案：西南/东南墙面 + 屋顶 pattern 仿射平铺，每建筑 3~5 次 fillRect）
   * 替代旧逐瓦片棱柱/逐瓦片垂直墙精灵 —— "生成与映射不理想"与逐瓦片性能根因。
   * 迷雾门控：按门口瓦片迷雾三态映射 alpha（未探索=0 不绘制）；occlusionScale 为遮挡穿透系数（§4）。
   * 门洞可视保留：程序化模式画拱形门洞；sheet 模式门瓦片垂直精灵由瓦片层照常渲染（drawTile 未被外壳接管）。
   */
  private drawBuilding(engine: WorldEngine, b: PlacedBuilding, cfg: RenderViewConfig, cutaway: boolean, occlusionScale: number): void {
    if (cfg.style === 'top_down') return;
    const fogState = this.fogStateAt(engine, b.doorWorld.x, b.doorWorld.y, cfg);
    const alpha = FOG_VERTICAL_ALPHA[fogState] * occlusionScale;
    if (alpha <= 0) return;
    buildingShell.drawShell(this.ctx!, b, {
      project: (x, y) => this.tileToScreen(x, y, cfg),
      tileW: ISO_W * cfg.zoom,
      cutaway,
      alpha,
      sheetMode: cfg.spriteMode === 'sheet' && spriteSheet.isReady(),
    });
    // 门口可视（修复"黑盒子找不到门"：拱形门洞 + 暖光；sheet 模式由门瓦片精灵承担）
    if (!cutaway && cfg.spriteMode === 'procedural') {
      const { sx, sy } = this.tileToScreen(b.doorWorld.x, b.doorWorld.y, cfg);
      this.drawDoorway(sx, sy, cfg.zoom, ISO_W * cfg.zoom * 0.55);
    }
  }

  /** 门洞（暗黑拱形 + 内部暖光外溢） */
  private drawDoorway(sx: number, sy: number, z: number, hPx: number): void {
    const ctx = this.ctx!;
    const doorW = 11 * z;
    const doorH = hPx * 0.72;
    const top = sy - hPx * 0.9;
    // 门洞（深色开口）
    ctx.fillStyle = '#0c0805';
    ctx.beginPath();
    ctx.moveTo(sx - doorW / 2, sy + 2 * z);
    ctx.lineTo(sx - doorW / 2, top + doorW / 2);
    ctx.quadraticCurveTo(sx, top - doorW * 0.45, sx + doorW / 2, top + doorW / 2);
    ctx.lineTo(sx + doorW / 2, sy + 2 * z);
    ctx.closePath();
    ctx.fill();
    // 内部暖光（门内透出）
    const g = ctx.createRadialGradient(sx, sy - doorH * 0.35, 1, sx, sy - doorH * 0.35, doorW * 1.2);
    g.addColorStop(0, 'rgba(255,190,100,0.5)');
    g.addColorStop(1, 'rgba(255,190,100,0)');
    ctx.fillStyle = g;
    ctx.fill();
    // 门框描边
    ctx.strokeStyle = 'rgba(180,140,80,0.55)';
    ctx.lineWidth = Math.max(1, 1.2 * z);
    ctx.stroke();
  }

  /** 门口交互提示（玩家接近时显示 "E 进入"） */
  private drawDoorHint(engine: WorldEngine, cfg: RenderViewConfig): void {
    const p = engine.getPlayerSnapshot();
    if (p.mode !== 'overworld') return;
    const b = engine.nearestDoor(p.tileX, p.tileY, 2);
    if (!b) return;
    const { sx, sy } = this.tileToScreen(b.doorWorld.x, b.doorWorld.y, cfg);
    const ctx = this.ctx!;
    const z = cfg.zoom;
    ctx.save();
    ctx.font = `bold ${Math.round(11 * z + 2)}px sans-serif`;
    ctx.textAlign = 'center';
    const text = `E 进入${b.buildingType === 'tower' ? '塔楼' : b.buildingType === 'shop' ? '商铺' : b.buildingType === 'tavern' ? '酒馆' : b.buildingType === 'temple' ? '神庙' : '房屋'}`;
    const wText = ctx.measureText(text).width + 14;
    const y = sy - ISO_W * z * 0.85;
    ctx.fillStyle = 'rgba(8,8,14,0.75)';
    ctx.beginPath();
    ctx.roundRect(sx - wText / 2, y - 10, wText, 18, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,170,255,0.5)';
    ctx.stroke();
    ctx.fillStyle = '#d8ccff';
    ctx.fillText(text, sx, y + 3);
    ctx.restore();
  }

  /** 玩家幽灵轮廓（协议 v3 §4：被建筑阻挡时以冷色发光剪影重绘，穿透半透明外壳仍清晰可辨） */
  private drawPlayerGhost(px: number, py: number, facing: string, cfg: RenderViewConfig): void {
    const ctx = this.ctx!;
    ctx.save();
    ctx.globalAlpha = 0.6;
    try {
      ctx.filter = 'saturate(0.3) brightness(1.7) drop-shadow(0 0 4px rgba(130,220,255,0.95))';
    } catch {
      // 旧浏览器无 filter → 仅以低透明度重绘剪影
    }
    this.drawPlayer(px, py, facing, cfg);
    ctx.restore();
  }

  /**
   * 室内墙面（协议 v3 §3 内墙拉伸：左/右/顶三面 pattern 仿射，与建筑外墙同一纹理来源）
   * 方案A 室内为低墙剖面（hPx = 0.4×瓦片宽），保持室内地板/家具可视。
   */
  private drawInteriorWall(sx: number, sy: number, z: number, hPx: number, sheetMode: boolean): void {
    const ctx = this.ctx!;
    const tw = (ISO_W / 2) * z;
    const th = (ISO_W / 4) * z;
    const pat = ctx.createPattern(buildingShell.wallTextureFor(sheetMode), 'repeat');
    if (!pat) return;
    const T = 256; // 纹理空间基准（与 building-shell TEX 一致）
    // 左面（西南向，受光）
    ctx.save();
    ctx.transform(tw / T, th / T, 0, hPx / T, sx - tw, sy - hPx);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, T, T);
    ctx.restore();
    // 右面（东南向，背光压暗）
    ctx.save();
    ctx.transform(-tw / T, th / T, 0, hPx / T, sx + tw, sy - hPx);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, T, T);
    ctx.fillStyle = 'rgba(8,6,12,0.22)';
    ctx.fillRect(0, 0, T, T);
    ctx.restore();
    // 顶面
    ctx.save();
    ctx.transform(tw / T, th / T, -tw / T, th / T, sx, sy - hPx - th);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, T, T);
    ctx.fillStyle = 'rgba(255,240,210,0.10)';
    ctx.fillRect(0, 0, T, T);
    ctx.restore();
  }

  private drawChunkPlaceholders(engine: WorldEngine, cfg: RenderViewConfig, x0: number, y0: number, x1: number, y1: number, timeMs: number): void {
    const ctx = this.ctx!;
    const chunkSize = engine.getConfig().decisions.chunkSize;
    const c0x = Math.floor(x0 / chunkSize);
    const c0y = Math.floor(y0 / chunkSize);
    const c1x = Math.floor(x1 / chunkSize);
    const c1y = Math.floor(y1 / chunkSize);
    const pulse = 0.5 + 0.2 * Math.sin(timeMs / 600);
    for (let cy = c0y; cy <= c1y; cy += 1) {
      for (let cx = c0x; cx <= c1x; cx += 1) {
        const status = engine.getChunkStatusAt(cx * chunkSize + 1, cy * chunkSize + 1);
        if (status === 'ready' || status === 'out_of_world') continue;
        const a = this.tileToScreen(cx * chunkSize, cy * chunkSize, cfg);
        const b = this.tileToScreen(cx * chunkSize + chunkSize, cy * chunkSize + chunkSize, cfg);
        const l = this.tileToScreen(cx * chunkSize, cy * chunkSize + chunkSize, cfg);
        const r = this.tileToScreen(cx * chunkSize + chunkSize, cy * chunkSize, cfg);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(r.sx, r.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.lineTo(l.sx, l.sy);
        ctx.closePath();
        ctx.fillStyle = status === 'generating' ? `rgba(30,28,48,${0.5 + pulse * 0.2})` : 'rgba(12,12,20,0.82)';
        ctx.fill();
        ctx.strokeStyle = status === 'failed' ? 'rgba(220,60,60,0.5)' : 'rgba(90,80,140,0.25)';
        ctx.stroke();
        // "未知领域"标识（模块5 空状态）
        ctx.save();
        ctx.fillStyle = `rgba(150,140,190,${status === 'generating' ? pulse : 0.4})`;
        ctx.font = `${Math.round(12 * cfg.zoom)}px sans-serif`;
        ctx.textAlign = 'center';
        const center = this.tileToScreen(cx * chunkSize + chunkSize / 2, cy * chunkSize + chunkSize / 2, cfg);
        ctx.fillText(status === 'generating' ? '生成中…' : status === 'failed' ? '生成失败' : '未知领域', center.sx, center.sy);
        ctx.restore();
      }
    }
  }

  private drawChunkGrid(engine: WorldEngine, cfg: RenderViewConfig, x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.ctx!;
    const chunkSize = engine.getConfig().decisions.chunkSize;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,100,200,0.25)';
    ctx.setLineDash([4, 4]);
    for (let cx = Math.floor(x0 / chunkSize); cx <= Math.floor(x1 / chunkSize) + 1; cx += 1) {
      const p0 = this.tileToScreen(cx * chunkSize, y0, cfg);
      const p1 = this.tileToScreen(cx * chunkSize, y1, cfg);
      ctx.beginPath();
      ctx.moveTo(p0.sx, p0.sy);
      ctx.lineTo(p1.sx, p1.sy);
      ctx.stroke();
    }
    for (let cy = Math.floor(y0 / chunkSize); cy <= Math.floor(y1 / chunkSize) + 1; cy += 1) {
      const p0 = this.tileToScreen(x0, cy * chunkSize, cfg);
      const p1 = this.tileToScreen(x1, cy * chunkSize, cfg);
      ctx.beginPath();
      ctx.moveTo(p0.sx, p0.sy);
      ctx.lineTo(p1.sx, p1.sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 玩家角色（优先实体图集映射；回退 hooded 暗黑风程序化小人；俯视锚点=瓦片中心，等距=菱形中心） */
  private drawPlayer(px: number, py: number, facing: string, cfg: RenderViewConfig): void {
    const ctx = this.ctx!;
    const z = cfg.zoom;
    const { sx, sy } = this.tileToScreen(px, py, cfg);
    const topDown = cfg.style === 'top_down';
    const ax = topDown ? sx + SQ * z * 0.5 : sx;
    const baseY = topDown ? sy + SQ * z * 0.5 : sy;
    const s = z;
    // 精灵图模式：实体清单玩家映射（垂直层图集 PLAYER_REGION 格；玩家所在格恒为可见态）
    if (cfg.spriteMode === 'sheet' && entitySheet.isReady()) {
      const drawn = entitySheet.drawEntity(ctx, 'player', ax, baseY, ISO_W * z * 0.85, 'visible');
      if (drawn) return;
    }
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(ax, baseY + 2 * s, 10 * s, 4.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 斗篷（梯形）
    ctx.fillStyle = '#3a2f4a';
    ctx.beginPath();
    ctx.moveTo(ax, baseY - 26 * s);
    ctx.lineTo(ax + 9 * s, baseY);
    ctx.lineTo(ax - 9 * s, baseY);
    ctx.closePath();
    ctx.fill();
    // 斗篷高光
    ctx.fillStyle = 'rgba(140,110,200,0.25)';
    ctx.beginPath();
    ctx.moveTo(ax, baseY - 26 * s);
    ctx.lineTo(ax + 4 * s, baseY - 6 * s);
    ctx.lineTo(ax, baseY - 4 * s);
    ctx.closePath();
    ctx.fill();
    // 兜帽
    ctx.fillStyle = '#4a3d63';
    ctx.beginPath();
    ctx.arc(ax, baseY - 26 * s, 5.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#181226';
    ctx.beginPath();
    ctx.arc(ax, baseY - 25 * s, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
    // 朝向标记
    const dirMap: Record<string, { dx: number; dy: number }> = { up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 } };
    const d = dirMap[facing] ?? dirMap.down;
    ctx.fillStyle = 'rgba(255,210,120,0.9)';
    ctx.beginPath();
    ctx.arc(ax + d.dx * 7 * s, baseY - 14 * s + d.dy * 5 * s, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // -------------------------------------------------------------------------
  // 方案A 内部地图渲染（独立地图视角）
  // -------------------------------------------------------------------------

  private renderInteriorA(engine: WorldEngine, cfg: RenderViewConfig, lights: LightSource[], timeMs: number): void {
    const ctx = this.ctx!;
    const interior = engine.getInterior();
    if (!interior) return;
    const grid = interior.interior.floors[interior.floor];
    const player = engine.getPlayerSnapshot();
    // 相机居中于内部玩家（瓦片坐标系，与 overworld 同一约定）
    this.camTX = player.x;
    this.camTY = player.y;

    // 内部底色（洞穴般的深空）
    ctx.fillStyle = '#0a0810';
    const w = this.canvas!.width / this.dpr;
    const h = this.canvas!.height / this.dpr;
    ctx.fillRect(0, 0, w, h);

    const fog = this.beginFogMask();
    const sheetReady = cfg.spriteMode === 'sheet' && spriteSheet.isReady();
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y].length; x += 1) {
        const tile = grid[y][x];
        const { sx, sy } = this.tileToScreen(x, y, cfg);
        // 与 overworld 同一绘制分支：俯视方形贴图 / 等距图集 ↔ 程序化 + 水面微光/熔岩/门灯
        // 迷雾三态必须传入 —— 墙/门/楼梯垂直精灵高出菱形 mask，缺省 visible 会在未探索房间穿雾（"未探索先渲染"根因）
        const fogState = this.fogStateAt(engine, x, y, cfg);
        this.drawTile(tile, x, y, sx, sy, cfg, lights, timeMs, fogState);
        // 室内墙面拉伸（协议 v3 §3 内墙：与外墙同一纹理来源，pattern 仿射三面；低墙剖面保持室内可视）
        if (tile === 'wall' && cfg.style !== 'top_down') this.drawInteriorWall(sx, sy, cfg.zoom, ISO_W * cfg.zoom * 0.4, sheetReady);
        if (fog) this.collectFog(fog, engine, x, y, sx, sy, cfg);
      }
    }
    // 家具（附录C：F/C/B/T/R/A/H 作为实体渲染；按迷雾三态门控 —— emoji 高出菱形 mask，未探索房间不得穿雾可见）
    for (const f of interior.interior.furniture) {
      if (f.floor !== interior.floor) continue;
      const fogState = this.fogStateAt(engine, f.x, f.y, cfg);
      if (fogState === 'unexplored') continue;
      const { sx, sy } = this.tileToScreen(f.x, f.y, cfg);
      const icon = f.ch === 'H' ? '📦' : f.ch === 'A' ? '🕯️' : f.ch === 'C' ? '🛒' : f.ch === 'B' ? '📚' : f.ch === 'T' ? '🪑' : '🛏️';
      const fx = cfg.style === 'top_down' ? sx + SQ * cfg.zoom * 0.5 : sx;
      const fy = cfg.style === 'top_down' ? sy + SQ * cfg.zoom * 0.5 : sy - 6 * cfg.zoom;
      this.drawEntityIcon(icon, fx, fy, cfg.zoom, fogState === 'explored' ? 0.35 : 1);
    }
    this.composeFogMask(cfg);
    this.drawPlayer(player.x, player.y, player.facing, cfg);
  }

  private drawEntityIcon(icon: string, sx: number, sy: number, z: number, alpha = 1): void {
    const ctx = this.ctx!;
    ctx.save();
    ctx.font = `${Math.round(16 * z)}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.fillText(icon, sx, sy);
    ctx.restore();
  }
}
