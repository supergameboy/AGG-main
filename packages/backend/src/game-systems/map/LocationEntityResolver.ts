/**
 * Location 领域实体引用解析器（13.2 规则收敛）。
 *
 * 继承 EntityResolverBase，通过 ILocationRepository 端口接口访问数据。
 * 将 MapService.resolveLocationIdInternal 的 3 级匹配逻辑收敛到统一设施：
 * 1. findById：id 精确匹配
 * 2. findByName：name 精确匹配 → nameLike 模糊匹配
 * 3. listCandidates：列出候选地点（用于 not_found 错误信息）
 *
 * 时间戳兼容由 EntityResolverBase.resolve 阶段3 提供（多结果时用 timestamp 消歧）。
 *
 * 注意：locations 表的 nameLike 仅返回首个匹配（findByNameLike 返回 LocationData | null）。
 * 若需多结果消歧，需扩展 Repository 提供 findByNameLikeMany 方法（当前保持原行为兼容）。
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import { EntityResolverBase } from '../shared/entity-resolver/EntityResolverBase.js';
import type { ResolvedEntity } from '../shared/entity-resolver/types.js';
import type { ILocationRepository, LocationData } from './types.js';

export class LocationEntityResolver extends EntityResolverBase {
  constructor(
    private readonly locationRepo: ILocationRepository,
    db: Knex,
  ) {
    super(db);
  }

  protected async findById(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null> {
    const byId = await this.locationRepo.findById(ref as ID, saveId, trx);
    return byId ? this.toResolvedEntity(byId, 'id') : null;
  }

  protected async findByName(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    // 1. name 精确匹配
    const byName = await this.locationRepo.findByName(saveId, ref, trx);
    if (byName) return [this.toResolvedEntity(byName, 'name')];

    // 2. nameLike 模糊匹配（支持中文名称的部分匹配，如"匠铺"匹配"铁匠铺"）
    // 当前 findByNameLike 仅返回首个匹配；保持原行为兼容，不引入多结果消歧
    const byNameLike = await this.locationRepo.findByNameLike(saveId, ref, trx);
    return byNameLike ? [this.toResolvedEntity(byNameLike, 'name')] : [];
  }

  protected async listCandidates(
    saveId: ID,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]> {
    const locations = await this.locationRepo.findBySaveId(saveId, {}, trx);
    return locations
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(l => this.toResolvedEntity(l, 'name'));
  }

  private toResolvedEntity(location: LocationData, matchedBy: 'id' | 'name'): ResolvedEntity {
    return {
      entityId: location.id,
      label: location.name,
      entityType: 'location',
      matchedBy,
      timestampMatched: 'none',
      timestamp: location.createdAt,
    };
  }
}
