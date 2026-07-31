import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, generateReadableId } from '../../../../shared/src/types/core.js';
import type { StoryEvent } from './types.js';
import type { IStoryEventRepository, StoryEventRow } from './types.js';

/**
 * story_events 表 Repository 实现（D7: 操作 story_events 表）。
 *
 * D9: 所有写操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 * Row 类型单一化：participants JSON 字段在 Row 中为 string，rowToEntity 负责 JSON.parse。
 */
export class StoryEventRepository
  extends BaseRepository<'story_events', StoryEvent>
  implements IStoryEventRepository
{
  constructor(db: Knex) {
    super(db, 'story_events');
  }

  protected rowToEntity(row: Record<string, unknown>): StoryEvent {
    return {
      id: row.id as string,
      save_id: row.save_id as string,
      chapter: (row.chapter as string) ?? '',
      event_type: row.event_type as string,
      title: row.title as string,
      description: (row.description as string) ?? '',
      importance: (row.importance as StoryEvent['importance']) ?? 'minor',
      participants: (row.participants as string) ?? '[]',
      impact: (row.impact as string) ?? '{}',
      timestamp: (row.timestamp as number) ?? Date.now(),
    };
  }

  async addStoryEvent(
    saveId: ID,
    event: Omit<StoryEventRow, 'id' | 'save_id' | 'timestamp'>,
    trx?: Knex.Transaction
  ): Promise<string> {
    const id = generateReadableId('story', event.title || event.event_type) as ID;
    await this.query(trx).insert({
      id,
      save_id: saveId,
      chapter: event.chapter,
      event_type: event.event_type,
      title: event.title,
      description: event.description,
      importance: event.importance,
      participants: event.participants,
      impact: event.impact,
      timestamp: Date.now(),
    });
    return id;
  }

  async getStoryEvents(
    saveId: ID,
    options?: { chapter?: string; limit?: number; offset?: number },
    trx?: Knex.Transaction
  ): Promise<StoryEventRow[]> {
    const query = this.query(trx)
      .where({ save_id: saveId })
      .orderBy('timestamp', 'desc');
    if (options?.chapter) {
      query.where({ chapter: options.chapter });
    }
    if (options?.offset) {
      query.offset(options.offset);
    }
    if (options?.limit) {
      query.limit(options.limit);
    }
    const rows = await query.select();
    return rows as unknown as StoryEventRow[];
  }

  async findExistingEvent(
    saveId: ID,
    chapter: string,
    eventType: string,
    title: string,
    trx?: Knex.Transaction
  ): Promise<StoryEventRow | null> {
    const row = await this.query(trx)
      .where({
        save_id: saveId,
        chapter,
        event_type: eventType,
        title,
      })
      .first();
    return (row as unknown as StoryEventRow) ?? null;
  }

  async countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId })
      .count('* as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  // === S6 新增（StoryKernel 跨方法复用） ===

  async getRecentForNarrative(
    saveId: ID,
    limit: number,
    trx?: Knex.Transaction,
  ): Promise<Array<{ title: string; description: string }>> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .select('title', 'description');
    return rows.map((row: Record<string, unknown>) => ({
      title: (row.title as string) ?? '',
      description: (row.description as string) ?? '',
    }));
  }

  async countSince(saveId: ID, sinceTimestamp: number, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId })
      .where('timestamp', '>', sinceTimestamp)
      .count('* as cnt')
      .first();
    return Number((result as Record<string, unknown> | undefined)?.cnt ?? 0);
  }
}
