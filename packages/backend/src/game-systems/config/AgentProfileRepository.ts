import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { generateDeterministicId } from '../../../../shared/src/types/core.js';
import type { AgentProfileRow, IAgentProfileRepository } from './types.js';

/**
 * agent_profiles 表 Repository 实现（D7: 操作 agent_profiles 表）。
 *
 * D9: 所有方法支持可选 trx 参数，由 Service 层管理事务边界。
 * Row 类型单一化：JSON 字段在 Row 中为 string，消费方（ConfigLoader）负责 JSON.parse。
 * id 为确定性生成（generateDeterministicId），非自增，insert 时由 Repository 内部生成。
 */
export class AgentProfileRepository
  extends BaseRepository<'agent_profiles', AgentProfileRow>
  implements IAgentProfileRepository
{
  constructor(db: Knex) {
    super(db, 'agent_profiles');
  }

  protected rowToEntity(row: Record<string, unknown>): AgentProfileRow {
    return row as unknown as AgentProfileRow;
  }

  async findAll(trx?: Knex.Transaction): Promise<AgentProfileRow[]> {
    const rows = await this.query(trx).select('*');
    return rows as unknown as AgentProfileRow[];
  }

  async findByName(name: string, trx?: Knex.Transaction): Promise<AgentProfileRow | null> {
    const row = await this.query(trx).where({ name }).first();
    return (row as unknown as AgentProfileRow) ?? null;
  }

  async insert(row: Omit<AgentProfileRow, 'id' | 'created_at'>, trx?: Knex.Transaction): Promise<void> {
    const now = Date.now();
    await this.query(trx).insert({
      ...row,
      id: generateDeterministicId('profile', 'global', row.name),
      created_at: now,
    });
  }

  async upsert(row: Omit<AgentProfileRow, 'id' | 'created_at'>, trx?: Knex.Transaction): Promise<void> {
    const existing = await this.findByName(row.name, trx);
    if (!existing) {
      await this.insert(row, trx);
      return;
    }
    await this.updateByName(row.name, row, trx);
  }

  async updateByName(
    name: string,
    row: Partial<Omit<AgentProfileRow, 'id' | 'name' | 'created_at'>>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.query(trx)
      .where({ name })
      .update({
        ...row,
        updated_at: Date.now(),
      });
  }

  async deleteByName(name: string, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ name }).del();
  }

  async count(trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx)
      .count('* as cnt')
      .first();
    return Number((result as Record<string, unknown>)?.cnt ?? 0);
  }
}
