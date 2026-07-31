/**
 * 端口接口契约（v1.3 新增）
 *
 * 这些接口定义 shared/tool-core/ 对 backend 服务的最小化依赖契约。
 * backend 对应的具体类实现这些接口，通过 ToolContext 注入。
 * 接口签名仅包含 shared/tool-core/ 内部实际调用的方法，不暴露 backend 类的全部公开 API。
 *
 * 签名来源：从实际调用点（StagingKnex.ts + BaseTool.ts）提取，非文档假设。
 */

import type { Knex } from 'knex';
import type { StagedWrite } from '../types/tool.js';

/**
 * StagingPool 的最小化接口
 *
 * 签名来源：StagingKnex.ts 的 stage()/writeCount/rollbackFrom() 调用点 +
 * EntityGraphAuditor.ts 的 getAllWrites() 调用点（P4-S4 新增）+
 * EG-M2-6: createProxyDb() 审计场景调用点 +
 * EG-M4-2: flush() Reconciler 纠错后刷盘调用点 +
 * 2026-07-25 B4 修复: clear() 失败路径显式清理调用点
 * - stage: async，接受 Omit<StagedWrite, 'id' | 'timestamp'>
 * - writeCount: getter，返回 number
 * - rollbackFrom: 同步，接受 writeIndex: number，返回移除数量（非 Promise<void>）
 * - getAllWrites: 同步，返回所有暂存写入的副本（P4-S4 新增，EntityGraphAuditor 调用）
 * - createProxyDb: 返回 StagingKnex 代理 db（EG-M2-6 新增，审计场景读取 ShadowState）
 * - flush: 将暂存写入刷入数据库（EG-M4-2 新增，Reconciler 纠错后调用）
 * - clear: 同步清空所有暂存写入 + reset shadowState（B4 修复新增，handleProgramAction 失败路径调用）
 */
export interface IStagingPool {
  stage(write: Omit<StagedWrite, 'id' | 'timestamp'>): Promise<void>;
  readonly writeCount: number;
  rollbackFrom(writeIndex: number): number;
  getAllWrites(): StagedWrite[];
  /**
   * EG-M2-6: 创建 StagingKnex 代理 db 实例（用于审计读取 ShadowState）。
   * 代理 db 拦截写操作转发到 stagingPool.stage()，
   * 读操作先查 ShadowState（待提交状态），未命中再查原始 DB。
   * @returns Knex 兼容的代理实例
   */
  createProxyDb(): Knex;
  /**
   * EG-M4-2: 将暂存写入刷入数据库（通过 writeQueue 执行事务）。
   *
   * 由 Reconciler.reconcile 在纠错+审计闭环后调用，
   * 也在 AgentRuntime.flushWithAudit / 主 flush 路径使用。
   *
   * @param writeQueue 数据库写入队列（提供事务执行 + getDb 能力）
   */
  flush(writeQueue: IWriteQueue): Promise<void>;
  /**
   * B4 修复（2026-07-25）: 同步清空所有暂存写入 + reset shadowState。
   *
   * 由 handleProgramAction 失败路径 catch 块调用，确保失败的暂存写入
   * 不会泄漏到下一次 ReAct 循环或 G2 请求。
   */
  clear(): void;
}

/**
 * ShadowStateLayer 的最小化接口
 *
 * 签名来源：StagingKnex.ts 的 read()/readOne() 调用点
 * - read: 同步（非 Promise），返回 unknown[] | undefined
 * - readOne: 同步（非 Promise），返回 Record<string, unknown> | undefined
 */
export interface IShadowStateLayer {
  read(table: string, query: Record<string, unknown>): unknown[] | undefined;
  readOne(table: string, query: Record<string, unknown>): Record<string, unknown> | undefined;
}

/**
 * DatabaseWriteQueue 的最小化接口
 *
 * 签名来源：BaseTool.ts 的 enqueueFn() 调用点 +
 * EG-M4-2: StagingPool.flush() 的 getDb() 调用点
 * - enqueueFn: 接受函数 + 描述，返回 Promise<T>（非 enqueue(item)）
 * - getDb: 返回底层 Knex 实例（EG-M4-2 新增，StagingPool.flush 创建事务时使用）
 */
export interface IWriteQueue {
  enqueueFn<T>(fn: () => Promise<T>, description?: string): Promise<T>;
  /**
   * EG-M4-2: 获取底层 Knex 实例（用于 StagingPool.flush 创建事务）。
   * @returns Knex 实例
   */
  getDb(): Knex;
}

/**
 * AgentRuntimeSnapshot 的最小化接口
 *
 * AgentRuntimeSnapshot 完整结构定义在 backend/agents/runtime/agent-runtime-snapshot.ts，
 * 包含大量嵌套类型（ModelSelectionSnapshot/PermissionSnapshot 等）。
 * 完整迁移到 shared/ 属于模块D（Phase 4）任务。
 * 此处采用 [key: string]: unknown 作为最小契约，满足 ToolContext 类型约束。
 */
export interface IAgentRuntimeSnapshot {
  [key: string]: unknown;
}

/**
 * dev:* 调试事件类型（对应 GameEventType 中的 'dev:*' 前缀事件）。
 *
 * 与 backend/services/DevTraceCollector.ts 的 TraceEntry['type'] 保持一致，
 * DevTraceHook.emit 内部拼接 'dev:{type}' 作为 WS 事件名广播。
 */
export type DevTraceType =
  | 'staging_write'
  | 'staging_commit'
  | 'event_bus_publish'
  | 'audit_decision'
  | 'graph_change'
  | 'runtime_snapshot'
  | 'llm_debug'
  // M9 LLMRequestDispatcher 调度事件（设计文档 §14.2 dev trace 验证清单）
  | 'dispatcher_request_start'
  | 'dispatcher_key_selected'
  | 'dispatcher_token_acquired'
  | 'dispatcher_cooldown_triggered'
  | 'dispatcher_key_failed'
  | 'dispatcher_request_end';

/**
 * dev:* 调试事件统一 Hook 端口接口。
 *
 * 业务代码通过此接口调用，不再直接依赖 IWebSocketBroadcaster。
 * 实现内部统一处理：DevTraceCollector.addTrace + IWebSocketBroadcaster.broadcastToClient + try-catch + warn。
 *
 * 设计目的：
 * 1. 消除业务代码中 6 处重复的 getClientIdBySaveId + broadcastToClient + try-catch + warn 模式
 * 2. 业务代码不再直接依赖消息层 J（IWebSocketBroadcaster）做 dev 事件广播，改依赖更上层的 dev trace Hook
 * 3. 统一 dev:* 事件广播行为（clientId 缺失 warn、广播失败 warn 不中断业务）
 */
export interface IDevTraceHook {
  /**
   * 记录并广播 dev:* 调试事件。
   *
   * 行为：
   * 1. 调用 DevTraceCollector.addTrace 持久化到内存 Map（供 DevTools API 查询）
   * 2. 拼接 'dev:{type}' 作为 WS 事件名
   * 3. 通过 IWebSocketBroadcaster.getClientIdBySaveId 查找 clientId
   * 4. 通过 IWebSocketBroadcaster.broadcastToClient 广播给 DevTools 客户端
   * 5. clientId 缺失或广播失败时记录 warn 日志，不中断业务
   */
  emit(params: {
    type: DevTraceType;
    saveId: string;
    data: Record<string, unknown>;
    timestamp?: number;
    requestId?: string;
  }): void;
}
