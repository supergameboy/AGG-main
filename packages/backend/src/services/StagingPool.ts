import type { Knex } from 'knex';
import type { IWriteQueue } from '@ai-rpg/shared/tool-core';
import type { ShadowStateLayer } from './ShadowStateLayer.js';
import type { EntityGraphUpdater } from '../game-systems/entity-graph/EntityGraphUpdater.js';
import type { IStagingPool, IDevTraceHook } from '@ai-rpg/shared/tool-core';
import type { StagedWrite, OnConflictConfig, StagingKnexContext } from '@ai-rpg/shared/types/tool';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
// EG-M2-6: createStagingKnex 工厂函数（共享层），用于创建审计专用代理 db
import { createStagingKnex } from '@ai-rpg/shared/tool-core';

// re-export 类型，保持现有导入路径稳定（StagedWrite/OnConflictConfig 从本文件导入）
export type { StagedWrite, OnConflictConfig };

const logger = createChildLogger('staging-pool');

const INCREMENT_PATTERN = /^__INCREMENT__:(.+):(-?\d+)$/;

let writeIdCounter = 0;

export class StagingPool implements IStagingPool {
  private writes: StagedWrite[] = [];
  private shadowState: ShadowStateLayer | null = null;
  private graphUpdater: EntityGraphUpdater | null = null;
  private _saveId: string = '';
  private _requestId?: string;
  // v2 模块G #8: 部分刷新脏标记，由 finally 块检查并触发重载
  private dirtyAfterPartialFlush = false;
  // v2 模块G #8: 保存失败的写入列表，供 getFailedWrites() 查询
  private failedWritesList: StagedWrite[] = [];
  // EG-M2-6: 原始 Knex 实例（由 init.ts 组合根通过 bindOriginalDb 注入）
  // createProxyDb 需要 originalDb 来创建 StagingKnex 代理（StagingPool 不持有原始 db，避免 E→A 反向依赖）
  private originalDb: Knex | null = null;

  /**
   * P1-2: 构造函数注入 IDevTraceHook（替代原 IWebSocketBroadcaster）。
   * 用于 dev:staging_write / dev:staging_commit 事件的统一 Hook 入口。
   * AP-L1 修复: 业务代码不再直接依赖消息层 IWebSocketBroadcaster，改依赖 dev trace Hook。
   */
  constructor(private readonly devTraceHook: IDevTraceHook) {}

  bindShadowState(shadowState: ShadowStateLayer): void {
    this.shadowState = shadowState;
  }

  bindGraphUpdater(updater: EntityGraphUpdater, saveId: string, requestId?: string): void {
    this.graphUpdater = updater;
    this._saveId = saveId;
    this._requestId = requestId;
  }

  /**
   * EG-M2-6: 绑定原始 Knex 实例（在 init.ts 组合根中调用）。
   *
   * StagingPool 不持有原始 db 引用（避免 E→A 反向依赖），
   * 但 createProxyDb 需要原始 db 来创建 StagingKnex 代理。
   * 通过显式 bind 方法注入，保持依赖方向清晰。
   */
  bindOriginalDb(db: Knex): void {
    this.originalDb = db;
  }

  /**
   * EG-M2-6: 创建 StagingKnex 代理 db（用于审计读取 ShadowState）。
   *
   * 代理 db 拦截写操作转发到 stagingPool.stage()，
   * 读操作先查 ShadowState（待提交状态），未命中再查原始 DB。
   *
   * 调用方（agent-deps.ts createAuditGraphProviderFactory）负责基于代理 db
   * 创建 Repository + Service 实例。
   *
   * @returns Knex 兼容的代理实例
   * @throws 当 originalDb 或 shadowState 未绑定时抛错（不返回 fallback）
   */
  createProxyDb(): Knex {
    if (!this.originalDb) {
      throw new Error('StagingPool.createProxyDb: originalDb not bound. Call bindOriginalDb() first.');
    }
    if (!this.shadowState) {
      throw new Error('StagingPool.createProxyDb: shadowState not bound. Call bindShadowState() first.');
    }
    const ctx: StagingKnexContext = {
      stagingPool: this,
      shadowState: this.shadowState,
      toolType: 'audit',
      method: 'auditStagedWrites',
      source: 'gamemaster',
    };
    return createStagingKnex(this.originalDb, ctx);
  }

  async stage(write: Omit<StagedWrite, 'id' | 'timestamp'>): Promise<void> {
    const staged: StagedWrite = {
      ...write,
      id: `sw_${++writeIdCounter}_${Date.now()}`,
      timestamp: Date.now(),
    };
    this.writes.push(staged);

    // 批量 update 预查询：在 ShadowState.apply 之前查询受影响实体 id 列表。
    // ShadowState 此时尚未 apply，查询到的是原值（如 clearParentForChildren 的 parent_location_id 仍为原值）。
    // 若在 apply 之后查询，where 条件字段已被 update 改变，查询返回空。
    let affectedIds: string[] | undefined;
    if (
      staged.operation === 'update' &&
      staged.where &&
      !staged.where.id &&
      staged.where.save_id &&
      this.shadowState
    ) {
      try {
        const proxyDb = this.createProxyDb();
        const rows = await proxyDb(staged.table).where(staged.where).select('id');
        affectedIds = rows
          .map((r: Record<string, unknown>) => r.id as string)
          .filter((id: string | undefined): id is string => Boolean(id));
        logger.debug('Pre-queried affectedIds for batch update', {
          table: staged.table,
          where: staged.where,
          count: affectedIds.length,
        });
      } catch (err) {
        logger.warn('Failed to pre-query affectedIds for batch update', {
          table: staged.table,
          where: staged.where,
          error: getErrorMessage(err),
        });
        affectedIds = [];
      }
    }

    this.shadowState?.apply(staged.table, staged.operation, staged.data, staged.where);
    logger.debug('Staged write', {
      table: staged.table,
      operation: staged.operation,
      toolType: staged.toolType,
      method: staged.method,
      source: staged.source,
      onConflict: staged.onConflict?.action,
    });

    if (this._saveId) {
      this.devTraceHook.emit({
        type: 'staging_write',
        saveId: this._saveId,
        data: { source: staged.source, toolType: staged.toolType, method: staged.method, operation: staged.operation, tableName: staged.table, data: staged.data },
        timestamp: staged.timestamp,
        requestId: this._requestId,
      });
    }

    if (this.graphUpdater && this._saveId) {
      const graphWrites = await this.graphUpdater.deriveGraphWrites(this._saveId, staged, this._requestId, affectedIds);
      for (const gw of graphWrites) {
        const graphStaged: StagedWrite = {
          ...gw,
          id: `sw_${++writeIdCounter}_${Date.now()}`,
          timestamp: Date.now(),
        };
        this.writes.push(graphStaged);
        this.shadowState?.apply(graphStaged.table, graphStaged.operation, graphStaged.data, graphStaged.where);
      }
    }
  }

  hasWrites(): boolean {
    return this.writes.length > 0;
  }

  getAllWrites(): StagedWrite[] {
    return [...this.writes];
  }

  replaceWrites(nextWrites: StagedWrite[]): void {
    this.writes = nextWrites.map((write) => ({
      ...write,
      data: { ...write.data },
      where: write.where ? { ...write.where } : undefined,
      onConflict: write.onConflict ? { ...write.onConflict, columns: [...write.onConflict.columns] } : undefined,
      capturedBindings: Array.isArray(write.capturedBindings) ? [...write.capturedBindings] : write.capturedBindings,
    }));

    this.shadowState?.reset();
    for (const write of this.writes) {
      this.shadowState?.apply(write.table, write.operation, write.data, write.where);
    }
  }

  adoptFrom(other: StagingPool): void {
    this.replaceWrites(other.getAllWrites());
  }

  getWritesBySource(source: 'gamemaster' | 'subagent'): StagedWrite[] {
    return this.writes.filter(w => w.source === source);
  }

  getWritesByTable(table: string): StagedWrite[] {
    return this.writes.filter(w => w.table === table);
  }

  getWorldStateSummary(): Record<string, { inserts: number; updates: number; deletes: number; upserts: number }> {
    const summary: Record<string, { inserts: number; updates: number; deletes: number; upserts: number }> = {};
    for (const w of this.writes) {
      if (!summary[w.table]) {
        summary[w.table] = { inserts: 0, updates: 0, deletes: 0, upserts: 0 };
      }
      switch (w.operation) {
        case 'insert': summary[w.table].inserts++; break;
        case 'update': summary[w.table].updates++; break;
        case 'delete': summary[w.table].deletes++; break;
        case 'upsert': summary[w.table].upserts++; break;
      }
    }
    return summary;
  }

  getDetailedWriteLog(): string {
    const lines: string[] = [];
    for (const w of this.writes) {
      const sourceTag = w.source === 'subagent' ? `[子Agent:${w.subAgentType}]` : '[主Agent]';
      const derivedTag = w.derivedFrom ? `[图更新<-${w.derivedFrom}]` : '';
      const conflictTag = w.onConflict ? ` ON CONFLICT ${w.onConflict.action.toUpperCase()}` : '';
      switch (w.operation) {
        case 'insert':
          lines.push(`${sourceTag}${derivedTag} INSERT INTO ${w.table}${conflictTag}: ${JSON.stringify(w.data)}`);
          break;
        case 'update': {
          const isIncrement = this.detectIncrementFields(w.data);
          if (isIncrement) {
            lines.push(`${sourceTag}${derivedTag} INCREMENT ${w.table} WHERE ${JSON.stringify(w.where || {})}: ${JSON.stringify(w.data)}`);
          } else {
            lines.push(`${sourceTag}${derivedTag} UPDATE ${w.table} WHERE ${JSON.stringify(w.where || {})} SET ${JSON.stringify(w.data)}`);
          }
          break;
        }
        case 'delete':
          lines.push(`${sourceTag}${derivedTag} DELETE FROM ${w.table} WHERE ${JSON.stringify(w.where || {})}`);
          break;
        case 'upsert':
          lines.push(`${sourceTag}${derivedTag} UPSERT INTO ${w.table}${conflictTag}: ${JSON.stringify(w.data)}`);
          break;
      }
    }
    return lines.join('\n');
  }

  async flush(writeQueue: IWriteQueue): Promise<void> {
    if (this.writes.length === 0) return;

    const totalCount = this.writes.length;
    logger.info('Flushing staged writes to DB', { count: totalCount });

    const db = writeQueue.getDb();
    const failedWrites: StagedWrite[] = [];

    try {
      await writeQueue.enqueueFn(async () => {
        await db.transaction(async (trx) => {
          for (const op of this.writes) {
            try {
              await this.executeWriteOp(trx, op);
            } catch (writeError) {
              failedWrites.push(op);
              logger.error('Staged write FAILED in transaction - rolling back', {
                table: op.table, operation: op.operation,
                error: getErrorMessage(writeError),
                data: JSON.stringify(op.data).substring(0, 200),
              });
              throw writeError;
            }
          }
        });
      }, 'staging.flush.batch');
    } catch {
      // 事务回滚，所有写入未生效，无脏状态
      logger.error('StagingPool flush transaction rolled back', {
        total: totalCount, failed: failedWrites.length,
      });
      this.broadcastFlushResult(totalCount, 0, failedWrites.length);
      this.dirtyAfterPartialFlush = true;
      this.failedWritesList = failedWrites;
      this.clear();
      const failedDetails = failedWrites.map(w =>
        `${w.table}.${w.operation}: ${JSON.stringify(w.data).substring(0, 100)}`
      ).join('; ');
      throw new Error(
        `StagingPool flush transaction failed: ${failedWrites.length}/${totalCount} writes failed. ` +
        `Transaction rolled back - no partial state. ` +
        `Failed: ${failedDetails}.`
      );
    }

    // 全部成功
    logger.info('Staged writes flush completed', {
      total: totalCount, succeeded: totalCount, failed: 0,
    });
    this.broadcastFlushResult(totalCount, totalCount, 0);
    this.clear();
  }

  /**
   * 广播 flush 结果到 dev trace + WebSocket（成功/失败共用）。
   */
  private broadcastFlushResult(total: number, succeeded: number, failed: number): void {
    if (!this._saveId) return;

    this.devTraceHook.emit({
      type: 'staging_commit',
      saveId: this._saveId,
      data: { total, succeeded, failed },
      requestId: this._requestId,
    });
  }

  /** v2 模块G #8: 是否存在部分刷新脏标记 */
  isDirtyAfterFlush(): boolean {
    return this.dirtyAfterPartialFlush;
  }

  /** v2 模块G #8: 清除脏标记（重载完成后调用） */
  clearDirtyAfterFlush(): void {
    this.dirtyAfterPartialFlush = false;
    this.failedWritesList = [];
  }

  /** v2 模块G #8: 获取失败的写入列表 */
  getFailedWrites(): StagedWrite[] {
    return this.failedWritesList;
  }

  clear(): void {
    this.writes = [];
    this.shadowState?.reset();
  }

  get writeCount(): number {
    return this.writes.length;
  }

  /**
   * Remove writes staged from the given index onwards (used by StagingKnex transaction rollback).
   *
   * 2026-07-25 修复 B6: 回滚后必须重建 shadowState 以保持与 writes 数组一致。
   * 旧实现仅 splice writes 但不回滚 shadowState，导致 shadowState 残留已回滚写入的副作用，
   * 后续 read() 返回幽灵数据（已被回滚的 insert/update/delete 仍反映在 shadowState 中）。
   * 修复方式与 replaceWrites 一致：reset shadowState + 重新 apply 剩余 writes。
   */
  rollbackFrom(writeIndex: number): number {
    const removed = this.writes.length - writeIndex;
    if (removed > 0) {
      this.writes.splice(writeIndex);
      this.shadowState?.reset();
      for (const write of this.writes) {
        this.shadowState?.apply(write.table, write.operation, write.data, write.where);
      }
      logger.debug('Rolled back staged writes', { writesRemoved: removed });
    }
    return removed;
  }

  private async executeWriteOp(db: Knex | Knex.Transaction, op: StagedWrite): Promise<unknown> {
    // capturedSql 不包含 ON CONFLICT 子句，有 onConflict 配置时必须走 onConflict 路径
    if (op.capturedSql && !op.onConflict) {
      return (db as any).raw(op.capturedSql, op.capturedBindings || []);
    }
    switch (op.operation) {
      case 'insert': {
        const isEntityGraphTable = op.table.startsWith('entity_graph_');
        const insertData = isEntityGraphTable
          ? { ...op.data, created_at: op.data.created_at ?? Date.now(), updated_at: Date.now() }
          : op.data;
        const insertQuery = (db as any)(op.table).insert(insertData);
        if (op.onConflict) {
          const conflictQuery = insertQuery.onConflict(op.onConflict.columns);
          if (op.onConflict.action === 'merge') {
            return conflictQuery.merge();
          }
          return conflictQuery.ignore();
        }
        return insertQuery;
      }
      case 'update': {
        const incrementFields = this.extractIncrementFields(op.data);
        if (incrementFields.length > 0) {
          let query = (db as any)(op.table).where(op.where || {});
          for (const { column, amount } of incrementFields) {
            query = query.increment(column, amount);
          }
          const nonIncrementData = this.filterIncrementFields(op.data);
          if (Object.keys(nonIncrementData).length > 0) {
            return query.update(nonIncrementData);
          }
          return query;
        }
        return (db as any)(op.table).where(op.where || {}).update(op.data);
      }
      case 'delete':
        return (db as any)(op.table).where(op.where || {}).delete();
      case 'upsert': {
        const conflictColumns = op.table === 'entity_graph_edges'
          ? ['save_id', 'from_node_id', 'relation', 'to_node_id']
          : ['save_id', 'entity_type', 'entity_id'];
        const now = Date.now();
        const dataWithTimestamps = {
          ...op.data,
          created_at: op.data.created_at ?? now,
          updated_at: now,
        };
        return (db as any)(op.table)
          .insert(dataWithTimestamps)
          .onConflict(conflictColumns)
          .merge(['updated_at', ...Object.keys(op.data).filter(k => k !== 'created_at')]);
      }
      default:
        return Promise.resolve();
    }
  }

  private detectIncrementFields(data: Record<string, unknown>): boolean {
    return Object.values(data).some(v =>
      typeof v === 'string' && INCREMENT_PATTERN.test(v),
    );
  }

  private extractIncrementFields(data: Record<string, unknown>): Array<{ column: string; amount: number }> {
    const results: Array<{ column: string; amount: number }> = [];
    for (const [, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        const match = value.match(INCREMENT_PATTERN);
        if (match) {
          results.push({ column: match[1], amount: parseInt(match[2], 10) });
        }
      }
    }
    return results;
  }

  private filterIncrementFields(data: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string' || !INCREMENT_PATTERN.test(value)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
}
