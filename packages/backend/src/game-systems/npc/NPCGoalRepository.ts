import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { npcGoalRowToGoal } from './mappers.js';
import type { INPCGoalRepository, NPCGoal } from './types.js';

/**
 * npc_goals 表 Repository 实现（D7: 一表一 Repository）。
 *
 * 从 NPCService 3 处 db('npc_goals') 调用收敛而来:
 * - 目标查询（getGoals / getActiveGoals）
 * - 目标写入（createGoal / updateGoal）
 *
 * NPCGoal 包含 id/saveId/npcId/createdAt/updatedAt 字段，
 * insert 时由 Repository 生成 id 和时间戳。
 */
export class NPCGoalRepository
  extends BaseRepository<'npc_goals', NPCGoal>
  implements INPCGoalRepository
{
  constructor(db: Knex) {
    super(db, 'npc_goals');
  }

  protected rowToEntity(row: Record<string, unknown>): NPCGoal {
    return npcGoalRowToGoal(row);
  }

  /**
   * entity → row 转换（insert/update 共用）。
   * 仅转换值不为 undefined 的字段，支持部分更新。
   * relatedEntityIds 需 JSON.stringify。
   */
  private entityToRow(entity: Partial<NPCGoal>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.saveId !== undefined) row.save_id = entity.saveId;
    if (entity.npcId !== undefined) row.npc_id = entity.npcId;
    if (entity.type !== undefined) row.type = entity.type;
    if (entity.category !== undefined) row.category = entity.category;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.priority !== undefined) row.priority = entity.priority;
    if (entity.status !== undefined) row.status = entity.status;
    if (entity.relatedEntityIds !== undefined) {
      row.related_entity_ids = JSON.stringify(entity.relatedEntityIds ?? []);
    }
    if (entity.progress !== undefined) row.progress = entity.progress;

    return row;
  }

  async findBySaveIdAndNpcId(
    saveId: ID,
    npcId: ID,
    options?: { status?: string },
    trx?: Knex.Transaction,
  ): Promise<NPCGoal[]> {
    const query = this.query(trx).where({ save_id: saveId, npc_id: npcId });
    if (options?.status) {
      query.where({ status: options.status });
    }
    const rows = await query.orderBy('priority', 'desc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async insert(
    goal: Omit<NPCGoal, 'id' | 'createdAt' | 'updatedAt'>,
    trx?: Knex.Transaction,
  ): Promise<NPCGoal> {
    const id = generateReadableId('goal', goal.npcId);
    const now = Date.now() as Timestamp;
    const row = this.entityToRow(goal);

    await this.query(trx).insert({
      ...row,
      id,
      created_at: now,
      updated_at: now,
    });

    const inserted = await this.query(trx).where({ id }).first();
    return this.rowToEntity(inserted);
  }

  async update(
    saveId: ID,
    goalId: ID,
    patch: Partial<NPCGoal>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const row = this.entityToRow(patch);
    await this.query(trx)
      .where({ save_id: saveId, id: goalId })
      .update({ ...row, updated_at: Date.now() as Timestamp });
  }
}
