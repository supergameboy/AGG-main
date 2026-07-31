import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { PacingConfigRow } from './types.js';
import type { IPacingRepository } from './types.js';

/**
 * pacing_config 表 Repository 实现（D7: 操作 pacing_config 表）。
 *
 * D9: 所有写操作支持可选 trx 参数。
 * Row 类型单一化：JSON 字段在 Row 中为 string，Repository 透传 string，
 * 由消费方（StoryKernel）负责 JSON.parse/JSON.stringify。
 */
export class PacingRepository
  extends BaseRepository<'pacing_config', PacingConfigRow>
  implements IPacingRepository
{
  constructor(db: Knex) {
    super(db, 'pacing_config');
  }

  protected rowToEntity(row: Record<string, unknown>): PacingConfigRow {
    return row as unknown as PacingConfigRow;
  }

  async getConfig(saveId: ID, trx?: Knex.Transaction): Promise<PacingConfigRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async getTemplateContextHash(saveId: ID, trx?: Knex.Transaction): Promise<string | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .select('template_context_hash')
      .first();
    return (row as Record<string, unknown> | undefined)?.template_context_hash as string | null ?? null;
  }

  async getUpdatedAt(saveId: ID, trx?: Knex.Transaction): Promise<number | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .select('updated_at')
      .first();
    const updatedAt = (row as Record<string, unknown> | undefined)?.updated_at;
    return (updatedAt as number | undefined) ?? null;
  }

  async insert(
    saveId: ID,
    row: Omit<PacingConfigRow, 'id' | 'save_id' | 'created_at' | 'updated_at'>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const now = Date.now();
    await this.query(trx).insert({
      save_id: saveId,
      tension_range: row.tension_range,
      tension_weights: row.tension_weights,
      density_params: row.density_params,
      progress_params: row.progress_params,
      stage_thresholds: row.stage_thresholds,
      pacing_interval: row.pacing_interval,
      generated_by: row.generated_by,
      template_context_hash: row.template_context_hash,
      created_at: now,
      updated_at: now,
    });
  }

  async update(
    saveId: ID,
    row: Partial<Omit<PacingConfigRow, 'id' | 'save_id' | 'created_at'>>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const updateRow: Record<string, unknown> = { ...row, updated_at: Date.now() };
    await this.query(trx)
      .where({ save_id: saveId })
      .update(updateRow);
  }
}
