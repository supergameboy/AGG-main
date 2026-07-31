/**
 * 工具事件总线集成测试（M6 §8.2 tool-event-bus-integration）。
 *
 * 场景：组合根注册 emitter（registerToolEventEmitter → EventBus.emit 薄适配，
 * 与 index.ts L143-146 装配同型）+ EventBus 真实实例 + 订阅方。
 *
 * 覆盖：
 * ① 注册后工具执行事件到达订阅方（before→after 顺序 + payload 完整）
 * ② 订阅方抛错 → 工具执行正常（EventBus 现状语义：handler 异常 logger.error 吞错）
 * ③ 恶意订阅方在 handler 内同步触发工具执行 → 深度 >5 时 EventBus 抛错
 *    （MAX_EVENT_DEPTH=5 循环防护；BaseTool 吞错不影响工具执行结果）
 * ④ devHooks.onPublish 收到工具事件（DevTrace 首日消费验证）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@ai-rpg/shared/messaging';
import type { BusEvent } from '@ai-rpg/shared/messaging';
import {
  BaseTool,
  registerTimeoutConfig,
  registerToolEventEmitter,
} from '@ai-rpg/shared/tool-core';
import type { TimeoutConfig } from '@ai-rpg/shared/utils/timeout';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import type { ToolType } from '@ai-rpg/shared/types/agent';

const TEST_TIMEOUT_CONFIG: TimeoutConfig = {
  chat: 1000,
  directMessage: 1000,
  llmProvider: 1000,
  agentProcessing: 1000,
  dagNode: 1000,
  toolExecution: 5000,
  reactIteration: 1000,
  reactMaxTokens: 1000,
  wsHeartbeat: 1000,
  wsMaxMissedHeartbeats: 3,
};

const TOOL_TYPE = 'bus_integration_test_tool' as ToolType;

class BusIntegrationTestTool extends BaseTool {
  /** handler 实际执行计数（循环防护验证的执行证据） */
  public executionCount = 0;

  constructor() {
    super(TOOL_TYPE, 'Bus Integration Test Tool', 'M6 event bus integration test');
    this.registerMethod({
      name: 'do_work',
      description: 'work method',
      parameters: {},
      isWrite: false,
      cacheable: false,
      handler: async (): Promise<ToolResponse> => {
        this.executionCount++;
        return { success: true, data: { ok: true } };
      },
    });
    this.setPermission({
      agentType: 'tester',
      toolType: TOOL_TYPE,
      readAllowed: true,
      writeAllowed: true,
    });
  }
}

function buildContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    saveId: 'save-1',
    agentType: 'tester',
    timestamp: Date.now(),
    requestScope: {
      getDb: () => {
        throw new Error('测试环境无 db');
      },
      getOrCompute: <T>(_key: string, factory: () => Promise<T>): Promise<T> => factory(),
    },
    ...overrides,
  };
}

describe('工具事件总线集成（组合根 emitter 注册 + EventBus 真实实例）', () => {
  let bus: EventBus;

  beforeEach(() => {
    // 每用例全新 EventBus：避免订阅残留与深度计数跨用例污染
    bus = new EventBus();
    registerToolEventEmitter((eventType, event) => bus.emit(eventType, event));
    registerTimeoutConfig(() => TEST_TIMEOUT_CONFIG);
  });

  it('① 注册后工具执行事件到达订阅方（before→after 顺序 + payload 完整）', async () => {
    const received: Array<{ eventType: string; event: BusEvent }> = [];
    bus.subscribe('before_tool_execute', (event) => {
      received.push({ eventType: 'before_tool_execute', event });
    });
    bus.subscribe('after_tool_execute', (event) => {
      received.push({ eventType: 'after_tool_execute', event });
    });

    const tool = new BusIntegrationTestTool();
    const res = await tool.execute('do_work', {}, buildContext());

    expect(res.success).toBe(true);
    expect(received.map((r) => r.eventType)).toEqual([
      'before_tool_execute',
      'after_tool_execute',
    ]);
    expect(received[0].event.data).toMatchObject({
      toolType: TOOL_TYPE,
      method: 'do_work',
      saveId: 'save-1',
      agentType: 'tester',
    });
    expect(received[1].event.data).toMatchObject({
      toolType: TOOL_TYPE,
      method: 'do_work',
      success: true,
    });
    expect(received[1].event.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('② 订阅方抛错 → 工具执行正常（EventBus 现状语义吞错）', async () => {
    const afterReceived: BusEvent[] = [];
    bus.subscribe('before_tool_execute', () => {
      throw new Error('订阅方爆炸');
    });
    bus.subscribe('after_tool_execute', (event) => {
      afterReceived.push(event);
    });

    const tool = new BusIntegrationTestTool();
    const res = await tool.execute('do_work', {}, buildContext());

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
    // before 订阅方异常不影响 after 事件发布
    expect(afterReceived).toHaveLength(1);
  });

  it('③ 恶意订阅方同步触发工具执行 → 深度 >5 时 EventBus 抛错（循环防护）', async () => {
    const tool = new BusIntegrationTestTool();
    let beforeHandlerCalls = 0;

    bus.subscribe('before_tool_execute', async () => {
      beforeHandlerCalls++;
      // 硬上限防御：若循环防护失效则失败而非栈溢出
      if (beforeHandlerCalls > 20) return;
      await tool.execute('do_work', {}, buildContext());
    });

    const res = await tool.execute('do_work', {}, buildContext());

    // 工具执行结果不受事件链循环影响（BaseTool 吞掉 EventBus 深度错误）
    expect(res.success).toBe(true);
    // 深度防护证据：before 事件在深度 1..5 派发到 handler（5 次），
    // 第 6 次嵌套 execute 的 before 发布在深度 6 被 MAX_EVENT_DEPTH 中断，
    // handler 不再被调用；工具本体执行 6 次且全部正常完成。
    expect(beforeHandlerCalls).toBe(5);
    expect(tool.executionCount).toBe(6);
  });

  it('④ devHooks.onPublish 收到工具事件（DevTrace 首日消费验证）', async () => {
    const onPublish = vi.fn();
    bus.setDevHooks({ onPublish });

    const tool = new BusIntegrationTestTool();
    const res = await tool.execute('do_work', {}, buildContext());

    expect(res.success).toBe(true);
    expect(onPublish).toHaveBeenCalledTimes(2);
    expect(onPublish.mock.calls[0][0]).toBe('before_tool_execute');
    expect(onPublish.mock.calls[1][0]).toBe('after_tool_execute');
    expect(onPublish.mock.calls[0][1]).toMatchObject({
      type: 'before_tool_execute',
      saveId: 'save-1',
    });
  });
});
