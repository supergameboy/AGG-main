import type { LLMConfig, LLMClient, LLMResponse, StreamChunk, ChatOptions } from '../types.js';
import type { LLMMessage } from '@ai-rpg/shared';
import { createChildLogger } from '../utils/logger.js';
import { SmartRetry } from '../retry/smart-retry.js';
import type { LLMErrorCategory } from '../retry/smart-retry.js';
import { getErrorMessage } from '../utils/error.js';

const logger = createChildLogger('llm');

export abstract class BaseProvider implements LLMClient {
  protected config: LLMConfig;
  protected readonly smartRetry = new SmartRetry();

  constructor(config: LLMConfig) {
    this.config = config;
  }

  abstract chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMResponse>;
  abstract stream(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<StreamChunk>;

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  protected logApiCall(method: string, startTime: number, metadata: Record<string, unknown> = {}): void {
    const duration = Date.now() - startTime;
    logger.info(`LLM API call completed`, {
      provider: this.config.provider,
      model: this.config.model,
      method,
      duration,
      ...metadata,
    });
  }

  protected logApiError(method: string, error: unknown): void {
    logger.error(`LLM API call failed`, {
      provider: this.config.provider,
      model: this.config.model,
      method,
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  /**
   * 统一错误分类——委托给 SmartRetry，保持向后兼容的返回类型
   */
  protected classifyError(error: Error): LLMErrorCategory {
    const classified = this.smartRetry.classifyError(error);
    return classified.category;
  }

  /**
   * 错误处理——使用 SmartRetry 统一分类后抛出已定义的错误类型
   */
  protected handleError(error: unknown, context: string): never {
    const classified = this.smartRetry.classifyError(error);
    const typedError = this.smartRetry.toTypedError(classified);
    // 保留上下文前缀信息
    if (typedError.message && !typedError.message.startsWith(context)) {
      typedError.message = `${context}: ${typedError.message}`;
    }
    throw typedError;
  }

  /**
   * 将内部 Tool 参数格式归一化为标准 JSON Schema
   *
   * 内部格式有两种：
   * 1. 空参数: {} → { type: "object", properties: {} }
   * 2. 自定义格式: { paramName: { type: "string", required: true, description: "..." } }
   *    → { type: "object", properties: { paramName: { type: "string", description: "..." } }, required: ["paramName"] }
   *
   * 已是标准 JSON Schema（顶层有 type: "object" 且有 properties）直接返回
   */
  protected normalizeToJsonSchema(parameters: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!parameters || Object.keys(parameters).length === 0) {
      return { type: 'object', properties: {} };
    }

    if (parameters.type === 'object' && parameters.properties !== undefined) {
      return this.normalizeObjectSchema(parameters);
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === 'object' && value !== null) {
        const paramDef = value as Record<string, unknown>;
        properties[key] = this.normalizeProperty(paramDef);

        if (paramDef.required === true) {
          required.push(key);
        }
      }
    }

    const schema: Record<string, unknown> = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      schema.required = required;
    }

    return schema;
  }

  private normalizeProperty(paramDef: Record<string, unknown>): Record<string, unknown> {
    const prop: Record<string, unknown> = {};

    if (paramDef.type) {
      prop.type = paramDef.type;
    }
    if (paramDef.description) {
      prop.description = paramDef.description;
    }
    if (paramDef.enum) {
      prop.enum = paramDef.enum;
    }

    if (paramDef.items) {
      const items = paramDef.items as Record<string, unknown>;
      if (items.type === 'object' && items.properties) {
        prop.items = this.normalizeObjectSchema(items);
      } else {
        prop.items = items;
      }
    }

    return prop;
  }

  private normalizeObjectSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const requiredSet = new Set<string>();
    const props = schema.properties as Record<string, Record<string, unknown>>;

    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        requiredSet.add(key);
      }
    }

    for (const [key, value] of Object.entries(props)) {
      properties[key] = this.normalizeProperty(value);
      if (value.required === true) {
        requiredSet.add(key);
      }
    }

    const result: Record<string, unknown> = { type: 'object', properties };
    if (requiredSet.size > 0) {
      result.required = Array.from(requiredSet);
    }
    if (schema.additionalProperties !== undefined) {
      result.additionalProperties = schema.additionalProperties;
    }

    return result;
  }
}
