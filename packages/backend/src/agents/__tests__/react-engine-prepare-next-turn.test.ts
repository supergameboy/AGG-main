/**
 * M5 集成测试：ReActEngine prepareNextTurn hook（E1-E9）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M5-prepareNextTurn.md §9.2
 *
 * 验证 execute() 每轮 LLM 调用前的 hook 调用、ModelSwitchGuard 抖动防护、
 * effective 值逐轮累积（model / thinkingLevel / tools / systemPromptOverride）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReActEngine, ReActEngineContext } from '../ReActEngine.js';
import type { LLMMessageExtended, LLMResponse } from '@ai-rpg/ai';
import type { PrepareNextTurnHook } from '../runtime/prepare-next-turn.js';
import type { ModelSwitchGuardConfig } from '../../../../shared/src/types/agent-config.js';

// Mock logger（E2/E3/E4 断言日志）；vi.hoisted 保证在 vi.mock 工厂执行前初始化
const { mockWarn, mockInfo } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockInfo: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: mockInfo,
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// tests/setup.ts 在测试文件加载前已用真实 logger 评估过 ReActEngine（模块级 logger 单例），
// 必须 resetModules + 动态导入重新评估，logger mock 才能生效
let ReActEngineClass: typeof import('../ReActEngine.js').ReActEngine;

// ─── 响应工厂 ───

let callSeq = 0;

function toolCallResponse(toolName: string): LLMResponse {
  callSeq += 1;
  return {
    content: '',
    toolCalls: [
      { id: `call-${callSeq}`, type: 'function', function: { name: toolName, arguments: '{}' } },
    ],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

/** 无 toolCalls + 合法 JSON content → 循环结束且跳过强制结构化输出 */
function finalResponse(): LLMResponse {
  return {
    content: JSON.stringify({ dialogue: { messages: [] } }),
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: 'stop',
  };
}

// ─── 测试 harness ───

const BASELINE = { providerId: 'p-base', model: 'm-base' };
const FAST = { providerId: 'p-fast', model: 'm-fast' };

interface Harness {
  engine: ReActEngine;
  chatRaw: ReturnType<typeof vi.fn>;
  /**
   * 每次 chatRaw 调用时的 messages 深拷贝快照。
   * engine 跨轮复用同一 messages 数组引用（systemPromptOverride 原地替换 messages[0]），
   * 直接读 mock.calls 的历史数组会被后续轮污染，必须调用时快照。
   */
  messageSnapshots: LLMMessageExtended[][];
  callToolFn: ReturnType<typeof vi.fn>;
}

function createHarness(responses: LLMResponse[]): Harness {
  const queue = [...responses];
  const messageSnapshots: LLMMessageExtended[][] = [];
  const chatRaw = vi.fn().mockImplementation(async (messages: LLMMessageExtended[]) => {
    messageSnapshots.push(structuredClone(messages));
    const next = queue.shift();
    if (!next) {
      throw new Error(`chatRaw 调用次数超出 responses 数量（${responses.length}）`);
    }
    return next;
  });
  const engine = new ReActEngineClass({
    llmService: { chatRaw } as never,
    toolRegistry: {} as never,
  });
  const callToolFn = vi.fn().mockResolvedValue({ success: true, data: {} });
  return { engine, chatRaw, messageSnapshots, callToolFn };
}

function createContext(overrides: Partial<ReActEngineContext> = {}): ReActEngineContext {
  return {
    systemPrompt: 'sys',
    userMessage: 'user',
    apiTools: [
      { type: 'function', function: { name: 'tool_a__run', description: 'a', parameters: {} } },
      { type: 'function', function: { name: 'tool_b__run', description: 'b', parameters: {} } },
    ],
    allowedFunctionNames: new Set(['tool_a__run', 'tool_b__run']),
    injectedContext: null,
    injectedMethods: [],
    currentSaveId: 'save-1',
    agentType: 'gamemaster',
    agentKey: 'story',
    maxIterations: 10,
    forceStructuredOutput: false,
    temperature: 0.7,
    maxTokens: 2048,
    providerId: BASELINE.providerId,
    model: BASELINE.model,
    currentAction: 'chat',
    requestScope: {
      getOrCompute: async <T>(_key: string, factory: () => Promise<T>) => factory(),
      getDb: () => {
        throw new Error('getDb not used in engine tests');
      },
    },
    ...overrides,
  };
}

/** 提取第 n 次 chatRaw 调用的 options（第 2 个参数） */
function callOptions(chatRaw: ReturnType<typeof vi.fn>, n: number): Record<string, unknown> {
  return chatRaw.mock.calls[n - 1][1] as Record<string, unknown>;
}

/** 提取第 n 次 chatRaw 调用的 messages 快照（调用时深拷贝，不受后续轮 messages 数组原地变更污染） */
function callMessages(harness: Harness, n: number): Array<{ role: string; content: unknown }> {
  return harness.messageSnapshots[n - 1] as Array<{ role: string; content: unknown }>;
}

beforeEach(async () => {
  vi.resetModules();
  ({ ReActEngine: ReActEngineClass } = await import('../ReActEngine.js'));
  mockWarn.mockClear();
  mockInfo.mockClear();
  callSeq = 0;
});

// ─── E1-E9 ───

describe('ReActEngine prepareNextTurn 集成', () => {
  it('E1: 无 hook（回归）——chatRaw 用 context.providerId/model，无 reasoningEffort', async () => {
    const { engine, chatRaw, callToolFn } = createHarness([toolCallResponse('tool_a__run'), finalResponse()]);
    const context = createContext();

    const result = await engine.execute(context, undefined, callToolFn);

    expect(result.iterations).toBe(2);
    for (const n of [1, 2]) {
      const options = callOptions(chatRaw, n);
      expect(options.providerId).toBe(BASELINE.providerId);
      expect(options.model).toBe(BASELINE.model);
      expect(options.reasoningEffort).toBeUndefined();
      expect(options.tools).toBe(context.apiTools);
    }
  });

  it('E2: hook 第 2 轮返回 model 更新——第 1 轮 baseline，第 2、3 轮新模型', async () => {
    const hook: PrepareNextTurnHook = async (ctx) =>
      ctx.iteration === 2 ? { model: { ...FAST } } : undefined;
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);

    await engine.execute(createContext({ prepareNextTurn: hook }), undefined, callToolFn);

    expect(callOptions(chatRaw, 1).providerId).toBe(BASELINE.providerId);
    expect(callOptions(chatRaw, 1).model).toBe(BASELINE.model);
    for (const n of [2, 3]) {
      expect(callOptions(chatRaw, n).providerId).toBe(FAST.providerId);
      expect(callOptions(chatRaw, n).model).toBe(FAST.model);
    }
    expect(mockInfo).toHaveBeenCalledWith(
      'prepareNextTurn 模型切换生效',
      expect.objectContaining({ iteration: 2, providerId: FAST.providerId, model: FAST.model }),
    );
  });

  it('E3: hook 抛错——warn 日志 + 该轮降级无更新 + 循环正常继续至结束', async () => {
    const hook: PrepareNextTurnHook = async (ctx) => {
      if (ctx.iteration === 2) throw new Error('hook boom');
      return ctx.iteration === 3 ? { model: { ...FAST } } : undefined;
    };
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);

    const result = await engine.execute(createContext({ prepareNextTurn: hook }), undefined, callToolFn);

    expect(result.iterations).toBe(3);
    expect(mockWarn).toHaveBeenCalledWith(
      'prepareNextTurn hook 抛错，降级为无更新',
      expect.objectContaining({ iteration: 2, error: 'hook boom' }),
    );
    // 第 2 轮降级为无更新（baseline），第 3 轮 hook 正常生效
    expect(callOptions(chatRaw, 2).providerId).toBe(BASELINE.providerId);
    expect(callOptions(chatRaw, 3).providerId).toBe(FAST.providerId);
  });

  it('E4: guard 拒绝（max=1，hook 每轮返回不同 model）——仅第 1 次切换生效', async () => {
    const targets = [
      { providerId: 'p-1', model: 'm-1' },
      { providerId: 'p-2', model: 'm-2' },
      { providerId: 'p-3', model: 'm-3' },
    ];
    const hook: PrepareNextTurnHook = async (ctx) => ({ model: targets[ctx.iteration - 1] });
    const guard: ModelSwitchGuardConfig = { maxSwitchesPerLoop: 1, cooldownIterations: 0, allowSwitchBack: true };
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);

    await engine.execute(
      createContext({ prepareNextTurn: hook, prepareNextTurnGuard: guard }),
      undefined,
      callToolFn,
    );

    for (const n of [1, 2, 3, 4]) {
      expect(callOptions(chatRaw, n).providerId).toBe('p-1');
    }
    expect(mockWarn).toHaveBeenCalledWith(
      'prepareNextTurn 模型切换被 guard 拒绝',
      expect.objectContaining({ reason: expect.stringContaining('maxSwitchesPerLoop') }),
    );
  });

  it('E5: thinkingLevel 更新（pi 6 级）——后续轮 chatRaw options.reasoningEffort 为设定值，新值逐轮覆盖', async () => {
    const hook: PrepareNextTurnHook = async (ctx) => {
      if (ctx.iteration === 2) return { thinkingLevel: 'xhigh' };
      if (ctx.iteration === 3) return { thinkingLevel: 'off' };
      return undefined;
    };
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);

    await engine.execute(createContext({ prepareNextTurn: hook }), undefined, callToolFn);

    expect(callOptions(chatRaw, 1).reasoningEffort).toBeUndefined();
    // 6 级新枚举直通（v1.2 D5.3），引擎零转换透传至 Provider
    expect(callOptions(chatRaw, 2).reasoningEffort).toBe('xhigh');
    // 覆盖语义：新一轮 update 替换旧值；off 透传（关闭思考由 Provider 层落地）
    expect(callOptions(chatRaw, 3).reasoningEffort).toBe('off');
  });

  it('E6: tools 全量替换（v1.2）——chatRaw options.tools 等于 hook 返回数组（整体替换，非交集），替换持续生效', async () => {
    const replacementTools = [
      { type: 'function' as const, function: { name: 'tool_a__run', description: 'a-sub', parameters: {} } },
    ];
    const seenCtxApiTools: string[][] = [];
    const hook: PrepareNextTurnHook = async (ctx) => {
      seenCtxApiTools.push(ctx.apiTools.map((t) => t.function.name));
      return ctx.iteration === 2 ? { tools: replacementTools } : undefined;
    };
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);
    const context = createContext({ prepareNextTurn: hook });

    await engine.execute(context, undefined, callToolFn);

    // 第 1 轮未替换：context.apiTools
    expect(callOptions(chatRaw, 1).tools).toBe(context.apiTools);
    // 第 2、3 轮：整体替换为 hook 返回数组（引用相等，非交集过滤）
    expect(callOptions(chatRaw, 2).tools).toBe(replacementTools);
    expect(callOptions(chatRaw, 3).tools).toBe(replacementTools);
    // hook 只读视图（v1.2）：首轮 = context.apiTools；替换生效后轮 = 上次替换值
    expect(seenCtxApiTools[0]).toEqual(['tool_a__run', 'tool_b__run']);
    expect(seenCtxApiTools[1]).toEqual(['tool_a__run', 'tool_b__run']);
    expect(seenCtxApiTools[2]).toEqual(['tool_a__run']);
  });

  it('E6-补: 替换集含越权工具——chatRaw 收到全量（不做交集过滤），LLM 调用越权工具被执行时白名单拒绝', async () => {
    const evilTool = {
      type: 'function' as const,
      function: { name: 'evil__hack', description: 'evil', parameters: {} },
    };
    const hook: PrepareNextTurnHook = async (ctx) =>
      ctx.iteration === 2 ? { tools: [evilTool] } : undefined;
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('evil__hack'),
      finalResponse(),
    ]);
    const context = createContext({ prepareNextTurn: hook });

    const result = await engine.execute(context, undefined, callToolFn);

    // chatRaw 收到全量替换集（含越权工具，引擎层不过滤）
    const tools2 = callOptions(chatRaw, 2).tools as Array<{ function: { name: string } }>;
    expect(tools2.map((t) => t.function.name)).toEqual(['evil__hack']);
    // 执行时白名单（allowedFunctionNames）是独立安全层：evil__hack 越权被拒绝，
    // callToolFn 仅收到第 1 轮的 tool_a
    expect(callToolFn).toHaveBeenCalledTimes(1);
    expect(callToolFn.mock.calls[0][0]).toBe('tool_a');
    expect(mockWarn).toHaveBeenCalledWith(
      'Tool call rejected: function not in allowed list',
      expect.objectContaining({ functionName: 'evil__hack' }),
    );
    // 拒绝结果回灌 messages，循环正常推进至结束
    expect(result.iterations).toBe(3);
  });

  it('E7: systemPromptOverride——下一轮起 chatRaw messages[0].content 为新值', async () => {
    const hook: PrepareNextTurnHook = async (ctx) =>
      ctx.iteration === 2 ? { systemPromptOverride: 'new-sys' } : undefined;
    const harness = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);

    await harness.engine.execute(createContext({ prepareNextTurn: hook }), undefined, harness.callToolFn);

    expect(callMessages(harness, 1)[0]).toMatchObject({ role: 'system', content: 'sys' });
    expect(callMessages(harness, 2)[0]).toMatchObject({ role: 'system', content: 'new-sys' });
    expect(callMessages(harness, 3)[0]).toMatchObject({ role: 'system', content: 'new-sys' });
  });

  it('E8: 两次 execute（恢复重试）——guard 重置可再次切换，baseline 为新 context 值', async () => {
    // max=1：若 guard 未重置，第 2 次 execute 的切换会被拒绝
    const guard: ModelSwitchGuardConfig = { maxSwitchesPerLoop: 1, cooldownIterations: 0 };
    const hook: PrepareNextTurnHook = async (ctx) =>
      ctx.iteration === 2 ? { model: { ...FAST } } : undefined;

    const first = createHarness([toolCallResponse('tool_a__run'), finalResponse()]);
    await first.engine.execute(
      createContext({ prepareNextTurn: hook, prepareNextTurnGuard: guard }),
      undefined,
      first.callToolFn,
    );
    expect(callOptions(first.chatRaw, 2).providerId).toBe(FAST.providerId);

    const second = createHarness([toolCallResponse('tool_a__run'), finalResponse()]);
    const newBaseline = { providerId: 'p-base-2', model: 'm-base-2' };
    await second.engine.execute(
      createContext({
        prepareNextTurn: hook,
        prepareNextTurnGuard: guard,
        providerId: newBaseline.providerId,
        model: newBaseline.model,
      }),
      undefined,
      second.callToolFn,
    );

    // baseline 为新 context 值
    expect(callOptions(second.chatRaw, 1).providerId).toBe(newBaseline.providerId);
    expect(callOptions(second.chatRaw, 1).model).toBe(newBaseline.model);
    // guard 重置：第 2 次 execute 可再次切换
    expect(callOptions(second.chatRaw, 2).providerId).toBe(FAST.providerId);
  });

  it('E9: update 返回 {} 空对象——全字段回退，chatRaw 参数与上轮一致', async () => {
    const hook: PrepareNextTurnHook = async () => ({});
    const harness = createHarness([
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);
    const context = createContext({ prepareNextTurn: hook });

    await harness.engine.execute(context, undefined, harness.callToolFn);

    for (const n of [1, 2]) {
      const options = callOptions(harness.chatRaw, n);
      expect(options.providerId).toBe(BASELINE.providerId);
      expect(options.model).toBe(BASELINE.model);
      expect(options.reasoningEffort).toBeUndefined();
      expect(options.tools).toBe(context.apiTools);
      expect(callMessages(harness, n)[0]).toMatchObject({ role: 'system', content: 'sys' });
    }
  });
});
