/**
 * ReActEngine _debug 字段提取与剥离测试
 *
 * 验证 LLM 自报告的 debug 信息提取逻辑：
 * - LLM 响应含 _debug 字段时，提取到 ReActEngineResult.debug
 * - 提取后 content 中不再包含 _debug 字段（避免泄漏到前端）
 * - LLM 响应无 _debug 字段时，正常返回，debug 为 undefined
 * - 解析失败时容错，不影响主流程
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReActEngine } from '../ReActEngine.js';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';

// AP-L1: StagingPool 构造函数改为注入 IDevTraceHook，测试提供最小 mock
const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// 构造最简 ReActEngine 实例：extractDebugFromContent 不依赖任何 deps 字段
function createEngine(): ReActEngine {
  const deps = {
    llmService: {} as never,
    db: {} as never,
    toolRegistry: {} as never,
    devTraceCollector: () => null,
    devTraceHook: mockDevTraceHook,
    webSocketService: {
      broadcastToClient: vi.fn(),
      getClientIdBySaveId: vi.fn(),
    } as never,
  };
  return new ReActEngine(deps);
}

describe('ReActEngine: _debug 字段提取与剥离', () => {
  let engine: ReActEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('LLM 响应含 _debug 字段时，提取到 ReActEngineResult.debug', () => {
    const content = JSON.stringify({
      dialogue: { messages: [{ speaker: '旁白', content: '测试', messageType: 'narrator' }] },
      _debug: {
        issues: [
          {
            type: 'tool_failure',
            description: '工具调用失败',
            toolName: 'character_service__create_character',
            expected: 'success',
            actual: 'error: validation failed',
          },
        ],
      },
    });

    // 通过访问私有方法测试（使用 any 绕过类型检查）
    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.debug).toBeDefined();
    expect(result.debug.agentType).toBe('gamemaster');
    expect(result.debug.issues).toHaveLength(1);
    expect(result.debug.issues[0].type).toBe('tool_failure');
    expect(result.debug.issues[0].description).toBe('工具调用失败');
    expect(result.debug.issues[0].toolName).toBe('character_service__create_character');
    expect(result.debug.issues[0].expected).toBe('success');
    expect(result.debug.issues[0].actual).toBe('error: validation failed');
  });

  it('提取后 content 中不再包含 _debug 字段', () => {
    const content = JSON.stringify({
      dialogue: { messages: [{ speaker: '旁白', content: '测试', messageType: 'narrator' }] },
      _debug: { issues: [{ type: 'data_inconsistency', description: 'test' }] },
    });

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.content).not.toContain('_debug');
    const parsed = JSON.parse(result.content);
    expect(parsed.dialogue).toBeDefined();
    expect(parsed._debug).toBeUndefined();
  });

  it('LLM 响应无 _debug 字段时，result.debug 为 undefined', () => {
    const content = JSON.stringify({
      dialogue: { messages: [{ speaker: '旁白', content: '正常响应', messageType: 'narrator' }] },
    });

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.debug).toBeUndefined();
    expect(result.content).toBe(content);  // 原 content 不变
  });

  it('LLM 响应非 JSON 时，容错返回原 content', () => {
    const content = '这是纯文本响应，不是 JSON';

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.debug).toBeUndefined();
    expect(result.content).toBe(content);
  });

  it('空 content 时容错返回', () => {
    const result = (engine as any).extractDebugFromContent('', 'gamemaster');

    expect(result.debug).toBeUndefined();
    expect(result.content).toBe('');
  });

  it('_debug.issues 不是数组时，兜底为空数组', () => {
    const content = JSON.stringify({
      dialogue: { messages: [] },
      _debug: { issues: 'not an array' },
    });

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.debug).toBeDefined();
    expect(result.debug.issues).toEqual([]);
  });

  it('_debug.issues 元素缺少 type 时，兜底为 data_inconsistency', () => {
    const content = JSON.stringify({
      dialogue: { messages: [] },
      _debug: { issues: [{ description: '问题描述' }] },
    });

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.debug.issues[0].type).toBe('data_inconsistency');
    expect(result.debug.issues[0].description).toBe('问题描述');
  });

  it('_debug.issues 元素的 type 不在合法枚举中时，兜底为 data_inconsistency', () => {
    const content = JSON.stringify({
      dialogue: { messages: [] },
      _debug: { issues: [{ type: 'invalid_type', description: 'test' }] },
    });

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.debug.issues[0].type).toBe('data_inconsistency');
  });

  it('多个 issues 都被正确提取', () => {
    const content = JSON.stringify({
      dialogue: { messages: [] },
      _debug: {
        issues: [
          { type: 'tool_failure', description: '失败1', toolName: 'tool_a' },
          { type: 'data_inconsistency', description: '不一致2' },
          { type: 'state_loss', description: '状态丢失3' },
          { type: 'missing_dependency', description: '依赖缺失4' },
          { type: 'loop_detection', description: '循环5' },
        ],
      },
    });

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    expect(result.debug.issues).toHaveLength(5);
    expect(result.debug.issues.map((i: { type: string }) => i.type)).toEqual([
      'tool_failure', 'data_inconsistency', 'state_loss', 'missing_dependency', 'loop_detection',
    ]);
  });

  it('dialogue 字段在剥离 _debug 后保持完整', () => {
    const originalDialogue = {
      messages: [
        { speaker: 'NPC', content: '你好', messageType: 'npc' },
        { speaker: '旁白', content: '场景描述', messageType: 'narrator' },
      ],
      options: [{ id: 'opt_1', text: '继续', npcId: 'npc_1' }],
    };
    const content = JSON.stringify({
      dialogue: originalDialogue,
      _debug: { issues: [{ type: 'tool_failure', description: 'test' }] },
    });

    const result = (engine as any).extractDebugFromContent(content, 'gamemaster');

    const parsed = JSON.parse(result.content);
    expect(parsed.dialogue).toEqual(originalDialogue);
  });
});
