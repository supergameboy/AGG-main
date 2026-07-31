/**
 * Per-request 事件桥接器（架构规范 §13.1 合规修复，FOLLOWUP-3）。
 *
 * bootstrap EventBus 订阅器通过此桥接器将事件转发到 per-request 队列，
 * 避免在 ReAct 循环内直接写 DB 绕过 StagingPool。
 *
 * 工作原理:
 * - AgentRuntime.processMessageCore 包裹 runWithState，激活 per-request 事件上下文
 * - bootstrap 订阅器调用 pushEvent 入队（不写 DB）
 * - StagingPool.flush 后，AgentRuntime drainPendingEvents 并用 bootstrap 实例处理
 * - 非 request 上下文（init 脚本等）无状态，订阅器回退直接处理
 *
 * 并发安全: AsyncLocalStorage 跟踪异步上下文，支持并发请求隔离。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { BusEvent } from '@ai-rpg/shared/messaging';

interface RequestEventState {
  pendingEvents: BusEvent[];
}

export class RequestEventBridge {
  private readonly storage = new AsyncLocalStorage<RequestEventState>();

  /**
   * 在 per-request 事件上下文中执行 fn。
   * fn 内所有 pushEvent 调用都入队到当前 request 的 pendingEvents。
   */
  async runWithState<T>(fn: () => Promise<T>): Promise<T> {
    const state: RequestEventState = { pendingEvents: [] };
    return this.storage.run(state, fn);
  }

  /** 是否有活跃的 request 事件上下文 */
  hasState(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /**
   * 推送事件到当前 request 的 pending 队列。
   * 无 request 上下文时为 no-op（调用方应先检查 hasState 并回退直接处理）。
   */
  pushEvent(event: BusEvent): void {
    const state = this.storage.getStore();
    if (state) {
      state.pendingEvents.push(event);
    }
  }

  /** 获取并清空当前 request 的 pending 事件列表 */
  drainPendingEvents(): BusEvent[] {
    const state = this.storage.getStore();
    if (!state) return [];
    const events = state.pendingEvents;
    state.pendingEvents = [];
    return events;
  }
}

/** 模块级单例（index.ts 组合根 + agent-deps.ts 注入共享） */
export const requestEventBridge = new RequestEventBridge();
