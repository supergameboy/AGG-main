import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TemplateLoader } from '../template-loader.js';
import { BaseTemplateLayer } from '../layers/base-template-layer.js';
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

describe('TemplateLoader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tl-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads a file that exists', async () => {
    await writeFile(join(tempDir, 'hello.md'), 'hello world');
    const loader = new TemplateLoader(tempDir);
    const content = await loader.load('hello.md');
    expect(content).toBe('hello world');
  });

  it('caches loaded file (second call returns same underlying promise)', async () => {
    await writeFile(join(tempDir, 'cached.md'), 'cached content');
    const loader = new TemplateLoader(tempDir);
    const first = await loader.load('cached.md');
    const second = await loader.load('cached.md');
    expect(first).toBe(second);
    expect(first).toBe('cached content');
  });

  it('throws when loading a file that does not exist', async () => {
    const loader = new TemplateLoader(tempDir);
    await expect(loader.load('nonexistent.md')).rejects.toThrow();
  });

  it('loadIfExists returns null for non-existent file', async () => {
    const loader = new TemplateLoader(tempDir);
    const result = await loader.loadIfExists('nonexistent.md');
    expect(result).toBeNull();
  });

  it('loadIfExists returns content for existing file', async () => {
    await writeFile(join(tempDir, 'exists.md'), 'exists content');
    const loader = new TemplateLoader(tempDir);
    const result = await loader.loadIfExists('exists.md');
    expect(result).toBe('exists content');
  });

  it('clearCache clears the cache', async () => {
    await writeFile(join(tempDir, 'clear.md'), 'v1');
    const loader = new TemplateLoader(tempDir);
    await loader.load('clear.md');
    loader.clearCache();
    await writeFile(join(tempDir, 'clear.md'), 'v2');
    const content = await loader.load('clear.md');
    expect(content).toBe('v2');
  });
});

function createMockTemplateLoader() {
  const files = new Map<string, string>();
  return {
    files,
    load: async (filename: string) => {
      const content = files.get(filename);
      if (content === undefined) throw new Error(`File not found: ${filename}`);
      return content;
    },
    loadIfExists: async (filename: string) => {
      return files.get(filename) ?? null;
    },
  };
}

type MockTemplateLoader = ReturnType<typeof createMockTemplateLoader>;

describe('BaseTemplateLayer', () => {
  let mockLoader: MockTemplateLoader;

  beforeEach(() => {
    mockLoader = createMockTemplateLoader();
  });

  it('has correct name and order', () => {
    const layer = new BaseTemplateLayer(mockLoader as unknown as TemplateLoader);
    expect(layer.name).toBe('base');
    expect(layer.order).toBe(10);
  });

  it('loads template file based on agentKey', async () => {
    mockLoader.files.set('coordinator.md', 'coordinator prompt');
    const layer = new BaseTemplateLayer(mockLoader as unknown as TemplateLoader);
    const ctx = makeCtx({ agentKey: 'coordinator' });
    const result = await layer.build(ctx);
    expect(result.content).toBe('coordinator prompt');
    expect(result.metadata).toEqual({ templateFile: 'coordinator.md' });
  });

  it('delegates to TemplateLoader.load with correct filename', async () => {
    mockLoader.files.set('dialogue.md', 'dialogue prompt');
    const layer = new BaseTemplateLayer(mockLoader as unknown as TemplateLoader);
    const ctx = makeCtx({ agentKey: 'dialogue' });
    const result = await layer.build(ctx);
    expect(mockLoader.files.has('dialogue.md')).toBe(true);
    expect(result.metadata).toEqual({ templateFile: 'dialogue.md' });
  });
});