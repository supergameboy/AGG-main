import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type {
  IEpisodicMemoryRepository,
  EpisodicMemoryRow,
} from './types.js';

/**
 * agent_episodic_memories 表 Repository 实现。
 * D7: 一表一 Repository。D9: 所有方法支持可选 trx 参数。
 * 从 EpisodicMemoryService 迁移数据访问逻辑。
 */
export class EpisodicMemoryRepository
  extends BaseRepository<'agent_episodic_memories', EpisodicMemoryRow>
  implements IEpisodicMemoryRepository
{
  constructor(db: Knex) {
    super(db, 'agent_episodic_memories');
  }

  protected rowToEntity(row: Record<string, unknown>): EpisodicMemoryRow {
    return row as unknown as EpisodicMemoryRow;
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
    row: Omit<EpisodicMemoryRow, 'id' | 'save_id' | 'agent_key' | 'created_at'> & { id: string; created_at: number },
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.query(trx).insert({
      id: row.id,
      save_id: saveId,
      agent_key: agentKey,
      content: row.content,
      type: row.type,
      importance: row.importance,
      related_entities: row.related_entities,
      tags: row.tags,
      turn_index: row.turn_index,
      created_at: row.created_at,
    });
  }

  async insertBatch(
    saveId: ID,
    agentKey: string,
    rows: Array<Omit<EpisodicMemoryRow, 'id' | 'save_id' | 'agent_key' | 'created_at'> & { id: string; created_at: number }>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    if (rows.length === 0) return;
    const dbRows = rows.map(r => ({
      id: r.id,
      save_id: saveId,
      agent_key: agentKey,
      content: r.content,
      type: r.type,
      importance: r.importance,
      related_entities: r.related_entities,
      tags: r.tags,
      turn_index: r.turn_index,
      created_at: r.created_at,
    }));
    await this.query(trx).insert(dbRows);
  }

  async findBySaveIdAndAgent(
    saveId: ID,
    agentKey: string,
    options?: {
      type?: string;
      minImportance?: number;
      tags?: string;
      timeRange?: { start: number; end: number };
      limit?: number;
    },
    trx?: Knex.Transaction,
  ): Promise<EpisodicMemoryRow[]> {
    let query = this.query(trx).where({ save_id: saveId, agent_key: agentKey });

    if (options?.type) {
      query = query.where({ type: options.type });
    }
    if (options?.minImportance !== undefined) {
      query = query.where('importance', '>=', options.minImportance);
    }
    if (options?.tags) {
      query = query.whereRaw(`tags LIKE '%${options.tags}%'`);
    }
    if (options?.timeRange) {
      query = query.whereBetween('created_at', [options.timeRange.start, options.timeRange.end]);
    }

    query = query.orderBy('importance', 'desc').orderBy('created_at', 'desc');

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async searchByContent(
    saveId: ID,
    agentKey: string,
    query: string,
    limit: number,
    trx?: Knex.Transaction,
  ): Promise<EpisodicMemoryRow[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, agent_key: agentKey })
      .whereRaw('content LIKE ?', [`%${query}%`])
      .orderBy('importance', 'desc')
      .orderBy('created_at', 'desc')
      .limit(limit);

    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findLowImportance(
    saveId: ID,
    agentKey: string,
    threshold: number,
    trx?: Knex.Transaction,
  ): Promise<EpisodicMemoryRow[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, agent_key: agentKey })
      .where('importance', '<', threshold)
      .orderBy('created_at', 'asc');

    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async countBySaveIdAndAgent(saveId: ID, agentKey: string, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .where({ save_id: saveId, agent_key: agentKey })
      .count('* as count')
      .first();
    return (result?.count as number) ?? 0;
  }

  async deleteByIds(saveId: ID, agentKey: string, ids: ID[], trx?: Knex.Transaction): Promise<number> {
    if (ids.length === 0) return 0;
    return this.query(trx)
      .where({ save_id: saveId, agent_key: agentKey })
      .whereIn('id', ids)
      .del();
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
