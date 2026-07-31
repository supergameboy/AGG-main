import { describe, expect, it, vi } from 'vitest';
import type { LLMClient, LLMConfig, LLMResponse, StreamChunk, ChatOptions } from '../../src/types.js';
import type { LLMMessage } from '@ai-rpg/shared';
import {
  LazyProviderProxy,
  createLazyProviderFactory,
  type ProviderConstructor,
} from '../../src/utils/lazy-provider.js';
import { LLMProviderLoadError } from '../../src/errors.js';

/**
 * M2-1 LazyProviderProxy 单元测试（设计文档 模块M2 §8.1 L1-L5）
 * 全程 mock loader，零真实 Provider 模块 import。
 */

const config: LLMConfig = { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' };

/** mock Provider：chat 返回固定内容，stream 产出 2 个 chunk，countTokens 返回哨兵值 999 */
class MockProvider implements LLMClient {
  constructor(readonly cfg: LLMConfig) {}

  async chat(_messages: LLMMessage[], _options?: ChatOptions): Promise<LLMResponse> {
    return { content: `mock-content:${this.cfg.model}`, finishReason: 'stop' };
  }

  async *stream(_messages: LLMMessage[], _options?: ChatOptions): AsyncIterable<StreamChunk> {
    yield { type: 'content', content: 'chunk-a' };
    yield { type: 'content', content: 'chunk-b' };
  }

  countTokens(_text: string): number {
    return 999;
  }
}

function makeLoader(impl: () => Promise<ProviderConstructor> = async () => MockProvider) {
  return vi.fn(impl);
}

describe('LazyProviderProxy（L1-L5）', () => {
  it('L1: 首次 chat 触发 loader 并缓存实例，后续调用不再加载', async () => {
    const loader = makeLoader();
    const proxy = new LazyProviderProxy(loader, config, 'openai');

    const r1 = await proxy.chat([]);
    const r2 = await proxy.chat([]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(r1.content).toBe('mock-content:gpt-4o');
    expect(r2.content).toBe('mock-content:gpt-4o');
  });

  it('L2: 并发 5 个首次 chat 共享同一加载 promise（||= 去重），结果一致', async () => {
    const loader = makeLoader();
    const proxy = new LazyProviderProxy(loader, config, 'openai');

    const results = await Promise.all([
      proxy.chat([]), proxy.chat([]), proxy.chat([]), proxy.chat([]), proxy.chat([]),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.content).toBe('mock-content:gpt-4o');
    }
  });

  it('L3: loader 首次失败抛 LLMProviderLoadError（不缓存失败），二次调用重新加载并成功', async () => {
    let attempt = 0;
    const loader = makeLoader(async () => {
      attempt++;
      if (attempt === 1) throw new Error("Cannot find module './XxxProvider.js'");
      return MockProvider;
    });
    const proxy = new LazyProviderProxy(loader, config, 'openai');

    try {
      await proxy.chat([]);
      expect.unreachable('首次调用应 reject');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMProviderLoadError);
      if (!(error instanceof LLMProviderLoadError)) throw error;
      expect(error.providerType).toBe('openai');
      expect(error.message).toContain('openai');
      expect(error.message).toContain('Cannot find module');
    }
    expect(loader).toHaveBeenCalledTimes(1);

    // 失败 promise 未缓存：第二次调用重新触发 loader
    const r = await proxy.chat([]);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(r.content).toBe('mock-content:gpt-4o');
  });

  it('L3b: optionalDependency 选项附加依赖提示到错误信息（bedrock/vertex 插槽语义）', async () => {
    const loader = makeLoader(async () => {
      throw new Error('Cannot find module');
    });
    const proxy = new LazyProviderProxy(loader, config, 'bedrock', {
      optionalDependency: '@aws-sdk/client-bedrock-runtime',
    });

    await expect(proxy.chat([])).rejects.toThrow(/@aws-sdk\/client-bedrock-runtime/);
  });

  it('L4: stream 委托真实实例并转发全部 chunk', async () => {
    const loader = makeLoader();
    const proxy = new LazyProviderProxy(loader, config, 'openai');

    const chunks: StreamChunk[] = [];
    for await (const chunk of proxy.stream([])) {
      chunks.push(chunk);
    }

    expect(loader).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([
      { type: 'content', content: 'chunk-a' },
      { type: 'content', content: 'chunk-b' },
    ]);
  });

  it('L5: countTokens 未加载时用 chars/4 粗估，加载后委托真实实例', async () => {
    const loader = makeLoader();
    const proxy = new LazyProviderProxy(loader, config, 'openai');

    // 未加载：Math.ceil(7/4) = 2
    expect(proxy.countTokens('abcdefg')).toBe(2);
    expect(loader).not.toHaveBeenCalled();

    await proxy.chat([]);

    // 已加载：委托 MockProvider 哨兵值
    expect(proxy.countTokens('abcdefg')).toBe(999);
  });
});

describe('createLazyProviderFactory', () => {
  it('工厂签名与 ProviderFactoryFn 兼容：同步返回 proxy，构造时不触发加载', async () => {
    const loader = makeLoader();
    const factory: (cfg: LLMConfig) => LLMClient = createLazyProviderFactory(loader, 'openai');

    const client = factory(config);
    expect(client).toBeInstanceOf(LazyProviderProxy);
    expect(loader).not.toHaveBeenCalled();

    const r = await client.chat([]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(r.content).toBe('mock-content:gpt-4o');
  });
});
