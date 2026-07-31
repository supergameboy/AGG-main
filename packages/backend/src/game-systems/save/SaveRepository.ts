import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type { ISaveRepository, SaveRow, SaveListOptions, SaveRecord } from './types.js';
import type { SaveRestrictionType } from '../../../../shared/src/types/template.js';

/**
 * Save 表 Repository 实现（saves 表，16 方法）。
 * D7: 一表一 Repository，只操作 saves 表。
 * D9: 所有写操作支持可选 trx 参数。
 */
export class SaveRepository
  extends BaseRepository<'saves', SaveRecord>
  implements ISaveRepository
{
  constructor(db: Knex) {
    super(db, 'saves');
  }

  protected rowToEntity(row: Record<string, unknown>): SaveRecord {
    return {
      id: row.id as ID,
      name: row.name as string,
      type: row.type as SaveRestrictionType,
      template_id: ((row.template_id as string | null) ?? 'default') as ID,
      game_mode: row.game_mode as string,
      chapter: (row.chapter as string | null) ?? '',
      location: (row.location as string | null) ?? '',
      level: (row.level as number) ?? 0,
      main_quest: (row.main_quest as string | null) ?? '',
      play_time: (row.play_time as number) ?? 0,
      thumbnail: (row.thumbnail as string) ?? '',
      language: (row.language as string) || 'zh-CN',
      created_at: (row.created_at as number) as Timestamp,
      updated_at: (row.updated_at as number) as Timestamp,
      last_played_at: (row.last_played_at as number | null) as Timestamp | undefined,
      current_snapshot_id: (row.current_snapshot_id as string | null) ?? null,
      snapshot_count: (row.snapshot_count as number) ?? 0,
      // DF-007 修复：跨请求持久化挑战模式
      active_challenge_mode: (row.active_challenge_mode as string | null) ?? null,
    };
  }

  // === 已有方法（7 方法） ===

  async getTemplateIdBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<string | null> {
    const row = await this.query(trx)
      .where({ id: saveId })
      .first('template_id');
    return (row?.template_id as string | null) ?? null;
  }

  async getChapterBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<string | null> {
    const row = await this.query(trx)
      .where({ id: saveId })
      .first('chapter');
    return (row?.chapter as string | null) ?? null;
  }

  async getStoryContext(saveId: ID, trx?: Knex.Transaction): Promise<{ chapter: string | null; mainQuest: string | null } | null> {
    const row = await this.query(trx)
      .where({ id: saveId })
      .first('chapter', 'main_quest');
    if (!row) return null;
    return {
      chapter: (row.chapter as string | null) ?? null,
      mainQuest: (row.main_quest as string | null) ?? null,
    };
  }

  async updateStoryState(saveId: ID, chapter: string, mainQuest: string, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ id: saveId })
      .update({
        chapter,
        main_quest: mainQuest,
        updated_at: Date.now(),
      });
  }

  async getMainQuestBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<string | null> {
    const row = await this.query(trx)
      .where({ id: saveId })
      .first('main_quest');
    return (row?.main_quest as string | null) ?? null;
  }

  async getSaveContextInfo(saveId: ID, trx?: Knex.Transaction): Promise<{
    chapter: string | null;
    location: string | null;
    mainQuest: string | null;
    level: number | null;
  } | null> {
    const row = await this.query(trx)
      .where({ id: saveId })
      .first('chapter', 'location', 'main_quest', 'level');
    if (!row) return null;
    return {
      chapter: (row.chapter as string | null) ?? null,
      location: (row.location as string | null) ?? null,
      mainQuest: (row.main_quest as string | null) ?? null,
      level: (row.level as number | null) ?? null,
    };
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ id: saveId }).del();
  }

  // === S5 新增方法（9 方法） ===

  async insert(data: SaveRow, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).insert(data);
  }

  async findById(saveId: ID, trx?: Knex.Transaction): Promise<SaveRecord | null> {
    const row = await this.query(trx).where({ id: saveId }).first();
    return row ? this.rowToEntity(row as unknown as Record<string, unknown>) : null;
  }

  async list(options?: SaveListOptions, trx?: Knex.Transaction): Promise<{ rows: SaveRecord[]; total: number }> {
    let query = this.query(trx);

    if (options?.templateId) {
      query = query.where({ template_id: options.templateId });
    }
    if (options?.gameMode) {
      query = query.where({ game_mode: options.gameMode });
    }
    if (options?.type) {
      query = query.where({ type: options.type });
    }
    if (options?.nameContains) {
      query = query.where('name', 'like', `%${options.nameContains}%`);
    }

    const totalResult = await query.clone().count('* as count').first();
    const total = (totalResult?.count as number) || 0;

    query = query.orderBy('updated_at', 'desc');

    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.offset) {
      query = query.offset(options.offset);
    }

    const rows = await query.select();
    return {
      rows: rows.map((r: Record<string, unknown>) => this.rowToEntity(r)),
      total,
    };
  }

  async getLanguage(saveId: ID, trx?: Knex.Transaction): Promise<string | undefined> {
    const row = await this.query(trx)
      .where({ id: saveId })
      .first('language');
    return (row?.language as string | undefined) ?? undefined;
  }

  async updateLanguage(saveId: ID, language: string, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ id: saveId })
      .update({ language, updated_at: Date.now() });
  }

  async updatePlayTime(saveId: ID, updatedAt: number, lastPlayedAt: number, playTimeIncrement?: number, trx?: Knex.Transaction): Promise<void> {
    const updates: Record<string, unknown> = {
      updated_at: updatedAt,
      last_played_at: lastPlayedAt,
    };
    if (playTimeIncrement && playTimeIncrement > 0) {
      updates.play_time = this.db.raw('play_time + ?', [playTimeIncrement]);
    }
    await this.query(trx).where({ id: saveId }).update(updates);
  }

  async updateSnapshot(saveId: ID, snapshotId: string | null, snapshotCountDelta: number, trx?: Knex.Transaction): Promise<void> {
    const updates: Record<string, unknown> = {
      current_snapshot_id: snapshotId,
      updated_at: Date.now(),
    };
    if (snapshotCountDelta !== 0) {
      updates.snapshot_count = this.db.raw('snapshot_count + ?', [snapshotCountDelta]);
    }
    await this.query(trx).where({ id: saveId }).update(updates);
  }

  async updateFields(saveId: ID, updates: Partial<SaveRow>, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ id: saveId }).update(updates);
  }

  async countByTemplateId(templateId: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ template_id: templateId })
      .count('* as count')
      .first();
    return (result?.count as number) || 0;
  }
}
