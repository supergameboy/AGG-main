import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, Timestamp, generateDeterministicId } from '../../../../shared/src/types/core.js';
import { mapSkillPoolRowToEntry } from './mappers.js';
import type { ISkillPoolRepository } from './types.js';
import type { SkillPoolEntry } from '../../../../shared/src/types/game.js';

/**
 * skill_pool 表 Repository 实现（D7: 一表一 Repository）。
 *
 * 从 SkillService 多处 db('skill_pool') 调用收敛而来，统一封装:
 * - row → SkillPoolEntry 映射（共享 mappers.mapSkillPoolRowToEntry）
 * - CRUD + 4 个查询方法
 * - D9 trx 透传（事务内调用透传 trx 参数）
 */
export class SkillPoolRepository
  extends BaseRepository<'skill_pool', SkillPoolEntry>
  implements ISkillPoolRepository
{
  constructor(db: Knex) {
    super(db, 'skill_pool');
  }

  protected rowToEntity(row: Record<string, unknown>): SkillPoolEntry {
    return mapSkillPoolRowToEntry(row);
  }

  /**
   * entity → row 转换（insert + update 共用）。
   * JSON 字段（cost/damage/effects/customData/recommendedClasses）需 JSON.stringify。
   * learned 布尔转 0/1 整数。
   * 支持 Partial：仅转换非 undefined 字段（供 update 增量更新使用）。
   */
  private entityToRow(entity: Partial<SkillPoolEntry> & { id?: ID }): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.id !== undefined) row.id = entity.id;
    if (entity.saveId !== undefined) row.save_id = entity.saveId;
    if (entity.name !== undefined) row.name = entity.name;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.category !== undefined) row.category = entity.category;
    if (entity.element !== undefined) row.element = entity.element;
    if (entity.cost !== undefined) row.cost = JSON.stringify(entity.cost ?? []);
    if (entity.damage !== undefined) row.damage = JSON.stringify(entity.damage ?? {});
    if (entity.effects !== undefined) row.effects = JSON.stringify(entity.effects ?? []);
    if (entity.cooldown !== undefined) row.cooldown = entity.cooldown;
    if (entity.maxLevel !== undefined) row.max_level = entity.maxLevel;
    if (entity.targetType !== undefined) row.target_type = entity.targetType;
    if (entity.range !== undefined) row.range = entity.range;
    if (entity.learned !== undefined) row.learned = entity.learned ? 1 : 0;
    if (entity.customData !== undefined) row.custom_data = JSON.stringify(entity.customData ?? {});
    if (entity.recommendedClasses !== undefined) row.recommended_classes = JSON.stringify(entity.recommendedClasses ?? []);

    return row;
  }

  async findBySaveId(saveId: ID, options?: { learned?: boolean; category?: string }, trx?: Knex.Transaction): Promise<SkillPoolEntry[]> {
    let query = this.query(trx).where({ save_id: saveId });

    if (options?.learned === true) {
      query = query.where({ learned: 1 });
    } else if (options?.learned === false) {
      query = query.where({ learned: 0 });
    }

    if (options?.category) {
      query = query.where({ category: options.category });
    }

    const rows = await query.orderBy('created_at', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findById(saveId: ID, poolSkillId: string, trx?: Knex.Transaction): Promise<SkillPoolEntry | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, id: poolSkillId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<SkillPoolEntry | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, name })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByIdOrName(idOrName: string, saveId: ID, trx?: Knex.Transaction): Promise<SkillPoolEntry | null> {
    // 1. 按 ID 精确匹配
    const byId = await this.query(trx)
      .where({ id: idOrName, save_id: saveId })
      .first();
    if (byId) return this.rowToEntity(byId);

    // 2. 按 name 精确匹配
    const byName = await this.query(trx)
      .where({ save_id: saveId, name: idOrName })
      .first();
    return byName ? this.rowToEntity(byName) : null;
  }

  async insert(entry: Omit<SkillPoolEntry, 'id'> & { id?: ID }, trx?: Knex.Transaction): Promise<SkillPoolEntry> {
    const id = entry.id ?? generateDeterministicId('skill', entry.saveId, entry.name);
    const now = Date.now() as Timestamp;
    const row = this.entityToRow({ ...entry, id });

    await this.query(trx).insert({
      ...row,
      id,
      created_at: now,
      updated_at: now,
    });

    const inserted = await this.query(trx)
      .where({ save_id: entry.saveId, id })
      .first();
    return this.rowToEntity(inserted);
  }

  async updateLearned(saveId: ID, poolSkillId: string, learned: boolean, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx)
      .where({ save_id: saveId, id: poolSkillId })
      .update({ learned: learned ? 1 : 0, updated_at: Date.now() as Timestamp });
  }

  async update(saveId: ID, poolSkillId: string, patch: Partial<SkillPoolEntry>, trx?: Knex.Transaction): Promise<SkillPoolEntry | null> {
    const row = this.entityToRow(patch);
    await this.query(trx)
      .where({ save_id: saveId, id: poolSkillId })
      .update({ ...row, updated_at: Date.now() as Timestamp });
    const updated = await this.query(trx)
      .where({ save_id: saveId, id: poolSkillId })
      .first();
    return updated ? this.rowToEntity(updated) : null;
  }

  async delete(saveId: ID, poolSkillId: string, trx?: Knex.Transaction): Promise<boolean> {
    const count = await this.query(trx)
      .where({ save_id: saveId, id: poolSkillId })
      .del();
    return count > 0;
  }

  async countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx).where({ save_id: saveId }).count('* as cnt').first();
    return Number(result?.cnt ?? 0);
  }
}
