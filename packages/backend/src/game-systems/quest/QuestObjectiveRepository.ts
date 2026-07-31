import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, generateReadableId } from '../../../../shared/src/types/core.js';
import type { IQuestObjectiveRepository, QuestObjective } from './types.js';
import { rowToObjective, objectiveToRow } from './mappers.js';

/**
 * quest_objectives 表 Repository 实现（S3-1 Phase B）。
 *
 * D7: 一表一 Repository，本类只操作 quest_objectives 表。
 * D9: 所有方法支持可选 trx 参数，事务由 Service 层管理。
 *
 * 覆盖 QuestService 全部 6 处 quest_objectives 表 db 调用：
 * - 查询 3 方法（findByQuestId/findById/findEventTriggeredActiveByQuestIds）
 * - 写入 3 方法（insert/update/deleteByQuestId）
 *
 * 偏差修订（S3-1）: 修复 handleGameEvent L923 遗漏 save_id 过滤的 BUG（原代码仅按 quest_id 过滤，
 * 跨存档理论上会污染；新方法 findEventTriggeredActiveByQuestIds 强制带 save_id）。
 */
export class QuestObjectiveRepository
  extends BaseRepository<'quest_objectives', QuestObjective>
  implements IQuestObjectiveRepository
{
  constructor(db: Knex) {
    super(db, 'quest_objectives');
  }

  protected rowToEntity(row: Record<string, unknown>): QuestObjective {
    return rowToObjective(row);
  }

  // ===========================================================================
  // 查询方法
  // ===========================================================================

  async findByQuestId(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<QuestObjective[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, quest_id: questId })
      .select('*')
      .orderBy('id', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByQuestIds(saveId: ID, questIds: ID[], trx?: Knex.Transaction): Promise<QuestObjective[]> {
    if (questIds.length === 0) return [];
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereIn('quest_id', questIds)
      .select('*')
      .orderBy('id', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(objectiveId: ID, saveId: ID, trx?: Knex.Transaction): Promise<QuestObjective | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, id: objectiveId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findEventTriggeredActiveByQuestIds(
    saveId: ID,
    questIds: ID[],
    trx?: Knex.Transaction,
  ): Promise<QuestObjective[]> {
    if (questIds.length === 0) return [];
    const rows = await this.query(trx)
      .where({ save_id: saveId, completed: 0 })
      .whereIn('quest_id', questIds)
      .whereNotNull('event_trigger')
      .select('*');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  // ===========================================================================
  // 写入方法
  // ===========================================================================

  async insert(
    data: Omit<QuestObjective, 'id'> & { id?: ID },
    saveId: ID,
    trx?: Knex.Transaction,
  ): Promise<QuestObjective> {
    const id = (data.id ?? generateReadableId('obj', data.description || 'objective')) as ID;
    const entityWithId: QuestObjective = { ...data, id };
    const row = objectiveToRow(entityWithId, saveId);
    await this.query(trx).insert(row);
    const inserted = await this.findById(id, saveId, trx);
    if (!inserted) throw new Error(`Failed to insert quest objective: ${id}`);
    return inserted;
  }

  async update(
    objectiveId: ID,
    saveId: ID,
    patch: Partial<QuestObjective>,
    trx?: Knex.Transaction,
  ): Promise<QuestObjective | null> {
    const row = objectivePartialToRow(patch);
    await this.query(trx)
      .where({ id: objectiveId, save_id: saveId })
      .update(row);
    return this.findById(objectiveId, saveId, trx);
  }

  async deleteByQuestId(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<number> {
    return await this.query(trx)
      .where({ save_id: saveId, quest_id: questId })
      .del();
  }

  // === S6 新增（StoryKernel 跨领域 quest_objectives 表只读查询） ===

  async getProgressByQuestId(
    questId: ID,
    trx?: Knex.Transaction,
  ): Promise<Array<{ current: number; required: number }>> {
    const rows = await this.query(trx)
      .where({ quest_id: questId })
      .select('current', 'required');
    return rows.map((row: Record<string, unknown>) => ({
      current: (row.current as number) ?? 0,
      required: (row.required as number) ?? 0,
    }));
  }
}

// ===========================================================================
// 模块内私有辅助函数
// ===========================================================================

/**
 * QuestObjective 实体部分字段 → quest_objectives 表行（用于 update）。
 * 仅转换值不为 undefined 的字段，支持部分更新。
 * JSON 字段 eventTrigger 需 JSON.stringify，completed boolean → integer 0/1。
 */
function objectivePartialToRow(entity: Partial<QuestObjective>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (entity.questId !== undefined) row.quest_id = entity.questId;
  if (entity.description !== undefined) row.description = entity.description;
  if (entity.type !== undefined) row.type = entity.type;
  if (entity.target !== undefined) row.target = entity.target;
  if (entity.required !== undefined) row.required = entity.required;
  if (entity.current !== undefined) row.current = entity.current;
  if (entity.completed !== undefined) row.completed = entity.completed ? 1 : 0;
  if (entity.eventTrigger !== undefined) {
    row.event_trigger = entity.eventTrigger ? JSON.stringify(entity.eventTrigger) : null;
  }

  return row;
}
