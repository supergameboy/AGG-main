import type { Knex } from 'knex';
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type {
  GameEvent,
  EventTrigger,
  EventType,
  TriggerType,
  TriggerStatus,
} from '@ai-rpg/shared/messaging';

// 实体类型重导出（供 Repository/Service 消费方使用）
export type { GameEvent, EventTrigger, EventType, TriggerType, TriggerStatus };

/**
 * Event 领域 Repository 端口接口（events 表）。
 *
 * D7: 一表一 Repository，本接口只操作 events 表。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 *
 * 偏差修订（S3-1）: events 表是全局事件模板表，**没有 save_id 字段**（migration 006 确认）。
 * 所有查询方法不按 saveId 过滤。S2-1 的 resolveEventId 用了 save_id 过滤是 BUG，已修复。
 */
export interface IEventRepository {
  /**
   * 解析事件 ID 或名称为事件 ID。
   * 依次尝试: 精确 ID 匹配 → 精确名称匹配 → 名称包含匹配。
   * S2-1 已有（修复: 移除 saveId 参数，events 表无 save_id 字段）。
   * 供 MapService 跨领域解析事件引用使用。
   * 返回 null 表示未找到（由调用方决定是否抛异常）。
   */
  resolveEventId(eventIdOrName: string, trx?: Knex.Transaction): Promise<ID | null>;

  /**
   * 查询事件模板列表（覆盖 listEventTemplates L128）。
   * select * orderBy priority desc + 可选 type/template_id 过滤。
   */
  findAll(options?: { typeFilter?: EventType; templateId?: string }, trx?: Knex.Transaction): Promise<GameEvent[]>;

  /**
   * 按 ID 查询事件（覆盖 getEvent L153 + triggerEvent L235 + resolveTrigger L295 + processChainEvents L495）。
   * where id + 可选 template_id 过滤。
   */
  findById(eventId: ID, options?: { templateId?: string }, trx?: Knex.Transaction): Promise<GameEvent | null>;

  /**
   * 按触发类型查询事件（覆盖 checkTriggers L171）。
   * where trigger_type + 可选 template_id 过滤。
   */
  findByTriggerType(triggerType: TriggerType, options?: { templateId?: string }, trx?: Knex.Transaction): Promise<GameEvent[]>;

  /**
   * 按事件类型查询事件（覆盖 rollRandomEvent L399 + getTimeBasedEvents L548）。
   * where type + 可选 template_id 过滤。
   */
  findByType(type: EventType, options?: { templateId?: string }, trx?: Knex.Transaction): Promise<GameEvent[]>;

  /**
   * 插入事件（覆盖 createEvent L708）。
   * insert + onConflict('id').merge()。
   */
  insert(data: EventInsertInput, trx?: Knex.Transaction): Promise<GameEvent>;
}

/**
 * createEvent 输入类型（对应 EventService.createEvent 参数）。
 */
export interface EventInsertInput {
  id?: ID;
  name: string;
  description?: string;
  type: EventType;
  triggerType: TriggerType;
  triggerData?: Record<string, unknown>;
  effects?: unknown[];
  priority?: number;
  repeatable?: boolean;
  cooldown?: number;
  customData?: Record<string, unknown>;
}

/**
 * Event 领域 Repository 端口接口（event_triggers 表）。
 *
 * D7: 一表一 Repository，本接口只操作 event_triggers 表。
 * D9: 所有写操作和需要事务的读操作支持可选 trx 参数。
 * event_triggers 表有 save_id 字段，所有查询按 saveId 过滤。
 *
 * S3-1 新增: 覆盖 EventService 全部 event_triggers 表 db 调用。
 */
export interface IEventTriggerRepository {
  /**
   * 查询存档下所有触发器（覆盖 getTriggerHistory L383）。
   * where save_id + orderBy triggered_at desc + 可选 limit。
   */
  findBySaveId(saveId: ID, options?: { limit?: number }, trx?: Knex.Transaction): Promise<EventTrigger[]>;

  /**
   * 按 ID 查询触发器（覆盖 resolveTrigger L271 事务内 + processChainEvents L489）。
   * where id + save_id。
   */
  findById(triggerId: ID, saveId: ID, trx?: Knex.Transaction): Promise<EventTrigger | null>;

  /**
   * 按事件 ID 查询触发器（覆盖 checkTriggers L202）。
   * where save_id + event_id + 可选排除状态过滤（whereNotIn status）。
   */
  findByEventId(saveId: ID, eventId: ID, options?: { excludeStatuses?: string[] }, trx?: Knex.Transaction): Promise<EventTrigger[]>;

  /**
   * 按状态查询触发器（覆盖 getPendingTriggers L361）。
   * where save_id + status + orderBy triggered_at desc。
   */
  findByStatus(saveId: ID, status: string, trx?: Knex.Transaction): Promise<EventTrigger[]>;

  /**
   * 插入触发器（覆盖 triggerEvent L241）。
   */
  insert(data: EventTriggerInsertInput, saveId: ID, trx?: Knex.Transaction): Promise<EventTrigger>;

  /**
   * 更新触发器（覆盖 resolveTrigger L283 事务内 + expireOldTriggers L688）。
   * where id + save_id + update patch。
   * 返回更新后的触发器，未找到返回 null。
   */
  update(triggerId: ID, saveId: ID, patch: EventTriggerUpdateInput, trx?: Knex.Transaction): Promise<EventTrigger | null>;

  /**
   * 批量更新触发器状态（覆盖 expireOldTriggers 批量过期）。
   * where id in (triggerIds) + save_id + update status。
   * 返回受影响行数。
   */
  updateStatusBatch(triggerIds: ID[], saveId: ID, status: string, trx?: Knex.Transaction): Promise<number>;
}

/**
 * triggerEvent 插入输入类型。
 */
export interface EventTriggerInsertInput {
  id: ID;
  eventId: ID;
  triggeredAt: Timestamp;
  status: TriggerStatus;
  resultData?: Record<string, unknown>;
}

/**
 * 触发器更新输入类型（部分字段可更新）。
 */
export interface EventTriggerUpdateInput {
  status?: TriggerStatus;
  resolvedAt?: Timestamp | null;
  resultData?: Record<string, unknown>;
}

/**
 * Event 领域 Service 端口接口。
 * 供跨领域消费方注入使用（如 quest 完成触发事件、map 跨领域事件访问）。
 * S3-1 阶段仅供 ServiceTool 内部组合根使用。
 */
export interface IEventService {
  /** 解析事件 ID 或名称为事件 ID（跨领域只读查询） */
  resolveEventId(eventIdOrName: string, trx?: Knex.Transaction): Promise<ID | null>;
  /** 触发事件（跨领域调用，如 quest 完成触发事件） */
  triggerEvent(saveId: ID, eventId: ID, context?: Record<string, unknown>, trx?: Knex.Transaction): Promise<EventTrigger>;
}
