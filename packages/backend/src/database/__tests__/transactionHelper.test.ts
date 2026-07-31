import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { ITransactionManager } from '../TransactionManager.js';
import { runInTransaction } from '../transactionHelper.js';

describe('runInTransaction', () => {
  /** 创建一个 fake Knex.Transaction，仅用于作为引用比较。 */
  function makeFakeTrx(): Knex.Transaction {
    return { id: 'fake-trx' } as unknown as Knex.Transaction;
  }

  /** 创建一个 mock 的 ITransactionManager，transaction 方法被 spy。 */
  function makeMockTxManager(): ITransactionManager & {
    transaction: ReturnType<typeof vi.fn>;
  } {
    return {
      transaction: vi.fn(),
    } as unknown as ITransactionManager & {
      transaction: ReturnType<typeof vi.fn>;
    };
  }

  it('传入 externalTrx 时复用事务，不调用 txManager.transaction', async () => {
    const txManager = makeMockTxManager();
    const externalTrx = makeFakeTrx();
    const work = vi.fn().mockResolvedValue('result');

    const result = await runInTransaction(txManager, externalTrx, work);

    expect(result).toBe('result');
    expect(work).toHaveBeenCalledTimes(1);
    // work 接收到的正是传入的 externalTrx
    expect(work).toHaveBeenCalledWith(externalTrx);
    // 关键：不应创建新事务
    expect(txManager.transaction).not.toHaveBeenCalled();
  });

  it('externalTrx 为 undefined 时通过 txManager 创建新事务', async () => {
    const txManager = makeMockTxManager();
    const newTrx = makeFakeTrx();
    txManager.transaction.mockImplementation(async (work: (trx: Knex.Transaction) => Promise<unknown>) => {
      return work(newTrx);
    });
    const work = vi.fn().mockResolvedValue(42);

    const result = await runInTransaction(txManager, undefined, work);

    expect(result).toBe(42);
    expect(txManager.transaction).toHaveBeenCalledTimes(1);
    // work 由 txManager.transaction 传入的新事务调用
    expect(work).toHaveBeenCalledWith(newTrx);
  });

  it('work 抛出异常时，异常正确透传给调用方', async () => {
    const txManager = makeMockTxManager();
    // txManager.transaction 需真正调用 work，否则 work 的 rejection 无法传播
    txManager.transaction.mockImplementation(async (work: (trx: Knex.Transaction) => Promise<unknown>) => {
      return work(makeFakeTrx());
    });
    const error = new Error('business failure');
    const work = vi.fn().mockRejectedValue(error);

    await expect(runInTransaction(txManager, undefined, work)).rejects.toThrow(error);
    expect(txManager.transaction).toHaveBeenCalledTimes(1);
  });

  it('传入 externalTrx 时 work 抛出的异常也正确透传', async () => {
    const txManager = makeMockTxManager();
    const externalTrx = makeFakeTrx();
    const error = new Error('nested failure');
    const work = vi.fn().mockRejectedValue(error);

    await expect(runInTransaction(txManager, externalTrx, work)).rejects.toThrow(error);
    // 复用模式下不应触碰 txManager
    expect(txManager.transaction).not.toHaveBeenCalled();
  });

  it('work 返回值（包括对象/undefined）正确透传', async () => {
    const txManager = makeMockTxManager();
    txManager.transaction.mockImplementation(async (work: (trx: Knex.Transaction) => Promise<unknown>) => {
      return work(makeFakeTrx());
    });

    // 对象返回值
    const objWork = vi.fn().mockResolvedValue({ a: 1, b: { c: 2 } });
    const objResult = await runInTransaction(txManager, undefined, objWork);
    expect(objResult).toEqual({ a: 1, b: { c: 2 } });

    // undefined 返回值
    const voidWork = vi.fn().mockResolvedValue(undefined);
    const voidResult = await runInTransaction(txManager, undefined, voidWork);
    expect(voidResult).toBeUndefined();
  });
});
