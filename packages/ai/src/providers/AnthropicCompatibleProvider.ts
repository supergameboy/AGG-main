import { BaseProvider } from './BaseProvider.js';
import type { LLMResponse, StreamChunk, ChatOptions, LLMConfig, ToolDefinition } from '../types.js';
import type { LLMMessage } from '@ai-rpg/shared';
import { LLM_DEFAULTS } from '../defaults.js';
import { createChildLogger } from '../utils/logger.js';
import { normalizeToolCallIds } from '../utils/transform-messages.js';

const logger = createChildLogger('AnthropicCompatible');

interface AnthropicSystemContent {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicSystemContent[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'none' } | { type: 'tool'; name: string };
  stream?: boolean;
  thinking?: { type: 'enabled' | 'disabled'; budget_tokens?: number };
  output_config?: { effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
}

export class AnthropicCompatibleProvider extends BaseProvider {
  protected baseURL: string;
  protected apiKey: string;

  constructor(config: LLMConfig, defaultBaseURL?: string) {
    super(config);
    this.baseURL = (config.baseUrl || defaultBaseURL || 'https://api.anthropic.com').replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    try {
      const { systemPrompt, anthropicMessages } = this.convertMessages(messages);
      const body = this.buildRequestBody(systemPrompt, anthropicMessages, options, false);

      const response = await this.fetchRequest(body);

      const result = this.parseResponse(response);

      this.logApiCall('chat', startTime, {
        tokens: result.usage,
        finishReason: result.finishReason,
      });

      return result;
    } catch (error) {
      this.logApiError('chat', error);
      this.handleError(error, 'Anthropic chat');
    }
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const startTime = Date.now();
    const controller = new AbortController();
    // 超时已禁用：不设置 abort 超时
    // const timeout = setTimeout(() => controller.abort(), this.config.timeout || LLM_DEFAULTS.timeout);
    const timeout: ReturnType<typeof setTimeout> | undefined = undefined;

    try {
      const { systemPrompt, anthropicMessages } = this.convertMessages(messages);
      const body = this.buildRequestBody(systemPrompt, anthropicMessages, options, true);

      const response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Anthropic stream: No response body');
      }

      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let currentToolIndex = 0;
      const toolCallBuffers: Map<number, { id: string; name: string; arguments: string }> = new Map();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            if (event.type === 'message_start' && event.message?.usage) {
              totalPromptTokens = event.message.usage.input_tokens || 0;
            }

            if (event.type === 'content_block_start') {
              if (event.content_block?.type === 'tool_use') {
                const idx = currentToolIndex++;
                toolCallBuffers.set(idx, {
                  id: event.content_block.id || '',
                  name: event.content_block.name || '',
                  arguments: '',
                });
              }
            }

            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                yield {
                  type: 'content',
                  content: event.delta.text,
                };
              }
              if (event.delta?.type === 'thinking_delta') {
                yield {
                  type: 'content',
                  reasoningContent: event.delta.thinking || '',
                };
              }
              if (event.delta?.type === 'input_json_delta') {
                const idx = currentToolIndex - 1;
                const buf = toolCallBuffers.get(idx);
                if (buf) {
                  buf.arguments += event.delta.partial_json || '';
                }
              }
            }

            if (event.type === 'content_block_stop') {
              // content block ended
            }

            if (event.type === 'message_delta') {
              if (event.delta?.stop_reason) {
                const toolCalls: StreamChunk['toolCalls'] = [];
                for (const [idx, buf] of toolCallBuffers) {
                  toolCalls.push({
                    index: idx,
                    id: buf.id,
                    name: buf.name,
                    arguments: buf.arguments,
                  });
                }

                yield {
                  type: toolCalls.length > 0 ? 'tool_call' : 'content',
                  ...(toolCalls.length > 0 ? { toolCalls } : {}),
                  finishReason: this.convertFinishReason(event.delta.stop_reason),
                  usage: {
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    totalTokens: totalPromptTokens + totalCompletionTokens,
                  },
                };
              }
              if (event.usage) {
                totalCompletionTokens = event.usage.output_tokens || 0;
              }
            }
          } catch {
            // skip unparseable lines
          }
        }
      }

      this.logApiCall('stream', startTime);
    } catch (error) {
      this.logApiError('stream', error);
      this.handleError(error, 'Anthropic stream');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  protected convertMessages(messages: LLMMessage[]): {
    systemPrompt: string | undefined;
    anthropicMessages: AnthropicMessage[];
  } {
    // M2-3：跨 Provider 历史回放的 toolCall ID 归一化。
    // 为什么在这里做：Anthropic 校验 tool_use.id/tool_result.tool_use_id 必须匹配
    // ^[a-zA-Z0-9_-]{1,64}$，而历史消息可能携带 OpenAI Responses 等来源的超长/特殊字符 ID
    // （M5 跨模型切换场景必触发）。归一化在 Provider 边界一次性完成，配对一致性由 idMap 保证。
    const normalized = normalizeToolCallIds(messages, 'anthropic');
    if (normalized.changed) {
      logger.debug('归一化不合规 toolCall ID', { count: normalized.idMap.size });
    }

    let systemPrompt: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const m of normalized.messages) {
      if (m.role === 'system') {
        systemPrompt = (systemPrompt ? systemPrompt + '\n' : '') + m.content;
        continue;
      }

      if (m.role === 'user') {
        anthropicMessages.push({
          role: m.role,
          content: m.content,
        });
        continue;
      }

      if (m.role === 'assistant') {
        const contentBlocks: AnthropicContentBlock[] = [];

        if (m.reasoningContent) {
          contentBlocks.push({ type: 'thinking', thinking: m.reasoningContent });
        }

        contentBlocks.push({ type: 'text', text: m.content });

        if (m.toolCalls && m.toolCalls.length > 0) {
          for (const tc of m.toolCalls) {
            let input: Record<string, unknown>;
            try {
              input = JSON.parse(tc.function.arguments);
            } catch {
              input = {};
            }
            contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
          }
        }

        anthropicMessages.push({
          role: m.role,
          content: (m.reasoningContent || (m.toolCalls && m.toolCalls.length > 0)) ? contentBlocks : m.content,
        });
        continue;
      }

      if ((m.role === 'function' || m.role === 'tool') && (m.name || m.toolCallId)) {
        const toolUseId = m.toolCallId || m.name || '';
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        if (
          lastMsg &&
          lastMsg.role === 'user' &&
          Array.isArray(lastMsg.content) &&
          lastMsg.content.some((block: any) => block.type === 'tool_result')
        ) {
          lastMsg.content.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: m.content,
          });
        } else {
          anthropicMessages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: m.content,
            }],
          });
        }
      }
    }

    return { systemPrompt, anthropicMessages };
  }

  protected convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    const converted: AnthropicTool[] = tools.map((tool) => {
      const result: AnthropicTool = {
        name: tool.name,
        description: tool.description,
        input_schema: this.normalizeToJsonSchema(tool.parameters),
      };
      return result;
    });

    if (converted.length > 0) {
      converted[converted.length - 1].cache_control = { type: 'ephemeral' };
    }

    return converted;
  }

  protected buildRequestBody(
    systemPrompt: string | undefined,
    anthropicMessages: AnthropicMessage[],
    options: ChatOptions | undefined,
    stream: boolean,
  ): AnthropicRequestBody {
    const body: AnthropicRequestBody = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: LLM_DEFAULTS.apiMaxTokens,
      stream,
    };

    if (systemPrompt) {
      const systemContent: AnthropicSystemContent[] = [
        { type: 'text', text: systemPrompt },
      ];
      systemContent[systemContent.length - 1].cache_control = { type: 'ephemeral' };
      body.system = systemContent;
    }

    if (options?.temperature !== undefined || this.config.temperature !== undefined) {
      body.temperature = options?.temperature ?? this.config.temperature ?? LLM_DEFAULTS.temperature;
    }

    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }

    if (options?.stop && options.stop.length > 0) {
      body.stop_sequences = options.stop;
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = this.convertTools(options.tools);

      if (options.toolChoice) {
        if (options.toolChoice === 'auto') {
          body.tool_choice = { type: 'auto' };
        } else if (options.toolChoice === 'none') {
          body.tool_choice = { type: 'none' };
        } else if (typeof options.toolChoice === 'object' && options.toolChoice.type === 'function') {
          body.tool_choice = { type: 'tool', name: options.toolChoice.name };
        }
      }
    }

    // Thinking mode handling:
    // - per-request off（v1.2 D5.3）→ 真正关闭；但历史消息含 thinking blocks 时 API 强制 enabled → 降级 low + warn
    // - If explicitly enabled in config → enable with budget
    // - If messages contain thinking blocks (from previous V4 default response) → must re-enable to pass validation
    // - Otherwise → explicitly disable to prevent V4 from returning thinking blocks by default
    const messagesHaveThinking = anthropicMessages.some(
      m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(b => b.type === 'thinking')
    );
    // pi 6 级 → Anthropic output_config.effort：minimal→low（无 minimal 档），xhigh 直通（Opus 5 原生）
    // off 已在上方分支处理，此处入参按 6 级收窄后仅剩 4 档
    const mapEffort = (level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): 'low' | 'medium' | 'high' | 'xhigh' => {
      if (level === 'minimal' || level === 'off') return 'low';
      return level;
    };
    const effort = options?.reasoningEffort || this.config.thinking?.effort || 'high';
    if (options?.reasoningEffort === 'off') {
      if (messagesHaveThinking) {
        logger.warn('reasoningEffort=off 降级为 low：历史消息含 thinking blocks，Anthropic API 要求保持 thinking enabled');
        body.thinking = { type: 'enabled', budget_tokens: 10000 };
        body.output_config = { effort: 'low' };
      } else {
        body.thinking = { type: 'disabled' };
      }
    } else if (this.config.thinking?.enabled || messagesHaveThinking) {
      // messagesHaveThinking 分支：历史含 thinking blocks 时必须保持 enabled 以通过 API 校验
      body.thinking = { type: 'enabled', budget_tokens: 10000 };
      body.output_config = { effort: mapEffort(effort) };
    } else {
      // Explicitly disable thinking mode to prevent V4 from returning thinking blocks by default
      body.thinking = { type: 'disabled' };
    }

    return body;
  }

  protected async fetchRequest(body: AnthropicRequestBody): Promise<any> {
    const controller = new AbortController();
    // 超时已禁用：不设置 abort 超时
    // const timeout = setTimeout(() => controller.abort(), this.config.timeout || LLM_DEFAULTS.timeout);
    const timeout: ReturnType<typeof setTimeout> | undefined = undefined;

    try {
      const response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
      }

      return response.json();
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  protected parseResponse(data: any): LLMResponse {
    let content = '';
    let reasoningContent = '';
    const toolCalls: LLMResponse['toolCalls'] = [];

    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          content += block.text || '';
        }
        if (block.type === 'thinking') {
          reasoningContent += block.thinking || '';
        }
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input || {},
          });
        }
      }
    }

    return {
      content,
      reasoningContent: reasoningContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        promptCacheHitTokens: (data.usage as any).cache_read_input_tokens || undefined,
        promptCacheMissTokens: (data.usage as any).cache_creation_input_tokens || undefined,
      } : undefined,
      finishReason: this.convertFinishReason(data.stop_reason),
    };
  }

  protected convertFinishReason(reason?: string): LLMResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'stop_sequence':
        return 'stop';
      default:
        return undefined;
    }
  }
}
