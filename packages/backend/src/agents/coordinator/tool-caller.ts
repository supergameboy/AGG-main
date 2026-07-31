import { ToolRegistry } from '../ToolRegistry.js';
import type { ToolCaller } from '../types.js';
import type { ToolType } from '../../../../shared/src/types/agent';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';

/**
 * ToolCaller 的默认实现：薄包装 ToolRegistry。
 *
 * Agent 通过 ToolCaller 接口调用工具，不直接依赖 ToolRegistry 具体实现，
 * 便于测试时替换为 mock。
 */
export class ToolCallerImpl implements ToolCaller {
  constructor(private readonly toolRegistry: ToolRegistry = ToolRegistry.getInstance()) {}

  async execute(
    agentType: string,
    toolType: ToolType,
    method: string,
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResponse> {
    return this.toolRegistry.execute(agentType, toolType, method, params, context);
  }
}
