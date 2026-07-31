import type { Knex } from 'knex';
import { ID, generateDeterministicId } from '../../../../shared/src/types/core.js';
import type { IDiscoveredLocationRepository } from './types.js';

/**
 * discovered_locations 表 Repository 实现（D7: 一表一 Repository）。
 *
 * discovered_locations 记录玩家已发现的地点，用于小地图显示过滤。
 * 表结构: id, save_id, location_id, discovered_at (TEXT, ISO 字符串)
 * 约束: UNIQUE(save_id, location_id) 保证幂等
 */
export class DiscoveredLocationRepository implements IDiscoveredLocationRepository {
  constructor(private readonly db: Knex) {}

  async findLocationIdsBySaveId(saveId: ID, trx?: Knex.Transaction): Promise<ID[]> {
    const query = trx ? trx('discovered_locations') : this.db('discovered_locations');
    const rows = await query.where({ save_id: saveId }).select('location_id');
    return rows.map((row: Record<string, unknown>) => row.location_id as ID);
  }

  async insert(saveId: ID, locationId: ID, trx?: Knex.Transaction): Promise<void> {
    const query = trx ? trx('discovered_locations') : this.db('discovered_locations');
    const id = generateDeterministicId('disc', saveId, locationId as string);
    // INSERT OR IGNORE: UNIQUE(save_id, location_id) 约束保证幂等，重复插入静默忽略
    await query.insert({
      id,
      save_id: saveId,
      location_id: locationId,
      discovered_at: new Date().toISOString(),
    }).onConflict(['save_id', 'location_id']).ignore();
  }
}
