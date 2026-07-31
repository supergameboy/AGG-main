import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, generateDeterministicId } from '../../../../shared/src/types/core.js';
import type { ISaveStateRepository, SaveStateRow } from './types.js';

/**
 * save_game_state 表 Repository 实现（D7: 操作 save_game_state 表，migration 001/059）。
 *
 * 表结构：data_type + data_key + data_value 多态键值对模式（非 data 单字段）。
 * UNIQUE 约束：(save_id, data_type, data_key)。
 * Repository 直接透传 data_value string，不负责 JSON 解析——由 Service 层处理。
 *
 * D9: 所有写操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 */
export class SaveStateRepository
  extends BaseRepository<'save_game_state', SaveStateRow>
  implements ISaveStateRepository
{
  constructor(db: Knex) {
    super(db, 'save_game_state');
  }

  protected rowToEntity(row: Record<string, unknown>): SaveStateRow {
    return row as unknown as SaveStateRow;
  }

  async findBySaveIdAndTypeAndKey(
    saveId: ID,
    dataType: string,
    dataKey: string,
    trx?: Knex.Transaction
  ): Promise<SaveStateRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, data_type: dataType, data_key: dataKey })
      .first();
    return (row as unknown as SaveStateRow) ?? null;
  }

  async findBySaveIdAndType(
    saveId: ID,
    dataType: string,
    trx?: Knex.Transaction
  ): Promise<SaveStateRow[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, data_type: dataType })
      .select();
    return (rows ?? []) as unknown as SaveStateRow[];
  }

  async upsert(
    saveId: ID,
    dataType: string,
    dataKey: string,
    dataValue: string,
    trx?: Knex.Transaction
  ): Promise<void> {
    const id = generateDeterministicId('gs', saveId, `${dataType}_${dataKey}`) as ID;
    await this.query(trx)
      .insert({
        id,
        save_id: saveId,
        data_type: dataType,
        data_key: dataKey,
        data_value: dataValue,
        updated_at: Date.now(),
      })
      .onConflict(['save_id', 'data_type', 'data_key'])
      .merge();
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  // S5 新增：loadSave 需要查询全部 data_type

  async findBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<SaveStateRow[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .select();
    return (rows ?? []) as unknown as SaveStateRow[];
  }
}
