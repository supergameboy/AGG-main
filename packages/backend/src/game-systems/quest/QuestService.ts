import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp } from '../../../../shared/src/types/core.js';
import { TemplateRuleParser } from '../shared/rule-parser/TemplateRuleParser.js';
import type {
  IQuestRepository,
  IQuestObjectiveRepository,
  IQuestService,
  Quest,
  QuestObjective,
  QuestStatus,
  QuestType,
  ObjectiveType,
  QuestDetail,
  CreateQuestInput,
  QuestChainInfo,
} from './types.js';
import type { QuestReward, QuestConditions, EventTrigger } from '../../../../shared/src/types/game.js';
import type { INPCService } from '../npc/types.js';
import type { ICharacterService } from '../character/types.js';
import type { IInventoryService, AddItemParams } from '../inventory/types.js';
import type { ISkillService } from '../skill/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import type { EventBus, BusEvent, BusEventType } from '@ai-rpg/shared/messaging';
import { QuestEntityResolver } from './QuestEntityResolver.js';
import { EntityResolutionError } from '../shared/entity-resolver/EntityResolutionError.js';

export {
  Quest,
  QuestObjective,
  QuestReward,
  QuestStatus,
  QuestType,
  ObjectiveType,
  QuestDetail,
  CreateQuestInput,
  QuestChainInfo,
};

/**
 * Quest 领域 Service（S3-1 Phase B 重构：Repository 模式 + 端口注入）。
 *
 * 依赖注入（9 个端口，必填在前可选在后——TypeScript 语法约束）:
 * - questRepo / objectiveRepo: 领域内 2 张表的 Repository（必填）
 * - txManager: 事务管理抽象（必填）
 * - ruleParser: 任务规则解析（max_active/fail_conditions/time_system，必填——bootstrap 用空源 TemplateRuleParser）
 * - npcService: 跨领域 NPC 解析（resolveNpcId，可选——bootstrap 订阅实例不需要）
 * - characterService: 跨领域角色经验/货币发放（grantExperience/modifyCurrency，可选——同上）
 * - inventoryService: 跨领域物品奖励发放（addItem，可选——同上）
 * - skillService: 跨领域技能奖励发放（learnSkill，可选——同上）
 * - eventBus: 事件总线（可选，状态变更通知）
 *
 * 4 个跨领域服务设为可选的设计理由：index.ts 的 bootstrap 实例仅用于 EventBus 订阅
 * （handleGameEvent → updateObjective 路径不触及跨领域服务），per-request 实例由
 * QuestServiceTool.createQuestService 注入全部 9 个参数。grantRewards/createQuest
 * 内置 guard 防止 bootstrap 误调跨领域路径。
 *
 * 事务补齐（D10 + 设计 §2.5）: createQuest / completeQuest / autoUnlockDependentQuests
 * 通过 txManager.transaction 包裹，eventBus.emit 在事务提交后执行。
 *
 * D9: 私有方法 grantRewards/autoUnlockDependentQuests/checkAllPrerequisitesCompleted
 * 支持 trx 参数透传，供事务内调用。
 *
 * 注: 构造函数参数顺序为 TypeScript 语法约束（必填参数不能跟在可选参数后），
 * 与设计文档签名顺序不同，Step 13 文档维护时同步修订设计文档。
 */
export class QuestService implements IQuestService {
  private readonly logger: ReturnType<typeof createChildLogger>;

  constructor(
    private readonly questRepo: IQuestRepository,
    private readonly objectiveRepo: IQuestObjectiveRepository,
    private readonly txManager: ITransactionManager,
    private readonly ruleParser: TemplateRuleParser,
    private readonly questResolver: QuestEntityResolver,
    private readonly npcService?: INPCService,
    private readonly characterService?: ICharacterService,
    private readonly inventoryService?: IInventoryService,
    private readonly skillService?: ISkillService,
    private readonly eventBus?: EventBus,
  ) {
    this.logger = createChildLogger('service:quest');
  }

  private emitQuestUpdate(saveId: string, quest: Quest, oldStatus: string): void {
    if (!this.eventBus) return;
    this.eventBus.emit('quest_update', {
      type: 'quest_update',
      saveId,
      data: {
        questId: quest.id,
        questName: quest.name,
        oldStatus,
        newStatus: quest.status,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * 检查任务完成状态（IQuestService 端口实现，跨领域只读查询）。
   * 覆盖 DialogueService L649 直接 SELECT quests 检查任务完成状态。
   * 支持 ID 或名称查询（findById → findByName 兜底），任务不存在返回 false。
   */
  async isQuestCompleted(saveId: ID, questIdOrName: string, trx?: Knex.Transaction): Promise<boolean> {
    const byId = await this.questRepo.findById(questIdOrName as ID, saveId, trx);
    if (byId) return byId.status === 'completed';

    const byName = await this.questRepo.findByName(saveId, questIdOrName, trx);
    if (byName) return byName.status === 'completed';

    return false;
  }

  async listQuests(saveId: ID, statusFilter?: QuestStatus, visibility?: 'all' | 'visible'): Promise<QuestDetail[]> {
    try {
      const options: { status?: QuestStatus; visible?: boolean } = {};
      if (statusFilter) options.status = statusFilter;
      if (visibility === 'visible') options.visible = true;

      const quests = await this.questRepo.findBySaveId(saveId, options);

      const questsWithObjectives = await Promise.all(
        quests.map(async (quest) => {
          if (!quest.id) {
            return { ...quest, objectives: [], progressPercent: 0, canComplete: false };
          }
          const objectives = await this.objectiveRepo.findByQuestId(quest.id as ID, saveId);
          const progressPercent = this.calculateProgress({ ...quest, objectives });
          const canComplete = this.checkAllObjectivesCompleted(objectives);
          return { ...quest, objectives, progressPercent, canComplete };
        })
      );

      return questsWithObjectives;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get quests', { saveId, statusFilter, visibility, error: errorMessage });
      throw error;
    }
  }

  async getQuest(saveId: ID, questId: ID): Promise<QuestDetail> {
    try {
      const resolvedId = await this.resolveQuestId(questId, saveId);
      const quest = await this.questRepo.findById(resolvedId as ID, saveId);
      if (!quest) throw new Error(`Quest not found: ${questId}. 建议：使用 list_quests 查看所有任务，或使用 create_quest 创建新任务`);

      const objectives = await this.objectiveRepo.findByQuestId(resolvedId as ID, saveId);
      const progressPercent = this.calculateProgress({ ...quest, objectives });
      const canComplete = this.checkAllObjectivesCompleted(objectives);

      return {
        ...quest,
        objectives,
        progressPercent,
        canComplete
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get quest detail', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async resolveQuestId(questIdOrName: string, saveId: ID): Promise<string> {
    if (!questIdOrName || typeof questIdOrName !== 'string') {
      throw new Error('任务ID不能为空');
    }

    /**
     * 委托给 QuestEntityResolver 统一设施（13.2 规则收敛）。
     * - name/id 双兼容 + 时间戳兼容由 EntityResolverBase 提供
     * - 失败抛 EntityResolutionError（含候选列表），转为对调用方友好的 Error 信息
     */
    try {
      const resolved = await this.questResolver.resolve({
        saveId,
        entityType: 'quest',
        ref: questIdOrName,
      });
      return resolved.entityId;
    } catch (error) {
      if (error instanceof EntityResolutionError) {
        throw new Error(getErrorMessage(error));
      }
      throw error;
    }
  }

  async getActiveQuests(saveId: ID): Promise<QuestDetail[]> {
    try {
      const quests = await this.listQuests(saveId, 'active');
      const details: QuestDetail[] = [];

      for (const quest of quests) {
        const detail = await this.getQuest(saveId, quest.id);
        if (detail) {
          if (this.ruleParser.getQuestRules().fail_conditions.includes('timeout') && this.ruleParser.getQuestRules().time_system) {
            const timeLimit = quest.timeLimit;
            if (timeLimit > 0) {
              const elapsed = Date.now() - quest.createdAt;
              if (elapsed > timeLimit) {
                await this.failQuest(saveId, quest.id);
                continue;
              }
            }
          }
          details.push(detail);
        }
      }

      return details;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get active quests', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getAvailableQuests(saveId: ID): Promise<Quest[]> {
    return this.listQuests(saveId, 'available');
  }

  /**
   * 创建任务（事务补齐：quest 插入 + objectives 循环插入原子化）。
   *
   * S3-3: 新增可选 trx 参数，支持事务透传（dialogue processDialogueChoice 单事务包裹所有效果）。
   * 事务策略（与 InventoryService.addItem 模式一致，避免嵌套事务）:
   * - 传入 trx: 在已有事务内执行，所有 Repository 调用透传 trx，不开新事务
   * - 未传 trx: 用 txManager.transaction 开新事务（保持原 createQuest 行为）
   * 实现方式: 抽取 createQuestInTrx(trx, ...) 私有方法，公共方法按 trx 参数分支。
   */
  async createQuest(saveId: ID, input: CreateQuestInput, trx?: Knex.Transaction): Promise<Quest> {
    try {
      const now = Date.now() as Timestamp;
      const initialStatus: QuestStatus = input.prerequisiteQuestIds && input.prerequisiteQuestIds.length > 0 ? 'locked' : 'available';

      let resolvedGiverNpcId: string | null = null;
      if (input.giverNpcId) {
        if (!this.npcService) {
          throw new Error('npcService is required for createQuest with giverNpcId, but not injected (bootstrap context)');
        }
        resolvedGiverNpcId = await this.npcService.resolveNpcId(saveId, input.giverNpcId, trx);
      }

      const executeInTrx = async (innerTrx: Knex.Transaction): Promise<Quest> => {
        return this.createQuestInTrx(innerTrx, saveId, input, now, initialStatus, resolvedGiverNpcId);
      };

      const quest = trx
        ? await executeInTrx(trx)
        : await this.txManager.transaction(executeInTrx);

      this.logger.info('Quest created', { questId: quest.id, name: input.name, saveId });
      return quest;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to create quest', { saveId, input, error: errorMessage });
      throw error;
    }
  }

  /**
   * createQuest 的事务内实现（私有方法，避免嵌套事务）。
   * quest 插入 + objectives 循环插入，由调用方控制事务边界。
   */
  private async createQuestInTrx(
    trx: Knex.Transaction,
    saveId: ID,
    input: CreateQuestInput,
    now: Timestamp,
    initialStatus: QuestStatus,
    resolvedGiverNpcId: string | null,
  ): Promise<Quest> {
    const questEntity: Omit<Quest, 'id'> & { id?: ID } = {
      saveId,
      name: input.name,
      description: input.description ?? '',
      type: input.type ?? 'side',
      status: initialStatus,
      visible: input.visible ?? false,
      prerequisiteQuestIds: input.prerequisiteQuestIds ?? [],
      conditions: input.conditions,
      giverNpcId: resolvedGiverNpcId,
      giverLocationId: input.giverLocationId ?? null,
      questChainId: input.questChainId ?? null,
      rewards: input.rewards ?? {},
      timeLimit: 0,
      customData: {},
      createdAt: now,
      updatedAt: now,
    };

    const insertedQuest = await this.questRepo.insert(questEntity, saveId, trx);

    if (input.objectives && input.objectives.length > 0) {
      for (const obj of input.objectives) {
        const objectiveEntity: Omit<QuestObjective, 'id'> & { id?: ID } = {
          questId: insertedQuest.id,
          description: obj.description,
          type: obj.type,
          target: obj.target,
          required: obj.required ?? 1,
          current: 0,
          completed: false,
          eventTrigger: obj.eventTrigger,
        };
        await this.objectiveRepo.insert(objectiveEntity, saveId, trx);
      }
    }

    return insertedQuest;
  }

  async acceptQuest(saveId: ID, questId: ID): Promise<QuestDetail> {
    try {
      const quest = await this.getQuest(saveId, questId);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      if (quest.status !== 'available') {
        throw new Error(`Quest ${quest.name} is not available for acceptance (current status: ${quest.status})`);
      }

      const maxActive = this.ruleParser.getQuestRules().max_active;
      const activeQuests = await this.listQuests(saveId, 'active');
      if (activeQuests.length >= maxActive) {
        throw new Error(`Cannot accept quest: maximum active quest limit (${maxActive}) reached`);
      }

      await this.questRepo.update(questId, saveId, { status: 'active' });

      this.logger.info('Quest accepted', { questId, name: quest.name });

      const updatedQuest = await this.getQuest(saveId, questId);
      this.emitQuestUpdate(saveId, updatedQuest, 'available');

      return updatedQuest!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to accept quest', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async updateQuest(saveId: ID, questId: ID, fields: {
    name?: string; description?: string; customData?: Record<string, unknown>;
    status?: QuestStatus; visible?: boolean;
    prerequisiteQuestIds?: string[]; conditions?: Record<string, unknown>;
    giverLocationId?: string; questChainId?: string;
  }): Promise<QuestDetail> {
    try {
      const resolvedId = await this.resolveQuestId(questId, saveId);
      const quest = await this.getQuest(saveId, resolvedId as ID);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      const patch: Partial<Quest> = {};
      if (fields.name !== undefined) patch.name = fields.name;
      if (fields.description !== undefined) patch.description = fields.description;
      if (fields.customData !== undefined) patch.customData = fields.customData;
      if (fields.status !== undefined) patch.status = fields.status;
      if (fields.visible !== undefined) patch.visible = fields.visible;
      if (fields.prerequisiteQuestIds !== undefined) patch.prerequisiteQuestIds = fields.prerequisiteQuestIds;
      if (fields.conditions !== undefined) patch.conditions = fields.conditions as QuestConditions;
      if (fields.giverLocationId !== undefined) patch.giverLocationId = fields.giverLocationId;
      if (fields.questChainId !== undefined) patch.questChainId = fields.questChainId;

      await this.questRepo.update(resolvedId as ID, saveId, patch);

      this.logger.info('Quest updated', { questId: resolvedId, fields: Object.keys(fields) });

      return (await this.getQuest(saveId, resolvedId as ID))!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update quest', { saveId, questId, fields, error: errorMessage });
      throw error;
    }
  }

  async updateObjective(saveId: ID, objectiveId: ID, delta: number): Promise<QuestObjective> {
    try {
      const objective = await this.objectiveRepo.findById(objectiveId, saveId);
      if (!objective) throw new Error(`Objective not found: ${objectiveId}`);

      const newCurrent = Math.max(0, Math.min(objective.required, objective.current + delta));
      const isCompleted = newCurrent >= objective.required;

      const updated = await this.objectiveRepo.update(objectiveId, saveId, {
        current: newCurrent,
        completed: isCompleted,
      });

      this.logger.info('Objective updated', {
        objectiveId,
        delta,
        current: newCurrent,
        required: objective.required,
        completed: isCompleted,
      });

      return updated ?? objective;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to update objective', { saveId, objectiveId, delta, error: errorMessage });
      throw error;
    }
  }

  /**
   * 完成任务（事务补齐：发放奖励 + 状态变更 + 自动解锁依赖任务原子化）。
   * 事件发射在事务提交后执行。
   */
  async completeQuest(saveId: ID, questId: ID): Promise<QuestDetail> {
    try {
      const quest = await this.getQuest(saveId, questId);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      if (quest.status !== 'active') {
        throw new Error(`Quest ${quest.name} is not active (current status: ${quest.status})`);
      }

      if (!quest.canComplete) {
        throw new Error(`Quest ${quest.name} cannot be completed - not all objectives are finished`);
      }

      const unlockedQuests = await this.txManager.transaction(async (trx) => {
        await this.grantRewards(saveId, quest, trx);
        await this.questRepo.update(questId, saveId, { status: 'completed' }, trx);
        return await this.autoUnlockDependentQuests(saveId, questId, trx);
      });

      this.logger.info('Quest completed', { questId, name: quest.name, rewards: quest.rewards });
      this.emitQuestUpdate(saveId, quest, 'active');

      for (const unlocked of unlockedQuests) {
        this.emitQuestUpdate(saveId, unlocked, 'locked');
      }

      return (await this.getQuest(saveId, questId))!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to complete quest', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async failQuest(saveId: ID, questId: ID): Promise<QuestDetail> {
    try {
      const quest = await this.getQuest(saveId, questId);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      if (quest.status !== 'active' && quest.status !== 'available') {
        throw new Error(`Quest ${quest.name} cannot be failed (current status: ${quest.status}, allowed: active, available)`);
      }

      await this.questRepo.update(questId, saveId, { status: 'failed' });

      this.logger.info('Quest failed', { questId, name: quest.name });
      this.emitQuestUpdate(saveId, quest, quest.status);

      return (await this.getQuest(saveId, questId))!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to fail quest', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async abandonQuest(saveId: ID, questId: ID): Promise<void> {
    try {
      const quest = await this.getQuest(saveId, questId);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      if (quest.status !== 'active') {
        throw new Error(`Quest ${quest.name} is not active (current status: ${quest.status})`);
      }

      await this.questRepo.update(questId, saveId, { status: 'failed' });

      this.logger.info('Quest abandoned and marked as failed', { questId, name: quest.name });
      this.emitQuestUpdate(saveId, quest, 'active');
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to abandon quest', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async lockQuest(saveId: ID, questId: ID): Promise<QuestDetail> {
    try {
      const resolvedId = await this.resolveQuestId(questId, saveId);
      const quest = await this.getQuest(saveId, resolvedId as ID);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      await this.questRepo.update(resolvedId as ID, saveId, { status: 'locked' });

      this.logger.info('Quest locked', { questId: resolvedId, name: quest.name });

      return (await this.getQuest(saveId, resolvedId as ID))!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to lock quest', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async unlockQuest(saveId: ID, questId: ID): Promise<QuestDetail> {
    try {
      const resolvedId = await this.resolveQuestId(questId, saveId);
      const quest = await this.getQuest(saveId, resolvedId as ID);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      await this.questRepo.update(resolvedId as ID, saveId, { status: 'available' });

      this.logger.info('Quest unlocked', { questId: resolvedId, name: quest.name });
      this.emitQuestUpdate(saveId, quest, 'locked');

      return (await this.getQuest(saveId, resolvedId as ID))!;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to unlock quest', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async checkFailConditions(saveId: ID, questId: ID, event: string, eventData?: Record<string, unknown>): Promise<boolean> {
    try {
      const quest = await this.getQuest(saveId, questId);
      if (!quest || (quest.status !== 'active' && quest.status !== 'available')) return false;

      const failConditions = this.ruleParser.getQuestRules().fail_conditions;
      if (failConditions.length === 0) return false;

      if (event === 'timeout' && failConditions.includes('timeout') && this.ruleParser.getQuestRules().time_system) {
        const timeLimit = quest.timeLimit;
        if (timeLimit > 0) {
          const elapsed = Date.now() - quest.createdAt;
          if (elapsed > timeLimit) {
            await this.failQuest(saveId, questId);
            this.logger.info('Quest failed due to timeout', { questId, name: quest.name, timeLimit, elapsed });
            return true;
          }
        }
      }

      if (event === 'npc_death' && failConditions.includes('npc_death')) {
        const npcId = eventData?.npcId as string | undefined;
        if (npcId && quest.giverNpcId === npcId) {
          await this.failQuest(saveId, questId);
          this.logger.info('Quest failed due to related NPC death', { questId, name: quest.name, npcId });
          return true;
        }
      }

      if (event === 'item_lost' && failConditions.includes('item_lost')) {
        const itemId = eventData?.itemId as string | undefined;
        const itemName = eventData?.itemName as string | undefined;
        if (itemId || itemName) {
          const hasRelevantObjective = quest.objectives.some(obj =>
            obj.type === 'collect' && !obj.completed &&
            (obj.target === itemId || obj.target === itemName)
          );
          if (hasRelevantObjective) {
            await this.failQuest(saveId, questId);
            this.logger.info('Quest failed due to required item lost', { questId, name: quest.name, itemId, itemName });
            return true;
          }
        }
      }

      if (event === 'enemy_escapes' && failConditions.includes('enemy_escapes')) {
        const enemyId = eventData?.enemyId as string | undefined;
        const enemyName = eventData?.enemyName as string | undefined;
        if (enemyId || enemyName) {
          const hasRelevantObjective = quest.objectives.some(obj =>
            obj.type === 'kill' && !obj.completed &&
            (obj.target === enemyId || obj.target === enemyName)
          );
          if (hasRelevantObjective) {
            await this.failQuest(saveId, questId);
            this.logger.info('Quest failed due to target enemy escaped', { questId, name: quest.name, enemyId, enemyName });
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check fail conditions', { saveId, questId, event, error: errorMessage });
      return false;
    }
  }

  async checkQuestCompletion(saveId: ID, questId: ID): Promise<boolean> {
    try {
      const quest = await this.getQuest(saveId, questId);
      if (!quest) throw new Error(`Quest not found: ${questId}`);
      return quest.canComplete;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check quest completion', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  calculateProgress(quest: Pick<QuestDetail, 'objectives'>): number {
    if (!quest.objectives || quest.objectives.length === 0) return 0;

    let totalRequired = 0;
    let totalCurrent = 0;

    for (const obj of quest.objectives) {
      totalRequired += obj.required;
      totalCurrent += obj.current;
    }

    if (totalRequired === 0) return 0;

    return Math.round((totalCurrent / totalRequired) * 100);
  }

  async getQuestsByGiver(saveId: ID, npcId: string): Promise<Quest[]> {
    try {
      return await this.questRepo.findByNpcId(saveId, npcId as ID);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get quests by giver', { saveId, npcId, error: errorMessage });
      throw error;
    }
  }

  async getMainQuest(saveId: ID): Promise<QuestDetail> {
    try {
      const quest = await this.questRepo.findMainQuest(saveId);
      if (!quest) throw new Error("当前无主线任务. 建议：使用 create_quest 创建主线任务，或使用 get_available_quests 查看可接取的任务");

      return this.getQuest(saveId, quest.id as ID);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get main quest', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getQuestChainInfo(saveId: ID, questId: ID): Promise<QuestChainInfo> {
    try {
      const quest = await this.getQuest(saveId, questId);
      if (!quest) throw new Error(`Quest not found: ${questId}`);

      const prerequisiteIds = quest.prerequisiteQuestIds ?? [];
      const prerequisites: Array<{ id: ID; name: string; completed: boolean }> = [];

      for (const preId of prerequisiteIds) {
        const preQuest = await this.getQuest(saveId, preId);
        prerequisites.push({
          id: preId,
          name: preQuest?.name ?? '未知任务',
          completed: preQuest?.status === 'completed',
        });
      }

      const allPrerequisitesCompleted = prerequisites.length === 0 || prerequisites.every(p => p.completed);
      const isUnlocked = !quest.prerequisiteQuestIds || quest.prerequisiteQuestIds.length === 0 || allPrerequisitesCompleted;

      this.logger.info('Quest chain info retrieved', { saveId, questId, isUnlocked });

      return {
        questId: quest.id,
        name: quest.name,
        status: quest.status,
        prerequisiteId: prerequisiteIds.length > 0 ? prerequisiteIds[0] : null,
        prerequisiteName: prerequisites.length > 0 ? prerequisites[0].name : null,
        prerequisiteCompleted: allPrerequisitesCompleted,
        isUnlocked,
        prerequisites,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get quest chain info', { saveId, questId, error: errorMessage });
      throw error;
    }
  }

  async getAvailableChainedQuests(saveId: ID): Promise<QuestChainInfo[]> {
    try {
      const availableQuests = await this.listQuests(saveId, 'available');
      const chainInfos: QuestChainInfo[] = [];

      for (const quest of availableQuests) {
        const chainInfo = await this.getQuestChainInfo(saveId, quest.id);
        if (chainInfo.isUnlocked) {
          chainInfos.push(chainInfo);
        }
      }

      return chainInfos;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get available chained quests', { saveId, error: errorMessage });
      throw error;
    }
  }

  /**
   * 发放任务奖励（跨领域端口调用）。
   * D9: 支持 trx 参数，供 completeQuest 事务内调用。
   * - experience → characterService.grantExperience
   * - gold/currency → characterService.modifyCurrency
   * - items → inventoryService.addItem
   * - skills → skillService.learnSkill（D9: 透传 trx，在 completeQuest 事务内执行）
   */
  private async grantRewards(saveId: ID, quest: QuestDetail, trx?: Knex.Transaction): Promise<void> {
    const rewards = quest.rewards;
    if (!rewards || Object.keys(rewards).length === 0) return;
    if (!this.characterService || !this.inventoryService || !this.skillService) {
      throw new Error('Cross-domain services (character/inventory/skill) are required for grantRewards, but not injected (bootstrap context)');
    }

    if (rewards.experience) {
      await this.characterService.grantExperience(saveId, rewards.experience, trx);
    }

    if (rewards.gold) {
      await this.characterService.modifyCurrency(saveId, 'gold', rewards.gold, trx);
    }

    if (rewards.currency) {
      for (const [currencyId, value] of Object.entries(rewards.currency)) {
        if (value) {
          await this.characterService.modifyCurrency(saveId, currencyId, value, trx);
        }
      }
    }

    if (rewards.items) {
      for (const item of rewards.items) {
        const params: AddItemParams = {
          saveId,
          itemId: item.itemId,
          name: item.itemName || item.itemId,
          category: 'quest',
          quantity: item.quantity,
        };
        try {
          await this.inventoryService.addItem(params, trx);
        } catch (error) {
          this.logger.warn('Item reward failed', {
            saveId, questId: quest.id, itemId: item.itemId, error: getErrorMessage(error),
          });
        }
      }
    }

    if (rewards.skills) {
      for (const skill of rewards.skills) {
        try {
          const learnResult = await this.skillService.learnSkill(saveId, skill.skillId, true, 'character', undefined, undefined, trx);
          if (!learnResult.success) {
            this.logger.warn('Skill reward learn failed', {
              saveId, questId: quest.id, skillId: skill.skillId, error: learnResult.error,
            });
          }
        } catch (error) {
          this.logger.warn('Skill reward learn threw', {
            saveId, questId: quest.id, skillId: skill.skillId, error: getErrorMessage(error),
          });
        }
      }
    }

    this.logger.info('Rewards granted', { saveId, questId: quest.id, rewards });
  }

  private checkAllObjectivesCompleted(objectives: QuestObjective[]): boolean {
    if (!objectives || objectives.length === 0) return false;
    return objectives.every(obj => obj.completed);
  }

  /**
   * 自动解锁依赖已完成任务的锁定任务（事务补齐）。
   * D9: 支持 trx 参数，供 completeQuest 事务内调用。
   * 返回已解锁的 Quest 列表，供事务提交后发射事件。
   */
  private async autoUnlockDependentQuests(saveId: ID, completedQuestId: ID, trx?: Knex.Transaction): Promise<Quest[]> {
    try {
      const lockedQuests = await this.questRepo.findLockedByDependency(saveId, trx);
      const unlocked: Quest[] = [];

      for (const locked of lockedQuests) {
        const prereqs = locked.prerequisiteQuestIds;
        if (!Array.isArray(prereqs) || prereqs.length === 0) continue;
        if (!prereqs.includes(completedQuestId as string)) continue;

        const allCompleted = await this.checkAllPrerequisitesCompleted(saveId, prereqs, trx);
        if (allCompleted) {
          const updated = await this.questRepo.update(locked.id, saveId, { status: 'available' }, trx);
          if (updated) {
            unlocked.push(updated);
            this.logger.info('Auto-unlocked dependent quest', {
              questId: locked.id,
              triggeredBy: completedQuestId,
            });
          }
        }
      }

      return unlocked;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.warn('Auto-unlock check failed', { saveId, completedQuestId, error: errorMessage });
      return [];
    }
  }

  /**
   * 检查所有前置任务是否已完成。
   * D9: 支持 trx 参数，供 autoUnlockDependentQuests 事务内调用。
   */
  private async checkAllPrerequisitesCompleted(saveId: ID, prerequisiteIds: string[], trx?: Knex.Transaction): Promise<boolean> {
    const completedCount = await this.questRepo.countCompletedByIds(saveId, prerequisiteIds as ID[], trx);
    return completedCount === prerequisiteIds.length;
  }

  async handleGameEvent(event: BusEvent): Promise<void> {
    try {
      const activeQuests = await this.questRepo.findBySaveIdAndStatus(event.saveId as ID, 'active');
      const questIds = activeQuests.map(q => q.id);

      const objectives = await this.objectiveRepo.findEventTriggeredActiveByQuestIds(event.saveId as ID, questIds);

      for (const obj of objectives) {
        if (!obj.eventTrigger) continue;
        if (!this.matchEvent(obj.eventTrigger, event)) continue;

        await this.updateObjective(event.saveId, obj.id, 1);
        this.logger.info('Objective auto-updated by event', {
          objectiveId: obj.id,
          eventType: event.type,
        });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('handleGameEvent failed', { event, error: errorMessage });
    }
  }

  private matchEvent(trigger: EventTrigger, event: BusEvent): boolean {
    const typeMapping: Record<string, BusEventType> = {
      kill: 'kill',
      collect: 'item_change',
      talk: 'dialogue',
      explore: 'location_enter',
      enter_location: 'location_enter',
      use_item: 'use_item',
      craft: 'craft',
    };

    const expectedType = typeMapping[trigger.eventType];
    if (expectedType !== event.type) return false;

    if (trigger.targetId) {
      const targetField = this.getTargetField(event.type);
      return event.data[targetField] === trigger.targetId;
    }

    return true;
  }

  private getTargetField(eventType: BusEventType): string {
    const fieldMapping: Record<BusEventType, string> = {
      kill: 'npcId',
      item_change: 'itemId',
      dialogue: 'npcId',
      location_enter: 'locationId',
      equip_item: 'itemId',
      use_item: 'itemId',
      craft: 'itemId',
      story_progress: 'storyId',
      trigger_resolved: 'triggerId',
      quest_update: 'questId',
      'pacing:tension_change': 'saveId',
      'pacing:stage_change': 'saveId',
      'pacing:review_alert': 'saveId',
      // EG-M2-9: chapter_advanced 事件触发器字段（章节号）
      chapter_advanced: 'chapterNumber',
      // 006 升级：combat_end 事件触发器字段（combatId，对应 CombatEndData.combatId）
      combat_end: 'combatId',
      // M9：LLM 基础设施事件（非游戏触发器事件，穷举 Record 要求补齐）
      provider_config_changed: 'providerId',
      llm_metrics_event: 'providerId',
      // M6：工具执行生命周期事件（非游戏触发器事件，穷举 Record 要求补齐）
      before_tool_execute: 'toolType',
      after_tool_execute: 'toolType',
    };
    return fieldMapping[eventType];
  }
}
