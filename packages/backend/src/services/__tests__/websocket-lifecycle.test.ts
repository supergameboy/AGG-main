/**
 * 模块I — 连接生命周期管理测试
 *
 * 覆盖设计文档 fractal-design-20260616-agent-progress-refactor-v2-模块I-连接生命周期管理.md
 * 中声称的 11 个测试用例，补全以下场景：
 * - 事件队列重放（P0-6）
 * - 心跳超时取消请求（P0-8）
 * - 事件去重（A7）
 * - 队列溢出保护
 * - clientId 持久化（P1-9）
 * - completePendingRequest / rejectPendingRequestsForClient
 *
 * P1-2 适配: 构造函数注入 sessionManager，移除 clients Map / isValidClientId，
 * 改用 wsToClientId / clientIdToWs / wsHeartbeat 三 Map 传输层 + sessionManager 会话层。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { GameEventType } from '@ai-rpg/shared';
import type { IClientSessionManager, ClientSession } from '@ai-rpg/shared/session';
import { ClientIdGenerator } from '@ai-rpg/shared/session';
import { WebSocketService } from '../WebSocketService.js';
import { ClientSessionManager } from '../ClientSessionManager.js';

// ─── Mock 依赖 ──────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../utils/config.js', () => ({
  config: {
    timeout: {
      wsHeartbeat: 30_000,
      wsMaxMissedHeartbeats: 3,
    },
  },
}));

// ─── 类型定义（用于访问 private 成员）──────────────────────

interface WSHeartbeatStateLike {
  isAlive: boolean;
  missedHeartbeats: number;
}

interface QueuedEventLike {
  eventType: GameEventType;
  payload: unknown;
  requestId?: string;
  timestamp: number;
}

interface ClientEventQueueLike {
  events: QueuedEventLike[];
  maxSize: number;
}

interface PendingRequestLike {
  requestId: string;
  clientId: string;
  timestamp: number;
  complete: () => void;
  abort: () => void;
}

interface WebSocketServiceInternal {
  wsToClientId: Map<WebSocket, string | null>;
  clientIdToWs: Map<string, WebSocket>;
  wsHeartbeat: Map<WebSocket, WSHeartbeatStateLike>;
  sessionManager: IClientSessionManager;
  clientEventQueues: Map<string, ClientEventQueueLike>;
  pendingRequests: Map<string, PendingRequestLike>;
  EVENT_QUEUE_MAX_SIZE: number;
  EVENT_QUEUE_TTL_MS: number;
  REQUEST_TIMEOUT_MS: number;
  enqueueEvent: <T>(clientId: string, eventType: GameEventType, payload: T, requestId?: string) => void;
  replayQueuedEvents: (clientId: string) => void;
  handleHeartbeatTimeout: (ws: WebSocket) => void;
  registerPendingRequestInternal: (requestId: string, clientId: string) => PendingRequestLike;
  isLongRunningRequest: (action: string) => boolean;
  handleAuth: (ws: WebSocket, message: Record<string, unknown>) => void;
}

interface ClientSessionManagerInternal {
  sessions: Map<string, ClientSession>;
  saveIdIndex: Map<string, string>;
}

// ─── 辅助函数 ──────────────────────────────────────────────

function getInternal(service: WebSocketService): WebSocketServiceInternal {
  return service as unknown as WebSocketServiceInternal;
}

function getSmInternal(service: WebSocketService): ClientSessionManagerInternal {
  return getInternal(service).sessionManager as unknown as ClientSessionManagerInternal;
}

/** 创建 mock WebSocket 对象 */
function createMockWs(readyState: number = WebSocket.OPEN): WebSocket {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    on: vi.fn(),
  } as unknown as WebSocket;
}

interface RegisterClientOptions {
  clientId?: string;
  saveId?: string;
  authenticated?: boolean;
}

/**
 * 向 WebSocketService 注册一个客户端（绕过连接流程，直接操作传输层 + 会话层）。
 * - authenticated: false → 仅注册传输层（wsToClientId=null），不创建会话（模拟刚连接未 auth）
 * - authenticated: true（默认）→ 注册传输层 + 在 sessionManager 预创建会话
 * 返回 clientId（未认证时返回 null）
 */
function registerClient(
  service: WebSocketService,
  ws: WebSocket,
  options: RegisterClientOptions = {},
): string | null {
  const internal = getInternal(service);
  const smInternal = getSmInternal(service);

  // 传输层：心跳状态总是注册
  internal.wsHeartbeat.set(ws, { isAlive: true, missedHeartbeats: 0 });

  if (options.authenticated === false) {
    // 未认证：仅注册传输层映射，clientId 为 null
    internal.wsToClientId.set(ws, null);
    return null;
  }

  // 已认证：注册传输层映射 + 预创建会话
  const clientId = options.clientId ?? ClientIdGenerator.generate();
  const now = Date.now();
  smInternal.sessions.set(clientId, {
    clientId,
    createdAt: now,
    lastActiveAt: now,
    templateId: null,
    saveId: options.saveId ?? null,
    initPhase: null,
  });
  if (options.saveId) {
    smInternal.saveIdIndex.set(options.saveId, clientId);
  }

  internal.wsToClientId.set(ws, clientId);
  internal.clientIdToWs.set(clientId, ws);
  return clientId;
}

// ─── 测试 ───────────────────────────────────────────────────

describe('模块I: 连接生命周期管理', () => {
  let service: WebSocketService;
  let sessionManager: ClientSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new ClientSessionManager();
    service = new WebSocketService({ sessionManager });
  });

  afterEach(() => {
    vi.useRealTimers();
    service.shutdown();
  });

  // ─── 1. 事件队列重放（P0-6）─────────────────────────────

  describe('事件队列重放（P0-6）', () => {
    it('客户端断连时事件入队', () => {
      // 客户端不存在时调用 broadcastToClient，事件应入队
      const clientId = 'client_test_enqueue';
      service.broadcastToClient(clientId, 'agent_progress', { stage: 'init' }, 'req-001');

      const internal = getInternal(service);
      const queue = internal.clientEventQueues.get(clientId);
      expect(queue).toBeDefined();
      expect(queue!.events).toHaveLength(1);
      expect(queue!.events[0].eventType).toBe('agent_progress');
      expect(queue!.events[0].requestId).toBe('req-001');
    });

    it('客户端重连后重放队列', () => {
      const clientId = 'client_test_replay';
      const internal = getInternal(service);

      // 阶段1: 客户端断连期间，事件入队（客户端不存在时 broadcastToClient 会入队）
      service.broadcastToClient(clientId, 'agent_progress', { stage: 'step1' }, 'req-001');
      service.broadcastToClient(clientId, 'agent_progress', { stage: 'step2' }, 'req-002');
      expect(internal.clientEventQueues.get(clientId)?.events).toHaveLength(2);

      // 阶段2: 客户端重连（注册客户端到传输层 + 会话层）
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      // 阶段3: 重放队列
      internal.replayQueuedEvents(clientId);

      // 验证 ws.send 被调用 2 次（两条事件都发送）
      expect(ws.send).toHaveBeenCalledTimes(2);

      // 验证发送的消息内容包含原始事件数据
      const firstCall = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const firstMessage = JSON.parse(firstCall);
      expect(firstMessage.type).toBe('game:event');
      expect(firstMessage.eventType).toBe('agent_progress');
      expect(firstMessage.requestId).toBe('req-001');
      expect(firstMessage.data.stage).toBe('step1');
    });

    it('重放后清空队列', () => {
      const clientId = 'client_test_clear';
      const internal = getInternal(service);

      // 客户端断连期间事件入队
      service.broadcastToClient(clientId, 'agent_progress', { stage: 'init' }, 'req-001');
      expect(internal.clientEventQueues.get(clientId)).toBeDefined();

      // 客户端重连
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      internal.replayQueuedEvents(clientId);

      // 重放后队列应被删除
      expect(internal.clientEventQueues.has(clientId)).toBe(false);
    });

    it('队列容量限制：超过 maxSize 时丢弃最旧的事件', () => {
      const clientId = 'client_test_overflow';
      const internal = getInternal(service);
      const maxSize = internal.EVENT_QUEUE_MAX_SIZE;
      // P2 修复: maxSize 从 50 提升到 200，覆盖 GM 4.5 分钟执行期间的事件量
      expect(maxSize).toBe(200);

      // 入队 maxSize + 1 条事件
      for (let i = 0; i < maxSize + 1; i++) {
        service.broadcastToClient(clientId, 'agent_progress', { index: i }, `req-${i}`);
      }

      const queue = internal.clientEventQueues.get(clientId);
      expect(queue).toBeDefined();
      // 队列长度应为 maxSize（最旧的一条被丢弃）
      expect(queue!.events).toHaveLength(maxSize);
      // 第一条事件应是 index=1（index=0 被丢弃）
      expect(queue!.events[0].requestId).toBe('req-1');
      // 最后一条事件应是 index=maxSize
      expect(queue!.events[maxSize - 1].requestId).toBe(`req-${maxSize}`);
    });
  });

  // ─── 2. 心跳超时取消请求（P0-8）─────────────────────────

  describe('心跳超时取消请求（P0-8）', () => {
    it('心跳超时触发 rejectPendingRequestsForClient', () => {
      const clientId = 'client_heartbeat_timeout';
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      const internal = getInternal(service);
      // 注册一个 pending 请求
      const pending = internal.registerPendingRequestInternal('req-timeout', clientId);
      expect(internal.pendingRequests.has('req-timeout')).toBe(true);

      // 触发心跳超时
      internal.handleHeartbeatTimeout(ws);

      // pending 请求应被清理
      expect(internal.pendingRequests.has('req-timeout')).toBe(false);
      // ws 应被 terminate
      expect(ws.terminate).toHaveBeenCalledTimes(1);

      // 验证 pending.abort 不会再次触发清理（幂等性）
      pending.abort();
      expect(internal.pendingRequests.has('req-timeout')).toBe(false);
    });

    it('心跳超时清理多个 pending 请求', () => {
      const clientId = 'client_multi_pending';
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      const internal = getInternal(service);
      // 注册多个 pending 请求
      internal.registerPendingRequestInternal('req-1', clientId);
      internal.registerPendingRequestInternal('req-2', clientId);
      internal.registerPendingRequestInternal('req-3', clientId);
      expect(internal.pendingRequests.size).toBe(3);

      internal.handleHeartbeatTimeout(ws);

      // 所有 pending 请求都应被清理
      expect(internal.pendingRequests.size).toBe(0);
    });
  });

  // ─── 3. 事件去重（A7 + P3）─────────────────────────────

  describe('事件去重（A7 + P3）', () => {
    it('A7: 相同 requestId + eventType 的非序列事件只保留最新一条', () => {
      const clientId = 'client_dedup_same';
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      const internal = getInternal(service);

      // 同一 requestId + eventType 入队两次（模拟发送失败后重试）
      // 使用非序列事件 combat:turn_start（agent_progress 是序列事件，P3 不去重）
      internal.enqueueEvent(clientId, 'combat:turn_start', { stage: 'old' }, 'req-same');
      // 手动调整时间戳，确保第二条更新
      const queue = internal.clientEventQueues.get(clientId)!;
      queue.events[0].timestamp = Date.now() - 1000;

      internal.enqueueEvent(clientId, 'combat:turn_start', { stage: 'new' }, 'req-same');
      expect(queue.events).toHaveLength(2);

      // 重放
      internal.replayQueuedEvents(clientId);

      // 只发送一条（去重后）
      expect(ws.send).toHaveBeenCalledTimes(1);

      const sentData = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const sentMessage = JSON.parse(sentData);
      // 应保留最新的一条（stage: 'new'）
      expect(sentMessage.data.stage).toBe('new');
    });

    it('P3: agent_progress 事件不去重，保留完整序列', () => {
      const clientId = 'client_dedup_progress';
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      const internal = getInternal(service);

      // 同一 requestId 的多个 agent_progress 事件（模拟 GM 初始化完整序列）
      // task_start/task_end 是进度树状态机的边界事件，丢失会导致前端永远卡住
      internal.enqueueEvent(clientId, 'agent_progress', { phase: 'task_start' }, 'req-init');
      internal.enqueueEvent(clientId, 'agent_progress', { phase: 'thinking' }, 'req-init');
      internal.enqueueEvent(clientId, 'agent_progress', { phase: 'tool_call' }, 'req-init');
      internal.enqueueEvent(clientId, 'agent_progress', { phase: 'tool_result' }, 'req-init');
      internal.enqueueEvent(clientId, 'agent_progress', { phase: 'iteration' }, 'req-init');
      internal.enqueueEvent(clientId, 'agent_progress', { phase: 'task_end' }, 'req-init');

      const queue = internal.clientEventQueues.get(clientId)!;
      expect(queue.events).toHaveLength(6);

      internal.replayQueuedEvents(clientId);

      // 所有 6 条事件都应被发送（agent_progress 不去重）
      expect(ws.send).toHaveBeenCalledTimes(6);
    });

    it('不同 requestId 的事件不受影响', () => {
      const clientId = 'client_dedup_diff';
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      const internal = getInternal(service);

      // 不同 requestId 的事件不应被去重
      internal.enqueueEvent(clientId, 'agent_progress', { stage: 'a' }, 'req-a');
      internal.enqueueEvent(clientId, 'agent_progress', { stage: 'b' }, 'req-b');
      internal.enqueueEvent(clientId, 'combat:turn_start', { text: 'c' }, 'req-a');

      const queue = internal.clientEventQueues.get(clientId)!;
      expect(queue.events).toHaveLength(3);

      internal.replayQueuedEvents(clientId);

      // 三条事件都应被发送（无去重）
      expect(ws.send).toHaveBeenCalledTimes(3);
    });
  });

  // ─── 4. completePendingRequest ──────────────────────────

  describe('completePendingRequest', () => {
    it('成功响应时调用 completePendingRequest 清理 pending', () => {
      const clientId = 'client_complete_success';
      const internal = getInternal(service);

      internal.registerPendingRequestInternal('req-complete-ok', clientId);
      expect(internal.pendingRequests.has('req-complete-ok')).toBe(true);

      service.completePendingRequest('req-complete-ok');

      expect(internal.pendingRequests.has('req-complete-ok')).toBe(false);
    });

    it('错误响应时调用 completePendingRequest 清理 pending', () => {
      const clientId = 'client_complete_error';
      const internal = getInternal(service);

      internal.registerPendingRequestInternal('req-complete-err', clientId);
      expect(internal.pendingRequests.has('req-complete-err')).toBe(true);

      // 错误响应也通过 completePendingRequest 清理（B9 修复：6 个响应路径统一清理）
      service.completePendingRequest('req-complete-err');

      expect(internal.pendingRequests.has('req-complete-err')).toBe(false);
    });

    it('未注册的 requestId 调用 completePendingRequest 不报错', () => {
      // 同步请求未注册 pending，调用 completePendingRequest 应静默返回（Q4 决策）
      expect(() => service.completePendingRequest('req-not-registered')).not.toThrow();
    });
  });

  // ─── 5. rejectPendingRequestsForClient ──────────────────

  describe('rejectPendingRequestsForClient', () => {
    it('拒绝指定客户端的所有 pending 请求', () => {
      const clientId = 'client_reject_target';
      const internal = getInternal(service);

      internal.registerPendingRequestInternal('req-r1', clientId);
      internal.registerPendingRequestInternal('req-r2', clientId);
      expect(internal.pendingRequests.size).toBe(2);

      service.rejectPendingRequestsForClient(clientId, 'Connection closed');

      expect(internal.pendingRequests.size).toBe(0);
    });

    it('不影响其他客户端的 pending 请求', () => {
      const internal = getInternal(service);
      const clientIdA = 'client_reject_a';
      const clientIdB = 'client_reject_b';

      internal.registerPendingRequestInternal('req-a', clientIdA);
      internal.registerPendingRequestInternal('req-b', clientIdB);
      expect(internal.pendingRequests.size).toBe(2);

      // 只拒绝 clientA 的 pending
      service.rejectPendingRequestsForClient(clientIdA, 'Connection closed');

      expect(internal.pendingRequests.size).toBe(1);
      expect(internal.pendingRequests.has('req-a')).toBe(false);
      expect(internal.pendingRequests.has('req-b')).toBe(true);
    });
  });

  // ─── 6. clientId 持久化 + handleAuth（P1-9 + P1-2 重连恢复）──

  describe('clientId 持久化 + handleAuth（P1-9 + P1-2）', () => {
    it('客户端提供有效 clientId 且会话存在时复用（重连恢复）', () => {
      const ws = createMockWs();
      registerClient(service, ws, { authenticated: false });

      const internal = getInternal(service);
      const providedId = 'client_persist_valid';

      // 预创建会话（模拟重连前的会话残留）
      const smInternal = getSmInternal(service);
      const now = Date.now();
      smInternal.sessions.set(providedId, {
        clientId: providedId,
        createdAt: now,
        lastActiveAt: now,
        templateId: null,
        saveId: null,
        initPhase: null,
      });

      internal.handleAuth(ws, { type: 'auth', clientId: providedId });

      // wsToClientId 应为 providedId（复用会话）
      expect(internal.wsToClientId.get(ws)).toBe(providedId);
      // clientIdToWs 应建立映射
      expect(internal.clientIdToWs.get(providedId)).toBe(ws);

      // 应发送 auth_result success 消息
      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentData = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const sentMessage = JSON.parse(sentData);
      expect(sentMessage.type).toBe('auth_result');
      expect(sentMessage.success).toBe(true);
      expect(sentMessage.clientId).toBe(providedId);
    });

    it('客户端提供有效 clientId 但会话不存在时生成新 clientId', () => {
      const ws = createMockWs();
      registerClient(service, ws, { authenticated: false });

      const internal = getInternal(service);

      // 有效 clientId 格式，但无对应会话
      internal.handleAuth(ws, { type: 'auth', clientId: 'client_valid_no_session' });

      // 应生成新 clientId（不复用提供的 clientId）
      const newClientId = internal.wsToClientId.get(ws);
      expect(newClientId).toBeTruthy();
      expect(newClientId).toMatch(/^client_[a-zA-Z0-9_-]+$/);
      expect(newClientId).not.toBe('client_valid_no_session');
    });

    it('客户端提供无效 clientId 时生成新 clientId', () => {
      const ws = createMockWs();
      registerClient(service, ws, { authenticated: false });

      const internal = getInternal(service);

      // 无效 clientId：包含空格
      internal.handleAuth(ws, { type: 'auth', clientId: 'invalid id with spaces' });

      const newClientId = internal.wsToClientId.get(ws);
      expect(newClientId).toBeTruthy();
      expect(newClientId).toMatch(/^client_[a-zA-Z0-9_-]+$/);
      expect(newClientId).not.toBe('invalid id with spaces');
    });

    it('客户端未提供 clientId 时生成新 clientId', () => {
      const ws = createMockWs();
      registerClient(service, ws, { authenticated: false });

      const internal = getInternal(service);

      internal.handleAuth(ws, { type: 'auth' });

      const newClientId = internal.wsToClientId.get(ws);
      expect(newClientId).toBeTruthy();
      expect(newClientId).toMatch(/^client_[a-zA-Z0-9_-]+$/);
    });

    it('重复 clientId 时关闭旧连接', () => {
      const internal = getInternal(service);
      const clientId = 'client_duplicate_test';

      // 模拟已有连接使用该 clientId（注册 oldWs + 预创建会话）
      const oldWs = createMockWs();
      registerClient(service, oldWs, { clientId });

      // 新连接尝试使用相同 clientId
      const newWs = createMockWs();
      registerClient(service, newWs, { authenticated: false });

      internal.handleAuth(newWs, { type: 'auth', clientId });

      // 旧连接应被 close
      expect(oldWs.close).toHaveBeenCalledWith(4000, 'Duplicate clientId');

      // 新连接应使用该 clientId
      expect(internal.wsToClientId.get(newWs)).toBe(clientId);
      // clientIdToWs 应映射到新 ws（覆盖旧映射）
      expect(internal.clientIdToWs.get(clientId)).toBe(newWs);
    });

    it('ClientIdGenerator.validate 校验逻辑', () => {
      // 有效 clientId
      expect(ClientIdGenerator.validate('client_abc123')).toBe(true);
      expect(ClientIdGenerator.validate('client_test-foo_bar')).toBe(true);

      // 无效 clientId
      expect(ClientIdGenerator.validate('')).toBe(false);
      expect(ClientIdGenerator.validate('invalid')).toBe(false); // 不以 client_ 开头
      expect(ClientIdGenerator.validate('client_')).toBe(false); // client_ 后无内容
      expect(ClientIdGenerator.validate('client_ spaces')).toBe(false); // 包含空格
      expect(ClientIdGenerator.validate('a'.repeat(101))).toBe(false); // 超长
    });
  });

  // ─── 7. isLongRunningRequest（B9 决策）──────────────────

  describe('isLongRunningRequest（B9 决策）', () => {
    it('长时间 LLM 请求被识别为 long running', () => {
      const internal = getInternal(service);
      expect(internal.isLongRunningRequest('chat')).toBe(true);
      expect(internal.isLongRunningRequest('initialize')).toBe(true);
      expect(internal.isLongRunningRequest('skill-LLM')).toBe(true);
      expect(internal.isLongRunningRequest('combat-LLM')).toBe(true);
    });

    it('同步请求不被识别为 long running', () => {
      const internal = getInternal(service);
      expect(internal.isLongRunningRequest('subscribe')).toBe(false);
      expect(internal.isLongRunningRequest('unsubscribe')).toBe(false);
      expect(internal.isLongRunningRequest('auth')).toBe(false);
      expect(internal.isLongRunningRequest('')).toBe(false);
    });
  });

  // ─── 8. 请求超时已禁用（REQUEST_TIMEOUT_MS=0，commit f61d5f8 决策）───────────────

  describe('请求超时已禁用', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('REQUEST_TIMEOUT_MS=0 时不注册超时定时器，pending 不会被自动清理', () => {
      const clientId = 'client_no_timeout';
      const internal = getInternal(service);

      // 决策依据：commit f61d5f8「全系统禁用超时」
      expect(internal.REQUEST_TIMEOUT_MS).toBe(0);

      internal.registerPendingRequestInternal('req-no-timeout', clientId);
      expect(internal.pendingRequests.has('req-no-timeout')).toBe(true);

      // 推进大量时间，pending 应仍存在（无超时定时器触发清理）
      vi.advanceTimersByTime(600_000);

      expect(internal.pendingRequests.has('req-no-timeout')).toBe(true);
    });

    it('completePendingRequest 仍可主动清理 pending（不依赖超时）', () => {
      const clientId = 'client_complete_cleanup';
      const internal = getInternal(service);

      internal.registerPendingRequestInternal('req-complete', clientId);
      expect(internal.pendingRequests.has('req-complete')).toBe(true);

      // 主动 complete 应清理 pending（连接生命周期兜底机制）
      service.completePendingRequest('req-complete');
      expect(internal.pendingRequests.has('req-complete')).toBe(false);

      // 推进时间，不应有异常（无超时定时器需要 clearTimeout）
      vi.advanceTimersByTime(600_000);
      expect(internal.pendingRequests.has('req-complete')).toBe(false);
    });
  });

  // ─── 9. cleanupExpiredQueues（定期清理）─────────────────

  describe('cleanupExpiredQueues', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('清理过期的事件队列', () => {
      const clientId = 'client_cleanup_expired';
      const internal = getInternal(service);

      service.broadcastToClient(clientId, 'agent_progress', { stage: 'init' }, 'req-001');
      expect(internal.clientEventQueues.has(clientId)).toBe(true);

      // 推进时间到 TTL 后
      vi.advanceTimersByTime(internal.EVENT_QUEUE_TTL_MS + 1000);

      service.cleanupExpiredQueues();

      expect(internal.clientEventQueues.has(clientId)).toBe(false);
    });

    it('未过期的事件队列保留', () => {
      const clientId = 'client_cleanup_valid';
      const internal = getInternal(service);

      service.broadcastToClient(clientId, 'agent_progress', { stage: 'init' }, 'req-001');

      // 推进时间但未超过 TTL
      vi.advanceTimersByTime(internal.EVENT_QUEUE_TTL_MS - 1000);

      service.cleanupExpiredQueues();

      expect(internal.clientEventQueues.has(clientId)).toBe(true);
    });
  });

  // ─── 10. 重放过期事件过滤 ───────────────────────────────

  describe('重放过期事件过滤', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('过期的队列事件不被重放，且队列被删除', () => {
      const clientId = 'client_replay_expired';
      const internal = getInternal(service);

      // 阶段1: 客户端断连期间，事件入队（不注册客户端，broadcastToClient 会入队）
      service.broadcastToClient(clientId, 'agent_progress', { stage: 'init' }, 'req-001');
      expect(internal.clientEventQueues.has(clientId)).toBe(true);

      // 阶段2: 推进时间到 TTL 后
      vi.advanceTimersByTime(internal.EVENT_QUEUE_TTL_MS + 1000);

      // 阶段3: 客户端重连
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      // 阶段4: 重放应跳过过期事件
      internal.replayQueuedEvents(clientId);

      // 不发送任何事件（事件已过期）
      expect(ws.send).not.toHaveBeenCalled();
      // 队列应被删除
      expect(internal.clientEventQueues.has(clientId)).toBe(false);
    });
  });

  // ─── 11. broadcastToClient 发送成功时入队 ───────────────

  describe('broadcastToClient 入队逻辑', () => {
    it('客户端存在且发送成功时事件不入队', () => {
      const clientId = 'client_send_ok';
      const ws = createMockWs();
      registerClient(service, ws, { clientId });

      const internal = getInternal(service);

      service.broadcastToClient(clientId, 'agent_progress', { stage: 'init' }, 'req-001');

      // 发送成功，不入队
      expect(internal.clientEventQueues.has(clientId)).toBe(false);
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it('客户端存在但 ws.send 抛错时事件入队', () => {
      const clientId = 'client_send_err';
      const ws = createMockWs();
      (ws.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('send failed');
      });
      registerClient(service, ws, { clientId });

      const internal = getInternal(service);

      service.broadcastToClient(clientId, 'agent_progress', { stage: 'init' }, 'req-001');

      // 发送失败，应入队等待重连后重放
      expect(internal.clientEventQueues.has(clientId)).toBe(true);
      const queue = internal.clientEventQueues.get(clientId)!;
      expect(queue.events).toHaveLength(1);
    });

    it('clientId 为空时事件被丢弃不入队', () => {
      const internal = getInternal(service);

      // clientId 为空，事件应被丢弃
      service.broadcastToClient('', 'agent_progress', { stage: 'init' }, 'req-001');

      expect(internal.clientEventQueues.size).toBe(0);
    });
  });
});
