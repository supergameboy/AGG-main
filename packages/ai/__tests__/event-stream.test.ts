import { describe, expect, it } from 'vitest';
import { EventStream } from '@ai-rpg/ai';

/**
 * EventStream 单元测试（M1 设计文档 §10.1：要求 100% 覆盖）
 *
 * 验证点：
 * 1. push / 异步迭代（顺序、缓冲、等待消费）
 * 2. isComplete 自动触发 end + result 提取
 * 3. end 显式结果 / 队列末事件兜底 / 空流拒绝
 * 4. fail 错误传播（result reject + 迭代器 throw）
 * 5. 结束后 push 抛错 / end 幂等 / fail-after-end 无操作
 */

interface TestEvent {
  type: 'delta' | 'done' | 'other';
  value?: number;
}

function createStream() {
  return new EventStream<TestEvent, number>(
    (event) => event.type === 'done',
    (event) => event.value ?? -1,
  );
}

describe('EventStream — push 与异步迭代', () => {
  it('先 push 后消费：事件按顺序缓冲交付', async () => {
    const stream = createStream();
    stream.push({ type: 'delta', value: 1 });
    stream.push({ type: 'delta', value: 2 });
    stream.push({ type: 'done', value: 3 });

    const received: TestEvent[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received.map(e => e.value)).toEqual([1, 2, 3]);
  });

  it('先消费后 push：等待中的迭代器被唤醒', async () => {
    const stream = createStream();

    const consumed: TestEvent[] = [];
    const consumePromise = (async () => {
      for await (const event of stream) {
        consumed.push(event);
      }
    })();

    // 让迭代器进入等待状态
    await new Promise(resolve => setTimeout(resolve, 0));
    stream.push({ type: 'delta', value: 10 });
    await new Promise(resolve => setTimeout(resolve, 0));
    stream.push({ type: 'done', value: 20 });

    await consumePromise;
    expect(consumed.map(e => e.value)).toEqual([10, 20]);
  });

  it('isDone 在结束后返回 true', async () => {
    const stream = createStream();
    expect(stream.isDone).toBe(false);
    stream.push({ type: 'done', value: 1 });
    expect(stream.isDone).toBe(true);
  });
});

describe('EventStream — result 提取', () => {
  it('push 满足 isComplete 的事件时自动 end，result 解析为 extractResult 值', async () => {
    const stream = createStream();
    stream.push({ type: 'delta', value: 1 });
    stream.push({ type: 'done', value: 42 });

    await expect(stream.result()).resolves.toBe(42);
  });

  it('end() 显式传入结果时优先使用', async () => {
    const stream = createStream();
    stream.push({ type: 'delta', value: 1 });
    stream.end(99);

    await expect(stream.result()).resolves.toBe(99);
  });

  it('end() 无参数时使用队列末事件的 extractResult', async () => {
    const stream = createStream();
    stream.push({ type: 'other', value: 7 });
    stream.end();

    await expect(stream.result()).resolves.toBe(7);
  });

  it('空流 end() 时 result 拒绝（ended without result）', async () => {
    const stream = createStream();
    stream.end();

    await expect(stream.result()).rejects.toThrow('EventStream ended without result');
  });

  it('队列已被消费殆尽时 end() 无参数，result 拒绝', async () => {
    const stream = createStream();
    stream.push({ type: 'other', value: 1 });

    // 消费掉唯一事件（不 await 完成，仅取一次）
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    stream.end();

    await expect(stream.result()).rejects.toThrow('EventStream ended without result');
  });
});

describe('EventStream — fail 错误传播', () => {
  it('fail 后 result 拒绝并携带原错误', async () => {
    const stream = createStream();
    const boom = new Error('stream boom');
    stream.fail(boom);

    await expect(stream.result()).rejects.toBe(boom);
  });

  it('fail 后迭代器抛出错误', async () => {
    const stream = createStream();
    stream.push({ type: 'delta', value: 1 });
    stream.fail(new Error('mid-stream failure'));

    const received: TestEvent[] = [];
    await expect((async () => {
      for await (const event of stream) {
        received.push(event);
      }
    })()).rejects.toThrow('mid-stream failure');
    expect(received).toHaveLength(1);
  });

  it('等待中的消费者在 fail 时被唤醒并抛出错误', async () => {
    const stream = createStream();

    const consumePromise = expect((async () => {
      for await (const _ of stream) {
        // 不应收到任何事件
      }
    })()).rejects.toThrow('late failure');

    await new Promise(resolve => setTimeout(resolve, 0));
    stream.fail(new Error('late failure'));

    await consumePromise;
  });
});

describe('EventStream — 结束后行为', () => {
  it('end 后 push 抛错（EventStream already ended）', async () => {
    const stream = createStream();
    stream.push({ type: 'done', value: 1 });

    expect(() => stream.push({ type: 'delta', value: 2 })).toThrow('EventStream already ended');
  });

  it('end 幂等：重复 end 不改变结果', async () => {
    const stream = createStream();
    stream.end(5);
    stream.end(6);

    await expect(stream.result()).resolves.toBe(5);
  });

  it('end 后 fail 无操作（结果不被覆盖）', async () => {
    const stream = createStream();
    stream.end(3);
    stream.fail(new Error('too late'));

    await expect(stream.result()).resolves.toBe(3);
  });

  it('fail 幂等：重复 fail 保留首个错误', async () => {
    const stream = createStream();
    const first = new Error('first');
    stream.fail(first);
    stream.fail(new Error('second'));

    await expect(stream.result()).rejects.toBe(first);
  });
});
