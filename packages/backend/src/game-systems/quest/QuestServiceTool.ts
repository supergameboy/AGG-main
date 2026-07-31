import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { QuestService } from './QuestService.js';
import { QuestRepository } from './QuestRepository.js';
import { QuestObjectiveRepository } from './QuestObjectiveRepository.js';
import { QuestEntityResolver } from './QuestEntityResolver.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import { InventoryServiceTool } from '../inventory/InventoryServiceTool.js';
import { SkillServiceTool } from '../skill/SkillServiceTool.js';
import type { NPCServiceTool } from '../npc/NPCServiceTool.js';
import type { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import { validateRequired } from '../../utils/paramValidator.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

/**
 * Quest 领域 ServiceTool（S3-1 Phase B 重构后的组合根，D8）。
 * 每次请求时在 createQuestService 内创建 Repository + TransactionManager + 跨领域 Service，
 * 注入 QuestService（9 参数构造）。
 * 跨领域 NPC/Character/Inventory/Skill 通过构造注入的 ServiceTool 获取。
 * eventBus 为 shared 模块级单例，直接 import 注入（与 EventServiceTool 模式一致）。
 */
export class QuestServiceTool extends BaseTool {
  private static readonly QUEST_ID_FORMAT_HINT = '任务ID。可使用 UUID、任务名称（从list_quests结果或预加载上下文中获取）';
  private static readonly OBJECTIVE_ID_FORMAT_HINT = '任务目标ID（从get_quest结果中的objectives数组获取）';
  private readonly npcServiceTool: NPCServiceTool;
  private readonly characterServiceTool: CharacterServiceTool;
  private readonly inventoryServiceTool: InventoryServiceTool;
  private readonly skillServiceTool: SkillServiceTool;

  constructor(
    npcServiceTool: NPCServiceTool,
    characterServiceTool: CharacterServiceTool,
    inventoryServiceTool: InventoryServiceTool,
    skillServiceTool: SkillServiceTool,
  ) {
    super(
      'quest_service' as ToolType,
      'Quest Service',
      '任务系统服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.npcServiceTool = npcServiceTool;
    this.characterServiceTool = characterServiceTool;
    this.inventoryServiceTool = inventoryServiceTool;
    this.skillServiceTool = skillServiceTool;
    this.registerMethods();
    this.registerHandledActions();
  }

  /**
   * 创建 QuestService 实例（组合根入口，D8）。
   * public 供跨领域消费方调用获取 QuestService。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   */
  async createQuestService(context: ToolContext): Promise<QuestService> {
    return context.requestScope.getOrCompute('quest', () => this.buildQuestService(context));
  }

  private async buildQuestService(context: ToolContext): Promise<QuestService> {
    const db = context.requestScope.getDb();
    const questRepo = new QuestRepository(db);
    const objectiveRepo = new QuestObjectiveRepository(db);
    const txManager = new KnexTransactionManager(db);
    const ruleParser = context.templateId
      ? await TemplateRuleParser.fromTemplateId(db, context.templateId)
      : await TemplateRuleParser.fromSaveId(db, context.saveId);
    const questResolver = new QuestEntityResolver(questRepo, db);
    const npcService = await this.npcServiceTool.createNPCService(context);
    const characterService = await this.characterServiceTool.createCharacterService(context);
    const inventoryService = await this.inventoryServiceTool.createInventoryService(context);
    const skillService = await this.skillServiceTool.createSkillService(context);

    return new QuestService(
      questRepo,
      objectiveRepo,
      txManager,
      ruleParser,
      questResolver,
      npcService,
      characterService,
      inventoryService,
      skillService,
      eventBus,
    );
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'list_quests',
      description: '获取任务列表(支持状态筛选)',
      parameters: {
        statusFilter: { type: 'string', required: false, description: '状态筛选(available/active/completed/failed)' },
        visibility: { type: 'string', required: false, description: '可见性过滤：不传=返回全部任务，"visible"=只返回玩家可见的任务' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '任务列表', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createQuestService(context);
        const quests = await service.listQuests(
          context.saveId,
          params.statusFilter as unknown as Parameters<typeof service.listQuests>[1],
          params.visibility as 'all' | 'visible' | undefined
        );
        return { success: true, data: quests };
      }
    });

    this.registerMethod({
      name: 'get_quest',
      description: '获取任务详情(含目标和进度)',
      parameters: {
        quests: {
          type: 'array',
          required: true,
          description: '要获取的任务列表',
          items: {
            type: 'object',
            properties: {
              questId: { type: 'string', description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
            }
          }
        }
      },
      isWrite: false,
      batch: { param: 'quests' },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '任务详情(含目标和进度)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const quest = await service.getQuest(context.saveId, questId);
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_active_quests',
      description: '获取进行中的任务列表',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '进行中的任务列表', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createQuestService(context);
        const quests = await service.getActiveQuests(context.saveId);
        return { success: true, data: quests };
      }
    });

    this.registerMethod({
      name: 'get_available_quests',
      description: '获取可接取的任务列表',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '可接取的任务列表', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createQuestService(context);
        const quests = await service.getAvailableQuests(context.saveId);
        return { success: true, data: quests };
      }
    });

    this.registerMethod({
      name: 'create_quest',
      description: '创建新任务(同时创建目标)。需要提供完整的任务信息，包括名称、描述、类型、目标和奖励。创建后状态为available，需要调用accept_quest接取。',
      parameters: {
        quests: {
          type: 'array',
          required: true,
          description: '要创建的任务列表',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '任务名称' },
              description: { type: 'string', description: '任务描述，详细说明任务背景和要求' },
              type: { type: 'string', description: '任务类型(main/side/daily/weekly/chain/repeatable)' },
              giverNpcId: { type: 'string', description: '发布者NPC ID' },
              giverLocationId: { type: 'string', description: '发布者所在地点ID' },
              questChainId: { type: 'string', description: '任务链ID，同一链的任务共享此ID' },
              visible: { type: 'boolean', description: '是否对玩家可见，默认false。设为true则玩家立即可见该任务' },
              prerequisiteQuestIds: { type: 'array', description: '前置任务ID列表，所有前置任务完成后自动解锁此任务' },
              conditions: { type: 'object', description: '结构化条件(仅供参考不强制校验)，格式{accept:[{type,value,description}],complete:[{type,value,description}]}' },
              rewards: { type: 'object', description: '奖励{experience?,gold?,currency?,items?,skills?}' },
              objectives: { type: 'array', description: '目标列表[{description,type,target,required?,eventTrigger?}]' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'quests' },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '创建的任务对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['name', 'description', 'type', 'objectives']);
        if (missing) return { success: false, error: missing };
        const service = await this.createQuestService(context);
        try {
          // Phase C-F4 修订: input 不含 saveId（saveId 作为 createQuest 签名参数传递，不重复）
          const input = {
            name: params.name as string,
            description: (params.description as string) || undefined,
            type: (params.type as string) || undefined,
            giverNpcId: (params.giverNpcId as string) || undefined,
            giverLocationId: (params.giverLocationId as string) || undefined,
            questChainId: (params.questChainId as string) || undefined,
            visible: params.visible !== undefined ? (params.visible as boolean) : undefined,
            prerequisiteQuestIds: params.prerequisiteQuestIds as string[] | undefined,
            conditions: params.conditions as Record<string, unknown> | undefined,
            rewards: (params.rewards as Record<string, unknown>) || undefined,
            objectives: (params.objectives as Array<Record<string, unknown>>) || undefined
          };
          const quest = await service.createQuest(context.saveId, input as unknown as Parameters<typeof service.createQuest>[1]);
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create quest';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'accept_quest',
      description: '接取任务(状态available→active)',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '接取后的任务对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const quest = await service.acceptQuest(context.saveId, questId);
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to accept quest';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'update_quest',
      description: '更新任务的属性，包括customData、前置任务、条件等',
      parameters: {
        updates: {
          type: 'array',
          required: true,
          description: '要更新的任务列表',
          items: {
            type: 'object',
            required: ['questId'],
            properties: {
              questId: { type: 'string', description: '任务ID(必填)。可使用预加载上下文中的id(如 quest_击败暗影_xxx)或questId(如 medieval-fantasy__defeat-shadow)或任务名称' },
              name: { type: 'string', description: '任务名称' },
              description: { type: 'string', description: '任务描述' },
              customData: { type: 'object', description: '自定义数据' },
              status: { type: 'string', description: '任务状态(locked/available/active/completed/failed)' },
              visible: { type: 'boolean', description: '是否对玩家可见' },
              prerequisiteQuestIds: { type: 'array', description: '前置任务ID列表' },
              conditions: { type: 'object', description: '结构化条件' },
              giverLocationId: { type: 'string', description: '发布者所在地点ID' },
              questChainId: { type: 'string', description: '任务链ID' }
            }
          }
        }
      },
      isWrite: true,
      batch: { param: 'updates' },
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '更新后的任务对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        void (params.questId);
        const service = await this.createQuestService(context);
        try {
          const fields: Record<string, unknown> = {};
          if (params.name !== undefined) fields.name = params.name as string;
          if (params.description !== undefined) fields.description = params.description as string;
          if (params.customData !== undefined) fields.customData = params.customData as Record<string, unknown>;
          if (params.status !== undefined) fields.status = params.status as string;
          if (params.visible !== undefined) fields.visible = params.visible as boolean;
          if (params.prerequisiteQuestIds !== undefined) fields.prerequisiteQuestIds = params.prerequisiteQuestIds as string[];
          if (params.conditions !== undefined) fields.conditions = params.conditions as Record<string, unknown>;
          if (params.giverLocationId !== undefined) fields.giverLocationId = params.giverLocationId as string;
          if (params.questChainId !== undefined) fields.questChainId = params.questChainId as string;
          const quest = await service.updateQuest(
            context.saveId,
            params.questId as string,
            fields as Parameters<typeof service.updateQuest>[2]
          );
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update quest';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'update_objective',
      description: '更新目标进度(增量模式，自动clamp 0~required)',
      parameters: {
        objectiveId: { type: 'string', required: true, description: QuestServiceTool.OBJECTIVE_ID_FORMAT_HINT },
        delta: { type: 'number', required: true, description: '增量值(可正可负)' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '更新后的目标对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        // 校验必填参数
        const missing = validateRequired(params, ['objectiveId', 'delta']);
        if (missing) return { success: false, error: missing };
        const service = await this.createQuestService(context);
        try {
          const objective = await service.updateObjective(
            context.saveId,
            params.objectiveId as string,
            params.delta as number
          );
          return { success: true, data: objective };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update objective';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'complete_quest',
      description: '完成任务(检查所有目标→发放奖励→状态变更)',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '完成后的任务对象(含奖励)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const quest = await service.completeQuest(context.saveId, questId);
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to complete quest';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'fail_quest',
      description: '标记任务失败',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '失败后的任务对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const quest = await service.failQuest(context.saveId, questId);
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fail quest';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'check_completion',
      description: '检查任务是否可以完成',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, properties: { questId: { type: 'string' as const }, canComplete: { type: 'boolean' as const } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const canComplete = await service.checkQuestCompletion(context.saveId, questId);
          return { success: true, data: { questId: params.questId, canComplete } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to check completion';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_quests_by_giver',
      description: '按发布者NPC查询任务',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '该NPC发布的任务列表', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        // 校验必填参数
        const missing = validateRequired(params, ['npcId']);
        if (missing) return { success: false, error: missing };
        const service = await this.createQuestService(context);
        const quests = await service.getQuestsByGiver(context.saveId, params.npcId as string);
        return { success: true, data: quests };
      }
    });

    this.registerMethod({
      name: 'get_quest_chain_info',
      description: '获取任务链信息(前置任务/解锁状态)',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '任务链信息(前置任务/解锁状态)' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        const chainInfo = await service.getQuestChainInfo(context.saveId, questId);
        return { success: true, data: chainInfo };
      }
    });

    this.registerMethod({
      name: 'get_available_chained_quests',
      description: '获取所有已解锁的可用链式任务(前置已完成)',
      parameters: {},
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '已解锁的可用链式任务列表', items: { type: 'object' as const } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (_params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createQuestService(context);
        const chainQuests = await service.getAvailableChainedQuests(context.saveId);
        return { success: true, data: chainQuests };
      }
    });

    this.registerMethod({
      name: 'check_fail_conditions',
      description: '检查任务失败条件(超时/NPC死亡/物品丢失/敌人逃跑)',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT },
        event: { type: 'string', required: true, description: '事件类型(timeout/npc_death/item_lost/enemy_escapes)' },
        eventData: { type: 'object', required: false, description: '事件数据(如{npcId:xxx}或{itemId:xxx,itemName:xxx}或{enemyId:xxx,enemyName:xxx})' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, properties: { questId: { type: 'string' as const }, failed: { type: 'boolean' as const } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId', 'event']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const failed = await service.checkFailConditions(
            context.saveId,
            questId,
            params.event as string,
            params.eventData as Record<string, unknown> | undefined
          );
          return { success: true, data: { questId: params.questId, failed } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to check fail conditions';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'abandon_quest',
      description: '放弃任务(状态active→failed)。放弃后标记为failed，由Agent决定后续处理',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, properties: { questId: { type: 'string' as const }, status: { type: 'string' as const, description: '固定为"failed"' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          await service.abandonQuest(context.saveId, questId);
          return { success: true, data: { questId, status: 'failed' } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to abandon quest';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'lock_quest',
      description: '锁定任务(状态→locked)。前置条件未满足时使用',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '锁定后的任务对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const quest = await service.lockQuest(context.saveId, questId);
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to lock quest';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'unlock_quest',
      description: '解锁任务(状态→available)。前置条件满足后使用',
      parameters: {
        questId: { type: 'string', required: true, description: QuestServiceTool.QUEST_ID_FORMAT_HINT }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '解锁后的任务对象' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const missing = validateRequired(params, ['questId']);
        if (missing) return { success: false, error: missing };
        const questId = params.questId as string;
        const service = await this.createQuestService(context);
        try {
          const quest = await service.unlockQuest(context.saveId, questId);
          return { success: true, data: quest };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to unlock quest';
          return { success: false, error: errorMessage };
        }
      }
    });
  }

  private registerHandledActions(): void {
    this.addActionHandler('list', 'list_quests', 10, '获取任务列表');
    this.addActionHandler('get', 'get_quest', 10, '获取任务详情');
    this.addActionHandler('active', 'get_active_quests', 10, '获取进行中任务');
    this.addActionHandler('available', 'get_available_quests', 10, '获取可接取任务');

    this.addActionHandler('create', 'create_quest', 10, '创建新任务');
    this.addActionHandler('accept', 'accept_quest', 10, '接取任务');
    this.addActionHandler('abandon', 'abandon_quest', 10, '放弃任务');
    this.addActionHandler('lock', 'lock_quest', 10, '锁定任务');
    this.addActionHandler('unlock', 'unlock_quest', 10, '解锁任务');
    this.addActionHandler('update', 'update_quest', 8, '更新任务属性');
    this.addActionHandler('update_objective', 'update_objective', 10, '更新目标进度');
    this.addActionHandler('complete', 'complete_quest', 10, '完成任务');
    this.addActionHandler('fail', 'fail_quest', 10, '标记任务失败');
    this.addActionHandler('check_completion', 'check_completion', 10, '检查任务是否可完成');
    this.addActionHandler('by_giver', 'get_quests_by_giver', 10, '按NPC查询任务');
    this.addActionHandler('chain_info', 'get_quest_chain_info', 10, '获取任务链信息');
    this.addActionHandler('available_chained', 'get_available_chained_quests', 10, '获取可用链式任务');
    this.addActionHandler('check_fail', 'check_fail_conditions', 10, '检查任务失败条件');
    this.addActionHandler('quests', 'get_active_quests', 5, '任务列表(别名)');
  }
}
