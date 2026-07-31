import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { EventService } from './EventService.js';
import { EventRepository } from './EventRepository.js';
import { EventTriggerRepository } from './EventTriggerRepository.js';
import { SaveRepository } from '../save/SaveRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { EventEntityResolver } from './EventEntityResolver.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import type { StoryServiceTool } from '../story/StoryServiceTool.js';

/**
 * S3-1: EventServiceTool 组合根。
 *
 * 构造函数接收 storyServiceTool（跨领域 story_events 读写端口工厂），
 * createEventService 通过 storyServiceTool.createStoryEventWriter(context) 获取 IStoryEventWriter 实例，
 * 避免直接 new StoryService(db) 导致 contextCompressor 依赖丢失。
 *
 * D8: per-request 创建 EventService 实例，按请求创建 Repository + TransactionManager + 跨领域端口。
 */
export class EventServiceTool extends BaseTool {
  constructor(private readonly storyServiceTool: StoryServiceTool) {
    super(
      'event_service' as ToolType,
      'Event Service',
      '事件服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0',
    );

    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * D8 组合根：per-request 创建 EventService 实例。
   * 按请求创建 Repository + TransactionManager + 跨领域端口，注入 EventService。
   * storyEventWriter 通过 storyServiceTool.createStoryEventWriter 获取（含 contextCompressor 依赖）。
   */
  async createEventService(context: ToolContext): Promise<EventService> {
    const db = context.requestScope.getDb();
    const eventRepo = new EventRepository(db);
    const triggerRepo = new EventTriggerRepository(db);
    const saveRepo = new SaveRepository(db);
    const txManager = new KnexTransactionManager(db);
    const storyEventWriter = await this.storyServiceTool.createStoryEventWriter(context);
    const eventResolver = new EventEntityResolver(eventRepo, db);
    return new EventService(eventRepo, triggerRepo, storyEventWriter, saveRepo, txManager, eventResolver, eventBus);
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'list_event_templates',
      description: '获取事件模板列表(支持类型筛选)',
      parameters: {
        typeFilter: { type: 'string', required: false, description: '事件类型筛选(random/conditional/story/time_based/location/combat/quest)' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '事件模板列表，按类型筛选' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        const templateId = context.templateId as string | undefined;
        const templatesResult = await service.listEventTemplates(params.typeFilter as any, templateId);
        return { success: true, data: templatesResult };
      }
    });

    this.registerMethod({
      name: 'get_event',
      description: '获取单个事件详情',
      parameters: {
        eventId: { type: 'string', required: true, description: '事件模板ID（events表中的ID，如"shadow-creature-attack"，不是story_events的UUID）' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '单个事件详情' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        try {
          const templateId = context.templateId as string | undefined;
          const event = await service.getEvent(params.eventId as string, templateId);
          return { success: true, data: event };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : `Event not found: ${params.eventId}`;
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'check_triggers',
      description: '检查满足条件的事件触发',
      parameters: {
        eventType: { type: 'string', required: true, description: '触发器类型(enter_location/combat_end/combat_start/quest_complete/quest_fail/time_reached/relation_change/low_health/discover_location)' },
        context: { type: 'object', required: false, description: '上下文条件数据' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '满足条件的事件触发结果' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        const templateId = context.templateId as string | undefined;
        const result = await service.checkTriggers(
          context.saveId,
          params.eventType as any,
          params.context as Record<string, unknown>,
          templateId
        );
        return { success: true, data: result };
      }
    });

    this.registerMethod({
      name: 'trigger_event',
      description: '触发事件(仅登记event_triggers，已确认事实在resolve_trigger时归档)',
      parameters: {
        eventId: { type: 'string', required: true, description: '要触发的事件ID（必须是events表中的事件模板ID，如"shadow-creature-attack"，不是story_events的UUID。使用list_event_templates或get_active_events查看可用事件ID）' },
        context: { type: 'object', required: false, description: '触发上下文数据' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '触发器记录' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        try {
          const trigger = await service.triggerEvent(
            context.saveId,
            params.eventId as string,
            params.context as Record<string, unknown>
          );
          return { success: true, data: trigger, writeOperation: { toolType: this.type, method: 'trigger_event', params, result: trigger, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to trigger event';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'resolve_trigger',
      description: '解决事件触发，并在命中严格归档规则时写入 story_events',
      parameters: {
        triggerId: { type: 'string', required: true, description: '触发器ID' },
        resultData: { type: 'object', required: false, description: '结果数据' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '解决后的触发器记录' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        try {
          const trigger = await service.resolveTrigger(
            context.saveId,
            params.triggerId as string,
            params.resultData as Record<string, unknown>
          );
          return { success: true, data: trigger, writeOperation: { toolType: this.type, method: 'resolve_trigger', params, result: trigger, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to resolve trigger';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_pending_triggers',
      description: '获取待处理的触发列表',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '待处理的触发器列表' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        const triggersResult = await service.getPendingTriggers(context.saveId);
        return { success: true, data: triggersResult };
      }
    });

    this.registerMethod({
      name: 'roll_random_event',
      description: '随机事件检定(基于权重概率)',
      parameters: {
        locationId: { type: 'string', required: true, description: '当前地点ID' },
        timePeriod: { type: 'string', required: true, description: '时间段(morning/afternoon/evening/night)' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '随机事件检定结果' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        try {
          const templateId = context.templateId as string | undefined;
          const result = await service.rollRandomEvent(
            context.saveId,
            params.locationId as string,
            params.timePeriod as string,
            templateId
          );
          return { success: true, data: result, writeOperation: { toolType: this.type, method: 'roll_random_event', params, result, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to roll random event';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_story_events',
      description: '获取故事事件记录',
      parameters: {
        chapter: { type: 'string', required: false, description: '章节筛选(可选)' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '故事事件记录列表' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        const events = await service.getStoryEvents(
          context.saveId,
          params.chapter as string | undefined
        );
        return { success: true, data: events };
      }
    });

    this.registerMethod({
      name: 'record_story_event',
      description: '记录故事事件',
      parameters: {
        chapter: { type: 'string', required: false, description: '章节' },
        eventType: { type: 'string', required: true, description: '事件类型' },
        title: { type: 'string', required: true, description: '标题' },
        description: { type: 'string', required: false, description: '描述' },
        participants: { type: 'array', required: false, description: '参与者列表' },
        impact: { type: 'object', required: false, description: '影响数据' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '记录的故事事件' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        try {
          const record = await service.recordStoryEvent(context.saveId, {
            chapter: params.chapter as string || '',
            eventType: params.eventType as string,
            title: params.title as string,
            description: params.description as string || '',
            participants: (params.participants as string[]) || [],
            impact: (params.impact as Record<string, unknown>) || {}
          });
          return { success: true, data: record, writeOperation: { toolType: this.type, method: 'record_story_event', params, result: record, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to record story event';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_trigger_history',
      description: '获取触发历史记录',
      parameters: {
        limit: { type: 'number', required: false, description: '返回数量限制(默认50)' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '触发历史记录列表' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createEventService(context);
        const history = await service.getTriggerHistory(
          context.saveId,
          params.limit as number || 50
        );
        return { success: true, data: history };
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('get_templates', 'list_event_templates', 10, '获取事件模板列表');
    this.addActionHandler('get_event', 'get_event', 10, '获取单个事件详情');
    this.addActionHandler('check_triggers', 'check_triggers', 10, '检查事件触发');
    this.addActionHandler('trigger', 'trigger_event', 10, '触发事件');
    this.addActionHandler('resolve', 'resolve_trigger', 10, '解决事件触发');
    this.addActionHandler('get_pending', 'get_pending_triggers', 10, '获取待处理触发');
    this.addActionHandler('roll_random', 'roll_random_event', 10, '随机事件检定');
    this.addActionHandler('get_story_events', 'get_story_events', 10, '获取故事事件');
    this.addActionHandler('record_story', 'record_story_event', 10, '记录故事事件');

    this.addActionHandler('get_history', 'get_trigger_history', 10, '获取触发历史');
  }
}
