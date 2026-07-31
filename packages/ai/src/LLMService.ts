import { createChildLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/error.js';
import { ModelConfigService } from './ModelConfigService.js';
import type { LLMMessage, ID } from '@ai-rpg/shared';
import { ContextOverflowError } from '@ai-rpg/shared';
import { LLM_DEFAULTS } from './defaults.js';
import { SmartRetry } from './retry/smart-retry.js';
import { StreamEventAssembler } from './stream.js';
import { EventStream } from './event-stream.js';
import type {
  LLMClient,
  LLMResponse as LLMClientResponse,
  ChatOptions as LLMChatOptions,
  ToolDefinition,
  ILLMMetricsSink,
  LLMStreamEvent,
  LLMStreamFinalMessage,
  LLMStreamEventStream,
} from './types.js';
import { NullLLMMetricsSink } from './types.js';

const logger = createChildLogger('llm-service');

export interface LLMMessageExtended {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  name?: string;
  toolCallId?: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface LLMResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
  };
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  responseFormat?: { type: 'json_object' | 'text' };
  stop?: string[];
  topP?: number;
  /**
   * 思考级别（pi 6 级，M5 v1.2 D5.3；off = 真正 per-request 关闭思考）。
   * 直接透传至 LLMChatOptions.reasoningEffort（types.ts），由 Provider 消费；
   * undefined 时 Provider 回退静态 thinking.effort 配置，零行为变化。
   */
  reasoningEffort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  agentType?: string;
  loggingMetadata?: LLMCallLoggingMetadata;
  /** 请求唯一标识，用于跨迭代日志关联 */
  requestId?: string;
  /** 当前迭代序号（从 1 开始） */
  iteration?: number;
  /** 前一轮迭代结束时的消息总数，用于计算增量 deltaMessages */
  previousMessageCount?: number;
}

export interface LLMCallLoggingMetadata {
  stage?: string;
  prefixHash?: string;
  cacheStrategy?: string;
  reactIterations?: number;
  toolCallsCount?: number;
}

export interface LLMServiceOptions {
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  loggingMetadata?: LLMCallLoggingMetadata;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

/**
 * chatWithKey / streamWithKey 参数（M9 §7.1）
 *
 * 选 key 职责在 LLMRequestDispatcher：dispatcher 选定 key 后把
 * providerId / apiKey / keyIndex 一并传入，LLMService 只负责
 * client 获取与带 SmartRetry 的调用执行。
 */
export interface ChatWithKeyOptions {
  providerId: string;
  model: string;
  apiKey: string;
  keyIndex: number;
  options?: ChatOptions;
}

function convertToLLMClientMessages(messages: LLMMessageExtended[]): LLMMessage[] {
  return messages.map(m => {
    const content = typeof m.content === 'string' ? m.content : m.content.map(c => c.type === 'text' ? c.text : '').join('');
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content,
        toolCallId: m.toolCallId || m.name || '',
        name: m.name,
      };
    }
    const result: LLMMessage = {
      role: m.role as 'system' | 'user' | 'assistant',
      content,
      name: m.name,
    };
    if (m.role === 'assistant') {
      if (m.reasoningContent) {
        result.reasoningContent = m.reasoningContent;
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        result.toolCalls = m.toolCalls;
      }
    }
    return result;
  });
}

function convertToLLMClientTools(tools?: ChatOptions['tools']): ToolDefinition[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

function convertToLLMClientChatOptions(options?: ChatOptions): LLMChatOptions {
  const result: LLMChatOptions = {};
  if (options?.temperature !== undefined) result.temperature = options.temperature;
  if (options?.maxTokens !== undefined) result.maxTokens = options.maxTokens;
  if (options?.topP !== undefined) result.topP = options.topP;
  if (options?.stop) result.stop = options.stop;
  if (options?.responseFormat) result.responseFormat = options.responseFormat;
  if (options?.reasoningEffort !== undefined) result.reasoningEffort = options.reasoningEffort;
  if (options?.tools) result.tools = convertToLLMClientTools(options.tools);
  if (options?.requestId) result.requestId = options.requestId;
  if (options?.toolChoice) {
    if (options.toolChoice === 'auto') result.toolChoice = 'auto';
    else if (options.toolChoice === 'none') result.toolChoice = 'none';
    else if (typeof options.toolChoice === 'object') {
      result.toolChoice = { type: 'function', name: options.toolChoice.function.name };
    }
  }
  return result;
}

function convertLLMClientResponseToLLMResponse(response: LLMClientResponse): LLMResponse {
  return {
    content: response.content,
    reasoningContent: response.reasoningContent,
    toolCalls: response.toolCalls?.map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
      },
    })),
    usage: response.usage ? {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      promptCacheHitTokens: response.usage.promptCacheHitTokens,
      promptCacheMissTokens: response.usage.promptCacheMissTokens,
    } : undefined,
    finishReason: response.finishReason,
  };
}

export class LLMService {
  private modelConfigService: ModelConfigService;
  private readonly metricsSink: ILLMMetricsSink;

  constructor(modelConfigService: ModelConfigService, metricsSink: ILLMMetricsSink = new NullLLMMetricsSink()) {
    this.modelConfigService = modelConfigService;
    this.metricsSink = metricsSink;
  }

  /**
   * @deprecated 使用 LLMRequestDispatcher.dispatch 替代（M9 §7.1 m3 修复：
   * 保留过渡期实现不直接抛错，仅输出 warning 日志，给调用方一个 Sprint
   * 的迁移期；下个版本改为抛错，最终删除）
   */
  async chat(
    messages: LLMMessageExtended[],
    options?: LLMServiceOptions,
    saveId?: ID,
    agentType?: string
  ): Promise<LLMResponse> {
    logger.warn('LLMService.chat is deprecated, migrate to LLMRequestDispatcher.dispatch', {
      stack: new Error().stack,
    });

    const { client, resolvedProviderId, resolvedModel } = await this.resolveProvider(options?.providerId, options?.model);

    const chatOptions: ChatOptions = {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      responseFormat: options?.responseFormat,
      loggingMetadata: options?.loggingMetadata,
      tools: options?.tools,
    };

    return this.executeWithRetry(
      client,
      convertToLLMClientMessages(messages),
      chatOptions,
      resolvedProviderId,
      resolvedModel,
      saveId,
      agentType
    );
  }

  /**
   * 使用指定 key 调用 LLM（M9：LLMRequestDispatcher 唯一入口，§7.1）
   *
   * 选 key 职责已移至 LLMRequestDispatcher，本方法只负责：
   * 1. 获取 LLMClient（经 ModelConfigService 按 keyIndex 缓存）
   * 2. 执行 chat（带 SmartRetry，仅退避重试 5xx/timeout/network，不切换 provider/key）
   * 3. 抛出 429/auth 原始错误（保留 HTTP status/headers，由 Dispatcher 处理失败转移）
   *
   * 度量说明：dispatcher 路径的度量由 dispatcher 自行记录（llm_dispatch_metrics），
   * 本方法不传 saveId/agentType，emitMetrics 门控跳过，避免双写。
   */
  async chatWithKey(
    messages: LLMMessage[],
    params: ChatWithKeyOptions,
  ): Promise<LLMResponse> {
    const client = await this.getOrCreateClient(params.providerId, params.apiKey, params.keyIndex);
    return this.executeWithRetry(
      client,
      messages,
      params.options,
      params.providerId,
      params.model,
      undefined,
      undefined,
      false,
    );
  }

  async chatRaw(
    messages: LLMMessageExtended[],
    options?: ChatOptions & { providerId?: string; model?: string },
    saveId?: ID
  ): Promise<LLMResponse> {
    const providerId = options?.providerId;
    const model = options?.model;
    const agentType = options?.agentType;
    const { client, resolvedProviderId, resolvedModel } = await this.resolveProvider(providerId, model);

    return this.executeWithRetry(
      client,
      convertToLLMClientMessages(messages),
      options,
      resolvedProviderId,
      resolvedModel,
      saveId,
      agentType
    );
  }

  /**
   * Chat using the fast model tier. Falls back to the default model
   * if fast model is not configured or fails.
   */
  async chatWithFastModel(
    messages: LLMMessageExtended[],
    options?: LLMServiceOptions,
    saveId?: ID,
    agentType?: string
  ): Promise<LLMResponse> {
    const fastProvider = await this.resolveFastProvider(options?.model);
    if (fastProvider) {
      try {
        const chatOptions: ChatOptions = {
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
          responseFormat: options?.responseFormat,
          loggingMetadata: options?.loggingMetadata,
          tools: options?.tools,
        };

        return await this.executeWithRetry(
          fastProvider.client,
          convertToLLMClientMessages(messages),
          chatOptions,
          fastProvider.resolvedProviderId,
          fastProvider.resolvedModel,
          saveId,
          agentType
        );
      } catch (error) {
        logger.warn('Fast model failed, falling back to default model', {
          error: getErrorMessage(error)
        });
      }
    }

    return this.chat(messages, options, saveId, agentType);
  }

  /**
   * 流式聊天（返回 EventStream）
   *
   * M1 改造点（设计文档 模块M1 §6.5）：
   * 1. 返回类型从 AsyncIterable<StreamChunk> 改为 LLMStreamEventStream
   * 2. 新增 saveId/agentType 可选参数（用于度量记录，向后兼容）
   * 3. 事件类型从粗粒度 content/tool_call 扩展到 12 种 LLMStreamEvent
   */
  stream(
    messages: LLMMessageExtended[],
    options?: ChatOptions & { providerId?: string; model?: string },
    saveId?: ID,
    agentType?: string
  ): LLMStreamEventStream {
    const eventStream = new EventStream<LLMStreamEvent, LLMStreamFinalMessage>(
      (event) => event.type === 'done' || event.type === 'error',
      (event) => {
        if (event.type === 'done') return event.message;
        throw new Error('Stream ended with error');
      },
    );

    this.processStream(messages, options, saveId, agentType, eventStream).catch(err => {
      eventStream.fail(err instanceof Error ? err : new Error(String(err)));
    });

    return eventStream;
  }

  /**
   * 使用指定 key 流式调用 LLM（M9：LLMRequestDispatcher.dispatchStream 入口）
   *
   * 与 chatWithKey 对称：client 经 getOrCreateClient 按 keyIndex 获取，
   * 事件流契约与 stream() 一致（LLMStreamEventStream）。
   *
   * 429/auth 错误以 error 事件 + 迭代器 throw 形式透传原始错误
   * （保留 HTTP status/headers），由 Dispatcher 判断失败转移。
   * 度量由 dispatcher 自行记录（llm_dispatch_metrics），本方法不传
   * saveId/agentType，emitMetrics 门控跳过，避免双写。
   */
  streamWithKey(
    messages: LLMMessage[],
    params: ChatWithKeyOptions,
  ): LLMStreamEventStream {
    const eventStream = new EventStream<LLMStreamEvent, LLMStreamFinalMessage>(
      (event) => event.type === 'done' || event.type === 'error',
      (event) => {
        if (event.type === 'done') return event.message;
        throw new Error('Stream ended with error');
      },
    );

    this.processStreamWithKey(messages, params, eventStream).catch(err => {
      eventStream.fail(err instanceof Error ? err : new Error(String(err)));
    });

    return eventStream;
  }

  /**
   * 处理流式响应（内部方法）：LLMClient StreamChunk → StreamEventAssembler → 12 种事件
   */
  private async processStream(
    messages: LLMMessageExtended[],
    options: (ChatOptions & { providerId?: string; model?: string }) | undefined,
    saveId: ID | undefined,
    agentType: string | undefined,
    eventStream: EventStream<LLMStreamEvent, LLMStreamFinalMessage>
  ): Promise<void> {
    const resolved = await this.resolveProvider(options?.providerId, options?.model);
    await this.runStreamOnClient(
      resolved.client,
      resolved.resolvedModel,
      convertToLLMClientMessages(messages),
      convertToLLMClientChatOptions(options),
      saveId,
      agentType,
      options?.loggingMetadata,
      eventStream,
    );
  }

  /**
   * streamWithKey 的流式处理（内部方法）
   */
  private async processStreamWithKey(
    messages: LLMMessage[],
    params: ChatWithKeyOptions,
    eventStream: EventStream<LLMStreamEvent, LLMStreamFinalMessage>
  ): Promise<void> {
    const client = await this.getOrCreateClient(params.providerId, params.apiKey, params.keyIndex);
    await this.runStreamOnClient(
      client,
      params.model,
      messages,
      convertToLLMClientChatOptions(params.options),
      undefined,
      undefined,
      params.options?.loggingMetadata,
      eventStream,
    );
  }

  /**
   * 在已解析的 client 上执行流式调用（stream / streamWithKey 共享核心）
   */
  private async runStreamOnClient(
    client: LLMClient,
    resolvedModel: string,
    llmMessages: LLMMessage[],
    llmOptions: LLMChatOptions,
    saveId: ID | undefined,
    agentType: string | undefined,
    loggingMetadata: LLMCallLoggingMetadata | undefined,
    eventStream: EventStream<LLMStreamEvent, LLMStreamFinalMessage>
  ): Promise<void> {
    const startTime = Date.now();
    const assembler = new StreamEventAssembler();

    try {
      eventStream.push({ type: 'start', partial: {} });

      for await (const chunk of client.stream(llmMessages, llmOptions)) {
        for (const event of assembler.processChunk(chunk)) {
          eventStream.push(event);
        }
      }

      // 兜底关闭：流结束但未收到 finishReason 时关闭未结束的内容块
      for (const event of assembler.finalize()) {
        eventStream.push(event);
      }

      const finalMessage = assembler.getFinalMessage();
      const finishReason = assembler.getFinishReason();

      eventStream.push({
        type: 'done',
        reason: finishReason === 'length' || finishReason === 'tool_calls' ? finishReason : 'stop',
        message: finalMessage,
        usage: finalMessage.usage,
      });

      if (finalMessage.usage) {
        this.emitMetrics({
          saveId,
          agentType,
          model: resolvedModel,
          usage: finalMessage.usage,
          durationMs: Date.now() - startTime,
          success: true,
          metadata: loggingMetadata,
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.emitMetrics({
        saveId,
        agentType,
        model: resolvedModel,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        durationMs: Date.now() - startTime,
        success: false,
        metadata: loggingMetadata,
      });

      try {
        eventStream.push({
          type: 'error',
          reason: 'error',
          error: { message: err.message, retryable: true },
          partial: assembler.getPartial(),
        });
      } catch {
        // error 事件满足 isComplete，extractResult 按设计抛错（防止 result() 静默解析）；
        // 事件已入队，错误传播由外层 catch 的 eventStream.fail 完成
      }

      throw err;
    }
  }

  /**
   * M9：legacy 路径固定使用 primary key（keyIndex = 0），
   * 运行时选 key / 故障转移由 LLMRequestDispatcher + chatWithKey 承担。
   */
  private async resolveProvider(
    providerId?: string,
    model?: string
  ): Promise<{ client: LLMClient; resolvedProviderId: string; resolvedModel: string }> {
    if (providerId) {
      const client = await this.modelConfigService.getProviderInstance(providerId);
      if (client) {
        const provider = await this.modelConfigService.getProvider(providerId);
        const resolvedModel = model || provider?.defaultModel || 'unknown';
        return { client, resolvedProviderId: providerId, resolvedModel };
      }

      logger.warn('Specified provider unavailable, falling back to default', { providerId });
    }

    const defaults = await this.modelConfigService.getDefaults();
    if (defaults.defaultProviderId) {
      const client = await this.modelConfigService.getProviderInstance(defaults.defaultProviderId);
      if (client) {
        const provider = await this.modelConfigService.getProvider(defaults.defaultProviderId);
        const resolvedModel = model || provider?.defaultModel || 'unknown';
        return { client, resolvedProviderId: defaults.defaultProviderId, resolvedModel };
      }

      logger.warn('Default provider unavailable', { defaultProviderId: defaults.defaultProviderId });
    }

    throw new Error('No LLM provider available. Configure a provider in Model Config settings or set LLM_API_KEY environment variable.');
  }

  private async resolveFastProvider(
    model?: string
  ): Promise<{ client: LLMClient; resolvedProviderId: string; resolvedModel: string } | null> {
    const defaults = await this.modelConfigService.getDefaults();
    if (!defaults.fastProviderId) {
      return null;
    }

    const client = await this.modelConfigService.getProviderInstance(defaults.fastProviderId);
    if (!client) {
      logger.warn('Fast provider unavailable', { fastProviderId: defaults.fastProviderId });
      return null;
    }

    const provider = await this.modelConfigService.getProvider(defaults.fastProviderId);
    const resolvedModel = model || defaults.fastModel || provider?.defaultModel || 'unknown';
    return { client, resolvedProviderId: defaults.fastProviderId, resolvedModel };
  }

  /**
   * 获取指定 key 的 LLMClient（M9 §7.1）
   *
   * client 创建与按 keyIndex 缓存委托给 ModelConfigService
   * （缓存单一位置，invalidateProviderCache 单点失效）；
   * apiKey 由 Dispatcher 选 key 后传入，本方法不重复读取 provider 配置。
   */
  private async getOrCreateClient(
    providerId: string,
    apiKey: string,
    keyIndex: number,
  ): Promise<LLMClient> {
    const client = await this.modelConfigService.getProviderInstanceWithKey(providerId, keyIndex, apiKey);
    if (!client) {
      throw new Error(`Provider ${providerId} not found or disabled (key index ${keyIndex})`);
    }
    return client;
  }

  private readonly smartRetry = new SmartRetry();

  /**
   * 带 SmartRetry 的 chat 执行
   *
   * @param allowFailover legacy 路径（chat/chatRaw/chatWithFastModel）为 true：
   *        timeout/network/server_error 重试时经 resolveProvider 重新解析 provider；
   *        chatWithKey 路径固定为 false（M9 §7.3：key/provider 选择由
   *        LLMRequestDispatcher 负责，重试在同一 client 上原地退避）。
   */
  private async executeWithRetry(
    client: LLMClient,
    messages: LLMMessage[],
    options: ChatOptions | undefined,
    providerId: string,
    model: string,
    saveId?: ID,
    agentType?: string,
    allowFailover: boolean = true
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.smartRetry['config'].maxRetries; attempt++) {
      try {
        const llmMessages = messages;
        const llmOptions = convertToLLMClientChatOptions(options);

        const iteration = options?.iteration || 1;
        if (iteration <= 1) {
          logger.info(`LLM input for ${agentType || 'unknown'}, iteration 1 (full context)`, {
            tag: 'LLM-INPUT',
            requestId: options?.requestId,
            iteration: 1,
            agent: agentType,
            model,
            provider: providerId,
            cumulativeMessages: messages.length,
            toolsCount: options?.tools?.length || 0,
            messages: messages.map(m => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              name: m.name,
              toolCallId: m.toolCallId,
              toolCalls: m.toolCalls,
              reasoningContent: m.reasoningContent,
            })),
            tools: options?.tools?.map(t => ({
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            })),
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            responseFormat: options?.responseFormat,
          });
        } else {
          const previousCount = options?.previousMessageCount || 0;
          const deltaMessages = messages.slice(previousCount);
          logger.info(`LLM input for ${agentType || 'unknown'}, iteration ${iteration} (+${deltaMessages.length} messages)`, {
            tag: 'LLM-INPUT',
            requestId: options?.requestId,
            iteration,
            agent: agentType,
            model,
            provider: providerId,
            cumulativeMessages: messages.length,
            toolsCount: options?.tools?.length || 0,
            deltaMessages: deltaMessages.map(m => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              toolCallId: m.toolCallId,
              toolCalls: m.toolCalls,
            })),
          });
        }

        const response = await client.chat(llmMessages, llmOptions);
        let llmResponse = convertLLMClientResponseToLLMResponse(response);

        const maxContinuations = 3;
        let continuations = 0;
        while (llmResponse.finishReason === 'length' && continuations < maxContinuations) {
          continuations++;
          logger.info(`LLM output truncated, initiating continuation ${continuations}/${maxContinuations}`, {
            agent: agentType,
            model,
            provider: providerId,
            completionTokens: llmResponse.usage?.completionTokens,
          });

          const continuationMessages = [...llmMessages];
          continuationMessages.push({
            role: 'assistant' as const,
            content: llmResponse.content,
          });
          continuationMessages.push({
            role: 'user' as const,
            content: 'Continue from where you left off. Output the remaining content without repeating what you have already output.',
          });

          const continuationResponse = await client.chat(continuationMessages, llmOptions);
          const continuationLlmResponse = convertLLMClientResponseToLLMResponse(continuationResponse);

          llmResponse = {
            content: llmResponse.content + continuationLlmResponse.content,
            reasoningContent: llmResponse.reasoningContent,
            toolCalls: llmResponse.toolCalls || continuationLlmResponse.toolCalls,
            usage: {
              promptTokens: (llmResponse.usage?.promptTokens || 0) + (continuationLlmResponse.usage?.promptTokens || 0),
              completionTokens: (llmResponse.usage?.completionTokens || 0) + (continuationLlmResponse.usage?.completionTokens || 0),
              totalTokens: (llmResponse.usage?.totalTokens || 0) + (continuationLlmResponse.usage?.totalTokens || 0),
            },
            finishReason: continuationLlmResponse.finishReason,
          };
        }

        if (llmResponse.finishReason === 'length') {
          logger.error(`LLM output still truncated after ${maxContinuations} continuations`, {
            agent: agentType,
            model,
            provider: providerId,
            totalCompletionTokens: llmResponse.usage?.completionTokens,
          });
        }

        const elapsed = Date.now() - startTime;
        logger.info(`LLM output for ${agentType || 'unknown'}, iteration ${options?.iteration || 1}, ${llmResponse.usage?.totalTokens || 0} tokens`, {
          tag: 'LLM-OUTPUT',
          requestId: options?.requestId,
          iteration: options?.iteration || 1,
          agent: agentType,
          model,
          provider: providerId,
          elapsed,
          usage: llmResponse.usage,
          content: llmResponse.content,
          reasoningContent: llmResponse.reasoningContent,
          toolCalls: llmResponse.toolCalls,
          finishReason: llmResponse.finishReason,
        });

        if (llmResponse.usage) {
          this.emitMetrics({
            saveId,
            agentType,
            model,
            usage: llmResponse.usage,
            durationMs: elapsed,
            success: true,
            metadata: options?.loggingMetadata,
          });
        }

        if (llmResponse.finishReason === 'length') {
          logger.error('LLM output truncated by API hard limit (finishReason=length)', {
            agent: agentType,
            model,
            provider: providerId,
            completionTokens: llmResponse.usage?.completionTokens,
            apiMaxTokens: LLM_DEFAULTS.apiMaxTokens,
          });
        }

        const softLimit = options?.maxTokens ?? LLM_DEFAULTS.maxTokens;
        if (llmResponse.finishReason !== 'length' && llmResponse.usage?.completionTokens && llmResponse.usage.completionTokens > softLimit) {
          logger.warn('LLM output exceeded soft maxTokens limit', {
            agent: agentType,
            model,
            provider: providerId,
            completionTokens: llmResponse.usage.completionTokens,
            softMaxTokens: softLimit,
          });
        }

        return llmResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 使用 SmartRetry 统一分类
        const classified = this.smartRetry.classifyError(error);
        const strategy = this.smartRetry.decideStrategy(classified, attempt);

        logger.warn(`Chat attempt ${attempt}/${this.smartRetry['config'].maxRetries} failed`, {
          error: lastError.message,
          provider: providerId,
          model,
          category: classified.category,
          retryable: classified.retryable,
          shouldRetry: strategy.shouldRetry,
          delayMs: strategy.delayMs,
        });

        // 不可重试——记录日志后抛出类型化错误
        if (!strategy.shouldRetry) {
          this.emitMetrics({
            saveId,
            agentType,
            model,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            durationMs: Date.now() - startTime,
            success: false,
            metadata: options?.loggingMetadata,
          });

          // 上下文溢出特殊处理——抛出 ContextOverflowError 保持向后兼容
          if (classified.category === 'context_overflow') {
            throw new ContextOverflowError({
              agentType: agentType || 'unknown',
              currentTokens: 0,
              maxTokens: 0,
              suggestion: 'Reduce message history or switch to a model with larger context window',
            });
          }

          throw strategy.throwInstead ?? lastError;
        }

        // 需要切换 Provider——重新解析（仅 legacy 路径；chatWithKey 路径由 Dispatcher 负责切换）
        if (allowFailover && strategy.switchProvider) {
          try {
            const retryResult = await this.resolveProvider(providerId);
            client = retryResult.client;
            model = retryResult.resolvedModel;
            providerId = retryResult.resolvedProviderId;
          } catch {
            // Provider 解析失败，仍按退避等待后重试
          }
        }

        // 等待退避延迟
        if (strategy.delayMs > 0) {
          logger.info(`Waiting ${Math.round(strategy.delayMs)}ms before retry`, {
            attempt,
            category: classified.category,
            provider: providerId,
            model,
          });
          await this.delay(strategy.delayMs);
        }
      }
    }

    if (lastError) {
      this.emitMetrics({
        saveId,
        agentType,
        model,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        durationMs: Date.now() - startTime,
        success: false,
        metadata: options?.loggingMetadata,
      });
    }

    throw lastError;
  }

  /**
   * 记录度量（通过 ILLMMetricsSink 端口，非阻塞）
   *
   * 设计文档 模块M1 §6.5：saveId/agentType 缺失时不记录（对齐原 logLLMCall 调用点门控），
   * sink 记录失败仅记日志，不阻塞 LLM 调用主流程。
   */
  private emitMetrics(params: {
    saveId?: ID;
    agentType?: string;
    model: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      promptCacheHitTokens?: number;
      promptCacheMissTokens?: number;
    };
    durationMs: number;
    success: boolean;
    metadata?: LLMCallLoggingMetadata;
  }): void {
    if (!params.saveId || !params.agentType) return;

    try {
      this.metricsSink.record({
        saveId: params.saveId,
        agentType: params.agentType,
        model: params.model,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        totalTokens: params.usage.totalTokens,
        promptCacheHitTokens: params.usage.promptCacheHitTokens,
        promptCacheMissTokens: params.usage.promptCacheMissTokens,
        durationMs: params.durationMs,
        success: params.success,
        stage: params.metadata?.stage,
        prefixHash: params.metadata?.prefixHash,
        cacheStrategy: params.metadata?.cacheStrategy,
        reactIterations: params.metadata?.reactIterations,
        toolCallsCount: params.metadata?.toolCallsCount,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error('Failed to record LLM call metrics', {
        error: getErrorMessage(error),
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
