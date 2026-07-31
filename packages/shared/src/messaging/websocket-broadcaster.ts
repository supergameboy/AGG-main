/**
 * WebSocket 广播端口接口（v1.4 新增）
 *
 * 抽象 WebSocketService 在 agents/ 中实际被调用的方法，
 * 让 agents/ 仅依赖广播契约，不依赖 WebSocketService 具体类。
 *
 * 签名来源：从 agents/ 内 grep `webSocketService\.` 调用点精确提取，共 3 个方法：
 * - broadcastToClient: BaseAgent L186 / ReActEngine L440 / YamlAgentFactory L236 / default-agent-hooks L119
 * - getClientIdBySaveId: BaseAgent L184 / ReActEngine L438
 * - getAuthenticatedClientIds: YamlAgentFactory L235
 *
 * P1-2 修订：getClientIdBySaveId / getAuthenticatedClientIds 在 WebSocketService 实现中
 * 委托给 IClientSessionManager（会话层 K）。业务层 F（StagingPool/EntityGraphUpdater）
 * 通过此接口间接访问会话查询功能，不直接依赖 IClientSessionManager（D7 决策）。
 *
 * 接口职责分离：
 * - IWebSocketBroadcaster：跨模块广播契约（Agent 核心 G 用，3 方法）
 * - IWebSocketContext：消息层内部契约（handler 用，extends IWebSocketBroadcaster + 5 方法）
 */

import type { GameEventType } from '../types/game.js';

/**
 * WebSocket 广播端口接口。
 *
 * backend/services/WebSocketService 实现此接口，
 * agents/ 层通过 AgentDeps 注入此接口，零 value import services/。
 */
export interface IWebSocketBroadcaster {
  /**
   * 向指定 clientId 广播事件（唯一公开广播方法）。
   * 发送失败或客户端不存在时入队等待重连后重放。
   */
  broadcastToClient<T>(
    clientId: string,
    eventType: GameEventType,
    payload: T,
    requestId?: string,
  ): void;

  /**
   * 根据 saveId 查找对应的 clientId（D7 决策保持单一返回）。
   * 用于在 agents/ 中根据当前 saveId 找到要推送的目标客户端。
   *
   * P1-2 修订：WebSocketService 实现中委托给 IClientSessionManager.getBySaveId，
   * 业务层 F（StagingPool/EntityGraphUpdater）通过此接口间接访问会话查询功能，
   * 不直接依赖 IClientSessionManager。
   */
  getClientIdBySaveId(saveId: string): string | null;

  /**
   * 获取所有已认证客户端的 clientId 列表。
   * 用于配置重载等需要广播给所有已认证客户端的场景。
   *
   * P1-2 修订：WebSocketService 实现中委托给 IClientSessionManager.getActiveClientIds。
   */
  getAuthenticatedClientIds(): string[];
}
