import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import type { IDevTraceHook, DevTraceType } from '@ai-rpg/shared/tool-core';
import type { GameEventType } from '@ai-rpg/shared';
import type { DevTraceCollector } from './DevTraceCollector.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('dev-trace-hook');

/**
 * IDevTraceHook 端口接口实现。
 *
 * 封装 DevTraceCollector.addTrace + IWebSocketBroadcaster.broadcastToClient + try-catch + warn，
 * 消除业务代码中 6 处重复的 dev:* 事件广播模式（dev:llm_debug/dev:runtime_snapshot/
 * dev:staging_write/dev:staging_commit/dev:graph_change/dev:event_bus_publish）。
 *
 * 组合根（init.ts）创建实例时注入 DevTraceCollector 单例 + IWebSocketBroadcaster。
 */
export class DevTraceHook implements IDevTraceHook {
  constructor(
    private readonly devTraceCollector: DevTraceCollector | null,
    private readonly webSocketService: IWebSocketBroadcaster,
  ) {}

  emit(params: {
    type: DevTraceType;
    saveId: string;
    data: Record<string, unknown>;
    timestamp?: number;
    requestId?: string;
  }): void {
    const timestamp = params.timestamp ?? Date.now();
    const eventType = `dev:${params.type}` as GameEventType;

    // 1. DevTraceCollector 持久化（供 DevTools API 查询）
    if (this.devTraceCollector && params.saveId) {
      this.devTraceCollector.addTrace(params.saveId, {
        type: params.type,
        data: params.data,
        timestamp,
      });
    }

    // 2. WebSocket 广播给 DevTools 客户端
    try {
      const clientId = this.webSocketService.getClientIdBySaveId(params.saveId);
      if (clientId) {
        this.webSocketService.broadcastToClient(
          clientId,
          eventType,
          params.data,
          params.requestId,
        );
      } else {
        logger.warn(`dev:${params.type}: no client for saveId`, { saveId: params.saveId });
      }
    } catch (wsError) {
      logger.warn(`WebSocket broadcast failed for dev:${params.type}`, { error: wsError });
    }
  }
}
