/**
 * StreamEventAssembler — 流式事件组装器
 *
 * 职责：将 LLMClient 的粗粒度 StreamChunk 转换为 12 种细粒度 LLMStreamEvent，
 * 并维护跨 chunk 的聚合状态（文本/思考/工具调用/usage），最终产出 LLMStreamFinalMessage。
 *
 * 事件粒度（设计文档 模块M1 §6.2）：
 * - 文本：text_start → text_delta* → text_end
 * - 思考：thinking_start → thinking_delta* → thinking_end
 * - 工具调用：toolcall_start → toolcall_delta* → toolcall_end（按 index 跟踪多个并行调用）
 * - contentIndex 按内容块首次出现顺序编号
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M1 §6.5
 */

import type {
  StreamChunk as LLMClientStreamChunk,
  LLMFinishReason,
  LLMStreamEvent,
  LLMStreamFinalMessage,
  LLMStreamPartial,
  LLMStreamToolCall,
  LLMStreamUsage,
} from './types.js';

interface PendingToolCall {
  contentIndex: number;
  id: string;
  name: string;
  arguments: string;
  ended: boolean;
}

export class StreamEventAssembler {
  private text = '';
  private textContentIndex: number | null = null;
  private textEnded = false;

  private thinking = '';
  private thinkingContentIndex: number | null = null;
  private thinkingEnded = false;

  private toolCalls = new Map<number, PendingToolCall>();
  private nextContentIndex = 0;

  private usage: LLMStreamUsage | undefined;
  private finishReason: LLMFinishReason | undefined;

  /**
   * 处理一个 LLMClient StreamChunk，产出 0..n 个 LLMStreamEvent
   */
  processChunk(chunk: LLMClientStreamChunk): LLMStreamEvent[] {
    const events: LLMStreamEvent[] = [];

    if (chunk.usage) {
      this.usage = { ...chunk.usage };
    }
    if (chunk.finishReason) {
      this.finishReason = chunk.finishReason;
    }

    if (chunk.type === 'content') {
      if (chunk.reasoningContent) {
        events.push(...this.processThinkingDelta(chunk.reasoningContent));
      }
      if (chunk.content) {
        events.push(...this.processTextDelta(chunk.content));
      }
    }

    if (chunk.type === 'tool_call' && chunk.toolCalls) {
      for (const toolCall of chunk.toolCalls) {
        events.push(...this.processToolCallDelta(toolCall));
      }
    }

    if (chunk.finishReason) {
      events.push(...this.closeAllBlocks());
    }

    return events;
  }

  /**
   * 流结束时未收到 finishReason 的兜底关闭（由 LLMService 在迭代结束后调用）
   */
  finalize(): LLMStreamEvent[] {
    return this.closeAllBlocks();
  }

  getFinishReason(): LLMFinishReason | undefined {
    return this.finishReason;
  }

  getUsage(): LLMStreamUsage | undefined {
    return this.usage;
  }

  /**
   * 当前聚合快照（error 事件携带，便于消费方渲染中断时的部分内容）
   */
  getPartial(): LLMStreamPartial {
    return this.buildPartial();
  }

  /**
   * 构建最终消息（done 事件携带 + EventStream 最终结果）
   */
  getFinalMessage(): LLMStreamFinalMessage {
    const hasThinking = this.thinking.length > 0;
    const hasToolCalls = this.toolCalls.size > 0;

    let content: LLMStreamFinalMessage['content'];
    if (!hasThinking && !hasToolCalls) {
      content = this.text;
    } else {
      const blocks: Array<{
        type: 'text' | 'thinking' | 'tool_use';
        text?: string;
        thinking?: string;
        toolCall?: LLMStreamToolCall;
        contentIndex: number;
      }> = [];

      if (hasThinking && this.thinkingContentIndex !== null) {
        blocks.push({ type: 'thinking', thinking: this.thinking, contentIndex: this.thinkingContentIndex });
      }
      if (this.text.length > 0 && this.textContentIndex !== null) {
        blocks.push({ type: 'text', text: this.text, contentIndex: this.textContentIndex });
      }
      for (const toolCall of this.toolCalls.values()) {
        blocks.push({
          type: 'tool_use',
          toolCall: {
            id: toolCall.id,
            type: 'function',
            function: { name: toolCall.name, arguments: toolCall.arguments },
          },
          contentIndex: toolCall.contentIndex,
        });
      }

      blocks.sort((a, b) => a.contentIndex - b.contentIndex);
      content = blocks.map(({ contentIndex: _, ...block }) => block);
    }

    return {
      role: 'assistant',
      content,
      usage: this.usage,
    };
  }

  private processThinkingDelta(delta: string): LLMStreamEvent[] {
    const events: LLMStreamEvent[] = [];
    if (this.thinkingContentIndex === null) {
      this.thinkingContentIndex = this.nextContentIndex++;
      events.push({
        type: 'thinking_start',
        contentIndex: this.thinkingContentIndex,
        partial: this.buildPartial(),
      });
    }
    this.thinking += delta;
    events.push({
      type: 'thinking_delta',
      contentIndex: this.thinkingContentIndex,
      delta,
      partial: this.buildPartial(),
    });
    return events;
  }

  private processTextDelta(delta: string): LLMStreamEvent[] {
    const events: LLMStreamEvent[] = [];
    if (this.textContentIndex === null) {
      this.textContentIndex = this.nextContentIndex++;
      events.push({
        type: 'text_start',
        contentIndex: this.textContentIndex,
        partial: this.buildPartial(),
      });
    }
    this.text += delta;
    events.push({
      type: 'text_delta',
      contentIndex: this.textContentIndex,
      delta,
      partial: this.buildPartial(),
    });
    return events;
  }

  private processToolCallDelta(toolCall: { index: number; id: string; name: string; arguments: string }): LLMStreamEvent[] {
    const events: LLMStreamEvent[] = [];
    let pending = this.toolCalls.get(toolCall.index);

    if (!pending) {
      pending = {
        contentIndex: this.nextContentIndex++,
        id: toolCall.id,
        name: toolCall.name,
        arguments: '',
        ended: false,
      };
      this.toolCalls.set(toolCall.index, pending);
      events.push({
        type: 'toolcall_start',
        contentIndex: pending.contentIndex,
        partial: this.buildPartial(),
      });
    }

    if (toolCall.id && toolCall.id !== pending.id) {
      pending.id = toolCall.id;
    }
    if (toolCall.name && toolCall.name !== pending.name) {
      pending.name = toolCall.name;
    }

    if (toolCall.arguments) {
      pending.arguments += toolCall.arguments;
      events.push({
        type: 'toolcall_delta',
        contentIndex: pending.contentIndex,
        delta: toolCall.arguments,
        partial: this.buildPartial(),
      });
    }

    return events;
  }

  /**
   * 关闭所有未结束的内容块（流结束 / finishReason 到达时调用）
   *
   * 注意：contentIndex 保留不置 null（仅标记 ended 防重复发送），
   * 否则 getFinalMessage 在块关闭后会丢失 thinking/text 块的排序依据。
   */
  private closeAllBlocks(): LLMStreamEvent[] {
    const events: LLMStreamEvent[] = [];

    if (this.thinkingContentIndex !== null && !this.thinkingEnded) {
      this.thinkingEnded = true;
      events.push({
        type: 'thinking_end',
        contentIndex: this.thinkingContentIndex,
        content: this.thinking,
        partial: this.buildPartial(),
      });
    }

    if (this.textContentIndex !== null && !this.textEnded) {
      this.textEnded = true;
      events.push({
        type: 'text_end',
        contentIndex: this.textContentIndex,
        content: this.text,
        partial: this.buildPartial(),
      });
    }

    for (const pending of this.toolCalls.values()) {
      if (!pending.ended) {
        pending.ended = true;
        events.push({
          type: 'toolcall_end',
          contentIndex: pending.contentIndex,
          toolCall: {
            id: pending.id,
            type: 'function',
            function: { name: pending.name, arguments: pending.arguments },
          },
          partial: this.buildPartial(),
        });
      }
    }

    return events;
  }

  private buildPartial(): LLMStreamPartial {
    const partial: LLMStreamPartial = {};
    if (this.text) {
      partial.text = this.text;
    }
    if (this.thinking) {
      partial.thinking = this.thinking;
    }
    if (this.toolCalls.size > 0) {
      partial.toolCalls = Array.from(this.toolCalls.values()).map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    if (this.usage) {
      partial.usage = { ...this.usage };
    }
    return partial;
  }
}
