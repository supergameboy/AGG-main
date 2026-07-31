import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import type { ITemplateProvider } from '../shared/types.js';
import type { INPCService } from '../npc/types.js';
import type { IQuestService } from '../quest/types.js';
import type { IInventoryService, ItemCategory, ItemQuality } from '../inventory/types.js';
import type { ICharacterService } from '../character/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import type { QuestType } from '../../../../shared/src/types/game.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import { recordToDialogueMessage } from './mappers.js';
import type {
  DialogueMessage,
  DialogueSession,
  DialogueContext,
  CreateDialogueParams,
  ConditionalCheckResult,
  DialogueEffect,
  DialogueChoiceResult,
  DialogueContextSummary,
  MessageType,
  DialogueMessageRecord,
  IDialogueRepository,
} from './types.js';

export {
  DialogueMessage,
  DialogueSession,
  DialogueContext,
  CreateDialogueParams,
  ConditionalCheckResult,
  DialogueEffect,
  DialogueChoiceResult,
  DialogueContextSummary,
  MessageType,
};

const DIALOGUE_HISTORY_EMPTY_HINT = '暂无对话历史，可视为当前尚未建立对话记录。';
const DIALOGUE_RECENT_EMPTY_HINT = '暂无最近对话记录，可视为当前没有可读上下文。';
const DIALOGUE_CONTEXT_EMPTY_HINT = '当前无 NPC 对话上下文，请先核对场景初始化与已有 NPC 数据。';

/**
 * Dialogue 领域 Service（S3-3 Phase C 重构后的组合根）。
 *
 * D7: dialogues 表归 DialogueRepository，Service 不再持有 Knex db。
 * D8: 跨领域依赖（NPC/Quest/Inventory）通过端口接口注入。
 * D9: 事务边界通过 ITransactionManager 管理，trx 透传给 Repository 和跨领域 Service。
 * D10: 移除 db 字段，所有数据访问通过 Repository 端口。
 *
 * 事务策略:
 * - addDialogueMessage: 单事务包裹（insert dialogues + appendDialogueHistory）
 * - processDialogueChoice: 单事务包裹（记录选择 + 执行效果 + NPC 回复），保证原子性
 * - 跨领域写操作（changePlayerRelation/createQuest/addItem）透传 trx，避免嵌套事务
 */
export class DialogueService {
  private readonly logger: ReturnType<typeof createChildLogger>;
  private readonly dialogueRepo: IDialogueRepository;
  private readonly npcService: INPCService;
  private readonly questService: IQuestService;
  private readonly inventoryService: IInventoryService;
  private readonly txManager: ITransactionManager;
  private readonly templateService?: ITemplateProvider;
  // 006 升级：可选注入 ICharacterService，用于 emit dialogue 事件时补充 player 信息
  // AwarenessAutoSubscriber 订阅 dialogue 事件时需要 player ID 调用 setAwareness(npc→player)
  private readonly characterService?: ICharacterService;

  constructor(
    dialogueRepo: IDialogueRepository,
    npcService: INPCService,
    questService: IQuestService,
    inventoryService: IInventoryService,
    txManager: ITransactionManager,
    templateService?: ITemplateProvider,
    characterService?: ICharacterService,
  ) {
    this.dialogueRepo = dialogueRepo;
    this.npcService = npcService;
    this.questService = questService;
    this.inventoryService = inventoryService;
    this.txManager = txManager;
    this.templateService = templateService;
    this.characterService = characterService;
    this.logger = createChildLogger('service:dialogue');
  }

  /**
   * 006 升级：emit dialogue 事件并补充 player 信息（设计文档 §7.3）。
   *
   * 期望效果：
   *   - data 必含 npcId + speaker
   *   - 如果 characterService 可用，查询 player ID 并加入 data.playerId
   *   - AwarenessAutoSubscriber 订阅事件后通过 data.playerId 调用 setAwareness(npc→player, delta=+1)
   *   - 查询失败时 data 不含 playerId（subscriber 自行通过 saveId 兜底查询）
   */
  private async emitDialogueEvent(
    saveId: ID,
    npcId: ID | null | undefined,
    speaker: string,
  ): Promise<void> {
    if (!npcId) return;
    const data: Record<string, unknown> = { npcId: String(npcId), speaker };
    if (this.characterService) {
      try {
        const playerInfo = await this.characterService.getCharacterBasicInfo(String(saveId));
        if (playerInfo?.characterId) {
          data.playerId = playerInfo.characterId;
        }
      } catch (error) {
        // 查询失败不阻塞事件发布，subscriber 可通过 saveId 兜底
        this.logger.warn('Failed to query player info for dialogue event', {
          saveId,
          error: getErrorMessage(error),
        });
      }
    }
    eventBus.emit('dialogue', {
      type: 'dialogue',
      saveId: String(saveId),
      data,
      timestamp: Date.now(),
    });
  }

  async getDialogueHistory(
    saveId: ID,
    npcId?: ID,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ messages: DialogueMessage[]; total: number; hasMore: boolean; hint?: string }> {
    try {
      const { rows, total } = await this.dialogueRepo.findWithPagination(
        saveId,
        npcId ?? null,
        limit,
        offset,
      );
      const messages = rows.reverse().map(recordToDialogueMessage);

      const result: { messages: DialogueMessage[]; total: number; hasMore: boolean; hint?: string } = {
        messages,
        total,
        hasMore: offset + limit < total
      };

      if (messages.length === 0) {
        result.hint = DIALOGUE_HISTORY_EMPTY_HINT;
      }

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get dialogue history', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async getRecentDialogue(
    saveId: ID,
    npcId: ID | undefined,
    count: number = 10
  ): Promise<{ dialogues: DialogueMessage[]; hint?: string }> {
    try {
      const rows = await this.dialogueRepo.findRecent(saveId, npcId ?? null, count);
      const dialogues = rows.reverse().map(recordToDialogueMessage);
      if (dialogues.length === 0) {
        return { dialogues: [], hint: DIALOGUE_RECENT_EMPTY_HINT };
      }
      return { dialogues };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get recent dialogue', { saveId, npcId, count, error: errorMessage });
      throw error;
    }
  }

  async addDialogueMessage(saveId: ID, params: CreateDialogueParams): Promise<DialogueMessage> {
    try {
      const message = await this.txManager.transaction(async (trx) => {
        return this.addDialogueMessageInTrx(trx, saveId, params);
      });

      if (message.npcId) {
        await this.emitDialogueEvent(saveId, message.npcId, params.speaker);
      }

      this.logger.info('Dialogue message added', {
        id: message.id,
        saveId,
        npcId: params.npcId,
        speaker: params.speaker,
        emotion: params.emotion || 'neutral'
      });

      return message;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to add dialogue message', { saveId, params, error: errorMessage });
      throw error;
    }
  }

  /**
   * 事务内追加对话消息（供 addDialogueMessage 和 processDialogueChoice 事务内调用）。
   *
   * 步骤:
   * 1. 解析 npcId（ID → template_npc_id，失败置 null）
   * 2. 插入 dialogues 表
   * 3. 追加 NPC dialogue_history（跨领域端口调用，透传 trx）
   */
  private async addDialogueMessageInTrx(
    trx: Knex.Transaction,
    saveId: ID,
    params: CreateDialogueParams,
  ): Promise<DialogueMessage> {
    const now = Date.now() as Timestamp;
    const id = generateReadableId('dlg', params.npcId || 'unknown') as ID;
    const emotion = params.emotion || 'neutral';
    const messageType: string = params.messageType || 'npc';

    let resolvedNpcId: string | null = null;
    if (params.npcId) {
      try {
        resolvedNpcId = await this.npcService.resolveNpcId(saveId, params.npcId, trx);
      } catch {
        resolvedNpcId = null;
      }
    }

    const record: DialogueMessageRecord = {
      id,
      saveId: String(saveId),
      npcId: resolvedNpcId,
      speaker: params.speaker,
      content: params.content,
      emotion,
      messageType,
      timestamp: now,
    };

    await this.dialogueRepo.insert(record, trx);

    if (resolvedNpcId) {
      await this.npcService.appendDialogueHistory(
        saveId,
        resolvedNpcId,
        { speaker: params.speaker, content: params.content, emotion, messageType, timestamp: now },
        trx,
      );
    }

    return recordToDialogueMessage(record);
  }

  async createDialogueSession(saveId: ID, npcId: ID): Promise<DialogueSession> {
    try {
      const now = Date.now() as Timestamp;
      const sessionId = generateReadableId('sess', npcId || 'unknown') as ID;

      const messageCount = await this.dialogueRepo.countBySaveIdAndNpcId(saveId, npcId);

      const emotionRows = await this.dialogueRepo.groupCountByEmotion(saveId, npcId);
      const totalCount = emotionRows.reduce((sum, r) => sum + r.count, 0);
      const emotions = emotionRows.map(r => ({
        emotion: r.emotion,
        count: r.count,
        percentage: totalCount > 0 ? Math.round((r.count / totalCount) * 10000) / 100 : 0,
      }));

      const session: DialogueSession = {
        sessionId,
        saveId,
        npcId,
        startedAt: now,
        lastActivityAt: now,
        messageCount,
        currentTopic: null,
        emotions
      };

      this.logger.info('Dialogue session created', {
        sessionId,
        saveId,
        npcId,
        messageCount
      });

      return session;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to create dialogue session', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async getDialogueContext(saveId: ID, npcId: ID): Promise<DialogueContext> {
    try {
      const npc = await this.npcService.getNPC(saveId, npcId);

      const npcName = npc.name;
      const npcRole = npc.role;
      const npcDisposition = (npc.customData?.disposition as string) ?? 'neutral';

      const { dialogues: recentMessages } = await this.getRecentDialogue(saveId, npcId, 10);

      const availableOptions = this.generateDialogueOptions(npcId, npcName);

      const currentTime = Date.now() as Timestamp;
      const lastDialogueTime = recentMessages.length > 0
        ? recentMessages[recentMessages.length - 1].timestamp
        : null;

      const timeSinceLastDialogue = lastDialogueTime
        ? currentTime - lastDialogueTime
        : null;

      const context: DialogueContext = {
        npcName,
        npcRole,
        npcDisposition,
        recentMessages,
        availableOptions,
        timeContext: {
          currentTime,
          lastDialogueTime,
          timeSinceLastDialogue
        }
      };

      this.logger.info('Dialogue context built', {
        saveId,
        npcId,
        npcName,
        recentMessageCount: recentMessages.length
      });

      return context;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get dialogue context', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async getDialogueContextForAll(saveId: ID): Promise<{ contexts: DialogueContextSummary[]; hint?: string }> {
    try {
      const npcs = await this.npcService.listNPCs(saveId);

      if (npcs.length === 0) {
        return { contexts: [], hint: DIALOGUE_CONTEXT_EMPTY_HINT };
      }

      const summaries: DialogueContextSummary[] = [];

      for (const npc of npcs) {
        const recentMessageCount = await this.dialogueRepo.countBySaveIdAndNpcId(saveId, npc.id);

        summaries.push({
          npcId: npc.id,
          npcName: npc.name,
          npcRole: npc.role,
          recentMessageCount
        });
      }

      this.logger.info('Dialogue context for all NPCs built', {
        saveId,
        npcCount: summaries.length
      });

      return { contexts: summaries };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get dialogue context for all NPCs', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getDialogueSummary(saveId: ID, npcId?: ID): Promise<{
    totalMessages: number;
    emotionDistribution: Array<{ emotion: string; count: number; percentage: number }>;
    speakerDistribution: Array<{ speaker: string; count: number }>;
    firstMessageTime: Timestamp | null;
    lastMessageTime: Timestamp | null;
    dateRange: string | null;
  }> {
    try {
      const rows = await this.dialogueRepo.findAllBySaveId(saveId, npcId ?? null);
      const totalMessages = rows.length;

      if (totalMessages === 0) {
        return {
          totalMessages: 0,
          emotionDistribution: [],
          speakerDistribution: [],
          firstMessageTime: null,
          lastMessageTime: null,
          dateRange: null
        };
      }

      const emotionMap = new Map<string, number>();
      const speakerMap = new Map<string, number>();

      for (const row of rows) {
        emotionMap.set(row.emotion, (emotionMap.get(row.emotion) || 0) + 1);
        speakerMap.set(row.speaker, (speakerMap.get(row.speaker) || 0) + 1);
      }

      const emotionDistribution = Array.from(emotionMap.entries())
        .map(([emotion, count]) => ({
          emotion,
          count,
          percentage: Math.round((count / totalMessages) * 10000) / 100
        }))
        .sort((a, b) => b.count - a.count);

      const speakerDistribution = Array.from(speakerMap.entries())
        .map(([speaker, count]) => ({ speaker, count }))
        .sort((a, b) => b.count - a.count);

      const firstMessageTime = rows[0].timestamp as Timestamp;
      const lastMessageTime = rows[rows.length - 1].timestamp as Timestamp;

      const firstDate = new Date(firstMessageTime);
      const lastDate = new Date(lastMessageTime);
      const dateRange = `${firstDate.toLocaleDateString()} - ${lastDate.toLocaleDateString()}`;

      return {
        totalMessages,
        emotionDistribution,
        speakerDistribution,
        firstMessageTime,
        lastMessageTime,
        dateRange
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get dialogue summary', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async searchDialogues(
    saveId: ID,
    keyword?: string,
    emotion?: string,
    speaker?: string
  ): Promise<DialogueMessage[]> {
    try {
      const rows = await this.dialogueRepo.search(saveId, { keyword, emotion, speaker });
      return rows.map(recordToDialogueMessage);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to search dialogues', { saveId, keyword, emotion, speaker, error: errorMessage });
      throw error;
    }
  }

  async clearDialogueHistory(saveId: ID, npcId?: ID): Promise<void> {
    try {
      await this.dialogueRepo.deleteBySaveId(saveId, npcId ?? null);

      this.logger.info('Dialogue history cleared', {
        saveId,
        npcId,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to clear dialogue history', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async getEmotionTrend(saveId: ID, npcId: ID): Promise<{
    trend: Array<{
      timestamp: Timestamp;
      emotion: string;
      cumulativePositive: number;
      cumulativeNegative: number;
    }>;
    overallSentiment: 'positive' | 'negative' | 'neutral';
    positiveRatio: number;
    negativeRatio: number;
    neutralRatio: number;
  }> {
    try {
      const rows = await this.dialogueRepo.findAllBySaveId(saveId, npcId);

      if (rows.length === 0) {
        return {
          trend: [],
          overallSentiment: 'neutral',
          positiveRatio: 0,
          negativeRatio: 0,
          neutralRatio: 1
        };
      }

      const positiveEmotions = ['happy', 'excited', 'friendly', 'warm', 'grateful'];
      const negativeEmotions = ['angry', 'sad', 'hostile', 'cold', 'fearful'];

      let cumulativePositive = 0;
      let cumulativeNegative = 0;
      let positiveCount = 0;
      let negativeCount = 0;
      let neutralCount = 0;

      const trend = rows.map(row => {
        const emotion = row.emotion;
        const timestamp = row.timestamp as Timestamp;

        if (positiveEmotions.includes(emotion)) {
          cumulativePositive++;
          positiveCount++;
        } else if (negativeEmotions.includes(emotion)) {
          cumulativeNegative++;
          negativeCount++;
        } else {
          neutralCount++;
        }

        return {
          timestamp,
          emotion,
          cumulativePositive,
          cumulativeNegative
        };
      });

      const total = rows.length;
      const positiveRatio = Math.round((positiveCount / total) * 10000) / 100;
      const negativeRatio = Math.round((negativeCount / total) * 10000) / 100;
      const neutralRatio = Math.round((neutralCount / total) * 10000) / 100;

      let overallSentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (positiveRatio > negativeRatio + 10) {
        overallSentiment = 'positive';
      } else if (negativeRatio > positiveRatio + 10) {
        overallSentiment = 'negative';
      }

      return {
        trend,
        overallSentiment,
        positiveRatio,
        negativeRatio,
        neutralRatio
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get emotion trend', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  // V4: 检查对话选项是否满足条件（关系/任务/物品要求）
  async checkConditionalDialogue(
    saveId: ID,
    npcId: ID,
    optionId: ID,
  ): Promise<ConditionalCheckResult> {
    try {
      // 1. 获取对话上下文（含可用选项）
      const context = await this.getDialogueContext(saveId, npcId);

      // 2. 在availableOptions中查找匹配的选项
      const option = context.availableOptions.find(opt => opt.id === optionId);

      if (!option) {
        return {
          available: false,
          optionId,
          blockedReason: 'Option not found',
          requirements: {}
        };
      }

      // 3. 初始化检查结果
      const result: ConditionalCheckResult = {
        available: true,
        optionId,
        requirements: {}
      };

      // 4. 检查任务完成要求（requiresQuest）
      // S3-3: 迁移到构造注入的 IQuestService.isQuestCompleted 端口调用
      if (option.requiresQuest) {
        result.requirements.questRequired = option.requiresQuest;
        result.requirements.questCompleted = await this.questService.isQuestCompleted(saveId, option.requiresQuest);
      }

      // 5. 检查物品拥有要求（requiresItem）
      // S3-3: 迁移到 IInventoryService.hasItem 端口调用
      if (option.requiresItem) {
        result.requirements.itemRequired = option.requiresItem;
        result.requirements.itemOwned = await this.inventoryService.hasItem(saveId, option.requiresItem);
      }

      this.logger.info('Conditional dialogue checked', {
        saveId,
        npcId,
        optionId,
        available: result.available,
        blockedReason: result.blockedReason
      });

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check conditional dialogue', { saveId, npcId, optionId, error: errorMessage });
      throw error;
    }
  }

  // V5: 处理对话选择（验证条件→记录选择→触发效果→NPC回复→更新选项）
  // S3-3: 单事务包裹"记录选择 + 执行效果 + NPC 回复"，保证原子性
  async processDialogueChoice(
    saveId: ID,
    npcId: ID,
    choiceId: ID,
  ): Promise<DialogueChoiceResult> {
    try {
      // 1. 先调用checkConditionalDialogue验证可用性（同时获取匹配的option）
      const conditionResult = await this.checkConditionalDialogue(saveId, npcId, choiceId);

      if (!conditionResult.available) {
        return {
          success: false,
          choiceId,
          effectsApplied: [],
          error: conditionResult.blockedReason || 'Option not available'
        };
      }

      // 2. 从对话上下文中找到匹配的选项，读取内联的效果和回复
      const context = await this.getDialogueContext(saveId, npcId);
      const selectedOption = context.availableOptions.find(opt => opt.id === choiceId);

      // 3. 单事务包裹：记录选择 + 执行效果 + NPC 回复（保证原子性）
      const txResult = await this.txManager.transaction(async (trx) => {
        const playerMessage = await this.addDialogueMessageInTrx(trx, saveId, {
          saveId,
          npcId,
          speaker: 'player',
          content: `Player selected choice: ${choiceId}`,
          emotion: 'neutral'
        });

        // 4. 解析并执行选择效果（从选项对象内联读取）
        const effectsApplied: DialogueEffect[] = [];
        const effects = selectedOption?.effects || [];

        for (const effect of effects) {
          const appliedEffect = await this.executeDialogueEffectInTrx(trx, saveId, npcId, effect);
          effectsApplied.push(appliedEffect);
        }

        // 5. 生成NPC回复（从选项对象内联读取）
        const responseConfig = selectedOption?.response;
        let npcResponse: DialogueMessage | undefined;

        if (responseConfig) {
          const responseContent = responseConfig.responseTemplate.replace('{npcName}', context.npcName);
          npcResponse = await this.addDialogueMessageInTrx(trx, saveId, {
            saveId,
            npcId,
            speaker: context.npcName,
            content: responseContent,
            emotion: responseConfig.emotion
          });
        }

        return { playerMessage, npcResponse, effectsApplied };
      });

      // 事务提交后发送事件（与 addDialogueMessage 公共方法模式一致）
      // 006 升级：通过 emitDialogueEvent 统一补充 player 信息（设计文档 §7.3）
      if (txResult.playerMessage.npcId) {
        await this.emitDialogueEvent(saveId, txResult.playerMessage.npcId, 'player');
      }
      if (txResult.npcResponse?.npcId) {
        await this.emitDialogueEvent(saveId, txResult.npcResponse.npcId, context.npcName);
      }

      // 6. 重新生成可用选项（模块2 简化后选项不再依赖关系值，但保持行为一致性）
      const newContext = await this.getDialogueContext(saveId, npcId);

      this.logger.info('Dialogue choice processed', {
        saveId,
        npcId,
        choiceId,
        effectsCount: txResult.effectsApplied.length,
        hasNpcResponse: !!txResult.npcResponse
      });

      return {
        success: true,
        choiceId,
        effectsApplied: txResult.effectsApplied,
        npcResponse: txResult.npcResponse,
        newOptions: newContext.availableOptions
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to process dialogue choice', { saveId, npcId, choiceId, error: errorMessage });
      return {
        success: false,
        choiceId,
        effectsApplied: [],
        error: errorMessage
      };
    }
  }

  private buildDialogueOptionId(npcId: ID, key: string): ID {
    return `${String(npcId)}:${key}` as ID;
  }

  /**
   * 事务内执行单个对话效果（供 processDialogueChoice 事务内调用）。
   *
   * S3-3 重构 + 模块2 简化:
   * - relation_change: 已删除（NPC_PARTY 不写关系数据，由 GM 通过 entity_graph_service.set_relationship 维护）
   * - quest_trigger: 迁移到 questService.createQuest（透传 trx）
   * - item_grant: 迁移到 inventoryService.addItem（透传 trx），移除直接 DB insert fallback
   * - topic_switch / emotion_change: 无 DB 操作
   */
  private async executeDialogueEffectInTrx(
    trx: Knex.Transaction,
    saveId: ID,
    npcId: ID,
    effect: DialogueEffect,
  ): Promise<DialogueEffect> {
    switch (effect.type) {
      case 'quest_trigger':
        if (effect.data) {
          const questType = (effect.data as Record<string, unknown>).questType as string || 'side';
          const quest = await this.questService.createQuest(saveId, {
            name: questType,
            description: '',
            type: questType as QuestType,
            giverNpcId: String(npcId),
          }, trx);
          this.logger.info('Quest triggered', { saveId, npcId, questId: quest.id, questType });
        }
        break;

      case 'item_grant':
        if (effect.target) {
          let itemName = effect.target as string;
          let itemType: ItemCategory = 'misc';
          let itemRarity: ItemQuality = 'common';
          let itemMaxDurability = 100;

          if (this.templateService) {
            try {
              const templates = await this.templateService.getTemplates();
              for (const template of templates) {
                const items = template.items ?? [];
                const matched = items.find(item => {
                  const id = (item as Record<string, unknown>).id;
                  const rawId = (item as Record<string, unknown>).raw_id
                    ?? ((item as Record<string, unknown>).custom_data as Record<string, unknown>)?.raw_id;
                  return id === effect.target || rawId === effect.target;
                });
                if (matched) {
                  itemName = (matched as Record<string, unknown>).name as string || itemName;
                  itemType = ((matched as Record<string, unknown>).category as ItemCategory) || itemType;
                  itemRarity = ((matched as Record<string, unknown>).quality as ItemQuality) || itemRarity;
                  break;
                }
              }
            } catch {
              this.logger.warn('Failed to get item definition from TemplateService', { target: effect.target });
            }
          }

          const granted = await this.inventoryService.addItem({
            saveId,
            name: itemName,
            category: itemType,
            quantity: 1,
            quality: itemRarity,
            durability: itemMaxDurability,
            maxDurability: itemMaxDurability,
            weight: 0,
            maxStack: 1
          }, trx);

          this.logger.info('Item granted via InventoryService', { saveId, itemId: granted.id, target: effect.target });
        }
        break;

      case 'topic_switch':
      case 'emotion_change':
        // 这些效果仅记录到返回值中，不需要DB操作
        break;

      default:
        this.logger.warn('Unknown dialogue effect type', { type: effect.type });
    }

    return effect;
  }

  private generateDialogueOptions(
    npcId: ID,
    npcName: string,
  ): Array<{
    id: ID;
    text: string;
    npcId: ID;
    emotion?: string;
    effects?: DialogueEffect[];
    response?: { emotion: string; responseTemplate: string };
  }> {
    const options: Array<{
      id: ID;
      text: string;
      npcId: ID;
      emotion?: string;
      effects?: DialogueEffect[];
      response?: { emotion: string; responseTemplate: string };
    }> = [];

    options.push({
      id: this.buildDialogueOptionId(npcId, 'situation'),
      text: `询问${npcName}关于当前的情况`,
      npcId,
      emotion: 'neutral',
      effects: [{ type: 'topic_switch', value: 'situation' }],
      response: { emotion: 'neutral', responseTemplate: '{npcName}向你说明了当前的情况...' }
    });

    // 模块2 简化：删除 relationValue 阈值判断（NPC_PARTY 不再读关系数据）
    options.push({
      id: this.buildDialogueOptionId(npcId, 'deep-talk'),
      text: `与${npcName}深入交谈`,
      npcId,
      emotion: 'friendly',
      effects: [
        { type: 'emotion_change', value: 'friendly' }
      ],
      response: { emotion: 'friendly', responseTemplate: '{npcName}很高兴能与你深入交谈...' }
    });

    options.push({
      id: this.buildDialogueOptionId(npcId, 'help-request'),
      text: `请求${npcName}的帮助或建议`,
      npcId,
      emotion: 'grateful',
      effects: [
        { type: 'emotion_change', value: 'grateful' },
        { type: 'quest_trigger', data: { questType: 'help_request' } }
      ],
      response: { emotion: 'grateful', responseTemplate: '{npcName}欣然同意帮助你...' }
    });

    options.push({
      id: this.buildDialogueOptionId(npcId, 'farewell'),
      text: '告别',
      npcId,
      emotion: 'neutral',
      effects: [{ type: 'topic_switch', value: 'farewell' }],
      response: { emotion: 'neutral', responseTemplate: '{npcName}向你道别，希望下次再见...' }
    });

    return options;
  }
}
