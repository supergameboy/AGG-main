import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import { generateDeterministicId } from '../../../../shared/src/types/core.js';

/**
 * 派发状态 - 三态存储 + exhausted 派生标签。
 * exhausted 不独立存储，是 failed + attempt_count >= max_attempts 的派生语义。
 */
export type DispatchStatus = 'in_progress' | 'succeeded' | 'failed';

/**
 * 派发日志条目（DB行映射）。
 */
export interface DispatchLogEntry {
  id: string;
  save_id: string;
  agent_type: string;
  action: string;
  task_hash: string;
  status: DispatchStatus;
  attempt_count: number;
  max_attempts: number;
  task_description: string;
  manifest_summary: string;
  result_summary: string | null;
  last_dispatched_at: number;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

/**
 * 派发查询结果 - 含派生标签 exhausted 和 isStale。
 */
export interface DispatchQueryResult {
  status: DispatchStatus;
  attempt_count: number;
  max_attempts: number;
  result_summary: string | null;
  isExhausted: boolean;
  isStale: boolean;
}

/**
 * 插入或更新派发记录的输入。
 */
export interface DispatchLogEntryInput {
  saveId: ID;
  agentType: string;
  action: string;
  taskHash: string;
  taskDescription: string;
  manifestSummary: string;
  maxAttempts: number;
  ttlMs: number;
}

/**
 * DispatchLogRepository - 派发日志持久化。
 *
 * 确定性ID让重复INSERT主键冲突被DB拦截（方案J三层防护之一）。
 * UNIQUE(save_id, agent_type, action, task_hash) 约束防并发冲突（方案D第二层）。
 */
export class DispatchLogRepository {
  private static readonly DEFAULT_TTL_MS = 300_000;

  constructor(private readonly db: Knex) {}

  /**
   * 按去重键查找派发记录。
   */
  async findByKey(saveId: ID, agentType: string, action: string, taskHash: string): Promise<DispatchLogEntry | null> {
    const row = await this.db('agent_dispatch_log')
      .where({
        save_id: saveId,
        agent_type: agentType,
        action: action,
        task_hash: taskHash,
      })
      .first();
    return (row as DispatchLogEntry | undefined) ?? null;
  }

  /**
   * 插入或更新派发记录（幂等）。
   * 确定性ID让重复INSERT主键冲突被DB拦截。
   * UNIQUE约束冲突时用onConflict().merge()处理（B-2并发安全）。
   */
  async upsert(input: DispatchLogEntryInput): Promise<DispatchLogEntry> {
    const now = Date.now();
    const dispatchKey = `${input.agentType}|${input.action}|${input.taskHash}`;
    const id = generateDeterministicId('dispatch', input.saveId, dispatchKey);
    const expiresAt = now + input.ttlMs;

    const entry: Omit<DispatchLogEntry, 'created_at' | 'updated_at'> & { created_at: number; updated_at: number } = {
      id,
      save_id: input.saveId,
      agent_type: input.agentType,
      action: input.action,
      task_hash: input.taskHash,
      status: 'in_progress',
      attempt_count: 1,
      max_attempts: input.maxAttempts,
      task_description: input.taskDescription.substring(0, 200),
      manifest_summary: input.manifestSummary.substring(0, 200),
      result_summary: null,
      last_dispatched_at: now,
      expires_at: expiresAt,
      created_at: now,
      updated_at: now,
    };

    await this.db('agent_dispatch_log')
      .insert(entry)
      .onConflict(['save_id', 'agent_type', 'action', 'task_hash'])
      .merge();

    const inserted = await this.findByKey(input.saveId, input.agentType, input.action, input.taskHash);
    return inserted ?? entry;
  }

  /**
   * 更新派发状态。
   */
  async updateStatus(
    saveId: ID,
    agentType: string,
    action: string,
    taskHash: string,
    status: DispatchStatus,
    resultSummary?: string,
  ): Promise<void> {
    const now = Date.now();
    const updateData: Record<string, unknown> = {
      status,
      updated_at: now,
    };
    if (resultSummary !== undefined) {
      updateData.result_summary = resultSummary.substring(0, 500);
    }
    if (status === 'in_progress') {
      updateData.last_dispatched_at = now;
      updateData.expires_at = now + DispatchLogRepository.DEFAULT_TTL_MS;
    }

    await this.db('agent_dispatch_log')
      .where({
        save_id: saveId,
        agent_type: agentType,
        action: action,
        task_hash: taskHash,
      })
      .update(updateData);
  }

  /**
   * 增加尝试次数（重试时调用）。
   */
  async incrementAttempt(
    saveId: ID,
    agentType: string,
    action: string,
    taskHash: string,
  ): Promise<void> {
    const now = Date.now();
    await this.db('agent_dispatch_log')
      .where({
        save_id: saveId,
        agent_type: agentType,
        action: action,
        task_hash: taskHash,
      })
      .update({
        attempt_count: this.db.raw('attempt_count + 1'),
        status: 'in_progress',
        last_dispatched_at: now,
        expires_at: now + DispatchLogRepository.DEFAULT_TTL_MS,
        updated_at: now,
      });
  }

  /**
   * 转换为查询结果（含派生标签）。
   */
  toQueryResult(entry: DispatchLogEntry): DispatchQueryResult {
    const now = Date.now();
    return {
      status: entry.status,
      attempt_count: entry.attempt_count,
      max_attempts: entry.max_attempts,
      result_summary: entry.result_summary,
      isExhausted: entry.status === 'failed' && entry.attempt_count >= entry.max_attempts,
      isStale: entry.status === 'in_progress' && now > entry.expires_at,
    };
  }

  /**
   * 清理旧记录（定期清理，避免表膨胀）。
   */
  async cleanOldRecords(beforeTimestamp: number): Promise<number> {
    const deleted = await this.db('agent_dispatch_log')
      .where('updated_at', '<', beforeTimestamp)
      .where('status', 'in', ['succeeded', 'failed'])
      .delete();
    return deleted;
  }
}
