/**
 * M4 §14.2 集成测试：ReActEngine afterToolCall terminate 透传。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M4-4维度Hook.md §14.2
 *
 * 验证契约：
 * - hook 返回 terminate=true 时（双通道：顶层 terminate 字段 / patch.terminate），
 *   引擎在 tool result 的 _meta.terminate 标记并随信封流入 ToolResult 记录
 * - 首版仅标记透传：不改变循环控制流（iterations 与 LLM 调用次数不变）、
 *   LLM 可见的 tool message content 不含 terminate（compressToolResult 不序列化 _meta）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReActEngine, ReActEngineContext, ReActEngineHooks } from '../ReActEngine.js';
import type { LLMMessageExtended, LLMResponse } from '@ai-rpg/ai';
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';

// Mock logger（与 react-engine-prepare-next-turn.test.ts 同构：模块级 logger 单例需重评估）
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// tests/setup.ts 在测试文件加载前已用真实 logger 评估过 ReActEngine（模块级 logger 单例），
// 必须 resetModules + 动态导入重新评估，logger mock 才能生效
let ReActEngineClass: typeof import('../ReActEngine.js').ReActEngine;

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

interface Harness {
  engine: ReActEngine;
  chatRaw: ReturnType<typeof vi.fn>;
  /** 每次 chatRaw 调用时的 messages 深拷贝快照（engine 跨轮复用同一数组引用，必须调用时快照） */
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
  const callToolFn = vi.fn().mockResolvedValue({
    id: 'tr-1' as ID,
    toolCallId: 'tc-1' as ID,
    success: true,
    data: { origin: 'tool' },
    timestamp: Date.now() as Timestamp,
    _meta: { toolType: 'tool_a', method: 'run', params: {} },
  });
  return { engine, chatRaw, messageSnapshots, callToolFn };
}

function createContext(overrides: Partial<ReActEngineContext> = {}): ReActEngineContext {
  return {
    systemPrompt: 'sys',
    userMessage: 'user',
    apiTools: [
      { type: 'function', function: { name: 'tool_a__run', description: 'a', parameters: {} } },
    ],
    allowedFunctionNames: new Set(['tool_a__run']),
    injectedContext: null,
    injectedMethods: [],
    currentSaveId: 'save-1',
    agentType: 'gamemaster',
    agentKey: 'story',
    maxIterations: 10,
    forceStructuredOutput: false,
    temperature: 0.7,
    maxTokens: 2048,
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

beforeEach(async () => {
  vi.resetModules();
  ({ ReActEngine: ReActEngineClass } = await import('../ReActEngine.js'));
  callSeq = 0;
});

describe('ReActEngine afterToolCall terminate 透传（M4 §14.2）', () => {
  it('T1: 顶层 terminate 通道（ToolExecutor 桥形态）→ 记录 _meta.terminate=true，原 _meta 字段保留，循环控制流不变', async () => {
    const { engine, chatRaw, messageSnapshots, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);
    // ToolExecutor 桥形态：patch 仅经 deprecated result 通道回传完整信封，terminate 走独立字段
    const hooks: ReActEngineHooks = {
      afterToolCall: async (_toolCall, result) => ({
        patch: { result },
        terminate: true,
      }),
    };

    const result = await engine.execute(createContext(), hooks, callToolFn);

    // 循环控制流不变：terminate 不触发早终止（M4 仅透传，M5+ 才消费）
    expect(result.iterations).toBe(3);
    expect(chatRaw).toHaveBeenCalledTimes(3);
    // 两条 ToolResult 记录均带标记，且原 _meta 字段（toolType/method/params）保留
    expect(result.toolCalls).toHaveLength(2);
    for (const record of result.toolCalls) {
      expect(record._meta?.terminate).toBe(true);
      expect(record._meta?.toolType).toBe('tool_a');
      expect(record._meta?.method).toBe('run');
    }
    // LLM 可见的 tool message content 不含 terminate（_meta 不序列化进 content）
    const toolMessages = messageSnapshots.flat().filter(m => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThan(0);
    for (const m of toolMessages) {
      expect(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).not.toContain('terminate');
    }
  });

  it('T2: patch.terminate 通道（直连引擎形态）→ 引擎侧 merge 提取并标记；terminate 不写入 result 信封', async () => {
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);
    const hooks: ReActEngineHooks = {
      afterToolCall: async () => ({
        patch: { dataMerge: { injected: 'by-hook' }, terminate: true },
      }),
    };

    const result = await engine.execute(createContext(), hooks, callToolFn);

    expect(result.iterations).toBe(2);
    expect(chatRaw).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toHaveLength(1);
    const record = result.toolCalls[0];
    // dataMerge 字段级合并生效
    expect(record.data).toEqual({ origin: 'tool', injected: 'by-hook' });
    // terminate 由引擎消费标记到 _meta，不写入 data/信封其他字段（§7.2 步骤6）
    expect(record._meta?.terminate).toBe(true);
    expect(record._meta?.toolType).toBe('tool_a');
    expect(record.data).not.toHaveProperty('terminate');
  });

  it('T3: hook 未返回 terminate → 记录 _meta 原样透传，无 terminate 字段', async () => {
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);
    const hooks: ReActEngineHooks = {
      afterToolCall: async () => ({ patch: { dataMerge: { injected: 'by-hook' } } }),
    };

    const result = await engine.execute(createContext(), hooks, callToolFn);

    expect(result.iterations).toBe(2);
    expect(chatRaw).toHaveBeenCalledTimes(2);
    expect(result.toolCalls[0]._meta?.terminate).toBeUndefined();
    expect(result.toolCalls[0]._meta?.toolType).toBe('tool_a');
  });

  it('T4: 无 afterToolCall hook（回归）→ 循环正常完成，记录无 terminate 标记', async () => {
    const { engine, chatRaw, callToolFn } = createHarness([
      toolCallResponse('tool_a__run'),
      finalResponse(),
    ]);

    const result = await engine.execute(createContext(), undefined, callToolFn);

    expect(result.iterations).toBe(2);
    expect(chatRaw).toHaveBeenCalledTimes(2);
    expect(result.toolCalls[0]._meta?.terminate).toBeUndefined();
  });
});
