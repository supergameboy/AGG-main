/**
 * H 层单测：Provider pi 6 级思考级别映射（v1.2 D5.3）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M5-prepareNextTurn.md §2.1 映射表
 *
 * 覆盖：
 * - OpenAICompatibleProvider：off→none 直通映射；per-request off 覆盖静态 thinking.enabled
 *   （isThinkingMode=false → 无 extra_body.thinking + temperature 恢复传递）；
 * - AnthropicCompatibleProvider：minimal→low 坍缩、xhigh 直通；off→thinking disabled；
 *   历史消息含 thinking blocks 时 off 降级 low + warn（API 校验强制 enabled）。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LLMConfig, LLMResponse } from '../../types.js';
import type { LLMMessage } from '@ai-rpg/shared';

// Mock logger（A2 断言 warn）；vi.hoisted 保证在 vi.mock 工厂执行前初始化
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// 模块级 logger 单例已在加载时评估过，必须 resetModules + 动态导入重新评估
let OpenAICompatibleProvider: typeof import('../OpenAICompatibleProvider.js').OpenAICompatibleProvider;
let AnthropicCompatibleProvider: typeof import('../AnthropicCompatibleProvider.js').AnthropicCompatibleProvider;

beforeEach(async () => {
  vi.resetModules();
  ({ OpenAICompatibleProvider } = await import('../OpenAICompatibleProvider.js'));
  ({ AnthropicCompatibleProvider } = await import('../AnthropicCompatibleProvider.js'));
  mockWarn.mockClear();
});

// ─── 夹具 ───

const MESSAGES: LLMMessage[] = [{ role: 'user', content: 'hi' }];

function openaiConfig(thinking?: LLMConfig['thinking']): LLMConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-5.1',
    temperature: 0.7,
    thinking,
  };
}

function anthropicConfig(thinking?: LLMConfig['thinking']): LLMConfig {
  return {
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    model: 'claude-opus-5',
    thinking,
  };
}

/** mock OpenAI SDK client，返回捕获 requestParams 的 create 函数 */
function stubOpenAIClient(provider: InstanceType<typeof OpenAICompatibleProvider>) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  (provider as unknown as { client: unknown }).client = {
    chat: { completions: { create } },
  };
  return create;
}

/** mock Anthropic fetchRequest，返回捕获 body 的函数 */
function stubAnthropicFetch(provider: InstanceType<typeof AnthropicCompatibleProvider>) {
  const fetchRequest = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: 'end_turn',
  });
  (provider as unknown as { fetchRequest: unknown }).fetchRequest = fetchRequest;
  return fetchRequest;
}

function requestParams(create: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  return create.mock.calls[n][0] as Record<string, unknown>;
}

// ─── OpenAI：6 级直通 + off 语义 ───

describe('OpenAICompatibleProvider pi 6 级映射', () => {
  it('O1: per-request off 覆盖静态 enabled → reasoning_effort=none，无 extra_body.thinking，temperature 恢复传递', async () => {
    const provider = new OpenAICompatibleProvider(openaiConfig({ enabled: true, effort: 'high' }));
    const create = stubOpenAIClient(provider);

    await provider.chat(MESSAGES, { reasoningEffort: 'off', temperature: 0.3 });

    const params = requestParams(create);
    expect(params.reasoning_effort).toBe('none');
    expect(params.extra_body).toBeUndefined();
    expect(params.temperature).toBe(0.3);
  });

  it('O2: minimal 直通 → reasoning_effort=minimal（不再坍缩）', async () => {
    const provider = new OpenAICompatibleProvider(openaiConfig());
    const create = stubOpenAIClient(provider);

    await provider.chat(MESSAGES, { reasoningEffort: 'minimal' });

    expect(requestParams(create).reasoning_effort).toBe('minimal');
  });

  it('O3: xhigh 直通 → reasoning_effort=xhigh', async () => {
    const provider = new OpenAICompatibleProvider(openaiConfig());
    const create = stubOpenAIClient(provider);

    await provider.chat(MESSAGES, { reasoningEffort: 'xhigh' });

    expect(requestParams(create).reasoning_effort).toBe('xhigh');
  });

  it('O4: 未传且静态无 effort → 无 reasoning_effort 字段（模型默认值决定）', async () => {
    const provider = new OpenAICompatibleProvider(openaiConfig());
    const create = stubOpenAIClient(provider);

    await provider.chat(MESSAGES);

    expect('reasoning_effort' in requestParams(create)).toBe(false);
  });

  it('O5: 静态 thinking.effort=medium + options 未传 → reasoning_effort=medium（静态配置兜底）', async () => {
    const provider = new OpenAICompatibleProvider(openaiConfig({ enabled: true, effort: 'medium' }));
    const create = stubOpenAIClient(provider);

    await provider.chat(MESSAGES);

    expect(requestParams(create).reasoning_effort).toBe('medium');
  });

  it('O6: 静态 enabled + per-request high → extra_body.thinking=enabled 且 thinking 模式不传递 temperature', async () => {
    const provider = new OpenAICompatibleProvider(openaiConfig({ enabled: true, effort: 'medium' }));
    const create = stubOpenAIClient(provider);

    await provider.chat(MESSAGES, { reasoningEffort: 'high', temperature: 0.3 });

    const params = requestParams(create);
    expect(params.reasoning_effort).toBe('high');
    expect(params.extra_body).toEqual({ thinking: { type: 'enabled' } });
    expect(params.temperature).toBeUndefined();
  });
});

// ─── Anthropic：坍缩映射 + off 降级 ───

describe('AnthropicCompatibleProvider pi 6 级映射', () => {
  it('A1: off 且历史无 thinking blocks → thinking=disabled，无 output_config', async () => {
    const provider = new AnthropicCompatibleProvider(anthropicConfig({ enabled: true, effort: 'high' }));
    const fetchRequest = stubAnthropicFetch(provider);

    await provider.chat(MESSAGES, { reasoningEffort: 'off' });

    const body = requestParams(fetchRequest);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config).toBeUndefined();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('A2: off 但历史含 thinking blocks → 降级 enabled + effort=low + warn（API 校验强制）', async () => {
    const provider = new AnthropicCompatibleProvider(anthropicConfig({ enabled: true, effort: 'high' }));
    const fetchRequest = stubAnthropicFetch(provider);
    const historyWithThinking: LLMMessage[] = [
      { role: 'assistant', content: 'prev', reasoningContent: 'thought...' },
      { role: 'user', content: 'next' },
    ];

    await provider.chat(historyWithThinking, { reasoningEffort: 'off' });

    const body = requestParams(fetchRequest);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('reasoningEffort=off 降级为 low'),
    );
  });

  it('A3: minimal → output_config.effort=low（Anthropic 无 minimal 档，坍缩）', async () => {
    const provider = new AnthropicCompatibleProvider(anthropicConfig({ enabled: true }));
    const fetchRequest = stubAnthropicFetch(provider);

    await provider.chat(MESSAGES, { reasoningEffort: 'minimal' });

    const body = requestParams(fetchRequest);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  it('A4: xhigh 直通 → output_config.effort=xhigh', async () => {
    const provider = new AnthropicCompatibleProvider(anthropicConfig({ enabled: true }));
    const fetchRequest = stubAnthropicFetch(provider);

    await provider.chat(MESSAGES, { reasoningEffort: 'xhigh' });

    expect(requestParams(fetchRequest).output_config).toEqual({ effort: 'xhigh' });
  });

  it('A5: 静态 enabled + options 未传 → output_config.effort=静态值 high', async () => {
    const provider = new AnthropicCompatibleProvider(anthropicConfig({ enabled: true, effort: 'high' }));
    const fetchRequest = stubAnthropicFetch(provider);

    await provider.chat(MESSAGES);

    expect(requestParams(fetchRequest).output_config).toEqual({ effort: 'high' });
  });

  it('A6: 静态未启用 + options 未传 → thinking=disabled（防 V4 默认返回 thinking blocks）', async () => {
    const provider = new AnthropicCompatibleProvider(anthropicConfig());
    const fetchRequest = stubAnthropicFetch(provider);

    const result: LLMResponse = await provider.chat(MESSAGES);

    expect(requestParams(fetchRequest).thinking).toEqual({ type: 'disabled' });
    expect(result.content).toBe('ok');
  });
});
