import { describe, expect, it } from 'vitest';
import { LanguageLayer } from '../layers/language-layer.js';
import { TemplateContextLayer } from '../layers/template-context-layer.js';
import type { PromptContext } from '../types.js';

function makeCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    agentKey: 'test-agent',
    agentConfig: { tools: [], maxIterations: 5, ...overrides.agentConfig },
    excludedMethods: [],
    language: null,
    message: {},
    templateContext: null,
    domain: {},
    options: {},
    ...overrides,
  };
}

describe('LanguageLayer', () => {
  it('returns null content when language is null', async () => {
    const layer = new LanguageLayer();
    const ctx = makeCtx({ language: null });
    const result = await layer.build(ctx);
    expect(result.content).toBeNull();
    expect(result.metadata).toEqual({ language: null });
  });

  it('returns null content when language is undefined', async () => {
    const layer = new LanguageLayer();
    const ctx = makeCtx({ language: undefined as unknown as string | null });
    const result = await layer.build(ctx);
    expect(result.content).toBeNull();
    expect(result.metadata).toEqual({ language: null });
  });

  it('generates language instruction for zh-CN', async () => {
    const layer = new LanguageLayer();
    const ctx = makeCtx({ language: 'zh-CN' });
    const result = await layer.build(ctx);
    expect(result.content).toContain('## 语言要求');
    expect(result.content).toContain('zh-CN');
    expect(result.content).toContain('中文');
    expect(result.metadata).toEqual({ language: 'zh-CN' });
  });

  it('generates language instruction for en-US', async () => {
    const layer = new LanguageLayer();
    const ctx = makeCtx({ language: 'en-US' });
    const result = await layer.build(ctx);
    expect(result.content).toContain('## 语言要求');
    expect(result.content).toContain('en-US');
    expect(result.content).toContain('English');
    expect(result.metadata).toEqual({ language: 'en-US' });
  });

  it('uses raw language code as name for unknown codes', async () => {
    const layer = new LanguageLayer();
    const ctx = makeCtx({ language: 'xx-YY' });
    const result = await layer.build(ctx);
    expect(result.content).toContain('xx-YY');
    expect(result.content).toContain('xx-YY（xx-YY）');
    expect(result.metadata).toEqual({ language: 'xx-YY' });
  });

  it('has correct name and order', () => {
    const layer = new LanguageLayer();
    expect(layer.name).toBe('language');
    expect(layer.order).toBe(40);
  });
});

describe('TemplateContextLayer', () => {
  it('returns null content when templateContext is null', async () => {
    const layer = new TemplateContextLayer();
    const ctx = makeCtx({ templateContext: null });
    const result = await layer.build(ctx);
    expect(result.content).toBeNull();
    expect(result.metadata).toEqual({ templateId: null });
  });

  it('returns null content when templateContext is undefined', async () => {
    const layer = new TemplateContextLayer();
    const ctx = makeCtx({ templateContext: undefined as unknown as string | null });
    const result = await layer.build(ctx);
    expect(result.content).toBeNull();
    expect(result.metadata).toEqual({ templateId: null });
  });

  it('generates world setting section with templateContext', async () => {
    const layer = new TemplateContextLayer();
    const ctx = makeCtx({ templateContext: '这是一个中世纪奇幻世界' });
    const result = await layer.build(ctx);
    expect(result.content).toContain('## 世界设定');
    expect(result.content).toContain('这是一个中世纪奇幻世界');
    expect(result.metadata).toEqual({ templateId: null });
  });

  it('includes templateId in metadata when provided', async () => {
    const layer = new TemplateContextLayer();
    const ctx = makeCtx({ templateContext: '世界设定', templateId: 'medieval-fantasy' });
    const result = await layer.build(ctx);
    expect(result.metadata).toEqual({ templateId: 'medieval-fantasy' });
  });

  it('has correct name and order', () => {
    const layer = new TemplateContextLayer();
    expect(layer.name).toBe('template');
    expect(layer.order).toBe(25);
  });
});