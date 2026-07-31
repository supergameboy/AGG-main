import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LLMMessage } from '@ai-rpg/shared';
import { normalizeToolCallIds } from '../../src/utils/transform-messages.js';

/**
 * M2-3 transform-messages 单元测试（设计文档 模块M2 §8.3 T1-T8）
 * anthropic 字符集+长度双约束 / openai 仅长度约束 / 配对一致 / 确定性 / 幂等。
 */

const ANTHROPIC_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** 与实现同源的预期值：tc_ + sha256(originalId) 前 16 hex */
function expectedNormalized(id: string): string {
  return `tc_${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
}

function makeAssistantWithToolCall(id: string): LLMMessage {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [{ id, type: 'function', function: { name: 'get_weather', arguments: '{}' } }],
  };
}

function makeToolResult(toolCallId: string): LLMMessage {
  return { role: 'tool', content: 'sunny', toolCallId };
}

describe('normalizeToolCallIds target=anthropic（T1-T6）', () => {
  it('T1: 合规 ID 不替换——changed=false、idMap 为空、返回原数组引用', () => {
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall('call_abc123'),
      makeToolResult('call_abc123'),
    ];

    const result = normalizeToolCallIds(messages, 'anthropic');

    expect(result.changed).toBe(false);
    expect(result.idMap.size).toBe(0);
    expect(result.messages).toBe(messages);
  });

  it('T2: 含 |/. 特殊字符 ID 替换为 tc_[0-9a-f]{16}，匹配 anthropic 约束', () => {
    const originalId = 'call|xyz.123';

    const result = normalizeToolCallIds([makeToolResult(originalId)], 'anthropic');

    expect(result.changed).toBe(true);
    const normalizedId = result.messages[0].toolCallId;
    expect(normalizedId).toBe(expectedNormalized(originalId));
    expect(normalizedId).toMatch(/^tc_[0-9a-f]{16}$/);
    expect(normalizedId).toMatch(ANTHROPIC_ID_PATTERN);
    expect(result.idMap.get(originalId)).toBe(normalizedId);
  });

  it('T3: 超长 ID（450 字符）替换且归一化后 ≤64 字符', () => {
    const originalId = 'x'.repeat(450);

    const result = normalizeToolCallIds([makeToolResult(originalId)], 'anthropic');

    const normalizedId = result.messages[0].toolCallId;
    expect(normalizedId).toBe(expectedNormalized(originalId));
    expect(normalizedId?.length).toBeLessThanOrEqual(64);
    expect(normalizedId).toMatch(ANTHROPIC_ID_PATTERN);
  });

  it('T4: assistant.toolCalls 与 tool 角色 toolCallId 同步替换，配对不断裂', () => {
    const originalId = 'call|pair-001';
    const messages: LLMMessage[] = [
      makeAssistantWithToolCall(originalId),
      makeToolResult(originalId),
    ];

    const result = normalizeToolCallIds(messages, 'anthropic');

    const assistantToolCallId = result.messages[0].toolCalls?.[0]?.id;
    const toolResultId = result.messages[1].toolCallId;
    expect(assistantToolCallId).toBe(expectedNormalized(originalId));
    expect(toolResultId).toBe(assistantToolCallId);
    expect(result.idMap.size).toBe(1);
  });

  it('T4b: 未变更消息保持原引用（调用方可用 === 做 diff）', () => {
    const untouched = makeToolResult('call_ok');
    const toChange = makeToolResult('call|bad');

    const result = normalizeToolCallIds([untouched, toChange], 'anthropic');

    expect(result.changed).toBe(true);
    expect(result.messages[0]).toBe(untouched);
    expect(result.messages[1]).not.toBe(toChange);
    expect(result.messages[1].content).toBe('sunny'); // 其余字段透传
  });

  it('T5: 同一 originalId 多次出现映射一致；跨调用结果确定（sha256 与时序无关）', () => {
    const originalId = 'call|repeat';
    const first = normalizeToolCallIds(
      [makeAssistantWithToolCall(originalId), makeToolResult(originalId), makeToolResult(originalId)],
      'anthropic',
    );

    const ids = new Set([
      first.messages[0].toolCalls?.[0]?.id,
      first.messages[1].toolCallId,
      first.messages[2].toolCallId,
    ]);
    expect(ids.size).toBe(1);
    expect(first.idMap.size).toBe(1);

    const second = normalizeToolCallIds([makeToolResult(originalId)], 'anthropic');
    expect(second.messages[0].toolCallId).toBe(expectedNormalized(originalId));
  });

  it('T5b: 不同 originalId 归一化结果不同（无意外碰撞）', () => {
    const result = normalizeToolCallIds(
      [makeToolResult('call|a'), makeToolResult('call|b')],
      'anthropic',
    );

    expect(result.messages[0].toolCallId).not.toBe(result.messages[1].toolCallId);
    expect(result.idMap.size).toBe(2);
  });

  it('T6: 幂等——对已归一化列表二次调用 changed=false 且原引用', () => {
    const first = normalizeToolCallIds(
      [makeAssistantWithToolCall('call|once'), makeToolResult('call|once')],
      'anthropic',
    );
    expect(first.changed).toBe(true);

    const second = normalizeToolCallIds(first.messages, 'anthropic');

    expect(second.changed).toBe(false);
    expect(second.idMap.size).toBe(0);
    expect(second.messages).toBe(first.messages);
  });
});

describe('normalizeToolCallIds target=openai / 边界（T7-T8）', () => {
  it('T7: openai 仅约束长度——特殊字符保留，超长替换', () => {
    const specialCharId = 'call|with-special.chars';
    const compliant = normalizeToolCallIds([makeToolResult(specialCharId)], 'openai');
    expect(compliant.changed).toBe(false);
    expect(compliant.messages[0].toolCallId).toBe(specialCharId);

    const overlongId = 'y'.repeat(100);
    const overlong = normalizeToolCallIds([makeToolResult(overlongId)], 'openai');
    expect(overlong.changed).toBe(true);
    expect(overlong.messages[0].toolCallId?.length).toBeLessThanOrEqual(64);
  });

  it('T8: 空列表/无 toolCalls 消息原样返回', () => {
    const empty: LLMMessage[] = [];
    const emptyResult = normalizeToolCallIds(empty, 'anthropic');
    expect(emptyResult.changed).toBe(false);
    expect(emptyResult.messages).toBe(empty);

    const plain: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const plainResult = normalizeToolCallIds(plain, 'anthropic');
    expect(plainResult.changed).toBe(false);
    expect(plainResult.messages).toBe(plain);
  });

  it('T8b: toolCalls 空数组视为无 toolCall，不触发变更', () => {
    const messages: LLMMessage[] = [{ role: 'assistant', content: '', toolCalls: [] }];

    const result = normalizeToolCallIds(messages, 'anthropic');

    expect(result.changed).toBe(false);
    expect(result.messages).toBe(messages);
  });
});
