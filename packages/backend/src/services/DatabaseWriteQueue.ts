import type { Knex } from 'knex';
import type { ID } from '../../../shared/src/types/core';
import type { IWriteQueue } from '@ai-rpg/shared/tool-core';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

export interface WriteOperation {
  saveId: ID;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data?: Record<string, unknown>;
  where?: Record<string, unknown>;
  priority?: number;
  description?: string;
}

export interface WriteQueueLogger {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}

/**
 * DatabaseWriteQueue serializes database write operations using a Promise chain
 * (mutex pattern) to prevent SQLite "database is locked" errors from concurrent writes.
 *
 * ## Why this exists
 * SQLite supports only one writer at a time. When multiple Tool methods execute
 * concurrently (e.g. parallel batch mode in BaseTool), simultaneous writes cause
 * "SQLITE_BUSY: database is locked". This queue serializes all writes through a
 * single Promise chain, ensuring only one write is in-flight at any moment.
 *
 * ## Usage (future migration)
 * Instead of calling `this.db(table).insert(data)` directly in Service classes,
 * enqueue the operation through writeQueue for automatic serialization + retry.
 */
export class DatabaseWriteQueue implements IWriteQueue {
  private db: Knex;
  private writeChain: Promise<void> = Promise.resolve();
  private logger: WriteQueueLogger;

  constructor(db: Knex, logger?: WriteQueueLogger) {
    this.db = db;
    this.logger = logger ?? console;
  }

  /**
   * 暴露内部 db 实例（P1-1 D4 决策）。
   *
   * StagingPool.flush 需要执行直接表操作（insert/update/delete/upsert），
   * 但 Agent 层已移除 db 访问。DatabaseWriteQueue 内部已持有 db，
   * 通过此 getter 暴露给 StagingPool，消除 flush 的冗余 db 参数。
   */
  getDb(): Knex {
    return this.db;
  }

  /**
   * Enqueue a database write operation. The operation will be executed
   * sequentially via a Promise chain (FIFO mutex), preventing concurrent writes.
   *
   * Automatically retries on "database is locked" errors (up to MAX_RETRIES times
   * with exponential backoff).
   */
  async enqueue<T>(op: WriteOperation): Promise<T> {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 200;

    return new Promise<T>((resolve, reject) => {
      this.writeChain = this.writeChain.then(async () => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            let result: unknown;
            switch (op.operation) {
              case 'update':
                result = await this.db(op.table).where(op.where ?? {}).update(op.data ?? {});
                break;
              case 'insert':
                result = await this.db(op.table).insert(op.data ?? {});
                break;
              case 'delete':
                result = await this.db(op.table).where(op.where ?? {}).delete();
                break;
              default:
                reject(new Error(`Unknown write operation: ${(op as WriteOperation).operation}`));
                return;
            }
            resolve(result as T);
            return;
          } catch (error: unknown) {
            const isLocked = error instanceof Error && error.message?.includes('database is locked');
            if (isLocked && attempt < MAX_RETRIES - 1) {
              const delay = BASE_DELAY * (attempt + 1);
              this.logger.warn('DatabaseWriteQueue: retry due to database lock', {
                table: op.table,
                operation: op.operation,
                attempt: attempt + 1,
                delay,
              });
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            this.logger.error('DatabaseWriteQueue: operation failed', {
              table: op.table,
              operation: op.operation,
              error: getErrorMessage(error),
            });
            reject(error);
            return;
          }
        }
      });
    });
  }

  /**
   * Returns the current queue status.
   * Future: track pending count, queue depth, etc.
   */
  async enqueueFn<T>(fn: () => Promise<T>, description?: string): Promise<T> {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 200;

    return new Promise<T>((resolve, reject) => {
      this.writeChain = this.writeChain.then(async () => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const result = await fn();
            resolve(result);
            return;
          } catch (error: unknown) {
            const isLocked = error instanceof Error && error.message?.includes('database is locked');
            if (isLocked && attempt < MAX_RETRIES - 1) {
              const delay = BASE_DELAY * (attempt + 1);
              this.logger.warn('DatabaseWriteQueue: retry due to database lock', {
                description: description ?? 'anonymous',
                attempt: attempt + 1,
                delay,
              });
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            this.logger.error('DatabaseWriteQueue: operation failed', {
              description: description ?? 'anonymous',
              error: getErrorMessage(error),
            });
            reject(error);
            return;
          }
        }
      });
    });
  }

  private async executeWithTrx(trx: Knex.Transaction, op: WriteOperation): Promise<unknown> {
    switch (op.operation) {
      case 'insert': return trx(op.table).insert(op.data);
      case 'update': return trx(op.table).where(op.where ?? {}).update(op.data ?? {});
      case 'delete': return trx(op.table).where(op.where ?? {}).delete();
    }
  }

  async enqueueBatch<T>(operations: WriteOperation[], description?: string): Promise<T[]> {
    return this.enqueueFn(async () => {
      return this.db.transaction(async (trx) => {
        const results: T[] = [];
        for (const op of operations) {
          const result = await this.executeWithTrx(trx, op);
          results.push(result as T);
        }
        return results;
      });
    }, description ?? 'batch');
  }

  getStatus(): { isBusy: boolean } {
    // The writeChain is always resolved (Promise.resolve() at init), but
    // we track busy status via a pending flag in a future iteration.
    return { isBusy: false };
  }
}
