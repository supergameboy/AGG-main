import type { Knex } from 'knex';

/**
 * 事务管理器端口接口。
 * D10: Service 移除 db 字段后，事务入口通过此抽象端口管理。
 * Service 完全无 Knex 依赖，事务边界由 Service 调用此接口开启。
 */
export interface ITransactionManager {
  /**
   * 在事务内执行工作单元。
   * 工作单元接收 trx 参数，透传给 Repository 方法和跨领域 Service 方法（D9）。
   * 事务提交/回滚由实现负责，Service 只关心业务逻辑。
   */
  transaction<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
}

/**
 * Knex 事务管理器实现。
 * 包装 Knex db.transaction，由 ServiceTool 创建并注入 Service。
 */
export class KnexTransactionManager implements ITransactionManager {
  constructor(private readonly db: Knex) {}

  async transaction<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
