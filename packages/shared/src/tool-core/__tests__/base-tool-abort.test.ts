/**
 * BaseTool executeSingle/executeBatch abort 规范化测试（M6 §8.1 base-tool-abort）。
 *
 * 覆盖：
 * ① handler 抛 ToolAbortError → {success:false, aborted:true, error 含 reason 文案}
 * ② 普通错误不携带 aborted 字段（回归）
 * ③ aborted 响应不附加 writeOperation
 * ④ executeBatch 第 3 项后 abort → 下一项检查点命中，整体 aborted 响应且不聚合部分数据
 * ④b handler 内部 abort 经 executeSingle 规范化冒泡 → 批量整体按取消语义结束
 * ⑤ abort 不触发 toolResultCache 写入/失效（副作用纯净）
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { BaseTool, registerTimeoutConfig } from '../BaseTool.js';
import { throwIfAborted, type ToolAbortSignal } from '../abort-signal.js';
import { toolResultCache } from '../tool-result-cache.js';
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

const TOOL_TYPE = 'abort_test_tool' as ToolType;

/** 可中途翻转的 mock 信号（getter 代理到可变状态，模拟执行中外部取消） */
function createMutableSignal(reason: unknown) {
  const state = { aborted: false, reason };
  const signal: ToolAbortSignal = {
    get aborted() {
      return state.aborted;
    },
    get reason() {
      return state.reason;
    },
  };
  return { signal, abort: () => { state.aborted = true; } };
}

class AbortTestTool extends BaseTool {
  /** batch_work handler 调用计数（断言 abort 后剩余项不再执行） */
  public batchHandlerCalls = 0;
  /** 触发外部取消的 marker：handler 处理到该项时翻转 signal */
  public abortMarker: string | null = null;
  /** handler 是否在翻转后自检（模拟已迁移工具的内部检查点） */
  public handlerSelfCheck = false;

  constructor(private readonly signalController: { abort: () => void }) {
    super(TOOL_TYPE, 'Abort Test Tool', 'M6 abort test');
    this.registerMethod({
      name: 'write_abort',
      description: '写方法，handler 内部检查点',
      parameters: {},
      isWrite: true,
      handler: async (_params, context): Promise<ToolResponse> => {
        this.signalController.abort();
        throwIfAborted(context.abortSignal);
        return { success: true, data: { done: true } };
      },
    });
    this.registerMethod({
      name: 'fail_plain',
      description: '普通业务错误',
      parameters: {},
      isWrite: false,
      cacheable: false,
      handler: async (): Promise<ToolResponse> => {
        throw new Error('普通业务错误');
      },
    });
    this.registerMethod({
      name: 'batch_work',
      description: '批量方法',
      parameters: {},
      isWrite: true,
      batch: { param: 'items' },
      handler: async (params, context): Promise<ToolResponse> => {
        this.batchHandlerCalls += 1;
        if (params.marker === this.abortMarker) {
          this.signalController.abort();
        }
        // 已迁移工具的 handler 内部检查点：翻转会在此命中（④b 路径）；
        // 未自检时取消由基类下一项检查点捕获（④ 路径）
        if (this.handlerSelfCheck) {
          throwIfAborted(context.abortSignal);
        }
        return { success: true, data: { marker: params.marker } };
      },
    });
    this.registerMethod({
      name: 'aborting_read',
      description: '读方法，handler 内部检查点命中 abort',
      parameters: {},
      isWrite: false,
      handler: async (_params, context): Promise<ToolResponse> => {
        this.signalController.abort();
        throwIfAborted(context.abortSignal);
        return { success: true, data: { shouldNotCache: true } };
      },
    });
    this.registerMethod({
      name: 'cached_read',
      description: '读方法，成功并写缓存',
      parameters: {},
      isWrite: false,
      handler: async (): Promise<ToolResponse> => ({ success: true, data: { cached: true } }),
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
    saveId: 'save-abort',
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

describe('BaseTool abort 规范化', () => {
  beforeAll(() => {
    registerTimeoutConfig(() => TEST_TIMEOUT_CONFIG);
  });

  it('① handler 抛 ToolAbortError → aborted 响应且 error 含 reason 文案', async () => {
    const { signal, abort } = createMutableSignal('用户主动取消');
    const tool = new AbortTestTool({ abort });

    const res = await tool.execute('write_abort', {}, buildContext({ abortSignal: signal }));

    expect(res.success).toBe(false);
    expect(res.aborted).toBe(true);
    expect(res.error).toContain('用户主动取消');
  });

  it('② 普通错误不携带 aborted 字段（回归）', async () => {
    const { signal, abort } = createMutableSignal(undefined);
    const tool = new AbortTestTool({ abort });

    const res = await tool.execute('fail_plain', {}, buildContext({ abortSignal: signal }));

    expect(res.success).toBe(false);
    expect(res.error).toBe('普通业务错误');
    expect(res.aborted).toBeUndefined();
  });

  it('③ aborted 响应不附加 writeOperation', async () => {
    const { signal, abort } = createMutableSignal('断连');
    const tool = new AbortTestTool({ abort });

    const res = await tool.execute('write_abort', {}, buildContext({ abortSignal: signal }));

    expect(res.aborted).toBe(true);
    expect(res.writeOperation).toBeUndefined();
  });

  it('④ executeBatch 第 3 项后 abort → 检查点命中，整体 aborted 且不聚合部分数据', async () => {
    const { signal, abort } = createMutableSignal('批量中途取消');
    const tool = new AbortTestTool({ abort });
    tool.abortMarker = 'item-3';

    const items = ['item-1', 'item-2', 'item-3', 'item-4', 'item-5'].map((marker) => ({ marker }));
    const res = await tool.execute('batch_work', { items }, buildContext({ abortSignal: signal }));

    expect(res.success).toBe(false);
    expect(res.aborted).toBe(true);
    expect(res.error).toContain('批量中途取消');
    // 部分完成语义：不携带已完成项数据，不携带 writeOperation
    expect(res.data).toBeUndefined();
    expect(res.writeOperation).toBeUndefined();
    // 第 3 项完成后取消，第 4/5 项不再执行
    expect(tool.batchHandlerCalls).toBe(3);
  });

  it('④b handler 内部 abort 经 executeSingle 规范化冒泡 → 批量整体按取消语义结束', async () => {
    const { signal, abort } = createMutableSignal('handler 内部取消');
    const tool = new AbortTestTool({ abort });
    tool.handlerSelfCheck = true;
    tool.abortMarker = 'item-2';

    const items = ['item-1', 'item-2', 'item-3'].map((marker) => ({ marker }));
    const res = await tool.execute('batch_work', { items }, buildContext({ abortSignal: signal }));

    expect(res.success).toBe(false);
    expect(res.aborted).toBe(true);
    expect(res.error).toContain('handler 内部取消');
    expect(res.data).toBeUndefined();
    // 第 2 项 handler 翻转 signal 后自检命中 abort，第 3 项不再执行
    expect(tool.batchHandlerCalls).toBe(2);
  });

  it('⑤ abort 不触发 toolResultCache 写入/失效（副作用纯净）', async () => {
    const saveId = 'save-abort-cache';
    toolResultCache.invalidateSave(saveId);
    const { signal, abort } = createMutableSignal('缓存纯净性');
    const tool = new AbortTestTool({ abort });
    const context = buildContext({ saveId, abortSignal: signal });

    // 先以成功读方法写入缓存
    const seed = await tool.execute('cached_read', { q: 1 }, context);
    expect(seed.success).toBe(true);
    expect(toolResultCache.get(saveId, TOOL_TYPE, 'cached_read', { q: 1 })).toBeDefined();

    // 写方法 abort：不得失效已有缓存（invalidateAfterWrite 不应触达）
    const writeRes = await tool.execute('write_abort', {}, context);
    expect(writeRes.aborted).toBe(true);
    expect(toolResultCache.get(saveId, TOOL_TYPE, 'cached_read', { q: 1 })).toBeDefined();

    // 读方法 abort：不得写入新缓存（toolResultCache.set 不应触达）
    const readRes = await tool.execute('aborting_read', { q: 2 }, context);
    expect(readRes.aborted).toBe(true);
    expect(toolResultCache.get(saveId, TOOL_TYPE, 'aborting_read', { q: 2 })).toBeUndefined();
  });
});
