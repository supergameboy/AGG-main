import { describe, expect, it, vi } from 'vitest';
import {
  getFloatingMinimapPositionClass,
  getMinimapMetrics,
  normalizeMinimapPosition,
  normalizeMinimapSize,
} from '../GameLayout';

vi.mock('@/services/WebSocketManager', () => ({
  wsManager: {
    sendRequest: vi.fn(),
    getState: vi.fn(() => 'connected'),
    onMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('@/services/WSRequestBuilder', () => ({
  WSRequestBuilder: {},
}));

describe('GameLayout minimap layout', () => {
  it('应将 minimap_position 规范为受支持的位置值', () => {
    expect(normalizeMinimapPosition('top-left')).toBe('top-left');
    expect(normalizeMinimapPosition('bottom-right')).toBe('bottom-right');
    expect(normalizeMinimapPosition('unknown')).toBe('top-left');
    expect(normalizeMinimapPosition(undefined)).toBe('top-left');
  });

  it('应将 minimap_size 规范为受支持的尺寸值', () => {
    expect(normalizeMinimapSize('small')).toBe('small');
    expect(normalizeMinimapSize('large')).toBe('large');
    expect(normalizeMinimapSize('unknown')).toBe('medium');
    expect(normalizeMinimapSize(undefined)).toBe('medium');
  });

  it('左侧内嵌 minimap 应根据尺寸返回高度', () => {
    expect(getMinimapMetrics('left', 'small')).toEqual({ height: 160 });
    expect(getMinimapMetrics('left', 'medium')).toEqual({ height: 200 });
    expect(getMinimapMetrics('left', 'large')).toEqual({ height: 240 });
  });

  it('浮层 minimap 应根据尺寸返回宽高并映射浮层位置 class', () => {
    expect(getMinimapMetrics('floating', 'small')).toEqual({ width: 288, height: 208 });
    expect(getMinimapMetrics('floating', 'medium')).toEqual({ width: 336, height: 240 });
    expect(getMinimapMetrics('floating', 'large')).toEqual({ width: 384, height: 280 });
    expect(getFloatingMinimapPositionClass('top-right')).toBe('top-2 right-2');
    expect(getFloatingMinimapPositionClass('bottom-right')).toBe('bottom-2 right-2');
  });
});
