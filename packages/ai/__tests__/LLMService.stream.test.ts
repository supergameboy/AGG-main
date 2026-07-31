import { describe, expect, it, vi } from 'vitest';
import { LLMService } from '@ai-rpg/ai';
import type {
  ILLMMetricsSink,
  LLMClient,
  LLMClientStreamChunk,
  LLMStreamEvent,
} from '@ai-rpg/ai';

/**
 * LLMService.stream 集成测试（M1 设计文档 §10.2）
 *
 * 验证点：
 * 1. 流式调用端到端：EventStream 事件序列正确（start → text_* → done）+ 度量数据经 sink 落库
 * 2. 并发流式调用：多个 EventStream 实例互不干扰
 * 3. 中途失败：error 事件携带 partial + 迭代器抛出 + 失败度量记录
 */

function makeFakeClient(chunks: LLMClientStreamChunk[], errorAfterChunks?: Error): LLMClient {
  return {
    chat: vi.fn(),
    countTokens: (text: string) => text.length,
    stream: vi.fn().mockImplementation(async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
      if (errorAfterChunks) {
        throw errorAfterChunks;
      }
    }),
  };
}

function makeFakeModelConfig(client: LLMClient) {
  return {
    getDefaults: vi.fn().mockResolvedValue({ defaultProviderId: 'p-1', defaultModel: 'model-1' }),
    getProviderInstance: vi.fn().mockResolvedValue(client),
    getProvider: vi.fn().mockResolvedValue({ defaultModel: 'model-1' }),
    getActiveApiKey: vi.fn().mockResolvedValue({ key: 'sk-test', index: 0 }),
  };
}

const USAGE = {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  promptCacheHitTokens: 4,
  promptCacheMissTokens: 6,
};

describe('LLMService.stream 集成（M1：EventStream 端到端）', () => {
  it('事件序列正确且 result 解析为最终消息，度量经 sink 记录', async () => {
    const client = makeFakeClient([
      { type: 'content', content: 'Hello' },
      { type: 'content', content: ' world' },
      { type: 'content', content: '', finishReason: 'stop', usage: USAGE },
    ]);
    const recordSpy = vi.fn();
    const sink: ILLMMetricsSink = { record: recordSpy };
    const service = new LLMService(makeFakeModelConfig(client) as never, sink);

    const stream = service.stream(
      [{ role: 'user', content: 'hi' }],
      undefined,
      'save-1',
      'coordinator',
    );

    const events: LLMStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.map(e => e.type)).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_delta',
      'text_end',
      'done',
    ]);

    const result = await stream.result();
    expect(result.role).toBe('assistant');
    expect(result.content).toBe('Hello world');
    expect(result.usage).toEqual(USAGE);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
      saveId: 'save-1',
      agentType: 'coordinator',
      model: 'model-1',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      promptCacheHitTokens: 4,
      promptCacheMissTokens: 6,
      success: true,
    }));
  });

  it('并发流式调用：两个 EventStream 实例事件互不干扰', async () => {
    const clientA = makeFakeClient([
      { type: 'content', content: 'AAA', finishReason: 'stop', usage: USAGE },
    ]);
    const clientB = makeFakeClient([
      { type: 'content', content: 'BBB', finishReason: 'stop', usage: USAGE },
    ]);
    const recordSpy = vi.fn();
    const service = new LLMService({
      getDefaults: vi.fn().mockResolvedValue({ defaultProviderId: 'p-1' }),
      getProviderInstance: vi.fn()
        .mockResolvedValueOnce(clientA)
        .mockResolvedValueOnce(clientB),
      getProvider: vi.fn().mockResolvedValue({ defaultModel: 'model-1' }),
      getActiveApiKey: vi.fn().mockResolvedValue({ key: 'sk-test', index: 0 }),
    } as never, { record: recordSpy });

    const [eventsA, eventsB] = await Promise.all([
      (async () => {
        const collected: LLMStreamEvent[] = [];
        for await (const event of service.stream([{ role: 'user', content: 'a' }], undefined, 'save-a', 'coordinator')) {
          collected.push(event);
        }
        return collected;
      })(),
      (async () => {
        const collected: LLMStreamEvent[] = [];
        for await (const event of service.stream([{ role: 'user', content: 'b' }], undefined, 'save-b', 'coordinator')) {
          collected.push(event);
        }
        return collected;
      })(),
    ]);

    const textOf = (events: LLMStreamEvent[]) => events
      .filter((e): e is Extract<LLMStreamEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map(e => e.delta)
      .join('');

    expect(textOf(eventsA)).toBe('AAA');
    expect(textOf(eventsB)).toBe('BBB');
    expect(recordSpy).toHaveBeenCalledTimes(2);
  });

  it('中途失败：error 事件携带 partial，迭代器抛出原错误，记录失败度量', async () => {
    const boom = new Error('provider exploded');
    const client = makeFakeClient(
      [{ type: 'content', content: '半截内容' }],
      boom,
    );
    const recordSpy = vi.fn();
    const service = new LLMService(makeFakeModelConfig(client) as never, { record: recordSpy });

    const stream = service.stream(
      [{ role: 'user', content: 'hi' }],
      undefined,
      'save-1',
      'coordinator',
    );

    const events: LLMStreamEvent[] = [];
    await expect((async () => {
      for await (const event of stream) {
        events.push(event);
      }
    })()).rejects.toThrow('provider exploded');

    const errorEvent = events.find(e => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      type: 'error',
      error: { message: 'provider exploded' },
      partial: { text: '半截内容' },
    });

    await expect(stream.result()).rejects.toThrow('provider exploded');

    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
      saveId: 'save-1',
      agentType: 'coordinator',
      success: false,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }));
  });

  it('saveId/agentType 缺失时不记录度量（流式路径门控）', async () => {
    const client = makeFakeClient([
      { type: 'content', content: 'ok', finishReason: 'stop', usage: USAGE },
    ]);
    const recordSpy = vi.fn();
    const service = new LLMService(makeFakeModelConfig(client) as never, { record: recordSpy });

    for await (const _ of service.stream([{ role: 'user', content: 'hi' }])) {
      // 消费完毕即可
    }

    expect(recordSpy).not.toHaveBeenCalled();
  });
});
