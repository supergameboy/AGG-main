/**
 * 实体引用解析器抽象基类（13.2 规则）。
 *
 * 实现 name/id 双兼容 + 时间戳兼容的通用逻辑。
 * 各领域子类只需实现 findById / findByName / listCandidates 三个抽象方法，
 * 从数据库 row 中提取 entityId 和 timestamp 填充到 ResolvedEntity。
 *
 * 解析流程：
 * 1. ID 精确匹配（findById）→ 命中即返回
 * 2. name 匹配（findByName）→ 可能多个结果
 * 3. 多结果时用 timestamp 消歧：
 *    - 优先匹配相同时间戳（timestamp === ref.timestamp）
 *    - 匹配不到再匹配不同时间戳
 *    - 仍无法消歧（多个 same 或多个 different）抛 EntityResolutionError
 *
 * 失败不再返回 null，统一抛 EntityResolutionError 含候选列表（§13.3 合规）。
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../../shared/src/types/core.js';
import type { EntityRef, IEntityResolver, ResolvedEntity } from './types.js';
import { EntityResolutionError } from './EntityResolutionError.js';

export abstract class EntityResolverBase implements IEntityResolver {
  constructor(protected readonly db: Knex) {}

  /**
   * ID 精确匹配（子类实现）。
   * 从数据库按 id 字段查询，命中则返回 ResolvedEntity（matchedBy='id'）。
   */
  protected abstract findById(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null>;

  /**
   * name 匹配（子类实现）。
   * 从数据库按 name 字段查询，返回所有匹配项（matchedBy='name'）。
   * 子类应从 row 中提取 timestamp（created_at）填充到 ResolvedEntity。
   */
  protected abstract findByName(saveId: ID, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]>;

  /**
   * 列出候选节点（子类实现，用于 not_found 错误信息构建）。
   * 参数顺序对齐 getNodesByType(saveId, type, trx?, limit?) 去掉 type（子类已知 resolverEntityType）。
   * 返回的候选按 created_at DESC 排序（最新创建的在前），最多 limit 个。
   */
  protected abstract listCandidates(
    saveId: ID,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]>;

  async resolve(ref: EntityRef, trx?: Knex.Transaction): Promise<ResolvedEntity> {
    // 阶段1: ID 精确匹配
    const byId = await this.findById(ref.saveId, ref.ref, trx);
    if (byId) {
      // ID 匹配命中，timestampMatched 由子类填充（或基于 ref.timestamp 比对）
      return byId;
    }

    // 阶段2: name 匹配（可能多个）
    const byName = await this.findByName(ref.saveId, ref.ref, trx);
    if (byName.length === 0) {
      // not_found: 抛错含候选列表（不再 return null）
      const candidates = await this.listCandidates(ref.saveId, trx, 10);
      throw this.buildNotFoundError(ref, candidates);
    }
    if (byName.length === 1) {
      // 单个 name 匹配，无需消歧。timestampMatched 标注是否与 ref.timestamp 相同
      const matched = ref.timestamp
        ? (byName[0].timestamp === ref.timestamp ? 'same' : 'different')
        : 'none';
      return { ...byName[0], timestampMatched: matched };
    }

    // 阶段3: 时间戳兼容——多结果时用 timestamp 消歧
    if (ref.timestamp) {
      const same = byName.filter(e => e.timestamp === ref.timestamp);
      if (same.length === 1) return { ...same[0], timestampMatched: 'same' };
      if (same.length > 1) {
        // 同 timestamp 仍多匹配，无法消歧
        throw this.buildAmbiguousError(ref, same);
      }

      // 相同时间戳匹配不到，回退到不同时间戳
      const different = byName.filter(e => e.timestamp !== ref.timestamp);
      if (different.length === 1) return { ...different[0], timestampMatched: 'different' };
      if (different.length > 1) {
        // 不同 timestamp 仍多匹配，无法消歧
        throw this.buildAmbiguousError(ref, different);
      }
      // 不可达路径：same=0 + different=0 不可能（因 byName.length > 1 已被拦截）
      // 显式抛错避免不可达 return null（设计要点 §17）
      throw new Error('unreachable: timestamp filter produced empty results');
    }

    // 无 timestamp 且 name 多匹配，无法消歧
    throw this.buildAmbiguousError(ref, byName);
  }

  async resolveMany(refs: EntityRef[], trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    // resolve 不再返回 null，filter 死代码已移除（单个失败即整体抛错，调用方自行 try/catch）
    return Promise.all(refs.map(r => this.resolve(r, trx)));
  }

  /**
   * 构建 not_found 错误（reason='not_found'）。
   * candidates 为候选节点列表（最多 10 个，按 created_at DESC 排序）。
   */
  protected buildNotFoundError(
    ref: EntityRef,
    candidates: ResolvedEntity[],
  ): EntityResolutionError {
    return new EntityResolutionError({
      entityType: ref.entityType,
      ref: ref.ref,
      saveId: ref.saveId,
      candidates,
      reason: 'not_found',
    });
  }

  /**
   * 构建多匹配歧义错误。
   * reason 根据 ref.timestamp 是否传入区分：
   * - ref.timestamp === undefined → 'multiple_match_no_timestamp'
   * - ref.timestamp 已传入但仍有歧义 → 'multiple_match_ambiguous'
   */
  protected buildAmbiguousError(
    ref: EntityRef,
    candidates: ResolvedEntity[],
  ): EntityResolutionError {
    return new EntityResolutionError({
      entityType: ref.entityType,
      ref: ref.ref,
      saveId: ref.saveId,
      candidates,
      reason: ref.timestamp === undefined ? 'multiple_match_no_timestamp' : 'multiple_match_ambiguous',
    });
  }
}
