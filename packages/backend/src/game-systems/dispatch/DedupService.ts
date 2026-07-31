import { createChildLogger } from '../../utils/logger.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { ContextManifest } from '../../../../shared/src/types/context-manifest.js';
import { buildDispatchKey, extractTaskHash } from '@ai-rpg/shared/utils/dispatch-key';
import { DispatchLogRepository } from './DispatchLogRepository.js';

const logger = createChildLogger('dedup-service');

/**
 * 去重决策结果 - coordinator 根据 decision 决定是否执行 agentTask。
 */
export type DedupDecision =
  | { action: 'proceed'; dispatchKey: string; taskHash: string }
  | { action: 'skip_succeeded'; resultSummary: string | null; dispatchKey: string }
  | { action: 'skip_in_progress'; dispatchKey: string }
  | { action: 'retry'; dispatchKey: string; taskHash: string; attemptCount: number; maxAttempts: number }
  | { action: 'exhausted'; dispatchKey: string; attemptCount: number; maxAttempts: number };

/**
 * DedupService - 去重状态机逻辑。
 *
 * 去重策略（方案I）：
 * - succeeded → skip_succeeded（幂等，返回已有结果摘要）
 * - in_progress 且未过期 → skip_in_progress（避免并发重复派发）
 * - in_progress 且已过期（僵尸记录）→ proceed（抢占，incrementAttempt）
 * - failed 且 attempt_count < max_attempts → retry（允许重试）
 * - failed 且 attempt_count >= max_attempts（exhausted）→ exhausted，GM接管或降级
 * - 无记录 → proceed（首次派发）
 */
export class DedupService {
  private static readonly DEFAULT_TTL_MS = 300_000;
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;

  constructor(
    private readonly dispatchLogRepo: DispatchLogRepository,
    private readonly defaultMaxAttempts: number = DedupService.DEFAULT_MAX_ATTEMPTS,
    private readonly ttlMs: number = DedupService.DEFAULT_TTL_MS,
  ) {}

  /**
   * 检查去重状态，返回决策。
   */
  async checkDedup(params: {
    saveId: ID;
    agentType: string;
    action: string;
    task: string;
    manifest?: ContextManifest;
    taskDescription?: string;
    manifestSummary?: string;
  }): Promise<DedupDecision> {
    const { saveId, agentType, action, task, manifest } = params;
    const dispatchKey = buildDispatchKey(agentType, action, task, manifest);
    const taskHash = extractTaskHash(dispatchKey);

    const existing = await this.dispatchLogRepo.findByKey(saveId, agentType, action, taskHash);

    if (!existing) {
      return { action: 'proceed', dispatchKey, taskHash };
    }

    const queryResult = this.dispatchLogRepo.toQueryResult(existing);

    if (queryResult.status === 'succeeded') {
      logger.debug('Dedup: skip succeeded', { dispatchKey, attemptCount: existing.attempt_count });
      return { action: 'skip_succeeded', resultSummary: queryResult.result_summary, dispatchKey };
    }

    if (queryResult.status === 'in_progress') {
      if (queryResult.isStale) {
        logger.info('Dedup: zombie record, preempting', { dispatchKey, expiresAt: existing.expires_at });
        await this.dispatchLogRepo.incrementAttempt(saveId, agentType, action, taskHash);
        return {
          action: 'retry',
          dispatchKey,
          taskHash,
          attemptCount: existing.attempt_count + 1,
          maxAttempts: existing.max_attempts,
        };
      }
      logger.debug('Dedup: skip in_progress', { dispatchKey });
      return { action: 'skip_in_progress', dispatchKey };
    }

    if (queryResult.status === 'failed') {
      if (queryResult.isExhausted) {
        logger.warn('Dedup: exhausted', { dispatchKey, attemptCount: existing.attempt_count, maxAttempts: existing.max_attempts });
        return {
          action: 'exhausted',
          dispatchKey,
          attemptCount: existing.attempt_count,
          maxAttempts: existing.max_attempts,
        };
      }
      logger.info('Dedup: retry after failure', { dispatchKey, attemptCount: existing.attempt_count });
      await this.dispatchLogRepo.incrementAttempt(saveId, agentType, action, taskHash);
      return {
        action: 'retry',
        dispatchKey,
        taskHash,
        attemptCount: existing.attempt_count + 1,
        maxAttempts: existing.max_attempts,
      };
    }

    return { action: 'proceed', dispatchKey, taskHash };
  }

  /**
   * 记录派发开始（首次派发时调用）。
   */
  async recordDispatchStart(params: {
    saveId: ID;
    agentType: string;
    action: string;
    taskHash: string;
    taskDescription: string;
    manifestSummary: string;
    maxAttempts?: number;
  }): Promise<void> {
    await this.dispatchLogRepo.upsert({
      saveId: params.saveId,
      agentType: params.agentType,
      action: params.action,
      taskHash: params.taskHash,
      taskDescription: params.taskDescription,
      manifestSummary: params.manifestSummary,
      maxAttempts: params.maxAttempts ?? this.defaultMaxAttempts,
      ttlMs: this.ttlMs,
    });
  }

  /**
   * 记录派发成功。
   */
  async recordSuccess(
    saveId: ID,
    agentType: string,
    action: string,
    taskHash: string,
    resultSummary: string,
  ): Promise<void> {
    await this.dispatchLogRepo.updateStatus(saveId, agentType, action, taskHash, 'succeeded', resultSummary);
  }

  /**
   * 记录派发失败。
   */
  async recordFailure(
    saveId: ID,
    agentType: string,
    action: string,
    taskHash: string,
  ): Promise<void> {
    await this.dispatchLogRepo.updateStatus(saveId, agentType, action, taskHash, 'failed');
  }
}
