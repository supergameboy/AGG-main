/**
 * shared/messaging 桶导出
 *
 * 导出跨层消息传递契约：
 * - IWebSocketBroadcaster: WebSocket 广播端口接口（v1.4 新增，agents/ 通过 AgentDeps 消费）
 * - IWebSocketContext: WebSocket 消息层上下文端口接口（P1-2 新增，消息层 J handler 通过 ctx 消费）
 * - IPanelUpdateBroadcaster: 面板变更统一推送端口接口（统一面板变更推送机制新增）
 * - EventBus + types: 事件总线（v1.7 从 backend/game-systems/event/ 迁移）
 *
 * backend/services 层实现这些契约，agents/ 层通过依赖注入消费。
 */

export type { IWebSocketBroadcaster } from './websocket-broadcaster.js';
export type { IWebSocketContext } from './websocket-context.js';
export type {
  IPanelUpdateBroadcaster,
  PushSource,
  PanelKey,
  TriggeredOp,
} from './panel-update-broadcaster.js';

export { EventBus, eventBus } from './event-bus.js';
export type {
  BusEventType,
  BusEvent,
  BusEventHandler,
  EventBusDevHooks,
  TriggerResolvedData,
  StoryProgressData,
  QuestUpdateData,
  CombatEndData,
  ToolBeforeExecuteData,
  ToolAfterExecuteData,
} from './event-bus.js';

export type {
  EventType,
  TriggerStatus,
  TriggerType,
  GameEvent,
  EventEffect,
  EventTrigger,
  StoryEventRecord,
  EventRollResult,
  EventCheckResult,
  EventChain,
  ProviderConfigChangedPayload,
  LLMMetricsEventPayload,
} from './event-types.js';
