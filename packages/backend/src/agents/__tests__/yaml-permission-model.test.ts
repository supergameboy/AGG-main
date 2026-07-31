import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../ToolRegistry.js';
import { YamlAgentFactory } from '../config/YamlAgentFactory.js';
import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolResponse } from '@ai-rpg/shared/types/tool';
import type { ToolType } from '../../../../shared/src/types/agent.js';
import { ToolSet } from '../prompt/tool-set.js';
import { RequestScope } from '../../services/RequestScope.js';
import type { Knex } from 'knex';

class TestPermissionTool extends BaseTool {
  constructor(type: ToolType) {
    super(type, 'Test Permission Tool', 'for permission tests');
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

describe('YAML 单文件权限模型', () => {
  beforeEach(() => {
    ToolRegistry.getInstance().clearAll();
  });

  it('应仅根据 profile.agents.*.tools 派生写权限，读权限默认放行', async () => {
    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.register(new TestPermissionTool('npc_service' as ToolType));
    toolRegistry.register(new TestPermissionTool('dialogue_service' as ToolType));

    const configLoader = {
      getProfile: vi.fn().mockReturnValue({
        name: 'fantasy_rpg',
        description: 'test',
        game_mode: 'turn_based_rpg',
        agents: {
          output: {
            name: 'OutputAgent',
            description: 'output',
            system_prompt_file: './prompts/output.md',
            tools: ['dialogue_service'],
            capabilities: {
              supported_intents: ['chat'],
              required_fields: ['saveId'],
              optional_fields: [],
            },
          },
        },
      }),
    } as any;

    const factory = new YamlAgentFactory({
      configLoader,
      llmService: {} as any,
      llmMetricsService: {} as any,
      db: {} as any,
      promptModule: {} as any,
      writeQueue: {} as any,
      helpRegistry: {} as any,
      contextInjector: {} as any,
      contextService: {} as any,
      entityGraphService: {} as any,
      // EG-M3-7: graphServiceCache 字段（YamlAgentFactory 现在要求）
      graphServiceCache: { get: () => null, set: () => {}, invalidate: () => {}, invalidateKey: () => {}, clear: () => {}, getStats: () => ({ size: 0, hitCount: 0, missCount: 0 }) } as any,
      npcServiceFactory: (() => Promise.resolve({} as never)) as any,
      decisionLogService: {} as any,
      templateService: {} as any,
      templatePoolService: {} as any,
      toolCaller: {} as any,
      flushQueue: {} as any,
      webSocketService: {} as any,
      devTraceHook: { emit: vi.fn() } as any,
      createTraceCollector: () => ({} as any),
      createResponsePool: () => ({} as any),
      createStagingPool: () => ({} as any),
      createShadowStateLayer: () => ({} as any),
      createRequestScope: () => new RequestScope({} as unknown as Knex),
      requestEventBridge: {} as any,
      bootstrapEventHandlers: {} as any,
    });

    await factory.setupPermissionsFromConfig('fantasy_rpg');

    expect(toolRegistry.checkPermission('output', 'dialogue_service' as ToolType, 'read_state')).toBe(true);
    expect(toolRegistry.checkPermission('output', 'dialogue_service' as ToolType, 'write_state')).toBe(true);

    expect(toolRegistry.checkPermission('output', 'npc_service' as ToolType, 'read_state')).toBe(true);
    expect(toolRegistry.checkPermission('output', 'npc_service' as ToolType, 'write_state')).toBe(false);
  });
});

describe('ToolSet 方法级工具暴露', () => {
  beforeEach(() => {
    ToolRegistry.getInstance().clearAll();
  });

  it('应向 LLM 暴露全部读方法，但只暴露 agent.tools 中声明的写方法', () => {
    const toolRegistry = ToolRegistry.getInstance();
    toolRegistry.register(new TestPermissionTool('npc_service' as ToolType));
    toolRegistry.register(new TestPermissionTool('dialogue_service' as ToolType));

    toolRegistry.setPermission({
      agentType: 'output',
      toolType: 'npc_service' as ToolType,
      readAllowed: true,
      writeAllowed: false,
    });
    toolRegistry.setPermission({
      agentType: 'output',
      toolType: 'dialogue_service' as ToolType,
      readAllowed: true,
      writeAllowed: true,
    });

    const mockRegistry = {
      getAvailableTools: (agentKey: string, allowedToolTypes?: string[]) =>
        toolRegistry.getAvailableTools(agentKey, allowedToolTypes),
      getPermission: (agentKey: string, toolType: ToolType) =>
        toolRegistry.getPermission(agentKey, toolType),
    };

    const toolSet = new ToolSet(mockRegistry);
    const result = toolSet.build({
      agentKey: 'output',
      agentConfig: { tools: ['dialogue_service'] },
      excludedMethods: [],
      language: null,
      message: {},
      templateContext: null,
      domain: {},
      options: {},
    });

    const names = result.apiTools.map((t: any) => t.function.name);

    expect(names).toContain('npc_service__read_state');
    expect(names).not.toContain('npc_service__write_state');
    expect(names).toContain('dialogue_service__read_state');
    expect(names).toContain('dialogue_service__write_state');
  });
});