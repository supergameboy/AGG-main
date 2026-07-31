import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { config as appConfig } from '../utils/config.js';
import type { GameEventType, WSGameRequest, WSGameError, WSMessage } from '@ai-rpg/shared';
import type { IWebSocketContext } from '@ai-rpg/shared/messaging';
import type { IClientSessionManager, ClientSession } from '@ai-rpg/shared/session';
import { ClientIdGenerator } from '@ai-rpg/shared/session';

const logger = createChildLogger('WebSocketService');

const MAX_CONNECTIONS = 100;
const WS_AUTH_TOKEN = process.env.WS_AUTH_TOKEN || '';

/** 事件队列条目 */
interface QueuedEvent {
  eventType: GameEventType;
  payload: unknown;
  requestId?: string;
  timestamp: number;
}

/** 客户端事件队列（模块I P0-6 修复） */
interface ClientEventQueue {
  events: QueuedEvent[];
  maxSize: number;
}

/** Pending 请求（模块I P0-8 修复，仅长时间 LLM 请求） */
interface PendingRequest {
  requestId: string;
  clientId: string;
  timestamp: number;
  /** 标记请求已完成（响应已发送），清理 timeout 和 Map 条目 */
  complete: () => void;
  /** 标记请求已中止（心跳超时/断连），清理 timeout 和 Map 条目 */
  abort: () => void;
}

/** WS 传输层心跳状态（与会话层无关，仅用于 ping/pong 探活） */
interface WSHeartbeatState {
  isAlive: boolean;
  missedHeartbeats: number;
}

/** WS 游戏请求处理器类型 */
export type WSGameRequestHandler = (request: WSGameRequest, ws: WebSocket) => Promise<void>;

/** 长时间 LLM 请求的 action 集合（Q4 决策，B9 修复） */
const LONG_RUNNING_ACTIONS = new Set([
  'chat',
  'initialize',
  'skill-LLM',
  'inventory-LLM',
  'combat-LLM',
  'quest-LLM',
  'social-LLM',
  'travel-LLM',
  'dialogue-LLM',
  'shop-LLM',
  'craft-LLM',
  'storage-LLM',
  'explore-LLM',
  'levelup-LLM',
  'npc-LLM',
  'pool:generate-skills',
  'pool:generate-items',
  'pool:generate-options',
]);

/**
 * WebSocket 服务（传输层 + 消息层）。
 *
 * P1-2 重构：完全剥离会话管理职责。
 * - 传输层：WS 连接、心跳探活、消息收发
 * - 消息层：广播、事件队列（重连重放）、pending 请求管理
 * - 会话层：委托 IClientSessionManager（create/get/bindSaveId/updateActivity 等）
 *
 * 会话独立于 WS 连接存在，支持重连恢复。
 * WS 断开后会话保留至 SESSION_MAX_IDLE_MS 过期（由 sessionManager 管理）。
 */
export class WebSocketService implements IWebSocketContext {
  private wss: WebSocketServer | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private requestHandler?: WSGameRequestHandler;

  /** 会话管理器（构造函数注入） */
  private readonly sessionManager: IClientSessionManager;

  // 传输层映射（替代原 clients Map）
  /** WS → clientId（auth 之前为 null，auth 之后为 clientId） */
  private readonly wsToClientId: Map<WebSocket, string | null> = new Map();
  /** clientId → WS（用于广播 + closeExistingConnection 查找） */
  private readonly clientIdToWs: Map<string, WebSocket> = new Map();
  /** WS → 心跳状态（传输层 ping/pong 探活） */
  private readonly wsHeartbeat: Map<WebSocket, WSHeartbeatState> = new Map();

  // 模块I: 事件队列（P0-6 修复）
  private clientEventQueues: Map<string, ClientEventQueue> = new Map();
  // GM 初始化执行可达 4.5 分钟，断连重放窗口需覆盖此期间。TTL 5 分钟确保 GM 完成时
  // 入队的 task_end 事件在客户端重连时仍可重放。
  private readonly EVENT_QUEUE_MAX_SIZE = 200;
  private readonly EVENT_QUEUE_TTL_MS = 5 * 60_000;
  private queueCleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 事件序列类型集合：这些 eventType 是事件序列（含 task_start/task_end 等边界事件），
   * 重放时不去重，按时间顺序全量重放。其它 eventType 按 requestId+eventType 去重。
   * 未来新增序列事件类型只需加入此集合。
   */
  private static readonly SEQUENCE_EVENT_TYPES = new Set<string>(['agent_progress']);

  // 模块I: pending 请求（P0-8 修复，仅长时间 LLM 请求）
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly REQUEST_TIMEOUT_MS = 0; // 超时已禁用（commit f61d5f8 决策）

  constructor(deps: { sessionManager: IClientSessionManager }) {
    this.sessionManager = deps.sessionManager;
  }

  /** 注册游戏请求处理器 */
  setRequestHandler(handler: WSGameRequestHandler): void {
    this.requestHandler = handler;
  }

  // ── IWebSocketContext 实现（5 方法） ──

  /** 向特定连接发送 WS 协议消息（底层方法，不入场队） */
  sendToClient(ws: WebSocket, message: WSMessage | Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (sendError) {
        // v2 模块G #5: 不静默吞错，记录 warn 日志便于排查
        logger.warn('sendToClient failed', {
          error: getErrorMessage(sendError),
        });
      }
    }
  }

  /** 服务端主动将客户端绑定到 saveId（subscribe 消息触发） */
  subscribeClient(ws: WebSocket, saveId: string): void {
    const clientId = this.wsToClientId.get(ws);
    if (!clientId) return;
    this.sessionManager.bindSaveId(clientId, saveId);
    this.sendToClient(ws, { type: 'subscribed', saveId });
  }

  /**
   * 标记 pending 请求已完成（响应已发送时调用）。
   * 成功和错误响应都应调用此方法清理 pending 状态，避免残留至 180s 超时。
   */
  completePendingRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.complete();
    }
  }

  /** 获取指定 WebSocket 连接的 clientId（传输层映射查找） */
  getClientIdByWs(ws: WebSocket): string | null {
    return this.wsToClientId.get(ws) ?? null;
  }

  /** 获取当前 WS 连接数（传输层统计，含未认证连接） */
  getConnectedCount(): number {
    return this.wsToClientId.size;
  }

  // ── IWebSocketBroadcaster 实现（3 方法，内部委托 sessionManager） ──

  /**
   * 向指定 clientId 广播事件（唯一公开广播方法）。
   * 所有事件（agent_progress、dev:*、map:update 等）统一通过此方法发送。
   *
   * D7 决策: 不支持多窗口订阅同一 saveId。
   * B2 修复: 发送失败或客户端不存在时入队等待重连后重放（P0-6 修复，与模块I 统一）。
   */
  broadcastToClient<T>(
    clientId: string,
    eventType: GameEventType,
    payload: T,
    requestId?: string,
  ): void {
    if (!clientId) {
      // P0-9 修复: 未认证客户端（clientId 为空）进度事件全部丢失，必须记录 warn 日志
      logger.warn('broadcastToClient: clientId is empty, event dropped', {
        eventType,
        requestId: requestId || '',
      });
      return;
    }

    const message = {
      type: 'game:event' as const,
      requestId: requestId || '',
      module: 'game',
      eventType,
      data: { ...(payload as object) },
      intentHint: eventType,
      timestamp: Date.now(),
    };
    const data = JSON.stringify(message);

    // 通过 clientIdToWs O(1) 查找（替代原 O(n) 遍历 clients Map）
    const ws = this.clientIdToWs.get(clientId);
    let sent = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data);
        sent = true;
      } catch (sendError) {
        // P1-12 修复: 不再静默吞错，记录 warn 日志便于排查
        logger.warn('broadcastToClient send failed', {
          error: getErrorMessage(sendError),
          clientId,
          eventType,
        });
      }
    }

    // B2 修复: 发送失败或客户端不存在时入队等待重连后重放（P0-6 修复，与模块I 统一）
    if (!sent) {
      logger.warn('broadcastToClient: no client found, enqueuing for replay', {
        clientId,
        eventType,
        requestId: requestId || '',
      });
      this.enqueueEvent(clientId, eventType, payload, requestId);
    }
  }

  /** 根据 saveId 查找对应的 clientId（委托 sessionManager，O(1) 查找） */
  getClientIdBySaveId(saveId: string): string | null {
    return this.sessionManager.getBySaveId(saveId)?.clientId ?? null;
  }

  /** 获取所有已认证客户端的 clientId 列表（委托 sessionManager） */
  getAuthenticatedClientIds(): string[] {
    return [...this.sessionManager.getActiveClientIds()];
  }

  // ── 传输层方法 ──

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws', verifyClient: (_info, callback) => {
      if (this.wsToClientId.size >= MAX_CONNECTIONS) {
        logger.warn('WebSocket connection rejected: max connections reached', { total: this.wsToClientId.size });
        callback(false, 503, 'Max connections reached');
        return;
      }
      callback(true);
    }});

    this.wss.on('connection', (ws: WebSocket) => {
      // 仅创建传输层映射，不创建会话（会话在 auth 时创建或恢复）
      this.wsToClientId.set(ws, null);
      this.wsHeartbeat.set(ws, { isAlive: true, missedHeartbeats: 0 });
      logger.info(`WebSocket client connected. Total: ${this.wsToClientId.size}`);

      ws.on('pong', () => {
        const state = this.wsHeartbeat.get(ws);
        if (state) {
          state.isAlive = true;
          state.missedHeartbeats = 0;
        }
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          logger.warn('Failed to parse WebSocket message:', error);
        }
      });

      ws.on('close', (code: number, reason: Buffer) => this.handleClose(ws, code, reason));

      ws.on('error', (error: Error) => {
        logger.error('WebSocket client error:', error);
        this.handleClose(ws, 1011, Buffer.from(error.message));
      });
    });

    logger.info('WebSocket server initialized on /ws');
    this.startHeartbeat();
    this.startQueueCleanup();
  }

  private handleMessage(ws: WebSocket, message: Record<string, unknown>): void {
    const clientId = this.wsToClientId.get(ws) ?? null;

    // auth 消息由 handleAuth 内部单独调用 updateActivity，此处跳过避免 null 冲突
    if (message.type !== 'auth' && clientId) {
      this.sessionManager.updateActivity(clientId);
    }

    if (message.type === 'auth') {
      this.handleAuth(ws, message);
      return;
    }

    // 未认证时，非 auth 消息返回错误
    if (clientId === null) {
      this.sendToClient(ws, { type: 'auth_result', success: false, error: 'Authentication required' });
      return;
    }

    if (message.type === 'subscribe' && message.saveId && typeof message.saveId === 'string') {
      this.handleSubscribe(ws, message);
      return;
    }

    if (message.type === 'unsubscribe') {
      this.handleUnsubscribe(ws);
      return;
    }

    if (message.type === 'ping') {
      const state = this.wsHeartbeat.get(ws);
      if (state) {
        state.isAlive = true;
        state.missedHeartbeats = 0;
      }
      this.sendToClient(ws, { type: 'pong', timestamp: (message as { timestamp: number }).timestamp || Date.now() });
      return;
    }

    if (message.type === 'game:request') {
      this.handleGameRequest(ws, message as unknown as WSGameRequest);
      return;
    }

    if (message.type === 'pong') {
      const state = this.wsHeartbeat.get(ws);
      if (state) {
        state.isAlive = true;
        state.missedHeartbeats = 0;
      }
      return;
    }

    // v2 模块G #6: 未知消息类型返回错误，不静默返回
    this.sendToClient(ws, {
      type: 'game:error',
      requestId: (message.requestId as string) || '',
      error: `Unknown message type: ${message.type || '(missing)'}`,
      recoverable: false,
    } as WSGameError);
  }

  // ── 模块I: auth 处理（P1-9 clientId 持久化 + P0-6 重放）──

  private handleAuth(ws: WebSocket, message: Record<string, unknown>): void {
    if (WS_AUTH_TOKEN && message.token !== WS_AUTH_TOKEN) {
      this.sendToClient(ws, { type: 'auth_result', success: false, error: 'Invalid token' });
      logger.warn('WebSocket client auth failed');
      ws.close(4001, 'Auth failed');
      return;
    }

    // P1-2 重构: 委托 sessionManager 管理会话，ClientIdGenerator 统一校验
    const clientProvidedId = message.clientId as string | undefined;
    let clientId: string;
    let session: ClientSession;

    if (clientProvidedId && ClientIdGenerator.validate(clientProvidedId)) {
      const existingSession = this.sessionManager.get(clientProvidedId);
      if (existingSession) {
        // 重连恢复：复用已有会话（templateId/saveId/initPhase 保留）
        session = existingSession;
      } else {
        // 会话不存在（过期或首次）：新建会话（用 ClientIdGenerator.generate() 生成新 clientId）
        session = this.sessionManager.create();
      }
    } else {
      // 无效或未提供 clientId：新建会话
      session = this.sessionManager.create();
    }
    clientId = session.clientId;

    // 关闭使用相同 clientId 的旧连接（避免重复），通过 clientIdToWs O(1) 查找
    this.closeExistingConnectionForClientId(clientId, ws);

    // 建立传输层映射
    this.wsToClientId.set(ws, clientId);
    this.clientIdToWs.set(clientId, ws);

    // auth 成功后更新会话活跃时间（重置过期计时）
    this.sessionManager.updateActivity(clientId);

    this.sendToClient(ws, { type: 'auth_result', success: true, clientId });
    logger.info('WebSocket client authenticated', { clientId });

    // P0-6 修复: 重连后重放队列中的事件
    this.replayQueuedEvents(clientId);
  }

  /** 关闭使用相同 clientId 的旧连接（避免重复），通过 clientIdToWs 查找 */
  private closeExistingConnectionForClientId(clientId: string, currentWs: WebSocket): void {
    const existingWs = this.clientIdToWs.get(clientId);
    if (existingWs && existingWs !== currentWs && existingWs.readyState === WebSocket.OPEN) {
      logger.warn('Closing existing connection for duplicate clientId', { clientId });
      existingWs.close(4000, 'Duplicate clientId');
      // 注意：不立即从 clientIdToWs 删除，由 handleClose 统一清理
      // handleClose 会检查 clientIdToWs.get(clientId) === ws 才删除，避免误删新连接映射
    }
  }

  // ── 模块I: subscribe/unsubscribe 处理（P1-10 保留 saveId）──

  private handleSubscribe(ws: WebSocket, message: Record<string, unknown>): void {
    const clientId = this.wsToClientId.get(ws);
    if (!clientId) {
      this.sendToClient(ws, {
        type: 'game:error',
        requestId: (message.requestId as string) || '',
        error: 'Not authenticated',
        recoverable: false,
      } as WSGameError);
      return;
    }

    const saveId = message.saveId as string;
    if (saveId) {
      // P1-2 重构: 委托 sessionManager.bindSaveId（替代原 clientInfo.saveId = saveId）
      this.sessionManager.bindSaveId(clientId, saveId);
      logger.info('Client subscribed', { clientId, saveId });
    }

    this.sendToClient(ws, { type: 'subscribed', saveId });
  }

  private handleUnsubscribe(ws: WebSocket): void {
    const clientId = this.wsToClientId.get(ws);
    if (!clientId) return;
    // P1-2 重构: 委托 sessionManager.unbindSaveId（替代原 clientInfo.saveId = undefined）
    this.sessionManager.unbindSaveId(clientId);
    logger.info('Client unsubscribed', { clientId });
    this.sendToClient(ws, { type: 'unsubscribed' });
  }

  // ── 模块I: game:request 处理（B9 修复：仅长时间请求注册 pending）──

  private handleGameRequest(ws: WebSocket, request: WSGameRequest): void {
    if (!this.requestHandler) {
      this.sendToClient(ws, {
        type: 'game:error',
        requestId: request.requestId || '',
        error: 'Game request handler not registered',
        recoverable: false,
      } as WSGameError);
      return;
    }

    const clientId = this.wsToClientId.get(ws) ?? '';
    const action = request.action || '';

    // B9 修复: 仅长时间 LLM 请求注册 pending（Q4 决策）
    const isLongRunning = this.isLongRunningRequest(action);
    let pending: PendingRequest | null = null;

    if (isLongRunning && clientId) {
      const requestId = request.requestId || '';
      pending = this.registerPendingRequestInternal(requestId, clientId);
    }

    this.requestHandler(request, ws).catch((error: unknown) => {
      logger.error('WS game request handler error', { error: getErrorMessage(error) });
      this.sendToClient(ws, {
        type: 'game:error',
        requestId: request.requestId || '',
        error: error instanceof Error ? error.message : 'Internal server error',
        recoverable: false,
      } as WSGameError);
      if (pending) {
        pending.abort();
      }
    });
  }

  /** 判断请求是否为长时间 LLM 请求（Q4 决策） */
  private isLongRunningRequest(action: string): boolean {
    return LONG_RUNNING_ACTIONS.has(action);
  }

  /** 内部注册 pending，返回 PendingRequest（timeout 通过闭包捕获，无需外部访问） */
  private registerPendingRequestInternal(requestId: string, clientId: string): PendingRequest {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (this.REQUEST_TIMEOUT_MS > 0) {
      timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          logger.warn('Pending request timed out', { requestId, clientId });
        }
      }, this.REQUEST_TIMEOUT_MS);
    }

    // complete 和 abort 实现相同（都清理 timeout + Map 条目），
    // 区分命名仅为语义清晰：complete = 正常完成，abort = 异常中止
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      this.pendingRequests.delete(requestId);
    };

    const pending: PendingRequest = {
      requestId,
      clientId,
      timestamp: Date.now(),
      complete: cleanup,
      abort: cleanup,
    };

    this.pendingRequests.set(requestId, pending);
    return pending;
  }

  /**
   * 中止指定客户端的所有 pending 请求（心跳超时或断开时调用）。
   */
  rejectPendingRequestsForClient(clientId: string, reason: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.clientId === clientId) {
        pending.abort();
        logger.warn('Pending request rejected for client', { requestId, clientId, reason });
      }
    }
  }

  // ── 模块I: 事件队列（P0-6 修复）──

  /**
   * 将事件加入客户端的事件队列，等待重连后重放。
   */
  private enqueueEvent<T>(
    clientId: string,
    eventType: GameEventType,
    payload: T,
    requestId?: string,
  ): void {
    let queue = this.clientEventQueues.get(clientId);
    if (!queue) {
      queue = { events: [], maxSize: this.EVENT_QUEUE_MAX_SIZE };
      this.clientEventQueues.set(clientId, queue);
    }

    queue.events.push({
      eventType,
      payload,
      requestId,
      timestamp: Date.now(),
    });

    if (queue.events.length > queue.maxSize) {
      queue.events.shift();
      logger.warn('Event queue overflow, oldest event dropped', { clientId });
    }
  }

  /**
   * 客户端重连后重放队列中的事件。
   * A7 修复: 对相同 requestId + eventType 的非序列事件去重，仅保留最新的一条。
   * P3 修复: agent_progress 是事件序列（task_start/thinking/tool_call/tool_result/
   * iteration/task_end），每个 phase 都是独立的进度节点，去重会丢失进度树状态机
   * 所需的 task_start/task_end 边界事件，导致前端永远卡在"迭代中/获取结果"。
   * 因此 agent_progress 不参与去重，按时间顺序全量重放。
   */
  private replayQueuedEvents(clientId: string): void {
    const queue = this.clientEventQueues.get(clientId);
    if (!queue || queue.events.length === 0) return;

    const now = Date.now();
    const validEvents = queue.events.filter(
      (e) => now - e.timestamp < this.EVENT_QUEUE_TTL_MS,
    );

    if (validEvents.length === 0) {
      this.clientEventQueues.delete(clientId);
      return;
    }

    // A7 修复: 对相同 requestId + eventType 的非序列事件去重，仅保留最新的一条
    // P3 修复: 序列事件不去重（事件序列，去重会丢失 task_start/task_end 边界）
    // I9: 序列事件类型提取为常量 SEQUENCE_EVENT_TYPES，避免硬编码字符串
    const dedupMap = new Map<string, QueuedEvent>();
    const sequenceEvents: QueuedEvent[] = [];
    for (const event of validEvents) {
      if (WebSocketService.SEQUENCE_EVENT_TYPES.has(event.eventType)) {
        sequenceEvents.push(event);
        continue;
      }
      const key = `${event.requestId || ''}:${event.eventType}`;
      const existing = dedupMap.get(key);
      if (!existing || event.timestamp > existing.timestamp) {
        dedupMap.set(key, event);
      }
    }
    const dedupedEvents = [...sequenceEvents, ...Array.from(dedupMap.values())]
      .sort((a, b) => a.timestamp - b.timestamp);

    if (dedupedEvents.length < validEvents.length) {
      logger.info('Deduplicated queued events', {
        clientId,
        original: validEvents.length,
        deduped: dedupedEvents.length,
      });
    }

    logger.info('Replaying queued events', { clientId, count: dedupedEvents.length });

    // 通过 clientIdToWs O(1) 查找（替代原 O(n) 遍历 clients Map）
    const ws = this.clientIdToWs.get(clientId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // 重连后 ws 不可用，保留队列等待下次重连
      return;
    }

    for (const event of dedupedEvents) {
      const message = {
        type: 'game:event' as const,
        requestId: event.requestId || '',
        module: 'game',
        eventType: event.eventType,
        data: { ...(event.payload as object) },
        intentHint: event.eventType,
        timestamp: event.timestamp,
      };
      const data = JSON.stringify(message);

      try {
        ws.send(data);
      } catch (sendError) {
        logger.warn('Replay send failed', {
          clientId,
          eventType: event.eventType,
          error: getErrorMessage(sendError),
        });
      }
    }

    this.clientEventQueues.delete(clientId);
  }

  /** 清理过期的事件队列（定期调用） */
  cleanupExpiredQueues(): void {
    const now = Date.now();
    for (const [clientId, queue] of this.clientEventQueues) {
      const validEvents = queue.events.filter(
        (e) => now - e.timestamp < this.EVENT_QUEUE_TTL_MS,
      );
      if (validEvents.length === 0) {
        this.clientEventQueues.delete(clientId);
      } else {
        queue.events = validEvents;
      }
    }
  }

  private startQueueCleanup(): void {
    if (this.queueCleanupTimer) return;
    this.queueCleanupTimer = setInterval(() => {
      this.cleanupExpiredQueues();
    }, 60_000);
  }

  private stopQueueCleanup(): void {
    if (this.queueCleanupTimer) {
      clearInterval(this.queueCleanupTimer);
      this.queueCleanupTimer = null;
    }
  }

  // ── 模块I: 心跳超时（P0-8 拒绝 pending）──

  private startHeartbeat(): void {
    const heartbeatMs = appConfig.timeout.wsHeartbeat;
    // 0 = 禁用心跳（不 ping，不超时）。语义与 DEFAULT_TIMEOUT_MS=0 一致。
    if (heartbeatMs <= 0) {
      logger.info('WebSocket heartbeat disabled (wsHeartbeat=0)');
      return;
    }
    const maxMissed = appConfig.timeout.wsMaxMissedHeartbeats;

    this.heartbeatInterval = setInterval(() => {
      for (const [ws, state] of this.wsHeartbeat) {
        if (!state.isAlive) {
          state.missedHeartbeats++;
          if (state.missedHeartbeats >= maxMissed) {
            this.handleHeartbeatTimeout(ws);
            continue;
          }
        }

        state.isAlive = false;
        ws.ping();
      }
    }, heartbeatMs);
  }

  private handleHeartbeatTimeout(ws: WebSocket): void {
    const clientId = this.wsToClientId.get(ws) ?? null;

    // P0-8 修复: terminate 前先拒绝所有 pending 请求（仅长时间 LLM 请求）
    if (clientId) {
      this.rejectPendingRequestsForClient(
        clientId,
        'Connection closed due to heartbeat timeout',
      );
    }

    logger.warn('Heartbeat timeout, terminating connection', { clientId });
    ws.terminate();
    // terminate 会触发 close 事件，由 handleClose 统一清理
  }

  // ── 模块I: close handler（P0-8 拒绝 pending + P1-2 不删除会话）──

  private handleClose(ws: WebSocket, code: number, reason: Buffer): void {
    const clientId = this.wsToClientId.get(ws) ?? null;

    // 仅清理传输层映射，不删除会话（会话由 sessionManager 过期清理管理）
    this.wsToClientId.delete(ws);
    this.wsHeartbeat.delete(ws);
    // 只有当 clientIdToWs 中的 ws 是当前 ws 时才删除
    // 避免删除新连接的映射（closeExistingConnectionForClientId 场景）
    if (clientId && this.clientIdToWs.get(clientId) === ws) {
      this.clientIdToWs.delete(clientId);
    }

    // P0-8 修复: 拒绝该客户端的所有 pending 请求
    if (clientId) {
      this.rejectPendingRequestsForClient(
        clientId,
        `Connection closed: ${code} ${reason.toString()}`,
      );
    }

    logger.info('WebSocket client disconnected', {
      clientId,
      code,
      total: this.wsToClientId.size,
    });
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.stopQueueCleanup();
    // 中止所有 pending 请求
    for (const [, pending] of this.pendingRequests) {
      pending.abort();
    }
    this.pendingRequests.clear();
    for (const [ws] of this.wsToClientId) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, 'Server shutting down');
      }
    }
    this.wsToClientId.clear();
    this.clientIdToWs.clear();
    this.wsHeartbeat.clear();
    this.clientEventQueues.clear();
    // 停止会话过期清理定时器
    this.sessionManager.stopIdleSweep();
    this.wss?.close();
    logger.info('WebSocket server shut down');
  }
}

export type { GameEventType };
