/**
 * 实体精灵清单与图集映射（附录A 扩展：实体 spriteId 链路，与瓦片 spriteId 同构）
 * - ENTITY_SPRITES 是实体渲染的唯一权威清单（emoji MVP ↔ 精灵图集双映射）
 * - 玩家精灵复用垂直层图集 PLAYER_REGION (1,1) 格；其余实体使用独立实体图集（2×3 网格）
 * - 渲染器在 spriteMode='sheet' 时优先图集，未加载/未映射自动回退 emoji
 */

import { spriteSheet, PLAYER_REGION, scanCellBounds, chromaKeyBlack, FOG_VERTICAL_ALPHA, ENTITY_HEIGHT_UNITS, type CellBounds, type FogState } from './sprite-sheet';

export interface EntitySpriteInfo {
  readonly type: 'player' | 'enemy' | 'npc' | 'chest' | 'item' | 'portal';
  readonly label: string;
  /** 精灵图资源 ID（附录A §4.1 命名约定扩展：entity_*） */
  readonly spriteId: string;
  /** MVP 调试渲染 emoji（附录A mvpIcon 语义） */
  readonly mvpIcon: string;
  /** 实体图集格位（2 行 × 3 列；玩家为 null —— 走瓦片图集 PLAYER_REGION） */
  readonly region: { col: number; row: number } | null;
}

/** 实体精灵清单（权威来源；实体图集格位约定见下行注释） */
// 实体图集 2×3 网格：行1: wolf / npc / chest；行2: item / portal / portal_alt
export const ENTITY_SPRITES: readonly EntitySpriteInfo[] = [
  { type: 'player', label: '玩家', spriteId: 'entity_player', mvpIcon: '🧝', region: null },
  { type: 'enemy', label: '敌人·狼', spriteId: 'entity_wolf', mvpIcon: '🐺', region: { col: 0, row: 0 } },
  { type: 'npc', label: 'NPC·旅商', spriteId: 'entity_npc_merchant', mvpIcon: '🧙', region: { col: 1, row: 0 } },
  { type: 'chest', label: '宝箱', spriteId: 'entity_chest', mvpIcon: '📦', region: { col: 2, row: 0 } },
  { type: 'item', label: '物品·草药', spriteId: 'entity_item_herb', mvpIcon: '🎁', region: { col: 0, row: 1 } },
  { type: 'portal', label: '传送门', spriteId: 'entity_portal', mvpIcon: '🌀', region: { col: 1, row: 1 } },
];

export function getEntitySpriteInfo(type: string): EntitySpriteInfo | null {
  return ENTITY_SPRITES.find((e) => e.type === type) ?? null;
}

export interface EntitySheetState {
  readonly loaded: boolean;
  readonly url: string | null;
  readonly cellW: number;
  readonly cellH: number;
}

export class EntitySheet {
  private image: HTMLCanvasElement | null = null;
  private state: EntitySheetState = { loaded: false, url: null, cellW: 0, cellH: 0 };
  private listeners = new Set<() => void>();
  /** 格内容包围盒缓存（锚点归一化：包围盒底边中点 = 脚底，与瓦片图集同一协议） */
  private cellBounds = new Map<string, CellBounds | null>();
  /** 加载代际令牌（风格切换并发重入：仅最新一代允许写入状态，忽略过期完成） */
  private loadSeq = 0;

  async load(candidates: readonly string[]): Promise<void> {
    const seq = ++this.loadSeq;
    for (const url of candidates) {
      const ok = await this.tryLoad(url, seq);
      if (seq !== this.loadSeq) return; // 已有更新的加载在进行/完成，丢弃本代结果
      if (ok) {
        this.notify();
        return;
      }
    }
    this.notify();
  }

  private tryLoad(url: string, seq: number): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (seq !== this.loadSeq) {
          resolve(false); // 过期代际禁止写画布/包围盒（防串代污染）
          return;
        }
        this.image = chromaKeyBlack(img);
        this.state = { loaded: true, url, cellW: img.width / 3, cellH: img.height / 2 };
        this.scanAllCells();
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }

  /** 扫描实体清单全部映射格的内容包围盒 */
  private scanAllCells(): void {
    this.cellBounds.clear();
    if (!this.image) return;
    const { cellW, cellH } = this.state;
    for (const info of ENTITY_SPRITES) {
      if (!info.region) continue;
      this.cellBounds.set(`${info.region.col},${info.region.row}`, scanCellBounds(this.image, info.region.col, info.region.row, cellW, cellH));
    }
  }

  isReady(): boolean {
    return this.state.loaded && this.image !== null;
  }

  getState(): EntitySheetState {
    return this.state;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }

  /**
   * 绘制实体（锚点归一化：包围盒底边中点 = 脚底，对齐 (sx, sy)；返回 false = 未映射由调用方回退 emoji）
   * 玩家走瓦片图集垂直层 PLAYER_REGION 格；其余走实体图集。
   * 迷雾三态门控（实体高出地面菱形，mask 覆盖不到）：未探索不画（返回 true 阻断 emoji 回退），
   * 已探索降暗，可见全亮。
   * 缩放协议 v3 §2：unitPx = 1.0 真实单位的屏幕像素（等距 = ISO_W×zoom，俯视 = SQ×zoom），
   * 绘制高度 = ENTITY_HEIGHT_UNITS[type] × unitPx，宽度按包围盒纵横比推导 ——
   * 修复"宽度基准导致狼比人高/宝箱比人大"的比例失调。
   */
  drawEntity(ctx: CanvasRenderingContext2D, type: string, sx: number, sy: number, unitPx: number, fog: FogState = 'visible'): boolean {
    const alpha = FOG_VERTICAL_ALPHA[fog];
    if (alpha <= 0) return true; // 未探索：实体不可见，且不允许 emoji 回退穿雾
    const info = getEntitySpriteInfo(type);
    if (!info) return false;
    const targetH = (ENTITY_HEIGHT_UNITS[type] ?? 1.0) * unitPx;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (type === 'player') {
      // 玩家：垂直层图集 PLAYER_REGION 格（与瓦片同一锚点协议，包围盒底边中点 = 站立点）
      const img = spriteSheet.getImage();
      const bounds = spriteSheet.boundsAt(PLAYER_REGION.col, PLAYER_REGION.row);
      if (!spriteSheet.isReady() || !img || !bounds) {
        ctx.restore();
        return false;
      }
      const scale = targetH / bounds.h;
      const drawW = bounds.w * scale;
      ctx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, sx - drawW / 2, sy - targetH, drawW, targetH);
      ctx.restore();
      return true;
    }
    if (!this.image || !info.region) {
      ctx.restore();
      return false;
    }
    const bounds = this.cellBounds.get(`${info.region.col},${info.region.row}`);
    if (!bounds) {
      ctx.restore();
      return false;
    }
    const scale = targetH / bounds.h;
    const drawW = bounds.w * scale;
    ctx.drawImage(this.image, bounds.x, bounds.y, bounds.w, bounds.h, sx - drawW / 2, sy - targetH, drawW, targetH);
    ctx.restore();
    return true;
  }
}

export const entitySheet = new EntitySheet();
