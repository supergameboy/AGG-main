import type { Knex } from 'knex';
import type { ID } from '../../../shared/src/types/core.js';
import type { IShadowStateLayer } from '@ai-rpg/shared/tool-core';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('shadow-state');

type RowMap = Map<string, Record<string, unknown>>;

export interface ShadowStateTableConfig {
  table: string;
  scopeField?: string;
}

export class ShadowStateLayer implements IShadowStateLayer {
  private baseSnapshot: Map<string, RowMap> = new Map();
  private pendingInserts: Map<string, RowMap> = new Map();
  private pendingUpdates: Map<string, Map<string, Record<string, unknown>>> = new Map();
  private pendingDeletes: Set<string> = new Set();
  private db: Knex;
  private scopeValues: Record<string, ID | undefined>;
  private snapshotTables: ShadowStateTableConfig[];
  private snapshotLoaded = false;

  constructor(db: Knex, scopeValues: Record<string, ID | undefined>, tables: ShadowStateTableConfig[]) {
    this.db = db;
    this.scopeValues = scopeValues;
    this.snapshotTables = tables;
  }

  async ensureSnapshot(): Promise<void> {
    if (this.snapshotLoaded) return;
    this.snapshotLoaded = true;

    for (const tableConfig of this.snapshotTables) {
      const scopeField = tableConfig.scopeField;
      const scopeValue = scopeField ? this.scopeValues[scopeField] : undefined;

      if (scopeField && !scopeValue) {
        logger.debug('Snapshot table skipped because scope is missing', {
          table: tableConfig.table,
          scopeField,
        });
        continue;
      }

      try {
        const query = this.db(tableConfig.table);
        const rows = scopeField
          ? await query.where({ [scopeField]: scopeValue })
          : await query;
        const rowMap: RowMap = new Map();
        for (const row of rows) {
          const pk = this.extractRowPk(tableConfig.table, row as Record<string, unknown>);
          if (pk) rowMap.set(pk, row as Record<string, unknown>);
        }
        this.baseSnapshot.set(tableConfig.table, rowMap);
      } catch {
        logger.debug('Snapshot table skipped', { table: tableConfig.table });
      }
    }

    logger.debug('Shadow state snapshot loaded', {
      scopeValues: this.scopeValues,
      tables: this.snapshotTables.length,
    });
  }

  apply(table: string, operation: string, data: Record<string, unknown>, where?: Record<string, unknown>): void {
    switch (operation) {
      case 'insert':
      case 'upsert': {
        // upsert 在 ShadowState 语义下等同于 insert：
        // pendingInserts 覆盖 baseSnapshot 同 PK 行（read 方法已处理此逻辑，见 baseRows 遍历时跳过 tableInserts 已有的 pk）
        if (!this.pendingInserts.has(table)) this.pendingInserts.set(table, new Map());
        const pk = this.extractWritePk(table, data, where);
        if (pk) {
          this.pendingInserts.get(table)!.set(pk, data);
          // 修复 DELETE-then-INSERT 同 PK BUG：
          // MapService.updateLocation 等场景先 deleteByLocationId 再 insert，
          // LocationConnectionRepository.insert 使用 generateDeterministicId 生成确定性 ID，
          // 同一对 (from, to) 的 DELETE 与 INSERT 产生相同 PK。
          // 若不在 INSERT 时清除 pendingDeletes 标记，read 遍历 pendingInserts 时
          // 会因 pendingDeletes.has(pk) 为 true 而跳过新 insert 的行，导致数据"丢失"。
          // DELETE-then-INSERT 同 PK 的语义是"用新行替换旧行"，新行不应再被 DELETE 标记影响。
          this.pendingDeletes.delete(`${table}:${pk}`);
        }
        break;
      }
      case 'update': {
        if (!this.pendingUpdates.has(table)) this.pendingUpdates.set(table, new Map());
        // 修复 BUG #2：用 scopeValues + 剥离后的 where 匹配所有行，不再依赖单一 pk 索引
        const matchedPks = this.findMatchingPks(table, where);
        for (const pk of matchedPks) {
          const existing = this.pendingUpdates.get(table)!.get(pk);
          if (existing) {
            this.pendingUpdates.get(table)!.set(pk, { ...existing, ...data });
          } else {
            const baseRow = this.findBaseRow(table, pk) ?? this.findInsertRow(table, pk);
            this.pendingUpdates.get(table)!.set(pk, { ...(baseRow || {}), ...data });
          }
        }
        // 防御性清理（2026-07-21 bug-hunt-20260721-shadow-state-character-skills-missing）：
        // 若本次 update 未匹配任何行（如表未注册到 SHADOW_STATE_TABLES，或 where 条件不命中任何行），
        // 移除空 pendingUpdates Map，避免 read() 误判"有 pending changes"返回 [] 权威空，
        // 让 read() 返回 undefined 触发 DB fallback。
        // 这是 SHADOW_STATE_TABLES 配置缺陷的兜底防护，避免类似 character_skills 缺失的 BUG。
        // 不影响正常路径：匹配到行时 Map 非空，不会被清理。
        // 不影响 getSnapshotSummary：该方法已用 `if (!inserts && !updates && deletes.length === 0) continue;` 跳过空 Map。
        const tableUpdatesMap = this.pendingUpdates.get(table);
        if (tableUpdatesMap && tableUpdatesMap.size === 0) {
          this.pendingUpdates.delete(table);
        }
        break;
      }
      case 'delete': {
        // 修复 BUG #2：用 scopeValues + 剥离后的 where 匹配所有行，按行实际 pk 添加删除标记
        const matchedPks = this.findMatchingPks(table, where);
        for (const pk of matchedPks) {
          this.pendingDeletes.add(`${table}:${pk}`);
        }
        break;
      }
    }
  }

  read(table: string, query: Record<string, unknown>): unknown[] | undefined {
    const tableInserts = this.pendingInserts.get(table);
    const tableUpdates = this.pendingUpdates.get(table);

    // Bug 2 修复：检查当前 table 是否有 pending deletes（per-table，非全局 pendingDeletes.size）。
    // 否则其他 table 的 deletes 会错误触发当前 table 返回 [] 阻止 DB fallback。
    const tableDeletePrefix = `${table}:`;
    let tableHasDeletes = false;
    for (const d of this.pendingDeletes) {
      if (d.startsWith(tableDeletePrefix)) {
        tableHasDeletes = true;
        break;
      }
    }

    if (!tableInserts && !tableUpdates && !tableHasDeletes) {
      return undefined;
    }

    // 修复 BUG #2：read 自动剥离 query 中的 scopeField，避免重复过滤
    const strippedQuery = this.stripScopeField(table, query);

    const baseRows = this.baseSnapshot.get(table);
    const results: Record<string, unknown>[] = [];

    if (baseRows) {
      for (const [pk, row] of baseRows) {
        if (this.pendingDeletes.has(`${table}:${pk}`)) continue;
        // 修复 BUG #1：INSERT 覆盖 baseSnapshot 同 PK 行，跳过被覆盖的旧行
        if (tableInserts?.has(pk)) continue;
        const updated = tableUpdates?.get(pk);
        if (updated) {
          results.push({ ...row, ...updated });
        } else {
          results.push(row);
        }
      }
    }

    if (tableInserts) {
      // 修复：同请求内 write-after-insert 场景（如 create_npc 后立即 move_npc），
      // 必须将 pendingUpdates 合并到 pendingInserts 行，否则读取返回陈旧的 insert 数据。
      for (const [pk, row] of tableInserts) {
        if (this.pendingDeletes.has(`${table}:${pk}`)) continue;
        const updated = tableUpdates?.get(pk);
        if (updated) {
          results.push({ ...row, ...updated });
        } else {
          results.push(row);
        }
      }
    }

    const filtered = this.applyQuery(results, strippedQuery);
    // Bug 2 修复：有 pending changes 时返回 []（而非 undefined）表示"shadow 权威判定结果为空"。
    // undefined 语义 = "无 shadow 数据，允许 DB fallback"；[] 语义 = "shadow 数据权威，禁止 DB fallback"。
    // 否则 StagingKnex.then() 会 fallback 到真实 DB 返回未 flush 的陈旧行（如已 staging delete 的边）。
    return filtered;
  }

  readOne(table: string, query: Record<string, unknown>): Record<string, unknown> | undefined {
    const results = this.read(table, query);
    if (!results || results.length === 0) return undefined;
    return results[0] as Record<string, unknown>;
  }

  getSnapshotSummary(): string {
    const parts: string[] = [];

    for (const { table } of this.snapshotTables) {
      const inserts = this.pendingInserts.get(table);
      const updates = this.pendingUpdates.get(table);
      const deletes = [...this.pendingDeletes].filter(d => d.startsWith(`${table}:`));

      if (!inserts && !updates && deletes.length === 0) continue;

      const parts_table: string[] = [];
      if (inserts) {
        for (const [, row] of inserts) {
          parts_table.push(`  + INSERT: ${JSON.stringify(this.simplifyRow(row))}`);
        }
      }
      if (updates) {
        for (const [, row] of updates) {
          parts_table.push(`  ~ UPDATE: ${JSON.stringify(this.simplifyRow(row))}`);
        }
      }
      for (const d of deletes) {
        parts_table.push(`  - DELETE: ${d.split(':')[1]}`);
      }

      parts.push(`[${table}]\n${parts_table.join('\n')}`);
    }

    return parts.join('\n\n');
  }

  getPendingChanges(): Map<string, Map<string, Record<string, unknown>>> {
    return this.pendingUpdates;
  }

  getSnapshot(): Map<string, Map<string, Record<string, unknown>>> {
    return new Map(this.baseSnapshot);
  }

  reset(): void {
    this.pendingInserts.clear();
    this.pendingUpdates.clear();
    this.pendingDeletes.clear();
  }

  private extractRowPk(table: string, row: Record<string, unknown>): string | null {
    // 修复 BUG #2 #3：有 scopeField 的表用 `${scopeValue}|${id}` 作为 PK
    const scopeValue = this.getScopeValue(table);
    if (scopeValue && row.id) return `${scopeValue}|${row.id}`;
    // 兜底：无 scopeField 或无 scopeValue 时，保持原逻辑
    if (row.id) return String(row.id);
    if (row.save_id) return String(row.save_id);
    return null;
  }

  /**
   * 从 data/where 提取 PK（用于 apply 时索引）。
   * - 有 scopeField 的表：用 scopeValue + (data.id ?? where.id) 组合
   * - 无 scopeField 的表：保持原 extractPrimaryKeyFromContext 逻辑
   */
  private extractWritePk(
    table: string,
    data: Record<string, unknown>,
    where?: Record<string, unknown>,
  ): string | null {
    const scopeValue = this.getScopeValue(table);
    if (scopeValue) {
      const id = data?.id ?? where?.id;
      if (id) return `${scopeValue}|${id}`;
      return null;
    }
    // 无 scopeField 的表：保持原 extractPrimaryKeyFromContext 逻辑
    if (data?.id) return String(data.id);
    if (where?.id) return String(where.id);
    if (where?.save_id) return String(where.save_id);
    if (data?.save_id) return String(data.save_id);
    return null;
  }

  /**
   * 从 scopeValues 获取表的 scope 字段值（save_id 或 template_id）。
   * 权威来源：scopeValues 是请求级元数据，不从 data/where 提取。
   */
  private getScopeValue(table: string): ID | undefined {
    const tableConfig = this.snapshotTables.find(t => t.table === table);
    if (!tableConfig?.scopeField) return undefined;
    return this.scopeValues[tableConfig.scopeField];
  }

  /**
   * 从 where/query 中剥离 scopeField 字段，避免重复过滤。
   * scopeField 已由 scopeValues 权威提供，where 中的同名字段是冗余的。
   */
  private stripScopeField(
    table: string,
    conditions?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!conditions) return undefined;
    const tableConfig = this.snapshotTables.find(t => t.table === table);
    const scopeField = tableConfig?.scopeField;
    if (!scopeField) return conditions;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(conditions)) {
      if (key !== scopeField) result[key] = value;
    }
    return result;
  }

  /**
   * 按 where 条件匹配所有行的 PK 列表（用于 UPDATE/DELETE 批量操作）。
   * 自动用 scopeValue 过滤（不依赖 where 中的 scopeField），返回所有满足 where 条件的行的 PK。
   */
  private findMatchingPks(table: string, where?: Record<string, unknown>): string[] {
    const strippedWhere = this.stripScopeField(table, where);

    const matchWhere = (row: Record<string, unknown>): boolean => {
      if (!strippedWhere || Object.keys(strippedWhere).length === 0) return true;
      for (const [key, value] of Object.entries(strippedWhere)) {
        // IN 语义：数组值表示 WHERE column IN (values)
        if (Array.isArray(value)) {
          if (!value.includes(row[key])) return false;
        } else {
          if (row[key] !== value) return false;
        }
      }
      return true;
    };

    const pks: string[] = [];
    const baseRows = this.baseSnapshot.get(table);
    const insertRows = this.pendingInserts.get(table);

    if (baseRows) {
      for (const [pk, row] of baseRows) {
        if (matchWhere(row)) pks.push(pk);
      }
    }
    if (insertRows) {
      for (const [pk, row] of insertRows) {
        if (matchWhere(row) && !pks.includes(pk)) pks.push(pk);
      }
    }
    return pks;
  }

  private findBaseRow(table: string, pk: string): Record<string, unknown> | undefined {
    const baseRows = this.baseSnapshot.get(table);
    return baseRows?.get(pk);
  }

  /** 查 pendingInserts 中的行（用于 write-after-insert 场景的 baseRow 查找） */
  private findInsertRow(table: string, pk: string): Record<string, unknown> | undefined {
    return this.pendingInserts.get(table)?.get(pk);
  }

  private applyQuery(rows: Record<string, unknown>[], query: Record<string, unknown> | undefined): Record<string, unknown>[] {
    if (!query || Object.keys(query).length === 0) return rows;
    return rows.filter(row => {
      for (const [key, value] of Object.entries(query)) {
        // IN 语义：数组值表示 WHERE column IN (values)
        if (Array.isArray(value)) {
          if (!value.includes(row[key])) return false;
        } else {
          if (row[key] !== value) return false;
        }
      }
      return true;
    });
  }

  private simplifyRow(row: Record<string, unknown>): Record<string, unknown> {
    const simplified: Record<string, unknown> = {};
    const importantKeys = ['id', 'save_id', 'name', 'current_hp', 'max_hp', 'current_mp', 'max_mp',
      'currency', 'current_location_id', 'status', 'location_id', 'npc_id', 'item_id',
      'quantity', 'quality', 'category', 'type', 'discovered', 'visible',
      'giver_npc_id', 'rewards', 'quest_chain_id', 'prerequisite_quest_ids'];

    for (const key of importantKeys) {
      if (row[key] !== undefined) simplified[key] = row[key];
    }

    if (Object.keys(simplified).length === 0) {
      simplified.id = row.id;
      simplified.save_id = row.save_id;
    }

    return simplified;
  }
}
