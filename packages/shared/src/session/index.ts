/**
 * shared/session 桶导出
 *
 * 会话层 K 契约定义：
 * - ClientSession + InitPhase + AuthStrategy + SESSION_MAX_IDLE_MS: 会话类型与常量
 * - ClientIdGenerator: 前后端共用的 clientId 生成器
 * - IClientSessionManager: 会话管理器端口接口（backend 实现此契约）
 *
 * backend/services/ClientSessionManager 实现端口接口，
 * backend/services/WebSocketService 通过构造函数注入消费。
 */

export type { ClientSession, InitPhase, AuthStrategy } from './types.js';
export { SESSION_MAX_IDLE_MS } from './types.js';
export { ClientIdGenerator } from './client-id-generator.js';
export type { IClientSessionManager } from './client-session-manager.js';
