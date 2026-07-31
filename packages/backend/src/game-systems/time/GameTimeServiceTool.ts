import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { GameTimeService } from './GameTimeService.js';
import { GameTimeRepository } from './GameTimeRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';

/**
 * Time 领域 ServiceTool（S4 重构：组合根，按请求创建 GameTimeRepository + KnexTransactionManager + GameTimeService）。
 *
 * D8 决策：ServiceTool.createXxxService(context) 内按请求创建 Repository + TransactionManager + Service。
 * ToolContext 提供 db 实例，组合根内创建的依赖在请求结束时由 GC 回收。
 */
export class GameTimeServiceTool extends BaseTool {
  constructor() {
    super(
      'game_time_service' as ToolType,
      'GameTime Service',
      '游戏时间管理服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * 组合根：按请求创建 GameTimeService（D8 决策）。
   * 6 个 handler 共享此方法，确保每个请求创建独立的 Repository + TransactionManager + Service 实例。
   * ServiceTool 持有具体类（非端口接口），可访问 GameTimeService 所有 public 方法。
   */
  private createGameTimeService(context: ToolContext): GameTimeService {
    const db = context.requestScope.getDb();
    const repo = new GameTimeRepository(db);
    const txManager = new KnexTransactionManager(db);
    return new GameTimeService(repo, txManager);
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'advance_time',
      description: '推进游戏时间，根据行动类型计算时间流逝',
      parameters: {
        actionType: { type: 'string', required: true, description: '行动类型: dialogue/move/explore/combat/trade/rest/use_item/quest_complete/save/status/cast_skill/quest_accept' },
        distance: { type: 'number', required: false, description: '移动距离(仅move时需要)' },
        restHours: { type: 'number', required: false, description: '休息小时数(仅rest时需要)' }
      },
      isWrite: true,
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createGameTimeService(context);
        const result = await service.advanceTime(context.saveId, {
          actionType: params.actionType as 'dialogue' | 'move' | 'explore' | 'combat' | 'trade' | 'rest' | 'use_item' | 'quest_complete' | 'save' | 'status' | 'cast_skill' | 'quest_accept',
          distance: params.distance as number | undefined,
          restHours: params.restHours as number | undefined
        });
        return {
          success: true,
          data: result
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '推进后的游戏时间详情' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_current_time',
      description: '获取当前游戏时间详情',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createGameTimeService(context);
        const currentTime = await service.getCurrentTime(context.saveId);
        return {
          success: true,
          data: currentTime
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '当前游戏时间详情' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_period_of_day',
      description: '获取当前时段(dawn/morning/noon/afternoon/evening/night/midnight)',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createGameTimeService(context);
        const period = await service.getPeriodOfDay(context.saveId);
        return {
          success: true,
          data: { period }
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              period: { type: 'string', description: '时段(dawn/morning/noon/afternoon/evening/night/midnight)' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'get_time_greeting',
      description: '获取基于当前时间的问候语描述',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createGameTimeService(context);
        const greeting = await service.getTimeGreeting(context.saveId);
        return {
          success: true,
          data: { greeting }
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              greeting: { type: 'string', description: '基于当前时间的问候语' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'is_shop_open',
      description: '检查商店是否营业',
      parameters: {},
      isWrite: false,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createGameTimeService(context);
        const isOpen = await service.isShopOpen(context.saveId);
        return {
          success: true,
          data: { isOpen }
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              isOpen: { type: 'boolean', description: '商店是否营业' }
            }
          },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });

    this.registerMethod({
      name: 'initialize_time',
      description: '初始化存档的游戏时间(第1天08:00)',
      parameters: {},
      isWrite: true,
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = this.createGameTimeService(context);
        const time = await service.initializeTime(context.saveId);
        return {
          success: true,
          data: time
        };
      },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object', description: '初始化后的游戏时间' },
          error: { type: 'string' }
        },
        required: ['success']
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('advance', 'advance_time', 10, '推进游戏时间');
    this.addActionHandler('current', 'get_current_time', 10, '获取当前时间');
    this.addActionHandler('period', 'get_period_of_day', 10, '获取当前时段');
    this.addActionHandler('greeting', 'get_time_greeting', 10, '获取时间问候语');
    this.addActionHandler('shop_open', 'is_shop_open', 10, '检查商店营业');
    this.addActionHandler('initialize', 'initialize_time', 10, '初始化游戏时间');
    // 别名映射(priority=5)
    this.addActionHandler('time', 'get_current_time', 5, '时间(别名)');
  }
}
