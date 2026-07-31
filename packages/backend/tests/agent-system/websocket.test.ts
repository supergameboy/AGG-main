import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import { WebSocketService, type GameEventType } from '../../src/services/WebSocketService.js';
import { ClientSessionManager } from '../../src/services/ClientSessionManager.js';
import { ClientIdGenerator } from '@ai-rpg/shared/session';
import { app } from '../setup.js';
import request from 'supertest';

/**
 * WebSocket 通信系统集成测试（P1-2 重写版）
 *
 * 适配 P1-2 新架构：
 * - 构造函数注入 sessionManager（替代无参构造）
 * - 客户端需主动发送 auth 消息认证（替代连接自动认证）
 * - broadcastToClient 精准投递（替代 broadcastToSave/broadcast 全局广播）
 * - 会话独立于 WS 连接存在，支持重连恢复
 */

describe('WebSocket Communication System', () => {
  let service: WebSocketService;
  let sessionManager: ClientSessionManager;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    sessionManager = new ClientSessionManager();
    service = new WebSocketService({ sessionManager });
    server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
        }
        resolve();
      });
    });
    service.initialize(server);
  });

  afterEach(async () => {
    try { service.shutdown(); } catch {}
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      server.close(() => { clearTimeout(timer); resolve(); });
    });
  });

  /**
   * 连接客户端并发送 auth 消息完成认证。
   * P1-2: 连接后不自动认证，需客户端主动发送 auth 消息。
   */
  function connectClient(clientId?: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('Auth timeout')); }, 5000);
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      const onMessage = (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result' && msg.success === true) {
            clearTimeout(timer);
            ws.off('message', onMessage);
            resolve(ws);
          }
        } catch {}
      };
      ws.on('message', onMessage);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', clientId: clientId ?? null }));
      });
    });
  }

  /**
   * 连接客户端并等待第一条消息（不发送 auth，用于测试未认证场景）。
   */
  function connectUnauthenticated(): Promise<{ ws: WebSocket; msg: any }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('First message timeout')); }, 5000);
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      ws.on('open', () => {
        // 发送非 auth 消息触发 auth_result error
        ws.send(JSON.stringify({ type: 'ping' }));
      });
      const onMessage = (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve({ ws, msg });
        } catch {
          clearTimeout(timer);
          ws.off('message', onMessage);
          reject(new Error('Failed to parse first message'));
        }
      };
      ws.on('message', onMessage);
    });
  }

  function waitForMessage(ws: WebSocket, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Message timeout')), timeout);
      ws.once('message', (data) => { clearTimeout(timer); resolve(JSON.parse(data.toString())); });
    });
  }

  function disconnectClient(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) { resolve(); return; }
      ws.on('close', () => resolve());
      ws.close();
    });
  }

  /**
   * 通过 saveId 广播事件（P1-2: getClientIdBySaveId + broadcastToClient）。
   * 替代旧 broadcastToSave API。
   */
  function broadcastToSaveViaClientId(saveId: string, eventType: GameEventType, payload: Record<string, unknown>): void {
    const clientId = service.getClientIdBySaveId(saveId);
    if (clientId) {
      service.broadcastToClient(clientId, eventType, payload);
    }
  }

  /**
   * 向所有已认证客户端广播（P1-2: 遍历 getAuthenticatedClientIds + broadcastToClient）。
   * 替代旧 broadcast API。
   */
  function broadcastToAll(eventType: GameEventType, payload: Record<string, unknown>): void {
    for (const clientId of service.getAuthenticatedClientIds()) {
      service.broadcastToClient(clientId, eventType, payload);
    }
  }

  describe('WebSocket Connection', () => {
    it('should accept WebSocket connections on /ws path', async () => {
      const client = await connectClient();
      expect(client.readyState).toBe(WebSocket.OPEN);
      await disconnectClient(client);
    });

    it('should send auth_result after auth message', async () => {
      const client = await connectClient();
      // connectClient 已完成 auth，验证客户端处于 OPEN 状态
      expect(client.readyState).toBe(WebSocket.OPEN);
      await disconnectClient(client);
    });

    it('should track connected clients count', async () => {
      expect(service.getConnectedCount()).toBe(0);
      const c1 = await connectClient();
      expect(service.getConnectedCount()).toBe(1);
      const c2 = await connectClient();
      expect(service.getConnectedCount()).toBe(2);
      await disconnectClient(c1);
      await new Promise(r => setTimeout(r, 100));
      expect(service.getConnectedCount()).toBe(1);
      await disconnectClient(c2);
      await new Promise(r => setTimeout(r, 100));
      expect(service.getConnectedCount()).toBe(0);
    });

    it('should handle client disconnection', async () => {
      const client = await connectClient();
      expect(service.getConnectedCount()).toBe(1);
      client.close();
      await new Promise(r => setTimeout(r, 100));
      expect(service.getConnectedCount()).toBe(0);
    });

    it('should reject connections to wrong path', async () => {
      await expect(new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/wrong-path`);
        const timer = setTimeout(() => { ws.terminate(); resolve(ws); }, 2000);
        ws.on('error', () => { clearTimeout(timer); reject(new Error('Connection failed')); });
        ws.on('open', () => { clearTimeout(timer); resolve(ws); });
      })).rejects.toThrow();
    });
  });

  describe('WebSocket Authentication', () => {
    it('should authenticate and return clientId', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth' }));
        });
      });
      expect(authResult.success).toBe(true);
      expect(authResult.clientId).toBeDefined();
      expect(ClientIdGenerator.validate(authResult.clientId)).toBe(true);
      await disconnectClient(ws);
    });

    it('should create new session for missing clientId', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth' }));
        });
      });
      expect(authResult.success).toBe(true);
      expect(authResult.clientId).toMatch(/^client_/);
      await disconnectClient(ws);
    });

    it('should create new session for invalid clientId', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          // 提供无效 clientId（缺少 client_ 前缀）
          ws.send(JSON.stringify({ type: 'auth', clientId: 'invalid-id' }));
        });
      });
      expect(authResult.success).toBe(true);
      // 无效 clientId 触发新建会话，返回新的 client_ 前缀 clientId
      expect(authResult.clientId).toMatch(/^client_/);
      expect(authResult.clientId).not.toBe('invalid-id');
      await disconnectClient(ws);
    });

    it('should reuse existing session on reconnect', async () => {
      // 首次连接获取 clientId
      const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult1 = await new Promise<any>((resolve) => {
        ws1.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws1.on('open', () => {
          ws1.send(JSON.stringify({ type: 'auth' }));
        });
      });
      const clientId = authResult1.clientId;
      await disconnectClient(ws1);
      await new Promise(r => setTimeout(r, 100));

      // 重连提供相同 clientId，应复用会话（返回相同 clientId）
      const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult2 = await new Promise<any>((resolve) => {
        ws2.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws2.on('open', () => {
          ws2.send(JSON.stringify({ type: 'auth', clientId }));
        });
      });
      expect(authResult2.success).toBe(true);
      expect(authResult2.clientId).toBe(clientId);
      await disconnectClient(ws2);
    });

    it('should require auth before other messages', async () => {
      const { ws, msg } = await connectUnauthenticated();
      // P1-2: 未认证时发送非 auth 消息返回 auth_result error
      expect(msg.type).toBe('auth_result');
      expect(msg.success).toBe(false);
      await disconnectClient(ws);
    });
  });

  describe('WebSocket Subscribe', () => {
    it('should handle subscribe message with saveId', async () => {
      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe', saveId: 'save-123' }));
      const msg = await waitForMessage(client);
      expect(msg.type).toBe('subscribed');
      expect(msg.saveId).toBe('save-123');
      await disconnectClient(client);
    });

    it('should handle unsubscribe message', async () => {
      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe', saveId: 'save-123' }));
      await waitForMessage(client); // subscribed
      client.send(JSON.stringify({ type: 'unsubscribe' }));
      const msg = await waitForMessage(client);
      expect(msg.type).toBe('unsubscribed');
      await disconnectClient(client);
    });

    it('should reject subscribe message without saveId', async () => {
      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe' }));
      // P1-2: subscribe 缺少 saveId 视为协议错误，落入 Unknown message type 分支返回 game:error
      const msg = await waitForMessage(client);
      expect(msg.type).toBe('game:error');
      expect(msg.recoverable).toBe(false);
      await disconnectClient(client);
    });

    it('should deliver events to client subscribed by saveId', async () => {
      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe', saveId: 'save-123' }));
      await waitForMessage(client); // subscribed

      // P1-2: 通过 getClientIdBySaveId + broadcastToClient 精准投递
      broadcastToSaveViaClientId('save-123', 'combat:turn_start', { data: 'test' });
      const msg = await waitForMessage(client);
      expect(msg.type).toBe('game:event');
      expect(msg.eventType).toBe('combat:turn_start');
      expect(msg.data.data).toBe('test');
      await disconnectClient(client);
    });

    it('should filter events by saveId for subscribed clients', async () => {
      const client1 = await connectClient();
      const client2 = await connectClient();
      client1.send(JSON.stringify({ type: 'subscribe', saveId: 'save-A' }));
      client2.send(JSON.stringify({ type: 'subscribe', saveId: 'save-B' }));
      await waitForMessage(client1); // subscribed
      await waitForMessage(client2); // subscribed

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      client1.on('message', (data) => msgs1.push(JSON.parse(data.toString())));
      client2.on('message', (data) => msgs2.push(JSON.parse(data.toString())));

      broadcastToSaveViaClientId('save-A', 'combat:turn_start', { text: 'for A' });
      await new Promise(r => setTimeout(r, 150));
      expect(msgs1.length).toBe(1);
      expect(msgs1[0].data.text).toBe('for A');
      expect(msgs2.length).toBe(0);

      broadcastToSaveViaClientId('save-B', 'quest:update', { quest: 'quest-1' });
      await new Promise(r => setTimeout(r, 150));
      expect(msgs1.length).toBe(1);
      expect(msgs2.length).toBe(1);
      expect(msgs2[0].data.quest).toBe('quest-1');

      await disconnectClient(client1);
      await disconnectClient(client2);
    });

    it('should allow resubscription to different saveId', async () => {
      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe', saveId: 'save-A' }));
      await waitForMessage(client); // subscribed

      broadcastToSaveViaClientId('save-A', 'combat:turn_start', { text: 'for A' });
      const msg1 = await waitForMessage(client);
      expect(msg1.data.text).toBe('for A');

      client.send(JSON.stringify({ type: 'subscribe', saveId: 'save-B' }));
      await waitForMessage(client); // subscribed

      const msgs: any[] = [];
      client.on('message', (data) => msgs.push(JSON.parse(data.toString())));

      broadcastToSaveViaClientId('save-A', 'combat:turn_start', { text: 'for A again' });
      await new Promise(r => setTimeout(r, 150));
      expect(msgs.length).toBe(0);

      broadcastToSaveViaClientId('save-B', 'quest:update', { quest: 'quest-B' });
      const msg2 = await waitForMessage(client);
      expect(msg2.data.quest).toBe('quest-B');

      await disconnectClient(client);
    });
  });

  describe('WebSocket Broadcast', () => {
    it('should broadcast to specific client by clientId', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth' }));
        });
      });
      const clientId = authResult.clientId;

      service.broadcastToClient(clientId, 'combat:turn_start', { text: 'direct' });
      const msg = await waitForMessage(ws);
      expect(msg.type).toBe('game:event');
      expect(msg.eventType).toBe('combat:turn_start');
      expect(msg.data.text).toBe('direct');

      await disconnectClient(ws);
    });

    it('should broadcast to client by saveId', async () => {
      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe', saveId: 'save-target' }));
      await waitForMessage(client); // subscribed

      broadcastToSaveViaClientId('save-target', 'combat:turn_start', { text: 'targeted' });
      const msg = await waitForMessage(client);
      expect(msg.type).toBe('game:event');
      expect(msg.eventType).toBe('combat:turn_start');
      expect(msg.data.text).toBe('targeted');

      await disconnectClient(client);
    });

    it('should broadcast to all authenticated clients', async () => {
      const c1 = await connectClient();
      const c2 = await connectClient();
      const p1 = waitForMessage(c1);
      const p2 = waitForMessage(c2);

      broadcastToAll('agent_progress', { info: 'all' });
      const [msg1, msg2] = await Promise.all([p1, p2]);
      expect(msg1.type).toBe('game:event');
      expect(msg1.eventType).toBe('agent_progress');
      expect(msg1.data.info).toBe('all');
      expect(msg2.data.info).toBe('all');

      await disconnectClient(c1);
      await disconnectClient(c2);
    });

    it('should handle closed connections gracefully during broadcast', async () => {
      const client = await connectClient();
      expect(service.getConnectedCount()).toBe(1);
      client.close();
      await new Promise(r => setTimeout(r, 100));
      expect(service.getConnectedCount()).toBe(0);
      // P1-2: 广播到已断开的客户端不应抛错（事件入队等待重连）
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth' }));
        });
      });
      expect(() => {
        service.broadcastToClient(authResult.clientId, 'agent_progress', { info: 'test' });
      }).not.toThrow();
      await disconnectClient(ws);
    });

    it('should broadcast all supported event types', async () => {
      const client = await connectClient();
      const eventTypes: GameEventType[] = [
        'combat:turn_start',
        'quest:update',
        'event:triggered',
        'agent_progress',
      ];

      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth' }));
        });
      });
      const clientId = authResult.clientId;

      for (const type of eventTypes) {
        service.broadcastToClient(clientId, type, { test: type });
        const msg = await waitForMessage(ws);
        expect(msg.type).toBe('game:event');
        expect(msg.eventType).toBe(type);
        expect(msg.data.test).toBe(type);
        expect(typeof msg.timestamp).toBe('number');
      }

      await disconnectClient(client);
      await disconnectClient(ws);
    });

    it('should include timestamp in broadcast events', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth' }));
        });
      });

      const before = Date.now();
      service.broadcastToClient(authResult.clientId, 'combat:turn_start', { data: 'test' });
      const msg = await waitForMessage(ws);
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);

      await disconnectClient(ws);
    });
  });

  describe('WebSocket Error Handling', () => {
    it('should handle invalid JSON messages gracefully', async () => {
      const client = await connectClient();
      client.send('not valid json {{{');
      await new Promise(r => setTimeout(r, 50));
      expect(client.readyState).toBe(WebSocket.OPEN);
      client.send(JSON.stringify({ type: 'subscribe', saveId: 'save-test' }));
      await waitForMessage(client); // subscribed
      broadcastToSaveViaClientId('save-test', 'combat:turn_start', { data: 'still works' });
      const msg = await waitForMessage(client);
      expect(msg.data.data).toBe('still works');
      await disconnectClient(client);
    });

    it('should handle multiple invalid JSON messages without crashing', async () => {
      const client = await connectClient();
      client.send('invalid1');
      client.send('{broken');
      client.send('{"type":}');
      await new Promise(r => setTimeout(r, 100));
      expect(client.readyState).toBe(WebSocket.OPEN);
      expect(service.getConnectedCount()).toBe(1);
      await disconnectClient(client);
    });

    it('should handle connection errors and clean up', async () => {
      const client = await connectClient();
      expect(service.getConnectedCount()).toBe(1);
      client.terminate();
      await new Promise(r => setTimeout(r, 150));
      expect(service.getConnectedCount()).toBe(0);
    });

    it('should handle shutdown with connected clients', async () => {
      const c1 = await connectClient();
      const c2 = await connectClient();
      expect(service.getConnectedCount()).toBe(2);
      const close1 = new Promise<void>(resolve => c1.on('close', () => resolve()));
      const close2 = new Promise<void>(resolve => c2.on('close', () => resolve()));
      service.shutdown();
      await Promise.all([close1, close2]);
      expect(service.getConnectedCount()).toBe(0);
    });

    it('should handle double shutdown gracefully', async () => {
      const client = await connectClient();
      const closePromise = new Promise<void>(resolve => client.on('close', () => resolve()));
      service.shutdown();
      await closePromise;
      expect(service.getConnectedCount()).toBe(0);
      expect(() => service.shutdown()).not.toThrow();
    });

    it('should handle shutdown with no clients', async () => {
      expect(service.getConnectedCount()).toBe(0);
      expect(() => service.shutdown()).not.toThrow();
      expect(service.getConnectedCount()).toBe(0);
    });
  });

  describe('WebSocket Session Recovery', () => {
    it('should preserve session on disconnect (session outlives WS connection)', async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult = await new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth' }));
        });
      });
      const clientId = authResult.clientId;

      // 订阅 saveId
      ws.send(JSON.stringify({ type: 'subscribe', saveId: 'save-preserve' }));
      await waitForMessage(ws); // subscribed

      await disconnectClient(ws);
      await new Promise(r => setTimeout(r, 100));

      // P1-2: 会话不随连接消失，getClientIdBySaveId 仍可找到
      expect(service.getClientIdBySaveId('save-preserve')).toBe(clientId);
    });

    it('should restore session on reconnect with same clientId', async () => {
      const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult1 = await new Promise<any>((resolve) => {
        ws1.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws1.on('open', () => {
          ws1.send(JSON.stringify({ type: 'auth' }));
        });
      });
      const clientId = authResult1.clientId;

      // 订阅 saveId
      ws1.send(JSON.stringify({ type: 'subscribe', saveId: 'save-reconnect' }));
      await waitForMessage(ws1); // subscribed

      await disconnectClient(ws1);
      await new Promise(r => setTimeout(r, 100));

      // 重连提供相同 clientId
      const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
      const authResult2 = await new Promise<any>((resolve) => {
        ws2.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_result') resolve(msg);
        });
        ws2.on('open', () => {
          ws2.send(JSON.stringify({ type: 'auth', clientId }));
        });
      });

      // P1-2: 重连恢复，返回相同 clientId（会话复用）
      expect(authResult2.success).toBe(true);
      expect(authResult2.clientId).toBe(clientId);

      // 会话的 saveId 绑定也应保留
      expect(service.getClientIdBySaveId('save-reconnect')).toBe(clientId);

      await disconnectClient(ws2);
    });

    it('should handle subscribe after reconnect', async () => {
      // 首次连接
      const ws1 = await connectClient();
      await disconnectClient(ws1);
      await new Promise(r => setTimeout(r, 100));

      // 重连（不带 clientId，新建会话）
      const ws2 = await connectClient();
      ws2.send(JSON.stringify({ type: 'subscribe', saveId: 'save-after-reconnect' }));
      const msg = await waitForMessage(ws2);
      expect(msg.type).toBe('subscribed');
      expect(msg.saveId).toBe('save-after-reconnect');

      // 验证广播能送达
      broadcastToSaveViaClientId('save-after-reconnect', 'combat:turn_start', { text: 'after reconnect' });
      const eventMsg = await waitForMessage(ws2);
      expect(eventMsg.data.text).toBe('after reconnect');

      await disconnectClient(ws2);
    });
  });

  describe('WebSocket + Agent Integration', () => {
    it('should broadcast game events after save creation', async () => {
      const saveRes = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'WebSocket Integration Test' })
        .expect(201);
      const saveId = saveRes.body.data.id;

      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(client); // subscribed

      broadcastToSaveViaClientId(saveId, 'combat:turn_start', { scene: 'village' });
      const msg = await waitForMessage(client);
      expect(msg.type).toBe('game:event');
      expect(msg.eventType).toBe('combat:turn_start');
      expect(msg.data.scene).toBe('village');

      await disconnectClient(client);
    });

    it('should isolate events between different save sessions', async () => {
      const saveRes1 = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Isolation Test 1' })
        .expect(201);
      const saveRes2 = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Isolation Test 2' })
        .expect(201);
      const saveId1 = saveRes1.body.data.id;
      const saveId2 = saveRes2.body.data.id;

      const client1 = await connectClient();
      const client2 = await connectClient();
      client1.send(JSON.stringify({ type: 'subscribe', saveId: saveId1 }));
      client2.send(JSON.stringify({ type: 'subscribe', saveId: saveId2 }));
      await waitForMessage(client1); // subscribed
      await waitForMessage(client2); // subscribed

      const msgs1: any[] = [];
      const msgs2: any[] = [];
      client1.on('message', (data) => msgs1.push(JSON.parse(data.toString())));
      client2.on('message', (data) => msgs2.push(JSON.parse(data.toString())));

      broadcastToSaveViaClientId(saveId1, 'combat:turn_start', { turn: 1, enemy: 'goblin' });
      await new Promise(r => setTimeout(r, 150));
      expect(msgs1.length).toBe(1);
      expect(msgs1[0].data.enemy).toBe('goblin');
      expect(msgs2.length).toBe(0);

      broadcastToSaveViaClientId(saveId2, 'quest:update', { questId: 'q1', status: 'started' });
      await new Promise(r => setTimeout(r, 150));
      expect(msgs1.length).toBe(1);
      expect(msgs2.length).toBe(1);
      expect(msgs2[0].data.questId).toBe('q1');

      await disconnectClient(client1);
      await disconnectClient(client2);
    });

    it('should broadcast all game event types for a save session', async () => {
      const saveRes = await request(app)
        .post('/api/v1/saves')
        .send({ name: 'Event Types Test' })
        .expect(201);
      const saveId = saveRes.body.data.id;

      const client = await connectClient();
      client.send(JSON.stringify({ type: 'subscribe', saveId }));
      await waitForMessage(client); // subscribed

      const gameEvents: Array<{ type: GameEventType; payload: Record<string, unknown> }> = [
        { type: 'combat:turn_start', payload: { turn: 1, enemy: 'dragon' } },
        { type: 'quest:update', payload: { questId: 'main-1', status: 'in_progress' } },
        { type: 'event:triggered', payload: { eventId: 'trap-1', effect: 'damage' } },
      ];

      for (const event of gameEvents) {
        broadcastToSaveViaClientId(saveId, event.type, event.payload);
        const msg = await waitForMessage(client);
        expect(msg.type).toBe('game:event');
        expect(msg.eventType).toBe(event.type);
        expect(msg.timestamp).toBeGreaterThan(0);
      }

      await disconnectClient(client);
    });
  });
});
