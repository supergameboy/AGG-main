import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { PacingHistoryRow } from './types.js';
import type { IPacingHistoryRepository } from './types.js';

/**
 * pacing_history 表 Repository 实现（D7: 操作 pacing_history 表）。
 *
 * D9: 所有写操作支持可选 trx 参数。
 * Row 类型单一化：JSON 字段在 Row 中为 string，Repository 透传 string，
 * 由消费方（StoryKernel）负责 JSON.parse/JSON.stringify。
 */
export class PacingHistoryRepository
  extends BaseRepository<'pacing_history', PacingHistoryRow>
  implements IPacingHistoryRepository
{
  constructor(db: Knex) {
    super(db, 'pacing_history');
  }

  protected rowToEntity(row: Record<string, unknown>): PacingHistoryRow {
    return row as unknown as PacingHistoryRow;
  }

  async countSince(saveId: ID, sinceTimestamp: number, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId })
      .where('created_at', '>', sinceTimestamp)
      .count('* as cnt')
      .first();
    return Number((result as Record<string, unknown> | undefined)?.cnt ?? 0);
  }

  async getRecentFactors(saveId: ID, limit: number, trx?: Knex.Transaction): Promise<PacingHistoryRow[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('round_number', 'desc')
      .limit(limit)
      .select('factors');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async getMaxRoundNumber(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId })
      .max('round_number as maxRound')
      .first();
    const maxRound = (result as Record<string, unknown> | undefined)?.maxRound;
    return typeof maxRound === 'number' ? maxRound : 0;
  }

  async getLast(saveId: ID, trx?: Knex.Transaction): Promise<PacingHistoryRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('round_number', 'desc')
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async getLastCalculationRound(saveId: ID, trx?: Knex.Transaction): Promise<PacingHistoryRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, is_calculation_round: 1 })
      .orderBy('round_number', 'desc')
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async getRecent(saveId: ID, limit: number, trx?: Knex.Transaction): Promise<PacingHistoryRow[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('round_number', 'desc')
      .limit(limit);
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async insert(
    saveId: ID,
    row: Omit<PacingHistoryRow, 'id' | 'save_id' | 'created_at'>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.query(trx).insert({
      save_id: saveId,
      round_number: row.round_number,
      deterministic_value: row.deterministic_value,
      llm_adjusted_value: row.llm_adjusted_value,
      adjustment_reason: row.adjustment_reason,
      factors: row.factors,
      stage: row.stage,
      event_count: row.event_count,
      main_quest_progress: row.main_quest_progress,
      is_calculation_round: row.is_calculation_round,
      created_at: Date.now(),
    });
  }

  async getCreatedAtOfLast(saveId: ID, trx?: Knex.Transaction): Promise<number | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('round_number', 'desc')
      .select('created_at')
      .first();
    const createdAt = (row as Record<string, unknown> | undefined)?.created_at;
    return (createdAt as number | undefined) ?? null;
  }

  async cleanOld(saveId: ID, keepCount: number, trx?: Knex.Transaction): Promise<void> {
    // 查询第 keepCount 条记录的 round_number（即保留的最早记录）
    const oldestKept = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('round_number', 'desc')
      .offset(keepCount)
      .select('round_number')
      .first();

    if (oldestKept) {
      await this.query(trx)
        .where({ save_id: saveId })
        .where('round_number', '<', (oldestKept as Record<string, unknown>).round_number as number)
        .del();
    }
  }
}
