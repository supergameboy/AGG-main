/**
 * M8 单测：fallback 压缩 tool 配对保护（findSafeCutIndex + compressInMemory）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M8-compaction改进.md §6
 * 位置适配：M3 后压缩逻辑归属 ContextManager，测试文件放 runtime/__tests__/
 * （替代设计中的 agents/__tests__/base-agent-compress-context.test.ts）。
 */

import { describe, expect, it, vi } from 'vitest';
import type { LLMMessage } from '../../../../../../shared/src/types/agent.js';
import type { IContextProvider } from '../../../../game-systems/shared/types.js';
import {
  ContextManager,
  collectToolCallIds,
  findSafeCutIndex,
  isToolResultMessage,
} from '../context-manager.js';
import type { ContextManagerDeps } from '../types.js';

// ─── 消息工厂 ───

function user(content = 'u'): LLMMessage {
  return { role: 'user', content };
}

function assistant(content = 'a'): LLMMessage {
  return { role: 'assistant', content };
}

function system(content = 's'): LLMMessage {
  return { role: 'system', content };
}

function assistantWithToolCalls(...ids: string[]): LLMMessage {
  return {
    role: 'assistant',
    content: 'a',
    toolCalls: ids.map((id) => ({
      id,
      type: 'function' as const,
      function: { name: 'tool', arguments: '{}' },
    })),
  };
}

function toolResult(toolCallId: string): LLMMessage {
  return { role: 'tool', content: 'r', name: 'tool', toolCallId };
}

// ─── A 组：findSafeCutIndex / isToolResultMessage / collectToolCallIds 纯函数 ───

describe('isToolResultMessage', () => {
  it('tool / function 角色判定为 tool 结果消息', () => {
    expect(isToolResultMessage(toolResult('1'))).toBe(true);
    expect(isToolResultMessage({ role: 'function', content: 'r', name: 'f' })).toBe(true);
    expect(isToolResultMessage(user())).toBe(false);
    expect(isToolResultMessage(assistant())).toBe(false);
    expect(isToolResultMessage(system())).toBe(false);
  });
});

describe('collectToolCallIds', () => {
  it('收集全部 assistant 消息携带的 toolCalls[].id', () => {
    const ids = collectToolCallIds([
      assistantWithToolCalls('1', '2'),
      toolResult('1'),
      assistantWithToolCalls('3'),
      user(),
    ]);
    expect(ids).toEqual(new Set(['1', '2', '3']));
  });

  it('空序列返回空集合', () => {
    expect(collectToolCallIds([])).toEqual(new Set());
  });
});

describe('findSafeCutIndex', () => {
  it('A1: 切点天然安全时不调整', () => {
    const messages = [user(), assistant(), user(), assistant()];
    expect(findSafeCutIndex(messages, 2)).toBe(2);
  });

  it('A2: 切断单配对时向后纳入 owner assistant', () => {
    const messages = [user(), assistantWithToolCalls('1'), toolResult('1'), user()];
    expect(findSafeCutIndex(messages, 2)).toBe(1);
  });

  it('A3: 多 tool 并发中间切断时退到 owner assistant', () => {
    const messages = [
      assistantWithToolCalls('1', '2', '3'),
      toolResult('1'),
      toolResult('2'),
      toolResult('3'),
      user(),
    ];
    expect(findSafeCutIndex(messages, 2)).toBe(0);
  });

  it('A4: owner 缺失的孤儿 tool_result 向前丢弃', () => {
    const messages = [toolResult('99'), user(), assistant()];
    expect(findSafeCutIndex(messages, 0)).toBe(1);
  });

  it('A5: 空序列返回 0', () => {
    expect(findSafeCutIndex([], 0)).toBe(0);
  });

  it('A6: desiredCut 越界时 clamp 到 [0, length]', () => {
    const messages = [user(), assistant(), user(), assistant()];
    expect(findSafeCutIndex(messages, 10)).toBe(4);
    expect(findSafeCutIndex(messages, -5)).toBe(0);
  });

  it('A7: 配对跨"伪多轮"时仅退到当前配对 owner', () => {
    const messages = [
      assistantWithToolCalls('1'),
      toolResult('1'),
      assistantWithToolCalls('2'),
      toolResult('2'),
    ];
    expect(findSafeCutIndex(messages, 3)).toBe(2);
  });

  it('E1: 整条序列是配对链时 safeCut=0（等效不压缩）', () => {
    const messages = [assistantWithToolCalls('1', '2'), toolResult('1'), toolResult('2')];
    expect(findSafeCutIndex(messages, 1)).toBe(0);
    expect(findSafeCutIndex(messages, 2)).toBe(0);
  });

  it('E5: legacy function 结果按相邻 assistant(functionCall) 视为配对', () => {
    const messages: LLMMessage[] = [
      { role: 'assistant', content: 'a', functionCall: { name: 'f', arguments: '{}' } },
      { role: 'function', content: 'r', name: 'f' },
      user(),
    ];
    expect(findSafeCutIndex(messages, 1)).toBe(0);
  });

  it('E6: tool_result 无 toolCallId（损坏数据）视为孤儿向前丢弃', () => {
    const orphan: LLMMessage = { role: 'tool', content: 'r', name: 'tool' };
    expect(findSafeCutIndex([orphan, user()], 0)).toBe(1);
  });

  it('A8: 防御校验——保留区内 tool_result 的 owner 在保留区外（非相邻损坏序列）时向后纳入', () => {
    const messages = [assistantWithToolCalls('1'), user(), toolResult('1')];
    expect(findSafeCutIndex(messages, 1)).toBe(0);
  });
});

// ─── B/C 组：ContextManager.compressInMemory 集成与回归 ───

interface ManagerHarness {
  manager: ContextManager;
  saveContext: ReturnType<typeof vi.fn>;
}

function createManager(options: { saveContext?: ReturnType<typeof vi.fn> } = {}): ManagerHarness {
  const saveContext = options.saveContext ?? vi.fn().mockResolvedValue(undefined);
  const contextService: IContextProvider = {
    getContext: vi.fn(),
    saveContext,
    updateMessages: vi.fn(),
    updateState: vi.fn(),
    clearContext: vi.fn(),
    getAllContexts: vi.fn(),
    compressContext: vi.fn(),
    exportContext: vi.fn(),
    importContext: vi.fn(),
  };
  const deps: ContextManagerDeps = {
    agentType: 'gamemaster',
    getContextService: () => contextService,
    getFlushQueue: () => undefined,
    getCurrentSaveId: () => 'save-1',
  };
  return { manager: new ContextManager(deps), saveContext };
}

/** 断言保留区内无孤儿 tool_result：每条 tool 结果的 toolCallId 都能在序列内找到 owner */
function expectNoOrphanToolResults(messages: LLMMessage[]): void {
  const ownerIds = collectToolCallIds(messages);
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      expect(ownerIds.has(message.toolCallId)).toBe(true);
    }
  }
}

describe('ContextManager.compressInMemory（经 addMessage 触发）', () => {
  it('B1: 消息数不超过 SOFT(100) 时不压缩', async () => {
    const { manager } = createManager();
    manager.getMutableContext().messages.push(...Array.from({ length: 99 }, () => user()));
    await manager.addMessage(user());
    expect(manager.getContext().messages.length).toBe(100);
  });

  it('B2/C2: HARD 同步压缩——切点落在配对中间时向后纳入 owner，配对完整', async () => {
    const { manager } = createManager();
    const nonSystem: LLMMessage[] = Array.from({ length: 49 }, (_, i) =>
      i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`),
    );
    // 索引 49-50 放置配对，使 desiredCut=50 恰好落在 tool_result 上
    nonSystem.push(assistantWithToolCalls('pair-call'));
    nonSystem.push(toolResult('pair-call'));
    nonSystem.push(...Array.from({ length: 97 }, (_, i) => (i % 2 === 0 ? user(`v${i}`) : assistant(`b${i}`))));
    manager.getMutableContext().messages.push(system('sys'), ...nonSystem);

    expect(manager.getContext().messages.length).toBe(149);
    await manager.addMessage(user('trigger'));

    // HARD(150) 路径同步等待压缩完成（C2：await 返回时压缩已生效）
    const compressed = manager.getContext().messages;
    // 1 system + 149 nonSystem，retainCount=99，desiredCut=50 → safeCut=49
    expect(compressed.length).toBe(101);
    expect(compressed[0].role).toBe('system');
    expect(compressed[1]).toMatchObject({ role: 'assistant' });
    expect(compressed[1].toolCalls?.[0]?.id).toBe('pair-call');
    expect(compressed[2]).toMatchObject({ role: 'tool', toolCallId: 'pair-call' });
    expectNoOrphanToolResults(compressed);
  });

  it('B3: system 消息全部保留前置且相对顺序不变', async () => {
    const { manager } = createManager();
    const systems = Array.from({ length: 5 }, (_, i) => system(`sys${i}`));
    manager.getMutableContext().messages.push(
      ...systems,
      ...Array.from({ length: 145 }, (_, i) => (i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`))),
    );
    await manager.addMessage(user('trigger'));

    const compressed = manager.getContext().messages;
    expect(compressed.length).toBe(100);
    expect(compressed.slice(0, 5).map((m) => m.content)).toEqual(['sys0', 'sys1', 'sys2', 'sys3', 'sys4']);
    expect(compressed.slice(5).every((m) => m.role !== 'system')).toBe(true);
  });

  it('B4: system 消息数超 SOFT 时 retainCount clamp 为 0，nonSystem 全裁且不抛错', async () => {
    const { manager } = createManager();
    manager.getMutableContext().messages.push(
      ...Array.from({ length: 101 }, (_, i) => system(`sys${i}`)),
      ...Array.from({ length: 49 }, () => user()),
    );
    await manager.addMessage(user('trigger'));

    const compressed = manager.getContext().messages;
    expect(compressed.length).toBe(101);
    expect(compressed.every((m) => m.role === 'system')).toBe(true);
  });

  it('B5: 压缩后 persist 被调用，落库消息数为压缩后数量', async () => {
    const { manager, saveContext } = createManager();
    manager.getMutableContext().messages.push(
      ...Array.from({ length: 149 }, (_, i) => (i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`))),
    );
    await manager.addMessage(user('trigger'));

    expect(saveContext).toHaveBeenCalled();
    const lastCall = saveContext.mock.calls[saveContext.mock.calls.length - 1];
    const persistedContext = lastCall[2] as { messages: LLMMessage[] };
    expect(persistedContext.messages.length).toBe(manager.getContext().messages.length);
    expect(persistedContext.messages.length).toBe(100);
  });

  it('C1: 无 tool 消息场景与旧 slice 逻辑行为等价', async () => {
    const { manager } = createManager();
    const original: LLMMessage[] = Array.from({ length: 149 }, (_, i) =>
      i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`),
    );
    manager.getMutableContext().messages.push(...original);
    const trigger = user('trigger');
    await manager.addMessage(trigger);

    // 旧逻辑：slice(-100)，即保留最后 100 条
    const expected = [...original, trigger].slice(-100);
    expect(manager.getContext().messages).toEqual(expected);
  });

  it('C3: SOFT 异步压缩 persist 失败不崩（catch + warn，内存压缩仍生效）', async () => {
    vi.useFakeTimers();
    try {
      const saveContext = vi.fn().mockRejectedValue(new Error('db down'));
      const { manager } = createManager({ saveContext });
      manager.getMutableContext().messages.push(...Array.from({ length: 100 }, () => user()));

      // 第 101 条触发 SOFT 异步压缩（fire-and-forget）
      await manager.addMessage(user());
      // 推进定时器，耗尽 persist 的 3 次指数退避重试（1s + 2s）
      await vi.advanceTimersByTimeAsync(10000);

      // 压缩在内存已生效（101 → 100），persist 失败未导致崩溃或未处理拒绝
      expect(manager.getContext().messages.length).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });
});
