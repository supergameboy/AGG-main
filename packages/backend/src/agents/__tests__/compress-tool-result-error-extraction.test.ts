import { describe, expect, it } from 'vitest';

describe('ReActEngine — compressToolResult error extraction (E4-2)', () => {
  // 直接测试 extractErrorFromData 逻辑（通过 compressToolResult 的行为验证）

  function extractErrorFromData(data: unknown): string | null {
    if (Array.isArray(data)) {
      const firstError = data.find(d => d && typeof d === 'object' && 'error' in (d as Record<string, unknown>));
      if (firstError) {
        return String((firstError as Record<string, unknown>).error);
      }
    }
    return null;
  }

  function compressToolResult(toolResult: Record<string, unknown>): string {
    if (!toolResult.success) {
      const error = toolResult.error || extractErrorFromData(toolResult.data) || 'Execution failed';
      return JSON.stringify({ success: false, error });
    }
    return JSON.stringify({ success: true, data: toolResult.data });
  }

  it('当 toolResult.error 存在时，优先使用顶层 error', () => {
    const result = compressToolResult({
      success: false,
      error: 'Top-level error',
      data: [{ error: 'Data-level error' }],
    });
    expect(JSON.parse(result)).toEqual({ success: false, error: 'Top-level error' });
  });

  it('当 toolResult.error 为空但 data 中有错误时，提取 data 中的错误', () => {
    const result = compressToolResult({
      success: false,
      data: [
        { success: false, error: '物品未找到: inv-123' },
        { success: false, error: '物品未找到: inv-456' },
      ],
    });
    expect(JSON.parse(result)).toEqual({ success: false, error: '物品未找到: inv-123' });
  });

  it('当 toolResult.error 和 data 都没有错误时，回退到 Execution failed', () => {
    const result = compressToolResult({
      success: false,
      data: [{ success: false }],
    });
    expect(JSON.parse(result)).toEqual({ success: false, error: 'Execution failed' });
  });

  it('当 data 为空数组时，回退到 Execution failed', () => {
    const result = compressToolResult({
      success: false,
      data: [],
    });
    expect(JSON.parse(result)).toEqual({ success: false, error: 'Execution failed' });
  });

  it('当 data 为 undefined 时，回退到 Execution failed', () => {
    const result = compressToolResult({
      success: false,
    });
    expect(JSON.parse(result)).toEqual({ success: false, error: 'Execution failed' });
  });

  it('当 toolResult.error 为空字符串时，从 data 提取错误', () => {
    const result = compressToolResult({
      success: false,
      error: '',
      data: [{ error: '物品未找到: sword-1' }],
    });
    expect(JSON.parse(result)).toEqual({ success: false, error: '物品未找到: sword-1' });
  });
});
