import { describe, expect, it } from 'vitest';
import type { PromptContext } from '../types.js';
import type { ToolRegistryPort, ToolMethodDefinition } from '../tool-set.js';
import { ToolSet } from '../tool-set.js';

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

function createMockRegistry(
  toolsData: Array<{
    type: string;
    name: string;
    methods: Array<{ name: string; description: string; summary?: string; isWrite: boolean; parameters: Record<string, unknown> }>;
  }>,
  permissionsData?: Record<string, { readAllowed: boolean; writeAllowed: boolean }>
): ToolRegistryPort {
  return {
    getAvailableTools: (_agentType: string, _allowedToolTypes?: string[]) => toolsData,
    getPermission: (_agentType: string, toolType: string) => permissionsData?.[toolType],
  };
}

describe('ToolSet.filterVisibleMethods', () => {
  it('returns empty map when no tools available', () => {
    const registry = createMockRegistry([]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.filterVisibleMethods('agent', { tools: [] }, []);
    expect(result.size).toBe(0);
  });

  it('includes read methods by default', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: {} },
          { name: 'get_location', description: '获取位置', isWrite: false, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.filterVisibleMethods('agent', { tools: [] }, []);
    expect(result.get('map_service')!.methods.length).toBe(2);
    expect(result.get('map_service')!.methods[0].name).toBe('get_map');
    expect(result.get('map_service')!.methods[1].name).toBe('get_location');
  });

  it('excludes write methods for tools not in writableTools', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: {} },
          { name: 'create_location', description: '创建位置', isWrite: true, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.filterVisibleMethods('agent', { tools: [] }, []);
    const methods = result.get('map_service')!.methods;
    expect(methods.length).toBe(1);
    expect(methods[0].name).toBe('get_map');
  });

  it('includes write methods for tools in writableTools', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: {} },
          { name: 'create_location', description: '创建位置', isWrite: true, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.filterVisibleMethods('agent', { tools: ['map_service'] }, []);
    const methods = result.get('map_service')!.methods;
    expect(methods.length).toBe(2);
  });

  it('excludes methods in excludedMethods list', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: {} },
          { name: 'get_location', description: '获取位置', isWrite: false, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.filterVisibleMethods('agent', { tools: [] }, [
      { source: 'map_service', method: 'get_map' },
    ]);
    const methods = result.get('map_service')!.methods;
    expect(methods.length).toBe(1);
    expect(methods[0].name).toBe('get_location');
  });

  it('filters by both writableTools and excludedMethods', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: {} },
          { name: 'get_location', description: '获取位置', isWrite: false, parameters: {} },
          { name: 'create_location', description: '创建位置', isWrite: true, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.filterVisibleMethods('agent', { tools: ['map_service'] }, [
      { source: 'map_service', method: 'get_map' },
    ]);
    const methods = result.get('map_service')!.methods;
    expect(methods.length).toBe(2);
    expect(methods.map((m: ToolMethodDefinition) => m.name)).toEqual(['get_location', 'create_location']);
  });
});

describe('ToolSet.build', () => {
  it('returns empty apiTools and allowedFunctionNames when no visible methods', () => {
    const registry = createMockRegistry([]);
    const toolSet = new ToolSet(registry);
    const ctx = makeCtx();
    const result = toolSet.build(ctx);
    expect(result.apiTools).toEqual([]);
    expect(result.allowedFunctionNames.size).toBe(0);
    expect(result.visibleMethods.size).toBe(0);
  });

  it('builds apiTools with correct function names (toolType__methodName)', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: { type: 'object', properties: { id: { type: 'string' } } } },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const ctx = makeCtx({ agentConfig: { tools: [] } });
    const result = toolSet.build(ctx);
    expect(result.apiTools.length).toBe(1);
    expect(result.apiTools[0].function.name).toBe('map_service__get_map');
    expect(result.apiTools[0].function.description).toBe('获取地图');
  });

  it('builds allowedFunctionNames matching apiTools', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: {} },
          { name: 'get_location', description: '获取位置', isWrite: false, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const ctx = makeCtx({ agentConfig: { tools: [] } });
    const result = toolSet.build(ctx);
    expect(result.allowedFunctionNames.has('map_service__get_map')).toBe(true);
    expect(result.allowedFunctionNames.has('map_service__get_location')).toBe(true);
    expect(result.allowedFunctionNames.size).toBe(2);
  });

  it('returns visibleMethods from filterVisibleMethods', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_map', description: '获取地图', isWrite: false, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const ctx = makeCtx({ agentConfig: { tools: [] } });
    const result = toolSet.build(ctx);
    expect(result.visibleMethods.has('map_service')).toBe(true);
    expect(result.visibleMethods.get('map_service')!.methods.length).toBe(1);
  });

  it('maxVisibleTools 应按工具数而不是方法数裁剪，同一工具的多个方法应一起保留', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          {
            name: 'get_current_top_location',
            description: '获取当前位置',
            summary: '查询玩家当前位置',
            isWrite: false,
            parameters: {},
          },
          {
            name: 'move_to',
            description: '移动到目标地点',
            summary: '查询并执行地点移动',
            isWrite: true,
            parameters: {},
          },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.build(makeCtx({
      agentConfig: {
        tools: ['map_service'],
        toolBudget: {
          maxVisibleTools: 1,
          maxVisibleHelpDocs: 2,
        },
      },
    }));

    expect(result.toolExposureTrace?.visibleTools).toEqual([
      expect.objectContaining({
        functionName: 'map_service__get_current_top_location',
      }),
      expect.objectContaining({
        functionName: 'map_service__move_to',
      }),
    ]);
    expect(result.toolExposureTrace?.deferredTools).toEqual([]);
    expect(result.toolExposureTrace?.budget.usedVisibleTools).toBe(1);
    expect(result.allowedFunctionNames).toEqual(new Set([
      'map_service__get_current_top_location',
      'map_service__move_to',
    ]));
    expect(result.apiTools).toHaveLength(2);
  });

  it('maxVisibleHelpDocs 应裁剪非基础设施方法的模型可见面', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_current_top_location', description: '获取当前位置', summary: '查询玩家当前位置', isWrite: false, parameters: {} },
          { name: 'move_to', description: '移动到目标地点', summary: '查询并执行地点移动', isWrite: true, parameters: {} },
        ],
      },
      {
        type: 'help_service',
        name: '帮助服务',
        methods: [
          { name: 'get_tool_help_detail', description: '获取工具帮助', summary: '按需加载工具帮助', isWrite: false, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.build(makeCtx({
      agentConfig: {
        tools: ['map_service'],
        toolBudget: {
          maxVisibleTools: 1,
          maxVisibleHelpDocs: 1,
        },
      },
    }));

    expect(result.allowedFunctionNames).toEqual(new Set([
      'map_service__get_current_top_location',
      'help_service__get_tool_help_detail',
    ]));
    expect(result.apiTools.map((entry) => entry.function.name)).toEqual([
      'map_service__get_current_top_location',
      'help_service__get_tool_help_detail',
    ]);
    expect(result.toolExposureTrace?.visibleTools).toEqual([
      expect.objectContaining({ functionName: 'map_service__get_current_top_location' }),
      expect.objectContaining({ functionName: 'help_service__get_tool_help_detail' }),
    ]);
    expect(result.toolExposureTrace?.visibleHelpSummaries).toEqual([
      { tool: 'map_service', method: 'get_current_top_location' },
    ]);
    expect(result.toolExposureTrace?.deferredTools).toEqual([
      expect.objectContaining({ functionName: 'map_service__move_to' }),
    ]);
    expect(result.toolExposureTrace?.trimmedReasons).toContain('maxVisibleHelpDocs exceeded');
    expect(result.toolExposureTrace?.budget.usedVisibleTools).toBe(1);
  });

  it('maxVisibleHelpDocs=0 应把非基础设施方法全部延迟，usedVisibleTools 不高估', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'get_current_top_location', description: '获取当前位置', summary: '查询玩家当前位置', isWrite: false, parameters: {} },
          { name: 'move_to', description: '移动到目标地点', summary: '查询并执行地点移动', isWrite: true, parameters: {} },
        ],
      },
      {
        type: 'inventory_service',
        name: '背包服务',
        methods: [
          { name: 'list_inventory', description: '列出背包', summary: '查询玩家背包', isWrite: false, parameters: {} },
        ],
      },
      {
        type: 'help_service',
        name: '帮助服务',
        methods: [
          { name: 'get_tool_help_detail', description: '获取工具帮助', summary: '按需加载工具帮助', isWrite: false, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.build(makeCtx({
      agentConfig: {
        tools: ['map_service', 'inventory_service'],
        toolBudget: {
          maxVisibleTools: 2,
          maxVisibleHelpDocs: 0,
        },
      },
    }));

    expect(result.allowedFunctionNames).toEqual(new Set([
      'help_service__get_tool_help_detail',
    ]));
    expect(result.toolExposureTrace?.budget.usedVisibleTools).toBe(0);
    expect(result.toolExposureTrace?.deferredTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ functionName: 'map_service__get_current_top_location' }),
        expect.objectContaining({ functionName: 'map_service__move_to' }),
        expect.objectContaining({ functionName: 'inventory_service__list_inventory' }),
      ]),
    );
    expect(result.toolExposureTrace?.trimmedReasons).toContain('maxVisibleHelpDocs exceeded');
  });

  it('延迟发现基础设施工具不应被 maxVisibleTools 预算裁掉', () => {
    const registry = createMockRegistry([
      {
        type: 'map_service',
        name: '地图服务',
        methods: [
          { name: 'move_to', description: '移动到目标地点', summary: '执行地点移动', isWrite: true, parameters: {} },
        ],
      },
      {
        type: 'help_service',
        name: '帮助服务',
        methods: [
          { name: 'get_tool_help_detail', description: '获取工具帮助', summary: '按需加载工具帮助', isWrite: false, parameters: {} },
        ],
      },
      {
        type: 'skill_loader',
        name: '技能加载器',
        methods: [
          { name: 'load_skill', description: '加载技能', summary: '按需加载技能全文', isWrite: false, parameters: {} },
        ],
      },
      {
        type: 'inventory_service',
        name: '背包服务',
        methods: [
          { name: 'list_inventory', description: '列出背包', summary: '查询玩家背包', isWrite: false, parameters: {} },
        ],
      },
    ]);
    const toolSet = new ToolSet(registry);
    const result = toolSet.build(makeCtx({
      agentConfig: {
        tools: ['map_service'],
        toolBudget: {
          maxVisibleTools: 1,
          maxVisibleHelpDocs: 1,
        },
      },
    }));

    expect(result.allowedFunctionNames).toEqual(new Set([
      'map_service__move_to',
      'help_service__get_tool_help_detail',
      'skill_loader__load_skill',
    ]));
    expect(result.toolExposureTrace?.budget.usedVisibleTools).toBe(1);
    expect(result.toolExposureTrace?.visibleTools).toEqual([
      expect.objectContaining({ functionName: 'map_service__move_to' }),
      expect.objectContaining({ functionName: 'help_service__get_tool_help_detail' }),
      expect.objectContaining({ functionName: 'skill_loader__load_skill' }),
    ]);
    expect(result.toolExposureTrace?.deferredTools).toEqual([
      expect.objectContaining({ functionName: 'inventory_service__list_inventory' }),
    ]);
  });
});