import { describe, expect, it, vi } from 'vitest';
import type { LLMClient, LLMConfig, StreamChunk } from '../../src/types.js';

/**
 * M2-1 register-builtins lazy 集成测试（设计文档 模块M2 §8.1 L6-L7 + §6.2 注册表增量接口）
 *
 * 策略：vi.mock 拦截 11 个真实 Provider 模块（tracker 记录模块加载），
 * 验证"模块加载期零 Provider 加载，首次调用才 dynamic import"的 lazy 契约；
 * bedrock/vertex 插槽文件不存在，走真实 dynamic import 失败路径。
 */

const hoisted = vi.hoisted(() => {
  interface MockConfig {
    model: string;
  }
  interface MockResponse {
    content: string;
    finishReason: 'stop';
  }

  const trackers = {
    openai: vi.fn(),
    gemini: vi.fn(),
    deepseek: vi.fn(),
    glm: vi.fn(),
    kimi: vi.fn(),
    anthropic: vi.fn(),
    qwen: vi.fn(),
    ernie: vi.fn(),
    spark: vi.fn(),
    siliconflow: vi.fn(),
    githubCopilot: vi.fn(),
    custom: vi.fn(),
  };

  function makeMockClass(tag: string) {
    return class MockProvider {
      private readonly model: string;
      constructor(config: MockConfig) {
        this.model = config.model;
      }
      async chat(): Promise<MockResponse> {
        return { content: `mocked:${tag}:${this.model}`, finishReason: 'stop' };
      }
      async *stream(): AsyncIterable<never> {
        // 空流：L6 只验证模块加载时机，不验证流内容
      }
      countTokens(): number {
        return 42;
      }
    };
  }

  return { trackers, makeMockClass };
});

vi.mock('../../src/providers/OpenAIProvider.js', () => {
  hoisted.trackers.openai();
  return { OpenAIProvider: hoisted.makeMockClass('openai') };
});
vi.mock('../../src/providers/GeminiProvider.js', () => {
  hoisted.trackers.gemini();
  return { GeminiProvider: hoisted.makeMockClass('gemini') };
});
vi.mock('../../src/providers/DeepSeekProvider.js', () => {
  hoisted.trackers.deepseek();
  return { DeepSeekProvider: hoisted.makeMockClass('deepseek') };
});
vi.mock('../../src/providers/GLMProvider.js', () => {
  hoisted.trackers.glm();
  return { GLMProvider: hoisted.makeMockClass('glm') };
});
vi.mock('../../src/providers/KimiProvider.js', () => {
  hoisted.trackers.kimi();
  return { KimiProvider: hoisted.makeMockClass('kimi') };
});
vi.mock('../../src/providers/AnthropicCompatibleProvider.js', () => {
  hoisted.trackers.anthropic();
  return { AnthropicCompatibleProvider: hoisted.makeMockClass('anthropic') };
});
vi.mock('../../src/providers/QwenProvider.js', () => {
  hoisted.trackers.qwen();
  return { QwenProvider: hoisted.makeMockClass('qwen') };
});
vi.mock('../../src/providers/ErnieProvider.js', () => {
  hoisted.trackers.ernie();
  return { ErnieProvider: hoisted.makeMockClass('ernie') };
});
vi.mock('../../src/providers/SparkProvider.js', () => {
  hoisted.trackers.spark();
  return { SparkProvider: hoisted.makeMockClass('spark') };
});
vi.mock('../../src/providers/SiliconFlowProvider.js', () => {
  hoisted.trackers.siliconflow();
  return { SiliconFlowProvider: hoisted.makeMockClass('siliconflow') };
});
vi.mock('../../src/providers/GitHubCopilotProvider.js', () => {
  hoisted.trackers.githubCopilot();
  return { GitHubCopilotProvider: hoisted.makeMockClass('github-copilot') };
});
vi.mock('../../src/providers/CustomProvider.js', () => {
  hoisted.trackers.custom();
  return { CustomProvider: hoisted.makeMockClass('custom') };
});

// 静态 import 触发模块级 registerBuiltinProviders()——此动作本身即 L6 的被测行为
import '../../src/providers/register-builtins.js';
import {
  getProviderFactory,
  getProviderSourceId,
  hasProvider,
  listProviderTypes,
  registerProvider,
  unregisterProviders,
} from '../../src/provider-registry.js';
import { LazyProviderProxy } from '../../src/utils/lazy-provider.js';
import { LLMProviderLoadError } from '../../src/errors.js';

const config: LLMConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' };

const BUILTIN_TYPES = [
  'openai', 'gemini', 'deepseek', 'glm', 'kimi', 'anthropic',
  'qwen', 'ernie', 'spark', 'siliconflow', 'github-copilot', 'custom',
] as const;

describe('register-builtins lazy 集成（L6-L7）', () => {
  it('L6: 12 内置 + bedrock/vertex 插槽全部注册，sourceId=builtin', () => {
    for (const type of [...BUILTIN_TYPES, 'bedrock', 'vertex']) {
      expect(hasProvider(type)).toBe(true);
      expect(getProviderSourceId(type)).toBe('builtin');
    }
    expect(listProviderTypes()).toHaveLength(14);
  });

  it('L6b: 模块加载期零 Provider 模块加载；工厂同步返回 proxy 且不触发加载', () => {
    for (const tracker of Object.values(hoisted.trackers)) {
      expect(tracker).not.toHaveBeenCalled();
    }

    const factory = getProviderFactory('openai');
    if (!factory) throw new Error('openai 应已注册');
    const client = factory(config);

    expect(client).toBeInstanceOf(LazyProviderProxy);
    // 未加载可观测信号：countTokens 用 chars/4 粗估（ceil(7/4)=2），而非委托真实实例
    expect(client.countTokens('abcdefg')).toBe(2);
    expect(hoisted.trackers.openai).not.toHaveBeenCalled();
  });

  it('L6c: 首次调用才触发目标模块 dynamic import，其余模块仍零加载', async () => {
    const factory = getProviderFactory('openai');
    if (!factory) throw new Error('openai 应已注册');
    const client = factory(config);

    const response = await client.chat([]);

    expect(hoisted.trackers.openai).toHaveBeenCalledTimes(1);
    expect(response.content).toBe('mocked:openai:gpt-4o');
    for (const [tag, tracker] of Object.entries(hoisted.trackers)) {
      if (tag !== 'openai') {
        expect(tracker, `模块 ${tag} 不应被加载`).not.toHaveBeenCalled();
      }
    }
  });

  it('L7: bedrock 插槽未实现——调用抛 LLMProviderLoadError 且含可选依赖提示', async () => {
    const factory = getProviderFactory('bedrock');
    if (!factory) throw new Error('bedrock 插槽应已注册');

    try {
      await factory(config).chat([]);
      expect.unreachable('bedrock 未实现应 reject');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMProviderLoadError);
      if (!(error instanceof LLMProviderLoadError)) throw error;
      expect(error.providerType).toBe('bedrock');
      expect(error.message).toContain('@aws-sdk/client-bedrock-runtime');
    }
  });

  it('L7b: vertex 插槽未实现——调用抛 LLMProviderLoadError 且含可选依赖提示', async () => {
    const factory = getProviderFactory('vertex');
    if (!factory) throw new Error('vertex 插槽应已注册');

    try {
      await factory(config).chat([]);
      expect.unreachable('vertex 未实现应 reject');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMProviderLoadError);
      if (!(error instanceof LLMProviderLoadError)) throw error;
      expect(error.providerType).toBe('vertex');
      expect(error.message).toContain('@google/genai');
    }
  });
});

describe('ProviderRegistry M2 增量接口（§6.2）', () => {
  const dummyClient: LLMClient = {
    chat: async () => ({ content: 'dummy', finishReason: 'stop' }),
    stream: async function* (): AsyncIterable<StreamChunk> {
      // 空流：注册表测试不调用 stream
    },
    countTokens: () => 0,
  };
  const dummyFactory = (): LLMClient => dummyClient;

  it('unregisterProviders(sourceId) 按来源批量注销，其他来源与 builtin 不受影响', () => {
    registerProvider('test-plugin-a', dummyFactory, 'plugin:demo');
    registerProvider('test-plugin-b', dummyFactory, 'plugin:demo');
    registerProvider('test-plugin-c', dummyFactory, 'plugin:other');

    unregisterProviders('plugin:demo');

    expect(hasProvider('test-plugin-a')).toBe(false);
    expect(hasProvider('test-plugin-b')).toBe(false);
    expect(hasProvider('test-plugin-c')).toBe(true);
    expect(getProviderSourceId('test-plugin-c')).toBe('plugin:other');
    expect(hasProvider('openai')).toBe(true); // builtin 不受影响

    unregisterProviders('plugin:other'); // 清理，避免污染同文件后续断言
    expect(hasProvider('test-plugin-c')).toBe(false);
  });

  it('unregisterProviders 对不存在 sourceId 为空操作（不抛错）', () => {
    const before = listProviderTypes().length;

    expect(() => unregisterProviders('plugin:nonexistent')).not.toThrow();
    expect(listProviderTypes()).toHaveLength(before);
  });

  it('getProviderSourceId 对未注册类型返回 undefined', () => {
    expect(getProviderSourceId('no-such-provider')).toBeUndefined();
  });
});
