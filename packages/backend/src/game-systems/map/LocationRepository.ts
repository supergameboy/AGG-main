import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, Timestamp, generateReadableId } from '../../../../shared/src/types/core.js';
import { mapLocationRowToData } from './mappers.js';
import type { ILocationRepository, LocationData } from './types.js';

/**
 * locations 表 Repository 实现（D7: 一表一 Repository）。
 *
 * 从 MapService 多处 db('locations') 调用收敛而来，统一封装:
 * - row → LocationData 映射（共享 mappers.mapLocationRowToData）
 * - CRUD + 11 个查询方法
 * - D9 trx 透传（事务内调用透传 trx 参数）
 *
 * 运行时计算字段（connections/childLocationIds/isParent）不在本 Repository 范围，
 * 由 MapService 通过 LocationConnectionRepository + findAllParentLinks 填充。
 */
export class LocationRepository
  extends BaseRepository<'locations', LocationData>
  implements ILocationRepository
{
  constructor(db: Knex) {
    super(db, 'locations');
  }

  protected rowToEntity(row: Record<string, unknown>): LocationData {
    return mapLocationRowToData(row);
  }

  /**
   * entity → row 转换（insert/update 共用）。
   * 仅转换值不为 undefined 的字段，支持部分更新。
   * JSON 字段（events/customData）需 JSON.stringify。
   * 运行时计算字段（connections/childLocationIds/isParent）不持久化，跳过。
   */
  private entityToRow(entity: Partial<LocationData>): Record<string, unknown> {
    const row: Record<string, unknown> = {};

    if (entity.saveId !== undefined) row.save_id = entity.saveId;
    if (entity.locationLevel !== undefined) row.location_level = entity.locationLevel;
    if (entity.parentLocationId !== undefined) row.parent_location_id = entity.parentLocationId;
    if (entity.name !== undefined) row.name = entity.name;
    if (entity.description !== undefined) row.description = entity.description;
    if (entity.type !== undefined) row.type = entity.type;
    if (entity.terrainType !== undefined) row.terrain_type = entity.terrainType;
    if (entity.coordinates !== undefined) {
      row.x = entity.coordinates.x;
      row.y = entity.coordinates.y;
    }
    if (entity.isExplored !== undefined) row.is_explored = entity.isExplored ? 1 : 0;
    if (entity.dangerLevel !== undefined) row.danger_level = entity.dangerLevel;
    if (entity.visible !== undefined) row.visible = entity.visible ? 1 : 0;

    // JSON 字段需 stringify
    if (entity.events !== undefined) row.events = JSON.stringify(entity.events ?? []);
    if (entity.customData !== undefined) row.custom_data = JSON.stringify(entity.customData ?? {});

    return row;
  }

  async findById(locationId: ID, saveId: ID, trx?: Knex.Transaction): Promise<LocationData | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, id: locationId })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByIds(locationIds: ID[], saveId: ID, trx?: Knex.Transaction): Promise<LocationData[]> {
    if (locationIds.length === 0) return [];
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereIn('id', locationIds)
      .select('*');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByName(saveId: ID, name: string, trx?: Knex.Transaction): Promise<LocationData | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId, name })
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async findByNameLike(saveId: ID, namePattern: string, trx?: Knex.Transaction): Promise<LocationData | null> {
    // 拆分为两步：先用 where({ save_id }) 读取所有 locations（ShadowState 正确命中），
    // 再在内存中按 LIKE 语义过滤。避免 whereRaw/orWhereRaw 在 StagingKnex 中
    // conditions 不被追踪导致 ShadowState 返回当前 save 内所有 locations 而非仅匹配 LIKE 的行。
    // SQL LIKE '%pattern%' 等价于 includes(pattern)（SQLite 默认 ASCII 大小写不敏感）。
    const allLocations = await this.findBySaveId(saveId, undefined, trx);
    const lower = namePattern.toLowerCase();
    for (const loc of allLocations) {
      if (loc.name?.toLowerCase().includes(lower) || loc.description?.toLowerCase().includes(lower)) {
        return loc;
      }
    }
    return null;
  }

  async findBySaveId(saveId: ID, options?: { locationLevel?: number }, trx?: Knex.Transaction): Promise<LocationData[]> {
    let qb = this.query(trx).where({ save_id: saveId });
    if (options?.locationLevel !== undefined) {
      qb = qb.where({ location_level: options.locationLevel });
    }
    const rows = await qb.select('*').orderBy('name', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByParentId(saveId: ID, parentLocationId: ID, trx?: Knex.Transaction): Promise<LocationData[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, parent_location_id: parentLocationId })
      .select('*')
      .orderBy('name', 'asc');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async search(saveId: ID, query: { name?: string; type?: string; locationLevel?: number }, trx?: Knex.Transaction): Promise<LocationData[]> {
    // 拆分为两步：先用 where({ save_id, location_level }) 读取（ShadowState 正确命中），
    // 再在内存中按 LIKE 语义过滤。避免 whereRaw 在 StagingKnex 中 conditions 不被追踪
    // 导致 ShadowState 返回当前 save 内所有 locations 而非仅匹配 LIKE 的行。
    const allLocations = await this.findBySaveId(saveId, { locationLevel: query.locationLevel }, trx);

    let results = allLocations;
    if (query.name) {
      const nameLower = query.name.toLowerCase();
      results = results.filter(loc => loc.name?.toLowerCase().includes(nameLower));
    }
    if (query.type) {
      const typeLower = query.type.toLowerCase();
      results = results.filter(loc => loc.type?.toLowerCase().includes(typeLower));
    }

    // findBySaveId 已按 name 排序，只需 limit
    results = results.slice(0, 50);

    // 校验返回值：若所有 id 都缺失，记录警告（上游 staging-knex 或 schema 问题的信号）
    const validIdCount = results.filter(r => r.id !== undefined && r.id !== null && r.id !== '' && !r.id.startsWith('loc_unknown_')).length;
    if (results.length > 0 && validIdCount === 0) {
      console.warn('[LocationRepository.search] 所有返回行的 id 缺失，可能上游 staging-knex 或 schema 问题', { saveId, rowCount: results.length });
    }
    return results;
  }

  async findIdsByParentId(saveId: ID, parentLocationId: ID, trx?: Knex.Transaction): Promise<ID[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId, parent_location_id: parentLocationId })
      .select('id');
    return rows.map((r: { id: string }) => r.id as ID);
  }

  async findAllParentLinks(saveId: ID, trx?: Knex.Transaction): Promise<Array<{ id: ID; parentLocationId: ID | null }>> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereNotNull('parent_location_id')
      .select('id', 'parent_location_id');
    return rows.map((r: { id: string; parent_location_id: string | null }) => ({
      id: r.id as ID,
      parentLocationId: (r.parent_location_id as ID) ?? null,
    }));
  }

  async findNamesByIds(saveId: ID, locationIds: ID[], trx?: Knex.Transaction): Promise<Map<ID, string>> {
    if (locationIds.length === 0) return new Map();
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereIn('id', locationIds)
      .select('id', 'name');
    return new Map(rows.map((r: { id: string; name: string }) => [r.id as ID, r.name]));
  }

  async insert(data: Omit<LocationData, 'id'> & { id?: ID }, saveId: ID, trx?: Knex.Transaction): Promise<LocationData> {
    const id = (data.id || generateReadableId('loc', data.name || 'unknown')) as ID;
    const now = Date.now() as Timestamp;
    const row = this.entityToRow(data);

    await this.query(trx).insert({
      ...row,
      id,
      save_id: saveId,
      is_explored: data.isExplored ? 1 : 0,
      custom_data: row.custom_data ?? '{}',
      created_at: now,
      updated_at: now,
    });

    const inserted = await this.query(trx).where({ id, save_id: saveId }).first();
    return this.rowToEntity(inserted);
  }

  async update(locationId: ID, saveId: ID, patch: Partial<LocationData>, trx?: Knex.Transaction): Promise<LocationData | null> {
    const row = this.entityToRow(patch);
    await this.query(trx)
      .where({ save_id: saveId, id: locationId })
      .update({ ...row, updated_at: Date.now() as Timestamp });
    const updated = await this.query(trx).where({ save_id: saveId, id: locationId }).first();
    return updated ? this.rowToEntity(updated) : null;
  }

  async delete(locationId: ID, saveId: ID, trx?: Knex.Transaction): Promise<boolean> {
    const count = await this.query(trx)
      .where({ save_id: saveId, id: locationId })
      .del();
    return count > 0;
  }

  async clearParentForChildren(saveId: ID, parentLocationId: ID, trx?: Knex.Transaction): Promise<number> {
    return await this.query(trx)
      .where({ save_id: saveId, parent_location_id: parentLocationId })
      .update({ parent_location_id: null, updated_at: Date.now() as Timestamp });
  }

  async findFirstBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<LocationData | null> {
    const row = await this.query(trx)
      .where({ save_id: saveId })
      .orderBy('created_at', 'asc')
      .first();
    return row ? this.rowToEntity(row) : null;
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }

  async countBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<number> {
    const result = await this.query(trx).where({ save_id: saveId }).count('* as cnt').first();
    return Number(result?.cnt ?? 0);
  }
}
