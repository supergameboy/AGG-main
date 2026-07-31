export * from './types/core';
export * from './types/game';
export * from './types/agent';
export * from './types/agent-coordination';
export * from './types/api';
export * from './types/template';
export * from './types/challenge';
export * from './types/agent-config';
export * from './types/dynamic-ui';
export * from './types/model-config';
export * from './types/i18n';
export * from './types/execution-trace';
export * from './types/progress';
export * from './types/errors';
export * from './types/tool';

// 跨层消息传递端口接口（v1.4 新增，P1-2 新增 IWebSocketContext）
export type { IWebSocketBroadcaster } from './messaging/websocket-broadcaster.js';
export type { IWebSocketContext } from './messaging/websocket-context.js';

// 会话层 K 契约（P1-2 新增）
export type { ClientSession, InitPhase, AuthStrategy } from './session/types.js';
export { SESSION_MAX_IDLE_MS } from './session/types.js';
export { ClientIdGenerator } from './session/client-id-generator.js';
export type { IClientSessionManager } from './session/client-session-manager.js';
