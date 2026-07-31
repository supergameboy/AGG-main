import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { ISaveGameTimeRepository, SaveGameTimeRow } from './types.js';

/**
 * save_game_time 表 Repository 实现（4 方法）。
 * D7: 一表一 Repository，只操作 save_game_time 表。
 * D9: 所有写操作支持可选 trx 参数。
 */
export class SaveGameTimeRepository
  extends BaseRepository<'save_game_time', SaveGameTimeRow>
  implements ISaveGameTimeRepository
{
  constructor(db: Knex) {
    super(db, 'save_game_time');
  }

  protected rowToEntity(row: Record<string, unknown>): SaveGameTimeRow {
    return row as unknown as SaveGameTimeRow;
  }

  async findBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<SaveGameTimeRow | null> {
    const row = await this.query(trx).where({ save_id: saveId }).first();
    return (row as unknown as SaveGameTimeRow) ?? null;
  }

  async upsert(data: SaveGameTimeRow, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .insert(data)
      .onConflict('save_id')
      .merge();
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  async update(saveId: ID, updates: Partial<SaveGameTimeRow>, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).update(updates);
  }
}
