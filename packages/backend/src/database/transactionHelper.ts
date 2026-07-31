import type { Knex } from 'knex';
import type { ITransactionManager } from './TransactionManager.js';

/**
 * 事务执行辅助函数。
 *
 * 统一处理"外部传入事务 vs 自建事务"两种场景，消除 Service 中的重复样板代码。
 * 支持事务外副作用：work 函数返回值会透传给调用方，便于在事务提交后执行副作用。
 *
 * 行为语义：
 * - externalTrx 传入时：直接在传入的事务上执行 work，**不创建新事务**（嵌套复用）。
 * - externalTrx 为 undefined 时：通过 txManager.transaction 创建新事务执行 work，
 *   事务的提交/回滚由 txManager 实现负责。
 *
 * @param txManager   事务管理器
 * @param externalTrx 调用方传入的外部事务（可选）。传入时复用，不传入时自建。
 * @param work        业务工作单元，接收事务对象，返回业务结果。
 * @returns work 函数的返回值
 */
export async function runInTransaction<T>(
  txManager: ITransactionManager,
  externalTrx: Knex.Transaction | undefined,
  work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  if (externalTrx) {
    return work(externalTrx);
  }
  return txManager.transaction(work);
}
