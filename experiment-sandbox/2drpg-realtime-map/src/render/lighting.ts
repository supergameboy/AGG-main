/**
 * 光照系统（暗黑类 2.5D 混合渲染核心增强；模块5 渲染层扩展点）
 * - 环境光（ambient）：整体暗度，支持昼夜循环（控制面板可调）
 * - 点光源：玩家火把（半径+闪烁）、熔岩自发光（附录A emitsLight）、门/窗微光
 * - 实现：离屏 darkness 画布 → destination-out 挖出光斑 → 合成到主画布
 */

export interface LightSource {
  /** 屏幕坐标 */
  sx: number;
  sy: number;
  /** 半径（像素） */
  radius: number;
  /** 强度 0-1（挖除暗度的比例） */
  intensity: number;
  /** 光色（径向渐变内圈） */
  color: string;
}

/**
 * 火把闪烁（暗黑风标志性效果）：
 * 多频正弦叠加模拟火焰不稳定半径，返回 [0.92, 1.08] 的半径系数。
 */
export function torchFlicker(timeMs: number, seed = 0): number {
  const t = timeMs / 1000;
  return (
    1 +
    0.05 * Math.sin(t * 9.1 + seed) +
    0.025 * Math.sin(t * 23.7 + seed * 1.7) +
    0.012 * Math.sin(t * 41.3 + seed * 2.3)
  );
}

/**
 * 昼夜循环环境光（0.05=白昼微暗 … 0.85=深夜）：
 * cycleMs 一个完整昼夜周期；返回当前环境暗度。
 */
export function dayNightAmbient(timeMs: number, cycleMs = 120000): number {
  const phase = (timeMs % cycleMs) / cycleMs; // 0..1
  // 余弦曲线：phase=0（正午）最亮，phase=0.5（午夜）最暗
  const v = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0..1..0
  return 0.08 + v * 0.72;
}

/**
 * 将光照叠加合成到主画布：
 * @param ctx 主画布上下文
 * @param dark 离屏 darkness 画布（尺寸与主画布一致，复用避免分配）
 * @param ambient 环境暗度 0（全亮）.. 1（全黑）
 * @param lights 点光源列表（屏幕坐标）
 */
export function composeLighting(
  ctx: CanvasRenderingContext2D,
  dark: HTMLCanvasElement,
  ambient: number,
  lights: readonly LightSource[],
): void {
  const dctx = dark.getContext('2d')!;
  const { width, height } = dark;
  dctx.clearRect(0, 0, width, height);
  if (ambient <= 0.01) return;

  // 1. 铺满环境暗色（冷蓝黑夜色，非纯黑，保留暗黑风的"蓝夜"质感）
  dctx.globalCompositeOperation = 'source-over';
  dctx.fillStyle = `rgba(8,8,24,${Math.min(ambient, 0.92)})`;
  dctx.fillRect(0, 0, width, height);

  // 2. 挖除光斑
  dctx.globalCompositeOperation = 'destination-out';
  for (const l of lights) {
    const g = dctx.createRadialGradient(l.sx, l.sy, 0, l.sx, l.sy, l.radius);
    g.addColorStop(0, `rgba(255,255,255,${Math.min(1, l.intensity)})`);
    g.addColorStop(0.55, `rgba(255,255,255,${l.intensity * 0.5})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = g;
    dctx.beginPath();
    dctx.arc(l.sx, l.sy, l.radius, 0, Math.PI * 2);
    dctx.fill();
  }

  // 3. 合成到主画布
  ctx.drawImage(dark, 0, 0);

  // 4. 光源暖色晕染（加色模式，营造火光色温）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const g = ctx.createRadialGradient(l.sx, l.sy, 0, l.sx, l.sy, l.radius * 0.7);
    g.addColorStop(0, l.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.16 * l.intensity;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(l.sx, l.sy, l.radius * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 暗角（暗黑风标志性 vignette） */
export function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.5): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
