/**
 * ContextFlushQueue — 全局异步上下文持久化队列
 *
 * 核心设计：
 * 1. 写合并（debounce）：同一 agent 的多次持久化请求在 flush 间隔内合并为一次
 * 2. SQLite upsert：替代 read-then-write，减少一次 DB 查询
 * 3. 关键路径完全异步：addMessageToContext 不再 await 持久化
 * 4. 强制 flush：在请求结束时或 HARD_LIMIT 时强制同步等待
 */

import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import type { ID, Timestamp } from '../../../shared/src/types/core.js';
import type { AgentType, AgentContext } from '../../../shared/src/types/agent.js';
import type { DatabaseWriteQueue } from './DatabaseWriteQueue.js';

const logger = createChildLogger('context-flush');

/** 待刷写的上下文快照 */
interface PendingFlush {
  saveId: ID;
  agentType: AgentType;
  messages: string;   // JSON.stringify(context.messages)
  state: string;      // JSON.stringify(context.state)
  updatedAt: Timestamp;
}

/** 队列条目：同一 agent 的最新快照 + flush timer */
interface QueueEntry {
  snapshot: PendingFlush;
  timer: ReturnType<typeof setTimeout> | null;
  flushPromise: Promise<void> | null;
  resolveFlush: (() => void) | null;
}

export class ContextFlushQueue {
  private db: Knex;
  private queue: Map<string, QueueEntry> = new Map();
  private readonly flushIntervalMs: number;
  private readonly maxRetries: number;
  private writeQueue: DatabaseWriteQueue | null;
  private destroyed = false;

  constructor(db: Knex, options?: { flushIntervalMs?: number; maxRetries?: number; writeQueue?: DatabaseWriteQueue }) {
    this.db = db;
    this.flushIntervalMs = options?.flushIntervalMs ?? 200;
    this.maxRetries = options?.maxRetries ?? 3;
    this.writeQueue = options?.writeQueue ?? null;
  }

  /** 生成队列 key */
  private key(saveId: ID, agentType: AgentType): string {
    return `${saveId}:${agentType}`;
  }

  /**
   * 入队一个待刷写的上下文快照。
   * 同一 agent 的多次入队会合并（debounce），只保留最新快照。
   * 非阻塞，立即返回。
   */
  enqueue(saveId: ID, agentType: AgentType, context: AgentContext): void {
    if (this.destroyed) return;

    const k = this.key(saveId, agentType);
    const snapshot: PendingFlush = {
      saveId,
      agentType,
      messages: JSON.stringify(context.messages),
      state: JSON.stringify(context.state),
      updatedAt: Date.now() as Timestamp,
    };

    const existing = this.queue.get(k);
    if (existing) {
      // 写合并：更新快照，重置 timer
      existing.snapshot = snapshot;
      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      existing.timer = setTimeout(() => {
        this.flushOne(k);
      }, this.flushIntervalMs);
    } else {
      // 新条目
      let resolveFlush: (() => void) | null = null;
      const flushPromise = new Promise<void>(resolve => { resolveFlush = resolve; });
      const entry: QueueEntry = {
        snapshot,
        timer: setTimeout(() => {
          this.flushOne(k);
        }, this.flushIntervalMs),
        flushPromise,
        resolveFlush,
      };
      this.queue.set(k, entry);
    }
  }

  /**
   * 强制同步刷写指定 agent 的上下文。
   * 用于 HARD_LIMIT 或请求结束时确保数据安全。
   */
  async forceFlush(saveId: ID, agentType: AgentType): Promise<void> {
    const k = this.key(saveId, agentType);
    const entry = this.queue.get(k);
    if (!entry) return;

    // 取消 debounce timer，立即刷写
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    await this.flushOne(k);
  }

  /**
   * 强制同步刷写所有待处理的上下文。
   * 用于进程关闭时确保数据安全。
   */
  async flushAll(): Promise<void> {
    const keys = Array.from(this.queue.keys());
    await Promise.all(keys.map(k => this.flushOne(k)));
  }

  /** 刷写单个条目 */
  private async flushOne(k: string): Promise<void> {
    const entry = this.queue.get(k);
    if (!entry) return;

    this.queue.delete(k);

    const { snapshot, resolveFlush } = entry;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (this.writeQueue) {
          await this.writeQueue.enqueueFn(
            () => this.upsertContext(snapshot),
            `contextFlush.${snapshot.agentType}`
          );
        } else {
          await this.upsertContext(snapshot);
        }
        resolveFlush?.();
        return;
      } catch (err) {
        const errorMsg = getErrorMessage(err);
        if (attempt < this.maxRetries) {
          logger.warn(`Flush failed (attempt ${attempt}/${this.maxRetries})`, {
            agentType: snapshot.agentType,
            error: errorMsg,
          });
          await this.delay(Math.pow(2, attempt - 1) * 500);
        } else {
          logger.error(`Flush failed after ${this.maxRetries} attempts`, {
            agentType: snapshot.agentType,
            error: errorMsg,
          });
          resolveFlush?.();
        }
      }
    }
  }

  /** SQLite upsert：INSERT OR REPLACE 替代 read-then-write */
  private async upsertContext(snapshot: PendingFlush): Promise<void> {
    await this.db.raw(
      `INSERT OR REPLACE INTO agent_contexts (id, save_id, agent_type, messages, state, updated_at)
       VALUES (
         COALESCE((SELECT id FROM agent_contexts WHERE save_id = ? AND agent_type = ?), ?),
         ?, ?, ?, ?, ?
       )`,
      [
        snapshot.saveId, snapshot.agentType,  // COALESCE subquery params
        `ctx-${snapshot.agentType}`,          // default id for new row
        snapshot.saveId,                      // INSERT values
        snapshot.agentType,
        snapshot.messages,
        snapshot.state,
        snapshot.updatedAt,
      ]
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 销毁队列，刷写所有待处理数据 */
  async destroy(): Promise<void> {
    this.destroyed = true;
    // 取消所有 timer
    for (const entry of this.queue.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    await this.flushAll();
  }

  /** 当前队列中的待处理条目数 */
  get pendingCount(): number {
    return this.queue.size;
  }
}
