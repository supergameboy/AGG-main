import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { ISaveSnapshotRepository, SaveSnapshotRow, SaveSnapshotQueryOptions } from './types.js';

/**
 * save_snapshots 表 Repository 实现（8 方法）。
 * D7: 一表一 Repository，只操作 save_snapshots 表。
 * D9: 所有写操作支持可选 trx 参数。
 */
export class SaveSnapshotRepository
  extends BaseRepository<'save_snapshots', SaveSnapshotRow>
  implements ISaveSnapshotRepository
{
  constructor(db: Knex) {
    super(db, 'save_snapshots');
  }

  protected rowToEntity(row: Record<string, unknown>): SaveSnapshotRow {
    return row as unknown as SaveSnapshotRow;
  }

  async insert(data: SaveSnapshotRow, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).insert(data);
  }

  async findById(snapshotId: ID, trx?: Knex.Transaction): Promise<SaveSnapshotRow | null> {
    const row = await this.query(trx).where({ id: snapshotId }).first();
    return (row as unknown as SaveSnapshotRow) ?? null;
  }

  async findBySaveId(saveId: ID, options?: SaveSnapshotQueryOptions, trx?: Knex.Transaction): Promise<SaveSnapshotRow[]> {
    let query = this.query(trx).where({ save_id: saveId });
    if (options?.type) {
      query = query.where({ type: options.type });
    }
    const rows = await query
      .orderBy('created_at', 'desc')
      .select(['id', 'save_id', 'name', 'type', 'game_mode', 'chapter', 'location', 'level', 'main_quest', 'play_time', 'thumbnail', 'description', 'created_at']);
    return (rows ?? []) as unknown as SaveSnapshotRow[];
  }

  async findBySaveIdAndType(saveId: ID, type: string, trx?: Knex.Transaction): Promise<SaveSnapshotRow[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, type })
      .orderBy('created_at', 'asc')
      .select('id');
    return (rows ?? []) as unknown as SaveSnapshotRow[];
  }

  async countBySaveIdAndType(saveId: ID, type: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId, type })
      .count('id as count')
      .first();
    return (result?.count as number) || 0;
  }

  async deleteById(snapshotId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ id: snapshotId }).del();
  }

  async findLatestBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<SaveSnapshotRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('created_at', 'desc')
      .first();
    return (row as unknown as SaveSnapshotRow) ?? null;
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }
}
