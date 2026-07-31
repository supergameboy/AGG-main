/**
 * Event 领域实体引用解析器（13.2 规则收敛）。
 *
 * 继承 EntityResolverBase，通过 IEventRepository 端口接口访问数据。
 * 将 EventRepository.resolveEventId 的 3 级匹配逻辑收敛到统一设施：
 * 1. findById：id 精确匹配（eventRepo.findById）
 * 2. findByName：name 精确匹配 → name LIKE %ref% 模糊匹配
 * 3. listCandidates：列出候选事件（按 priority desc，用于 not_found 错误信息）
 *
 * 特殊性：events 表是全局事件模板表，无 save_id 字段（migration 001 确认）。
 * saveId 参数在子类方法中接收但不用于过滤（保持 IEntityResolver 接口一致性）。
 *
 * 时间戳兼容：events 表无 created_at 字段，时间戳兼容不适用。
 * EntityResolverBase.resolve 阶段3 在 ref.timestamp 为 undefined 时跳过消歧，
 * 直接抛 multiple_match_no_timestamp，由调用方决策。
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import { EntityResolverBase } from '../shared/entity-resolver/EntityResolverBase.js';
import type { ResolvedEntity } from '../shared/entity-resolver/types.js';
import type { IEventRepository, GameEvent } from './types.js';

export class EventEntityResolver extends EntityResolverBase {
  constructor(
    private readonly eventRepo: IEventRepository,
    db: Knex,
  ) {
    super(db);
  }

  protected async findById(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null> {
    // saveId 不用于过滤（events 表无 save_id 字段），仅保持接口一致性
    void saveId;
    const byId = await this.eventRepo.findById(ref as ID, undefined, trx);
    return byId ? this.toResolvedEntity(byId, 'id') : null;
  }

  protected async findByName(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    // saveId 不用于过滤（events 表无 save_id 字段）
    void saveId;

    // 1. name 精确匹配（findAll + filter，因 IEventRepository 无 findByName 端口方法）
    const allEvents = await this.eventRepo.findAll(undefined, trx);
    const exactMatch = allEvents.find(e => e.name === ref);
    if (exactMatch) return [this.toResolvedEntity(exactMatch, 'name')];

    // 2. name LIKE %ref% 包含匹配（支持中文名称的部分匹配）
    const containsMatches = allEvents.filter(e => e.name.includes(ref));
    return containsMatches.map(e => this.toResolvedEntity(e, 'name'));
  }

  protected async listCandidates(
    saveId: ID,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]> {
    // saveId 不用于过滤；findAll 按 priority desc 排序（最新创建的在前近似）
    void saveId;
    const events = await this.eventRepo.findAll(undefined, trx);
    return events.slice(0, limit).map(e => this.toResolvedEntity(e, 'name'));
  }

  private toResolvedEntity(event: GameEvent, matchedBy: 'id' | 'name'): ResolvedEntity {
    return {
      entityId: event.id,
      label: event.name,
      entityType: 'event',
      matchedBy,
      timestampMatched: 'none', // events 表无 created_at，时间戳兼容不适用
    };
  }
}
