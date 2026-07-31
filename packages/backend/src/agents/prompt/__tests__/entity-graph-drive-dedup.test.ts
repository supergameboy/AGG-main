import { describe, expect, it, vi } from 'vitest';
import { EntityGraphLayer } from '../layers/entity-graph-layer.js';
import type { PromptContext } from '../types.js';

function makeCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    agentKey: 'gamemaster',
    agentConfig: { tools: [], maxIterations: 5 },
    excludedMethods: [],
    language: null,
    message: {},
    templateContext: null,
    domain: {},
    options: {},
    ...overrides,
  };
}

describe('EntityGraphLayer — drive 注入去重', () => {
  it('NPC 节点不包含 <drive> 标签（驱动力由 DriveLayer 统一注入）', async () => {
    const layer = new EntityGraphLayer();

    const mockGraphService = {
      getFullGraph: vi.fn().mockResolvedValue({
        nodes: [
          { entityType: 'npc', label: '铁匠', id: 'egn_npc_save1_npc_1', entityId: 'npc_1', properties: { role: 'blacksmith' } },
        ],
        edges: [],
      }),
      getSubgraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    };

    const ctx = makeCtx({
      agentKey: 'gamemaster',
      domain: {
        saveId: 'save1',
        db: mockDb,
        graphService: mockGraphService,
        availableAgents: [],
        inCombat: false,
        targetNpcIds: ['npc_1'],
        sceneNPCs: [{ id: 'npc_1', name: '铁匠', role: 'blacksmith' }],
      },
    });

    const result = await layer.build(ctx);

    // EntityGraphLayer 不应再注入 <drive> 标签
    expect(result.content).not.toContain('<drive>');
    // NPC 节点应保留 isDialogueTarget 属性
    expect(result.content).toContain('isDialogueTarget');
  });

  it('非对话目标 NPC 也不包含 <drive> 标签', async () => {
    const layer = new EntityGraphLayer();

    const mockGraphService = {
      getFullGraph: vi.fn().mockResolvedValue({
        nodes: [
          { entityType: 'npc', label: '商人', id: 'egn_npc_save1_npc_2', entityId: 'npc_2', properties: { role: 'merchant' } },
        ],
        edges: [],
      }),
      getSubgraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    };

    const ctx = makeCtx({
      agentKey: 'gamemaster',
      domain: {
        saveId: 'save1',
        db: mockDb,
        graphService: mockGraphService,
        availableAgents: [],
        inCombat: false,
        targetNpcIds: [],
        sceneNPCs: [],
      },
    });

    const result = await layer.build(ctx);

    expect(result.content).not.toContain('<drive>');
    // 非对话目标 NPC 应是单行格式
    expect(result.content).toMatch(/<npc[^>]*\/>/);
  });

  it('output agent 路径也不包含 <drive> 标签', async () => {
    const layer = new EntityGraphLayer();

    const mockGraphService = {
      getEdges: vi.fn().mockResolvedValue([
        { fromNodeId: 'egn_npc_save1_npc_1', relation: 'LOCATED_AT', toNodeId: 'egn_location_save1_loc_1' },
      ]),
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    };

    const ctx = makeCtx({
      agentKey: 'output',
      domain: {
        saveId: 'save1',
        db: mockDb,
        graphService: mockGraphService,
        npcId: 'npc_1',
        availableAgents: [],
      },
    });

    const result = await layer.build(ctx);

    expect(result.content).not.toContain('<drive>');
  });
});