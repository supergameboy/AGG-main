import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type { IQuestRepository, Quest, QuestStatus } from './types.js';
import { rowToQuest, questToRow } from './mappers.js';

/**
 * quests 表 Repository 实现（S3-1 Phase B）。
 *
 * D7: 一表一 Repository，本类只操作 quests 表。
 * D9: 所有方法支持可选 trx 参数，事务由 Service 层管理。
 *
 * 覆盖 QuestService 全部 19 处 quests 表 db 调用：
 * - 查询 10 方法（findById/findBySaveId/findBySaveIdAndStatus/findByName/findByNameLike/
 *   findNamesBySaveId/findByNpcId/findMainQuest/findLockedByDependency/countCompletedByIds）
 * - 写入 3 方法（insert/update/delete）
 */
export class QuestRepository
  extends BaseRepository<'quests', Quest>
  implements IQuestRepository
{
  constructor(db: Knex) {
    super(db, 'quests');
  }

  protected rowToEntity(row: Record<string, unknown>): Quest {
    return rowToQuest(row);
  }

  // ===========================================================================
  // 查询方法
  // ===========================================================================

  async findById(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<Quest | null> {
    const row = await this.query(trx)
      .where({ id: questId, save_id: saveId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findBySaveId(
    saveId: ID,
    options?: { status?: QuestStatus; visible?: boolean },
    trx?: Knex.Transaction,
  ): Promise<Quest[]> {
    let query = this.query(trx)
      .where({ save_id: saveId })
      .select('*')
      .orderBy('created_at', 'asc');

    if (options?.status) {
      query = query.where({ status: options.status });
    }
    if (options?.visible !== undefined) {
      // SQLite 中 visible 字段为 integer 0/1，boolean 显式转换为整数
      query = query.where({ visible: options.visible ? 1 : 0 });
    }

    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findBySaveIdAndStatus(saveId: ID, status: QuestStatus, trx?: Knex.Transaction): Promise<Quest[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, status })
      .select('*');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<Quest | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, name })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByNameLike(saveId: ID, namePattern: string, trx?: Knex.Transaction): Promise<Quest | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .where('name', 'like', namePattern)
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findNamesBySaveId(
    saveId: ID,
    limit: number = 20,
    trx?: Knex.Transaction,
  ): Promise<Array<{ id: ID; name: string }>> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .select('id', 'name')
      .limit(limit);
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as ID,
      name: row.name as string,
    }));
  }

  async findByNpcId(saveId: ID, npcId: ID, trx?: Knex.Transaction): Promise<Quest[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, giver_npc_id: npcId })
      .select('*')
      .orderBy('created_at', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findMainQuest(saveId: ID, trx?: Knex.Transaction): Promise<Quest | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, type: 'main' })
      .whereNotIn('status', ['completed', 'failed'])
      .orderBy('created_at', 'asc')
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findLockedByDependency(
    saveId: ID,
    trx?: Knex.Transaction,
  ): Promise<Array<{ id: ID; prerequisiteQuestIds: string[] }>> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, status: 'locked' })
      .select('id', 'prerequisite_quest_ids');

    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as ID,
      prerequisiteQuestIds: parsePrerequisiteIds(row.prerequisite_quest_ids),
    }));
  }

  async countCompletedByIds(saveId: ID, questIds: ID[], trx?: Knex.Transaction): Promise<number> {
    if (questIds.length === 0) return 0;
    const result = await this.query(trx)
      .where({ save_id: saveId, status: 'completed' })
      .whereIn('id', questIds)
      .count('* as cnt')
      .first();
    return Number((result as Record<string, unknown> | undefined)?.cnt ?? 0);
  }

  // ===========================================================================
  // 写入方法
  // ===========================================================================

  async insert(
    data: Omit<Quest, 'id'> & { id?: ID },
    saveId: ID,
    trx?: Knex.Transaction,
  ): Promise<Quest> {
    const id = (data.id ?? generateQuestId(data.name)) as ID;
    const entityWithId: Quest = { ...data, id, saveId };
    const row = questToRow(entityWithId);
    await this.query(trx).insert(row);
    const inserted = await this.findById(id, saveId, trx);
    if (!inserted) throw new Error(`Failed to insert quest: ${id}`);
    return inserted;
  }

  async update(
    questId: ID,
    saveId: ID,
    patch: Partial<Quest>,
    trx?: Knex.Transaction,
  ): Promise<Quest | null> {
    const row = questPartialToRow(patch);
    // Service 未显式设置 updatedAt 时，Repository 自动补齐（避免 7 处调用重复设置）
    if (patch.updatedAt === undefined) {
      row.updated_at = Date.now() as Timestamp;
    }
    await this.query(trx)
      .where({ id: questId, save_id: saveId })
      .update(row);
    return this.findById(questId, saveId, trx);
  }

  async delete(questId: ID, saveId: ID, trx?: Knex.Transaction): Promise<boolean> {
    const affected = await this.query(trx)
      .where({ id: questId, save_id: saveId })
      .del();
    return affected > 0;
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  async countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx).where({ save_id: saveId }).count('* as cnt').first();
    return Number(result?.cnt ?? 0);
  }

  // === S6 新增（StoryKernel 跨领域 quests 表只读查询） ===

  async getActiveTimeLimitedQuests(
    saveId: ID,
    trx?: Knex.Transaction,
  ): Promise<Array<{ time_limit: number; created_at: number }>> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, status: 'active' })
      .where('time_limit', '>', 0)
      .select('time_limit', 'created_at');
    return rows.map((row: Record<string, unknown>) => ({
      time_limit: (row.time_limit as number) ?? 0,
      created_at: (row.created_at as number) ?? 0,
    }));
  }

  async getMainQuestId(saveId: ID, trx?: Knex.Transaction): Promise<string | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, type: 'main' })
      .select('id')
      .first();
    return (row as Record<string, unknown> | undefined)?.id as string | null ?? null;
  }
}

// ===========================================================================
// 模块内私有辅助函数
// ===========================================================================

/**
 * 生成任务 ID（从 QuestService.generateQuestId L1021 迁入）。
 * 格式：quest_<snakeCase>_<timestamp>，保留中文与字母数字。
 */
function generateQuestId(name: string): string {
  const snakeCase = name
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return `quest_${snakeCase}_${Date.now()}`;
}

/**
 * 解析 prerequisite_quest_ids 字段为 string[]。
 * 边界处防御性解析：JSON 字符串 parse 失败或非数组时返回空数组。
 */
function parsePrerequisiteIds(raw: unknown): string[] {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw.map(String) : [];
}

/**
 * Quest 实体部分字段 → quests 表行（用于 update）。
 * 仅转换值不为 undefined 的字段，支持部分更新。
 * JSON 字段需 JSON.stringify，visible boolean → integer 0/1。
 */
function questPartialToRow(entity: Partial<Quest>): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  if (entity.name !== undefined) row.name = entity.name;
  if (entity.description !== undefined) row.description = entity.description;
  if (entity.type !== undefined) row.type = entity.type;
  if (entity.status !== undefined) row.status = entity.status;
  if (entity.visible !== undefined) row.visible = entity.visible ? 1 : 0;
  if (entity.prerequisiteQuestIds !== undefined) {
    row.prerequisite_quest_ids = JSON.stringify(entity.prerequisiteQuestIds);
  }
  if (entity.conditions !== undefined) {
    row.conditions = entity.conditions ? JSON.stringify(entity.conditions) : null;
  }
  if (entity.giverNpcId !== undefined) row.giver_npc_id = entity.giverNpcId;
  if (entity.giverLocationId !== undefined) row.giver_location_id = entity.giverLocationId;
  if (entity.questChainId !== undefined) row.quest_chain_id = entity.questChainId;
  if (entity.rewards !== undefined) row.rewards = JSON.stringify(entity.rewards);
  if (entity.timeLimit !== undefined) row.time_limit = entity.timeLimit;
  if (entity.customData !== undefined) row.custom_data = JSON.stringify(entity.customData);
  if (entity.createdAt !== undefined) row.created_at = entity.createdAt;
  if (entity.updatedAt !== undefined) row.updated_at = entity.updatedAt;

  return row;
}
