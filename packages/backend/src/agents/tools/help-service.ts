import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import type { HelpRegistry } from '../../services/help-registry.js';
import { consumeOnDemandLoad } from '../runtime/tool-exposure-budget.js';
import { ToolRegistry } from '../ToolRegistry.js';

function hasInjectedMethod(
  injectedMethods: ToolContext['injectedMethods'],
  toolType: string,
  method: string,
  requiredLevel: 'summary' | 'detail' = 'detail',
): boolean {
  return injectedMethods?.some(
    (entry) =>
      entry.source === toolType
      && entry.method === method
      && (entry.level ?? 'detail') === requiredLevel,
  ) ?? false;
}

function markInjectedMethod(
  injectedMethods: ToolContext['injectedMethods'],
  toolType: string,
  method: string,
  level: 'summary' | 'detail',
): void {
  if (!injectedMethods) {
    return;
  }
  const existing = injectedMethods.find(
    (entry) => entry.source === toolType && entry.method === method,
  );
  if (existing) {
    if ((existing.level ?? 'detail') === 'detail' || existing.level === level) {
      return;
    }
    existing.level = 'detail';
    return;
  }
  injectedMethods.push({ source: toolType, method, level });
}

function canAccessHelp(context: ToolContext, toolType: string, method: string): boolean {
  return ToolRegistry.getInstance().checkPermission(
    context.agentType,
    toolType as ToolType,
    method,
  );
}

/**
 * HelpServiceTool — 工具帮助文档服务
 *
 * 提供 get_tool_help 方法，Agent按需获取ServiceTool方法的详细用法。
 * 首次使用工具方法前应先调用此服务了解完整用法、参数格式和注意事项。
 *
 * 三条注入路径协同：
 * 路径1（技能预注入）→ 路径2（autoLoadOnFirstUse）→ 路径3（主动调用get_tool_help）
 * 已注入的方法通过请求级 injectedMethods 统一追踪，防止同一请求内重复注入。
 */
export class HelpServiceTool extends BaseTool {
  private helpRegistry: HelpRegistry | null = null;

  constructor() {
    super(
      'help_service' as ToolType,
      'Help Service',
      '工具帮助文档服务 - 获取ServiceTool方法的详细用法、参数格式和注意事项',
      '1.0.0',
    );
    this.registerMethods();
  }

  setHelpRegistry(registry: HelpRegistry): void {
    this.helpRegistry = registry;
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'search_tool_capability',
      description: '按场景搜索可用工具能力，返回工具和方法摘要列表。',
      cacheable: false,
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: '场景描述或操作目标',
        },
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              matches: { type: 'array', description: '匹配的工具方法摘要列表' },
              hint: { type: 'string', description: '无匹配时的提示信息' },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: this.handleSearchToolCapability.bind(this),
    });

    this.registerMethod({
      name: 'get_tool_help_summary',
      description: '获取工具方法的摘要帮助，不返回完整正文。',
      cacheable: false,
      parameters: {
        toolType: {
          type: 'string',
          required: true,
          description: 'ServiceTool类型名，如"combat_service"、"map_service"',
        },
        method: {
          type: 'string',
          required: true,
          description: '方法名，如"execute_turn"、"move_to"',
        },
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              helpSummary: { type: 'string', description: '工具方法摘要帮助' },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: this.handleGetToolHelpSummary.bind(this),
    });

    this.registerMethod({
      name: 'get_tool_help_detail',
      description: '获取工具方法的完整帮助正文。',
      cacheable: false,
      parameters: {
        toolType: {
          type: 'string',
          required: true,
          description: 'ServiceTool类型名，如"combat_service"、"map_service"',
        },
        method: {
          type: 'string',
          required: true,
          description: '方法名，如"execute_turn"、"move_to"',
        },
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              help: { type: 'string', description: '完整帮助文档正文' },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: this.handleGetToolHelpDetail.bind(this),
    });

    this.registerMethod({
      name: 'get_tool_help',
      description: '获取工具方法的详细帮助文档。首次使用工具前应先调用此方法了解完整用法、参数格式和注意事项。',
      cacheable: false,
      parameters: {
        toolType: {
          type: 'string',
          required: true,
          description: 'ServiceTool类型名，如"combat_service"、"map_service"',
        },
        method: {
          type: 'string',
          required: true,
          description: '方法名，如"execute_turn"、"move_to"',
        },
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              help: { type: 'string', description: '完整帮助文档正文' },
            },
          },
          error: { type: 'string' },
        },
        required: ['success'],
      },
      handler: this.handleGetToolHelpDetail.bind(this),
    });
  }

  private async handleSearchToolCapability(
    params: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResponse> {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    if (!query) {
      return {
        success: false,
        error: 'query is a required parameter',
      };
    }

    if (!this.helpRegistry) {
      return {
        success: false,
        error: 'HelpRegistry not initialized',
      };
    }

    const allMatches = this.helpRegistry
      .searchCapabilities(query)
      .filter((entry) => canAccessHelp(_context, entry.tool, entry.method));

    return {
      success: true,
      data: {
        matches: allMatches,
        hint: allMatches.length === 0
          ? `未找到匹配的工具。只能使用当前上下文中列出的工具（${_context.agentType} 的可用工具已在系统提示的 tools 段中列出）。如果需要的操作不在可用工具中，请告知 GameMaster 需要其委派的任务。`
          : undefined,
      },
    };
  }

  private async handleGetToolHelpSummary(
    params: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResponse> {
    const { toolType, method } = params;

    if (!toolType || !method) {
      return {
        success: false,
        error: 'toolType and method are required parameters',
      };
    }

    if (!this.helpRegistry) {
      return {
        success: false,
        error: 'HelpRegistry not initialized',
      };
    }

    if (!canAccessHelp(_context, toolType as string, method as string)) {
      return {
        success: false,
        error: `Permission denied: ${_context.agentType} cannot access help for ${toolType}.${method}`,
      };
    }

    const helpSummary = this.helpRegistry.getHelpSummaryByMethod(
      toolType as string,
      method as string,
    );

    if (!helpSummary) {
      return {
        success: false,
        error: `No help summary available for ${toolType}.${method}`,
      };
    }

    return {
      success: true,
      data: { helpSummary },
    };
  }

  private async handleGetToolHelpDetail(
    params: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResponse> {
    const { toolType, method } = params;

    if (!toolType || !method) {
      return {
        success: false,
        error: 'toolType and method are required parameters',
      };
    }

    if (!this.helpRegistry) {
      return {
        success: false,
        error: 'HelpRegistry not initialized',
      };
    }

    if (!canAccessHelp(_context, toolType as string, method as string)) {
      return {
        success: false,
        error: `Permission denied: ${_context.agentType} cannot access help for ${toolType}.${method}`,
      };
    }

    // 路径3拦截：已通过路径1/2注入的帮助不再重复返回
    if (hasInjectedMethod(_context.injectedMethods, toolType as string, method as string, 'detail')) {
      return {
        success: true,
        data: { help: `此工具方法的帮助文档已在上下文中预加载，无需重复获取。` },
      };
    }

    const originalUsedOnDemandLoads = _context.toolExposureState?.usedOnDemandLoads;
    const budgetResult = consumeOnDemandLoad(_context.toolExposureState);
    if (!budgetResult.success) {
      return {
        success: false,
        error: budgetResult.error,
      };
    }

    const content = await this.helpRegistry.getHelp(
      toolType as string,
      method as string,
    );

    if (!content) {
      if (_context.toolExposureState && originalUsedOnDemandLoads !== undefined) {
        _context.toolExposureState.usedOnDemandLoads = originalUsedOnDemandLoads;
      }
      return {
        success: false,
        error: `No help available for ${toolType}.${method}`,
      };
    }

    const formatted = this.helpRegistry.formatHelpForPrompt(
      content,
      toolType as string,
      method as string,
    );

    markInjectedMethod(_context.injectedMethods, toolType as string, method as string, 'detail');
    _context.syncToolExposureState?.(_context.toolExposureState!);

    return {
      success: true,
      data: { help: formatted },
    };
  }
}
