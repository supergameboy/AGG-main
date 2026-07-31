/**
 * PanelUpdateBroadcaster 单元测试（统一面板变更推送机制）
 *
 * 验证：
 * - pushPanelUpdates 正常推送 'panel:update' 事件
 * - pushPanelUpdates 空 panelUpdates 静默跳过
 * - pushPanelUpdates clientId 不存在时仍调 broadcastToClient（依赖底层入队重放）
 * - pushPanelUpdates 幂等性（同一 panelUpdates 重复推送不合并、不去重）
 * - pushPanelUpdate 单面板部分更新包装为 PanelUpdates 后委托 pushPanelUpdates
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import type { PanelUpdates } from '@ai-rpg/shared';
import { PanelUpdateBroadcaster } from '../PanelUpdateBroadcaster.js';

// ─── Mock IWebSocketBroadcaster ─────────────────────────────

function createMockBroadcaster(): IWebSocketBroadcaster & {
  broadcastToClient: ReturnType<typeof vi.fn>;
  getClientIdBySaveId: ReturnType<typeof vi.fn>;
  getAuthenticatedClientIds: ReturnType<typeof vi.fn>;
} {
  return {
    broadcastToClient: vi.fn(),
    getClientIdBySaveId: vi.fn(),
    getAuthenticatedClientIds: vi.fn().mockReturnValue([]),
  };
}

describe('PanelUpdateBroadcaster', () => {
  let broadcaster: ReturnType<typeof createMockBroadcaster>;
  let panelBroadcaster: PanelUpdateBroadcaster;

  beforeEach(() => {
    broadcaster = createMockBroadcaster();
    panelBroadcaster = new PanelUpdateBroadcaster(broadcaster);
  });

  // ── pushPanelUpdates 正常推送 ──

  describe('pushPanelUpdates 正常推送', () => {
    it('应通过 broadcastToClient 推送 panel:update 事件并携带完整 payload', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue('client-1');
      const panelUpdates: PanelUpdates = {
        character: { gold: 100, level: 5 },
      };
      const triggeredOps = [{ toolType: 'inventory_service', method: 'add_item' }];

      panelBroadcaster.pushPanelUpdates('save-1', panelUpdates, 'react_flush', triggeredOps);

      expect(broadcaster.broadcastToClient).toHaveBeenCalledTimes(1);
      const [clientId, eventType, payload] = broadcaster.broadcastToClient.mock.calls[0];
      expect(clientId).toBe('client-1');
      expect(eventType).toBe('panel:update');
      expect(payload.saveId).toBe('save-1');
      expect(payload.panelUpdates).toEqual(panelUpdates);
      expect(payload.source).toBe('react_flush');
      expect(payload.triggeredOps).toEqual(triggeredOps);
      expect(typeof payload.timestamp).toBe('number');
    });

    it('source 与 triggeredOps 为 undefined 时 payload 不含这两个字段', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue('client-1');
      const panelUpdates: PanelUpdates = { npc: { nearby: [] } };

      panelBroadcaster.pushPanelUpdates('save-1', panelUpdates);

      const [, , payload] = broadcaster.broadcastToClient.mock.calls[0];
      expect(payload).not.toHaveProperty('source');
      expect(payload).not.toHaveProperty('triggeredOps');
      expect(payload.saveId).toBe('save-1');
      expect(payload.panelUpdates).toEqual(panelUpdates);
    });

    it('triggeredOps 为空数组时 payload 不含 triggeredOps 字段', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue('client-1');
      const panelUpdates: PanelUpdates = { character: { gold: 50 } };

      panelBroadcaster.pushPanelUpdates('save-1', panelUpdates, 'react_flush', []);

      const [, , payload] = broadcaster.broadcastToClient.mock.calls[0];
      expect(payload).not.toHaveProperty('triggeredOps');
    });
  });

  // ── 空 panelUpdates 静默跳过 ──

  describe('空 panelUpdates 静默跳过', () => {
    it('panelUpdates 为空对象时不调 broadcastToClient', () => {
      panelBroadcaster.pushPanelUpdates('save-1', {});

      expect(broadcaster.broadcastToClient).not.toHaveBeenCalled();
    });

    it('pushPanelUpdate 包装的 partialUpdate 为空对象时仍推送（无法判定单面板语义是否为空）', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue('client-1');
      // pushPanelUpdate 包装为 { location: {} }，外层 panelUpdates 不为空
      panelBroadcaster.pushPanelUpdate('save-1', 'location', {}, 'init');

      expect(broadcaster.broadcastToClient).toHaveBeenCalledTimes(1);
      const [, , payload] = broadcaster.broadcastToClient.mock.calls[0];
      expect(payload.panelUpdates).toEqual({ location: {} });
      expect(payload.source).toBe('init');
    });
  });

  // ── clientId 不存在仍调用 broadcastToClient（依赖底层入队重放） ──

  describe('clientId 不存在时入队重放', () => {
    it('getClientIdBySaveId 返回 null 时仍调 broadcastToClient 传入空字符串', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue(null);
      const panelUpdates: PanelUpdates = { character: { gold: 100 } };

      panelBroadcaster.pushPanelUpdates('save-1', panelUpdates, 'react_flush');

      expect(broadcaster.broadcastToClient).toHaveBeenCalledTimes(1);
      const [clientId, , payload] = broadcaster.broadcastToClient.mock.calls[0];
      expect(clientId).toBe('');
      expect(payload.saveId).toBe('save-1');
    });
  });

  // ── 幂等性 ──

  describe('幂等性', () => {
    it('同一 panelUpdates 重复推送不合并、不去重，每次都调 broadcastToClient', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue('client-1');
      const panelUpdates: PanelUpdates = { character: { gold: 100 } };

      panelBroadcaster.pushPanelUpdates('save-1', panelUpdates, 'react_flush');
      panelBroadcaster.pushPanelUpdates('save-1', panelUpdates, 'react_flush');
      panelBroadcaster.pushPanelUpdates('save-1', panelUpdates, 'react_flush');

      expect(broadcaster.broadcastToClient).toHaveBeenCalledTimes(3);
    });
  });

  // ── pushPanelUpdate 单面板部分更新 ──

  describe('pushPanelUpdate 单面板部分更新', () => {
    it('应包装为 { [panelKey]: partialUpdate } 后委托 pushPanelUpdates', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue('client-1');
      const partialUpdate = { currentLocationId: 'loc-1', currentLocationName: '广场' };

      panelBroadcaster.pushPanelUpdate('save-1', 'location', partialUpdate, 'init');

      expect(broadcaster.broadcastToClient).toHaveBeenCalledTimes(1);
      const [, , payload] = broadcaster.broadcastToClient.mock.calls[0];
      expect(payload.panelUpdates).toEqual({ location: partialUpdate });
      expect(payload.source).toBe('init');
    });

    it('source 未传时默认 tool_side_effect', () => {
      broadcaster.getClientIdBySaveId.mockReturnValue('client-1');

      panelBroadcaster.pushPanelUpdate('save-1', 'character', { gold: 50 });

      const [, , payload] = broadcaster.broadcastToClient.mock.calls[0];
      expect(payload.source).toBe('tool_side_effect');
    });
  });
});
