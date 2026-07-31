/**
 * 噪声工具（模块2 §3.3.8 ProceduralMapGenerator 依赖：Perlin 噪声 + 实体分布）
 * 沙箱实现：经典 Perlin 2D + 确定性种子（同 seed 保证同区块生成一致，模块6 §五 Edge path 对齐）。
 */

/** 确定性 hash → [0,1) */
function hash2(ix: number, iy: number, seed: number): number {
  let h = ix * 374761393 + iy * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Perlin 2D 单倍频 → [-1,1] */
export function perlin2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // 四个格点的梯度（用 hash 映射到 8 个方向之一）
  const g = (gx: number, gy: number): { x: number; y: number } => {
    const angle = hash2(gx, gy, seed) * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  };
  const dot = (gx: number, gy: number, dx: number, dy: number): number => {
    const grad = g(gx, gy);
    return grad.x * dx + grad.y * dy;
  };

  const v00 = dot(ix, iy, fx, fy);
  const v10 = dot(ix + 1, iy, fx - 1, fy);
  const v01 = dot(ix, iy + 1, fx, fy - 1);
  const v11 = dot(ix + 1, iy + 1, fx - 1, fy - 1);

  const u = fade(fx);
  const v = fade(fy);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v) * 1.414;
}

/** 分形叠加（fbm）→ 约 [-1,1] */
export function fbm2(x: number, y: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += perlin2(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 确定性伪随机序列（放置/实体分布用） */
export function createRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
