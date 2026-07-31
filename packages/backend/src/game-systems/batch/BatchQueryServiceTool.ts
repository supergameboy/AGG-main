import { BaseTool, throwIfAborted, isAbortError } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import type { IToolRegistry } from '@ai-rpg/shared';

interface QueryItem {
  source: string;
  method: string;
  /** 单次查询参数（对象）或同方法批量查询参数（对象数组） */
  params?: Record<string, unknown> | Record<string, unknown>[];
}

export class BatchQueryServiceTool extends BaseTool {
  private toolRegistry: IToolRegistry | null = null;

  constructor() {
    super(
      'batch_query_service' as ToolType,
      'Batch Query Service',
      '批量只读查询服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.registerMethods();
  }

  /** P3-S7: 注入 IToolRegistry 实例（init.ts 组合根调用） */
  setToolRegistry(registry: IToolRegistry): void {
    this.toolRegistry = registry;
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'query',
      description: '批量并行查询多个service的只读方法。一次调用获取所有需要的数据，避免多轮tool调用。所有查询均为只读操作',
      parameters: {
        queries: {
          type: 'array',
          required: true,
          description: '查询列表，每项包含source(service名)、method(方法名)、params(可选参数)'
        }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const queries = params.queries as QueryItem[];
        if (!Array.isArray(queries) || queries.length === 0) {
          return { success: false, error: 'queries must be a non-empty array' };
        }
        if (queries.length > 10) {
          return { success: false, error: 'Maximum 10 queries per batch' };
        }

        if (!this.toolRegistry) {
          return { success: false, error: 'ToolRegistry not injected. Call setToolRegistry() first.' };
        }
        const toolRegistry = this.toolRegistry;
        const results: Record<string, unknown> = {};
        const errors: string[] = [];

        // 展开同方法批量查询：params 为数组时拆分为多条单次查询
        const expandedQueries: Array<{ source: string; method: string; params: Record<string, unknown>; originalIndex: number }> = [];
        for (let i = 0; i < queries.length; i++) {
          const q = queries[i];
          if (Array.isArray(q.params)) {
            for (const p of q.params) {
              expandedQueries.push({ source: q.source, method: q.method, params: p, originalIndex: i });
            }
          } else {
            expandedQueries.push({ source: q.source, method: q.method, params: q.params || {}, originalIndex: i });
          }
        }

        const total = expandedQueries.length;
        // M6 进度按完成计数推进（并发下完成顺序不定，计数器保证观测序列单调递增）
        let completed = 0;

        const queryPromises = expandedQueries.map(async (query) => {
          // M6 abort 检查点：每项查询发起前协作式取消（取消时此项及后续项不再发起）
          throwIfAborted(context.abortSignal);

          const queryKey = `${query.source}.${query.method}`;
          try {
            const tool = toolRegistry.getTool(query.source as ToolType);
            if (!tool) {
              errors.push(`[${query.originalIndex}] ${queryKey}: service not found`);
              return;
            }

            const toolMethods = tool.getMethods();
            if (!toolMethods.includes(query.method)) {
              errors.push(`[${query.originalIndex}] ${queryKey}: method not found`);
              return;
            }

            const methodDef = tool.getMethodDefinition(query.method);
            if (methodDef?.isWrite) {
              errors.push(`[${query.originalIndex}] ${queryKey}: write operations not allowed in batch query`);
              return;
            }

            const queryParams = { ...query.params, saveId: context.saveId };
            const result = await tool.execute(query.method, queryParams, context);

            if (result.success) {
              // 同方法多次查询结果合并为数组
              const existing = results[queryKey];
              if (existing && Array.isArray(existing)) {
                (existing as unknown[]).push(result.data);
              } else if (existing !== undefined) {
                results[queryKey] = [existing, result.data];
              } else {
                results[queryKey] = result.data;
              }
            } else {
              errors.push(`[${query.originalIndex}] ${queryKey}: ${result.error || 'execution failed'}`);
            }
          } catch (error) {
            // M6：取消错误冒泡（取消语义 ≠ 部分失败），由 BaseTool 统一规范化为 aborted 响应
            if (isAbortError(error)) {
              throw error;
            }
            errors.push(`[${query.originalIndex}] ${queryKey}: ${error instanceof Error ? error.message : 'unknown error'}`);
          }

          // M6 进度上报：单项查询结束后按完成计数推进（单查询无中间态，不上报）
          if (total > 1) {
            completed += 1;
            context.onUpdate?.({
              percent: Math.round((completed / total) * 100),
              message: `批量查询中：已处理 ${completed}/${total} 项`,
              stage: 'batch_process',
            });
          }
        });

        await Promise.all(queryPromises);

        // M6 abort 检查点：并发模式下全部项在途期间被取消——无法中断已发起项，
        // 但整体按取消语义结束（不聚合部分数据，由 BaseTool 规范化为 aborted 响应）
        throwIfAborted(context.abortSignal);

        if (errors.length > 0 && Object.keys(results).length === 0) {
          return { success: false, error: `All queries failed: ${errors.join('; ')}` };
        }

        return {
          success: true,
          data: {
            results,
            ...(errors.length > 0 ? { warnings: errors } : {})
          }
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: {
            type: 'object' as const,
            properties: {
              results: { type: 'object' as const, description: '查询结果映射(source.method → data)' },
              warnings: { type: 'array' as const, description: '部分失败的警告信息' },
            },
          },
          error: { type: 'string' as const },
        },
        required: ['success'],
      },
    });
  }
}
