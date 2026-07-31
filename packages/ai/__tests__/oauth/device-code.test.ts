import { describe, expect, it, vi } from 'vitest';
import {
  LOGIN_CANCELLED_MESSAGE,
  pollDeviceCodeFlow,
  type DeviceCodePollResult,
} from '../../src/oauth/index.js';

/**
 * M2-4 pollDeviceCodeFlow 单元测试（设计文档 模块M2 §8.4 O6-O9）
 * 全 mock：poll 注入脚本化响应序列，sleep 注入 spy 校验等待时长（零真实等待/网络）。
 */

interface FakeCredentials {
  access: string;
}

const completeValue: FakeCredentials = { access: 'token-123' };

/** 脚本化 poll：按队列依次返回响应，耗尽后返回 failed（防测试逻辑死循环） */
function scriptedPoll(queue: Array<DeviceCodePollResult<FakeCredentials>>) {
  return vi.fn(async (): Promise<DeviceCodePollResult<FakeCredentials>> => {
    const next = queue.shift();
    return next ?? { status: 'failed', message: 'poll queue exhausted' };
  });
}

/** sleep spy：记录等待时长参数，零真实等待 */
function makeSleepSpy() {
  return vi.fn(async (_ms: number) => {});
}

describe('pollDeviceCodeFlow（O6-O9）', () => {
  it('O6: pending × 2 → complete 完整流程，返回 complete 的值', async () => {
    const poll = scriptedPoll([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'complete', value: completeValue },
    ]);
    const sleep = makeSleepSpy();

    const result = await pollDeviceCodeFlow<FakeCredentials>({
      intervalSeconds: 1,
      poll,
      sleep,
    });

    expect(result).toBe(completeValue);
    expect(poll).toHaveBeenCalledTimes(3);
    // 每次响应后按当前 interval 等待：2 次等待均为 1000ms
    expect(sleep.mock.calls.map(call => call[0])).toEqual([1000, 1000]);
  });

  it('O7: slow_down 处理——默认 interval 5s，slow_down 后 +5s（校验 sleep 时长参数）', async () => {
    const poll = scriptedPoll([
      { status: 'pending' },
      { status: 'slow_down' },
      { status: 'complete', value: completeValue },
    ]);
    const sleep = makeSleepSpy();

    await pollDeviceCodeFlow<FakeCredentials>({ poll, sleep });

    // 首次等待用默认 5000ms；slow_down 响应后 interval 增至 10000ms（对本次生效）
    expect(sleep.mock.calls.map(call => call[0])).toEqual([5000, 10000]);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('O8a: expiresInSeconds=0 已过期——立即抛超时错误，poll 不被调用', async () => {
    const poll = scriptedPoll([{ status: 'complete', value: completeValue }]);

    await expect(
      pollDeviceCodeFlow<FakeCredentials>({ expiresInSeconds: 0, poll }),
    ).rejects.toThrow(/timed out/);
    expect(poll).not.toHaveBeenCalled();
  });

  it('O8b: 轮询中途超过 expiresInSeconds——下一轮抛超时错误，不再发请求', async () => {
    const poll = scriptedPoll([{ status: 'pending' }]);
    // 真实短等待越过 50ms 有效期，验证 deadline 在轮询循环中生效
    const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms + 20));

    await expect(
      pollDeviceCodeFlow<FakeCredentials>({
        intervalSeconds: 0.04,
        expiresInSeconds: 0.05,
        poll,
        sleep: realSleep,
      }),
    ).rejects.toThrow(/timed out/);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('O9a: AbortSignal 预先取消——抛 Login cancelled，poll 不被调用', async () => {
    const controller = new AbortController();
    controller.abort();
    const poll = scriptedPoll([{ status: 'complete', value: completeValue }]);

    await expect(
      pollDeviceCodeFlow<FakeCredentials>({ poll, signal: controller.signal }),
    ).rejects.toThrow(LOGIN_CANCELLED_MESSAGE);
    expect(poll).not.toHaveBeenCalled();
  });

  it('O9b: 轮询中途取消——下一轮抛 Login cancelled', async () => {
    const controller = new AbortController();
    const poll = vi.fn(async (): Promise<DeviceCodePollResult<FakeCredentials>> => {
      controller.abort();
      return { status: 'pending' };
    });

    await expect(
      pollDeviceCodeFlow<FakeCredentials>({
        poll,
        signal: controller.signal,
        sleep: makeSleepSpy(),
      }),
    ).rejects.toThrow(LOGIN_CANCELLED_MESSAGE);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('补充: failed 状态抛携带服务端 message 的 Error（不吞错误，如用户拒绝授权）', async () => {
    const poll = scriptedPoll([{ status: 'failed', message: 'access_denied: 用户拒绝授权' }]);

    await expect(
      pollDeviceCodeFlow<FakeCredentials>({ poll, sleep: makeSleepSpy() }),
    ).rejects.toThrow('access_denied: 用户拒绝授权');
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
