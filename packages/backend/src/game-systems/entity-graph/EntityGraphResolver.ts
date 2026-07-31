/**
 * EntityGraph 节点引用解析器（13.2 / 13.3 / 14.3 规则）。
 *
 * 继承 EntityResolverBase，通过端口接口 IEntityGraphRepository / ICharacterReadPort 访问数据（§7.1）。
 *
 * 设计要点：
 * - 一个 Resolver 实例只解析一种 entityType（构造函数接收 resolverEntityType）
 * - characterReadPort 仅 entityType='character' 时被 resolve 方法使用（player 别名快捷解析）
 *   构造函数对所有类型都接收 characterReadPort，运行时仅在 character + 'player' 时触发
 * - 覆写 resolve 增加 player 别名快捷解析：character 类型且 ref='player' 时
 *   通过 ICharacterReadPort.findIdBySaveId 获取玩家角色 ID + IEntityGraphRepository.getNode 验证节点
 *   命中则返回 ResolvedEntity（matchedBy='id'）；未命中继续走 super.resolve 触发 not_found 含候选列表
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import { EntityResolverBase } from '../shared/entity-resolver/EntityResolverBase.js';
import type { EntityRef, IEntityResolver, ResolvedEntity } from '../shared/entity-resolver/types.js';
import type { EntityType } from '../shared/entity-resolver/types.js';
import type { IEntityGraphRepository, ICharacterReadPort, EntityNode } from './types.js';

/** player 别名（大小写不敏感），用于 character 类型快捷解析 */
const PLAYER_ALIAS_LOWER = 'player';

export class EntityGraphResolver extends EntityResolverBase implements IEntityResolver {
  constructor(
    private readonly graphRepository: IEntityGraphRepository,
    private readonly resolverEntityType: EntityType,
    db: Knex,
    private readonly characterReadPort: ICharacterReadPort | null = null,
  ) {
    super(db);
  }

  async resolve(ref: EntityRef, trx?: Knex.Transaction): Promise<ResolvedEntity> {
    // player 别名快捷解析：仅 character 类型 + ref='player'（大小写不敏感） + 注入了 characterReadPort
    if (
      this.resolverEntityType === 'character' &&
      this.characterReadPort &&
      ref.ref.toLowerCase() === PLAYER_ALIAS_LOWER
    ) {
      const playerId = await this.characterReadPort.findIdBySaveId(ref.saveId);
      if (playerId) {
        const node = await this.graphRepository.getNode(ref.saveId, 'character', playerId, trx);
        if (node) {
          return this.nodeToResolvedEntity(node, 'id');
        }
      }
      // player 别名未命中（DB 无玩家角色，或 graph 层无节点）→ 继续走 super.resolve 触发 not_found 含候选列表
    }
    return super.resolve(ref, trx);
  }

  /**
   * ID 精确匹配：调用 graphRepository.getNode(saveId, type, entityId)。
   * 命中返回 ResolvedEntity（matchedBy='id'），未命中返回 null（由基类阶段2 接管）。
   */
  protected async findById(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null> {
    const node = await this.graphRepository.getNode(saveId, this.resolverEntityType, ref, trx);
    return node ? this.nodeToResolvedEntity(node, 'id') : null;
  }

  /**
   * name 匹配：调用新增的 findNodesByLabel（仅 label 匹配，避免 findNodeByEntityIdOrLabel 重复 entity_id 查询）。
   * 返回所有 label 匹配的节点（matchedBy='name'），由基类阶段2/3 消歧。
   */
  protected async findByName(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    const nodes = await this.graphRepository.findNodesByLabel(saveId, this.resolverEntityType, ref, trx);
    return nodes.map(n => this.nodeToResolvedEntity(n, 'name'));
  }

  /**
   * 列出候选节点：调用 graphRepository.getNodesByType(saveId, type, trx, limit)。
   * 候选按 created_at DESC 排序（最新创建的在前），最多 limit 个。
   * 用于 not_found 错误信息构建（§14.3）。
   */
  protected async listCandidates(
    saveId: ID,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]> {
    const nodes = await this.graphRepository.getNodesByType(saveId, this.resolverEntityType, trx, limit);
    return nodes.map(n => this.nodeToResolvedEntity(n, 'name'));
  }

  /**
   * EntityNode → ResolvedEntity 映射。
   * timestampMatched 默认 'none'，由 EntityResolverBase.resolve 在阶段2/3 根据比对结果覆写。
   */
  private nodeToResolvedEntity(node: EntityNode, matchedBy: 'id' | 'name'): ResolvedEntity {
    return {
      entityId: node.entityId,
      label: node.label,
      entityType: node.entityType,
      matchedBy,
      timestampMatched: 'none',
      timestamp: node.createdAt,
    };
  }
}
