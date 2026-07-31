import { describe, expect, it } from 'vitest';
import { TaskBlock } from '../blocks/task-block.js';
import { ContextBlock } from '../blocks/context-block.js';
import type { PromptContext, FieldMapping } from '../types.js';

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

function makeField(
  overrides: Partial<FieldMapping> = {},
): FieldMapping {
  return {
    key: 'testKey',
    label: 'TestLabel',
    extract: () => 'test-value',
    format: (v: unknown) => String(v),
    ...overrides,
  };
}

describe('TaskBlock', () => {
  it('has correct name task', () => {
    const block = new TaskBlock();
    expect(block.name).toBe('task');
  });

  it('returns null content when no fields are registered', async () => {
    const block = new TaskBlock();
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBeNull();
    expect(result.fields).toEqual([]);
  });

  it('returns null content when all field extractors return null', async () => {
    const block = new TaskBlock();
    block.addField(makeField({ extract: () => null }));
    block.addField(makeField({ extract: () => null }));
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBeNull();
    expect(result.fields).toHaveLength(2);
    expect(result.fields.every(f => !f.present)).toBe(true);
  });

  it('formats single field as [label]: value', async () => {
    const block = new TaskBlock();
    block.addField(
      makeField({
        key: 'action',
        label: 'Action',
        extract: () => 'explore',
        format: (v: unknown) => String(v),
      }),
    );
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBe('[Action]: explore');
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toEqual({ key: 'action', label: 'Action', present: true, content: 'explore' });
  });

  it('formats multiple fields separated by newlines', async () => {
    const block = new TaskBlock();
    block.addField(
      makeField({
        key: 'action',
        label: 'Action',
        extract: () => 'explore',
        format: (v: unknown) => String(v),
      }),
    );
    block.addField(
      makeField({
        key: 'target',
        label: 'Target',
        extract: () => 'forest',
        format: (v: unknown) => String(v),
      }),
    );
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBe('[Action]: explore\n[Target]: forest');
    expect(result.fields).toHaveLength(2);
  });

  it('skips fields where extract returns null', async () => {
    const block = new TaskBlock();
    block.addField(
      makeField({
        key: 'action',
        label: 'Action',
        extract: () => 'explore',
        format: (v: unknown) => String(v),
      }),
    );
    block.addField(
      makeField({
        key: 'skipped',
        label: 'Skipped',
        extract: () => null,
        format: (v: unknown) => String(v),
      }),
    );
    block.addField(
      makeField({
        key: 'target',
        label: 'Target',
        extract: () => 'forest',
        format: (v: unknown) => String(v),
      }),
    );
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBe('[Action]: explore\n[Target]: forest');
    expect(result.fields[1].present).toBe(false);
    expect(result.fields[1].content).toBeNull();
  });

  it('skips fields where extract returns undefined', async () => {
    const block = new TaskBlock();
    block.addField(
      makeField({
        key: 'action',
        label: 'Action',
        extract: () => 'explore',
        format: (v: unknown) => String(v),
      }),
    );
    block.addField(
      makeField({
        key: 'skipped',
        label: 'Skipped',
        extract: () => undefined,
        format: (v: unknown) => String(v),
      }),
    );
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBe('[Action]: explore');
    expect(result.fields[1].present).toBe(false);
  });

  it('addField returns this for chaining', () => {
    const block = new TaskBlock();
    const returned = block.addField(makeField());
    expect(returned).toBe(block);
  });
});

describe('ContextBlock', () => {
  it('has correct name context', () => {
    const block = new ContextBlock();
    expect(block.name).toBe('context');
  });

  it('returns null content when no fields are registered', async () => {
    const block = new ContextBlock();
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBeNull();
    expect(result.fields).toEqual([]);
  });

  it('returns null content when all field extractors return null', async () => {
    const block = new ContextBlock();
    block.addField(makeField({ extract: () => null }));
    block.addField(makeField({ extract: () => null }));
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBeNull();
    expect(result.fields).toHaveLength(2);
    expect(result.fields.every(f => !f.present)).toBe(true);
  });

  it('formats single field as [label]\\nvalue', async () => {
    const block = new ContextBlock();
    block.addField(
      makeField({
        key: 'world',
        label: 'World',
        extract: () => 'A dark fantasy realm',
        format: (v: unknown) => String(v),
      }),
    );
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBe('[World]\nA dark fantasy realm');
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toEqual({ key: 'world', label: 'World', present: true, content: 'A dark fantasy realm' });
  });

  it('formats multiple fields separated by newlines', async () => {
    const block = new ContextBlock();
    block.addField(
      makeField({
        key: 'world',
        label: 'World',
        extract: () => 'A dark fantasy realm',
        format: (v: unknown) => String(v),
      }),
    );
    block.addField(
      makeField({
        key: 'quest',
        label: 'Quest',
        extract: () => 'Defeat the dragon',
        format: (v: unknown) => String(v),
      }),
    );
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBe('[World]\nA dark fantasy realm\n[Quest]\nDefeat the dragon');
    expect(result.fields).toHaveLength(2);
  });

  it('skips fields where extract returns null', async () => {
    const block = new ContextBlock();
    block.addField(
      makeField({
        key: 'world',
        label: 'World',
        extract: () => 'A dark fantasy realm',
        format: (v: unknown) => String(v),
      }),
    );
    block.addField(
      makeField({
        key: 'skipped',
        label: 'Skipped',
        extract: () => null,
        format: (v: unknown) => String(v),
      }),
    );
    block.addField(
      makeField({
        key: 'quest',
        label: 'Quest',
        extract: () => 'Defeat the dragon',
        format: (v: unknown) => String(v),
      }),
    );
    const ctx = makeCtx();
    const result = await block.build(ctx);
    expect(result.content).toBe('[World]\nA dark fantasy realm\n[Quest]\nDefeat the dragon');
    expect(result.fields[1].present).toBe(false);
    expect(result.fields[1].content).toBeNull();
  });

  it('addField returns this for chaining', () => {
    const block = new ContextBlock();
    const returned = block.addField(makeField());
    expect(returned).toBe(block);
  });
});