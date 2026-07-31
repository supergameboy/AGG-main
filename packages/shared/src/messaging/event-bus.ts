/**
 * EventBus 事件总线（v1.7 从 backend/src/game-systems/event/EventBus.ts 迁移）
 *
 * 迁移要点（v1.7 dev hooks setter 模式）:
 * - 原 EventBus.ts L3-4 import `getDevTraceCollector` + `webSocketService` 是 shared→backend 跨层违规
 * - 修订为定义 `EventBusDevHooks` 接口（含 `onPublish` 回调），通过 `setDevHooks` 方法注入
 * - backend `index.ts` 在组合根装配 dev trace + WebSocket 广播逻辑
 * - logger/error 改用 shared/utils（getChildLogger + getErrorMessage）
 */

import { getChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error.js';

const logger = getChildLogger('event-bus');

export type BusEventType =
  | 'kill' | 'item_change' | 'dialogue' | 'location_enter'
  | 'equip_item' | 'use_item' | 'craft'
  | 'story_progress' | 'trigger_resolved' | 'quest_update'
  | 'pacing:tension_change' | 'pacing:stage_change' | 'pacing:review_alert'
  | 'chapter_advanced'
  | 'combat_end'
  | 'provider_config_changed'
  | 'llm_metrics_event'
  | 'before_tool_execute'
  | 'after_tool_execute';

export interface BusEvent {
  type: BusEventType;
  saveId: string;
  data: Record<string, unknown>;
  timestamp: number;
  requestId?: string;
}

/** trigger_resolved 事件的数据结构 */
export interface TriggerResolvedData {
  triggerId: string;
  eventId: string;
  eventType?: string;
  effects?: Array<{ type: string; params: Record<string, unknown> }>;
  archivedStoryEvent?: {
    chapter: string | null;
    eventType: string;
    title: string;
    importance: string;
  };
}

/** story_progress 事件的数据结构 */
export interface StoryProgressData {
  chapter: string | null;
  mainQuest: string | null;
  delta?: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
}

/** quest_update 事件的数据结构 */
export interface QuestUpdateData {
  questId: string;
  questName: string;
  oldStatus: string;
  newStatus: string;
}

/**
 * combat_end 事件的数据结构（006 升级新增）。
 *
 * 触发点：CombatService.complete_combat 末尾（事务提交后），由 AwarenessAutoSubscriber 订阅。
 * 期望效果：AwarenessAutoSubscriber 收到事件后对每个 NPC 参与者调用
 *   setAwareness(delta=+3, source={type:'auto:combat', occurredAt})。
 * participants 含所有参与战斗的 NPC 列表（不含玩家角色，玩家自己不会对自己产生 awareness）。
 */
export interface CombatEndData {
  saveId: string;
  combatId: string;
  result: 'victory' | 'defeat' | 'flee' | 'draw';
  participants: Array<{
    type: 'npc' | 'character';
    id: string;
    name?: string;
  }>;
  duration: number;
}

/**
 * before_tool_execute 事件 payload（M6 工具执行生命周期观察事件，D6.5）。
 *
 * 语义：纯观察（fire-and-forget），订阅方无 block/patch 能力——
 * 可拦截语义由 M4 before_tool_call（G 层 HookDispatcher）承担，两者正交（§4.4）。
 * 发布点：BaseTool.execute 权限检查通过、进入执行路径前；每次 execute() 恰好一次。
 */
export interface ToolBeforeExecuteData {
  toolType: string;
  method: string;
  saveId: string;
  agentType: string;
}

/**
 * after_tool_execute 事件 payload（M6，D6.8 摘要式设计）。
 *
 * 仅携带执行摘要（success/error/durationMs/aborted），params/result 不入事件——
 * 防止订阅方持有大对象引用延长 GC 路径，也防止意外修改 result 产生副作用。
 * 需要完整 result 的消费场景（审计）由 M4 after_tool_call（G 层，result 在场）承担。
 */
export interface ToolAfterExecuteData {
  toolType: string;
  method: string;
  saveId: string;
  agentType: string;
  success: boolean;
  error?: string;
  durationMs: number;
  aborted?: boolean;
}

export type BusEventHandler = (event: BusEvent) => void | Promise<void>;

/**
 * 事件链最大深度。
 *
 * 当前事件链最长路径：kill → trigger_resolved → pacing:*（3 层）。
 * 设为 5 提供安全余量，超过此深度几乎必然存在循环。
 * 触发时抛错中断，防止无限递归耗尽调用栈。
 */
const MAX_EVENT_DEPTH = 5;

/**
 * Dev hooks 接口（v1.7 新增）
 *
 * backend 组合根（index.ts）实现此接口并调用 `setDevHooks` 注入：
 * - onPublish: 在事件发布前调用，用于 dev trace 收集 + WebSocket 广播
 *
 * 设计理由: EventBus 迁移到 shared/ 后不能直接 import backend services/
 * （DevTraceCollector + WebSocketService），通过 hooks 接口让 backend 在组合根
 * 装配 dev 行为，shared/ 只定义契约。
 */
export interface EventBusDevHooks {
  /** 事件发布前回调（dev trace 收集 + WebSocket 广播） */
  onPublish?: (eventType: BusEventType, event: BusEvent) => void;
}

export class EventBus {
  private handlers: Map<BusEventType, BusEventHandler[]> = new Map();
  private devHooks: EventBusDevHooks = {};
  private currentDepth = 0;

  /** 注入 dev hooks（backend 组合根调用） */
  setDevHooks(hooks: EventBusDevHooks): void {
    this.devHooks = hooks;
  }

  subscribe(eventType: BusEventType, handler: BusEventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
    logger.info('Handler subscribed', { eventType });
  }

  unsubscribe(eventType: BusEventType, handler: BusEventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
        logger.info('Handler unsubscribed', { eventType });
      }
    }
  }

  async emit(eventType: BusEventType, event: BusEvent): Promise<void> {
    this.currentDepth++;
    if (this.currentDepth > MAX_EVENT_DEPTH) {
      this.currentDepth = 0;
      throw new Error(
        `EventBus: event chain depth exceeded MAX_EVENT_DEPTH(${MAX_EVENT_DEPTH}). ` +
        `Likely circular event chain detected. Last event: ${eventType} (saveId=${event.saveId}).`
      );
    }

    try {
      // dev hooks 回调（dev trace + WebSocket 广播由 backend 组合根注入）
      this.devHooks.onPublish?.(eventType, event);

      const handlers = this.handlers.get(eventType);
      if (!handlers || handlers.length === 0) return;

      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          logger.error('Event handler error', { eventType, error: errorMessage });
        }
      }
    } finally {
      this.currentDepth--;
    }
  }
}

export const eventBus = new EventBus();
