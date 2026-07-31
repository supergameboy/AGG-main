/**
 * 程序化瓦片贴图（沙箱"程序化绘制"模式；附录A §4.1 精灵图资源规范的代码等价物）
 * - 等距菱形贴图 64×32（附录A §4.2 尺寸规范），画布 64×96 含向上延伸的装饰（树木/山体）
 * - 俯视方形贴图 48×48（CSS Grid/俯视模式）
 * - 暗黑风调色：低饱和、暗底色，配合光照系统呈现暗黑类 2.5D 氛围
 * - 变体机制（附录A §4.3）：同 TileType 多 variant 避免重复感
 * 缓存：Map<key, HTMLCanvasElement>，启动时懒生成，渲染期零分配。
 */

import type { TileType } from '@/types/tile-map';
import { createRng } from '@/core/noise';

export const ISO_W = 64;
export const ISO_H = 32;
export const ISO_SPRITE_H = 96; // 画布高（菱形贴底部，上部留给装饰）
export const SQ = 48;

/**
 * 瓦片间微重叠像素（架构级常量）：消除亚像素光栅缝隙。
 * 所有渲染路径统一使用此值 —— 替代之前散落的 +0.6/+1/+2/+0.5 临时补丁。
 * 1px 足以覆盖 canvas2D anti-aliasing 半透明边缘（0.5~1px）。
 */
export const TILE_OVERLAP_PX = 1;

const isoCache = new Map<string, HTMLCanvasElement>();
const sqCache = new Map<string, HTMLCanvasElement>();

/** 瓦片描边开关（用户反馈的"网格线"来源 —— 关闭后清缓存重绘无描边贴图） */
let tileBorder = false; // 默认关闭：相邻瓦片描边叠加会形成灰边接缝
export function setTileBorder(enabled: boolean): void {
  if (tileBorder === enabled) return;
  tileBorder = enabled;
  isoCache.clear();
  sqCache.clear();
}
export function getTileBorder(): boolean {
  return tileBorder;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** 菱形路径（中心 cx,cy，宽 64 高 32） */
function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, w = ISO_W, h = ISO_H): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

/** 噪点撒布 */
function speckle(ctx: CanvasRenderingContext2D, rng: () => number, cx: number, cy: number, n: number, colors: string[], size = 1.6): void {
  for (let i = 0; i < n; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = rng();
    const x = cx + Math.cos(a) * r * (ISO_W / 2 - 4) * (1 - 0.5 * Math.abs(Math.sin(a)) * 0);
    const y = cy + Math.sin(a) * r * (ISO_H / 2 - 3);
    // 仅在菱形内撒布（粗判）
    if (Math.abs(x - cx) / (ISO_W / 2) + Math.abs(y - cy) / (ISO_H / 2) > 0.92) continue;
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.fillRect(x, y, size, size * 0.7);
  }
}

/** 松树（森林装饰，向上延伸） */
function pineTree(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, dark: boolean): void {
  const trunk = dark ? '#2a1f16' : '#3a2b1c';
  const c1 = dark ? '#14260f' : '#1d3a14';
  const c2 = dark ? '#1c3316' : '#2a4d1c';
  ctx.fillStyle = trunk;
  ctx.fillRect(x - 1.2 * s, baseY - 6 * s, 2.4 * s, 6 * s);
  for (let i = 0; i < 3; i += 1) {
    const w = (11 - i * 2.6) * s;
    const y = baseY - (5 + i * 6) * s;
    ctx.fillStyle = i % 2 === 0 ? c1 : c2;
    ctx.beginPath();
    ctx.moveTo(x, y - 9 * s);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x - w / 2, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** 岩石山体（等距画布内绘制，顶部受光） */
function rock(ctx: CanvasRenderingContext2D, x: number, baseY: number, s: number, rng: () => number): void {
  const shades = ['#4a4038', '#5a4f44', '#6b5f52', '#3a322b'];
  for (let i = 0; i < 4; i += 1) {
    const ox = (rng() - 0.5) * 8 * s;
    const w = (10 + rng() * 8) * s;
    const h = (14 + rng() * 10) * s;
    ctx.fillStyle = shades[i % shades.length];
    ctx.beginPath();
    ctx.moveTo(x + ox - w / 2, baseY);
    ctx.lineTo(x + ox, baseY - h);
    ctx.lineTo(x + ox + w / 2, baseY);
    ctx.closePath();
    ctx.fill();
    // 顶部受光面
    ctx.fillStyle = 'rgba(200,190,170,0.18)';
    ctx.beginPath();
    ctx.moveTo(x + ox, baseY - h);
    ctx.lineTo(x + ox + w / 2, baseY);
    ctx.lineTo(x + ox, baseY);
    ctx.closePath();
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// 等距贴图生成（核心：每种 TileType 一个绘制函数）
// ---------------------------------------------------------------------------

function paintIso(tile: TileType, variant: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(ISO_W, ISO_SPRITE_H);
  const rng = createRng(variant * 7919 + tile.length * 131);
  const cx = ISO_W / 2;
  const cy = ISO_SPRITE_H - ISO_H / 2; // 菱形中心（贴底部）

  const base = (colors: [string, string], speckleN = 26) => {
    // 外扩 4px 填充：把 fill() 的 anti-aliasing 半透明边缘彻底推到 canvas 外部。
    // canvas 2D fill 在路径边缘必然产生 0.5~1px 亚像素半透明；
    // 截取区域 (0,64,64,32) 的四边须距离路径边缘 ≥2px 才能保证采样到完全实心像素。
    diamond(ctx, cx, cy, ISO_W + 4, ISO_H + 4);
    const g = ctx.createLinearGradient(cx - ISO_W / 2, cy, cx + ISO_W / 2, cy);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    diamond(ctx, cx, cy);
    ctx.clip();
    speckle(ctx, rng, cx, cy, speckleN, [shade(colors[0], 18), shade(colors[1], -14)]);
    ctx.restore();
  };

  switch (tile) {
    case 'grass':
      base(variant % 2 === 0 ? ['#3d5a2b', '#344f24'] : ['#40592a', '#385126']);
      if (variant === 2) speckle(ctx, rng, cx, cy, 6, ['#5a7340', '#c9b458'], 2);
      break;
    case 'forest':
      base(['#33492a', '#2c4023'], 18);
      pineTree(ctx, cx - 10, cy + 2, 0.9, true);
      pineTree(ctx, cx + 9, cy + 4, 0.75, true);
      if (variant > 0) pineTree(ctx, cx + 1, cy - 4, 1.0, variant === 2);
      break;
    case 'mountain':
      base(['#463c33', '#3c332b'], 16);
      rock(ctx, cx, cy + 8, 1.1, rng);
      break;
    case 'water': {
      base(['#16304a', '#10273d'], 8);
      ctx.save();
      diamond(ctx, cx, cy);
      ctx.clip();
      ctx.strokeStyle = 'rgba(120,170,220,0.28)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i += 1) {
        const y = cy - 8 + i * 5 + rng() * 2;
        ctx.beginPath();
        ctx.moveTo(cx - 20 + rng() * 8, y);
        ctx.quadraticCurveTo(cx, y + 3, cx + 18 - rng() * 8, y);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'road':
      base(['#5c4a33', '#524027'], 30);
      ctx.save();
      diamond(ctx, cx, cy);
      ctx.clip();
      ctx.strokeStyle = 'rgba(30,22,14,0.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy - 4);
      ctx.lineTo(cx + 22, cy - 4);
      ctx.moveTo(cx - 22, cy + 4);
      ctx.lineTo(cx + 22, cy + 4);
      ctx.stroke();
      ctx.restore();
      break;
    case 'wall': {
      base(['#3f3a38', '#353130'], 10);
      // 石块缝
      ctx.save();
      diamond(ctx, cx, cy);
      ctx.clip();
      ctx.strokeStyle = 'rgba(15,12,10,0.6)';
      ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy + i * 6);
        ctx.lineTo(cx + 30, cy + i * 6);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'floor':
      base(['#4f4231', '#473b2b'], 12);
      ctx.save();
      diamond(ctx, cx, cy);
      ctx.clip();
      ctx.strokeStyle = 'rgba(25,18,10,0.55)';
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(cx - 26 + i * 4, cy - 10 + i * 6);
        ctx.lineTo(cx + 26 - i * 4, cy - 10 + i * 6);
        ctx.stroke();
      }
      ctx.restore();
      break;
    case 'door':
      base(['#54401f', '#4a3717'], 8);
      ctx.fillStyle = '#241a0c';
      ctx.fillRect(cx - 8, cy - 10, 16, 14);
      ctx.fillStyle = '#6b5124';
      ctx.fillRect(cx - 6, cy - 8, 12, 10);
      break;
    case 'stairs':
      base(['#4a3d55', '#413650'], 8);
      ctx.save();
      diamond(ctx, cx, cy);
      ctx.clip();
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(220,210,235,0.22)' : 'rgba(10,8,14,0.35)';
        ctx.fillRect(cx - 18 + i * 2, cy - 9 + i * 5, 36 - i * 4, 2.6);
      }
      ctx.restore();
      break;
    case 'lava': {
      base(['#7a2413', '#932f12'], 10);
      ctx.save();
      diamond(ctx, cx, cy);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,190,60,0.75)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        const y = cy - 8 + rng() * 14;
        ctx.moveTo(cx - 20 + rng() * 10, y);
        ctx.lineTo(cx + 14 - rng() * 8, y + rng() * 4 - 2);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'sand':
      base(['#8a7347', '#7c663d'], 22);
      break;
    case 'snow':
      base(['#b9c4cd', '#aab7c2'], 16);
      speckle(ctx, rng, cx, cy, 8, ['#e8eef4'], 2);
      break;
    case 'swamp':
      base(['#3d4a26', '#343f20'], 20);
      speckle(ctx, rng, cx, cy, 8, ['#5c6b35', '#2a331a'], 2.6);
      break;
    case 'bridge': {
      base(['#16304a', '#10273d'], 6);
      ctx.save();
      diamond(ctx, cx, cy);
      ctx.clip();
      ctx.fillStyle = '#5c452a';
      ctx.fillRect(cx - 26, cy - 5, 52, 10);
      ctx.strokeStyle = 'rgba(20,12,6,0.7)';
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath();
        ctx.moveTo(cx - 24 + i * 9, cy - 5);
        ctx.lineTo(cx - 24 + i * 9, cy + 5);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'void':
    default:
      diamond(ctx, cx, cy, ISO_W + 4, ISO_H + 4);
      ctx.fillStyle = '#0d0c14';
      ctx.fill();
      break;
  }

  // 菱形边缘暗线（增强体积感）—— 受 tileBorder 开关控制，默认关闭避免接缝灰边
  if (tileBorder) {
    diamond(ctx, cx, cy);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return c;
}

// ---------------------------------------------------------------------------
// 俯视方形贴图（top_down / CSS Grid 后备）
// ---------------------------------------------------------------------------

function paintSquare(tile: TileType, variant: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(SQ, SQ);
  const rng = createRng(variant * 5417 + tile.length * 97);
  const flat = (col: string, speckColors: string[], n = 22) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, SQ, SQ);
    for (let i = 0; i < n; i += 1) {
      ctx.fillStyle = speckColors[Math.floor(rng() * speckColors.length)];
      ctx.fillRect(rng() * SQ, rng() * SQ, 2, 2);
    }
  };
  switch (tile) {
    case 'grass': flat('#3d5a2b', ['#4a6b34', '#33491f']); break;
    case 'forest':
      flat('#2c4023', ['#3a5230']);
      pineTree(ctx, SQ / 2 - 8, SQ / 2 + 10, 1.0, true);
      pineTree(ctx, SQ / 2 + 10, SQ / 2 + 12, 0.85, true);
      break;
    case 'mountain': flat('#3c332b', ['#4a4038']); rock(ctx, SQ / 2, SQ - 8, 1.2, rng); break;
    case 'water': flat('#10273d', ['#16304a', '#1d3d5c'], 14); break;
    case 'road': flat('#524027', ['#5c4a33', '#443520'], 26); break;
    case 'wall': flat('#353130', ['#3f3a38', '#2a2625'], 12); break;
    case 'floor': flat('#473b2b', ['#4f4231', '#3c3225'], 12); break;
    case 'door': flat('#4a3717', ['#54401f']); ctx.fillStyle = '#6b5124'; ctx.fillRect(SQ / 2 - 8, SQ / 2 - 8, 16, 16); break;
    case 'stairs': flat('#413650', ['#4a3d55']); for (let i = 0; i < 4; i += 1) { ctx.fillStyle = 'rgba(220,210,235,0.2)'; ctx.fillRect(8 + i * 2, 8 + i * 8, SQ - 16 - i * 4, 3); } break;
    case 'lava': flat('#7a2413', ['#932f12', '#ffbe3c'], 16); break;
    case 'sand': flat('#7c663d', ['#8a7347', '#6b5836'], 22); break;
    case 'snow': flat('#aab7c2', ['#c2cdd6', '#e8eef4'], 18); break;
    case 'swamp': flat('#343f20', ['#3d4a26', '#2a331a'], 20); break;
    case 'bridge': flat('#10273d', []); ctx.fillStyle = '#5c452a'; ctx.fillRect(0, SQ / 2 - 6, SQ, 12); break;
    case 'void': default: ctx.fillStyle = '#0d0c14'; ctx.fillRect(0, 0, SQ, SQ); break;
  }
  if (tileBorder) {
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.strokeRect(0.5, 0.5, SQ - 1, SQ - 1);
  }
  return c;
}

// ---------------------------------------------------------------------------
// 颜色工具 + 公共 API
// ---------------------------------------------------------------------------

function shade(hex: string, delta: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + delta));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + delta));
  const b = Math.min(255, Math.max(0, (n & 0xff) + delta));
  return `rgb(${r},${g},${b})`;
}

export function getIsoSprite(tile: TileType, variant: number): HTMLCanvasElement {
  const key = `${tile}:${variant}:v3`; // v3 = 外扩 4px 填充，彻底消除 anti-aliasing 灰边
  let c = isoCache.get(key);
  if (!c) {
    c = paintIso(tile, variant);
    isoCache.set(key, c);
  }
  return c;
}

export function getSquareSprite(tile: TileType, variant: number): HTMLCanvasElement {
  const key = `${tile}:${variant}:v3`;
  let c = sqCache.get(key);
  if (!c) {
    c = paintSquare(tile, variant);
    sqCache.set(key, c);
  }
  return c;
}

/** 瓦片坐标 → 确定性变体（附录A §4.3 变体权重：默认 4 变体均布） */
export function variantAt(x: number, y: number, maxVariants = 4): number {
  const h = (x * 374761393 + y * 668265263) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) % maxVariants;
}
