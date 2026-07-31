/**
 * M8 §6.2 B6 补测：压缩日志可观测字段（desiredCut / safeCut / cutAdjusted）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M8-compaction改进.md §6.2 B 组
 *
 * 独立文件原因：断言 logger 需 mock 模块级单例（createChildLogger 在模块加载时
 * 求值），vi.mock + resetModules + 动态导入会重评估 context-manager；与既有
 * context-manager.test.ts（静态导入、真实 logger）共存会互相污染，故单独成文。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LLMMessage } from '../../../../../../shared/src/types/agent.js';
import type { IContextProvider } from '../../../../game-systems/shared/types.js';
import type { ContextManagerDeps } from '../types.js';

const loggerInfo = vi.fn();
const loggerWarn = vi.fn();

vi.mock('../../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: loggerInfo,
    warn: loggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

let ContextManagerClass: typeof import('../context-manager.js').ContextManager;

beforeEach(async () => {
  vi.resetModules();
  loggerInfo.mockClear();
  loggerWarn.mockClear();
  ({ ContextManager: ContextManagerClass } = await import('../context-manager.js'));
});

function user(content = 'u'): LLMMessage {
  return { role: 'user', content };
}

function assistant(content = 'a'): LLMMessage {
  return { role: 'assistant', content };
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

function createManager() {
  const contextService: IContextProvider = {
    getContext: vi.fn(),
    saveContext: vi.fn().mockResolvedValue(undefined),
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
  return new ContextManagerClass(deps);
}

describe('B6: 压缩日志可观测字段（desiredCut / safeCut / cutAdjusted）', () => {
  it('HARD 压缩切点落在配对中间时，日志含 desiredCut/safeCut 且 cutAdjusted=true', async () => {
    const manager = createManager();
    const nonSystem: LLMMessage[] = Array.from({ length: 49 }, (_, i) =>
      i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`),
    );
    // 索引 49-50 放置配对，使 desiredCut=50 恰好落在 tool_result 上
    nonSystem.push(assistantWithToolCalls('pair-call'));
    nonSystem.push(toolResult('pair-call'));
    nonSystem.push(...Array.from({ length: 98 }, (_, i) => (i % 2 === 0 ? user(`v${i}`) : assistant(`b${i}`))));
    manager.getMutableContext().messages.push(...nonSystem);

    // 149 条 → 第 150 条触发 HARD 同步压缩；无 system → retainCount=100，desiredCut=50
    await manager.addMessage(user('trigger'));

    const compressedLog = loggerInfo.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('compressed'),
    );
    expect(compressedLog).toBeDefined();
    const fields = compressedLog![1] as Record<string, unknown>;
    expect(fields.desiredCut).toBe(50);
    expect(fields.safeCut).toBe(49);
    expect(fields.cutAdjusted).toBe(true);
  });

  it('切点天然安全时 cutAdjusted=false（safeCut === desiredCut）', async () => {
    const manager = createManager();
    manager.getMutableContext().messages.push(
      ...Array.from({ length: 149 }, (_, i) => (i % 2 === 0 ? user(`u${i}`) : assistant(`a${i}`))),
    );
    await manager.addMessage(user('trigger'));

    const compressedLog = loggerInfo.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('compressed'),
    );
    expect(compressedLog).toBeDefined();
    const fields = compressedLog![1] as Record<string, unknown>;
    expect(fields.safeCut).toBe(fields.desiredCut);
    expect(fields.cutAdjusted).toBe(false);
  });
});
