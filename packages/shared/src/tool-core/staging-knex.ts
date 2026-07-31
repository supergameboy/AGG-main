/**
 * StagingKnex — 暂存查询构建器（从 backend/services/StagingKnex.ts 迁移）
 *
 * v1.3 改动：
 * - StagingPool → IStagingPool（端口接口）
 * - ShadowStateLayer → IShadowStateLayer（端口接口）
 * - createChildLogger → getChildLogger（shared/utils/logger 的端口接口）
 * - StagingKnexContext 从 shared/tool-core/types.ts 导入
 *
 * 设计理由：StagingKnex 是 BaseTool.buildEffectiveContext 的核心依赖，
 * 迁移到 shared/ 后通过端口接口解耦对 backend services/ 的依赖。
 */

import type { Knex } from 'knex';
import type { IStagingPool } from './port-interfaces.js';
import type { IShadowStateLayer } from './port-interfaces.js';
import type { StagingKnexContext } from '../types/tool.js';
import { getChildLogger } from '../utils/logger.js';

const logger = getChildLogger('staging-knex');

/** StagingQueryBuilder 内部使用的冲突配置（与 StagedWrite.onConflict 的结构不同） */
interface LocalOnConflictConfig {
  columns: string[];
  merge: boolean;
}

class StagingQueryBuilder {
  private tableName: string;
  private realDb: Knex;
  private stagingPool: IStagingPool;
  private shadowState: IShadowStateLayer;
  private conditions: Record<string, unknown> = {};
  private realQueryBuilder: Knex.QueryBuilder;
  private _orderBy?: { column: string; order: string };
  private _limit?: number;
  private _selectFields?: string[];
  private onConflictConfig?: LocalOnConflictConfig;
  private _returning?: string | string[];
  private toolType: string;
  private method: string;
  private source: 'gamemaster' | 'subagent';
  private subAgentType?: string;
  private isWriteOperation = false;
  private _insertData?: Record<string, unknown> | Record<string, unknown>[];
  private _insertItems?: Record<string, unknown>[];
  private _capturedSql?: string;
  private _capturedBindings?: unknown[];
  private _updateData?: Record<string, unknown>;
  private _isDelete = false;

  constructor(
    tableName: string,
    realDb: Knex,
    stagingPool: IStagingPool,
    shadowState: IShadowStateLayer,
    toolType: string,
    method: string,
    source: 'gamemaster' | 'subagent',
    subAgentType?: string,
  ) {
    this.tableName = tableName;
    this.realDb = realDb;
    this.stagingPool = stagingPool;
    this.shadowState = shadowState;
    this.realQueryBuilder = (realDb as any)(tableName);
    this.toolType = toolType;
    this.method = method;
    this.source = source;
    this.subAgentType = subAgentType;
  }

  where(keyOrConditions: string | Record<string, unknown>, operatorOrValue?: unknown, value?: unknown): StagingQueryBuilder {
    if (typeof keyOrConditions === 'string') {
      if (value !== undefined) {
        this.conditions[keyOrConditions] = value;
        (this.realQueryBuilder as any) = (this.realQueryBuilder as any).where(keyOrConditions, operatorOrValue, value);
      } else {
        this.conditions[keyOrConditions] = operatorOrValue;
        (this.realQueryBuilder as any) = (this.realQueryBuilder as any).where(keyOrConditions, operatorOrValue);
      }
    } else {
      this.conditions = { ...this.conditions, ...keyOrConditions };
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).where(keyOrConditions);
    }
    return this;
  }

  andWhere(key: string, operator: string | unknown, value?: unknown): StagingQueryBuilder {
    if (value !== undefined) {
      this.conditions[key] = value;
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).andWhere(key, operator as string, value);
    } else {
      this.conditions[key] = operator;
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).andWhere(key, operator as unknown);
    }
    return this;
  }

  orWhere(keyOrConditions: string | Record<string, unknown>, value?: unknown): StagingQueryBuilder {
    if (typeof keyOrConditions === 'string') {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).orWhere(keyOrConditions, value);
    } else {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).orWhere(keyOrConditions);
    }
    return this;
  }

  whereIn(column: string, values: unknown[]): StagingQueryBuilder {
    // 修复：whereIn 必须更新 this.conditions，否则 ShadowState 的 delete/update
    // 匹配范围会因条件丢失而错误放大（如 location_connections 批量 delete 误删全表）。
    // 数组值在 ShadowStateLayer.applyQuery / findMatchingPks 中按 IN 语义处理。
    this.conditions[column] = values;
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).whereIn(column, values);
    return this;
  }

  whereNotIn(column: string, values: unknown[]): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).whereNotIn(column, values);
    return this;
  }

  orWhereIn(column: string, values: unknown[]): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).orWhereIn(column, values);
    return this;
  }

  whereNull(column: string): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).whereNull(column);
    return this;
  }

  whereNotNull(column: string): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).whereNotNull(column);
    return this;
  }

  whereRaw(sql: string, bindings?: unknown[]): StagingQueryBuilder {
    if (bindings) {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).whereRaw(sql, bindings as Knex.RawBinding[]);
    } else {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).whereRaw(sql);
    }
    return this;
  }

  orderBy(column: string, order: string = 'asc'): StagingQueryBuilder {
    this._orderBy = { column, order };
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).orderBy(column, order);
    return this;
  }

  limit(value: number): StagingQueryBuilder {
    this._limit = value;
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).limit(value);
    return this;
  }

  offset(value: number): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).offset(value);
    return this;
  }

  select(...fields: string[]): StagingQueryBuilder {
    this._selectFields = fields.flat();
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).select(...fields);
    return this;
  }

  first(): Promise<Record<string, unknown> | undefined> {
    // Bug 2 修复：改用 read（而非 readOne）区分"无 shadow 数据"和"shadow 数据为空"。
    // readOne 在空结果时返回 undefined，无法与"无 shadow 数据"区分，导致 first() 错误 fallback 到真实 DB。
    // read 返回 undefined = 无 shadow 数据（允许 DB fallback）；返回 [] = shadow 权威为空（不 fallback）。
    const shadowResult = this.shadowState.read(this.tableName, this.conditions);
    if (shadowResult !== undefined) {
      logger.debug('Shadow state hit for first()', { table: this.tableName });
      return Promise.resolve(
        shadowResult.length > 0 ? shadowResult[0] as Record<string, unknown> : undefined,
      );
    }
    return (this.realQueryBuilder as any).first() as Promise<Record<string, unknown> | undefined>;
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): StagingQueryBuilder {
    this.isWriteOperation = true;
    const items = Array.isArray(data) ? data : [data];

    let capturedSql: string | undefined;
    let capturedBindings: unknown[] | undefined;
    try {
      const sqlResult = (this.realQueryBuilder as any).clone()
        .insert(items.length === 1 ? items[0] : items).toSQL();
      capturedSql = sqlResult.sql;
      capturedBindings = sqlResult.bindings as unknown[];
    } catch { /* fallback to structured approach */ }

    this._insertData = data;
    this._insertItems = items;
    this._capturedSql = capturedSql;
    this._capturedBindings = capturedBindings;

    return this;
  }

  update(data: Record<string, unknown>): StagingQueryBuilder {
    this.isWriteOperation = true;

    let capturedSql: string | undefined;
    let capturedBindings: unknown[] | undefined;
    try {
      const sqlResult = (this.realQueryBuilder as any).clone().update(data).toSQL();
      capturedSql = sqlResult.sql;
      capturedBindings = sqlResult.bindings as unknown[];
    } catch { /* fallback */ }

    this._updateData = data;
    this._capturedSql = capturedSql;
    this._capturedBindings = capturedBindings;

    return this;
  }

  delete(): StagingQueryBuilder {
    this.isWriteOperation = true;

    let capturedSql: string | undefined;
    let capturedBindings: unknown[] | undefined;
    try {
      const sqlResult = (this.realQueryBuilder as any).clone().delete().toSQL();
      capturedSql = sqlResult.sql;
      capturedBindings = sqlResult.bindings as unknown[];
    } catch { /* fallback */ }

    this._isDelete = true;
    this._capturedSql = capturedSql;
    this._capturedBindings = capturedBindings;

    return this;
  }

  del(): StagingQueryBuilder {
    return this.delete();
  }

  onConflict(columns: string | string[]): StagingQueryBuilder {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.onConflictConfig = { columns: cols, merge: false };
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).onConflict(columns as string | string[]);
    return this;
  }

  merge(): StagingQueryBuilder {
    if (this.onConflictConfig) {
      this.onConflictConfig.merge = true;
    }
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).merge();
    return this;
  }

  ignore(): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).ignore();
    return this;
  }

  returning(columns: string | string[]): StagingQueryBuilder {
    this._returning = columns;
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).returning(columns);
    return this;
  }

  count(column: string = '*'): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).count(column);
    return this;
  }

  sum(column: string): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).sum(column);
    return this;
  }

  join(table: string, col1: string, operator: string | unknown, col2?: string): StagingQueryBuilder {
    if (col2 !== undefined) {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).join(table, col1, operator as string, col2);
    } else {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).join(table, col1, operator as string);
    }
    return this;
  }

  leftJoin(table: string, col1: string, operator: string | unknown, col2?: string): StagingQueryBuilder {
    if (col2 !== undefined) {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).leftJoin(table, col1, operator as string, col2);
    } else {
      (this.realQueryBuilder as any) = (this.realQueryBuilder as any).leftJoin(table, col1, operator as string);
    }
    return this;
  }

  groupBy(columns: string | string[]): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).groupBy(columns);
    return this;
  }

  pluck(column: string): StagingQueryBuilder {
    (this.realQueryBuilder as any) = (this.realQueryBuilder as any).pluck(column);
    return this;
  }

  clone(): StagingQueryBuilder {
    const cloned = new StagingQueryBuilder(
      this.tableName,
      this.realDb,
      this.stagingPool,
      this.shadowState,
      this.toolType,
      this.method,
      this.source,
      this.subAgentType,
    );
    cloned.conditions = { ...this.conditions };
    cloned.realQueryBuilder = (this.realQueryBuilder as any).clone();
    cloned._orderBy = this._orderBy ? { ...this._orderBy } : undefined;
    cloned._limit = this._limit;
    cloned._selectFields = this._selectFields ? [...this._selectFields] : undefined;
    cloned.onConflictConfig = this.onConflictConfig ? { ...this.onConflictConfig } : undefined;
    cloned._returning = this._returning;
    cloned._insertData = this._insertData;
    cloned._insertItems = this._insertItems;
    cloned._capturedSql = this._capturedSql;
    cloned._capturedBindings = this._capturedBindings;
    cloned._updateData = this._updateData;
    cloned._isDelete = this._isDelete;
    return cloned;
  }

  async increment(column: string, amount: number = 1): Promise<unknown> {
    this.isWriteOperation = true;
    await this.stagingPool.stage({
      table: this.tableName,
      operation: 'update',
      data: { [column]: StagingQueryBuilder.rawIncrementPlaceholder(column, amount) },
      where: { ...this.conditions },
      toolType: this.toolType,
      method: this.method,
      source: this.source,
      subAgentType: this.subAgentType,
    });
    logger.debug('Staged increment', { table: this.tableName, column, amount, toolType: this.toolType });
    return {};
  }

  then(resolve: (value: unknown) => void, reject?: (reason?: unknown) => void): void {
    if (this.isWriteOperation) {
      this._executeStaging().then(() => {
        const result = this._getWriteResult();
        resolve(result);
      }).catch(reject);
      return;
    }

    if (this._selectFields || Object.keys(this.conditions).length > 0) {
      const shadowResult = this.shadowState.read(this.tableName, this.conditions);
      // Bug 2 修复：信任 []（shadow 权威判定结果为空），不 fallback 到真实 DB。
      // 旧条件 `shadowResult.length > 0` 在 pending deletes 导致空结果时会 fallback，
      // 返回未 flush 的陈旧行（如已 staging delete 的 entity_graph_edges）。
      if (shadowResult !== undefined) {
        logger.debug('Shadow state hit for then()', { table: this.tableName });
        let result: unknown[] = shadowResult;
        // select('*') 或未指定字段时，返回完整 row（与 SQL SELECT * 语义一致）。
        // 仅当显式指定具体字段时才做字段过滤，避免 '*' 被当字面字段名检查导致所有字段丢失。
        const isSelectAll = !this._selectFields
          || this._selectFields.length === 0
          || this._selectFields.includes('*');
        if (!isSelectAll) {
          result = result.map((row: unknown) => {
            const record = row as Record<string, unknown>;
            const filtered: Record<string, unknown> = {};
            for (const field of this._selectFields!) {
              if (field in record) {
                filtered[field] = record[field];
              }
            }
            return filtered;
          });
        }
        if (this._limit !== undefined) {
          result = result.slice(0, this._limit);
        }
        resolve(result);
        return;
      }
    }

    (this.realQueryBuilder as any).then(resolve, reject);
  }

  catch(reject: (reason?: unknown) => void): Promise<unknown> {
    if (this.isWriteOperation) {
      return Promise.resolve(this._getWriteResult());
    }
    return (this.realQueryBuilder as any).catch(reject);
  }

  private async _executeStaging(): Promise<void> {
    if (this._insertItems) {
      for (const item of this._insertItems) {
        await this.stagingPool.stage({
          table: this.tableName,
          operation: 'insert',
          data: { ...item },
          where: { ...this.conditions },
          capturedSql: this._insertItems!.length === 1 ? this._capturedSql : undefined,
          capturedBindings: this._insertItems!.length === 1 ? this._capturedBindings : undefined,
          onConflict: this.onConflictConfig ? {
            columns: this.onConflictConfig.columns,
            action: this.onConflictConfig.merge ? 'merge' : 'ignore',
          } : undefined,
          toolType: this.toolType,
          method: this.method,
          source: this.source,
          subAgentType: this.subAgentType,
        });
      }
      logger.debug('Staged insert', { table: this.tableName, toolType: this.toolType, count: this._insertItems.length, onConflict: !!this.onConflictConfig });
    }
    if (this._updateData) {
      await this.stagingPool.stage({
        table: this.tableName,
        operation: 'update',
        data: this._updateData,
        where: { ...this.conditions },
        capturedSql: this._capturedSql,
        capturedBindings: this._capturedBindings,
        toolType: this.toolType,
        method: this.method,
        source: this.source,
        subAgentType: this.subAgentType,
      });
      logger.debug('Staged update', { table: this.tableName, conditions: this.conditions, toolType: this.toolType });
    }
    if (this._isDelete) {
      await this.stagingPool.stage({
        table: this.tableName,
        operation: 'delete',
        data: {},
        where: { ...this.conditions },
        capturedSql: this._capturedSql,
        capturedBindings: this._capturedBindings,
        toolType: this.toolType,
        method: this.method,
        source: this.source,
        subAgentType: this.subAgentType,
      });
      logger.debug('Staged delete', { table: this.tableName, conditions: this.conditions, toolType: this.toolType });
    }
  }

  private _getWriteResult(): unknown {
    if (this._insertItems) {
      return this._insertItems;
    }
    if (this._updateData) return this._updateData;
    if (this._isDelete) return {};
    return undefined;
  }

  private static rawIncrementPlaceholder(column: string, amount: number): string {
    return `__INCREMENT__:${column}:${amount}`;
  }
}

export function createStagingKnex(realDb: Knex, ctx: StagingKnexContext): Knex {
  const stagingFn = (tableName: string): StagingQueryBuilder => {
    return new StagingQueryBuilder(
      tableName,
      realDb,
      ctx.stagingPool,
      ctx.shadowState,
      ctx.toolType,
      ctx.method,
      ctx.source,
      ctx.subAgentType,
    );
  };

  const proxy = new Proxy(stagingFn as unknown as Knex, {
    get(_target, prop) {
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          if (args.length === 1 && typeof args[0] === 'function') {
            const stagingTrx = createStagingTransaction(realDb, ctx);
            try {
              return await args[0](stagingTrx);
            } catch (error) {
              // work 抛错时自动回滚 StagingPool 中的暂存写入（对齐 Knex.transaction 契约）
              await (stagingTrx as unknown as { rollback: () => Promise<void> }).rollback();
              throw error;
            }
          }
          return createStagingTransaction(realDb, ctx);
        };
      }

      if (prop === 'fn') {
        return (realDb as any).fn;
      }

      if (prop === 'raw') {
        return (...args: unknown[]) => {
          const sql = typeof args[0] === 'string' ? args[0] : '';
          const isWriteSql = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\s/i.test(sql);
          if (isWriteSql) {
            throw new Error(`StagingKnex: db.raw() with write SQL is not allowed in staging context. Use StagingPool-compatible methods instead. SQL: ${sql.substring(0, 100)}`);
          }
          return (realDb as any).raw(...args);
        };
      }

      if (prop === 'schema') {
        return (realDb as any).schema;
      }

      if (typeof prop === 'string' && prop in realDb) {
        return (realDb as any)[prop];
      }

      return undefined;
    },
  });

  return proxy;
}

function createStagingTransaction(realDb: Knex, ctx: StagingKnexContext): Knex.Transaction {
  logger.info('StagingKnex: transaction() used in staging context, DB-level atomicity not preserved, but StagingPool rollback is honored on work failure', {
    toolType: ctx.toolType,
    method: ctx.method,
  });

  const writesBefore = ctx.stagingPool.writeCount;

  const stagingTrxFn = (tableName: string): StagingQueryBuilder => {
    return new StagingQueryBuilder(
      tableName,
      realDb,
      ctx.stagingPool,
      ctx.shadowState,
      ctx.toolType,
      ctx.method,
      ctx.source,
      ctx.subAgentType,
    );
  };

  const proxy = new Proxy(stagingTrxFn as unknown as Knex.Transaction, {
    get(_target, prop) {
      if (prop === 'commit') {
        return () => Promise.resolve();
      }
      if (prop === 'rollback') {
        return () => {
          const writesRemoved = ctx.stagingPool.rollbackFrom(writesBefore);
          if (writesRemoved > 0) {
            logger.debug('StagingKnex: transaction rollback removed staged writes', { writesRemoved });
          }
          return Promise.resolve();
        };
      }
      if (typeof prop === 'string' && prop in realDb) {
        return (realDb as any)[prop];
      }
      return undefined;
    },
  });

  return proxy;
}
