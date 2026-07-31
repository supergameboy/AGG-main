import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, generateReadableId } from '../../../../shared/src/types/core.js';
import type { GameEvent, EventType, TriggerType } from '@ai-rpg/shared/messaging';
import type { IEventRepository, EventInsertInput } from './types.js';
import { rowToGameEvent } from './mappers.js';

/**
 * events 表 Repository 实现（S3-1 完整版）。
 *
 * D7: 一表一 Repository，本类只操作 events 表（全局事件模板表，无 save_id）。
 * D9: 所有方法支持可选 trx 参数，事务由 Service 层管理。
 *
 * 偏差修订（S3-1）: 修复 S2-1 遗留 BUG — resolveEventId 移除 saveId 参数（events 表无 save_id 字段）。
 */
export class EventRepository
  extends BaseRepository<'events', GameEvent>
  implements IEventRepository
{
  constructor(db: Knex) {
    super(db, 'events');
  }

  protected rowToEntity(row: Record<string, unknown>): GameEvent {
    return rowToGameEvent(row);
  }

  async resolveEventId(eventIdOrName: string, trx?: Knex.Transaction): Promise<ID | null> {
    // 1. 精确 ID 匹配（events 表无 save_id，全局事件模板）
    const eventById = await this.query(trx)
      .where({ id: eventIdOrName })
      .first();
    if (eventById) return eventIdOrName as ID;

    // 2. 精确名称匹配
    const eventByExactName = await this.query(trx)
      .where({ name: eventIdOrName })
      .first();
    if (eventByExactName) return eventByExactName.id as ID;

    // 3. 包含匹配（支持中文名称的部分匹配）
    const eventByContains = await this.query(trx)
      .whereRaw('name LIKE ?', [`%${eventIdOrName}%`])
      .first();
    if (eventByContains) return eventByContains.id as ID;

    return null;
  }

  async findAll(
    options?: { typeFilter?: EventType; templateId?: string },
    trx?: Knex.Transaction,
  ): Promise<GameEvent[]> {
    let query = this.query(trx).select('*').orderBy('priority', 'desc');
    if (options?.typeFilter) {
      query = query.where({ type: options.typeFilter });
    }
    if (options?.templateId) {
      query = query.where({ template_id: options.templateId });
    }
    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(
    eventId: ID,
    options?: { templateId?: string },
    trx?: Knex.Transaction,
  ): Promise<GameEvent | null> {
    let query = this.query(trx).where({ id: eventId });
    if (options?.templateId) {
      query = query.where({ template_id: options.templateId });
    }
    const row = await query.first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByTriggerType(
    triggerType: TriggerType,
    options?: { templateId?: string },
    trx?: Knex.Transaction,
  ): Promise<GameEvent[]> {
    let query = this.query(trx).where({ trigger_type: triggerType }).select('*');
    if (options?.templateId) {
      query = query.where({ template_id: options.templateId });
    }
    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByType(
    type: EventType,
    options?: { templateId?: string },
    trx?: Knex.Transaction,
  ): Promise<GameEvent[]> {
    let query = this.query(trx).where({ type }).select('*');
    if (options?.templateId) {
      query = query.where({ template_id: options.templateId });
    }
    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async insert(data: EventInsertInput, trx?: Knex.Transaction): Promise<GameEvent> {
    const id = (data.id ?? generateReadableId('evt', data.name || 'event')) as ID;
    const row = {
      id,
      template_id: null,
      name: data.name,
      description: data.description || '',
      type: data.type,
      trigger_type: data.triggerType,
      trigger_data: JSON.stringify(data.triggerData || {}),
      effects: JSON.stringify(data.effects || []),
      priority: data.priority || 0,
      repeatable: data.repeatable ? 1 : 0,
      cooldown: data.cooldown || 0,
      custom_data: JSON.stringify(data.customData || {}),
    };
    await this.query(trx).insert(row).onConflict('id').merge();
    const inserted = await this.findById(id, undefined, trx);
    if (!inserted) throw new Error(`Failed to insert event: ${id}`);
    return inserted;
  }
}
