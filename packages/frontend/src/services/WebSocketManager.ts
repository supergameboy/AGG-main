import type {
  WSConnectionState,
  WSMessage,
  WSGameRequest,
  WSGameResult,
  WSGameError,
  WSAuth,
  WSPing,
} from '@ai-rpg/shared';
import { ClientIdGenerator } from '@ai-rpg/shared/session';
import { logger } from '@/utils/logger';
import { useRuntimeStore } from '@/stores/runtimeStore';

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (reason: unknown) => void;
  module: string;
  action: string;
  timer: ReturnType<typeof setTimeout> | null;
}

type WSMessageHandler = (message: WSMessage) => void;
type StateListener = (state: WSConnectionState) => void;

class WebSocketManager {
  // ── 连接 ──
  private ws: WebSocket | null = null;
  private _state: WSConnectionState = 'disconnected';
  private _clientId: string;
  private _authToken: string | undefined;

  // ── 订阅 ──
  private subscribedSaveId: string | null = null;

  // ── 请求-响应 ──
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly REQUEST_TIMEOUT = 0; // 超时已禁用（commit f61d5f8 决策），依靠 WS 连接生命周期兜底

  // ── 消息分发 ──
  private messageHandlers: Set<WSMessageHandler> = new Set();
  private stateListeners: Set<StateListener> = new Set();

  // ── 心跳 ──
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private missedPongs: number = 0;
  private readonly HEARTBEAT_INTERVAL = 30_000;
  private readonly MAX_MISSED_PONGS = 3;

  // ── 重连 ──
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private readonly RECONNECT_BASE_DELAY = 3_000;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  // ── 页面卸载标志 ──
  private isUnloading = false;

  // ── 配置 ──
  private wsUrl: string;

  constructor() {
    // P1-2: 前后端统一使用 ClientIdGenerator（格式 client_<uuid>），替代原 crypto.randomUUID()
    this._clientId = ClientIdGenerator.generate();
    const wsPort = import.meta.env.VITE_WS_PORT || '17334';
    const wsHost = import.meta.env.VITE_WS_HOST || window.location.hostname;
    this.wsUrl = `ws://${wsHost}:${wsPort}/ws`;

    // 页面卸载时禁止重连，避免无意义的重连风暴
    window.addEventListener('beforeunload', () => {
      this.isUnloading = true;
    });
  }

  // ── 公共属性 ──
  get state(): WSConnectionState { return this._state; }
  get clientId(): string { return this._clientId; }
  get isConnected(): boolean { return this._state === 'connected'; }

  // ── 连接管理 ──

  connect(token?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    this._authToken = token;
    this.clearReconnectTimer();
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    logger.ws('wsManager', `Connecting to ${this.wsUrl}...`);

    try {
      const ws = new WebSocket(this.wsUrl);

      ws.onopen = () => this.handleOpen();
      ws.onmessage = (e) => this.handleMessage(e);
      ws.onclose = (e) => this.handleClose(e);
      ws.onerror = () => this.handleError();

      this.ws = ws;
    } catch (e) {
      logger.error('wsManager', 'Connection failed', undefined, e instanceof Error ? e.stack : undefined);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnectAttempts = this.MAX_RECONNECT_ATTEMPTS; // 阻止自动重连

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    // reject 所有 pendingRequests
    this.pendingRequests.forEach(({ reject, timer }) => {
      if (timer) clearTimeout(timer);
      reject(new Error('WS 连接断开'));
    });
    this.pendingRequests.clear();

    this.setState('disconnected');
    logger.ws('wsManager', 'Client disconnected');
  }

  reconnect(): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnectAttempts = 0;
    if (this.ws) {
      // 移除旧连接的事件监听，避免 onclose 触发 handleClose 导致状态混乱
      this.ws.onclose = null;
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close(1000, 'Client reconnect');
      this.ws = null;
    }
    this.connect(this._authToken);
  }

  // ── 请求 ──

  sendRequest(request: {
    module: string;
    action: string;
    intentHint?: string;
    payload: Record<string, unknown>;
  }): Promise<unknown> {
    if (this._state !== 'connected') {
      throw new Error(`WS 未连接，当前状态: ${this._state}`);
    }

    const requestId = crypto.randomUUID();
    const wsMessage: WSGameRequest = {
      type: 'game:request',
      requestId,
      module: request.module,
      action: request.action,
      intentHint: request.intentHint,
      payload: request.payload,
      clientId: this._clientId,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (this.REQUEST_TIMEOUT > 0) {
        timer = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout: ${request.module}.${request.action}`));
        }, this.REQUEST_TIMEOUT);
      }

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        module: request.module,
        action: request.action,
        timer,
      });
    });

    this.ws!.send(JSON.stringify(wsMessage));
    logger.ws('wsManager', `Sent game:request [${requestId}] ${request.module}.${request.action}`);

    // 桥接到 DevTools WS 日志面板
    useRuntimeStore.getState().addWSLog({
      timestamp: Date.now(),
      direction: 'send',
      type: 'game:request',
      requestId,
      dataSummary: `${request.module}.${request.action}`,
    });
    useRuntimeStore.getState().addActiveRequestId(requestId);

    return promise;
  }

  subscribe(saveId: string): void {
    this.subscribedSaveId = saveId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', saveId }));
      logger.ws('wsManager', `Subscribed to saveId: ${saveId}`);
    }
  }

  unsubscribe(): void {
    this.subscribedSaveId = null;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe' }));
      logger.ws('wsManager', 'Unsubscribed');
    }
  }

  // ── 消息订阅 ──

  onMessage(handler: WSMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  // ── 私有方法 ──

  private setState(state: WSConnectionState): void {
    this._state = state;
    this.stateListeners.forEach(fn => fn(state));

    // 同步连接状态到 DevTools
    const statsState = state === 'connected' ? 'connected'
      : state === 'reconnecting' ? 'reconnecting'
      : 'disconnected';
    useRuntimeStore.getState().updateWSConnectionState(statsState);

    // P1 修复: 重连中和断开都要 reject 所有 pendingRequests。
    // 原因：服务端 game:result 通过 sendToClient 直发，不入重放队列。WS 断连期间服务端
    // 发出的 result 已丢失，pending 永远不会被 resolve。即使服务端仍在执行，结果也会
    // 发到新 WS 连接，但旧 pending 已无意义。必须 reject 让调用方感知失败并决定是否重试。
    if (state === 'disconnected' || state === 'reconnecting') {
      this.pendingRequests.forEach(({ reject, timer }) => {
        if (timer) clearTimeout(timer);
        reject(new Error('WS 连接断开'));
      });
      this.pendingRequests.clear();
    }
  }

  private handleOpen(): void {
    // 1. 发送认证
    const auth: WSAuth = { type: 'auth', clientId: this._clientId, token: this._authToken };
    this.ws!.send(JSON.stringify(auth));

    // 2. 更新状态
    this.setState('connected');
    this.reconnectAttempts = 0;
    logger.ws('wsManager', 'Connected');

    // 3. 启动心跳
    this.startHeartbeat();

    // 4. 重新 subscribe
    if (this.subscribedSaveId) {
      this.subscribe(this.subscribedSaveId);
    }
  }

  private handleMessage(raw: MessageEvent): void {
    try {
      const message = JSON.parse(raw.data) as WSMessage;
      this.routeMessage(message);
    } catch (e) {
      logger.error('wsManager', 'Failed to parse WS message', undefined, e instanceof Error ? e.stack : undefined);
    }
  }

  private routeMessage(message: WSMessage): void {
    switch (message.type) {
      case 'auth_result': {
        const result = message as { success: boolean; clientId?: string; error?: string };
        if (!result.success) {
          logger.error('wsManager', `Auth failed: ${result.error}`);
          break;
        }
        // P1-2: 后端可能新生成或复用 clientId，前端用服务端权威 clientId 覆盖本地
        // 确保重连场景下前后端 clientId 一致（会话不存在时后端会新建 clientId）
        if (result.clientId && result.clientId !== this._clientId) {
          this._clientId = result.clientId;
          logger.ws('wsManager', `ClientId aligned from server: ${result.clientId}`);
        }
        break;
      }
      case 'subscribed': {
        const sub = message as { saveId: string };
        this.subscribedSaveId = sub.saveId;
        logger.ws('wsManager', `Subscription confirmed: ${sub.saveId}`);
        break;
      }
      case 'unsubscribed': {
        this.subscribedSaveId = null;
        logger.ws('wsManager', 'Unsubscription confirmed');
        break;
      }
      case 'pong': {
        this.missedPongs = 0;
        break;
      }
      case 'game:event': {
        this.messageHandlers.forEach(fn => fn(message));
        const evt = message as { requestId?: string; eventType?: string };
        useRuntimeStore.getState().addWSLog({
          timestamp: Date.now(),
          direction: 'receive',
          type: 'game:event',
          requestId: evt.requestId,
          eventType: evt.eventType,
          dataSummary: evt.eventType ?? 'event',
        });
        break;
      }
      case 'game:result': {
        const result = message as WSGameResult;
        // 先遍历 messageHandlers（store 需要先更新状态）
        this.messageHandlers.forEach(fn => fn(message));
        // 再 resolve pendingRequest
        const pending = this.pendingRequests.get(result.requestId);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.resolve(result.data);
          this.pendingRequests.delete(result.requestId);
        }
        useRuntimeStore.getState().removeActiveRequestId(result.requestId);
        useRuntimeStore.getState().addWSLog({
          timestamp: Date.now(),
          direction: 'receive',
          type: 'game:result',
          requestId: result.requestId,
          dataSummary: `${result.module ?? 'game'}.result`,
        });
        break;
      }
      case 'game:error': {
        const error = message as WSGameError;
        // 先遍历 messageHandlers
        this.messageHandlers.forEach(fn => fn(message));
        // 再 reject pendingRequest
        const pending = this.pendingRequests.get(error.requestId);
        if (pending) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(error);
          this.pendingRequests.delete(error.requestId);
        }
        useRuntimeStore.getState().removeActiveRequestId(error.requestId);
        useRuntimeStore.getState().addWSLog({
          timestamp: Date.now(),
          direction: 'receive',
          type: 'game:error',
          requestId: error.requestId,
          dataSummary: `${error.module ?? 'game'}.error: ${typeof error.error === 'string' ? error.error : 'unknown'}`,
        });
        break;
      }
      default: {
        // 兼容传统 GameEvent 等其他消息类型
        this.messageHandlers.forEach(fn => fn(message));
        break;
      }
    }
  }

  private handleClose(event: CloseEvent): void {
    this.stopHeartbeat();
    logger.ws('wsManager', `Disconnected (code: ${event.code}, clean: ${event.wasClean})`);

    // 页面卸载时不重连
    if (this.isUnloading) {
      this.setState('disconnected');
      return;
    }

    // 基于 close code 判定是否重连（而非 wasClean）
    // 1000=正常关闭, 1001=端点离开, 1005=无状态码 → 不重连
    // 1006=异常关闭, 1011=服务端错误, 4000=心跳超时 → 重连
    const NO_RECONNECT_CODES = new Set([1000, 1001, 1005]);
    const shouldReconnect = !NO_RECONNECT_CODES.has(event.code);

    if (shouldReconnect && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.scheduleReconnect();
    } else {
      this.setState('disconnected');
    }
  }

  private handleError(): void {
    // onclose 会紧接着触发，重连逻辑在 handleClose 中处理
    logger.ws('wsManager', 'WebSocket error');
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;

    this.heartbeatInterval = setInterval(() => {
      this.missedPongs++;
      if (this.missedPongs >= this.MAX_MISSED_PONGS) {
        logger.ws('wsManager', '连接假死，触发重连');
        this.stopHeartbeat();
        if (this.ws) {
          this.ws.close(4000, 'Heartbeat timeout');
        }
        this.scheduleReconnect();
        return;
      }

      const ping: WSPing = { type: 'ping', timestamp: Date.now() };
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(ping));
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.setState('disconnected');
      logger.ws('wsManager', '已达到最大重连次数，放弃重连');
      return;
    }

    this.setState('reconnecting');
    const delay = Math.min(
      this.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      30_000,
    ) + Math.random() * 1_000;

    this.reconnectAttempts++;
    logger.ws('wsManager', `Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect(this._authToken);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/** 模块级单例 */
export const wsManager = new WebSocketManager();
