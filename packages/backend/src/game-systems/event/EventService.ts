import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import type { EventBus, BusEvent } from '@ai-rpg/shared/messaging';
import type {
  GameEvent,
  EventTrigger,
  EventType,
  TriggerType,
  EventEffect,
  StoryEventRecord,
  EventRollResult,
  EventCheckResult,
  EventChain,
} from '@ai-rpg/shared/messaging';
import type { StoryEventInput, IStoryEventWriter } from '../story/types.js';
import type { ISaveRepository } from '../save/types.js';
import type { ITransactionManager } from '../../database/TransactionManager.js';
import type {
  IEventRepository,
  IEventTriggerRepository,
  IEventService,
  EventInsertInput,
} from './types.js';
import { storyEventToRecord } from './mappers.js';
import { EventEntityResolver } from './EventEntityResolver.js';
import { EntityResolutionError } from '../shared/entity-resolver/EntityResolutionError.js';

const ARCHIVAL_EVENT_TYPES = new Set<EventType>(['story', 'quest']);
const ARCHIVAL_EFFECT_TYPES = new Set<EventEffect['type']>(['quest_unlock']);

/**
 * Event 领域 Service（S3-1 重构后）。
 *
 * 依赖注入（D8 组合根，per-request 创建）:
 * - eventRepo: events 表 Repository（本领域，全局事件模板）
 * - triggerRepo: event_triggers 表 Repository（本领域，存档级触发记录）
 * - storyEventWriter: 跨领域 story_events 读写端口（D-S3-2 story 领域）
 * - saveRepo: 跨领域 saves 表只读端口（读取 chapter 用于事件归档）
 * - txManager: 事务管理端口
 * - eventBus: 事件总线（可选，用于发布 trigger_resolved/story_progress）
 *
 * 事务: resolveTrigger 通过 txManager 事务包裹多步写操作。
 * 跨领域访问: story_events → IStoryEventWriter 端口；saves → ISaveRepository 端口。
 */
export class EventService implements IEventService {
  private logger: ReturnType<typeof createChildLogger>;

  constructor(
    private readonly eventRepo: IEventRepository,
    private readonly triggerRepo: IEventTriggerRepository,
    private readonly storyEventWriter: IStoryEventWriter,
    private readonly saveRepo: ISaveRepository,
    private readonly txManager: ITransactionManager,
    private readonly eventResolver?: EventEntityResolver,
    private readonly eventBus?: EventBus,
  ) {
    this.logger = createChildLogger('service:event');
  }

  /**
   * 处理EventBus事件 — 自动检查触发条件
   * 将BusEvent事件映射到EventService的TriggerType，满足条件时自动触发
   */
  async handleBusEvent(event: BusEvent): Promise<void> {
    // BusEvent 事件类型 → EventService TriggerType 映射
    // - kill → combat_end：战斗结束触发
    // - location_enter → enter_location：进入地点触发
    // - quest_update → quest_complete：任务完成触发
    // 模块2 简化：删除 dialogue → relation_change 映射（DialogueService 不再产生 relation_change effect，映射成为死代码）
    // item_change 无对应 TriggerType，不订阅（如需物品发现触发，新增 discover_item TriggerType 后再加）
    const triggerTypeMap: Record<string, TriggerType> = {
      kill: 'combat_end',
      location_enter: 'enter_location',
      quest_update: 'quest_complete',
    };

    const triggerType = triggerTypeMap[event.type];
    if (!triggerType) return;

    // 从event.data提取上下文
    const context: Record<string, unknown> = {};
    if (event.data.locationId) context.locationId = event.data.locationId;
    if (event.data.npcId) context.npcId = event.data.npcId;
    if (event.data.itemId) context.itemId = event.data.itemId;

    // 检查满足条件的触发器
    const triggers = await this.checkTriggers(event.saveId, triggerType, context);

    // 自动触发满足条件的事件（仅非随机事件）
    for (const check of triggers.checks) {
      if (check.matched && check.triggers.length === 0) {
        // 条件匹配但没有已存在的trigger，查找匹配triggerType的事件模板并触发
        const events = await this.listEventTemplates(undefined);
        for (const evt of events.events) {
          if (evt.triggerType === triggerType) {
            try {
              await this.triggerEvent(event.saveId, evt.id, { source: 'eventbus', busEvent: event });
            } catch (error) {
              this.logger.warn('Auto-trigger from EventBus failed', {
                eventId: evt.id,
                error: getErrorMessage(error),
              });
            }
          }
        }
      } else if (check.matched && check.triggers.length > 0) {
        // 已有pending的trigger，直接触发
        for (const trigger of check.triggers) {
          try {
            await this.triggerEvent(event.saveId, trigger.eventId, { source: 'eventbus', busEvent: event });
          } catch (error) {
            this.logger.warn('Auto-trigger existing from EventBus failed', {
              triggerId: trigger.id,
              error: getErrorMessage(error),
            });
          }
        }
      }
    }
  }

  async resolveEventId(eventIdOrName: string, trx?: Knex.Transaction): Promise<ID | null> {
    /**
     * 优先委托给 EventEntityResolver 统一设施（13.2 规则收敛）。
     * - name/id 双兼容由 EntityResolverBase 提供
     * - 失败抛 EntityResolutionError（含候选列表），转为对调用方友好的 null 返回
     * - events 表无 save_id 字段，saveId 参数不用于过滤（保持接口一致性）
     *
     * 兜底路径：未注入 resolver 时（如 bootstrap 实例），回退到原 eventRepo.resolveEventId。
     */
    if (this.eventResolver) {
      try {
        // events 表无 save_id，saveId 传空字符串占位（resolver 内不使用）
        const resolved = await this.eventResolver.resolve({
          saveId: '' as ID,
          entityType: 'event',
          ref: eventIdOrName,
        }, trx);
        return resolved.entityId as ID;
      } catch (error) {
        if (error instanceof EntityResolutionError) {
          // not_found 或多匹配歧义，返回 null（保持原契约：调用方决定是否抛异常）
          this.logger.warn('Event resolution failed', {
            input: eventIdOrName,
            reason: error.reason,
            candidateCount: error.candidates.length,
          });
          return null;
        }
        throw error;
      }
    }

    // 兜底：未注入 resolver（bootstrap 路径）
    return this.eventRepo.resolveEventId(eventIdOrName, trx);
  }

  async listEventTemplates(typeFilter?: EventType, templateId?: string): Promise<{ events: GameEvent[]; hint?: string }> {
    try {
      const events = await this.eventRepo.findAll({ typeFilter, templateId });
      if (events.length === 0) {
        return { events: [], hint: '暂无事件模板. 建议：当前游戏世界尚无预设事件' };
      }
      return { events };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get event templates', { typeFilter, error: errorMessage });
      throw error;
    }
  }

  async getEvent(eventId: ID, templateId?: string, trx?: Knex.Transaction): Promise<GameEvent> {
    try {
      const event = await this.eventRepo.findById(eventId, { templateId }, trx);
      if (!event) {
        throw new Error(`Event not found: ${eventId}. 建议：使用 list_event_templates 查看所有事件模板`);
      }
      return event;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get event', { eventId, error: errorMessage });
      throw error;
    }
  }

  async checkTriggers(saveId: ID, eventType: TriggerType, context?: Record<string, unknown>, templateId?: string): Promise<EventCheckResult> {
    try {
      const events = await this.eventRepo.findByTriggerType(eventType, { templateId });

      const checks: EventCheckResult['checks'] = [];
      let totalMatched = 0;

      for (const event of events) {
        let matched = true;

        if (context && event.triggerData.conditions) {
          for (const [key, value] of Object.entries(event.triggerData.conditions as Record<string, unknown>)) {
            if (context[key] !== value) {
              matched = false;
              break;
            }
          }
        }

        const existingTriggers = await this.triggerRepo.findByEventId(saveId, event.id, {
          excludeStatuses: ['expired', 'failed'],
        });

        if (!event.repeatable && existingTriggers.length > 0) {
          matched = false;
        }

        if (matched) {
          totalMatched++;
        }

        checks.push({
          eventType,
          matched,
          triggers: existingTriggers,
        });
      }

      return { checks, totalMatched };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to check triggers', { saveId, eventType, error: errorMessage });
      throw error;
    }
  }

  async triggerEvent(saveId: ID, eventId: ID, context?: Record<string, unknown>, trx?: Knex.Transaction): Promise<EventTrigger> {
    try {
      const event = await this.getEvent(eventId, undefined, trx);
      const now = Date.now() as Timestamp;
      const triggerId = generateReadableId('evt', event.name || 'trigger') as ID;

      this.logger.info('Event triggered', { saveId, eventId, triggerId });

      return await this.triggerRepo.insert(
        {
          id: triggerId,
          eventId,
          triggeredAt: now,
          status: 'pending',
          resultData: context || {},
        },
        saveId,
        trx,
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to trigger event', { saveId, eventId, error: errorMessage });
      throw error;
    }
  }

  async resolveTrigger(saveId: ID, triggerId: ID, resultData?: Record<string, unknown>): Promise<EventTrigger> {
    try {
      const { updatedTrigger, event, archivalEvent } = await this.txManager.transaction(async (trx) => {
        const trigger = await this.triggerRepo.findById(triggerId, saveId, trx);
        if (!trigger) throw new Error(`Trigger not found: ${triggerId}`);
        if (trigger.status !== 'pending') throw new Error(`Trigger ${triggerId} is not pending`);

        const now = Date.now() as Timestamp;
        const updated = await this.triggerRepo.update(
          triggerId,
          saveId,
          { status: 'resolved', resolvedAt: now, resultData: resultData || {} },
          trx,
        );
        if (!updated) throw new Error(`Trigger update failed: ${triggerId}`);

        const event = await this.getEvent(trigger.eventId, undefined, trx);
        const archivalEvent = await this.buildArchivedStoryEvent(saveId, event, triggerId, resultData, trx);
        if (archivalEvent) {
          await this.addArchivedStoryEvent(saveId, archivalEvent, trx);
        }

        return { updatedTrigger: updated, event, archivalEvent };
      });

      this.logger.info('Trigger resolved', { saveId, triggerId });

      // 发布 trigger_resolved 事件到 EventBus
      if (this.eventBus) {
        this.eventBus.emit('trigger_resolved', {
          type: 'trigger_resolved',
          saveId,
          data: {
            triggerId,
            eventId: updatedTrigger.eventId,
            eventType: event.type,
            effects: event.effects,
            archivedStoryEvent: archivalEvent ? {
              chapter: archivalEvent.chapter,
              eventType: archivalEvent.event_type,
              title: archivalEvent.title,
              importance: archivalEvent.importance,
            } : undefined,
          },
          timestamp: Date.now(),
        });

        // 如果有归档事件，额外发布 story_progress
        if (archivalEvent) {
          this.eventBus.emit('story_progress', {
            type: 'story_progress',
            saveId,
            data: {
              chapter: archivalEvent.chapter,
              mainQuest: null,
              delta: [{ field: 'storyEvent', oldValue: null, newValue: archivalEvent.title }],
            },
            timestamp: Date.now(),
          });
        }
      }

      return updatedTrigger;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to resolve trigger', { saveId, triggerId, error: errorMessage });
      throw error;
    }
  }

  async getPendingTriggers(saveId: ID): Promise<{ triggers: EventTrigger[]; hint?: string }> {
    try {
      const triggers = await this.triggerRepo.findByStatus(saveId, 'pending');
      if (triggers.length === 0) {
        return { triggers: [], hint: '暂无待处理的事件触发. 建议：使用 check_triggers 检查是否有满足条件的事件' };
      }
      return { triggers };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get pending triggers', { saveId, error: errorMessage });
      throw error;
    }
  }

  async getTriggerHistory(saveId: ID, limit: number = 50): Promise<EventTrigger[]> {
    try {
      return await this.triggerRepo.findBySaveId(saveId, { limit });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get trigger history', { saveId, limit, error: errorMessage });
      throw error;
    }
  }

  async rollRandomEvent(saveId: ID, locationId: string, timePeriod: string, templateId?: string): Promise<EventRollResult> {
    try {
      const events = await this.eventRepo.findByType('random', { templateId });

      if (events.length === 0) {
        return {
          triggered: false,
          eventId: null,
          eventName: null,
          reason: 'No random events available',
          effects: [],
        };
      }

      const validEvents = events.filter(event => {
        if (event.triggerData.location_filter && event.triggerData.location_filter !== locationId) {
          return false;
        }
        if (event.triggerData.time_filter && event.triggerData.time_filter !== timePeriod) {
          return false;
        }
        return true;
      });

      if (validEvents.length === 0) {
        return {
          triggered: false,
          eventId: null,
          eventName: null,
          reason: 'No events match current conditions',
          effects: [],
        };
      }

      const totalWeight = validEvents.reduce((sum, e) => sum + (e.priority || 1), 0);
      let random = Math.random() * totalWeight;
      let selectedEvent = validEvents[0];

      for (const event of validEvents) {
        random -= (event.priority || 1);
        if (random <= 0) {
          selectedEvent = event;
          break;
        }
      }

      await this.triggerEvent(saveId, selectedEvent.id, {
        locationId,
        timePeriod,
        rollType: 'random',
      });

      this.logger.info('Random event rolled', {
        saveId,
        eventId: selectedEvent.id,
        eventName: selectedEvent.name,
      });

      return {
        triggered: true,
        eventId: selectedEvent.id,
        eventName: selectedEvent.name,
        reason: `Rolled with weight ${selectedEvent.priority}`,
        effects: selectedEvent.effects,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to roll random event', { saveId, locationId, timePeriod, error: errorMessage });
      throw error;
    }
  }

  async processChainEvents(saveId: ID, rootTriggerId: ID): Promise<EventChain> {
    try {
      return await this.txManager.transaction(async (trx) => {
        const rootTrigger = await this.triggerRepo.findById(rootTriggerId, saveId, trx);
        if (!rootTrigger) throw new Error(`Root trigger not found: ${rootTriggerId}`);

        const rootEvent = await this.getEvent(rootTrigger.eventId, undefined, trx);
        if (!rootEvent) throw new Error(`Root event not found: ${rootTrigger.eventId}`);

        const triggerData = rootEvent.triggerData;
        const chainEvents: EventChain['chainEvents'] = [];

        if (triggerData.chain_events && Array.isArray(triggerData.chain_events)) {
          for (const chainEvent of triggerData.chain_events) {
            if (chainEvent.delay && chainEvent.delay > 0) {
              await new Promise(resolve => setTimeout(resolve, chainEvent.delay));
            }

            const trigger = await this.triggerEvent(saveId, chainEvent.event_id as ID, {
              chainFrom: rootTriggerId,
              condition: chainEvent.condition,
            }, trx);

            chainEvents.push({
              eventId: chainEvent.event_id as ID,
              condition: chainEvent.condition || '',
              delay: chainEvent.delay || 0,
            });

            this.logger.info('Chain event processed', {
              saveId,
              chainEventId: chainEvent.event_id,
              triggerId: trigger.id,
            });
          }
        }

        return {
          rootEventId: rootTriggerId,
          chainEvents,
        };
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to process chain events', { saveId, rootTriggerId, error: errorMessage });
      throw error;
    }
  }

  async getTimeBasedEvents(saveId: ID, currentTime: Timestamp, templateId?: string): Promise<GameEvent[]> {
    try {
      const events = await this.eventRepo.findByType('time_based', { templateId });
      const matchedEvents: GameEvent[] = [];

      for (const event of events) {
        const triggerData = event.triggerData;

        if (triggerData.target_time) {
          const targetTime = typeof triggerData.target_time === 'number'
            ? triggerData.target_time
            : new Date(triggerData.target_time as string).getTime();

          const tolerance = typeof triggerData.tolerance === 'number' ? triggerData.tolerance : 0;

          if (Math.abs(currentTime - targetTime) <= tolerance) {
            matchedEvents.push(event);
          }
        }

        if (triggerData.recurring_pattern) {
          const interval = triggerData.interval as number || 3600000;

          if (currentTime % interval < 1000) {
            matchedEvents.push(event);
          }
        }
      }

      return matchedEvents;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get time-based events', { saveId, currentTime, error: errorMessage });
      throw error;
    }
  }

  async getStoryEvents(saveId: ID, chapter?: string): Promise<StoryEventRecord[]> {
    try {
      const storyEvents = await this.storyEventWriter.getStoryEvents(saveId, { chapter });
      return storyEvents.map(storyEventToRecord);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to get story events', { saveId, chapter, error: errorMessage });
      throw error;
    }
  }

  async recordStoryEvent(saveId: ID, eventData: Omit<StoryEventRecord, 'id' | 'saveId' | 'timestamp'>): Promise<StoryEventRecord> {
    try {
      const storyEvent = await this.storyEventWriter.addStoryEvent(saveId, {
        chapter: eventData.chapter || '',
        event_type: eventData.eventType,
        title: eventData.title,
        description: eventData.description || '',
        importance: eventData.importance,
        participants: eventData.participants || [],
        impact: eventData.impact || {},
      });

      this.logger.info('Story event recorded', { saveId, title: eventData.title });

      // 发布 story_progress 事件到 EventBus
      if (this.eventBus) {
        this.eventBus.emit('story_progress', {
          type: 'story_progress',
          saveId,
          data: {
            chapter: storyEvent.chapter || null,
            mainQuest: null,
            delta: [{ field: 'storyEvent', oldValue: null, newValue: storyEvent.title }],
          },
          timestamp: Date.now(),
        });
      }

      return storyEventToRecord(storyEvent);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to record story event', { saveId, error: errorMessage });
      throw error;
    }
  }

  async expireOldTriggers(saveId: ID): Promise<number> {
    try {
      const now = Date.now() as Timestamp;
      const { triggers: pendingTriggers } = await this.getPendingTriggers(saveId);

      const expiredTriggerIds: ID[] = [];
      for (const trigger of pendingTriggers) {
        const event = await this.eventRepo.findById(trigger.eventId);
        if (!event) continue;

        const cooldownMs = (event.cooldown || 0) * 1000;
        const elapsed = now - trigger.triggeredAt;

        if (cooldownMs > 0 && elapsed > cooldownMs) {
          expiredTriggerIds.push(trigger.id);
        }
      }

      if (expiredTriggerIds.length === 0) return 0;

      const expiredCount = await this.txManager.transaction(async (trx) => {
        return this.triggerRepo.updateStatusBatch(expiredTriggerIds, saveId, 'expired', trx);
      });

      if (expiredCount > 0) {
        this.logger.info('Expired old triggers', { saveId, count: expiredCount });
      }

      return expiredCount;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to expire old triggers', { saveId, error: errorMessage });
      throw error;
    }
  }

  async createEvent(eventData: EventInsertInput): Promise<GameEvent> {
    const event = await this.eventRepo.insert(eventData);
    this.logger.info('Event created or updated', { id: event.id, name: eventData.name });
    return event;
  }

  async batchCreateEvents(eventsData: EventInsertInput[]): Promise<{ count: number; events: GameEvent[] }> {
    const events = await this.txManager.transaction(async (trx) => {
      const created: GameEvent[] = [];
      for (const eventData of eventsData) {
        const event = await this.eventRepo.insert(eventData, trx);
        created.push(event);
      }
      return created;
    });
    this.logger.info('Batch events created', { count: events.length, total: eventsData.length });
    return { count: events.length, events };
  }

  /**
   * 构建归档故事事件（严格归档规则：仅 story/quest 类型或含 quest_unlock 效果的事件归档）。
   * 读取 saves 表 chapter 字段，用于故事事件归属章节。
   */
  private async buildArchivedStoryEvent(
    saveId: ID,
    event: GameEvent,
    triggerId: ID,
    resultData?: Record<string, unknown>,
    trx?: Knex.Transaction,
  ): Promise<StoryEventInput | null> {
    const shouldArchive =
      ARCHIVAL_EVENT_TYPES.has(event.type) ||
      event.effects.some(effect => ARCHIVAL_EFFECT_TYPES.has(effect.type));

    if (!shouldArchive) {
      return null;
    }

    const chapter = await this.saveRepo.getChapterBySaveId(saveId, trx);

    return {
      chapter: chapter ?? '',
      event_type: event.type,
      title: event.name,
      description: event.description,
      importance: 'major',
      participants: [],
      impact: {
        eventId: event.id,
        sourceTriggerId: triggerId,
        effects: event.effects,
        resultData: resultData ?? {},
      },
    };
  }

  /**
   * 写入归档故事事件到 story_events 表（通过 IStoryEventWriter 端口）。
   */
  private async addArchivedStoryEvent(
    saveId: ID,
    event: StoryEventInput,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.storyEventWriter.addStoryEvent(saveId, event, trx);
  }
}
