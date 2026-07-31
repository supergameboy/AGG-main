/**
 * Quest 领域实体引用解析器（13.2 规则收敛）。
 *
 * 继承 EntityResolverBase，通过 IQuestRepository 端口接口访问数据。
 * 将 QuestService.resolveQuestId 的 3 级匹配逻辑收敛到统一设施：
 * 1. findById：id 精确匹配
 * 2. findByName：name 精确匹配 → nameLike 模糊匹配（去掉 quest_ 前缀和 _数字后缀后再 LIKE）
 * 3. listCandidates：列出候选任务（用于 not_found 错误信息）
 *
 * 时间戳兼容由 EntityResolverBase.resolve 阶段3 提供（多结果时用 timestamp 消歧）。
 *
 * 注意：原 QuestService.resolveQuestId 的 byNameLike 使用了名称规范化（去 quest_ 前缀和 _数字后缀），
 * 这里保留同等方式以兼容现有 LLM 输入模式。
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import { EntityResolverBase } from '../shared/entity-resolver/EntityResolverBase.js';
import type { ResolvedEntity } from '../shared/entity-resolver/types.js';
import type { IQuestRepository, Quest } from './types.js';

export class QuestEntityResolver extends EntityResolverBase {
  constructor(
    private readonly questRepo: IQuestRepository,
    db: Knex,
  ) {
    super(db);
  }

  protected async findById(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null> {
    const byId = await this.questRepo.findById(ref as ID, saveId, trx);
    return byId ? this.toResolvedEntity(byId, 'id') : null;
  }

  protected async findByName(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    // 1. name 精确匹配
    const byName = await this.questRepo.findByName(saveId, ref, trx);
    if (byName) return [this.toResolvedEntity(byName, 'name')];

    // 2. nameLike 模糊匹配（去掉 quest_ 前缀和 _数字后缀，处理 LLM 使用过期 ID 的场景）
    const normalizedPattern = `%${ref.replace(/^quest_/, '').replace(/_\d+$/, '')}%`;
    const byNameLike = await this.questRepo.findByNameLike(saveId, normalizedPattern, trx);
    return byNameLike ? [this.toResolvedEntity(byNameLike, 'name')] : [];
  }

  protected async listCandidates(
    saveId: ID,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]> {
    const quests = await this.questRepo.findNamesBySaveId(saveId, limit, trx);
    return quests.map(q => ({
      entityId: q.id,
      label: q.name,
      entityType: 'quest' as const,
      matchedBy: 'name' as const,
      timestampMatched: 'none' as const,
    }));
  }

  private toResolvedEntity(quest: Quest, matchedBy: 'id' | 'name'): ResolvedEntity {
    return {
      entityId: quest.id,
      label: quest.name,
      entityType: 'quest',
      matchedBy,
      timestampMatched: 'none',
      timestamp: quest.createdAt,
    };
  }
}
