import type { Knex } from 'knex';

/**
 * Repository 基类：封装 Knex 实例 + 单表名，提供通用查询入口。
 * 子类继承后实现 row → entity 映射和领域特定查询。
 *
 * D9 决策：query(trx?) 支持可选事务参数，由 Service 层管理事务边界。
 */
export abstract class BaseRepository<TTable extends string, TEntity> {
  protected readonly db: Knex;
  protected readonly tableName: TTable;

  constructor(db: Knex, tableName: TTable) {
    this.db = db;
    this.tableName = tableName;
  }

  /**
   * 便捷查询入口：子类通过 this.query(trx?) 访问 Knex 查询构造器。
   * 有 trx 时使用 trx（事务内），无 trx 时使用内部 db（非事务）。
   */
  protected query(trx?: Knex.Transaction): Knex.QueryBuilder {
    return (trx ?? this.db)(this.tableName);
  }

  /** 子类实现：数据库行 → 领域实体映射 */
  protected abstract rowToEntity(row: Record<string, unknown>): TEntity;
}
