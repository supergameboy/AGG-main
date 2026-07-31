/**
 * 面板变更统一推送端口接口（统一面板变更推送机制）
 *
 * 定义统一的面板变更推送抽象，所有面板数据变更统一通过此接口推送，
 * 前端通过 'panel:update' 事件接收。
 *
 * 替代历史 3 条并行推送路径：
 * 1. GameResponse.panelUpdates 直接字段（已移除）
 * 2. map:update 事件（已移除，由 pushPanelUpdate('location', ...) 替代）
 * 3. dialogue:message 事件（已废弃，dialogue 数据由 pushPanelUpdate('dialogue', ...) 统一推送）
 *
 * 调用方权限：
 * - 服务层 E：WSRequestHandler 通过 GameHandlerContext 注入访问
 * - Agent 核心 G：AgentRuntime 通过 AgentDeps 注入访问；CoordinatorServiceTool 通过 setter 注入访问
 * - 禁止业务层 F、数据层 A 直接调用
 */

import type { PanelUpdates } from '../types/dynamic-ui.js';

/**
 * 推送来源标记，用于前端日志与诊断。
 * - react_flush: ReAct 循环结束后 flush 推送（权威汇总，含 domain refresh 数据）
 * - tool_side_effect: 工具副作用推送（如 batch_spawn_agents 完成后保险推送，子 Agent LLM 输出 panelUpdates）
 * - init: 初始化场景推送（如 handleWSInitialize 完成后推送 location 面板）
 */
export type PushSource = 'react_flush' | 'tool_side_effect' | 'init';

/**
 * PanelUpdates 的合法 panelKey 联合类型。
 * 与 PanelUpdates 接口字段一一对应。
 */
export type PanelKey = 'character' | 'inventory' | 'quest' | 'location' | 'map' | 'combat' | 'skills' | 'npc' | 'dialogue';

/**
 * 触发推送的写操作摘要，用于前端审计与诊断。
 * 仅 toolType 与 method 两字段（不含 timestamp），因 TriggeredOp 仅用于日志诊断。
 */
export interface TriggeredOp {
  toolType: string;
  method: string;
}

/**
 * 面板变更统一推送端口接口。
 *
 * 实现委托 IWebSocketBroadcaster.broadcastToClient 推送 'panel:update' 事件。
 * 客户端未连接或发送失败时由底层 broadcastToClient 自动入队重放（B2 修复机制，
 * WebSocketService.ts:224-232 enqueueEvent 入队等待重连后重放）。
 *
 * 幂等性：同一 panelUpdates 可重复推送，前端 applyPanelUpdates 按 panelKey 增量合并，不重复入栈。
 * triggeredOps 仅做日志审计，不影响合并语义。
 */
export interface IPanelUpdateBroadcaster {
  /**
   * 推送完整 PanelUpdates。
   *
   * 期望效果：
   * - 通过 IWebSocketBroadcaster.broadcastToClient 推送 'panel:update' 事件
   * - panelUpdates 为空对象时静默跳过，不发送事件
   * - 客户端未连接时由底层入队重放
   *
   * @param saveId 面板数据归属的存档 ID
   * @param panelUpdates 标准 PanelUpdates 结构（复用 dynamic-ui.ts 现有类型）
   * @param source 来源标记，用于前端日志区分推送来源
   * @param triggeredOps 触发本次推送的写操作摘要，便于前端审计
   */
  pushPanelUpdates(
    saveId: string,
    panelUpdates: PanelUpdates,
    source?: PushSource,
    triggeredOps?: TriggeredOp[],
  ): void;

  /**
   * 推送单个面板的部分更新。
   *
   * 期望效果：内部包装为 { [panelKey]: partialUpdate } 后委托 pushPanelUpdates。
   * source 默认 'tool_side_effect'。
   *
   * 注：省略 triggeredOps 参数——主要面向 init 等无 writeOps 场景。
   * 若需附带 triggeredOps，请直接调用 pushPanelUpdates。
   *
   * @param saveId 面板数据归属的存档 ID
   * @param panelKey PanelUpdates 的合法 panelKey
   * @param partialUpdate 单面板的部分更新数据
   * @param source 来源标记，默认 'tool_side_effect'
   */
  pushPanelUpdate(
    saveId: string,
    panelKey: PanelKey,
    partialUpdate: unknown,
    source?: PushSource,
  ): void;
}
