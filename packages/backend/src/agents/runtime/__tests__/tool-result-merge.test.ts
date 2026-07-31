/**
 * tool-result-merge 单元测试（M4 设计 §15.2，用例 M1-M14）。
 *
 * 用例适配说明（本子任务范围约束）：
 * - 设计 M12「before_tool_call 参数替换」的 normalizedArguments 链层替换语义
 *   发生在 dispatch 链（agent-hooks.ts mergeHookPatches，本子任务冻结），
 *   此处固化同一原则在合并层的等价形态「标量后执行者赢」；
 * - 设计 M13/M14「result-normalizer 幂等/补全」在子任务B已可对真实实现验证，
 *   见本文件末尾 describe（保留合并层的「空 patch 序列」「不可变性」用例——
 *   两者验证的是不同层：合并器空序列语义 vs 规范化 hook 行为）。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AfterToolCallPatch, HookPayloadFor } from '../types.js';
import type { AgentHookContext } from '../agent-hooks.js';
import type { AgentRuntimeSnapshot } from '../agent-runtime-snapshot.js';
import { createResultNormalizerHook } from '../result-normalizer.js';

const loggerSpies = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({
  createChildLogger: () => ({
    warn: loggerSpies.warn,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// tests/setup.ts 在测试文件加载前已用真实 logger 评估过 tool-result-merge
// （setup 初始化整个 Agent 系统，ReActEngine → tool-result-merge，模块级 logger 单例），
// 必须 resetModules + 动态导入重新评估，logger mock 才能生效
// （与 prepare-next-turn.test.ts 同一模式）
let applyAfterToolCallPatch: typeof import('../tool-result-merge.js').applyAfterToolCallPatch;
let mergeToolHookResult: typeof import('../tool-result-merge.js').mergeToolHookResult;

function makeBase(): Record<string, unknown> {
  return {
    success: true,
    data: { a: 1, b: 2 },
    error: 'base-error',
    _meta: { toolType: 'map_service' },
    writeOperation: { method: 'create_location' },
  };
}

/** 深冻结：不可变性用例（M14）——任何写入尝试在严格模式下立即抛错 */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

beforeEach(async () => {
  vi.resetModules();
  ({ applyAfterToolCallPatch, mergeToolHookResult } = await import('../tool-result-merge.js'));
  loggerSpies.warn.mockClear();
});

describe('tool-result-merge（M4 §15.2 字段级合并冲突）', () => {
  it('M1: 省略字段保留原值——空 patch 应用后全字段等于 base', () => {
    const base = makeBase();
    const { result, terminate } = mergeToolHookResult(base, [{}]);

    expect(result).toEqual(base);
    expect(terminate).toBe(false);
  });

  it('M2: dataMerge 浅合并一层——同键覆盖、异键增补、既有键保留', () => {
    const base = makeBase();
    const { result } = mergeToolHookResult(base, [{ dataMerge: { b: 3, c: 4 } }]);

    expect(result.data).toEqual({ a: 1, b: 3, c: 4 });
    expect(result.success).toBe(true);
  });

  it('M3: data 整体替换——替换后 dataMerge 来源的旧键消失', () => {
    const base = makeBase();
    const { result } = mergeToolHookResult(base, [{ data: { z: 9 } }]);

    expect(result.data).toEqual({ z: 9 });
  });

  it('M4: dataMerge 目标非 plain object——忽略该字段并 warn，不抛错', () => {
    const base: Record<string, unknown> = { success: true, data: 'string-data' };
    const { result } = mergeToolHookResult(base, [{ dataMerge: { x: 1 } }]);

    expect(result.data).toBe('string-data');
    expect(loggerSpies.warn).toHaveBeenCalledOnce();
  });

  it('M5: appendWarnings 按序 concat——warnings 缺失或非数组视为空', () => {
    const withWarnings = makeBase();
    (withWarnings.data as Record<string, unknown>).warnings = ['w1'];
    expect(
      mergeToolHookResult(withWarnings, [{ appendWarnings: ['w2'] }]).result.data,
    ).toEqual({ a: 1, b: 2, warnings: ['w1', 'w2'] });

    const withoutWarnings = makeBase();
    expect(
      mergeToolHookResult(withoutWarnings, [{ appendWarnings: ['w2'] }]).result.data,
    ).toEqual({ a: 1, b: 2, warnings: ['w2'] });

    const invalidWarnings = makeBase();
    (invalidWarnings.data as Record<string, unknown>).warnings = 'not-an-array';
    expect(
      mergeToolHookResult(invalidWarnings, [{ appendWarnings: ['w2'] }]).result.data,
    ).toEqual({ a: 1, b: 2, warnings: ['w2'] });
  });

  it('M6: isError 翻转——success 取反；error 缺失补默认描述，已有 error 保留', () => {
    const base = makeBase();
    delete base.error;

    const flipped = mergeToolHookResult(base, [{ isError: true }]).result;
    expect(flipped.success).toBe(false);
    expect(flipped.error).toBe('marked-error-by-hook');

    const withError = makeBase();
    const kept = mergeToolHookResult(withError, [{ isError: true }]).result;
    expect(kept.success).toBe(false);
    expect(kept.error).toBe('base-error');

    const recovered = mergeToolHookResult(makeBase(), [{ isError: false }]).result;
    expect(recovered.success).toBe(true);
  });

  it('M7: error 清除——空字符串是合法的清除语义，不被真值判断吞掉', () => {
    const { result } = mergeToolHookResult(makeBase(), [{ error: '' }]);

    expect(result.error).toBe('');
    expect('error' in result).toBe(true);
  });

  it('M8: 多 hook 累积顺序——特异性升序应用，高特异性（后执行）字段赢', () => {
    const base = makeBase();
    const patches: AfterToolCallPatch[] = [
      { dataMerge: { x: 1 }, appendWarnings: ['generic'] },
      { dataMerge: { x: 2 }, appendWarnings: ['domain'] },
    ];
    const { result } = mergeToolHookResult(base, patches);

    expect(result.data).toEqual({ a: 1, b: 2, x: 2, warnings: ['generic', 'domain'] });
  });

  it('M9: terminate OR 语义——任一 patch 为 true 即 true，且不写入 result 字段', () => {
    const withTerminate = mergeToolHookResult(makeBase(), [{}, { terminate: true }, {}]);
    expect(withTerminate.terminate).toBe(true);
    expect('terminate' in withTerminate.result).toBe(false);

    const withoutTerminate = mergeToolHookResult(makeBase(), [{ terminate: false }, {}]);
    expect(withoutTerminate.terminate).toBe(false);
  });

  it('M10: deprecated result 兼容——先浅合并为基底（保留 base 未覆盖字段），新字段后应用', () => {
    const base = makeBase();
    const { result } = mergeToolHookResult(base, [
      {
        result: { data: { b2: 2 }, extra: 'keep-me' },
        dataMerge: { c: 3 },
      },
    ]);

    // result 浅合并：base 的 success/_meta/writeOperation 保留，data 被覆盖，extra 增补
    expect(result.success).toBe(true);
    expect(result._meta).toEqual({ toolType: 'map_service' });
    expect(result.writeOperation).toEqual({ method: 'create_location' });
    expect(result.extra).toBe('keep-me');
    // dataMerge 后应用于 result 提供的 data 之上
    expect(result.data).toEqual({ b2: 2, c: 3 });
  });

  it('M11: 确定性——同一 patch 序列应用 100 次结果全等', () => {
    const base = makeBase();
    const patches: AfterToolCallPatch[] = [
      { dataMerge: { x: 1 }, appendWarnings: ['g'], isError: true },
      { dataMerge: { y: 2 }, error: 'domain-error' },
    ];

    const first = mergeToolHookResult(base, patches);
    for (let i = 0; i < 100; i++) {
      const next = mergeToolHookResult(base, patches);
      expect(next).toEqual(first);
    }
  });

  it('M12: 标量后执行者赢——合并层等价于 normalizedArguments 整体替换原则（链层语义属 dispatcher 后续子任务）', () => {
    const base = makeBase();
    const { result } = mergeToolHookResult(base, [
      { error: 'generic-error' },
      { error: 'domain-error' },
    ]);

    expect(result.error).toBe('domain-error');
  });

  it('M13: 空 patch 序列返回 base 原值（§13 Error path：patch 全字段无效 → 返回 base 原值）', () => {
    const base = makeBase();

    expect(mergeToolHookResult(base, []).result).toBe(base);
    expect(mergeToolHookResult(base, [undefined, undefined]).result).toBe(base);
    expect(mergeToolHookResult(base, []).terminate).toBe(false);
  });

  it('M14: 不可变性——深冻结的 base 与 patches 在合并后不被修改，返回新对象', () => {
    const base = deepFreeze({
      success: true,
      data: { a: 1, warnings: ['w0'] },
      _meta: { toolType: 'map_service' },
    });
    const patch = deepFreeze<AfterToolCallPatch>({
      dataMerge: { b: 2 },
      appendWarnings: ['w1'],
      isError: true,
    });

    const { result } = mergeToolHookResult(base, [patch]);

    expect(result).not.toBe(base);
    expect(result).toEqual({
      success: false,
      data: { a: 1, warnings: ['w0', 'w1'], b: 2 },
      error: 'marked-error-by-hook',
      _meta: { toolType: 'map_service' },
    });
    // 冻结对象未被写入（严格模式下写冻结对象会抛 TypeError，上方调用未抛即证明）；
    // 嵌套引用也未被共享篡改
    expect(base.data).toEqual({ a: 1, warnings: ['w0'] });
  });

  it('applyAfterToolCallPatch 单 patch 应用：显式 undefined 视为省略（等价无此键）', () => {
    const base = makeBase();
    const result = applyAfterToolCallPatch(base, { result: undefined, data: undefined });

    expect(result).toEqual(base);
  });
});

// ─── M13/M14 原始用例：result-normalizer 真实实现（子任务B 落地后可验证） ───

function makeHookContext(
  payload: HookPayloadFor<'after_tool_call'>,
): AgentHookContext {
  // hook 仅读取 payload，snapshot 给最小合法形态（不使用 as 断言）
  const snapshot: AgentRuntimeSnapshot = {
    requestId: 'req-1',
    sessionId: 'session-1',
    agentKey: 'gamemaster',
    createdAt: Date.now(),
    modelSnapshot: { providerId: null, model: null, temperature: 0, maxTokens: 0 },
    permissionSnapshot: { configuredTools: [], defaultDeny: true },
    ruleSnapshot: [],
    skillSnapshot: [],
    helpSnapshot: [],
    toolVisibilitySnapshot: { allowedToolTypes: [], allowedFunctionNames: [] },
    promptSnapshot: { systemPrompt: '', userPrompt: '' },
    contextSnapshot: { language: null, templateId: null },
    debugSnapshot: { source: 'test' },
  };
  return {
    requestId: 'req-1',
    agentRunId: 'run-1',
    iteration: 0,
    traceIds: { requestId: 'req-1', agentRunId: 'run-1' },
    snapshot,
    payload: { ...payload },
  };
}

function makePayload(
  result: Record<string, unknown>,
  isError = false,
): HookPayloadFor<'after_tool_call'> {
  return { toolName: 'map_service__create_location', result, isError, readonlyMode: false };
}

describe('result-normalizer（M4 §10 默认 after_tool_call 信封规范化）', () => {
  it('M13: 幂等——已规范的成功/失败 result 均返回 undefined（无 patch）', async () => {
    const hook = createResultNormalizerHook();

    // 成功信封：success=true 齐全
    await expect(hook(makeHookContext(makePayload({ success: true, data: {} })))).resolves.toBeUndefined();
    // 失败信封：success=false + error 描述齐全
    await expect(
      hook(makeHookContext(makePayload({ success: false, error: 'boom' }, true))),
    ).resolves.toBeUndefined();
  });

  it('M14: 补全——success 缺失 + error 存在 → patch.isError=true', async () => {
    const hook = createResultNormalizerHook();

    await expect(
      hook(makeHookContext(makePayload({ data: {}, error: 'boom' }))),
    ).resolves.toEqual({ patch: { isError: true } });
  });

  it('补全——success=false 但 error 缺失 → 补默认错误描述', async () => {
    const hook = createResultNormalizerHook();

    await expect(
      hook(makeHookContext(makePayload({ success: false }))),
    ).resolves.toEqual({ patch: { error: 'tool execution failed (no error message provided)' } });
  });

  it('补全——success 缺失且无 error/isError 信号 → 推导为非错误', async () => {
    const hook = createResultNormalizerHook();

    await expect(
      hook(makeHookContext(makePayload({ data: { a: 1 } }))),
    ).resolves.toEqual({ patch: { isError: false } });
  });

  it('边界——payload/result 缺失 → 返回 undefined（不抛错，§13.1 F2 不阻断）', async () => {
    const hook = createResultNormalizerHook();
    const context = makeHookContext(makePayload({ success: true }));

    await expect(hook({ ...context, payload: undefined })).resolves.toBeUndefined();
  });
});
