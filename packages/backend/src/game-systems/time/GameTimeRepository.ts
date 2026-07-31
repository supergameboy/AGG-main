import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { GameTimeRow, IGameTimeRepository } from './types.js';

/**
 * save_game_time 表 Repository 实现（D7: 操作 save_game_time 表）。
 *
 * 从 GameTimeService.initializeTime (L38-46) + advanceTime (L96-104) 迁移数据库操作。
 *
 * D9: 所有写操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 * 无 JSON 字段，rowToEntity 直接返回 row。
 */
export class GameTimeRepository
  extends BaseRepository<'save_game_time', GameTimeRow>
  implements IGameTimeRepository
{
  constructor(db: Knex) {
    super(db, 'save_game_time');
  }

  protected rowToEntity(row: Record<string, unknown>): GameTimeRow {
    return row as unknown as GameTimeRow;
  }

  async findBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<GameTimeRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .first();
    return (row as unknown as GameTimeRow) ?? null;
  }

  async insert(
    saveId: ID,
    id: string,
    totalMinutes: number,
    dayNumber: number,
    lastAction: string,
    trx?: Knex.Transaction
  ): Promise<void> {
    const now = Date.now();
    await this.query(trx).insert({
      id,
      save_id: saveId,
      total_minutes: totalMinutes,
      day_number: dayNumber,
      last_action: lastAction,
      last_action_at: now,
      updated_at: now,
    });
  }

  async update(
    saveId: ID,
    totalMinutes: number,
    dayNumber: number,
    lastAction: string,
    trx?: Knex.Transaction
  ): Promise<void> {
    const now = Date.now();
    await this.query(trx)
      .where({ save_id: saveId })
      .update({
        total_minutes: totalMinutes,
        day_number: dayNumber,
        last_action: lastAction,
        last_action_at: now,
        updated_at: now,
      });
  }

  async upsert(
    saveId: ID,
    id: string,
    totalMinutes: number,
    dayNumber: number,
    lastAction: string,
    trx?: Knex.Transaction
  ): Promise<void> {
    const now = Date.now();
    await this.query(trx)
      .insert({
        id,
        save_id: saveId,
        total_minutes: totalMinutes,
        day_number: dayNumber,
        last_action: lastAction,
        last_action_at: now,
        updated_at: now,
      })
      .onConflict(['save_id'])
      .merge();
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }
}
