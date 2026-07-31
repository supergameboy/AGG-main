import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// ── 在模块加载前设置全局对象 ──

const { mockUUIDs, setUuidIndex, resetUuids } = vi.hoisted(() => {
  const mockUUIDs: string[] = [];
  let uuidIndex = 0;

  // 在 vi.hoisted 中使用 vi.stubGlobal，确保在模块加载前生效
  vi.stubGlobal('window', {
    location: { hostname: 'localhost' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('crypto', {
    randomUUID: () => mockUUIDs[uuidIndex++] ?? `uuid-${uuidIndex}`,
  });

  return {
    mockUUIDs,
    setUuidIndex: (i: number) => { uuidIndex = i; },
    resetUuids: () => { mockUUIDs.length = 0; uuidIndex = 0; },
  };
});

// ── Mock 依赖 ──

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    ws: vi.fn(),
    wsEvent: vi.fn(),
  },
}));

// ── Mock WebSocket ──

interface MockWebSocket {
  readyState: number;
  send: Mock;
  close: Mock;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: ((e: { code: number; wasClean: boolean }) => void) | null;
  onerror: (() => void) | null;
}

const OPEN = 1;
const CONNECTING = 0;

let mockWsInstance: MockWebSocket;

vi.stubGlobal('WebSocket', class {
  static OPEN = OPEN;
  static CONNECTING = CONNECTING;
  readyState = CONNECTING;
  send = vi.fn();
  close = vi.fn();
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    mockWsInstance = this;
  }
});

// ── 辅助函数 ──

function simulateOpen() {
  mockWsInstance.readyState = OPEN;
  mockWsInstance.onopen?.();
}

function simulateMessage(data: Record<string, unknown>) {
  mockWsInstance.onmessage?.({ data: JSON.stringify(data) });
}

function simulateClose(code: number, wasClean: boolean) {
  // 模拟真实 WebSocket close 行为：readyState 变为 CLOSED(3)
  mockWsInstance.readyState = 3;
  mockWsInstance.onclose?.({ code, wasClean });
}

// ── 导入被测模块（此时 window 和 crypto 已在 vi.hoisted 中设置） ──

import { wsManager } from '@/services/WebSocketManager';

// ── 测试 ──

describe('WebSocketManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetUuids();
    mockWsInstance = null!;

    wsManager.disconnect();
  });

  // ────────────────────────────────────────────────
  // 1. 消息路由顺序：game:result 先 messageHandlers 再 resolve pendingRequest
  // ────────────────────────────────────────────────
  it('game:result 消息必须先遍历 messageHandlers 再 resolve pendingRequest', async () => {
    const callOrder: string[] = [];

    const handler = vi.fn(() => { callOrder.push('handler'); });
    wsManager.onMessage(handler);

    wsManager.connect();
    simulateOpen();

    mockUUIDs.push('req-1');
    setUuidIndex(0);
    const requestPromise = wsManager.sendRequest({
      module: 'game',
      action: 'chat',
      payload: { message: 'hello' },
    });

    requestPromise.then(() => { callOrder.push('resolve'); });

    simulateMessage({
      type: 'game:result',
      requestId: 'req-1',
      module: 'game',
      data: { reply: 'hi' },
    });

    await vi.runAllTimersAsync();

    expect(callOrder).toEqual(['handler', 'resolve']);
  });

  // ────────────────────────────────────────────────
  // 2. 心跳超时：3次未收到 pong 应触发重连
  // ────────────────────────────────────────────────
  it('3次未收到pong应触发重连', () => {
    wsManager.connect();
    simulateOpen();

    const closeSpy = vi.spyOn(mockWsInstance, 'close');

    vi.advanceTimersByTime(30_000); // missedPongs=1
    vi.advanceTimersByTime(30_000); // missedPongs=2
    vi.advanceTimersByTime(30_000); // missedPongs=3 → 触发重连

    expect(closeSpy).toHaveBeenCalledWith(4000, 'Heartbeat timeout');
  });

  // ────────────────────────────────────────────────
  // 3. 重连后自动 re-subscribe
  // ────────────────────────────────────────────────
  it('重连成功后如果有 subscribedSaveId 应自动 subscribe', () => {
    wsManager.reconnect();
    simulateOpen();

    // 先订阅一个 saveId
    wsManager.subscribe('save-abc');
    // 验证订阅消息已发送
    const firstInstance = mockWsInstance;
    expect(firstInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe', saveId: 'save-abc' }),
    );

    // 模拟断开
    simulateClose(4000, false);

    // 模拟重连成功（创建新 WebSocket 实例）
    wsManager.connect();
    simulateOpen();

    // 重连后应自动发送 subscribe（在新实例上）
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe', saveId: 'save-abc' }),
    );
  });

  // ────────────────────────────────────────────────
  // 4. disconnect 时 reject 所有 pendingRequests
  // ────────────────────────────────────────────────
  it('disconnect时应reject并清空所有pending请求', async () => {
    wsManager.connect();
    simulateOpen();

    mockUUIDs.push('req-a', 'req-b');
    setUuidIndex(0);

    const promiseA = wsManager.sendRequest({ module: 'game', action: 'chat', payload: {} });
    const promiseB = wsManager.sendRequest({ module: 'game', action: 'resolve', payload: {} });

    const rejectA = vi.fn();
    const rejectB = vi.fn();
    promiseA.catch(rejectA);
    promiseB.catch(rejectB);

    wsManager.disconnect();

    await vi.runAllTimersAsync();

    expect(rejectA).toHaveBeenCalledWith(expect.objectContaining({
      message: 'WS 连接断开',
    }));
    expect(rejectB).toHaveBeenCalledWith(expect.objectContaining({
      message: 'WS 连接断开',
    }));
  });

  // ────────────────────────────────────────────────
  // 4.1 reconnecting 状态也应 reject 所有 pendingRequests
  //     I10: 补充回归测试，覆盖 WebSocketManager.ts L229-235 的 reconnecting 分支
  // ────────────────────────────────────────────────
  it('setState(reconnecting)时应reject并清空所有pending请求', async () => {
    wsManager.connect();
    simulateOpen();

    mockUUIDs.push('req-a', 'req-b');
    setUuidIndex(0);

    const promiseA = wsManager.sendRequest({ module: 'game', action: 'chat', payload: {} });
    const promiseB = wsManager.sendRequest({ module: 'game', action: 'resolve', payload: {} });

    const rejectA = vi.fn();
    const rejectB = vi.fn();
    promiseA.catch(rejectA);
    promiseB.catch(rejectB);

    // 模拟连接关闭触发重连（reconnectAttempts < MAX → setState('reconnecting')）
    simulateClose(4000, false);

    await vi.runAllTimersAsync();

    expect(rejectA).toHaveBeenCalledWith(expect.objectContaining({
      message: 'WS 连接断开',
    }));
    expect(rejectB).toHaveBeenCalledWith(expect.objectContaining({
      message: 'WS 连接断开',
    }));
  });

  // ────────────────────────────────────────────────
  // 5. 请求超时已禁用：REQUEST_TIMEOUT=0 时不触发超时 reject
  //    决策依据：commit f61d5f8「全系统禁用超时」
  // ────────────────────────────────────────────────
  it('REQUEST_TIMEOUT=0时不触发超时reject', async () => {
    wsManager.connect();
    simulateOpen();

    mockUUIDs.push('req-no-timeout');
    setUuidIndex(0);

    const promise = wsManager.sendRequest({ module: 'game', action: 'chat', payload: {} });

    // 推进 5s（远小于原 600s 超时，且不会触发心跳重连的 90s 阈值）
    vi.advanceTimersByTime(5_000);

    // promise 应仍处于 pending 状态（未被超时 reject）
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  // ────────────────────────────────────────────────
  // 6. sendRequest 在未连接时 throw
  // ────────────────────────────────────────────────
  it('sendRequest在未连接时应抛错', () => {
    expect(() => wsManager.sendRequest({
      module: 'game',
      action: 'chat',
      payload: {},
    })).toThrow('WS 未连接');

    wsManager.connect();
    expect(() => wsManager.sendRequest({
      module: 'game',
      action: 'chat',
      payload: {},
    })).toThrow('WS 未连接');
  });

  // ────────────────────────────────────────────────
  // 7. 指数退避重连
  // ────────────────────────────────────────────────
  it('重连延迟应按指数增长', () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay: number) => {
      if (delay > 100) delays.push(delay);
      return originalSetTimeout(fn, 0);
    }) as typeof setTimeout);

    wsManager.connect();
    simulateOpen();

    simulateClose(4000, false);
    simulateClose(4000, false);
    simulateClose(4000, false);

    expect(delays.length).toBeGreaterThanOrEqual(3);
    const baseDelays = delays.map(d => Math.round(d / 1000) * 1000);
    expect(baseDelays[1]).toBeGreaterThanOrEqual(baseDelays[0]);
    expect(baseDelays[2]).toBeGreaterThanOrEqual(baseDelays[1]);

    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────
  // 8. routeMessage 分发：7种消息类型
  // ────────────────────────────────────────────────
  describe('routeMessage 分发', () => {
    let handler: ReturnType<typeof vi.fn>;
    let unsubscribe: () => void;

    beforeEach(() => {
      handler = vi.fn();
      unsubscribe = wsManager.onMessage(handler);
      wsManager.connect();
      simulateOpen();
    });

    afterEach(() => {
      unsubscribe();
    });

    it('auth_result 消息应被路由（不触发 messageHandler）', () => {
      simulateMessage({ type: 'auth_result', success: true });
      expect(handler).not.toHaveBeenCalled();
    });

    it('auth_result 失败时不应抛错', () => {
      expect(() => {
        simulateMessage({ type: 'auth_result', success: false, error: 'Invalid token' });
      }).not.toThrow();
    });

    it('subscribed 消息应被路由（不触发 messageHandler）', () => {
      simulateMessage({ type: 'subscribed', saveId: 'save-1' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribed 消息应被路由（不触发 messageHandler）', () => {
      simulateMessage({ type: 'unsubscribed' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('pong 消息应重置 missedPongs（不触发 messageHandler）', () => {
      vi.advanceTimersByTime(30_000); // missedPongs = 1
      simulateMessage({ type: 'pong', timestamp: Date.now() });
      vi.advanceTimersByTime(30_000); // missedPongs = 1
      vi.advanceTimersByTime(30_000); // missedPongs = 2
      const closeSpy = vi.spyOn(mockWsInstance, 'close');
      vi.advanceTimersByTime(30_000); // missedPongs = 3 → 触发重连
      expect(closeSpy).toHaveBeenCalledWith(4000, 'Heartbeat timeout');
    });

    it('game:event 消息应触发 messageHandler', () => {
      const event = {
        type: 'game:event',
        requestId: 'req-1',
        module: 'game',
        eventType: 'progress',
        data: {},
        timestamp: Date.now(),
      };
      simulateMessage(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('game:result 消息应触发 messageHandler 并 resolve pendingRequest', async () => {
      mockUUIDs.push('req-result');
      setUuidIndex(0);
      const promise = wsManager.sendRequest({ module: 'game', action: 'chat', payload: {} });

      const result = {
        type: 'game:result',
        requestId: 'req-result',
        module: 'game',
        data: { reply: 'hello' },
      };
      simulateMessage(result);

      expect(handler).toHaveBeenCalledWith(result);
      await expect(promise).resolves.toEqual({ reply: 'hello' });
    });

    it('game:error 消息应触发 messageHandler 并 reject pendingRequest', async () => {
      mockUUIDs.push('req-err');
      setUuidIndex(0);
      const promise = wsManager.sendRequest({ module: 'game', action: 'chat', payload: {} });

      const error = {
        type: 'game:error',
        requestId: 'req-err',
        error: 'Something went wrong',
        recoverable: false,
      };
      simulateMessage(error);

      expect(handler).toHaveBeenCalledWith(error);
      await expect(promise).rejects.toEqual(error);
    });
  });

  // ────────────────────────────────────────────────
  // 补充：onMessage 返回的 unsubscribe 函数
  // ────────────────────────────────────────────────
  it('onMessage 返回的函数应取消注册 handler', () => {
    const handler = vi.fn();
    const unsubscribe = wsManager.onMessage(handler);

    wsManager.connect();
    simulateOpen();

    simulateMessage({ type: 'game:event', requestId: '1', module: 'game', eventType: 'progress', data: {}, timestamp: Date.now() });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();

    simulateMessage({ type: 'game:event', requestId: '2', module: 'game', eventType: 'progress', data: {}, timestamp: Date.now() });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────
  // 补充：onStateChange 监听
  // ────────────────────────────────────────────────
  it('onStateChange 应在状态变更时通知 listener', () => {
    const listener = vi.fn();
    const unsubscribe = wsManager.onStateChange(listener);

    // 单例 disconnect 后 reconnectAttempts = MAX，需要 reconnect 重置
    wsManager.reconnect();
    // reconnect 内部调用 connect，状态可能是 connecting 或 reconnecting
    expect(listener).toHaveBeenCalled();

    simulateOpen();
    expect(listener).toHaveBeenCalledWith('connected');

    unsubscribe();
  });

  // ────────────────────────────────────────────────
  // 补充：game:error 先 handler 再 reject 的顺序
  // ────────────────────────────────────────────────
  it('game:error 消息必须先遍历 messageHandlers 再 reject pendingRequest', async () => {
    const callOrder: string[] = [];

    const handler = vi.fn(() => { callOrder.push('handler'); });
    wsManager.onMessage(handler);

    wsManager.connect();
    simulateOpen();

    mockUUIDs.push('req-err-order');
    setUuidIndex(0);
    const promise = wsManager.sendRequest({ module: 'game', action: 'chat', payload: {} });

    promise.catch(() => { callOrder.push('reject'); });

    simulateMessage({
      type: 'game:error',
      requestId: 'req-err-order',
      error: 'fail',
      recoverable: false,
    });

    await vi.runAllTimersAsync();

    expect(callOrder).toEqual(['handler', 'reject']);
  });

  // ────────────────────────────────────────────────
  // 补充：达到最大重连次数后放弃重连
  // ────────────────────────────────────────────────
  it('达到最大重连次数后应放弃重连并设为 disconnected', () => {
    const listener = vi.fn();
    const unsubscribe = wsManager.onStateChange(listener);

    wsManager.reconnect();
    simulateOpen();

    // 模拟连续10次连接失败
    // 第1次 close：reconnectAttempts 0→1
    simulateClose(4000, false);

    // 循环9次：推进时间触发重连 → 在新实例上触发 close
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(30_000);
      simulateClose(4000, false);
      // reconnectAttempts: (i+1)→(i+2)
    }
    // 此时 reconnectAttempts = 10，scheduleReconnect 中 setState('reconnecting')

    // 第10次重连尝试：推进时间触发 connect
    vi.advanceTimersByTime(30_000);
    // connect() 创建新实例，reconnectAttempts 仍为 10
    // 在新实例上触发 close
    simulateClose(4000, false);
    // handleClose 中 reconnectAttempts(10) >= MAX_RECONNECT_ATTEMPTS → setState('disconnected')

    const states = listener.mock.calls.map(call => call[0]);
    expect(states).toContain('disconnected');

    unsubscribe();
  });

  // ────────────────────────────────────────────────
  // 补充：disconnect 后不应自动重连
  // ────────────────────────────────────────────────
  it('disconnect后不应自动重连', () => {
    const listener = vi.fn();
    const unsubscribe = wsManager.onStateChange(listener);

    wsManager.reconnect();
    simulateOpen();

    // 记录 disconnect 之前的状态数量
    const statesBeforeDisconnect = listener.mock.calls.length;

    wsManager.disconnect();

    // 推进大量时间
    vi.advanceTimersByTime(300_000);

    // disconnect 之后不应有新的状态变化
    const statesAfterDisconnect = listener.mock.calls.slice(statesBeforeDisconnect).map(call => call[0]);
    expect(statesAfterDisconnect).toEqual(['disconnected']);

    unsubscribe();
  });

  // ────────────────────────────────────────────────
  // 补充：subscribe 在未连接时只记录 saveId
  // ────────────────────────────────────────────────
  it('subscribe在未连接时只记录saveId，连接后自动发送', () => {
    wsManager.subscribe('save-xyz');
    wsManager.connect();
    simulateOpen();
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'subscribe', saveId: 'save-xyz' }),
    );
  });

  // ────────────────────────────────────────────────
  // 补充：unsubscribe 在连接时发送取消订阅消息
  // ────────────────────────────────────────────────
  it('unsubscribe在连接时应发送unsubscribe消息', () => {
    wsManager.connect();
    simulateOpen();

    wsManager.unsubscribe();
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'unsubscribe' }),
    );
  });

  // ────────────────────────────────────────────────
  // 补充：reconnect 方法
  // ────────────────────────────────────────────────
  it('reconnect应重置重连计数并重新连接', () => {
    wsManager.connect();
    simulateOpen();

    simulateClose(4000, false);
    vi.advanceTimersByTime(30_000);

    wsManager.reconnect();

    expect(wsManager.state).toBe('connecting');
  });
});
