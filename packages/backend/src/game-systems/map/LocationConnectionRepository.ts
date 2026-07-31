import type { Knex } from 'knex';
import { BaseRepository } from '../../database/BaseRepository.js';
import { ID, generateDeterministicId } from '../../../../shared/src/types/core.js';
import type { ILocationConnectionRepository, LocationConnection } from './types.js';

/**
 * location_connections 表 Repository 实现（D7: 一表一 Repository）。
 *
 * 从 MapService 多处 db('location_connections') 调用收敛而来:
 * - 连接查询（fillConnections / getRegionConnections / findShortestPathBFS）
 * - 连接写入（createLocation / updateLocation）
 * - 连接清理（deleteLocation / updateLocation）
 *
 * 连接为双向语义: A→B 表示 A 与 B 相邻，消费方（MapService.fillConnections）
 * 同时查 from 和 to 方向构建双向邻接表。
 */
export class LocationConnectionRepository
  extends BaseRepository<'location_connections', LocationConnection>
  implements ILocationConnectionRepository
{
  constructor(db: Knex) {
    super(db, 'location_connections');
  }

  protected rowToEntity(row: Record<string, unknown>): LocationConnection {
    const customData = typeof row.custom_data === 'string'
      ? JSON.parse(row.custom_data)
      : (row.custom_data as Record<string, unknown> | null) ?? undefined;

    return {
      fromLocationId: row.from_location_id as ID,
      toLocationId: row.to_location_id as ID,
      connectionType: (row.connection_type as string | undefined) ?? 'normal',
      customData,
      distance: row.distance != null ? Number(row.distance) : null,
    };
  }

  async findConnectedIds(saveId: ID, fromLocationId: ID, trx?: Knex.Transaction): Promise<ID[]> {
    // 拆分为两个显式 where(object) 查询，避免 where(callback)/orWhere 在
    // StagingKnex 中 conditions 不被追踪导致 ShadowState 读取范围错误放大
    // （会返回当前 save 内所有连接而非仅与 fromLocationId 相连的连接）。
    const fromRows = await this.query(trx)
      .where({ save_id: saveId, from_location_id: fromLocationId })
      .select('to_location_id');
    const toRows = await this.query(trx)
      .where({ save_id: saveId, to_location_id: fromLocationId })
      .select('from_location_id');

    const connectedIds = new Set<ID>();
    for (const row of fromRows) {
      connectedIds.add(row.to_location_id as ID);
    }
    for (const row of toRows) {
      connectedIds.add(row.from_location_id as ID);
    }
    return Array.from(connectedIds);
  }

  async findByFromIds(saveId: ID, fromIds: ID[], trx?: Knex.Transaction): Promise<LocationConnection[]> {
    // 过滤 undefined/null/空字符串，避免 knex whereIn 编译 "Undefined binding(s)" 错误。
    // 与 MapService.fillConnections 形成双重防御。
    const validIds = fromIds.filter((id): id is ID => id !== undefined && id !== null && id !== '');
    if (validIds.length === 0) return [];
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereIn('from_location_id', validIds)
      .select('from_location_id', 'to_location_id');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findByToIds(saveId: ID, toIds: ID[], trx?: Knex.Transaction): Promise<LocationConnection[]> {
    // 过滤 undefined/null/空字符串，避免 knex whereIn 编译 "Undefined binding(s)" 错误。
    const validIds = toIds.filter((id): id is ID => id !== undefined && id !== null && id !== '');
    if (validIds.length === 0) return [];
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .whereIn('to_location_id', validIds)
      .select('from_location_id', 'to_location_id');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async findAll(saveId: ID, trx?: Knex.Transaction): Promise<LocationConnection[]> {
    const rows = await this.query(trx)
      .where({ save_id: saveId })
      .select('from_location_id', 'to_location_id', 'connection_type', 'distance', 'custom_data');
    return rows.map((row: Record<string, unknown>) => this.rowToEntity(row));
  }

  async exists(saveId: ID, fromLocationId: ID, toLocationId: ID, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.query(trx)
      .where({ save_id: saveId, from_location_id: fromLocationId, to_location_id: toLocationId })
      .first();
    return !!row;
  }

  async insert(saveId: ID, fromLocationId: ID, toLocationId: ID, trx?: Knex.Transaction): Promise<void> {
    const id = generateDeterministicId('conn', saveId, `${fromLocationId}_${toLocationId}`);
    await this.query(trx).insert({
      id,
      save_id: saveId,
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      connection_type: 'normal',
    });
  }

  async deleteByLocationId(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<number> {
    // 拆分为两个显式 where(object) delete，避免 where(callback)/orWhere 在
    // StagingKnex 中 conditions 不被追踪导致 ShadowState 误删全表
    // （scopeField 剥离后 where 为空，delete 会匹配当前 save 内所有行）。
    const r1 = await this.query(trx)
      .where({ save_id: saveId, from_location_id: locationId })
      .del();
    const r2 = await this.query(trx)
      .where({ save_id: saveId, to_location_id: locationId })
      .del();
    // StagingKnex 写操作返回 {}（非 number），实际删除行数在 flush 阶段统计
    return (typeof r1 === 'number' ? r1 : 0) + (typeof r2 === 'number' ? r2 : 0);
  }

  async deleteBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<void> {
    await this.query(trx).where({ save_id: saveId }).del();
  }
}
