/**
 * 进程内事件总线（对应附录B §四 C 类跨模块内部事件 + §五 D 类系统调度事件）
 * 沙箱用单一 EventBus 模拟主项目后端 EventBus + WebSocket 推送的合并链路。
 */

export type GameEventType =
  // C 类：跨模块内部事件
  | 'chunk.ready'
  | 'chunk.failed'
  | 'chunk.status_changed'
  | 'player.moved'
  | 'player.cross_chunk'
  | 'player.cross_region'
  | 'tile_event.triggered'
  | 'building.placed'
  | 'building.entered'
  | 'building.exited'
  | 'zlayer.changed'
  | 'stairs.entered'
  // D 类：系统调度事件
  | 'prefetch.scheduled'
  | 'prefetch.completed'
  | 'result_pool.hit'
  | 'result_pool.miss'
  | 'interior.generated'
  // 沙箱扩展（UI 观测）
  | 'renderer.note'
  | 'narrative.push';

export interface GameEvent {
  readonly type: GameEventType;
  readonly at: number;
  readonly payload: Record<string, unknown>;
}

type Handler = (e: GameEvent) => void;

class EventBusImpl {
  private handlers = new Map<GameEventType | '*', Set<Handler>>();
  /** 最近事件环形缓冲（事件日志分区消费） */
  private recent: GameEvent[] = [];
  private static MAX_RECENT = 400;

  on(type: GameEventType | '*', handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  emit(type: GameEventType, payload: Record<string, unknown>): void {
    const e: GameEvent = { type, at: Date.now(), payload };
    this.recent.push(e);
    if (this.recent.length > EventBusImpl.MAX_RECENT) this.recent.shift();
    this.handlers.get(type)?.forEach((h) => h(e));
    this.handlers.get('*')?.forEach((h) => h(e));
  }

  getRecent(): readonly GameEvent[] {
    return this.recent;
  }

  clearRecent(): void {
    this.recent = [];
  }
}

export const EventBus = new EventBusImpl();
