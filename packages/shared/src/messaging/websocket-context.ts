/**
 * WebSocket 消息层上下文端口接口（D8 决策）
 *
 * extends IWebSocketBroadcaster，新增 5 个消息层+传输层方法，
 * 供消息层 J 内部 handler（ws-request-handler/ws-template-handler/ws-system-handler）使用。
 *
 * 接口职责分离：
 * - IWebSocketBroadcaster：跨模块广播契约（Agent 核心 G 用，3 方法）
 * - IWebSocketContext：消息层内部契约（handler 用，8 方法）
 *
 * backend/services/WebSocketService 同时实现两个接口。
 * handler 通过 GameHandlerContext.webSocketService 字段接收 IWebSocketContext 类型实例。
 */

import type { IWebSocketBroadcaster } from './websocket-broadcaster.js';
import type { WebSocket } from 'ws';
import type { WSMessage } from '../types/game.js';

export interface IWebSocketContext extends IWebSocketBroadcaster {
  /**
   * 向特定 WS 连接发送底层 WS 协议消息（不入事件队列）。
   * 用于发送 game:result / game:error / subscribed / unsubscribed / pong / auth_result 等响应消息。
   */
  sendToClient(ws: WebSocket, message: WSMessage | Record<string, unknown>): void;

  /**
   * 服务端主动将客户端绑定到 saveId（subscribe 消息触发）。
   * 内部委托 sessionManager.bindSaveId。
   */
  subscribeClient(ws: WebSocket, saveId: string): void;

  /**
   * 标记 pending 请求已完成（响应已发送时调用）。
   * 成功和错误响应都应调用此方法清理 pending 状态，避免残留至 180s 超时。
   */
  completePendingRequest(requestId: string): void;

  /**
   * 获取指定 WS 连接的 clientId（传输层映射查找）。
   * auth 之前返回 null，auth 之后返回 clientId。
   */
  getClientIdByWs(ws: WebSocket): string | null;

  /**
   * 获取当前 WS 连接数（传输层统计）。
   * 用于 system 模块的 connections 状态查询。
   */
  getConnectedCount(): number;
}
