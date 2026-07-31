/**
 * abort-signal 单元测试（M6 §8.1）
 *
 * 覆盖 throwIfAborted / isAbortError / abortReasonToMessage：
 * ① aborted=false 不抛
 * ② aborted=true 抛 ToolAbortError 且 reason 透传
 * ③ 真实 AbortController signal 结构互操作
 * ④ 字面量 {aborted:true} 简版 signal 兼容
 * ⑤ isAbortError 区分 ToolAbortError/普通 Error/非 Error 值
 * ⑥ reason 为 string/Error/undefined 的文案规范化
 */
import { describe, expect, it } from 'vitest';
import {
  ToolAbortError,
  abortReasonToMessage,
  isAbortError,
  throwIfAborted,
  type ToolAbortSignal,
} from '../abort-signal.js';

describe('throwIfAborted', () => {
  it('① signal 缺失或 aborted=false 时不抛', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted({ aborted: false })).not.toThrow();
  });

  it('② aborted=true 时抛 ToolAbortError 且 reason 透传', () => {
    const signal: ToolAbortSignal = { aborted: true, reason: '用户取消' };
    try {
      throwIfAborted(signal);
      expect.unreachable('应抛出 ToolAbortError');
    } catch (error) {
      expect(isAbortError(error)).toBe(true);
      if (isAbortError(error)) {
        expect(error).toBeInstanceOf(ToolAbortError);
        expect(error.reason).toBe('用户取消');
        expect(error.message).toContain('用户取消');
      }
    }
  });

  it('③ 真实 AbortController signal 结构兼容（原生 throwIfAborted 委托并规范化）', () => {
    const controller = new AbortController();
    // 结构化类型互操作：真实 AbortSignal 直接赋值给 ToolAbortSignal
    const signal: ToolAbortSignal = controller.signal;

    expect(() => throwIfAborted(signal)).not.toThrow();

    controller.abort('断连取消');
    try {
      throwIfAborted(signal);
      expect.unreachable('应抛出 ToolAbortError');
    } catch (error) {
      expect(isAbortError(error)).toBe(true);
      if (isAbortError(error)) {
        expect(error.reason).toBe('断连取消');
        expect(error.message).toContain('断连取消');
      }
    }
  });

  it('③b 真实 AbortController 无 reason 取消时抛 ToolAbortError 且含默认文案', () => {
    const controller = new AbortController();
    controller.abort();
    try {
      throwIfAborted(controller.signal);
      expect.unreachable('应抛出 ToolAbortError');
    } catch (error) {
      expect(isAbortError(error)).toBe(true);
      if (isAbortError(error)) {
        expect(error.message).toContain('工具执行已取消');
      }
    }
  });

  it('④ 字面量 {aborted:true} 简版 signal 兼容（无 throwIfAborted 方法）', () => {
    const signal: ToolAbortSignal = { aborted: true };
    try {
      throwIfAborted(signal);
      expect.unreachable('应抛出 ToolAbortError');
    } catch (error) {
      expect(isAbortError(error)).toBe(true);
      if (isAbortError(error)) {
        expect(error.message).toContain('工具执行已取消');
      }
    }
  });

  it('④b 自定义 throwIfAborted 已抛 ToolAbortError 时不重复包装', () => {
    const original = new ToolAbortError('已取消', '原始原因');
    const signal: ToolAbortSignal = {
      aborted: true,
      throwIfAborted: () => {
        throw original;
      },
    };
    try {
      throwIfAborted(signal);
      expect.unreachable('应抛出 ToolAbortError');
    } catch (error) {
      expect(error).toBe(original);
    }
  });
});

describe('isAbortError', () => {
  it('⑤ 区分 ToolAbortError / 普通 Error / 非 Error 值', () => {
    expect(isAbortError(new ToolAbortError())).toBe(true);
    expect(isAbortError(new ToolAbortError('msg', 'reason'))).toBe(true);
    expect(isAbortError(new Error('普通错误'))).toBe(false);
    expect(isAbortError('ToolAbortError')).toBe(false);
    expect(isAbortError({ name: 'ToolAbortError' })).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it('⑤b name 为 ToolAbortError 的 Error 子类跨域兼容', () => {
    const crossRealm = new Error('跨域取消');
    crossRealm.name = 'ToolAbortError';
    expect(isAbortError(crossRealm)).toBe(true);
  });
});

describe('abortReasonToMessage', () => {
  it('⑥ reason 为 string/Error/undefined 的文案规范化', () => {
    expect(abortReasonToMessage('用户主动取消')).toBe('用户主动取消');
    expect(abortReasonToMessage(new Error('连接中断'))).toBe('连接中断');
    expect(abortReasonToMessage(undefined)).toBe('外部请求已取消');
    expect(abortReasonToMessage(null)).toBe('外部请求已取消');
    expect(abortReasonToMessage(42)).toBe('42');
  });
});
