/**
 * 统一实体引用解析设施类型定义（13.2 规则）。
 *
 * 所有领域 Service.resolveXxxId 应收敛到 IEntityResolver 接口，
 * 消除 6 套分散实现（NPCService/MapService/QuestService/SkillService/EventRepository/EntityGraphRepository）。
 *
 * 支持：
 * - name/id 双兼容：ref 字段同时接受 name 和 id，先 ID 精确匹配，后 name 匹配
 * - 时间戳兼容：传入 timestamp 时优先匹配相同时间戳数据，匹配不到再匹配不同时间戳数据
 */

import type { Knex } from 'knex';
import type { ID } from '../../../../../shared/src/types/core.js';

/**
 * 实体类型枚举（跨领域统一）。
 * 与各领域 EntityType 保持一致，用于 Resolver 路由。
 */
export type EntityType =
  | 'character'
  | 'npc'
  | 'location'
  | 'item'
  | 'quest'
  | 'event'
  | 'skill'
  | 'faction'
  | 'goal';

/**
 * 拥有者类型（13.3 数据归属）。
 */
export type OwnerType = 'character' | 'npc';

/**
 * 实体引用——name 或 id + 可选时间戳。
 */
export interface EntityRef {
  readonly saveId: ID;
  readonly entityType: EntityType;
  /** name 或 id */
  readonly ref: string;
  /** 可选时间戳（created_at 值），用于优先匹配相同时间戳数据 */
  readonly timestamp?: number;
}

/**
 * 解析结果。
 */
export interface ResolvedEntity {
  readonly entityId: string;
  /** 实体显示名称（label），供错误信息构建使用 */
  readonly label: string;
  readonly entityType: EntityType;
  readonly matchedBy: 'id' | 'name';
  readonly timestampMatched: 'same' | 'different' | 'none';
  /** entity 的 created_at 值，用于时间戳比对（由子类从 row 填充） */
  readonly timestamp?: number;
}

/**
 * 实体引用解析器端口接口。
 *
 * 各领域实现 EntityResolverBase 子类，通过此接口统一调用。
 */
export interface IEntityResolver {
  /**
   * 解析单个实体引用。
   * @param ref 实体引用（含 saveId、entityType、ref 字符串、可选 timestamp）
   * @param trx 可选 Knex 事务，透传到子类 findById/findByName/listCandidates
   * @returns ResolvedEntity（失败抛 EntityResolutionError，不再返回 null）
   * @throws EntityResolutionError 当 ID/name 全部未匹配或 name 多匹配无法用 timestamp 消歧时
   */
  resolve(ref: EntityRef, trx?: Knex.Transaction): Promise<ResolvedEntity>;

  /**
   * 批量解析实体引用（并行）。
   * @param refs 实体引用数组
   * @param trx 可选 Knex 事务，透传到子类方法
   * @returns 全部解析成功的实体列表（单个失败即整体抛错，调用方自行 try/catch）
   */
  resolveMany(refs: EntityRef[], trx?: Knex.Transaction): Promise<ResolvedEntity[]>;
}
