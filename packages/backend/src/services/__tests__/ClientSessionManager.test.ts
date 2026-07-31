/**
 * ClientSessionManager 单元测试
 *
 * 验证：
 * - create/get/delete/list 基本 CRUD
 * - updateActivity 活跃时间更新
 * - bindSaveId/unbindSaveId + getBySaveId 反向索引
 * - bindTemplateId/setInitPhase 会话状态管理
 * - getActiveClientIds 获取所有 clientId
 * - startIdleSweep/stopIdleSweep 过期清理
 * - 重连恢复场景
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClientSessionManager } from '../ClientSessionManager.js';
import { SESSION_MAX_IDLE_MS, ClientIdGenerator } from '@ai-rpg/shared/session';

describe('ClientSessionManager', () => {
  let manager: ClientSessionManager;

  beforeEach(() => {
    manager = new ClientSessionManager();
  });

  afterEach(() => {
    manager.stopIdleSweep();
  });

  // ── create() ──

  describe('create()', () => {
    it('应创建新会话并返回 ClientSession', () => {
      const session = manager.create();
      expect(session).toBeDefined();
      expect(session.clientId).toMatch(/^client_[a-f0-9-]+$/);
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.lastActiveAt).toBe(session.createdAt);
      expect(session.templateId).toBeNull();
      expect(session.saveId).toBeNull();
      expect(session.initPhase).toBeNull();
    });

    it('每次创建应生成不同的 clientId', () => {
      const s1 = manager.create();
      const s2 = manager.create();
      expect(s1.clientId).not.toBe(s2.clientId);
    });
  });

  // ── get() ──

  describe('get()', () => {
    it('应按 clientId 获取会话', () => {
      const session = manager.create();
      const got = manager.get(session.clientId);
      expect(got).toBe(session);
    });

    it('不存在的 clientId 应返回 undefined', () => {
      expect(manager.get('client_nonexistent')).toBeUndefined();
    });
  });

  // ── delete() ──

  describe('delete()', () => {
    it('应删除会话', () => {
      const session = manager.create();
      manager.delete(session.clientId);
      expect(manager.get(session.clientId)).toBeUndefined();
    });

    it('删除会话应同时清理 saveId 反向索引', () => {
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      manager.delete(session.clientId);
      expect(manager.getBySaveId('save-123')).toBeUndefined();
    });

    it('删除不存在的 clientId 不应抛错', () => {
      expect(() => manager.delete('client_nonexistent')).not.toThrow();
    });
  });

  // ── list() ──

  describe('list()', () => {
    it('应返回所有会话的只读快照', () => {
      const s1 = manager.create();
      const s2 = manager.create();
      const list = manager.list();
      expect(list).toHaveLength(2);
      expect(list.map(s => s.clientId)).toContain(s1.clientId);
      expect(list.map(s => s.clientId)).toContain(s2.clientId);
    });

    it('空管理器应返回空数组', () => {
      expect(manager.list()).toHaveLength(0);
    });
  });

  // ── updateActivity() ──

  describe('updateActivity()', () => {
    it('应更新会话活跃时间', () => {
      const session = manager.create();
      const originalActive = session.lastActiveAt;
      // 等待 10ms 确保时间差异
      const future = originalActive + 10000;
      vi.useFakeTimers();
      vi.setSystemTime(future);
      manager.updateActivity(session.clientId);
      expect(session.lastActiveAt).toBe(future);
      vi.useRealTimers();
    });

    it('不存在的 clientId 不应抛错', () => {
      expect(() => manager.updateActivity('client_nonexistent')).not.toThrow();
    });
  });

  // ── bindSaveId() / unbindSaveId() / getBySaveId() ──

  describe('bindSaveId() / unbindSaveId() / getBySaveId()', () => {
    it('bindSaveId 应绑定 saveId 到会话', () => {
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      expect(session.saveId).toBe('save-123');
    });

    it('getBySaveId 应按 saveId 查找会话（O(1) 反向索引）', () => {
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      const found = manager.getBySaveId('save-123');
      expect(found).toBe(session);
    });

    it('getBySaveId 不存在应返回 undefined', () => {
      expect(manager.getBySaveId('save-nonexistent')).toBeUndefined();
    });

    it('unbindSaveId 应清除会话的 saveId 字段 + 反向索引', () => {
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      manager.unbindSaveId(session.clientId);
      expect(session.saveId).toBeNull();
      expect(manager.getBySaveId('save-123')).toBeUndefined();
    });

    it('重新 bindSaveId 应更新反向索引（旧 saveId 解绑）', () => {
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-1');
      manager.bindSaveId(session.clientId, 'save-2');
      expect(session.saveId).toBe('save-2');
      expect(manager.getBySaveId('save-1')).toBeUndefined();
      expect(manager.getBySaveId('save-2')).toBe(session);
    });

    it('不存在的 clientId bindSaveId 不应抛错', () => {
      expect(() => manager.bindSaveId('client_nonexistent', 'save-1')).not.toThrow();
    });
  });

  // ── bindTemplateId() / setInitPhase() ──

  describe('bindTemplateId() / setInitPhase()', () => {
    it('bindTemplateId 应绑定 templateId 到会话', () => {
      const session = manager.create();
      manager.bindTemplateId(session.clientId, 'tpl-123');
      expect(session.templateId).toBe('tpl-123');
    });

    it('setInitPhase 应设置初始化阶段', () => {
      const session = manager.create();
      manager.setInitPhase(session.clientId, 'character-creation');
      expect(session.initPhase).toBe('character-creation');
    });

    it('setInitPhase null 应清除初始化阶段', () => {
      const session = manager.create();
      manager.setInitPhase(session.clientId, 'initializing');
      manager.setInitPhase(session.clientId, null);
      expect(session.initPhase).toBeNull();
    });
  });

  // ── getActiveClientIds() ──

  describe('getActiveClientIds()', () => {
    it('应返回所有会话的 clientId 列表', () => {
      const s1 = manager.create();
      const s2 = manager.create();
      const ids = manager.getActiveClientIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain(s1.clientId);
      expect(ids).toContain(s2.clientId);
    });

    it('空管理器应返回空数组', () => {
      expect(manager.getActiveClientIds()).toHaveLength(0);
    });
  });

  // ── startIdleSweep() / stopIdleSweep() ──

  describe('startIdleSweep() / stopIdleSweep()', () => {
    it('应清理过期会话（lastActiveAt + SESSION_MAX_IDLE_MS < now）', () => {
      vi.useFakeTimers();
      const session = manager.create();
      // 模拟时间流逝超过过期阈值
      vi.setSystemTime(session.createdAt + SESSION_MAX_IDLE_MS + 1);
      manager.startIdleSweep(100); // 100ms 间隔
      // 触发定时器
      vi.advanceTimersByTime(200);
      expect(manager.get(session.clientId)).toBeUndefined();
      vi.useRealTimers();
    });

    it('不应清理活跃会话（lastActiveAt + SESSION_MAX_IDLE_MS >= now）', () => {
      vi.useFakeTimers();
      const session = manager.create();
      // 设置时间为距离过期还有 10 秒（推进 200ms 后仍不过期）
      vi.setSystemTime(session.createdAt + SESSION_MAX_IDLE_MS - 10000);
      manager.startIdleSweep(100);
      vi.advanceTimersByTime(200);
      expect(manager.get(session.clientId)).toBeDefined();
      vi.useRealTimers();
    });

    it('updateActivity 应重置过期计时', () => {
      vi.useFakeTimers();
      const session = manager.create();
      // 模拟时间流逝接近过期
      vi.setSystemTime(session.createdAt + SESSION_MAX_IDLE_MS - 10000);
      manager.updateActivity(session.clientId); // 重置活跃时间
      // 设置时间为距离新的过期还有 10 秒（推进 200ms 后仍不过期）
      vi.setSystemTime(session.lastActiveAt + SESSION_MAX_IDLE_MS - 10000);
      manager.startIdleSweep(100);
      vi.advanceTimersByTime(200);
      expect(manager.get(session.clientId)).toBeDefined();
      vi.useRealTimers();
    });

    it('stopIdleSweep 应停止定时器', () => {
      vi.useFakeTimers();
      const session = manager.create();
      vi.setSystemTime(session.createdAt + SESSION_MAX_IDLE_MS + 1);
      manager.startIdleSweep(100);
      manager.stopIdleSweep();
      vi.advanceTimersByTime(1000);
      // stopIdleSweep 后不应清理
      expect(manager.get(session.clientId)).toBeDefined();
      vi.useRealTimers();
    });

    it('过期清理应同时清理 saveId 反向索引', () => {
      vi.useFakeTimers();
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      vi.setSystemTime(session.createdAt + SESSION_MAX_IDLE_MS + 1);
      manager.startIdleSweep(100);
      vi.advanceTimersByTime(200);
      expect(manager.getBySaveId('save-123')).toBeUndefined();
      vi.useRealTimers();
    });
  });

  // ── 重连恢复场景 ──

  describe('重连恢复场景', () => {
    it('WS 断开后会话保留（不删除）', () => {
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      manager.bindTemplateId(session.clientId, 'tpl-456');
      manager.setInitPhase(session.clientId, 'character-creation');
      // WS 断开：ClientSessionManager 不做任何操作（会话由过期清理管理）
      // 验证会话仍然存在
      expect(manager.get(session.clientId)).toBeDefined();
      expect(manager.getBySaveId('save-123')).toBe(session);
      expect(session.templateId).toBe('tpl-456');
      expect(session.initPhase).toBe('character-creation');
    });

    it('重连后通过 clientId 复用会话', () => {
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      // 重连：通过 clientId 查找会话
      const restored = manager.get(session.clientId);
      expect(restored).toBe(session);
      expect(restored?.saveId).toBe('save-123');
    });

    it('会话过期后才真正删除', () => {
      vi.useFakeTimers();
      const session = manager.create();
      manager.bindSaveId(session.clientId, 'save-123');
      // 会话保留至过期
      vi.setSystemTime(session.createdAt + SESSION_MAX_IDLE_MS - 1);
      expect(manager.get(session.clientId)).toBeDefined();
      // 过期后清理
      vi.setSystemTime(session.createdAt + SESSION_MAX_IDLE_MS + 1);
      manager.startIdleSweep(100);
      vi.advanceTimersByTime(200);
      expect(manager.get(session.clientId)).toBeUndefined();
      vi.useRealTimers();
    });
  });

  // ── ClientIdGenerator 集成 ──

  describe('ClientIdGenerator 集成', () => {
    it('create() 生成的 clientId 应通过 ClientIdGenerator.validate 校验', () => {
      const session = manager.create();
      expect(ClientIdGenerator.validate(session.clientId)).toBe(true);
    });
  });
});
