import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { EventTrigger } from '@ai-rpg/shared/messaging';
import type {
  IEventTriggerRepository,
  EventTriggerInsertInput,
  EventTriggerUpdateInput,
} from './types.js';
import { rowToEventTrigger } from './mappers.js';

/**
 * event_triggers 表 Repository 实现（S3-1 新建）。
 *
 * D7: 一表一 Repository，本类只操作 event_triggers 表。
 * D9: 所有方法支持可选 trx 参数，事务由 Service 层管理。
 * event_triggers 表有 save_id 字段（复合主键 save_id+id），所有查询按 saveId 过滤。
 *
 * 覆盖 EventService 全部 event_triggers 表 db 调用（原 L202/241/271/283/291/363/385/489/688）。
 */
export class EventTriggerRepository
  extends BaseRepository<'event_triggers', EventTrigger>
  implements IEventTriggerRepository
{
  constructor(db: Knex) {
    super(db, 'event_triggers');
  }

  protected rowToEntity(row: Record<string, unknown>): EventTrigger {
    return rowToEventTrigger(row);
  }

  async findBySaveId(
    saveId: ID,
    options?: { limit?: number },
    trx?: Knex.Transaction,
  ): Promise<EventTrigger[]> {
    let query = this.query(trx)
      .where({ save_id: saveId })
      .select('*')
      .orderBy('triggered_at', 'desc');
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(
    triggerId: ID,
    saveId: ID,
    trx?: Knex.Transaction,
  ): Promise<EventTrigger | null> {
    const row = await this.query(trx)
      .where({ id: triggerId, save_id: saveId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByEventId(
    saveId: ID,
    eventId: ID,
    options?: { excludeStatuses?: string[] },
    trx?: Knex.Transaction,
  ): Promise<EventTrigger[]> {
    let query = this.query(trx)
      .where({ save_id: saveId, event_id: eventId })
      .select('*');
    if (options?.excludeStatuses && options.excludeStatuses.length > 0) {
      query = query.whereNotIn('status', options.excludeStatuses);
    }
    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByStatus(
    saveId: ID,
    status: string,
    trx?: Knex.Transaction,
  ): Promise<EventTrigger[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, status })
      .select('*')
      .orderBy('triggered_at', 'desc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async insert(
    data: EventTriggerInsertInput,
    saveId: ID,
    trx?: Knex.Transaction,
  ): Promise<EventTrigger> {
    const row = {
      id: data.id,
      save_id: saveId,
      event_id: data.eventId,
      triggered_at: data.triggeredAt,
      status: data.status,
      result_data: JSON.stringify(data.resultData || {}),
    };
    await this.query(trx).insert(row);
    return {
      id: data.id,
      saveId,
      eventId: data.eventId,
      triggeredAt: data.triggeredAt,
      resolvedAt: null,
      status: data.status,
      resultData: data.resultData || {},
    };
  }

  async update(
    triggerId: ID,
    saveId: ID,
    patch: EventTriggerUpdateInput,
    trx?: Knex.Transaction,
  ): Promise<EventTrigger | null> {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.resolvedAt !== undefined) row.resolved_at = patch.resolvedAt;
    if (patch.resultData !== undefined) row.result_data = JSON.stringify(patch.resultData);

    await this.query(trx)
      .where({ id: triggerId, save_id: saveId })
      .update(row);

    return this.findById(triggerId, saveId, trx);
  }

  async updateStatusBatch(
    triggerIds: ID[],
    saveId: ID,
    status: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    if (triggerIds.length === 0) return 0;
    return this.query(trx)
      .where({ save_id: saveId })
      .whereIn('id', triggerIds)
      .update({ status });
  }
}
