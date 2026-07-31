import { ToolType } from '../../../shared/src/types/agent';
import type { ToolContext, ToolResponse, ToolDefinition, ToolPermission, BatchConfig } from '@ai-rpg/shared/types/tool';
import { BaseTool, toolResultCache } from '@ai-rpg/shared/tool-core';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('tool-registry');

class ToolRegistry {
  private static instance: ToolRegistry | null = null;
  private tools: Map<string, BaseTool> = new Map();
  private permissions: Map<string, ToolPermission[]> = new Map();

  private constructor() {
    logger.info('ToolRegistry initialized');
  }

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  register(tool: BaseTool): void {
    if (this.tools.has(tool.type)) {
      logger.warn(`Tool already registered: ${tool.type}, replacing...`);
      this.unregister(tool.type);
    }

    this.tools.set(tool.type, tool);
    logger.info(`Tool registered: ${tool.type} - ${tool.name} (v${tool.version})`);
  }

  unregister(toolType: string): void {
    const tool = this.tools.get(toolType);
    if (tool) {
      this.tools.delete(toolType);
      logger.info(`Tool unregistered: ${toolType}`);
    }
  }

  getTool(type: ToolType): BaseTool | undefined {
    return this.tools.get(type);
  }

  async execute(
    agentType: string,
    toolType: ToolType,
    method: string,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResponse> {
    const tool = this.tools.get(toolType);

    if (!tool) {
      logger.error(`Tool not found: ${toolType}`, { agentType });
      return {
        success: false,
        error: `Tool ${toolType} not found`
      };
    }

    const hasPermission = this.checkPermission(agentType, toolType, method);
    if (!hasPermission) {
      logger.warn(`Permission denied for tool execution`, {
        agentType,
        toolType,
        method
      });
      return {
        success: false,
        error: `Permission denied: ${agentType} cannot execute ${method} on ${toolType}`
      };
    }

    return tool.execute(method, params, context);
  }

  checkPermission(agentType: string, toolType: ToolType, methodName: string): boolean {
    const tool = this.tools.get(toolType);
    if (!tool) {
      return false;
    }

    const registryPermissions = this.permissions.get(agentType);
    if (!registryPermissions || registryPermissions.length === 0) {
      return false;
    }

    const permission = registryPermissions.find(p => p.toolType === toolType);
    if (!permission) {
      return false;
    }

    const method = tool.getMethods().find(m => m === methodName);
    const isWriteMethod = method ? tool.getDefinition().methods.find(m => m.name === methodName)?.isWrite : false;

    return isWriteMethod ? permission.writeAllowed : permission.readAllowed;
  }

  setPermission(permission: ToolPermission): void {
    const existingPermissions = this.permissions.get(permission.agentType) || [];
    
    const index = existingPermissions.findIndex(p => p.toolType === permission.toolType);
    if (index >= 0) {
      existingPermissions[index] = permission;
    } else {
      existingPermissions.push(permission);
    }

    this.permissions.set(permission.agentType, existingPermissions);

    const tool = this.tools.get(permission.toolType);
    if (tool) {
      tool.setPermission(permission);
    }

    logger.debug(`Permission updated for agent: ${permission.agentType}`, {
      toolType: permission.toolType,
      readAllowed: permission.readAllowed,
      writeAllowed: permission.writeAllowed
    });
  }

  removePermission(agentType: string, toolType?: ToolType): void {
    if (toolType) {
      const permissions = this.permissions.get(agentType);
      if (permissions) {
        const filtered = permissions.filter(p => p.toolType !== toolType);
        this.permissions.set(agentType, filtered);

        const tool = this.tools.get(toolType);
        if (tool) {
          tool.removePermission(agentType);
        }
      }
      logger.debug(`Removed permission for agent: ${agentType} on tool: ${toolType}`);
    } else {
      this.permissions.delete(agentType);

      for (const tool of this.tools.values()) {
        tool.removePermission(agentType);
      }
      logger.debug(`Removed all permissions for agent: ${agentType}`);
    }
  }

  getAvailableTools(agentType: string, allowedToolTypes?: string[]): Array<{
    type: string;
    name: string;
    methods: Array<{
      name: string;
      description: string;
      summary?: string;
      isWrite: boolean;
      parameters: Record<string, unknown>;
      batch?: BatchConfig;
      returns?: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
      };
    }>;
  }> {
    const availableTools: Array<{
      type: string;
      name: string;
      methods: Array<{
        name: string;
        description: string;
        summary?: string;
        isWrite: boolean;
        parameters: Record<string, unknown>;
        batch?: BatchConfig;
        returns?: {
          type: 'object';
          properties: Record<string, unknown>;
          required?: string[];
        };
      }>;
    }> = [];

    for (const [toolType, tool] of this.tools) {
      if (allowedToolTypes && !allowedToolTypes.includes(toolType)) continue;
      const hasAnyPermission = this.checkAgentHasAnyAccess(agentType, toolType as ToolType);
      if (hasAnyPermission) {
        const definition = tool.getDefinition();
        availableTools.push({
          type: definition.type,
          name: definition.name,
          methods: definition.methods.map(m => ({
            name: m.name,
            description: m.description,
            summary: m.summary,
            isWrite: m.isWrite,
            parameters: m.parameters,
            batch: m.batch,
            returns: m.returns,
          }))
        });
      }
    }

    logger.debug(`Retrieved available tools for agent: ${agentType}`, {
      count: availableTools.length,
      filtered: allowedToolTypes ? `by config: [${allowedToolTypes.join(',')}]` : 'by permission'
    });

    return availableTools;
  }

  private checkAgentHasAnyAccess(agentType: string, toolType: ToolType): boolean {
    const permissions = this.permissions.get(agentType);
    if (!permissions || permissions.length === 0) {
      return false;
    }

    const permission = permissions.find(p => p.toolType === toolType);
    if (!permission) {
      return false;
    }

    return permission.readAllowed || permission.writeAllowed;
  }

  getPermission(agentType: string, toolType: string): { readAllowed: boolean; writeAllowed: boolean } | undefined {
    const permissions = this.permissions.get(agentType);
    if (!permissions) return undefined;
    return permissions.find(p => p.toolType === toolType);
  }

  getAllTools(): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      allTools.push(tool.getDefinition());
    }
    return allTools;
  }

  getRegisteredToolTypes(): string[] {
    return Array.from(this.tools.keys());
  }

  hasTool(type: ToolType): boolean {
    return this.tools.has(type);
  }

  getToolCount(): number {
    return this.tools.size;
  }

  clearAll(): void {
    for (const tool of this.tools.values()) {
      tool.clearPermissions();
    }
    this.tools.clear();
    this.permissions.clear();
    logger.warn('All tools and permissions cleared');
  }

  /** 失效指定 save 下某 toolType 的缓存（含关联 _data 类型） */
  invalidateCache(saveId: string, toolType: ToolType): void {
    toolResultCache.invalidateAfterWrite(saveId, toolType);
  }

  /** 失效指定 save 的全部缓存 */
  invalidateSaveCache(saveId: string): void {
    toolResultCache.invalidateSave(saveId);
  }

  /** 获取缓存统计信息 */
  getCacheStats(): { saves: number; totalEntries: number } {
    return toolResultCache.getStats();
  }

  static resetInstance(): void {
    if (ToolRegistry.instance) {
      ToolRegistry.instance.clearAll();
      ToolRegistry.instance = null;
    }
  }
}

export { ToolRegistry };
