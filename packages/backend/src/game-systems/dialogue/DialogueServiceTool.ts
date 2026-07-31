import { BaseTool } from '@ai-rpg/shared/tool-core';
import type { ToolContext, ToolResponse } from '@ai-rpg/shared/types/tool';
import { ToolType } from '../../../../shared/src/types/agent.js';
import { DialogueService } from './DialogueService.js';
import { DialogueRepository } from './DialogueRepository.js';
import { KnexTransactionManager } from '../../database/TransactionManager.js';
import type { NPCServiceTool } from '../npc/NPCServiceTool.js';
import type { QuestServiceTool } from '../quest/QuestServiceTool.js';
import type { InventoryServiceTool } from '../inventory/InventoryServiceTool.js';
import type { CharacterServiceTool } from '../character/CharacterServiceTool.js';
import type { MessageType } from './types.js';
import { validateRequired } from '../../utils/paramValidator.js';
import type { ITemplateProvider } from '../shared/types.js';

/**
 * Dialogue 领域 ServiceTool（S3-3 Phase C 重构后的组合根，D8）。
 * 每次请求时在 createDialogueService 内创建 Repository + TransactionManager + 跨领域 Service，
 * 注入 DialogueService（7 参数构造，006 升级新增 characterService 可选）。
 * 跨领域 NPC/Quest/Inventory/Character 通过构造注入的 ServiceTool 获取。
 * eventBus 为 shared 模块级单例，由 DialogueService 直接 import（与原实现一致，减少变更范围）。
 *
 * 006 升级：注入 CharacterServiceTool 用于 emit dialogue 事件时查询 player ID（设计文档 §7.3）。
 * characterServiceTool 为可选参数，未注入时 emit 事件 data 不含 playerId（subscriber 自行兜底）。
 */
export class DialogueServiceTool extends BaseTool {
  private readonly npcServiceTool: NPCServiceTool;
  private readonly questServiceTool: QuestServiceTool;
  private readonly inventoryServiceTool: InventoryServiceTool;
  private readonly characterServiceTool?: CharacterServiceTool;
  private templateService: ITemplateProvider | null = null;

  constructor(
    npcServiceTool: NPCServiceTool,
    questServiceTool: QuestServiceTool,
    inventoryServiceTool: InventoryServiceTool,
    characterServiceTool?: CharacterServiceTool,
  ) {
    super(
      'dialogue_service' as ToolType,
      'Dialogue Service',
      '对话管理服务。详细使用方法请调用 get_tool_help 工具。',
      '1.0.0'
    );

    this.npcServiceTool = npcServiceTool;
    this.questServiceTool = questServiceTool;
    this.inventoryServiceTool = inventoryServiceTool;
    this.characterServiceTool = characterServiceTool;
    this.registerMethods();
    this.registerHandledActions();
  }

  /** 注入 ITemplateProvider 实例（可选依赖，组合根在 init.ts 中按需注入） */
  setTemplateService(templateService: ITemplateProvider): void {
    this.templateService = templateService;
  }

  /**
   * 创建 DialogueService 实例（组合根入口，D8）。
   * private：仅内部 handler 复用。
   * 通过 requestScope 在请求内共享，避免跨领域级联重复创建。
   */
  private async createDialogueService(context: ToolContext): Promise<DialogueService> {
    return context.requestScope.getOrCompute('dialogue', () => this.buildDialogueService(context));
  }

  private async buildDialogueService(context: ToolContext): Promise<DialogueService> {
    const db = context.requestScope.getDb();
    const dialogueRepo = new DialogueRepository(db);
    const txManager = new KnexTransactionManager(db);
    const npcService = await this.npcServiceTool.createNPCService(context);
    const questService = await this.questServiceTool.createQuestService(context);
    const inventoryService = await this.inventoryServiceTool.createInventoryService(context);
    // 006 升级：可选注入 CharacterService（用于 emit dialogue 事件时查询 player ID）
    const characterService = this.characterServiceTool
      ? await this.characterServiceTool.createCharacterService(context)
      : undefined;

    return new DialogueService(
      dialogueRepo,
      npcService,
      questService,
      inventoryService,
      txManager,
      this.templateService ?? undefined,
      characterService,
    );
  }

  private registerMethods(): void {
    this.registerMethod({
      name: 'get_dialogue_history',
      description: '获取对话历史(支持分页，可按NPC筛选)',
      parameters: {
        npcId: { type: 'string', required: false, description: 'NPC ID（可选）' },
        limit: { type: 'number', required: false, description: '每页数量（默认50）' },
        offset: { type: 'number', required: false, description: '偏移量（默认0）' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '对话历史(分页)', properties: { messages: { type: 'array' as const, description: '对话消息列表(DialogueMessage[])', items: { type: 'object' as const } }, total: { type: 'number' as const, description: '总消息数' }, hasMore: { type: 'boolean' as const, description: '是否有更多消息' }, hint: { type: 'string' as const, description: '操作提示' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        const result = await service.getDialogueHistory(
          context.saveId,
          params.npcId as string | undefined,
          params.limit as number | undefined,
          params.offset as number | undefined
        );
        return { success: true, data: result };
      }
    });

    this.registerMethod({
      name: 'get_recent_dialogue',
      description: '获取最近N条对话记录。如果指定npcId则获取与该NPC的对话，否则获取所有最近对话',
      parameters: {
        npcId: { type: 'string', required: false, description: 'NPC ID（可选，不传则获取所有最近对话）' },
        count: { type: 'number', required: false, description: '获取数量（默认10）' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '最近对话记录', properties: { dialogues: { type: 'array' as const, description: '最近对话消息列表(DialogueMessage[])', items: { type: 'object' as const } }, hint: { type: 'string' as const, description: '操作提示' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        const recentResult = await service.getRecentDialogue(
          context.saveId,
          params.npcId as string | undefined,
          params.count as number | undefined
        );
        return { success: true, data: recentResult };
      }
    });

    this.registerMethod({
      name: 'submit_dialogue',
      description: '提交对话消息数组并持久化。一次提交本轮全部对话消息，支持批量写入和对话选项。NPC对话speaker使用NPC名称，旁白/叙事speaker使用"旁白"且messageType为narrator。',
      parameters: {
        messages: {
          type: 'array',
          required: true,
          description: '对话消息数组。每条消息包含speaker(说话者名称)、content(消息内容)、emotion(可选情绪)、messageType(可选，默认npc，可选player/npc/narrator/system)。旁白/叙事: speaker="旁白", messageType="narrator"；NPC对话: speaker=NPC名称, messageType="npc"'
        },
        options: {
          type: 'array',
          required: true,
          description: '对话选项数组。每个选项包含text(显示文本)和npcId(对话目标NPC的ID或名称)。始终提供2-4个选项引导玩家下一步行动，无明确对话目标时npcId使用当前场景主要NPC'
        }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '提交的对话数据', properties: { dialogue: { type: 'object' as const, description: '对话内容', properties: { messages: { type: 'array' as const, description: '提交的消息数组', items: { type: 'object' as const } }, options: { type: 'array' as const, description: '解析后的对话选项', items: { type: 'object' as const } } } }, messageCount: { type: 'number' as const, description: '提交的消息数量' } } },
          error: { type: 'string' as const, description: '失败时的错误信息(messages/options校验失败)' }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const messages = params.messages as Array<Record<string, unknown>>;
        const options = params.options as Array<Record<string, string>>;

        if (!Array.isArray(messages) || messages.length === 0) {
          return { success: false, error: 'messages 必须是非空数组' };
        }

        if (!Array.isArray(options) || options.length === 0) {
          return { success: false, error: 'options 必须是非空数组，始终提供2-4个对话选项引导玩家' };
        }

        const dialogueService = await this.createDialogueService(context);
        const npcService = await this.npcServiceTool.createNPCService(context);
        const results: unknown[] = [];

        for (let mi = 0; mi < messages.length; mi++) {
          const msg = messages[mi];
          const missing: string[] = [];
          if (!msg.speaker) missing.push('speaker');
          if (!msg.content) missing.push('content');
          if (missing.length > 0) {
            return { success: false, error: `messages[${mi}] 缺少必填字段 [${missing.join(', ')}]（每条消息必须包含 speaker 和 content）` };
          }

          const msgType = (msg.messageType as string) || 'npc';

          // NPC ID 三级兜底：ID → template_npc_id → name
          // 旁白消息不需要 npcId
          let resolvedNpcId: string | null = null;
          if (msgType !== 'narrator' && msg.speaker !== '旁白') {
            try {
              resolvedNpcId = await npcService.resolveNpcId(context.saveId, msg.speaker as string);
            } catch {
              resolvedNpcId = null;
            }
          }

          const result = await dialogueService.addDialogueMessage(context.saveId, {
            saveId: context.saveId,
            npcId: resolvedNpcId ?? undefined,
            speaker: msg.speaker as string,
            content: msg.content as string,
            emotion: (msg.emotion as string) || 'neutral',
            messageType: msgType as MessageType,
          });
          results.push(result);
        }

        // 对话选项中的 npcId 也需要兜底解析，并自动生成 id
        const resolvedOptions: Array<Record<string, string>> = [];
        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          const missing: string[] = [];
          if (!opt.text) missing.push('text');
          if (!opt.npcId) missing.push('npcId');
          if (missing.length > 0) {
            return { success: false, error: `options[${i}] 缺少必填字段 [${missing.join(', ')}]（每个选项必须包含 text 和 npcId）` };
          }
          let resolvedOptNpcId = opt.npcId;
          try {
            resolvedOptNpcId = await npcService.resolveNpcId(context.saveId, opt.npcId);
          } catch {
            // 选项 npcId 解析失败，保留原始值
          }
          resolvedOptions.push({
            id: opt.id || `opt_${resolvedOptNpcId}_${i}`,
            text: opt.text,
            npcId: resolvedOptNpcId,
          });
        }

        return {
          success: true,
          data: {
            dialogue: { messages, options: resolvedOptions },
            messageCount: messages.length,
          },
          writeOperation: {
            toolType: this.type,
            method: 'submit_dialogue',
            params,
            result: results,
            timestamp: context.timestamp,
          },
        };
      }
    });

    this.registerMethod({
      name: 'get_dialogue_context',
      description: '获取完整对话上下文（含NPC信息、关系值、历史消息、可用选项、时间上下文）',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID，传入"all"获取所有NPC的对话上下文摘要' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '对话上下文(DialogueContext)，含NPC信息/关系值/历史消息/可用选项/时间上下文；npcId=all时返回所有NPC摘要' },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        try {
          const npcId = params.npcId as string;

          if (npcId === 'all') {
            const contextResult = await service.getDialogueContextForAll(context.saveId);
            return { success: true, data: contextResult };
          }

          const contextData = await service.getDialogueContext(
            context.saveId,
            npcId
          );
          return { success: true, data: contextData };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to get dialogue context';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_dialogue_summary',
      description: '获取对话摘要统计（总数、情绪分布、说话者分布、时间范围）',
      parameters: {
        npcId: { type: 'string', required: false, description: 'NPC ID（可选，不传则统计所有）' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '对话摘要统计', properties: { totalMessages: { type: 'number' as const, description: '总消息数' }, emotionDistribution: { type: 'array' as const, description: '情绪分布', items: { type: 'object' as const } }, speakerDistribution: { type: 'array' as const, description: '说话者分布', items: { type: 'object' as const } }, firstMessageTime: { type: 'string' as const, description: '最早消息时间' }, lastMessageTime: { type: 'string' as const, description: '最新消息时间' }, dateRange: { type: 'string' as const, description: '时间范围' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        const summary = await service.getDialogueSummary(
          context.saveId,
          params.npcId as string | undefined
        );
        return { success: true, data: summary };
      }
    });

    this.registerMethod({
      name: 'search_dialogues',
      description: '高级搜索对话（支持关键词、情绪、说话者筛选）',
      parameters: {
        keyword: { type: 'string', required: false, description: '关键词搜索（可选）' },
        emotion: { type: 'string', required: false, description: '情绪筛选（可选）' },
        speaker: { type: 'string', required: false, description: '说话者筛选（可选）' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, description: '搜索结果(DialogueMessage[])', items: { type: 'object' as const } }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        const results = await service.searchDialogues(
          context.saveId,
          params.keyword as string | undefined,
          params.emotion as string | undefined,
          params.speaker as string | undefined
        );
        return { success: true, data: results };
      }
    });

    this.registerMethod({
      name: 'clear_dialogue_history',
      description: '清除对话历史（可指定NPC或清除所有）',
      parameters: {
        npcId: { type: 'string', required: false, description: 'NPC ID（可选，不传则清除所有）' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        try {
          await service.clearDialogueHistory(
            context.saveId,
            params.npcId as string | undefined
          );
          return { success: true, writeOperation: { toolType: this.type, method: 'clear_dialogue_history', params, result: undefined, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to clear dialogue history';
          return { success: false, error: errorMessage };
        }
      }
    });

    this.registerMethod({
      name: 'get_emotion_trend',
      description: '分析对话情绪变化趋势（正向/负向/中性比例及累积趋势）',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '情绪变化趋势', properties: { trend: { type: 'array' as const, description: '情绪趋势数据点', items: { type: 'object' as const } }, overallSentiment: { type: 'string' as const, description: '整体情绪倾向(positive/negative/neutral)' }, positiveRatio: { type: 'number' as const, description: '正向情绪占比' }, negativeRatio: { type: 'number' as const, description: '负向情绪占比' }, neutralRatio: { type: 'number' as const, description: '中性情绪占比' } } }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        const trend = await service.getEmotionTrend(
          context.saveId,
          params.npcId as string
        );
        return { success: true, data: trend };
      }
    });

    // V4: 检查对话选项是否满足条件
    this.registerMethod({
      name: 'check_conditional_dialogue',
      description: '检查对话选项是否满足条件(关系/任务/物品要求)',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' },
        optionId: { type: 'string', required: true, description: '对话选项ID' }
      },
      isWrite: false,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '条件检查结果(ConditionalCheckResult)', properties: { available: { type: 'boolean' as const, description: '选项是否可用' }, optionId: { type: 'string' as const, description: '选项ID' }, blockedReason: { type: 'string' as const, description: '不可用原因' }, requirements: { type: 'object' as const, description: '条件满足情况(关系/任务/物品)' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        try {
          const result = await service.checkConditionalDialogue(
            context.saveId,
            params.npcId as string,
            params.optionId as string
          );
          return { success: true, data: result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to check conditional dialogue';
          return { success: false, error: errorMessage };
        }
      }
    });

    // V5: 处理对话选择（验证条件→记录选择→触发效果→NPC回复→更新选项）
    this.registerMethod({
      name: 'process_dialogue_choice',
      description: '处理对话选择(验证条件→记录选择→触发效果→NPC回复→更新选项)',
      parameters: {
        npcId: { type: 'string', required: true, description: 'NPC ID' },
        choiceId: { type: 'string', required: true, description: '选择的选项ID' }
      },
      isWrite: true,
      returns: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const, description: '对话选择处理结果(DialogueChoiceResult)', properties: { success: { type: 'boolean' as const, description: '选择是否成功执行' }, choiceId: { type: 'string' as const, description: '选择的选项ID' }, effectsApplied: { type: 'array' as const, description: '已触发的效果列表', items: { type: 'object' as const } }, npcResponse: { type: 'object' as const, description: 'NPC回复消息' }, newOptions: { type: 'array' as const, description: '更新后的可用选项', items: { type: 'object' as const } }, error: { type: 'string' as const, description: '选择不可用时的原因' } } },
          error: { type: 'string' as const }
        },
        required: ['success']
      },
      handler: async (params: Record<string, unknown>, context: ToolContext): Promise<ToolResponse> => {
        const service = await this.createDialogueService(context);
        try {
          const missing = validateRequired(params, ['npcId', 'choiceId']);
          if (missing) return { success: false, error: missing };
          const result = await service.processDialogueChoice(
            context.saveId,
            params.npcId as string,
            params.choiceId as string
          );
          return { success: true, data: result, writeOperation: { toolType: this.type, method: 'process_dialogue_choice', params, result, timestamp: context.timestamp } };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to process dialogue choice';
          return { success: false, error: errorMessage };
        }
      }
    });
  }

  private registerHandledActions(): void {
    // 标准action映射
    this.addActionHandler('get_history', 'get_dialogue_history', 10, '获取对话历史');
    this.addActionHandler('get_recent', 'get_recent_dialogue', 10, '获取最近对话');
    this.addActionHandler('submit_dialogue', 'submit_dialogue', 10, '提交对话消息数组');
    this.addActionHandler('dialogue', 'submit_dialogue', 5, '提交对话(别名)');
    this.addActionHandler('get_context', 'get_dialogue_context', 10, '获取对话上下文');
    this.addActionHandler('get_summary', 'get_dialogue_summary', 10, '获取对话摘要');
    this.addActionHandler('search', 'search_dialogues', 10, '搜索对话');
    this.addActionHandler('clear', 'clear_dialogue_history', 10, '清除对话历史');
    this.addActionHandler('emotion_trend', 'get_emotion_trend', 10, '获取情绪趋势');
    this.addActionHandler('check_conditional', 'check_conditional_dialogue', 10, '检查条件对话');
    this.addActionHandler('process_choice', 'process_dialogue_choice', 10, '处理对话选择');
  }
}
