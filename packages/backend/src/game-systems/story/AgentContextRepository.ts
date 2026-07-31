import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, generateDeterministicId } from '../../../../shared/src/types/core.js';
import type { AgentContextRow, IAgentContextRepository } from './types.js';

/**
 * agent_contexts 表 Repository 实现（D7: 操作 agent_contexts 表，migration 004）。
 *
 * 表结构：messages + state 为两个独立 JSON 字符串字段（非 context_data 单字段）。
 * Repository 只做 CRUD 透传 string，不负责 JSON 解析或合并——合并逻辑属于 Service 层。
 *
 * D9: 所有写操作支持可选 trx 参数。
 * S4-D6: deleteBySaveId 统一返回 Promise<void>。
 */
export class AgentContextRepository
  extends BaseRepository<'agent_contexts', AgentContextRow>
  implements IAgentContextRepository
{
  constructor(db: Knex) {
    super(db, 'agent_contexts');
  }

  protected rowToEntity(row: Record<string, unknown>): AgentContextRow {
    return row as unknown as AgentContextRow;
  }

  async getContext(saveId: ID, agentType: string, trx?: Knex.Transaction): Promise<AgentContextRow | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, agent_type: agentType })
      .first();
    return (row as unknown as AgentContextRow) ?? null;
  }

  async upsert(
    saveId: ID,
    agentType: string,
    messages: string,
    state: string,
    trx?: Knex.Transaction
  ): Promise<void> {
    const id = generateDeterministicId('ctx', saveId, agentType) as ID;
    await this.query(trx)
      .insert({
        id,
        save_id: saveId,
        agent_type: agentType,
        messages,
        state,
        updated_at: Date.now(),
      })
      .onConflict(['save_id', 'agent_type'])
      .merge();
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }
}
