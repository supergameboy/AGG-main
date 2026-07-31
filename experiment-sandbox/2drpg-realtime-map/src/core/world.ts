/**
 * WorldEngine 世界引擎（沙箱总编排）
 * 对应主项目链路：MapProgram（G2 移动/碰撞/视野）+ TileMapService（F 业务）
 * + PrefetchScheduler（模块2）+ ResultPool（模块4）+ BuildingInteriorService（模块6）
 * 的沙箱进程内合并实现。React 通过 Zustand 快照订阅，渲染器通过引擎方法逐帧读取。
 */

import type {
  ChunkCoordinates,
  ChunkMetadata,
  ChunkStatus,
  ChunkTileSlice,
  DecisionSnapshot,
  MapEntity,
  RegionInfo,
  RegionType,
  TileEvent,
  TileType,
} from '@/types/tile-map';
import { MAP_SCALE_CHUNKS, TILE_PROPERTIES } from '@/types/tile-map';
import { worldToChunk, worldToSubChunk, getChunkId } from './chunk-utils';
import { selectGenerator, type GenerationResult } from './generator';
import type { SchedulerConfig } from './scheduler';
import { PrefetchScheduler } from './scheduler';
import { ResultPool } from './result-pool';
import { computeVisibleTiles } from './fov';
import { findPath } from './pathfinder';
import { SubChunkCache } from './lru-cache';
import { EventBus } from './events';
import { perfCollector } from './perf';
import {
  findPlacement,
  generateInterior,
  getTemplateByType,
  interiorWalkable,
  paintBuilding,
  placementRng,
  type InteriorMapData,
  type PlacedBuilding,
} from './buildings';
import { createRng } from './noise';

// ---------------------------------------------------------------------------
// 配置（控制面板各分区写入；引擎热更新）
// ---------------------------------------------------------------------------

export type Direction = 'up' | 'down' | 'left' | 'right';
const DIR_VEC: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * 屏幕方向 → 世界向量（WASD 重映射，模块5 §2.6.4）。
 * 等距/2.5D：屏幕正上 = 世界 (-1,-1) 对角方向 —— 4 个单键走世界对角，组合键走世界主轴，
 * 8 方向覆盖后玩家可到达任意世界方向（纯 4 方向网格映射无法直达世界主轴）。
 * 俯视：恒等映射（组合键走屏幕对角）。
 */
const SCREEN_TO_WORLD: Record<'iso' | 'top', Record<Direction, { dx: number; dy: number }>> = {
  iso: {
    up: { dx: -1, dy: -1 },
    down: { dx: 1, dy: 1 },
    left: { dx: -1, dy: 1 },
    right: { dx: 1, dy: -1 },
  },
  top: DIR_VEC,
};

/** UI 方向 → 区块方向（模块2 §4.2.2 P1 预测输入 / cross_chunk 事件方向） */
const DIR_TO_CHUNK: Record<Direction, 'north' | 'south' | 'east' | 'west'> = { up: 'north', down: 'south', left: 'west', right: 'east' };

/** 玩家碰撞半径（瓦片单位；< 0.5 保证 1 瓦片宽门洞可通过） */
const PLAYER_RADIUS = 0.32;

export interface WorldConfig {
  decisions: DecisionSnapshot;
  seed: number;
  buildingDensity: number; // 0-1 随机放置概率/区块
  moveTilesPerSec: number; // 基础移动速度（瓦片/秒）
  fovRadius: number;
  fogMode: 'off' | 'fog' | 'dark'; // off=全亮 / fog=战争迷雾 / dark=未探索全黑
  scheduler: SchedulerConfig;
  streamLatencyMs: number; // 模拟网络延迟（流式加载观测）
  bufferRadius: number; // 子区块缓冲半径（模块3 §2.4.2）
  evictThreshold: number; // 淘汰阈值（子区块）
  lruCapacity: number;
  autoWalk: { enabled: boolean; pattern: 'zigzag' | 'spiral' | 'random'; speed: number };
}

interface ChunkRecord {
  meta: ChunkMetadata;
  slice: ChunkTileSlice | null;
  buildings: PlacedBuilding[];
}

export interface PlayerSnapshot {
  /** 连续世界坐标（瓦片单位，浮点；瓦片中心=整数点） */
  x: number;
  y: number;
  /** 所在瓦片坐标（由连续位置派生：floor(pos + 0.5)） */
  tileX: number;
  tileY: number;
  facing: Direction;
  mode: 'overworld' | 'interiorA' | 'interiorB';
  floor: number;
  chunkX: number;
  chunkY: number;
  regionId: string | null;
  regionName: string;
  regionType: RegionType;
  interiorLoading: boolean;
  currentBuildingId: string | null;
}

const REGION_NAMES: Readonly<Record<RegionType, string>> = {
  forest: '翡翠森林',
  plain: '风吟平原',
  desert: '黄金沙漠',
  mountain: '灰岩山脉',
  water: '碧波海岸',
  city: '落霞城',
  dungeon: '幽暗地城',
  cave: '回声洞穴',
};
const REGION_CYCLE: readonly RegionType[] = ['forest', 'plain', 'city', 'desert', 'mountain', 'water', 'dungeon', 'cave'];

export class WorldEngine {
  private config: WorldConfig;
  private chunks = new Map<string, ChunkRecord>();
  private pool = new ResultPool();
  private scheduler: PrefetchScheduler;
  private cache = new SubChunkCache<true>(256);
  private notify: () => void;

  // 玩家状态（连续坐标模型：px/py 为唯一位置真源，瓦片坐标由 tileX/tileY 派生）
  private px = 0;
  private py = 0;
  private facing: Direction = 'down';
  private heldInput = new Set<Direction>(); // 屏幕空间按住的方向（WASD/方向键，模块5 §2.6.4）
  private moveHistory: Direction[] = [];
  private pathQueue: { x: number; y: number }[] = [];
  private stuckMs = 0; // 寻路卡死看门狗（贴墙滑动仍无位移 → 放弃路径）
  private prevTileX = 0; // 上次所在瓦片（瓦片变化沿检测：FOV/跨区块/实体事件在此沿触发）
  private prevTileY = 0;

  // FOV / 探索
  private visibleTiles = new Set<string>();
  private exploredTiles = new Set<string>();
  private fovOriginX = Number.NaN; // 上次 FOV 计算原点（浮点；NaN = 未计算，首 tick 必重算）
  private fovOriginY = Number.NaN;

  // 跨区域
  private prevRegionId: string | null = null;
  private bannerSeq = 0;
  private lastBanner: { seq: number; regionName: string; regionType: RegionType; fromName: string | null; at: number } | null = null;

  // 建筑内部
  private mode: 'overworld' | 'interiorA' | 'interiorB' = 'overworld';
  private interior: InteriorMapData | null = null;
  private interiorBuilding: PlacedBuilding | null = null;
  private interiorFloor = 0;
  private interiorLoading = false;

  // 实体
  private removedEntityIds = new Set<string>();

  // 流式加载模拟
  private prevNeededSubChunks = new Set<string>();

  // 自动巡游（连续坐标：腿进度按实际位移计量，撞墙提前换腿）
  private autoWalkState = { legProgress: 0, legIndex: 0, dir: 'right' as Direction, legLen: 12 };
  private autoHeld = new Set<Direction>(['right']); // 巡游当前输入（等效按住一个方向键）

  private worldChunks = 2; // 世界边长（区块数）

  constructor(config: WorldConfig, notify: () => void) {
    this.config = config;
    this.notify = notify;
    this.scheduler = new PrefetchScheduler(
      {
        getChunkStatus: (x, y) => this.chunks.get(getChunkId(x, y))?.meta.status ?? null,
        generateChunk: (x, y, kind, fmt, latency, trigger) => this.generateChunk(x, y, kind, fmt, latency, trigger),
        getRegionFor: (x, y) => this.regionFor(x, y),
        putMapToPool: (key, priority) => this.pool.putMap(key, priority),
      },
      config.scheduler,
    );
    this.regenerateWorld();
  }

  // -------------------------------------------------------------------------
  // 配置与世界生命周期
  // -------------------------------------------------------------------------

  updateConfig(patch: Partial<WorldConfig>): void {
    const prev = this.config;
    this.config = { ...this.config, ...patch };
    if (patch.scheduler) this.scheduler.updateConfig(patch.scheduler);
    if (patch.lruCapacity !== undefined) this.cache.setCapacity(patch.lruCapacity);
    if (patch.fovRadius !== undefined && patch.fovRadius !== prev.fovRadius) this.recomputeFov();
    // 影响世界结构的决策 → 重建世界（附录E 区块大小 / 规模 / 种子）
    const d0 = prev.decisions;
    const d1 = this.config.decisions;
    if (
      d0.chunkSize !== d1.chunkSize ||
      d0.mapScale !== d1.mapScale ||
      patch.seed !== undefined && patch.seed !== prev.seed
    ) {
      this.regenerateWorld();
    }
    this.notify();
  }

  getConfig(): WorldConfig {
    return this.config;
  }

  get worldChunksCount(): number {
    return this.worldChunks;
  }

  /** 世界重建（种子/规模/区块大小变更时） */
  regenerateWorld(): void {
    const { decisions } = this.config;
    this.worldChunks = MAP_SCALE_CHUNKS[decisions.mapScale];
    this.chunks.clear();
    this.pool.clear();
    this.scheduler.cancelAll();
    this.cache.clear();
    this.exploredTiles.clear();
    this.visibleTiles.clear();
    this.removedEntityIds.clear();
    this.moveHistory = [];
    this.pathQueue = [];
    this.prevNeededSubChunks.clear();
    this.prevRegionId = null;
    this.mode = 'overworld';
    this.interior = null;
    this.interiorBuilding = null;
    EventBus.clearRecent();

    // 初始区块即时生成（对应模块5 §2.5.3 InitTileMapStepHandler 同步路径：玩家开局不等待 LLM）
    const center = Math.floor(this.worldChunks / 2);
    const size = decisions.chunkSize;
    this.px = center * size + Math.floor(size / 2);
    this.py = center * size + Math.floor(size / 2);
    this.prevTileX = this.tileX;
    this.prevTileY = this.tileY;
    this.heldInput.clear();
    this.stuckMs = 0;
    this.generateChunkSync(center, center, 'procedural');
    this.prevRegionId = this.regionFor(center, center).regionId;
    this.recomputeFov();
    // 初始化完成 → P0 邻居预生成（总规划阶段1：PrefetchScheduler.scheduleTriggers(P0 邻居)）
    this.scheduler.evaluateAndEnqueue({ chunkX: center, chunkY: center }, []);
    this.notify();
  }

  // -------------------------------------------------------------------------
  // 区域（模块5 横幅 + 模块2 locationHint）
  // -------------------------------------------------------------------------

  regionFor(chunkX: number, chunkY: number): RegionInfo {
    const regionSize = Math.max(1, Math.round(this.worldChunks / 4));
    const rx = Math.floor(chunkX / regionSize);
    const ry = Math.floor(chunkY / regionSize);
    const idx = Math.abs((rx * 7 + ry * 13 + this.config.seed) % REGION_CYCLE.length);
    const type = REGION_CYCLE[idx];
    return { regionId: `region_${rx}_${ry}`, regionName: REGION_NAMES[type], regionType: type };
  }

  // -------------------------------------------------------------------------
  // 区块生成（调度器 deps.generateChunk 实现）
  // -------------------------------------------------------------------------

  private async generateChunk(
    chunkX: number,
    chunkY: number,
    kind: DecisionSnapshot['generatorKind'],
    format: DecisionSnapshot['outputFormat'],
    mockLlmLatencyMs: number,
    triggerType: string,
  ): Promise<boolean> {
    const key = getChunkId(chunkX, chunkY);
    if (chunkX < 0 || chunkY < 0 || chunkX >= this.worldChunks || chunkY >= this.worldChunks) return false;
    let rec = this.chunks.get(key);
    if (rec && rec.meta.status === 'ready') return true;
    const region = this.regionFor(chunkX, chunkY);
    const now = Date.now();
    rec = {
      meta: { chunkId: key, chunkX, chunkY, status: 'generating', generatedBy: 'procedural', failureReason: null, retryCount: rec?.meta.retryCount ?? 0, createdAt: rec?.meta.createdAt ?? now, updatedAt: now, regionId: region.regionId },
      slice: null,
      buildings: rec?.buildings ?? [],
    };
    this.chunks.set(key, rec);
    EventBus.emit('chunk.status_changed', { chunkX, chunkY, from: 'pending', to: 'generating' });
    this.notify();

    const generator = selectGenerator(kind, region.regionType);
    let result: GenerationResult;
    try {
      result = await generator.generate({
        chunkX,
        chunkY,
        chunkSize: this.config.decisions.chunkSize,
        seed: this.config.seed,
        region,
        neighborBoundaries:
          this.config.decisions.boundaryStrategy === 'context_aware' ? this.collectNeighborBoundaries(chunkX, chunkY) : [],
        outputFormat: format,
        mockLlmLatencyMs,
        onLog: (line) => EventBus.emit('renderer.note', { source: `chunk(${chunkX},${chunkY})`, line }),
      });
    } catch (err) {
      rec.meta = { ...rec.meta, status: 'failed', failureReason: String(err), retryCount: rec.meta.retryCount + 1, updatedAt: Date.now() };
      EventBus.emit('chunk.failed', { chunkX, chunkY, failureReason: String(err), retryCount: rec.meta.retryCount });
      this.notify();
      return false;
    }

    rec.slice = result.slice;
    rec.meta = { ...rec.meta, status: 'ready', generatedBy: result.generatorType === 'mock' ? 'llm' : 'procedural', updatedAt: Date.now() };
    this.placeBuildings(rec, result.placementHints);
    if (result.generatorType === 'mock' && result.tokenUsage) {
      perfCollector.recordLLMCall(result.durationMs, true, result.tokenUsage.total, key);
    }
    EventBus.emit('chunk.ready', { chunkX, chunkY, generatedBy: rec.meta.generatedBy, durationMs: result.durationMs, trigger: triggerType });
    this.notify();
    return true;
  }

  /** 同步即时生成（初始化/兜底路径） */
  private generateChunkSync(chunkX: number, chunkY: number, force: 'procedural'): void {
    const key = getChunkId(chunkX, chunkY);
    const region = this.regionFor(chunkX, chunkY);
    const generator = selectGenerator(force, region.regionType);
    // ProceduralGenerator.generate 实际为同步计算，这里直接复用异步接口并立即取值
    void generator
      .generate({
        chunkX,
        chunkY,
        chunkSize: this.config.decisions.chunkSize,
        seed: this.config.seed,
        region,
        neighborBoundaries: [],
        outputFormat: this.config.decisions.outputFormat,
        mockLlmLatencyMs: 0,
      })
      .then((result) => {
        const now = Date.now();
        const rec: ChunkRecord = {
          meta: { chunkId: key, chunkX, chunkY, status: 'ready', generatedBy: 'procedural', failureReason: null, retryCount: 0, createdAt: now, updatedAt: now, regionId: region.regionId },
          slice: result.slice,
          buildings: [],
        };
        this.chunks.set(key, rec);
        this.placeBuildings(rec, result.placementHints);
        EventBus.emit('chunk.ready', { chunkX, chunkY, generatedBy: 'procedural', durationMs: result.durationMs, trigger: 'init' });
        // 出生点校正：若落点不可通行（如水域），螺旋扫描最近可通行瓦片
        this.snapPlayerToWalkable();
        this.recomputeFov();
        this.notify();
      });
  }

  /** 策略B context_aware：收集已 ready 邻居边界 1 列（模块2 §4.2.6） */
  private collectNeighborBoundaries(chunkX: number, chunkY: number) {
    const size = this.config.decisions.chunkSize;
    const out: import('./boundary-strategy').NeighborBoundary[] = [];
    const dirs = [
      { dir: 'north' as const, nx: chunkX, ny: chunkY - 1, pick: (s: ChunkTileSlice) => s.tiles[size - 1] },
      { dir: 'south' as const, nx: chunkX, ny: chunkY + 1, pick: (s: ChunkTileSlice) => s.tiles[0] },
      { dir: 'west' as const, nx: chunkX - 1, ny: chunkY, pick: (s: ChunkTileSlice) => s.tiles.map((r) => r[size - 1]) },
      { dir: 'east' as const, nx: chunkX + 1, ny: chunkY, pick: (s: ChunkTileSlice) => s.tiles.map((r) => r[0]) },
    ];
    for (const d of dirs) {
      const rec = this.chunks.get(getChunkId(d.nx, d.ny));
      if (rec?.meta.status === 'ready' && rec.slice) {
        const edgeTiles = d.pick(rec.slice);
        const roadExits: number[] = [];
        edgeTiles.forEach((t, i) => {
          if (t === 'road' || t === 'bridge') roadExits.push(i);
        });
        out.push({ direction: d.dir, ready: true, edgeTiles, roadExits });
      } else {
        out.push({ direction: d.dir, ready: false, edgeTiles: [], roadExits: [] });
      }
    }
    return out;
  }

  /** 建筑物放置（模块6 §2.1.6 BuildingPlacementAlgorithm：hints 优先 → 随机补充） */
  private placeBuildings(rec: ChunkRecord, hints: readonly { x: number; y: number; buildingType: string }[]): void {
    if (!rec.slice) return;
    const size = this.config.decisions.chunkSize;
    const rng = placementRng(this.config.seed, rec.meta.chunkX, rec.meta.chunkY);
    let seq = 0;
    const place = (buildingType: string, hintAt?: { x: number; y: number }): void => {
      const template = getTemplateByType(buildingType, rng);
      const spot = hintAt
        ? { localX: hintAt.x, localY: hintAt.y }
        : findPlacement(rec.slice!.tiles, rec.meta.chunkX, rec.meta.chunkY, size, template, rec.buildings, rng);
      if (!spot) return;
      // hint 位置同样校验地形（LLM hint 可能落在水/山上 → 回退随机扫描）
      const terrainOk = spot.localX >= 0 && spot.localY >= 0 && rec.slice!.tiles[spot.localY]?.[spot.localX] && ['grass', 'sand', 'road', 'snow'].includes(rec.slice!.tiles[spot.localY][spot.localX]);
      const finalSpot = terrainOk ? spot : findPlacement(rec.slice!.tiles, rec.meta.chunkX, rec.meta.chunkY, size, template, rec.buildings, rng);
      if (!finalSpot) return;
      const b = paintBuilding(rec.slice!.tiles, rec.meta.chunkX, rec.meta.chunkY, size, template, finalSpot.localX, finalSpot.localY, seq);
      seq += 1;
      rec.buildings.push(b);
      rec.slice!.entities.push({
        id: `ent_${b.buildingId}`,
        type: 'building',
        x: b.doorWorld.x,
        y: b.doorWorld.y,
        entityRefId: b.buildingId,
        spriteId: null,
        interactable: true,
        visible: true,
        state: null,
      });
      EventBus.emit('building.placed', { buildingId: b.buildingId, chunkX: rec.meta.chunkX, chunkY: rec.meta.chunkY, buildingType: b.buildingType });
    };
    // hints（附录E §2.4：LLM 建议优先）
    for (const h of hints) {
      if (rec.buildings.length >= 3) break;
      place(h.buildingType, { x: h.x, y: h.y });
    }
    // 随机补充（密度控制）
    if (rec.buildings.length === 0 && rng() < this.config.buildingDensity) {
      const types = ['house', 'shop', 'tavern', 'temple', 'tower'];
      place(types[Math.floor(rng() * types.length)]);
      if (rng() < 0.35) place('house');
    }
  }

  // -------------------------------------------------------------------------
  // 移动与碰撞（MapProgram.moveCharacter 沙箱语义：连续坐标 + 贴墙滑动）
  // 模型：px/py 浮点位置是唯一真源；瓦片坐标 tileX/tileY 派生（瓦片中心=整数点 ⇒ floor(pos+0.5)）。
  // 输入为屏幕空间 8 方向集合，每 tick 按当前渲染风格映射为世界向量（等距重映射见 SCREEN_TO_WORLD）。
  // -------------------------------------------------------------------------

  /** 玩家所在瓦片 X（连续位置派生） */
  get tileX(): number {
    return Math.floor(this.px + 0.5);
  }

  /** 玩家所在瓦片 Y（连续位置派生） */
  get tileY(): number {
    return Math.floor(this.py + 0.5);
  }

  /** 按住的方向集合（屏幕空间；手动输入优先于点击寻路） */
  setHeldInput(dirs: ReadonlySet<Direction>): void {
    this.heldInput = new Set(dirs);
    if (this.heldInput.size > 0) {
      this.pathQueue = [];
      this.stuckMs = 0;
    }
  }

  /** 屏幕方向集合 → 单位世界向量（等距/2.5D 走对角映射，俯视恒等；空集 → 零向量） */
  private inputToWorld(input: ReadonlySet<Direction>): { vx: number; vy: number } {
    const map = this.config.decisions.renderStyle === 'top_down' ? SCREEN_TO_WORLD.top : SCREEN_TO_WORLD.iso;
    let vx = 0;
    let vy = 0;
    input.forEach((d) => {
      vx += map[d].dx;
      vy += map[d].dy;
    });
    const len = Math.hypot(vx, vy);
    return len > 0 ? { vx: vx / len, vy: vy / len } : { vx: 0, vy: 0 };
  }

  /**
   * 圆形碰撞体 vs 瓦片网格（贴墙滑动的轴向探测）。
   * 实心瓦片视为 [tx-0.5, tx+0.5]² AABB（含实体阻挡，walkableAt 统一裁决）；
   * 圆心到 AABB 最近点距离 < PLAYER_RADIUS 即碰撞。
   */
  private circleCollides(cx: number, cy: number): boolean {
    const r = PLAYER_RADIUS;
    const x0 = Math.floor(cx - r + 0.5);
    const x1 = Math.floor(cx + r + 0.5);
    const y0 = Math.floor(cy - r + 0.5);
    const y1 = Math.floor(cy + r + 0.5);
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        if (this.walkableAt(tx, ty)) continue;
        const nx = Math.max(tx - 0.5, Math.min(cx, tx + 0.5));
        const ny = Math.max(ty - 0.5, Math.min(cy, ty + 0.5));
        const dx = cx - nx;
        const dy = cy - ny;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  get isAutoWalking(): boolean {
    return this.config.autoWalk.enabled;
  }

  /** 点击移动（moveCharacterTo：浮点 A* 寻路 → tick 内逐路径点转向跟随；路径点已为浮点坐标，直接入队） */
  moveTo(x: number, y: number): void {
    const result = findPath(
      this.px,
      this.py,
      x,
      y,
      (wx, wy) => this.walkableAt(wx, wy),
      20000,
      (wx, wy) => {
        // 地形时间乘数计入路径代价（模块3 §2.2：road 0.8 偏好道路，swamp 1.8 规避沼泽）
        if (this.mode !== 'overworld') return 1;
        return TILE_PROPERTIES[this.getTileAt(wx, wy)].timeMultiplier ?? 1;
      },
    );
    if (result.path.length > 0) {
      this.pathQueue = [...result.path];
      this.stuckMs = 0;
    }
  }

  /** 出生点校正（初始化/世界重建后：螺旋扫描最近无碰撞落点） */
  private snapPlayerToWalkable(): void {
    if (!this.circleCollides(this.px, this.py)) return;
    const cx = this.tileX;
    const cy = this.tileY;
    for (let r = 1; r < 24; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.circleCollides(nx, ny)) {
            this.px = nx;
            this.py = ny;
            this.prevTileX = nx;
            this.prevTileY = ny;
            return;
          }
        }
      }
    }
  }

  /** 可通行判定（瓦片 walkable + 实体阻挡 + 世界边界 + 建筑内部约束） */
  walkableAt(x: number, y: number): boolean {
    if (this.mode === 'interiorA') {
      if (!this.interior) return false;
      return interiorWalkable(this.interior, this.interiorFloor, x, y);
    }
    if (this.mode === 'interiorB' && this.interior && this.interiorBuilding) {
      const lx = x - this.interiorBuilding.worldX;
      const ly = y - this.interiorBuilding.worldY;
      return interiorWalkable(this.interior, this.interiorFloor, lx, ly);
    }
    const tile = this.getTileAt(x, y);
    const prop = TILE_PROPERTIES[tile];
    if (!prop.walkable) return false;
    // 实体阻挡（不可交互实体挡路；可交互实体不阻挡但触发事件）
    const ent = this.entityAt(x, y);
    if (ent && !ent.interactable) return false;
    return true;
  }

  getTileAt(x: number, y: number): TileType {
    const size = this.config.decisions.chunkSize;
    if (x < 0 || y < 0 || x >= this.worldChunks * size || y >= this.worldChunks * size) return 'void';
    const { chunkX, chunkY } = worldToChunk(x, y, size);
    const rec = this.chunks.get(getChunkId(chunkX, chunkY));
    if (!rec || rec.meta.status !== 'ready' || !rec.slice) return 'void';
    return rec.slice.tiles[y - chunkY * size][x - chunkX * size];
  }

  getChunkStatusAt(x: number, y: number): ChunkStatus | 'out_of_world' {
    const size = this.config.decisions.chunkSize;
    if (x < 0 || y < 0 || x >= this.worldChunks * size || y >= this.worldChunks * size) return 'out_of_world';
    const { chunkX, chunkY } = worldToChunk(x, y, size);
    return this.chunks.get(getChunkId(chunkX, chunkY))?.meta.status ?? 'pending';
  }

  entityAt(x: number, y: number): MapEntity | null {
    const size = this.config.decisions.chunkSize;
    const { chunkX, chunkY } = worldToChunk(x, y, size);
    const rec = this.chunks.get(getChunkId(chunkX, chunkY));
    if (!rec?.slice) return null;
    return rec.slice.entities.find((e) => e.x === x && e.y === y && e.visible && !this.removedEntityIds.has(e.id)) ?? null;
  }

  // -------------------------------------------------------------------------
  // 游戏循环（rAF 驱动：连续位移 + 贴墙滑动 + 路径跟随 + 自动巡游 + 流式加载模拟）
  // -------------------------------------------------------------------------

  tick(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;

    // —— 速度向量（优先级：点击寻路 > 按键输入/自动巡游；手动输入在 setHeldInput 时已清空路径）——
    let vx = 0;
    let vy = 0;
    if (this.pathQueue.length > 0) {
      const next = this.pathQueue[0];
      const dx = next.x - this.px;
      const dy = next.y - this.py;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.15) {
        this.pathQueue.shift();
      } else {
        vx = dx / dist;
        vy = dy / dist;
      }
    } else {
      const auto = this.config.autoWalk.enabled && this.mode === 'overworld';
      const v = this.inputToWorld(auto ? this.autoHeld : this.heldInput);
      vx = v.vx;
      vy = v.vy;
    }

    // —— 地形速度调制（附录A §3.3 timeMultiplier：>1 减速，如沼泽/雪地）——
    const curTile = this.mode === 'overworld' ? this.getTileAt(this.tileX, this.tileY) : 'floor';
    const mult = TILE_PROPERTIES[curTile].timeMultiplier ?? 1;
    const speed = this.config.moveTilesPerSec / Math.max(mult, 0.4);

    // —— 连续积分 + 贴墙滑动（轴向分离：单轴碰撞只回退该轴，另一轴继续 → 沿墙滑行）——
    const wantX = vx * speed * dt;
    const wantY = vy * speed * dt;
    let gotX = 0;
    let gotY = 0;
    if (wantX !== 0 && !this.circleCollides(this.px + wantX, this.py)) {
      this.px += wantX;
      gotX = wantX;
    }
    if (wantY !== 0 && !this.circleCollides(this.px, this.py + wantY)) {
      this.py += wantY;
      gotY = wantY;
    }
    const movedDist = Math.hypot(gotX, gotY);
    const blocked = (vx !== 0 || vy !== 0) && movedDist < speed * dt * 0.25;

    // —— 朝向（世界主方向；interact 面前判定 + 渲染朝向标记共用）——
    if (vx !== 0 || vy !== 0) {
      this.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
    }

    // —— 寻路卡死看门狗（贴墙滑动仍无法接近路径点 → 放弃路径，避免永久顶墙）——
    if (this.pathQueue.length > 0) {
      if (blocked) {
        this.stuckMs += dtMs;
        if (this.stuckMs > 600) {
          this.pathQueue = [];
          this.stuckMs = 0;
        }
      } else {
        this.stuckMs = 0;
      }
    }

    // —— 自动巡游腿推进（模块7 §3.2.5：按实际位移计量，撞墙提前换腿）——
    if (this.config.autoWalk.enabled && this.mode === 'overworld') {
      this.autoWalkAdvance(movedDist, blocked);
    }

    // —— 瓦片变化沿（FOV/跨区块/跨区域/实体事件在此沿触发，与离散步模型语义一致）——
    const tx = this.tileX;
    const ty = this.tileY;
    if (tx !== this.prevTileX || ty !== this.prevTileY) {
      this.onEnterTile(tx, ty);
      this.prevTileX = tx;
      this.prevTileY = ty;
    }

    // —— FOV 浮点重算（连续位移即重算：可见区跟随浮点位置平滑变化，不随瓦片跳动）——
    if (this.px !== this.fovOriginX || this.py !== this.fovOriginY) {
      this.recomputeFov();
    }

    this.updateStreamingSim();
  }

  /** 进入新瓦片的联动：内部瓦片触发/跨区块/跨区域/实体事件/FOV（原离散步 afterStep 语义） */
  private onEnterTile(x: number, y: number): void {
    const size = this.config.decisions.chunkSize;
    // —— 建筑内部：门/楼梯瓦片触发（附录B E.3/E.4 transition.activated / stairs.entered）——
    if (this.mode !== 'overworld') {
      this.checkInteriorTiles();
      this.recomputeFov();
      return;
    }
    this.moveHistory.push(this.facing);
    if (this.moveHistory.length > 8) this.moveHistory.shift();
    EventBus.emit('player.moved', { fromX: this.prevTileX, fromY: this.prevTileY, toX: x, toY: y, direction: this.facing });
    const curr = worldToChunk(x, y, size);
    const prevChunk = worldToChunk(this.prevTileX, this.prevTileY, size);
    if (curr.chunkX !== prevChunk.chunkX || curr.chunkY !== prevChunk.chunkY) {
      EventBus.emit('player.cross_chunk', { fromChunk: prevChunk, toChunk: curr, direction: DIR_TO_CHUNK[this.facing] });
      this.onEnterChunk(curr);
    }
    // 跨区域检测（模块3 §2.4.8 CrossChunkDetector → 模块5 横幅）
    const region = this.regionFor(curr.chunkX, curr.chunkY);
    if (region.regionId !== this.prevRegionId) {
      const fromName = this.prevRegionId ? this.regionNameOf(this.prevRegionId) : null;
      this.prevRegionId = region.regionId;
      if (fromName !== null) {
        // 首次进入不触发（模块5 §2.2.3）
        this.bannerSeq += 1;
        this.lastBanner = { seq: this.bannerSeq, regionName: region.regionName, regionType: region.regionType, fromName, at: Date.now() };
        EventBus.emit('player.cross_region', { fromRegionId: fromName, toRegionId: region.regionId, toRegionName: region.regionName });
      }
    }
    // 实体接触事件（模块3 §2.2.4 TileEvent）
    const ent = this.entityAt(x, y);
    if (ent && ent.interactable && ent.type !== 'building') {
      const typeMap: Record<string, TileEvent['type']> = { enemy: 'combat', npc: 'dialogue', chest: 'discovery', item: 'discovery', portal: 'story' };
      const evtType = typeMap[ent.type] ?? 'ambient';
      EventBus.emit('tile_event.triggered', { eventType: evtType, position: { x: ent.x, y: ent.y }, entityRefId: ent.entityRefId });
      if (evtType === 'discovery') this.removedEntityIds.add(ent.id);
      // 叙事推送（模块4 narrative_pool 风味：地形/遭遇描述）
      EventBus.emit('narrative.push', { triggerType: evtType, text: narrativeFor(evtType, ent.entityRefId) });
    }
    this.recomputeFov();
    this.notify();
  }

  private regionNameOf(regionId: string): string {
    const [rx, ry] = regionId.replace('region_', '').split('_').map(Number);
    const idx = Math.abs((rx * 7 + ry * 13 + this.config.seed) % REGION_CYCLE.length);
    return REGION_NAMES[REGION_CYCLE[idx]];
  }

  /** 进入新区块：结果池命中检查 + P0/P1 触发评估（模块2/4 集成链路） */
  private onEnterChunk(chunk: ChunkCoordinates): void {
    const key = `${chunk.chunkX}:${chunk.chunkY}`;
    const status = this.chunks.get(getChunkId(chunk.chunkX, chunk.chunkY))?.meta.status;
    if (status === 'ready') {
      this.pool.getMap(key); // 命中审计（模块7 命中率采集）
      this.pool.consumeMap(key);
    } else {
      // 未预生成 → 实时生成 fallback（模块4 Failure path：map_pool 未命中 → 同步生成）
      this.pool.getMap(key);
      this.scheduler.enqueueManual(chunk.chunkX, chunk.chunkY, 0);
    }
    // P1 方向预测（模块2 §4.2.2：moveHistory 为最近世界主方向序列）
    this.scheduler.evaluateAndEnqueue(chunk, this.moveHistory.map((d) => DIR_TO_CHUNK[d]));
  }

  // -------------------------------------------------------------------------
  // FOV / 探索（模块3 §2.3 + 模块5 §3.2.2 迷雾）
  // -------------------------------------------------------------------------

  private recomputeFov(): void {
    const radius = this.config.fovRadius;
    // 浮点原点：可见区跟随连续位置平滑变化（渲染优先，与位移同一坐标真源）
    this.visibleTiles = computeVisibleTiles(this.px, this.py, radius, (x, y) => {
      if (this.mode === 'interiorA') {
        if (!this.interior) return null;
        const grid = this.interior.floors[this.interiorFloor];
        return grid[y]?.[x] ?? null;
      }
      if (this.mode === 'interiorB' && this.interior && this.interiorBuilding) {
        const lx = x - this.interiorBuilding.worldX;
        const ly = y - this.interiorBuilding.worldY;
        return this.interior.floors[this.interiorFloor][ly]?.[lx] ?? null;
      }
      return this.getTileAt(x, y);
    });
    // 已探索按迷雾命名空间隔离持久化（修复"未探索先渲染"：室内局部坐标与大地图世界坐标
    // 共用同一 Set 会互相污染 —— 室内 (3,5) 把大地图 (3,5) 标记为已探索，反之亦然）
    const scope = this.fogScope();
    this.visibleTiles.forEach((k) => this.exploredTiles.add(`${scope}:${k}`));
    this.fovOriginX = this.px;
    this.fovOriginY = this.py;
  }

  /**
   * 迷雾坐标命名空间：overworld=世界坐标；interiorA=建筑内部局部坐标；interiorB=同图世界坐标。
   * interiorA 局部坐标与 overworld 世界坐标数值域重叠，必须隔离；
   * interiorB 虽用世界坐标，但语义是"建筑内部探索"（从外面路过 ≠ 探索过内部房间），同样隔离。
   */
  private fogScope(): string {
    if (this.mode === 'interiorA') return `iA:${this.interiorBuilding?.buildingId ?? ''}`;
    if (this.mode === 'interiorB') return `iB:${this.interiorBuilding?.buildingId ?? ''}`;
    return 'ow';
  }

  isVisibleNow(x: number, y: number): boolean {
    return this.visibleTiles.has(`${x},${y}`);
  }

  isExplored(x: number, y: number): boolean {
    return this.exploredTiles.has(`${this.fogScope()}:${x},${y}`);
  }

  // -------------------------------------------------------------------------
  // 建筑物进入/退出/切层（模块6 BuildingInteriorService 路由 A/B）
  // -------------------------------------------------------------------------

  /** 交互键（E）：进入建筑 / 与实体交互（邻近容错：门口 2 格内按 E 进入最近建筑） */
  interact(): void {
    if (this.mode !== 'overworld') return;
    // 面前一格实体优先
    const { dx, dy } = DIR_VEC[this.facing];
    const fx = this.tileX + dx;
    const fy = this.tileY + dy;
    const ent = this.entityAt(fx, fy) ?? this.entityAt(this.tileX, this.tileY);
    if (ent) {
      if (ent.type === 'building') {
        const b = this.findBuilding(ent.entityRefId);
        if (b) this.enterBuilding(b);
      } else {
        EventBus.emit('tile_event.triggered', { eventType: ent.type === 'npc' ? 'dialogue' : 'discovery', position: { x: ent.x, y: ent.y }, entityRefId: ent.entityRefId });
        if (ent.type === 'chest' || ent.type === 'item') this.removedEntityIds.add(ent.id);
      }
      return;
    }
    // 邻近建筑门口探测（修复"找不到门按 E 无反应"：门 2 格内进入最近建筑）
    const near = this.nearestDoor(this.tileX, this.tileY, 2);
    if (near) this.enterBuilding(near);
  }

  /** 最近建筑门口（maxDist 瓦片内；渲染器门口提示与 interact 容错共用） */
  nearestDoor(x: number, y: number, maxDist: number): PlacedBuilding | null {
    let best: PlacedBuilding | null = null;
    let bestD = maxDist + 1;
    for (const rec of this.chunks.values()) {
      if (rec.meta.status !== 'ready') continue;
      for (const b of rec.buildings) {
        const d = Math.max(Math.abs(b.doorWorld.x - x), Math.abs(b.doorWorld.y - y));
        if (d <= maxDist && d < bestD) {
          bestD = d;
          best = b;
        }
      }
    }
    return best;
  }

  private findBuilding(buildingId: string): PlacedBuilding | null {
    for (const rec of this.chunks.values()) {
      const b = rec.buildings.find((bb) => bb.buildingId === buildingId);
      if (b) return b;
    }
    return null;
  }

  enterBuilding(building: PlacedBuilding): void {
    const scheme = this.config.decisions.interiorScheme;
    this.interior = generateInterior(building);
    this.interiorBuilding = building;
    this.interiorFloor = 0;
    perfCollector.recordStreamLoad({ at: Date.now(), durationMs: scheme === 'A' ? 180 : 35, cacheHit: scheme === 'B' });
    if (scheme === 'A') {
      // 方案A：独立瓦片地图（模拟 200ms 地图切换延迟，模块6 §3.4 进入延迟目标 <200ms）
      this.interiorLoading = true;
      this.notify();
      setTimeout(() => {
        this.mode = 'interiorA';
        this.interiorLoading = false;
        this.px = this.interior!.spawn.x;
        this.py = this.interior!.spawn.y;
        this.prevTileX = this.tileX;
        this.prevTileY = this.tileY;
        this.recomputeFov();
        EventBus.emit('building.entered', { buildingId: building.buildingId, scheme: 'A', interiorMapId: `interior_${building.buildingId}` });
        this.notify();
      }, 180);
    } else {
      // 方案B：同图 Z 轴分层（<50ms 切层；内外等大 —— 内部坐标 + 建筑左上角 = 世界坐标）
      this.mode = 'interiorB';
      const wx = building.worldX + this.interior.spawn.x;
      const wy = building.worldY + this.interior.spawn.y;
      this.px = wx;
      this.py = wy;
      this.prevTileX = this.tileX;
      this.prevTileY = this.tileY;
      this.recomputeFov();
      EventBus.emit('building.entered', { buildingId: building.buildingId, scheme: 'B', zLayer: 2 });
      EventBus.emit('zlayer.changed', { buildingId: building.buildingId, fromZ: 0, toZ: 2, trigger: 'door' });
      this.notify();
    }
  }

  exitBuilding(): void {
    if (this.mode === 'overworld' || !this.interiorBuilding) return;
    const b = this.interiorBuilding;
    // 门恒在占地底行/南侧（附录C §3 可视面约束：北向门会被屋顶遮挡），门外 = 门南 1 瓦片。
    // 旧版错放门北（y-1 = 占地内实心墙瓦片）→ 玩家嵌进墙体，圆碰撞双轴锁死永久卡死。
    const out = { x: b.doorWorld.x, y: b.doorWorld.y + 1 }; // 门口外 1 瓦片（门朝南）
    this.mode = 'overworld';
    this.interior = null;
    this.interiorBuilding = null;
    this.interiorFloor = 0;
    this.px = out.x;
    this.py = out.y;
    // 兜底：门口南侧被水域/实体等占据时，螺旋扫描最近无碰撞落点
    this.snapPlayerToWalkable();
    this.prevTileX = this.tileX;
    this.prevTileY = this.tileY;
    this.recomputeFov();
    EventBus.emit('building.exited', { buildingId: b.buildingId, exteriorPosition: { x: this.px, y: this.py } });
    this.notify();
  }

  /** 建筑内部瓦片触发：门=退出 / 楼梯=切层（方案B 楼梯切层，附录C §5.2） */
  private checkInteriorTiles(): void {
    if (!this.interior) return;
    const floor = this.interior.floors[this.interiorFloor];
    let lx = this.tileX;
    let ly = this.tileY;
    if (this.mode === 'interiorB' && this.interiorBuilding) {
      lx = this.tileX - this.interiorBuilding.worldX;
      ly = this.tileY - this.interiorBuilding.worldY;
    }
    const tile = floor[ly]?.[lx];
    if (tile === 'door') {
      this.exitBuilding();
      return;
    }
    if (tile === 'stairs' && this.interior.floors.length > 1) {
      const prevFloor = this.interiorFloor;
      const nextFloor = prevFloor === 0 ? 1 : 0;
      this.interiorFloor = nextFloor;
      EventBus.emit('stairs.entered', { buildingId: this.interior.buildingId, fromZ: prevFloor === 0 ? 2 : 3, toZ: nextFloor === 0 ? 2 : 3 });
      EventBus.emit('zlayer.changed', { buildingId: this.interior.buildingId, fromZ: prevFloor === 0 ? 2 : 3, toZ: nextFloor === 0 ? 2 : 3, trigger: 'stairs' });
      this.notify();
    }
  }

  // -------------------------------------------------------------------------
  // 自动巡游（模块7 §3.2.5：之字形/螺旋/随机）
  // -------------------------------------------------------------------------

  private autoWalkRng: (() => number) | null = null;

  setAutoWalk(enabled: boolean, pattern?: 'zigzag' | 'spiral' | 'random', speed?: number): void {
    this.config = {
      ...this.config,
      autoWalk: { enabled, pattern: pattern ?? this.config.autoWalk.pattern, speed: speed ?? this.config.autoWalk.speed },
    };
    if (enabled) {
      this.config = { ...this.config, moveTilesPerSec: this.config.autoWalk.speed };
      this.autoWalkRng = createRng(Date.now() % 100000);
      this.autoWalkState = { legProgress: 0, legIndex: 0, dir: 'right', legLen: 12 };
      this.setAutoDir('right');
    }
    this.notify();
  }

  /** 巡游腿推进（连续模型：方向经 autoHeld 注入 tick 输入；腿进度按实际位移计量，撞墙提前换腿） */
  private autoWalkAdvance(movedDist: number, blocked: boolean): void {
    const s = this.autoWalkState;
    s.legProgress += movedDist;
    if (!blocked && s.legProgress < s.legLen) return;
    s.legProgress = 0;
    const pattern = this.config.autoWalk.pattern;
    if (pattern === 'random') {
      const dirs: Direction[] = ['up', 'down', 'left', 'right'];
      this.setAutoDir(dirs[Math.floor((this.autoWalkRng?.() ?? Math.random()) * 4)]);
      s.legLen = 3 + Math.floor((this.autoWalkRng?.() ?? Math.random()) * 8);
      return;
    }
    s.legIndex += 1;
    if (pattern === 'zigzag') {
      const legs: ReadonlyArray<{ dir: Direction; len: number }> = [
        { dir: 'right', len: 12 },
        { dir: 'down', len: 2 },
        { dir: 'left', len: 12 },
        { dir: 'down', len: 2 },
      ];
      const leg = legs[s.legIndex % 4];
      this.setAutoDir(leg.dir);
      s.legLen = leg.len;
      return;
    }
    // spiral：边长递增的方形螺旋
    const dirs: Direction[] = ['right', 'down', 'left', 'up'];
    this.setAutoDir(dirs[s.legIndex % 4]);
    s.legLen = Math.min(4 + Math.floor(s.legIndex / 2) * 2, 20);
  }

  /** 巡游换向（同步更新等效按键输入集合） */
  private setAutoDir(dir: Direction): void {
    this.autoWalkState.dir = dir;
    this.autoHeld.clear();
    this.autoHeld.add(dir);
  }

  // -------------------------------------------------------------------------
  // 流式加载模拟（模块3 §2.4：视口子区块 + 缓冲 + LRU + 加载延迟观测）
  // -------------------------------------------------------------------------

  private updateStreamingSim(): void {
    const center = worldToSubChunk(this.tileX, this.tileY);
    const radius = 1 + this.config.bufferRadius; // 视口本体 1 圈 + 缓冲
    const needed = new Set<string>();
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        needed.add(`${center.subChunkX + dx}:${center.subChunkY + dy}`);
      }
    }
    for (const key of needed) {
      if (this.prevNeededSubChunks.has(key)) continue;
      if (this.cache.has(key)) {
        perfCollector.recordStreamLoad({ at: Date.now(), durationMs: 0.4 + Math.random() * 0.5, cacheHit: true });
      } else if (this.cache.markLoading(key)) {
        const latency = this.config.streamLatencyMs * (0.6 + Math.random() * 0.8);
        setTimeout(() => {
          this.cache.set(key, true);
          perfCollector.recordStreamLoad({ at: Date.now(), durationMs: latency, cacheHit: false });
        }, latency);
      }
    }
    // 淘汰远离视口的子区块（模块3 §2.4.6 evictMany）
    const evictRadius = radius + this.config.evictThreshold;
    const toEvict: string[] = [];
    this.prevNeededSubChunks.forEach((key) => {
      const [sx, sy] = key.split(':').map(Number);
      if (Math.abs(sx - center.subChunkX) > evictRadius || Math.abs(sy - center.subChunkY) > evictRadius) toEvict.push(key);
    });
    if (toEvict.length > 0) this.cache.evictMany(toEvict);
    this.prevNeededSubChunks = needed;
  }

  // -------------------------------------------------------------------------
  // 快照（Zustand store 订阅）
  // -------------------------------------------------------------------------

  getPlayerSnapshot(): PlayerSnapshot {
    const size = this.config.decisions.chunkSize;
    const curr = worldToChunk(this.tileX, this.tileY, size);
    const region = this.regionFor(curr.chunkX, curr.chunkY);
    return {
      x: this.px,
      y: this.py,
      tileX: this.tileX,
      tileY: this.tileY,
      facing: this.facing,
      mode: this.mode,
      floor: this.interiorFloor,
      chunkX: curr.chunkX,
      chunkY: curr.chunkY,
      regionId: region.regionId,
      regionName: region.regionName,
      regionType: region.regionType,
      interiorLoading: this.interiorLoading,
      currentBuildingId: this.interiorBuilding?.buildingId ?? null,
    };
  }

  getBanner() {
    return this.lastBanner;
  }

  /** 沙箱测试通道：强制展示一次区域横幅（模块5 §2.2 视觉验证用） */
  testBanner(regionName: string, regionType: RegionType): void {
    this.bannerSeq += 1;
    this.lastBanner = { seq: this.bannerSeq, regionName, regionType, fromName: '当前区域', at: Date.now() };
    EventBus.emit('player.cross_region', { fromRegionId: 'test', toRegionId: 'test_banner', toRegionName: regionName });
    this.notify();
  }

  getChunksMetadata(): readonly ChunkMetadata[] {
    return [...this.chunks.values()].map((r) => r.meta);
  }

  getSchedulerStats() {
    return this.scheduler.getStats();
  }

  /** cancelAll（模块2 §3.3.2：清空队列） */
  cancelScheduler(): void {
    this.scheduler.cancelAll();
    this.notify();
  }

  getPoolStats() {
    return this.pool.getStats();
  }

  getCacheStats() {
    return this.cache.stats();
  }

  getInterior(): { interior: InteriorMapData; building: PlacedBuilding; floor: number } | null {
    if (this.mode === 'overworld' || !this.interior || !this.interiorBuilding) return null;
    return { interior: this.interior, building: this.interiorBuilding, floor: this.interiorFloor };
  }

  getEntitiesInRect(x0: number, y0: number, x1: number, y1: number): MapEntity[] {
    const size = this.config.decisions.chunkSize;
    const out: MapEntity[] = [];
    const c0 = worldToChunk(x0, y0, size);
    const c1 = worldToChunk(x1, y1, size);
    for (let cy = c0.chunkY; cy <= c1.chunkY; cy += 1) {
      for (let cx = c0.chunkX; cx <= c1.chunkX; cx += 1) {
        const rec = this.chunks.get(getChunkId(cx, cy));
        if (!rec?.slice || rec.meta.status !== 'ready') continue;
        for (const e of rec.slice.entities) {
          if (e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1 && e.visible && !this.removedEntityIds.has(e.id)) out.push(e);
        }
      }
    }
    return out;
  }

  getBuildingsInRect(x0: number, y0: number, x1: number, y1: number): PlacedBuilding[] {
    const out: PlacedBuilding[] = [];
    for (const rec of this.chunks.values()) {
      if (rec.meta.status !== 'ready') continue;
      for (const b of rec.buildings) {
        if (b.worldX + b.width >= x0 && b.worldX <= x1 && b.worldY + b.height >= y0 && b.worldY <= y1) out.push(b);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// 叙事模板（模块4 §2.1.4 叙事类型风味文本）
// ---------------------------------------------------------------------------

function narrativeFor(type: TileEvent['type'], refId: string): string {
  switch (type) {
    case 'combat':
      return `一只 ${refId} 从阴影中跃出，露出獠牙！（encounter 叙事预生成命中）`;
    case 'dialogue':
      return `${refId} 向你点头致意："远方来的旅人，要看看货物吗？"（dialogue_open 命中）`;
    case 'discovery':
      return `你在草丛中发现了 ${refId}。（discovery 命中）`;
    case 'story':
      return `古老的 ${refId} 在微光中低语，似乎通向未知之地。（story 触发）`;
    default:
      return '微风拂过旷野，远处传来不知名的声响。（ambient）';
  }
}
