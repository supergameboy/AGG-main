import { describe, expect, it } from 'vitest';
import { StreamEventAssembler } from '@ai-rpg/ai';
import type { LLMClientStreamChunk, LLMStreamEvent } from '@ai-rpg/ai';

/**
 * StreamEventAssembler 单元测试（M1 设计文档 §10.1：要求 100% 覆盖）
 *
 * 验证点（设计文档 模块M1 §6.2 的 12 种事件粒度）：
 * 1. 文本：text_start → text_delta* → text_end（contentIndex 一致）
 * 2. 思考：thinking_start → thinking_delta* → thinking_end
 * 3. 工具调用：toolcall_start → toolcall_delta* → toolcall_end（按 index 并行跟踪，arguments 拼接）
 * 4. contentIndex 按内容块首次出现顺序编号
 * 5. finalize() 兜底关闭（无 finishReason 时）
 * 6. getFinalMessage：纯文本 → string；含思考/工具 → 数组按 contentIndex 排序
 * 7. getPartial 快照 / usage / finishReason 捕获
 */

function contentChunk(content: string, extra?: Partial<LLMClientStreamChunk>): LLMClientStreamChunk {
  return { type: 'content', content, ...extra };
}

function thinkingChunk(reasoningContent: string, extra?: Partial<LLMClientStreamChunk>): LLMClientStreamChunk {
  return { type: 'content', reasoningContent, ...extra };
}

function toolCallChunk(
  toolCalls: Array<{ index: number; id: string; name: string; arguments: string }>,
  extra?: Partial<LLMClientStreamChunk>,
): LLMClientStreamChunk {
  return { type: 'tool_call', toolCalls, ...extra };
}

function eventTypes(events: LLMStreamEvent[]): string[] {
  return events.map(e => e.type);
}

describe('StreamEventAssembler — 文本流', () => {
  it('首段文本产出 text_start + text_delta，后续仅 text_delta', () => {
    const assembler = new StreamEventAssembler();

    const first = assembler.processChunk(contentChunk('你好'));
    expect(eventTypes(first)).toEqual(['text_start', 'text_delta']);
    expect(first[0]).toMatchObject({ type: 'text_start', contentIndex: 0 });
    expect(first[1]).toMatchObject({ type: 'text_delta', contentIndex: 0, delta: '你好' });

    const second = assembler.processChunk(contentChunk('，世界'));
    expect(eventTypes(second)).toEqual(['text_delta']);
    expect(second[0]).toMatchObject({ delta: '，世界' });
  });

  it('finishReason 到达时产出 text_end 并携带完整文本', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(contentChunk('hello'));
    assembler.processChunk(contentChunk(' world'));

    const events = assembler.processChunk(contentChunk('', { finishReason: 'stop' }));
    expect(eventTypes(events)).toEqual(['text_end']);
    expect(events[0]).toMatchObject({ type: 'text_end', contentIndex: 0, content: 'hello world' });
    expect(assembler.getFinishReason()).toBe('stop');
  });

  it('每个事件携带 partial 增量快照', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(contentChunk('abc'));

    const events = assembler.processChunk(contentChunk('def'));
    expect(events[0].partial).toMatchObject({ text: 'abcdef' });
  });
});

describe('StreamEventAssembler — 思考流', () => {
  it('首段思考产出 thinking_start + thinking_delta', () => {
    const assembler = new StreamEventAssembler();

    const events = assembler.processChunk(thinkingChunk('让我想想'));
    expect(eventTypes(events)).toEqual(['thinking_start', 'thinking_delta']);
    expect(events[0]).toMatchObject({ type: 'thinking_start', contentIndex: 0 });
    expect(events[1]).toMatchObject({ type: 'thinking_delta', contentIndex: 0, delta: '让我想想' });
  });

  it('思考后接文本：contentIndex 按首次出现顺序编号（thinking=0, text=1）', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(thinkingChunk('推理中'));

    const textEvents = assembler.processChunk(contentChunk('答案是42'));
    expect(textEvents[0]).toMatchObject({ type: 'text_start', contentIndex: 1 });
  });

  it('finishReason 到达时同时关闭 thinking 与 text 块', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(thinkingChunk('想'));
    assembler.processChunk(contentChunk('说'));

    const events = assembler.processChunk(contentChunk('', { finishReason: 'stop' }));
    expect(eventTypes(events)).toEqual(['thinking_end', 'text_end']);
    expect(events[0]).toMatchObject({ content: '想' });
    expect(events[1]).toMatchObject({ content: '说' });
  });
});

describe('StreamEventAssembler — 工具调用流', () => {
  it('首个 tool_call chunk 产出 toolcall_start，arguments chunk 产出 toolcall_delta', () => {
    const assembler = new StreamEventAssembler();

    const start = assembler.processChunk(toolCallChunk([
      { index: 0, id: 'call-1', name: 'get_weather', arguments: '' },
    ]));
    expect(eventTypes(start)).toEqual(['toolcall_start']);
    expect(start[0]).toMatchObject({ type: 'toolcall_start', contentIndex: 0 });

    const delta = assembler.processChunk(toolCallChunk([
      { index: 0, id: 'call-1', name: 'get_weather', arguments: '{"city":' },
    ]));
    expect(eventTypes(delta)).toEqual(['toolcall_delta']);
    expect(delta[0]).toMatchObject({ delta: '{"city":' });
  });

  it('跨 chunk 拼接 arguments，finishReason 时产出 toolcall_end 携带完整参数', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(toolCallChunk([
      { index: 0, id: 'call-1', name: 'get_weather', arguments: '{"city":' },
    ]));
    assembler.processChunk(toolCallChunk([
      { index: 0, id: 'call-1', name: 'get_weather', arguments: '"北京"}' },
    ]));

    const events = assembler.processChunk(toolCallChunk([], { finishReason: 'tool_calls' }));
    expect(eventTypes(events)).toEqual(['toolcall_end']);
    expect(events[0]).toMatchObject({
      type: 'toolcall_end',
      toolCall: {
        id: 'call-1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"北京"}' },
      },
    });
  });

  it('多个并行工具调用按 index 独立跟踪', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(toolCallChunk([
      { index: 0, id: 'call-a', name: 'fn_a', arguments: '{"x":1}' },
      { index: 1, id: 'call-b', name: 'fn_b', arguments: '{"y":2}' },
    ]));

    const events = assembler.processChunk(toolCallChunk([], { finishReason: 'tool_calls' }));
    const ends = events.filter(e => e.type === 'toolcall_end');
    expect(ends).toHaveLength(2);
    expect(ends[0]).toMatchObject({ toolCall: { id: 'call-a' } });
    expect(ends[1]).toMatchObject({ toolCall: { id: 'call-b' } });
  });

  it('后续 chunk 的 id/name 变化时更新 pending（不重复发 start）', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(toolCallChunk([
      { index: 0, id: '', name: '', arguments: '' },
    ]));

    const events = assembler.processChunk(toolCallChunk([
      { index: 0, id: 'real-id', name: 'real_name', arguments: '{}' },
    ]));
    expect(eventTypes(events)).toEqual(['toolcall_delta']);

    const final = assembler.getFinalMessage();
    expect(final.content).toEqual([
      {
        type: 'tool_use',
        toolCall: {
          id: 'real-id',
          type: 'function',
          function: { name: 'real_name', arguments: '{}' },
        },
      },
    ]);
  });
});

describe('StreamEventAssembler — finalize 兜底', () => {
  it('无 finishReason 时 finalize() 关闭所有未结束块', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(thinkingChunk('想'));
    assembler.processChunk(contentChunk('说'));
    assembler.processChunk(toolCallChunk([
      { index: 0, id: 'c1', name: 'fn', arguments: '{}' },
    ]));

    const events = assembler.finalize();
    expect(eventTypes(events)).toEqual(['thinking_end', 'text_end', 'toolcall_end']);
  });

  it('空状态 finalize() 不产出事件', () => {
    const assembler = new StreamEventAssembler();
    expect(assembler.finalize()).toEqual([]);
  });

  it('toolcall_end 不重复发送（ended 标记）', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(toolCallChunk([
      { index: 0, id: 'c1', name: 'fn', arguments: '{}' },
    ], { finishReason: 'tool_calls' }));

    expect(assembler.finalize()).toEqual([]);
  });
});

describe('StreamEventAssembler — getFinalMessage', () => {
  it('纯文本时 content 为 string', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(contentChunk('纯文本回复'));

    const final = assembler.getFinalMessage();
    expect(final.role).toBe('assistant');
    expect(final.content).toBe('纯文本回复');
  });

  it('含思考与工具调用时 content 为数组，按 contentIndex 排序', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(thinkingChunk('思考内容'));
    assembler.processChunk(contentChunk('文本内容'));
    assembler.processChunk(toolCallChunk([
      { index: 0, id: 'c1', name: 'fn', arguments: '{"a":1}' },
    ], { finishReason: 'tool_calls' }));

    const final = assembler.getFinalMessage();
    expect(final.content).toEqual([
      { type: 'thinking', thinking: '思考内容' },
      { type: 'text', text: '文本内容' },
      {
        type: 'tool_use',
        toolCall: {
          id: 'c1',
          type: 'function',
          function: { name: 'fn', arguments: '{"a":1}' },
        },
      },
    ]);
  });

  it('usage 从 chunk 捕获并透传到 final message', () => {
    const assembler = new StreamEventAssembler();
    const usage = {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      promptCacheHitTokens: 4,
      promptCacheMissTokens: 6,
    };
    assembler.processChunk(contentChunk('hi', { usage, finishReason: 'stop' }));

    expect(assembler.getUsage()).toEqual(usage);
    expect(assembler.getFinalMessage().usage).toEqual(usage);
  });
});

describe('StreamEventAssembler — getPartial', () => {
  it('返回当前聚合快照（text + thinking + toolCalls + usage）', () => {
    const assembler = new StreamEventAssembler();
    assembler.processChunk(thinkingChunk('想'));
    assembler.processChunk(contentChunk('说'));
    assembler.processChunk(toolCallChunk([
      { index: 0, id: 'c1', name: 'fn', arguments: '{"a":' },
    ]));
    assembler.processChunk(contentChunk('', {
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    }));

    const partial = assembler.getPartial();
    expect(partial).toEqual({
      thinking: '想',
      text: '说',
      toolCalls: [
        { id: 'c1', type: 'function', function: { name: 'fn', arguments: '{"a":' } },
      ],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
  });

  it('空状态返回空对象', () => {
    const assembler = new StreamEventAssembler();
    expect(assembler.getPartial()).toEqual({});
  });
});
