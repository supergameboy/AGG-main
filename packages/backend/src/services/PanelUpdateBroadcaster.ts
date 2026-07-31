/**
 * PanelUpdateBroadcaster - 面板变更统一推送实现（统一面板变更推送机制）
 *
 * 服务层 E 实现 IPanelUpdateBroadcaster 端口接口，包装 IWebSocketBroadcaster.broadcastToClient
 * 推送 'panel:update' 事件。
 *
 * 注入依赖：IWebSocketBroadcaster（接口最小化，仅 3 方法：broadcastToClient/getClientIdBySaveId/
 * getAuthenticatedClientIds），不注入 IWebSocketContext（避免暴露 5 个不必要的传输层方法）。
 *
 * 调用方：
 * - AgentRuntime（通过 AgentDeps 注入）：ReAct flush 后程序化一次性推送合并后的 panelUpdates
 * - CoordinatorServiceTool（通过 setter 注入）：batch_spawn_agents 完成后主动补推子 Agent panelUpdates
 * - WSRequestHandler（通过 GameHandlerContext 注入）：初始化场景推送 location 面板
 */

import type { IWebSocketBroadcaster, IPanelUpdateBroadcaster, PanelKey, PushSource, TriggeredOp } from '@ai-rpg/shared/messaging';
import type { PanelUpdates } from '@ai-rpg/shared';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('panel-update-broadcaster');

/**
 * 'panel:update' 事件 payload 结构。
 * 与设计文档效果 1 的 payload 结构表对齐。
 */
interface PanelUpdatePayload {
  saveId: string;
  panelUpdates: PanelUpdates;
  source?: PushSource;
  triggeredOps?: TriggeredOp[];
  timestamp: number;
}

export class PanelUpdateBroadcaster implements IPanelUpdateBroadcaster {
  constructor(private readonly broadcaster: IWebSocketBroadcaster) {}

  pushPanelUpdates(
    saveId: string,
    panelUpdates: PanelUpdates,
    source?: PushSource,
    triggeredOps?: TriggeredOp[],
  ): void {
    // 空对象静默跳过（不发送事件）
    if (!panelUpdates || Object.keys(panelUpdates).length === 0) {
      logger.debug('pushPanelUpdates: panelUpdates empty, skipping', { saveId });
      return;
    }

    const clientId = this.broadcaster.getClientIdBySaveId(saveId);
    if (!clientId) {
      logger.warn('pushPanelUpdates: no client bound to saveId, payload will be enqueued for replay', {
        saveId,
        source,
      });
      // 仍调用 broadcastToClient，底层会入队等待重连重放（B2 修复机制）
      // clientId 传空字符串触发底层 warn 日志并入队
    }

    const payload: PanelUpdatePayload = {
      saveId,
      panelUpdates,
      ...(source !== undefined ? { source } : {}),
      ...(triggeredOps && triggeredOps.length > 0 ? { triggeredOps } : {}),
      timestamp: Date.now(),
    };

    this.broadcaster.broadcastToClient(clientId ?? '', 'panel:update', payload);
  }

  pushPanelUpdate(
    saveId: string,
    panelKey: PanelKey,
    partialUpdate: unknown,
    source?: PushSource,
  ): void {
    const panelUpdates = { [panelKey]: partialUpdate } as unknown as PanelUpdates;
    this.pushPanelUpdates(saveId, panelUpdates, source ?? 'tool_side_effect');
  }
}
