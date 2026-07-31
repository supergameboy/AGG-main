/**
 * NPC 领域实体引用解析器（13.2 规则收敛）。
 *
 * 继承 EntityResolverBase，通过 INPCRepository 端口接口访问数据。
 * 将 NPCService.resolveNpcId 的 5 级匹配逻辑收敛到统一设施：
 * 1. findById：id 精确匹配 → templateNpcId 匹配
 * 2. findByName：name 精确匹配 → nameContains 模糊匹配
 * 3. listCandidates：列出候选 NPC（用于 not_found 错误信息）
 *
 * 时间戳兼容由 EntityResolverBase.resolve 阶段3 提供（多结果时用 timestamp 消歧）。
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import { EntityResolverBase } from '../shared/entity-resolver/EntityResolverBase.js';
import type { ResolvedEntity } from '../shared/entity-resolver/types.js';
import type { INPCRepository, NPCProfile } from './types.js';

/**
 * NPC 实体引用解析器
 *
 * 期望效果：
 * - 输入：ref（id 或 name）+ saveId + 可选 timestamp
 * - 输出：ResolvedEntity（含 entityId、label、matchedBy、timestampMatched）
 * - 失败抛 EntityResolutionError（含候选列表）
 *
 * 解析流程（保留原 resolveNpcId 行为）：
 * 1. ID 精确匹配（findById）：npcRepo.findById(ref)
 * 2. templateNpcId 匹配（findById 内）：npcRepo.findByTemplateNpcId(saveId, ref)
 * 3. name 精确匹配（findByName）：npcRepo.findByName(saveId, ref)
 * 4. nameContains 模糊匹配（findByName 内）：npcRepo.findByNameContaining(saveId, ref)
 *    - 单个匹配 → 返回
 *    - 多个匹配 → 由 EntityResolverBase 阶段3 时间戳消歧，仍歧义抛错
 * 5. 全部未命中 → listCandidates 列出候选，抛 not_found
 */
export class NpcEntityResolver extends EntityResolverBase {
  constructor(
    private readonly npcRepo: INPCRepository,
    db: Knex,
  ) {
    super(db);
  }

  /**
   * ID 精确匹配 + templateNpcId 匹配。
   * 命中返回 ResolvedEntity（matchedBy='id'），未命中返回 null（由基类阶段2 接管）。
   */
  protected async findById(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null> {
    // 1. 主键 ID 精确匹配
    const byId = await this.npcRepo.findById(ref as ID, saveId, trx);
    if (byId) return this.toResolvedEntity(byId, 'id');

    // 2. templateNpcId 匹配（NPC 特有：允许通过模板 NPC ID 引用实例化后的 NPC）
    const byTemplateId = await this.npcRepo.findByTemplateNpcId(saveId, ref, trx);
    if (byTemplateId) return this.toResolvedEntity(byTemplateId, 'id');

    return null;
  }

  /**
   * name 匹配 + nameContains 模糊匹配。
   * 返回所有匹配项（matchedBy='name'），由基类阶段2/3 消歧。
   */
  protected async findByName(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    // 3. name 精确匹配
    const byName = await this.npcRepo.findByName(saveId, ref, trx);
    if (byName) return [this.toResolvedEntity(byName, 'name')];

    // 4. nameContains 模糊匹配（支持中文名称的部分匹配）
    const byNameContains = await this.npcRepo.findByNameContaining(saveId, ref, trx);
    return byNameContains.map(n => this.toResolvedEntity(n, 'name'));
  }

  /**
   * 列出候选 NPC（用于 not_found 错误信息构建）。
   * 按 createdAt DESC 排序，最多 limit 个。
   */
  protected async listCandidates(
    saveId: ID,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]> {
    const npcs = await this.npcRepo.findBySaveId(saveId, { visibility: 'all' }, trx);
    return npcs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(n => this.toResolvedEntity(n, 'name'));
  }

  /**
   * NPCProfile → ResolvedEntity 转换。
   * timestamp 取自 createdAt（由子类填充，供基类阶段3 时间戳比对）。
   */
  private toResolvedEntity(npc: NPCProfile, matchedBy: 'id' | 'name'): ResolvedEntity {
    return {
      entityId: npc.id,
      label: npc.name,
      entityType: 'npc',
      matchedBy,
      timestampMatched: 'none', // 由 EntityResolverBase.resolve 在阶段2/3 覆写
      timestamp: npc.createdAt,
    };
  }
}
