/**
 * BaseTool execute() 事件集成测试（M6 §8.1 base-tool-events）。
 *
 * 覆盖：
 * ① 正常执行恰好发布 before→after 一对，payload 字段完整
 * ② handler 失败 → after.success=false 且 error 透传
 * ③ 方法未找到/权限拒绝 → 不发布任何事件
 * ④ emitter 未注册 → 执行正常 + logger.debug 降级（G4 静默降级）
 * ⑤ emitter 抛错被吞 → 不影响 ToolResponse
 * ⑥ abort 入口已触发 → 返回 aborted 响应且零事件
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  BaseTool,
  registerTimeoutConfig,
  registerToolEventEmitter,
  type ToolEventEmitter,
} from '../BaseTool.js';
import type { TimeoutConfig } from '../../utils/timeout.js';
import type { ToolContext, ToolResponse } from '../../types/tool.js';
import type { ToolType } from '../../types/agent.js';

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

const TOOL_TYPE = 'events_test_tool' as ToolType;

/** 事件捕获记录 */
interface CapturedEmission {
  eventType: string;
  event: {
    type: string;
    saveId: string;
    data: Record<string, unknown>;
    timestamp: number;
  };
}

class EventsTestTool extends BaseTool {
  /** 置 true 时下一次 handler 返回业务失败 */
  public failNext = false;

  constructor() {
    super(TOOL_TYPE, 'Events Test Tool', 'M6 events integration test');
    this.registerMethod({
      name: 'do_work',
      description: 'work method',
      parameters: {},
      isWrite: false,
      cacheable: false,
      handler: async (): Promise<ToolResponse> => {
        if (this.failNext) {
          this.failNext = false;
          return { success: false, error: '业务失败' };
        }
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

describe('BaseTool execute() 工具事件集成', () => {
  const captured: CapturedEmission[] = [];
  const capturingEmitter: ToolEventEmitter = (eventType, event) => {
    captured.push({ eventType, event });
  };

  beforeEach(() => {
    captured.length = 0;
    // 每个用例重置为捕获 emitter（⑤ 在用例内覆盖为抛错 emitter）
    registerToolEventEmitter(capturingEmitter);
    registerTimeoutConfig(() => TEST_TIMEOUT_CONFIG);
  });

  it('① 正常执行恰好发布 before→after 一对且 payload 完整', async () => {
    const tool = new EventsTestTool();
    const res = await tool.execute('do_work', {}, buildContext());

    expect(res.success).toBe(true);
    expect(captured.map((c) => c.eventType)).toEqual([
      'before_tool_execute',
      'after_tool_execute',
    ]);

    const before = captured[0].event;
    expect(before.type).toBe('before_tool_execute');
    expect(before.saveId).toBe('save-1');
    expect(before.data).toMatchObject({
      toolType: TOOL_TYPE,
      method: 'do_work',
      saveId: 'save-1',
      agentType: 'tester',
    });

    const afterData = captured[1].event.data;
    expect(afterData).toMatchObject({
      toolType: TOOL_TYPE,
      method: 'do_work',
      success: true,
    });
    expect(afterData.durationMs).toBeGreaterThanOrEqual(0);
    expect(afterData.error).toBeUndefined();
    expect(afterData.aborted).toBeUndefined();
  });

  it('② handler 失败 → after.success=false 且 error 透传', async () => {
    const tool = new EventsTestTool();
    tool.failNext = true;
    const res = await tool.execute('do_work', {}, buildContext());

    expect(res.success).toBe(false);
    expect(res.error).toBe('业务失败');
    expect(captured.map((c) => c.eventType)).toEqual([
      'before_tool_execute',
      'after_tool_execute',
    ]);
    expect(captured[1].event.data.success).toBe(false);
    expect(captured[1].event.data.error).toBe('业务失败');
  });

  it('③ 方法未找到/权限拒绝 → 不发布任何事件', async () => {
    const tool = new EventsTestTool();

    const notFound = await tool.execute('nonexistent', {}, buildContext());
    expect(notFound.success).toBe(false);

    const denied = await tool.execute('do_work', {}, buildContext({ agentType: 'stranger' }));
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('Permission denied');

    expect(captured).toHaveLength(0);
  });

  it('⑤ emitter 抛错被吞 → 不影响 ToolResponse', async () => {
    registerToolEventEmitter(() => {
      throw new Error('emitter 爆炸');
    });

    const tool = new EventsTestTool();
    const res = await tool.execute('do_work', {}, buildContext());

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
  });

  it('⑥ abort 入口已触发 → 返回 aborted 响应且零事件', async () => {
    const tool = new EventsTestTool();
    const res = await tool.execute(
      'do_work',
      {},
      buildContext({ abortSignal: { aborted: true, reason: '用户取消' } }),
    );

    expect(res.success).toBe(false);
    expect(res.aborted).toBe(true);
    expect(res.error).toContain('用户取消');
    expect(captured).toHaveLength(0);
  });
});

describe('BaseTool 未注册 emitter 降级（G4）', () => {
  it('④ emitter 未注册时执行正常 + logger.debug 降级', async () => {
    // 模块级 emitter 一旦注册无法撤销，用全新模块图获得"从未注册"状态
    vi.resetModules();
    const loggerModule = await import('../../utils/logger.js');
    const debugSpy = vi.fn();
    loggerModule.registerChildLoggerFactory(() => {
      const logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: debugSpy,
        verbose: vi.fn(),
        // 自引用满足 ILogger.child 契约
        child: () => logger,
      };
      return logger;
    });
    const freshModule = await import('../BaseTool.js');
    freshModule.registerTimeoutConfig(() => TEST_TIMEOUT_CONFIG);

    class FreshTool extends freshModule.BaseTool {
      constructor() {
        super(TOOL_TYPE, 'Fresh Tool', 'unregistered emitter test');
        this.registerMethod({
          name: 'do_work',
          description: 'work method',
          parameters: {},
          isWrite: false,
          cacheable: false,
          handler: async (): Promise<ToolResponse> => ({ success: true, data: { ok: true } }),
        });
        this.setPermission({
          agentType: 'tester',
          toolType: TOOL_TYPE,
          readAllowed: true,
          writeAllowed: true,
        });
      }
    }

    const res = await new FreshTool().execute('do_work', {}, buildContext());

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
    // 降级证据：before/after 两次发布尝试均走 logger.debug
    const toolEventDebugCalls = debugSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('Tool event emitter not registered'),
    );
    expect(toolEventDebugCalls.length).toBe(2);
  });
});
