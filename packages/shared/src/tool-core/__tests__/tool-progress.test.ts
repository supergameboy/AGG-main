/**
 * tool-progress 单元测试（M6 §8.1）
 *
 * 覆盖 createProgressReporter：
 * ① 200ms 内连续调用仅首次发射（节流丢帧）
 * ② 相同 message 连续调用去重
 * ③ throttle 窗口后新 message 正常发射
 * ④ 回调抛错被吞且 logger.warn，不影响后续上报（工具执行继续）
 * ⑤ percent 边界（0/100/缺失）原样透传
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgressReporter, type ToolProgress } from '../tool-progress.js';

const BASE_TIME = 1_000_000;

describe('createProgressReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('① 节流窗口内连续调用仅首次发射', () => {
    const received: ToolProgress[] = [];
    const report = createProgressReporter((p) => received.push(p), { throttleMs: 200 });

    report({ message: '第一帧' });
    vi.setSystemTime(BASE_TIME + 50);
    report({ message: '第二帧' });
    vi.setSystemTime(BASE_TIME + 150);
    report({ message: '第三帧' });

    expect(received.map((p) => p.message)).toEqual(['第一帧']);
  });

  it('② 相同 message 连续上报被去重（窗口过后仍丢弃）', () => {
    const received: ToolProgress[] = [];
    const report = createProgressReporter((p) => received.push(p), { throttleMs: 200 });

    report({ message: '同一进度' });
    vi.setSystemTime(BASE_TIME + 300);
    report({ message: '同一进度' });

    expect(received).toHaveLength(1);
  });

  it('②b dedupeByMessage=false 时相同 message 窗口过后正常发射', () => {
    const received: ToolProgress[] = [];
    const report = createProgressReporter((p) => received.push(p), {
      throttleMs: 200,
      dedupeByMessage: false,
    });

    report({ message: '同一进度' });
    vi.setSystemTime(BASE_TIME + 300);
    report({ message: '同一进度' });

    expect(received).toHaveLength(2);
  });

  it('③ throttle 窗口后新 message 正常发射', () => {
    const received: ToolProgress[] = [];
    const report = createProgressReporter((p) => received.push(p), { throttleMs: 200 });

    report({ message: '阶段一' });
    vi.setSystemTime(BASE_TIME + 250);
    report({ message: '阶段二' });

    expect(received.map((p) => p.message)).toEqual(['阶段一', '阶段二']);
  });

  it('④ 回调抛错被吞且不影响后续上报', () => {
    const callback = vi.fn((_: ToolProgress): void => undefined);
    callback.mockImplementationOnce(() => {
      throw new Error('桥接异常');
    });
    const report = createProgressReporter(callback, { throttleMs: 0 });

    expect(() => report({ message: '第一帧' })).not.toThrow();
    report({ message: '第二帧' });

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('⑤ percent 边界（0/100/缺失）原样透传', () => {
    const received: ToolProgress[] = [];
    const report = createProgressReporter((p) => received.push(p), { throttleMs: 0 });

    report({ percent: 0, message: '开始' });
    report({ percent: 100, message: '完成' });
    report({ message: '无百分比进度' });

    expect(received).toEqual([
      { percent: 0, message: '开始' },
      { percent: 100, message: '完成' },
      { message: '无百分比进度' },
    ]);
  });

  it('默认配置：throttleMs=200 + dedupeByMessage=true', () => {
    const received: ToolProgress[] = [];
    const report = createProgressReporter((p) => received.push(p));

    report({ message: '第一帧' });
    vi.setSystemTime(BASE_TIME + 100);
    report({ message: '第二帧' });
    vi.setSystemTime(BASE_TIME + 300);
    report({ message: '第三帧' });

    expect(received.map((p) => p.message)).toEqual(['第一帧', '第三帧']);
  });
});
