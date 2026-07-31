/**
 * A* 寻路（协议 v3 §6 浮点坐标重写；镜像模块3 §3.2.3 性能目标：100 格内 <5ms）
 *
 * 旧版 4 方向曼哈顿网格路径与前端连续坐标模型（px/py 浮点积分 + 贴墙滑动）不匹配：
 * 路径点呈阶梯折线，斜向移动绕远、沿墙抖动。重写要点：
 * 1. 8 方向扩展：对角代价 √2，禁止穿角（对角移动要求两正交邻居均可通行）；
 * 2. 八向距离启发（octile heuristic）替代曼哈顿 —— 8 方向移动下曼哈顿不可采纳；
 * 3. 地形时间乘数计入 g 代价（road 0.8 / swamp 1.8，模块3 §2.2 移动耗时语义）；
 * 4. 视线拉直（string pulling）：网格路径 → 浮点路径点序列，剔除被直线视线覆盖的中间点，
 *    输出直接驱动 WorldEngine.pathQueue 的连续跟随（路径点即浮点世界坐标）。
 */

import { TILE_PROPERTIES, type TileType } from '@/types/tile-map';

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

export interface PathResult {
  /** 浮点路径点（不含起点；末点 = 目标瓦片中心）。空数组 = 不可达 */
  readonly path: readonly { x: number; y: number }[];
  readonly exploredCount: number;
  readonly durationMs: number;
}

const SQRT2 = Math.SQRT2;
/** 8 方向邻域（对角方向索引 1/3/5/7） */
const DIRS: readonly { dx: number; dy: number; cost: number }[] = [
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: -1, cost: SQRT2 },
  { dx: 1, dy: 0, cost: 1 },
  { dx: 1, dy: 1, cost: SQRT2 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: -1, dy: 1, cost: SQRT2 },
  { dx: -1, dy: 0, cost: 1 },
  { dx: -1, dy: -1, cost: SQRT2 },
];

/** 八向距离启发（可采纳：对角 √2、直线 1，不高估真实代价） */
function octile(x: number, y: number, goalX: number, goalY: number): number {
  const dx = Math.abs(x - goalX);
  const dy = Math.abs(y - goalY);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/** 世界坐标 → 瓦片坐标（瓦片中心 = 整数点，与 WorldEngine.tileX/tileY 同一约定） */
function tileOf(v: number): number {
  return Math.floor(v + 0.5);
}

/**
 * 浮点视线检测：沿线段每 0.2 瓦片采样，任一样点落入不可通行瓦片即阻断。
 * 采样密度保证穿过瓦片角点时也能命中被挡瓦片（防穿角）。
 */
function hasLineOfSight(ax: number, ay: number, bx: number, by: number, isWalkable: (x: number, y: number) => boolean): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / 0.2));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (!isWalkable(tileOf(x), tileOf(y))) return false;
  }
  return true;
}

/**
 * @param startX/startY 起点浮点世界坐标（玩家连续位置；网格搜索以其所在瓦片为源）
 * @param goalX/goalY 目标瓦片坐标（整数 = 瓦片中心）
 * @param isWalkable 世界瓦片可通行查询（由 WorldEngine 注入；未生成区块视为不可通行）
 * @param costAt 地形移动代价（timeMultiplier；默认恒 1 —— 不传则退化为纯距离最优）
 */
export function findPath(
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  isWalkable: (x: number, y: number) => boolean,
  maxIterations = 20000,
  costAt: (x: number, y: number) => number = () => 1,
): PathResult {
  const t0 = performance.now();
  const sx = tileOf(startX);
  const sy = tileOf(startY);
  const empty = { path: [], exploredCount: 0, durationMs: performance.now() - t0 };
  // 目标不可通行直接失败（起点不校验：出生点校正后玩家在瓦片内微偏，所在瓦片恒可通行）
  if (!isWalkable(goalX, goalY)) return empty;

  const open: Node[] = [];
  const gScore = new Map<string, number>();
  const closed = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  const start: Node = { x: sx, y: sy, g: 0, f: octile(sx, sy, goalX, goalY), parent: null };
  open.push(start);
  gScore.set(key(sx, sy), 0);
  let explored = 0;

  let goalNode: Node | null = null;
  while (open.length > 0 && explored < maxIterations) {
    // 取 f 最小节点（线性扫描够用；100 格范围内节点数有限）
    let bestIdx = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const current = open.splice(bestIdx, 1)[0];
    explored += 1;

    if (current.x === goalX && current.y === goalY) {
      goalNode = current;
      break;
    }

    closed.add(key(current.x, current.y));
    for (const d of DIRS) {
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;
      const nk = key(nx, ny);
      if (closed.has(nk) || !isWalkable(nx, ny)) continue;
      // 禁止穿角：对角移动要求两个正交邻居均可通行（否则路径斜穿墙角，与圆形碰撞体冲突）
      if (d.cost > 1 && (!isWalkable(current.x + d.dx, current.y) || !isWalkable(current.x, current.y + d.dy))) continue;
      const g = current.g + d.cost * Math.max(costAt(nx, ny), 0.1);
      if (g < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, g);
        open.push({ x: nx, y: ny, g, f: g + octile(nx, ny, goalX, goalY), parent: current });
      }
    }
  }

  if (!goalNode) return { path: [], exploredCount: explored, durationMs: performance.now() - t0 };

  // 网格路径回溯（瓦片中心整数列）
  const gridPath: { x: number; y: number }[] = [];
  let n: Node | null = goalNode;
  while (n) {
    gridPath.unshift({ x: n.x, y: n.y });
    n = n.parent;
  }

  // 视线拉直（string pulling）：锚点从精确浮点起点开始，贪心取最远可视点 —
  // 阶梯折线被直线段替代，路径点即浮点坐标，直接驱动连续跟随
  const smoothed: { x: number; y: number }[] = [];
  let anchorX = startX;
  let anchorY = startY;
  let i = 0;
  while (i < gridPath.length) {
    let far = i;
    for (let j = gridPath.length - 1; j > i; j -= 1) {
      if (hasLineOfSight(anchorX, anchorY, gridPath[j].x, gridPath[j].y, isWalkable)) {
        far = j;
        break;
      }
    }
    // 跳过与锚点同瓦片的点（玩家已在该瓦片内，直接朝下一可见点走，避免原地打转）
    if (tileOf(gridPath[far].x) === tileOf(anchorX) && tileOf(gridPath[far].y) === tileOf(anchorY) && far + 1 < gridPath.length) {
      far += 1;
    }
    smoothed.push(gridPath[far]);
    anchorX = gridPath[far].x;
    anchorY = gridPath[far].y;
    i = far + 1;
  }

  return { path: smoothed, exploredCount: explored, durationMs: performance.now() - t0 };
}

/** 地形时间乘数查询（模块3 §2.2 移动耗时：road 0.8 / grass 1.0 / forest 1.5 / swamp 1.8） */
export function moveCostOf(tile: TileType): number {
  return TILE_PROPERTIES[tile].timeMultiplier ?? Infinity;
}
