/**
 * 客户端会话管理器端口接口
 *
 * backend/services/ClientSessionManager 实现此接口，
 * 消费方（WebSocketService）通过构造函数注入访问。
 *
 * 会话独立于 WS 连接存在，支持重连恢复。
 * 业务层 F（StagingPool/EntityGraphUpdater）不直接依赖此接口，
 * 通过 IWebSocketBroadcaster 间接访问（D7 决策）。
 */

import type { ClientSession, InitPhase } from './types.js';

export interface IClientSessionManager {
  /**
   * 创建新会话。
   * 使用 ClientIdGenerator.generate() 生成 clientId。
   * @returns 新建的 ClientSession
   */
  create(): ClientSession;

  /**
   * 按 clientId 获取会话。
   * @returns 会话存在则返回，不存在返回 undefined
   */
  get(clientId: string): ClientSession | undefined;

  /**
   * 删除会话。
   * 用于显式登出或管理员踢出场景。
   */
  delete(clientId: string): void;

  /**
   * 列出所有活跃会话（只读快照）。
   * @returns 会话列表的只读数组
   */
  list(): readonly ClientSession[];

  /**
   * 更新会话活跃时间（重置过期计时）。
   * 每次 WS 消息/请求时调用（handleMessage 中每条非 auth 消息触发，auth 消息由 handleAuth 内部单独调用）。
   */
  updateActivity(clientId: string): void;

  /**
   * 绑定 saveId 到会话。
   * 用于游戏开始/加载存档时（subscribe 消息触发）。
   * 同时维护 saveId → clientId 反向索引。
   */
  bindSaveId(clientId: string, saveId: string): void;

  /**
   * 解绑 saveId（清除会话的 saveId 字段 + 反向索引）。
   * 用于 unsubscribe 消息触发。
   */
  unbindSaveId(clientId: string): void;

  /**
   * 绑定 templateId 到会话。
   * 用于模板编辑时。
   */
  bindTemplateId(clientId: string, templateId: string): void;

  /**
   * 设置初始化阶段。
   * null 表示非初始化中。
   */
  setInitPhase(clientId: string, phase: InitPhase | null): void;

  /**
   * 按 saveId 查找会话。
   * 用于根据存档找到对应的客户端（广播目标）。
   * WebSocketService.getClientIdBySaveId 委托此方法。
   * @returns 会话存在则返回，不存在返回 undefined
   */
  getBySaveId(saveId: string): ClientSession | undefined;

  /**
   * 获取所有活跃 clientId 列表（含未绑定 WS 的会话）。
   * 用于配置重载等需要广播给所有客户端的场景。
   * WebSocketService.getAuthenticatedClientIds 委托此方法。
   * @returns clientId 列表的只读数组
   */
  getActiveClientIds(): readonly string[];

  /**
   * 启动过期清理定时器。
   * 定期扫描并删除 lastActiveAt + SESSION_MAX_IDLE_MS < now 的会话。
   * @param intervalMs 扫描间隔（ms），默认 60_000（60s）
   */
  startIdleSweep(intervalMs?: number): void;

  /**
   * 停止过期清理定时器。
   * 用于服务关闭时清理资源（WebSocketService.shutdown 调用）。
   */
  stopIdleSweep(): void;
}
