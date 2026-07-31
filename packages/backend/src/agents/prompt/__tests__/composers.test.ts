import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PromptContext, PromptLayer, PromptBlock, LayerBuildOutput, BlockBuildOutput } from '../types.js';
import type { ToolRegistryPort } from '../tool-set.js';
import { SystemPromptComposer } from '../system-prompt-composer.js';
import { UserPromptComposer } from '../user-prompt-composer.js';
import { PromptModule } from '../index.js';
import type { IRulesEngine, ISkillRegistry } from '@ai-rpg/shared/types/prompt';

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

function makeLayer(overrides: Partial<PromptLayer> = {}): PromptLayer {
  return {
    name: overrides.name ?? 'mock-layer',
    order: overrides.order ?? 0,
    build: overrides.build ?? (() => Promise.resolve({ content: 'mock-content', metadata: {} } as LayerBuildOutput)),
  };
}

function makeBlock(overrides: Partial<PromptBlock> = {}): PromptBlock {
  return {
    name: overrides.name ?? 'mock-block',
    build: overrides.build ?? (() => Promise.resolve({ content: 'mock-content', fields: [] } as BlockBuildOutput)),
  };
}

describe('SystemPromptComposer', () => {
  it('sorts layers by order before building', async () => {
    const composer = new SystemPromptComposer();
    const layer3 = makeLayer({ name: 'third', order: 30, build: () => Promise.resolve({ content: 'C', metadata: {} }) });
    const layer1 = makeLayer({ name: 'first', order: 10, build: () => Promise.resolve({ content: 'A', metadata: {} }) });
    const layer2 = makeLayer({ name: 'second', order: 20, build: () => Promise.resolve({ content: 'B', metadata: {} }) });

    composer.addLayer(layer3).addLayer(layer1).addLayer(layer2);
    const result = await composer.build(makeCtx());
    expect(result.content).toBe('A\n\nB\n\nC');
  });

  it('concatenates layer outputs with double newlines', async () => {
    const composer = new SystemPromptComposer();
    composer
      .addLayer(makeLayer({ name: 'a', order: 10, build: () => Promise.resolve({ content: 'alpha', metadata: {} }) }))
      .addLayer(makeLayer({ name: 'b', order: 20, build: () => Promise.resolve({ content: 'beta', metadata: {} }) }));
    const result = await composer.build(makeCtx());
    expect(result.content).toBe('alpha\n\nbeta');
  });

  it('skips layers that return null', async () => {
    const composer = new SystemPromptComposer();
    composer
      .addLayer(makeLayer({ name: 'a', order: 10, build: () => Promise.resolve({ content: 'alpha', metadata: {} }) }))
      .addLayer(makeLayer({ name: 'b', order: 20, build: () => Promise.resolve({ content: null, metadata: {} }) }))
      .addLayer(makeLayer({ name: 'c', order: 30, build: () => Promise.resolve({ content: 'gamma', metadata: {} }) }));
    const result = await composer.build(makeCtx());
    expect(result.content).toBe('alpha\n\ngamma');
  });

  it('addLayer returns this for chaining', () => {
    const composer = new SystemPromptComposer();
    const layer = makeLayer();
    const returned = composer.addLayer(layer);
    expect(returned).toBe(composer);
  });

  it('removeLayer removes layer by name', async () => {
    const composer = new SystemPromptComposer();
    composer
      .addLayer(makeLayer({ name: 'keep', order: 10, build: () => Promise.resolve({ content: 'kept', metadata: {} }) }))
      .addLayer(makeLayer({ name: 'remove', order: 20, build: () => Promise.resolve({ content: 'removed', metadata: {} }) }));
    composer.removeLayer('remove');
    const result = await composer.build(makeCtx());
    expect(result.content).toBe('kept');
  });

  it('re-sorts after addLayer (dirty flag)', async () => {
    const composer = new SystemPromptComposer();
    composer
      .addLayer(makeLayer({ name: 'a', order: 20, build: () => Promise.resolve({ content: 'second', metadata: {} }) }));

    await composer.build(makeCtx());

    composer.addLayer(makeLayer({ name: 'b', order: 10, build: () => Promise.resolve({ content: 'first', metadata: {} }) }));
    const result = await composer.build(makeCtx());
    expect(result.content).toBe('first\n\nsecond');
  });

  it('handles empty layers list (returns empty content)', async () => {
    const composer = new SystemPromptComposer();
    const result = await composer.build(makeCtx());
    expect(result.content).toBe('');
  });

  it('returns layer trace data with names and token counts', async () => {
    const composer = new SystemPromptComposer();
    composer
      .addLayer(makeLayer({ name: 'a', order: 10, build: () => Promise.resolve({ content: 'alpha', metadata: { key: 'val' } }) }))
      .addLayer(makeLayer({ name: 'b', order: 20, build: () => Promise.resolve({ content: null, metadata: {} }) }))
      .addLayer(makeLayer({ name: 'c', order: 30, build: () => Promise.resolve({ content: 'gamma', metadata: {} }) }));
    const result = await composer.build(makeCtx());
    expect(result.layers).toHaveLength(3);
    expect(result.layers[0].name).toBe('a');
    expect(result.layers[0].content).toBe('alpha');
    expect(result.layers[0].tokenCount).toBeGreaterThan(0);
    expect(result.layers[0].metadata).toEqual({ key: 'val' });
    expect(result.layers[1].name).toBe('b');
    expect(result.layers[1].content).toBeNull();
    expect(result.layers[1].tokenCount).toBe(0);
    expect(result.layers[2].name).toBe('c');
    expect(result.totalTokens).toBeGreaterThan(0);
  });
});

describe('UserPromptComposer', () => {
  it('prepends action type when action is present and not unknown', async () => {
    const composer = new UserPromptComposer();
    composer.addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: 'block-content', fields: [] }) }));
    const ctx = makeCtx({ message: { payload: { action: 'explore' } } });
    const result = await composer.build(ctx);
    expect(result.content).toContain('[玩家操作: explore]');
    expect(result.content).toContain('block-content');
  });

  it('does not prepend action type when action is unknown', async () => {
    const composer = new UserPromptComposer();
    composer.addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: 'block-content', fields: [] }) }));
    const ctx = makeCtx({ message: { payload: { action: 'unknown' } } });
    const result = await composer.build(ctx);
    expect(result.content).not.toContain('[玩家操作:');
    expect(result.content).toContain('block-content');
  });

  it('does not prepend action type when action is undefined', async () => {
    const composer = new UserPromptComposer();
    composer.addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: 'block-content', fields: [] }) }));
    const ctx = makeCtx({ message: { payload: { action: undefined } } });
    const result = await composer.build(ctx);
    expect(result.content).not.toContain('[玩家操作:');
    expect(result.content).toContain('block-content');
  });

  it('does not prepend action type when payload is undefined', async () => {
    const composer = new UserPromptComposer();
    composer.addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: 'block-content', fields: [] }) }));
    const ctx = makeCtx({ message: {} });
    const result = await composer.build(ctx);
    expect(result.content).not.toContain('[操作类型:');
    expect(result.content).toContain('block-content');
  });

  it('concatenates block outputs with single newlines', async () => {
    const composer = new UserPromptComposer();
    composer
      .addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: 'block-1', fields: [] }) }))
      .addBlock(makeBlock({ name: 'b2', build: () => Promise.resolve({ content: 'block-2', fields: [] }) }));
    const ctx = makeCtx({ message: {} });
    const result = await composer.build(ctx);
    expect(result.content).toBe('block-1\nblock-2');
  });

  it('skips blocks that return null', async () => {
    const composer = new UserPromptComposer();
    composer
      .addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: 'block-1', fields: [] }) }))
      .addBlock(makeBlock({ name: 'b2', build: () => Promise.resolve({ content: null, fields: [] }) }))
      .addBlock(makeBlock({ name: 'b3', build: () => Promise.resolve({ content: 'block-3', fields: [] }) }));
    const ctx = makeCtx({ message: {} });
    const result = await composer.build(ctx);
    expect(result.content).toBe('block-1\nblock-3');
  });

  it('returns fallback format when no blocks produce content and no action', async () => {
    const composer = new UserPromptComposer();
    composer.addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: null, fields: [] }) }));
    const ctx = makeCtx({ message: { payload: { data: { key: 'value' } } } });
    const result = await composer.build(ctx);
    expect(result.content).toBe('Action: unknown\nData: {"key":"value"}');
  });

  it('addBlock returns this for chaining', () => {
    const composer = new UserPromptComposer();
    const block = makeBlock();
    const returned = composer.addBlock(block);
    expect(returned).toBe(composer);
  });

  it('removeBlock removes block by name', async () => {
    const composer = new UserPromptComposer();
    composer
      .addBlock(makeBlock({ name: 'keep', build: () => Promise.resolve({ content: 'kept', fields: [] }) }))
      .addBlock(makeBlock({ name: 'remove', build: () => Promise.resolve({ content: 'removed', fields: [] }) }));
    composer.removeBlock('remove');
    const ctx = makeCtx({ message: {} });
    const result = await composer.build(ctx);
    expect(result.content).toBe('kept');
  });

  it('returns block trace data with names and content', async () => {
    const composer = new UserPromptComposer();
    composer
      .addBlock(makeBlock({ name: 'b1', build: () => Promise.resolve({ content: 'block-1', fields: [] }) }))
      .addBlock(makeBlock({ name: 'b2', build: () => Promise.resolve({ content: null, fields: [] }) }));
    const ctx = makeCtx({ message: { payload: { action: 'chat', intentHint: 'dialogue' } } });
    const result = await composer.build(ctx);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].name).toBe('b1');
    expect(result.blocks[0].content).toBe('block-1');
    expect(result.blocks[1].name).toBe('b2');
    expect(result.blocks[1].content).toBeNull();
    expect(result.action).toBe('chat');
    expect(result.intentHint).toBe('dialogue');
    expect(result.totalTokens).toBeGreaterThan(0);
  });
});

describe('PromptModule', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pm-test-'));
    await writeFile(join(tempDir, 'test-agent.md'), 'base prompt content');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeMockToolRegistry(): ToolRegistryPort {
    return {
      getAvailableTools: () => [],
      getPermission: () => undefined,
    };
  }

  function makeMockRulesEngine(): IRulesEngine {
    return {
      loadAllRules: vi.fn().mockResolvedValue(undefined),
      getAlwaysApplyRules: vi.fn().mockReturnValue([]),
      getHookedRules: vi.fn().mockReturnValue([]),
      getAllRulesForAgent: vi.fn().mockReturnValue([]),
      formatRulesForPrompt: vi.fn().mockReturnValue(''),
      getRuleByName: vi.fn().mockReturnValue(undefined),
      reloadRule: vi.fn().mockResolvedValue(undefined),
      reloadAll: vi.fn().mockResolvedValue(undefined),
      ruleCount: 0,
      ruleNames: [],
    };
  }

  function makeMockSkillRegistry(): ISkillRegistry {
    return {
      loadAllSkills: vi.fn().mockResolvedValue(undefined),
      getSkillListForAgent: vi.fn().mockReturnValue([]),
      getSkillsByIntent: vi.fn().mockReturnValue([]),
      loadSkillContent: vi.fn().mockResolvedValue(null),
      formatSkillListForPrompt: vi.fn().mockReturnValue(''),
      getSkillByName: vi.fn().mockReturnValue(undefined),
      reloadSkill: vi.fn().mockResolvedValue(undefined),
      reloadAll: vi.fn().mockResolvedValue(undefined),
      skillCount: 0,
      skillNames: [],
    };
  }

  it('builds system prompt from all layers', async () => {
    const module = new PromptModule({ toolRegistry: makeMockToolRegistry(), promptsDir: tempDir, rulesEngine: makeMockRulesEngine(), skillRegistry: makeMockSkillRegistry() });
    const ctx = makeCtx({ agentKey: 'test-agent' });
    const result = await module.build(ctx);
    expect(result.systemPrompt).toContain('base prompt content');
  });

  it('builds user prompt from all blocks', async () => {
    const module = new PromptModule({ toolRegistry: makeMockToolRegistry(), promptsDir: tempDir, rulesEngine: makeMockRulesEngine(), skillRegistry: makeMockSkillRegistry() });
    const ctx = makeCtx({
      agentKey: 'test-agent',
      message: { payload: { action: 'explore', data: { target: 'forest' } } },
    });
    const result = await module.build(ctx);
    expect(result.userPrompt).toContain('[玩家操作: explore]');
  });

  it('builds apiTools from ToolSet', async () => {
    const module = new PromptModule({ toolRegistry: makeMockToolRegistry(), promptsDir: tempDir, rulesEngine: makeMockRulesEngine(), skillRegistry: makeMockSkillRegistry() });
    const ctx = makeCtx({ agentKey: 'test-agent' });
    const result = await module.build(ctx);
    expect(result.apiTools).toEqual([]);
    expect(result.allowedFunctionNames).toBeInstanceOf(Set);
  });

  it('visible tools 被预算裁成 0 时不应回退成伪造的 toolVisibilityTrace', async () => {
    const module = new PromptModule({
      toolRegistry: {
        getAvailableTools: () => [
          {
            type: 'map_service',
            name: '地图服务',
            methods: [
              {
                name: 'get_current_top_location',
                description: '获取当前位置',
                isWrite: false,
                parameters: {},
              },
            ],
          },
        ],
        getPermission: () => ({ readAllowed: true, writeAllowed: false }),
      },
      promptsDir: tempDir,
      rulesEngine: makeMockRulesEngine(),
      skillRegistry: makeMockSkillRegistry(),
    });
    const ctx = makeCtx({
      agentKey: 'test-agent',
      agentConfig: {
        tools: [],
        toolBudget: {
          maxVisibleTools: 0,
        },
      },
    });

    const result = await module.build(ctx);

    expect(result.apiTools).toEqual([]);
    expect([...result.allowedFunctionNames]).toEqual([]);
    expect(result.toolExposureTrace?.visibleTools).toEqual([]);
    expect(result.toolVisibilityTrace).toEqual([]);
  });

  it('exposes systemLayers and userBlocks getters', () => {
    const module = new PromptModule({ toolRegistry: makeMockToolRegistry(), promptsDir: tempDir, rulesEngine: makeMockRulesEngine(), skillRegistry: makeMockSkillRegistry() });
    expect(module.systemLayers).toBeInstanceOf(SystemPromptComposer);
    expect(module.userBlocks).toBeInstanceOf(UserPromptComposer);
  });

  it('constructor creates default layer chain', () => {
    const module = new PromptModule({ toolRegistry: makeMockToolRegistry(), promptsDir: tempDir, rulesEngine: makeMockRulesEngine(), skillRegistry: makeMockSkillRegistry() });
    const composer = module.systemLayers;
    const result = (composer as any).layers as PromptLayer[];
    const names = result.map((l: PromptLayer) => l.name);
    expect(names).toEqual(['base', 'rules', 'equipment_slots', 'skills', 'episodic_memory', 'procedural_memory', 'template', 'language', 'entity-graph', 'information-boundary', 'npc-drive']);
  });

  it('constructor creates default block chain (task, context)', () => {
    const module = new PromptModule({ toolRegistry: makeMockToolRegistry(), promptsDir: tempDir, rulesEngine: makeMockRulesEngine(), skillRegistry: makeMockSkillRegistry() });
    const composer = module.userBlocks;
    const result = (composer as any).blocks as PromptBlock[];
    const names = result.map((b: PromptBlock) => b.name);
    expect(names).toEqual(['task', 'context']);
  });
});