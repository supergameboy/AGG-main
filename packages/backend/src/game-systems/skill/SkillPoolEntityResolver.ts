/**
 * SkillPool 领域实体引用解析器（13.2 规则收敛）。
 *
 * 继承 EntityResolverBase，通过 ISkillPoolRepository 端口接口访问数据。
 * 将 SkillService.resolvePoolSkillId 的 ID/name 兼容逻辑收敛到统一设施：
 * 1. findById：id 精确匹配（skillPoolRepo.findById）
 * 2. findByName：name 精确匹配（skillPoolRepo.findByName）— skill_pool 表 name 在同 saveId 下唯一，无需模糊匹配
 * 3. listCandidates：列出候选技能池条目（用于 not_found 错误信息）
 *
 * 时间戳兼容由 EntityResolverBase.resolve 阶段3 提供（多结果时用 timestamp 消歧）。
 * 注意：skill_pool 表 ID 由 generateDeterministicId('skill', saveId, name) 生成，
 * 同 saveId + 同 name 永远生成相同 ID，因此 name 多匹配场景极少（仅当 LLM 传入部分名称时）。
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import type { SkillPoolEntry } from '../../../../shared/src/types/game.js';
import { EntityResolverBase } from '../shared/entity-resolver/EntityResolverBase.js';
import type { ResolvedEntity } from '../shared/entity-resolver/types.js';
import type { ISkillPoolRepository } from './types.js';

export class SkillPoolEntityResolver extends EntityResolverBase {
  constructor(
    private readonly skillPoolRepo: ISkillPoolRepository,
    db: Knex,
  ) {
    super(db);
  }

  protected async findById(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null> {
    const byId = await this.skillPoolRepo.findById(saveId, ref, trx);
    return byId ? this.toResolvedEntity(byId, 'id') : null;
  }

  protected async findByName(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    // skill_pool 表 name 在同 saveId 下唯一（业务约束），返回单个或空
    const byName = await this.skillPoolRepo.findByName(saveId, ref, trx);
    return byName ? [this.toResolvedEntity(byName, 'name')] : [];
  }

  protected async listCandidates(
    saveId: ID,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]> {
    // findBySaveId 按 created_at asc 排序，这里反转为 DESC（最新创建的在前）
    const entries = await this.skillPoolRepo.findBySaveId(saveId, undefined, trx);
    return entries
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, limit)
      .map(e => this.toResolvedEntity(e, 'name'));
  }

  private toResolvedEntity(entry: SkillPoolEntry, matchedBy: 'id' | 'name'): ResolvedEntity {
    return {
      entityId: entry.id,
      label: entry.name,
      entityType: 'skill',
      matchedBy,
      timestampMatched: 'none', // 由 EntityResolverBase.resolve 在阶段2/3 覆写
      timestamp: entry.createdAt,
    };
  }
}
