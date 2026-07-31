import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type {
  IProceduralMemoryRepository,
  ProceduralMemoryRow,
} from './types.js';

/**
 * agent_procedural_memories 表 Repository 实现。
 * D7: 一表一 Repository。D9: 所有方法支持可选 trx 参数。
 * 从 ProceduralMemoryService 迁移数据访问逻辑。
 */
export class ProceduralMemoryRepository
  extends BaseRepository<'agent_procedural_memories', ProceduralMemoryRow>
  implements IProceduralMemoryRepository
{
  constructor(db: Knex) {
    super(db, 'agent_procedural_memories');
  }

  protected rowToEntity(row: Record<string, unknown>): ProceduralMemoryRow {
    return row as unknown as ProceduralMemoryRow;
  }

  async tableExists(): Promise<boolean> {
    try {
      return await this.db.schema.hasTable(this.tableName);
    } catch {
      return false;
    }
  }

  async insert(
    saveId: ID,
    agentKey: string,
    row: Omit<ProceduralMemoryRow, 'id' | 'save_id' | 'agent_key' | 'created_at' | 'updated_at'> & { id: string; created_at: number; updated_at: number },
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.query(trx).insert({
      id: row.id,
      save_id: saveId,
      agent_key: agentKey,
      condition: row.condition,
      action: row.action,
      outcome: row.outcome,
      effectiveness: row.effectiveness,
      usage_count: row.usage_count,
      last_used_at: row.last_used_at,
      tags: row.tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  async findBySaveIdAndAgent(
    saveId: ID,
    agentKey: string,
    options?: { minEffectiveness?: number; limit?: number },
    trx?: Knex.Transaction,
  ): Promise<ProceduralMemoryRow[]> {
    let query = this.query(trx).where({ save_id: saveId, agent_key: agentKey });

    if (options?.minEffectiveness !== undefined) {
      query = query.where('effectiveness', '>=', options.minEffectiveness);
    }

    query = query.orderBy('effectiveness', 'desc').orderBy('usage_count', 'desc');

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(id: ID, trx?: Knex.Transaction): Promise<ProceduralMemoryRow | null> {
    const row = await this.query(trx).where({ id }).first();
    return row ? this.rowToEntity(row) : null;
  }

  async updateEffectiveness(id: ID, effectiveness: number, updatedAt: number, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ id }).update({
      effectiveness,
      updated_at: updatedAt,
    });
  }

  async updateUsage(id: ID, usageCount: number, lastUsedAt: number, updatedAt: number, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ id }).update({
      usage_count: usageCount,
      last_used_at: lastUsedAt,
      updated_at: updatedAt,
    });
  }

  async findPruneCandidates(
    saveId: ID,
    agentKey: string,
    minEffectiveness: number,
    maxAge: number,
    trx?: Knex.Transaction,
  ): Promise<ProceduralMemoryRow[]> {
    const now = Date.now();
    const rows = await this.query(trx)
      .where({ save_id: saveId, agent_key: agentKey })
      .where('effectiveness', '<', minEffectiveness)
      .where(function () {
        this.whereNull('last_used_at')
          .orWhere('usage_count', '<', 3)
          .orWhereRaw(`last_used_at < ?`, [now - maxAge]);
      });

    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async countBySaveIdAndAgent(saveId: ID, agentKey: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId, agent_key: agentKey })
      .count('* as count')
      .first();
    return (result?.count as number) ?? 0;
  }

  async deleteByIds(ids: ID[], trx?: Knex.Transaction): Promise<number> {
    if (ids.length === 0) return 0;
    return this.query(trx).whereIn('id', ids).del();
  }

  async deleteById(saveId: ID, agentKey: string, id: ID, trx?: Knex.Transaction): Promise<boolean> {
    const deleted = await this.query(trx)
      .where({ save_id: saveId, agent_key: agentKey, id })
      .del();
    return deleted > 0;
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    return this.query(trx).where({ save_id: saveId }).del();
  }
}
