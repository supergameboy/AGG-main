import { describe, it, expect } from 'vitest';
import type { LLMConfig, LLMResponse, StreamChunk, ChatOptions } from '../../src/types.js';
import type { LLMMessage } from '@ai-rpg/shared';
import { BaseProvider } from '../../src/providers/BaseProvider.js';

/**
 * 测试用具体子类——暴露 protected 方法以供测试
 */
class TestProvider extends BaseProvider {
  constructor(config: LLMConfig) {
    super(config);
  }

  async chat(_messages: LLMMessage[], _options?: ChatOptions): Promise<LLMResponse> {
    return {
      id: 'test-id',
      model: this.config.model,
      content: '',
      role: 'assistant',
      finishReason: 'stop',
    };
  }

  async *stream(_messages: LLMMessage[], _options?: ChatOptions): AsyncIterable<StreamChunk> {
    yield { type: 'content', content: 'test' };
  }

  // 暴露 protected 方法用于测试
  normalizeToJsonSchema(parameters: Record<string, unknown> | undefined): Record<string, unknown> {
    return super.normalizeToJsonSchema(parameters);
  }
}

const baseConfig: LLMConfig = {
  provider: 'openai',
  model: 'gpt-4',
  apiKey: 'test-key',
};

describe('BaseProvider', () => {
  describe('构造函数', () => {
    it('应正确存储 config', () => {
      const provider = new TestProvider(baseConfig);
      expect(provider['config']).toEqual(baseConfig);
    });

    it('应初始化 smartRetry 实例', () => {
      const provider = new TestProvider(baseConfig);
      expect(provider['smartRetry']).toBeDefined();
    });
  });

  describe('countTokens', () => {
    it('空字符串返回 0', () => {
      const provider = new TestProvider(baseConfig);
      expect(provider.countTokens('')).toBe(0);
    });

    it('按 4 字符/token 向上取整', () => {
      const provider = new TestProvider(baseConfig);
      expect(provider.countTokens('abcd')).toBe(1);
      expect(provider.countTokens('abcde')).toBe(2);
      expect(provider.countTokens('abcdefgh')).toBe(2);
    });
  });

  describe('normalizeToJsonSchema', () => {
    it('undefined 参数返回空对象 schema', () => {
      const provider = new TestProvider(baseConfig);
      const result = provider.normalizeToJsonSchema(undefined);
      expect(result).toEqual({ type: 'object', properties: {} });
    });

    it('空对象参数返回空对象 schema', () => {
      const provider = new TestProvider(baseConfig);
      const result = provider.normalizeToJsonSchema({});
      expect(result).toEqual({ type: 'object', properties: {} });
    });

    it('自定义格式（paramName 格式）转换为标准 JSON Schema，required 字段提取到顶层', () => {
      const provider = new TestProvider(baseConfig);
      const result = provider.normalizeToJsonSchema({
        name: { type: 'string', required: true, description: '用户名' },
        age: { type: 'number', description: '年龄' },
      });
      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string', description: '用户名' },
          age: { type: 'number', description: '年龄' },
        },
        required: ['name'],
      });
    });

    it('无 required 字段时不输出 required', () => {
      const provider = new TestProvider(baseConfig);
      const result = provider.normalizeToJsonSchema({
        name: { type: 'string', description: '用户名' },
      });
      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string', description: '用户名' },
        },
      });
      expect(result).not.toHaveProperty('required');
    });

    it('已是标准 JSON Schema（type:object + properties）时归一化属性，合并 required', () => {
      const provider = new TestProvider(baseConfig);
      const result = provider.normalizeToJsonSchema({
        type: 'object',
        properties: {
          name: { type: 'string', required: true, description: '用户名' },
        },
        required: ['name'],
      });
      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string', description: '用户名' },
        },
        required: ['name'],
      });
    });

    it('自定义格式带 enum 时保留 enum 字段', () => {
      const provider = new TestProvider(baseConfig);
      const result = provider.normalizeToJsonSchema({
        color: { type: 'string', enum: ['red', 'green', 'blue'], description: '颜色' },
      });
      expect(result).toEqual({
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['red', 'green', 'blue'], description: '颜色' },
        },
      });
    });

    it('自定义格式带 items 数组定义时归一化 items', () => {
      const provider = new TestProvider(baseConfig);
      const result = provider.normalizeToJsonSchema({
        list: {
          type: 'array',
          items: { type: 'string', description: '列表项' },
        },
      });
      expect(result).toEqual({
        type: 'object',
        properties: {
          list: {
            type: 'array',
            items: { type: 'string', description: '列表项' },
          },
        },
      });
    });
  });

  describe('chat 抽象方法', () => {
    it('子类必须实现 chat 方法', async () => {
      const provider = new TestProvider(baseConfig);
      const response = await provider.chat([]);
      expect(response.model).toBe('gpt-4');
      expect(response.finishReason).toBe('stop');
    });
  });

  describe('stream 抽象方法', () => {
    it('子类必须实现 stream 方法', async () => {
      const provider = new TestProvider(baseConfig);
      const chunks: StreamChunk[] = [];
      for await (const chunk of provider.stream([])) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'content', content: 'test' });
    });
  });
});
