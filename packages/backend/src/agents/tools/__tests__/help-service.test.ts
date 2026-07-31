import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { HelpServiceTool } from '../help-service.js';
import { BaseTool, toolResultCache } from '@ai-rpg/shared/tool-core';
import { ToolRegistry } from '../../ToolRegistry.js';
import type { ToolType } from '../../../../../shared/src/types/agent.js';
import { RequestScope } from '../../../services/RequestScope.js';
import type { Knex } from 'knex';

class TestPermissionTool extends BaseTool {
  constructor(type: ToolType) {
    super(type, 'Test Permission Tool', 'for help permission tests');
    this.registerMethod({
      name: 'read_state',
      description: 'read method',
      parameters: {},
      isWrite: false,
      handler: async (): Promise<ToolResponse> => ({ success: true, data: { ok: true } }),
    });
    this.registerMethod({
      name: 'write_state',
      description: 'write method',
      parameters: {},
      isWrite: true,
      handler: async (): Promise<ToolResponse> => ({ success: true, data: { ok: true } }),
    });
  }
}

class TestMapHelpTool extends BaseTool {
  constructor(type: ToolType) {
    super(type, 'Test Map Help Tool', 'for move_to help tests');
    this.registerMethod({
      name: 'move_to',
      description: 'move method',
      parameters: {},
      isWrite: false,
      handler: async (): Promise<ToolResponse> => ({ success: true, data: { ok: true } }),
    });
  }
}

function createRegistry() {
  return {
    searchCapabilities: vi.fn().mockReturnValue([
      {
        tool: 'map_service',
        method: 'move_to',
        description: '移动到目标地点',
        summary: '查询并执行地点移动',
      },
    ]),
    getHelpSummaryByMethod: vi.fn().mockReturnValue({
      tool: 'map_service',
      method: 'move_to',
      description: '移动到目标地点',
      summary: '查询并执行地点移动',
      whenToUse: ['玩家明确表达移动意图时'],
      returnsSummary: '返回移动结果与目标地点摘要',
    }),
    getHelp: vi.fn().mockResolvedValue('完整帮助正文'),
    formatHelpForPrompt: vi
      .fn()
      .mockReturnValue('<tool_help tool="map_service" method="move_to">完整帮助正文</tool_help>'),
  };
}

function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    saveId: 'save-1' as ToolContext['saveId'],
    agentType: 'gamemaster',
    timestamp: Date.now() as ToolContext['timestamp'],
    requestScope: new RequestScope({} as unknown as Knex),
    ...overrides,
  };
}

function createTool(): HelpServiceTool {
  const tool = new HelpServiceTool();
  tool.setPermission({
    toolType: 'help_service',
    agentType: 'gamemaster',
    readAllowed: true,
    writeAllowed: false,
  });
  return tool;
}

describe('HelpServiceTool discovery methods', () => {
  beforeEach(() => {
    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.clearAll();
    toolResultCache.invalidateSave('save-1');
    toolRegistry.register(new TestMapHelpTool('map_service' as ToolType));
    toolRegistry.setPermission({
      toolType: 'map_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: false,
    });
  });

  it('search_tool_capability 应返回摘要命中列表', async () => {
    const tool = createTool();
    const registry = createRegistry();
    tool.setHelpRegistry(registry as never);

    const result = await tool.execute(
      'search_tool_capability',
      { query: '移动到村庄' },
      createToolContext(),
    );

    expect(result).toEqual({
      success: true,
      data: {
        matches: [
          expect.objectContaining({
            tool: 'map_service',
            method: 'move_to',
            summary: '查询并执行地点移动',
          }),
        ],
      },
    });
    expect(registry.searchCapabilities).toHaveBeenCalledWith('移动到村庄');
  });

  it('search_tool_capability 应过滤当前 Agent 无写权限的方法摘要', async () => {
    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.register(new TestPermissionTool('map_service' as ToolType));
    toolRegistry.register(new TestPermissionTool('dialogue_service' as ToolType));

    toolRegistry.setPermission({
      toolType: 'map_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: false,
    });
    toolRegistry.setPermission({
      toolType: 'dialogue_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });

    const tool = createTool();
    tool.setPermission({
      toolType: 'help_service',
      agentType: 'output',
      readAllowed: true,
      writeAllowed: false,
    });
    const registry = createRegistry();
    registry.searchCapabilities.mockReturnValue([
      {
        tool: 'map_service',
        method: 'read_state',
        description: '读取地图状态',
        summary: '地图只读摘要',
      },
      {
        tool: 'map_service',
        method: 'write_state',
        description: '修改地图状态',
        summary: '地图写入摘要',
      },
      {
        tool: 'dialogue_service',
        method: 'write_state',
        description: '提交对话',
        summary: '对话写入摘要',
      },
    ]);
    tool.setHelpRegistry(registry as never);

    const result = await tool.execute(
      'search_tool_capability',
      { query: '状态' },
      createToolContext(),
    );

    expect(result).toEqual({
      success: true,
      data: {
        matches: [
          expect.objectContaining({
            tool: 'map_service',
            method: 'read_state',
          }),
          expect.objectContaining({
            tool: 'dialogue_service',
            method: 'write_state',
          }),
        ],
      },
    });
  });

  it('search_tool_capability 不应复用其他 Agent 的权限缓存结果', async () => {
    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.register(new TestPermissionTool('map_service' as ToolType));

    toolRegistry.setPermission({
      toolType: 'map_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });
    toolRegistry.setPermission({
      toolType: 'map_service' as ToolType,
      agentType: 'output',
      readAllowed: true,
      writeAllowed: false,
    });

    const tool = createTool();
    tool.setPermission({
      toolType: 'help_service',
      agentType: 'output',
      readAllowed: true,
      writeAllowed: false,
    });
    const registry = createRegistry();
    registry.searchCapabilities.mockReturnValue([
      {
        tool: 'map_service',
        method: 'write_state',
        description: '修改地图状态',
        summary: '地图写入摘要',
      },
    ]);
    tool.setHelpRegistry(registry as never);

    const privilegedResult = await tool.execute(
      'search_tool_capability',
      { query: '状态' },
      createToolContext({ agentType: 'gamemaster' }),
    );
    const restrictedResult = await tool.execute(
      'search_tool_capability',
      { query: '状态' },
      createToolContext({ agentType: 'output' }),
    );

    expect(privilegedResult).toEqual({
      success: true,
      data: {
        matches: [
          expect.objectContaining({
            tool: 'map_service',
            method: 'write_state',
          }),
        ],
      },
    });
    expect(restrictedResult).toEqual({
      success: true,
      data: {
        matches: [],
        hint: expect.any(String),
      },
    });
  });

  it('get_tool_help_summary 应只返回摘要层', async () => {
    const tool = createTool();
    const registry = createRegistry();
    tool.setHelpRegistry(registry as never);

    const result = await tool.execute(
      'get_tool_help_summary',
      { toolType: 'map_service', method: 'move_to' },
      createToolContext(),
    );

    expect(result).toEqual({
      success: true,
      data: {
        helpSummary: expect.objectContaining({
          tool: 'map_service',
          method: 'move_to',
          whenToUse: ['玩家明确表达移动意图时'],
        }),
      },
    });
    expect(registry.getHelp).not.toHaveBeenCalled();
  });

  it('get_tool_help_summary 不应复用其他 Agent 的权限缓存结果', async () => {
    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.register(new TestPermissionTool('map_service' as ToolType));
    toolRegistry.setPermission({
      toolType: 'map_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });
    toolRegistry.setPermission({
      toolType: 'map_service' as ToolType,
      agentType: 'output',
      readAllowed: true,
      writeAllowed: false,
    });

    const tool = createTool();
    tool.setPermission({
      toolType: 'help_service',
      agentType: 'output',
      readAllowed: true,
      writeAllowed: false,
    });
    const registry = createRegistry();
    registry.getHelpSummaryByMethod.mockReturnValue({
      tool: 'map_service',
      method: 'write_state',
      description: '修改地图状态',
      summary: '地图写入摘要',
    });
    tool.setHelpRegistry(registry as never);

    const privilegedResult = await tool.execute(
      'get_tool_help_summary',
      { toolType: 'map_service', method: 'write_state' },
      createToolContext({ agentType: 'gamemaster' }),
    );
    const restrictedResult = await tool.execute(
      'get_tool_help_summary',
      { toolType: 'map_service', method: 'write_state' },
      createToolContext({ agentType: 'output' }),
    );

    expect(privilegedResult).toEqual({
      success: true,
      data: {
        helpSummary: expect.objectContaining({
          tool: 'map_service',
          method: 'write_state',
        }),
      },
    });
    expect(restrictedResult).toEqual({
      success: false,
      error: 'Permission denied: output cannot access help for map_service.write_state',
    });
  });

  it('get_tool_help_detail 应返回完整帮助正文并标记已注入', async () => {
    const tool = createTool();
    const registry = createRegistry();
    tool.setHelpRegistry(registry as never);
    const injectedMethods: NonNullable<ToolContext['injectedMethods']> = [];

    const result = await tool.execute(
      'get_tool_help_detail',
      { toolType: 'map_service', method: 'move_to' },
      createToolContext({ injectedMethods }),
    );

    expect(result).toEqual({
      success: true,
      data: {
        help: '<tool_help tool="map_service" method="move_to">完整帮助正文</tool_help>',
      },
    });
    expect(registry.getHelp).toHaveBeenCalledWith('map_service', 'move_to');
    expect(injectedMethods).toEqual([
      { source: 'map_service', method: 'move_to', level: 'detail' },
    ]);
  });

  it('get_tool_help_detail 对当前 Agent 无写权限的方法应拒绝返回正文', async () => {
    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.register(new TestPermissionTool('map_service' as ToolType));
    toolRegistry.setPermission({
      toolType: 'map_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: false,
    });

    const tool = createTool();
    const registry = createRegistry();
    tool.setHelpRegistry(registry as never);

    const result = await tool.execute(
      'get_tool_help_detail',
      { toolType: 'map_service', method: 'write_state' },
      createToolContext(),
    );

    expect(result).toEqual({
      success: false,
      error: 'Permission denied: gamemaster cannot access help for map_service.write_state',
    });
    expect(registry.getHelp).not.toHaveBeenCalled();
  });

  it('get_tool_help_detail 超过按需加载预算时应返回失败且不再读取正文', async () => {
    const tool = createTool();
    const registry = createRegistry();
    tool.setHelpRegistry(registry as never);

    const result = await tool.execute(
      'get_tool_help_detail',
      { toolType: 'map_service', method: 'move_to' },
      createToolContext({
        toolExposureState: {
          maxOnDemandLoadsPerTurn: 1,
          usedOnDemandLoads: 1,
        },
      }),
    );

    expect(result).toEqual({
      success: false,
      error: 'On-demand help load budget exceeded for this turn',
    });
    expect(registry.getHelp).not.toHaveBeenCalled();
  });

  it('get_tool_help_detail 的已注入状态应限制在当前请求，不应污染后续请求', async () => {
    const tool = createTool();
    const registry = createRegistry();
    tool.setHelpRegistry(registry as never);
    const firstInjectedMethods: NonNullable<ToolContext['injectedMethods']> = [];
    const secondInjectedMethods: NonNullable<ToolContext['injectedMethods']> = [];

    const firstResult = await tool.execute(
      'get_tool_help_detail',
      { toolType: 'map_service', method: 'move_to' },
      createToolContext({ injectedMethods: firstInjectedMethods }),
    );
    const secondResult = await tool.execute(
      'get_tool_help_detail',
      { toolType: 'map_service', method: 'move_to' },
      createToolContext({ injectedMethods: secondInjectedMethods }),
    );

    expect(firstResult).toEqual({
      success: true,
      data: {
        help: '<tool_help tool="map_service" method="move_to">完整帮助正文</tool_help>',
      },
    });
    expect(secondResult).toEqual({
      success: true,
      data: {
        help: '<tool_help tool="map_service" method="move_to">完整帮助正文</tool_help>',
      },
    });
    expect(registry.getHelp).toHaveBeenCalledTimes(2);
    expect(firstInjectedMethods).toEqual([
      { source: 'map_service', method: 'move_to', level: 'detail' },
    ]);
    expect(secondInjectedMethods).toEqual([
      { source: 'map_service', method: 'move_to', level: 'detail' },
    ]);
  });

  it('get_tool_help_detail 遇到摘要级注入时仍应允许补充完整帮助正文', async () => {
    const tool = createTool();
    const registry = createRegistry();
    tool.setHelpRegistry(registry as never);

    const result = await tool.execute(
      'get_tool_help_detail',
      { toolType: 'map_service', method: 'move_to' },
      createToolContext({
        injectedMethods: [
          { source: 'map_service', method: 'move_to', level: 'summary' } as never,
        ],
      }),
    );

    expect(result).toEqual({
      success: true,
      data: {
        help: '<tool_help tool="map_service" method="move_to">完整帮助正文</tool_help>',
      },
    });
    expect(registry.getHelp).toHaveBeenCalledWith('map_service', 'move_to');
  });

  it('get_tool_help_detail 找不到帮助正文时不应扣减按需加载预算', async () => {
    const tool = createTool();
    const registry = createRegistry();
    registry.getHelp.mockResolvedValue(null);
    tool.setHelpRegistry(registry as never);
    const syncToolExposureState = vi.fn();
    const toolExposureState = {
      maxOnDemandLoadsPerTurn: 1,
      usedOnDemandLoads: 0,
    };

    const result = await tool.execute(
      'get_tool_help_detail',
      { toolType: 'map_service', method: 'move_to' },
      createToolContext({
        toolExposureState,
        syncToolExposureState,
      }),
    );

    expect(result).toEqual({
      success: false,
      error: 'No help available for map_service.move_to',
    });
    expect(toolExposureState.usedOnDemandLoads).toBe(0);
    expect(syncToolExposureState).not.toHaveBeenCalled();
  });
});
