import OpenAI from 'openai';
import { BaseProvider } from './BaseProvider.js';
import type { LLMResponse, StreamChunk, ChatOptions, LLMConfig } from '../types.js';
import type { LLMMessage } from '@ai-rpg/shared';
import { createChildLogger } from '../utils/logger.js';
import { LLM_DEFAULTS } from '../defaults.js';
import { normalizeKeys } from '../utils/normalize-keys.js';
import { getErrorMessage } from '../utils/error.js';

const logger = createChildLogger('OpenAICompatible');

export class OpenAICompatibleProvider extends BaseProvider {
  protected client: OpenAI;
  protected providerName: string;

  constructor(config: LLMConfig, defaultBaseURL?: string) {
    super(config);
    this.providerName = config.provider;

    const baseURL = config.baseUrl || defaultBaseURL;
    if (!baseURL && !config.baseUrl) {
      throw new Error(`${this.providerName} provider requires baseUrl to be configured`);
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: baseURL,
      timeout: config.timeout || LLM_DEFAULTS.timeout,
      // M2-B3：Copilot 身份头等经此透传至底层 HTTP client（undefined 时 OpenAI SDK 忽略）
      defaultHeaders: config.defaultHeaders,
    });
  }

  async chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    try {
      const extraBody: Record<string, unknown> = {};
      // v1.2 D5.3：per-request off 覆盖静态 thinking.enabled，真正关闭思考
      const isThinkingMode = this.config.thinking?.enabled && options?.reasoningEffort !== 'off';

      if (isThinkingMode) {
        extraBody.thinking = { type: 'enabled' };
      }

      const rawEffort = options?.reasoningEffort || this.config.thinking?.effort;
      const mappedEffort = this.mapReasoningEffort(rawEffort);

      const requestParams: Record<string, unknown> = {
        model: this.config.model,
        messages: this.convertMessages(messages),
        max_tokens: LLM_DEFAULTS.apiMaxTokens,
        tools: options?.tools?.map(t => this.convertTool(t)),
        tool_choice: options?.toolChoice as OpenAI.ChatCompletionToolChoiceOption,
        stop: options?.stop,
      };

      if (!isThinkingMode) {
        requestParams.temperature = options?.temperature ?? this.config.temperature ?? LLM_DEFAULTS.temperature;
        requestParams.top_p = options?.topP;
      }

      requestParams.response_format = options?.responseFormat;

      if (mappedEffort) {
        requestParams.reasoning_effort = mappedEffort;
      }

      if (Object.keys(extraBody).length > 0) {
        requestParams.extra_body = extraBody;
      }

      logger.info(`Provider request to ${this.config.provider}/${this.config.model}, ${messages.length} messages`, {
        tag: 'LLM-REQUEST',
        requestId: options?.requestId,
        provider: this.config.provider,
        model: this.config.model,
        messageCount: messages.length,
        toolsCount: options?.tools?.length || 0,
        temperature: requestParams.temperature,
        maxTokens: requestParams.max_tokens,
      });

      const response = await this.client.chat.completions.create(
        requestParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
      );

      const choice = response.choices[0];
      const result: LLMResponse = {
        content: choice.message.content || '',
        reasoningContent: (choice.message as any).reasoning_content || undefined,
        toolCalls: choice.message.tool_calls?.map((tc: any) => {
          if (tc.function) {
            let parsedArgs: Record<string, unknown>;
            try {
              parsedArgs = normalizeKeys(JSON.parse(tc.function.arguments)) as Record<string, unknown>;
            } catch (parseError) {
              logger.warn('Failed to parse tool call arguments as JSON', {
                tag: 'LLM-TOOL-PARSE',
                requestId: options?.requestId,
                toolCallId: tc.id,
                functionName: tc.function.name,
                argumentsPreview: String(tc.function.arguments).substring(0, 200),
                error: getErrorMessage(parseError)
              });
              parsedArgs = {};
            }
            return {
              id: tc.id,
              name: tc.function.name,
              arguments: parsedArgs,
            };
          }
          return {
            id: tc.id,
            name: '',
            arguments: {},
          };
        }),
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
          promptCacheHitTokens: (response.usage as any).prompt_cache_hit_tokens
            || (response.usage as any).prompt_tokens_details?.cached_tokens
            || undefined,
          promptCacheMissTokens: (response.usage as any).prompt_cache_miss_tokens || undefined,
        } : undefined,
        finishReason: choice.finish_reason as LLMResponse['finishReason'],
      };

      logger.info(`Provider response from ${this.config.provider}/${this.config.model}, finishReason=${result.finishReason}`, {
        tag: 'LLM-RESPONSE',
        requestId: options?.requestId,
        provider: this.config.provider,
        model: this.config.model,
        finishReason: result.finishReason,
        usage: result.usage,
      });

      this.logApiCall('chat', startTime, {
        tokens: result.usage,
        finishReason: result.finishReason,
        hasReasoningContent: !!result.reasoningContent,
      });

      return result;
    } catch (error) {
      this.logApiError('chat', error);
      this.handleError(error, `${this.providerName} chat`);
    }
  }

  async *stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk> {
    const startTime = Date.now();
    try {
      const extraBody: Record<string, unknown> = {};
      // v1.2 D5.3：per-request off 覆盖静态 thinking.enabled，真正关闭思考
      const isThinkingMode = this.config.thinking?.enabled && options?.reasoningEffort !== 'off';

      if (isThinkingMode) {
        extraBody.thinking = { type: 'enabled' };
      }

      const rawEffort = options?.reasoningEffort || this.config.thinking?.effort;
      const mappedEffort = this.mapReasoningEffort(rawEffort);

      const requestParams: Record<string, unknown> = {
        model: this.config.model,
        messages: this.convertMessages(messages),
        max_tokens: LLM_DEFAULTS.apiMaxTokens,
        stream: true,
        tools: options?.tools?.map(t => this.convertTool(t)),
        tool_choice: options?.toolChoice as OpenAI.ChatCompletionToolChoiceOption,
        stop: options?.stop,
      };

      if (!isThinkingMode) {
        requestParams.temperature = options?.temperature ?? this.config.temperature ?? LLM_DEFAULTS.temperature;
        requestParams.top_p = options?.topP;
      }

      requestParams.response_format = options?.responseFormat;

      if (mappedEffort) {
        requestParams.reasoning_effort = mappedEffort;
      }

      if (Object.keys(extraBody).length > 0) {
        requestParams.extra_body = extraBody;
      }

      const stream = await this.client.chat.completions.create(
        requestParams as unknown as OpenAI.ChatCompletionCreateParamsStreaming
      );

      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (chunk.usage) {
          totalPromptTokens = chunk.usage.prompt_tokens || 0;
          totalCompletionTokens = chunk.usage.completion_tokens || 0;
        }

        if (delta?.content) {
          yield {
            type: 'content',
            content: delta.content,
          };
        }

        if ((delta as any)?.reasoning_content) {
          yield {
            type: 'content',
            reasoningContent: (delta as any).reasoning_content,
          };
        }

        if (delta?.tool_calls) {
          yield {
            type: 'tool_call',
            toolCalls: delta.tool_calls.map((tc) => ({
              index: tc.index,
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            })),
          };
        }

        if (chunk.choices[0]?.finish_reason) {
          yield {
            type: 'content',
            finishReason: chunk.choices[0].finish_reason as StreamChunk['finishReason'],
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              promptCacheHitTokens: (chunk.usage as any)?.prompt_cache_hit_tokens
                || (chunk.usage as any)?.prompt_tokens_details?.cached_tokens
                || undefined,
              promptCacheMissTokens: (chunk.usage as any)?.prompt_cache_miss_tokens || undefined,
            },
          };
        }
      }

      this.logApiCall('stream', startTime);
    } catch (error) {
      this.logApiError('stream', error);
      this.handleError(error, `${this.providerName} stream`);
    }
  }

  protected convertMessages(messages: LLMMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === 'tool' && m.toolCallId) {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId,
        } as OpenAI.ChatCompletionToolMessageParam;
      }

      if (m.role === 'function' && m.name) {
        return {
          role: 'function' as const,
          content: m.content,
          name: m.name,
        } as OpenAI.ChatCompletionFunctionMessageParam;
      }

      const baseMessage: Record<string, unknown> = {
        role: m.role as OpenAI.ChatCompletionMessageParam['role'],
        content: m.content,
      };

      if (m.role === 'assistant' && m.reasoningContent) {
        baseMessage.reasoning_content = m.reasoningContent;
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        // 带 tool_calls 的 assistant message 必须有非空 reasoning_content
        // deepseek-v4 等模型默认启用 thinking（无需客户端配置），缺失 reasoning_content 会触发 400 错误
        // OpenAI 等非 thinking provider 会忽略此字段，兜底是安全的
        baseMessage.reasoning_content = '（推理内容缺失，已自动补全）';
      }

      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        baseMessage.content = m.content || null;
        baseMessage.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        }));
      }

      if (m.name && (m.role === 'assistant' || m.role === 'function' || m.role === 'tool')) {
        return {
          ...baseMessage,
          name: m.name,
        } as unknown as OpenAI.ChatCompletionMessageParam;
      }

      return baseMessage as unknown as OpenAI.ChatCompletionMessageParam;
    });
  }

  protected convertTool(tool: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean }): OpenAI.ChatCompletionTool {
    const result: Record<string, unknown> = {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.normalizeToJsonSchema(tool.parameters),
      },
    };

    if (tool.strict) {
      (result.function as Record<string, unknown>).strict = true;
    }

    return result as unknown as OpenAI.ChatCompletionTool;
  }

  /**
   * pi 6 级直通映射（v1.2 D5.3）：off→none，其余原样透传。
   * 未设置返回 undefined（由模型默认值决定）；不再做 low/medium→high 坍缩。
   */
  protected mapReasoningEffort(
    effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
  ): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
    if (!effort) return undefined;
    return effort === 'off' ? 'none' : effort;
  }
}
