/**
 * 统一实体引用解析便捷函数（code-design §10.4，13.2 规则）。
 *
 * 期望效果：
 * - 输入：ref + saveId + entityType + 可选 timestamp + 可选 resolvers Map
 * - 输出：解析后的 ID（找不到时抛 EntityResolutionError）
 * - 副作用：无（纯查询）
 * - 时间戳兼容：传入 timestamp 时优先匹配相同时间戳数据
 *
 * 设计偏差（小偏差，Plan-20260724-阶段二 §L3.5 已记录）:
 * - 设计 §10.4 期望基于 EntityResolverBase 子类路由
 * - 阶段二先实现最小可用版本：基于注入的 resolvers Map 路由到对应领域 Resolver 实例
 * - 阶段四统一收敛到 EntityResolverBase 子类（每个领域实现 findById/findByName/listCandidates）
 *
 * 使用方式（策略实现类）:
 * ```typescript
 * const skillId = await resolveEntityRef(action.skillId, saveId, 'skill', {
 *   resolvers: this.resolvers,  // CombatStrategyBase 持有的 resolvers Map
 * });
 * ```
 */

import type { ID } from '../../../../../shared/src/types/core.js';
import type { EntityType, IEntityResolver, EntityRef } from './types.js';
import { EntityResolutionError } from './EntityResolutionError.js';

/**
 * 解析单个实体引用为实体 ID。
 *
 * 期望效果：
 * - 输入 ref 可以是 ID 或 name
 * - 通过 resolvers Map 路由到对应领域的 IEntityResolver 实例
 * - 找不到时抛 EntityResolutionError（含候选列表，引导 Agent 修正）
 * - 若 resolvers Map 未注册该 entityType，抛错暴露配置缺失（禁止静默 fallback）
 *
 * @param ref 实体引用（ID 或 name）
 * @param saveId 存档 ID
 * @param entityType 实体类型
 * @param options 可选参数：timestamp（时间戳消歧）、resolvers（领域 Resolver Map）
 * @returns 解析后的实体 ID
 * @throws EntityResolutionError 当 ref 无法解析或领域 Resolver 未注册时
 */
export async function resolveEntityRef(
  ref: ID | string,
  saveId: ID,
  entityType: EntityType,
  options?: {
    timestamp?: number;
    resolvers?: Map<EntityType, IEntityResolver>;
  },
): Promise<ID> {
  const refStr = String(ref);
  if (!refStr) {
    throw new EntityResolutionError({
      entityType,
      ref: refStr,
      saveId: String(saveId),
      candidates: [],
      reason: 'not_found',
    });
  }

  const resolvers = options?.resolvers;
  if (!resolvers) {
    // 配置缺失：resolvers Map 未传入，暴露问题禁止静默 fallback
    throw new Error(
      `resolveEntityRef 配置缺失: entityType=${entityType} 的 resolvers Map 未传入（saveId=${saveId}）`,
    );
  }

  const resolver = resolvers.get(entityType);
  if (!resolver) {
    // 领域 Resolver 未注册：暴露配置缺失
    throw new Error(
      `resolveEntityRef 领域 Resolver 未注册: entityType=${entityType} 未在 resolvers Map 中注册（saveId=${saveId}）`,
    );
  }

  const entityRef: EntityRef = {
    saveId,
    entityType,
    ref: refStr,
    timestamp: options?.timestamp,
  };

  const resolved = await resolver.resolve(entityRef);
  return resolved.entityId as ID;
}

/**
 * 批量解析实体引用（并行）。
 *
 * 期望效果：
 * - 输入：ref 数组 + saveId + entityType + 可选 resolvers Map
 * - 输出：解析后的 ID 数组（顺序与输入一致）
 * - 单个失败即整体抛错（调用方自行 try/catch）
 *
 * @param refs 实体引用数组（ID 或 name）
 * @param saveId 存档 ID
 * @param entityType 实体类型
 * @param options 可选参数：resolvers（领域 Resolver Map）
 * @returns 解析后的实体 ID 数组
 * @throws EntityResolutionError 任一 ref 无法解析时
 */
export async function resolveEntityRefs(
  refs: Array<ID | string>,
  saveId: ID,
  entityType: EntityType,
  options?: {
    resolvers?: Map<EntityType, IEntityResolver>;
  },
): Promise<ID[]> {
  return Promise.all(
    refs.map(ref => resolveEntityRef(ref, saveId, entityType, options)),
  );
}
