import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID } from '../../../../shared/src/types/core.js';
import type { CombatResult } from './types.js';
import type { ICombatHistoryRepository, CombatHistoryInsertInput } from './types.js';

/**
 * combat_history 表 Repository 实现（S3-2 新建）。
 *
 * D7: 一表一 Repository，本类只操作 combat_history 表。
 * D9: 写操作支持可选 trx 参数，事务由 Service 层管理。
 *
 * 覆盖 CombatService.finalizeCombat L966-971 insert 调用。
 * combat_history 表只写入不查询（历史记录查询走 ShadowStateLayer），本 Repository 仅暴露 insert。
 *
 * TEntity 使用 CombatResult（result_data JSON 反序列化后的实体），但当前无查询方法，
 * rowToEntity 仅为满足 BaseRepository 抽象契约。
 */
export class CombatHistoryRepository
  extends BaseRepository<'combat_history', CombatResult>
  implements ICombatHistoryRepository
{
  constructor(db: Knex) {
    super(db, 'combat_history');
  }

  protected rowToEntity(row: Record<string, unknown>): CombatResult {
    // 当前无查询方法，rowToEntity 仅为满足 BaseRepository 抽象契约。
    // 若未来新增查询方法，需实现 result_data JSON 反序列化映射。
    return row as unknown as CombatResult;
  }

  async insert(record: CombatHistoryInsertInput, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).insert({
      id: record.id,
      save_id: record.saveId,
      result_data: JSON.stringify(record.resultData),
      created_at: record.createdAt,
    });
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }
}
