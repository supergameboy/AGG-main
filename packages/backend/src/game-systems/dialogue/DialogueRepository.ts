import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { DialogueMessageRecord } from './types.js';
import type { IDialogueRepository } from './types.js';
import { rowToDialogueMessageRecord } from './mappers.js';

/**
 * dialogues 表 Repository 实现（S3-3 新建）。
 *
 * D7: 一表一 Repository，本类只操作 dialogues 表。
 * D9: 所有方法支持可选 trx 参数，事务由 Service 层管理。
 * dialogues 表有 save_id 字段，所有查询按 saveId 过滤。
 *
 * 覆盖 DialogueService 全部 dialogues 表 db 调用（原 L58/100/160/194/353/395/466/492/528/977）。
 */
export class DialogueRepository
  extends BaseRepository<'dialogues', DialogueMessageRecord>
  implements IDialogueRepository
{
  constructor(db: Knex) {
    super(db, 'dialogues');
  }

  protected rowToEntity(row: Record<string, unknown>): DialogueMessageRecord {
    return rowToDialogueMessageRecord(row);
  }

  async findWithPagination(
    saveId: string,
    npcId: string | null,
    limit: number,
    offset: number,
    trx?: Knex.Transaction,
  ): Promise<{ rows: DialogueMessageRecord[]; total: number }> {
    let query = this.query(trx).where({ save_id: saveId });
    if (npcId !== null) {
      query = query.where({ npc_id: npcId });
    }

    const [{ count }] = await query.clone().count('* as count');
    const total = Number(count);

    const rows = await query
      .select('*')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .offset(offset);

    return { rows: rows.map((row: Record<string, unknown>) => this.rowToEntity(row)), total };
  }

  async findRecent(
    saveId: string,
    npcId: string | null,
    count: number,
    trx?: Knex.Transaction,
  ): Promise<DialogueMessageRecord[]> {
    let query = this.query(trx).where('save_id', saveId);
    if (npcId !== null) {
      query = query.where('npc_id', npcId);
    }

    const rows = await query
      .select('*')
      .orderBy('timestamp', 'desc')
      .limit(count);

    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async countBySaveIdAndNpcId(
    saveId: string,
    npcId: string | null,
    trx?: Knex.Transaction,
  ): Promise<number> {
    let query = this.query(trx).where({ save_id: saveId });
    if (npcId !== null) {
      query = query.where({ npc_id: npcId });
    }

    const [{ count }] = await query.count('* as count');
    return Number(count);
  }

  async findAllBySaveId(
    saveId: string,
    npcId: string | null,
    trx?: Knex.Transaction,
  ): Promise<DialogueMessageRecord[]> {
    let query = this.query(trx).where({ save_id: saveId });
    if (npcId !== null) {
      query = query.where({ npc_id: npcId });
    }

    const rows = await query.select('*').orderBy('timestamp', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async search(
    saveId: string,
    filters: { keyword?: string; emotion?: string; speaker?: string },
    trx?: Knex.Transaction,
  ): Promise<DialogueMessageRecord[]> {
    let query = this.query(trx).where({ save_id: saveId });

    if (filters.keyword) {
      query = query.where('content', 'like', `%${this.escapeLikeWildcards(filters.keyword)}%`);
    }
    if (filters.emotion) {
      query = query.andWhere({ emotion: filters.emotion });
    }
    if (filters.speaker) {
      query = query.andWhere({ speaker: filters.speaker });
    }

    const rows = await query.select('*').orderBy('timestamp', 'desc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async insert(message: DialogueMessageRecord, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).insert({
      id: message.id,
      save_id: message.saveId,
      npc_id: message.npcId,
      speaker: message.speaker,
      content: message.content,
      emotion: message.emotion,
      message_type: message.messageType,
      timestamp: message.timestamp,
    });
  }

  async deleteBySaveId(
    saveId: string,
    npcId: string | null,
    trx?: Knex.Transaction,
  ): Promise<void> {
    let query = this.query(trx).where({ save_id: saveId });
    if (npcId !== null) {
      query = query.where({ npc_id: npcId });
    }
    await query.del();
  }

  async groupCountByEmotion(
    saveId: string,
    npcId: string,
    trx?: Knex.Transaction,
  ): Promise<Array<{ emotion: string; count: number }>> {
    const rows = await this
      .query(trx)
      .where({
        save_id: saveId,
        npc_id: npcId,
      })
      .select('emotion')
      .count('* as count')
      .groupBy('emotion');

    return rows.map((row: Record<string, unknown>) => ({
      emotion: row.emotion as string,
      count: Number(row.count),
    }));
  }

  /**
   * LIKE 查询通配符转义（从 DialogueService.escapeLikeWildcards L1076-1081 迁入）。
   * 仅 Repository 内部 search 方法使用，不暴露给 Service。
   */
  private escapeLikeWildcards(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
  }
}
