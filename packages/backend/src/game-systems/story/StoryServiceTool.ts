import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { StoryService } from './StoryService.js';
import { StoryEventRepository } from './StoryEventRepository.js';
import { AgentContextRepository } from './AgentContextRepository.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import type { IContextCompressor } from '../shared/types.js';
import type { IStoryEventWriter } from './types.js';

export class StoryServiceTool extends BaseTool {
  private contextCompressor: IContextCompressor | null = null;

  /** 注入 IContextCompressor 实例，在 init.ts 中调用 */
  setContextCompressor(compressor: IContextCompressor): void {
    this.contextCompressor = compressor;
  }

  constructor() {
    super(
      'story_service' as ToolType,
      'Story Service',
      '故事管理服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * 组合根（D8）：按请求创建 StoryService 实例，注入 Repository + TransactionManager。
   * S4 重构：移除 db 直传，改为注入 4 个依赖。
   */
  private createStoryService(context: ToolContext): StoryService {
    const db = context.requestScope.getDb();
    const storyEventRepo = new StoryEventRepository(db);
    const agentContextRepo = new AgentContextRepository(db);
    const saveRepo = new SaveRepository(db);
    const txManager = new KnexTransactionManager(db);
    return new StoryService(
      storyEventRepo,
      agentContextRepo,
      saveRepo,
      txManager,
      this.contextCompressor ?? undefined,
    );
  }

  /**
   * 创建跨领域 story_events 读写端口实例（per-request）。
   * S3-1: 供 EventServiceTool.createEventService 调用，注入 EventService 作为 IStoryEventWriter。
   * StoryService 已 implements IStoryEventWriter，直接返回 createStoryService 实例。
   */
  async createStoryEventWriter(context: ToolContext): Promise<IStoryEventWriter> {
    return this.createStoryService(context);
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'get_context',
      description: '获取故事上下文(含agent_contexts、存档信息、压缩摘要)',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createStoryService(context);
        const data = await service.getContext(context.saveId);
        return { success: true, data };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '故事上下文(含agent_contexts、存档信息、压缩摘要)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_history',
      description: '获取历史故事事件(支持分页)',
      parameters: {
        page: { type: 'number', required: false, description: '页码，默认1' },
        pageSize: { type: 'number', required: false, description: '每页条数，默认20' }
      },
      isWrite: false,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createStoryService(context);
        const options = {
          page: params.page as number | undefined,
          pageSize: params.pageSize as number | undefined
        };
        const data = await service.getHistory(context.saveId, options);
        return { success: true, data };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '历史故事事件(支持分页)' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_chapter',
      description: '获取当前章节信息',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createStoryService(context);
        const data = await service.getChapter(context.saveId);
        return { success: true, data };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '当前章节信息' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'update_context',
      description: '更新故事上下文(agent_contexts)',
      parameters: {
        state: { type: 'object', required: false, description: '要合并的state数据' },
        messages: { type: 'array', required: false, description: '替换的messages数组' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createStoryService(context);
        const data: any = {};
        if (params.state !== undefined) data.state = params.state as Record<string, unknown>;
        if (params.messages !== undefined) data.messages = params.messages as unknown[];
        await service.updateContext(context.saveId, data);
        return { success: true, data: { message: 'Context updated successfully' } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              message: { type: 'string', description: '操作结果消息' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'advance_chapter',
      description: '推进到下一章节',
      parameters: {},
      isWrite: true,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createStoryService(context);
        const data = await service.advanceChapter(context.saveId);
        return { success: true, data };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '推进后的章节信息' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'compress_context',
      description: '压缩上下文保留关键信息',
      parameters: {},
      isWrite: true,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createStoryService(context);
        await service.compressContext(context.saveId);
        return { success: true, data: { message: 'Context compressed successfully' } };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              message: { type: 'string', description: '操作结果消息' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    this.addActionHandler('update_story_context', 'update_context', 10);
    this.addActionHandler('advance_story_chapter', 'advance_chapter', 10);
    this.addActionHandler('compress_story_context', 'compress_context', 10);
  }
}
