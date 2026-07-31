/**
 * MemoryController —— 记忆压缩的调度者（M3 模块 3）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M3-AgentRuntime拆分.md §9
 *
 * 职责：post-ReAct 异步触发 4 路压缩任务（contextCompressor 检查、Agent 上下文
 * 压缩、NPC 记忆压缩、记忆阈值检查），经 writeQueue 串行化，compaction 前后
 * dispatch hook；预算检查（promptBuildBudgetGuard）在压缩前观测。
 *
 * 迁移自 AgentRuntime（行为等价，纯移动 + §9.4 一处显式修复）：
 * triggerContextCompression / runCompactionWithHooks / compressAgentContexts /
 * compressNPCMemories / checkMemoryThresholds
 *
 * §9.4 修复：compressAgentContexts 压缩回写改经 ContextManager.replaceMessages
 * （内存 + 落库同步），修复原"写浅拷贝仅落库、内存不更新"的不一致缺陷。
 *
 * 依赖方向：仅依赖 types.ts 接口 + HookDispatcher，零 import facade。
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { config as appConfig } from '../../utils/config.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type {
  IMemoryController,
  MemoryControllerDeps,
} from './types.js';

const logger = createChildLogger('memory-controller');

export class MemoryController implements IMemoryController {
  private readonly deps: MemoryControllerDeps;

  constructor(deps: MemoryControllerDeps) {
    this.deps = deps;
  }

  /**
   * post-ReAct 异步触发全量压缩检查（不阻塞响应；fire-and-forget）。
   * 4 路任务经 writeQueue 串行化，单路失败互不影响（§9.5）。
   */
  triggerCompression(saveId: ID): void {
    const writeQueue = this.deps.writeQueue;
    const runCompress = (fn: () => Promise<unknown>, label: string) => {
      const executeCompression = async () => {
        await this.runWithHooks(saveId, label, fn);
      };

      if (writeQueue) {
        writeQueue.enqueueFn(executeCompression, `contextCompression.${label}`).catch(err => {
          logger.debug(`Context compression failed: ${label}`, { error: getErrorMessage(err) });
        });
      } else {
        executeCompression().catch(err => {
          logger.debug(`Context compression failed: ${label}`, { error: getErrorMessage(err) });
        });
      }
    };

    if (this.deps.contextCompressor) {
      runCompress(() => this.deps.contextCompressor!.checkAndCompress(saveId), 'checkAndCompress');
    }
    runCompress(() => this.compressAgentContexts(saveId), 'compressAgentContexts');
    runCompress(() => this.compressNPCMemories(saveId), 'compressNPCMemories');
    runCompress(() => this.checkMemoryThresholds(saveId), 'checkMemoryThresholds');
  }

  /**
   * compaction 前后 dispatch hook（before_compaction / after_compaction）。
   * before blocked 时跳过本次压缩且不发 after（§9.5 现状语义）。
   */
  private async runWithHooks(
    saveId: ID,
    label: string,
    compressFn: () => Promise<unknown>,
  ): Promise<void> {
    const requestId = this.deps.snapshotProvider()?.requestId ?? `compaction:${saveId}`;
    const agentRunId = `${this.deps.agentKey}:compaction:${label}:${randomUUID()}`;
    const beforeHookResult = await this.deps.hookDispatcher.dispatch(
      'before_compaction',
      {
        requestId,
        agentRunId,
        payload: {
          saveId,
          label,
        },
      },
    );

    if (beforeHookResult.blocked) {
      return;
    }

    try {
      await compressFn();
      await this.deps.hookDispatcher.dispatch(
        'after_compaction',
        {
          requestId,
          agentRunId,
          payload: {
            saveId,
            label,
            status: 'completed',
          },
        },
      );
    } catch (error) {
      await this.deps.hookDispatcher.dispatch(
        'after_compaction',
        {
          requestId,
          agentRunId,
          payload: {
            saveId,
            label,
            status: 'failed',
            error: {
              message: getErrorMessage(error),
            },
          },
        },
      );
      throw error;
    }
  }

  private async compressAgentContexts(saveId: ID): Promise<void> {
    if (!this.deps.contextService) return;
    const compressionConfig = appConfig.contextCompression as { maxMessages?: number } | undefined;
    const maxMessages = compressionConfig?.maxMessages ?? 100;

    for (const [agentType, agent] of this.deps.agentInstancesProvider()) {
      try {
        const context = agent.getContext();
        if (context.messages.length > maxMessages) {
          const budgetGuard = this.deps.gmMemoryDeps?.promptBuildBudgetGuard;
          if (budgetGuard) {
            const budgetResult = budgetGuard.check(
              { systemPrompt: '', userPrompt: '', apiTools: [], allowedFunctionNames: new Set() },
              context.messages,
            );
            logger.info('Budget check before compression', {
              saveId, agentType,
              utilizationRatio: budgetResult.utilizationRatio,
              urgency: budgetResult.compressionUrgency,
            });
          }

          const semanticCompressor = this.deps.gmMemoryDeps?.semanticContextCompressor;
          const episodicMemoryService = this.deps.gmMemoryDeps?.episodicMemoryService;
          if (semanticCompressor && episodicMemoryService) {
            try {
              await semanticCompressor.flushToEpisodicMemory(
                saveId, agentType, context.messages,
              );
            } catch (flushError) {
              logger.warn('Failed to flush memories before compression', {
                saveId, agentType,
                error: getErrorMessage(flushError),
              });
            }
          }

          if (semanticCompressor) {
            try {
              const compressed = await semanticCompressor.compress(context.messages);
              // §9.4 修复：经 ContextManager.replaceMessages 回写（内存 + 落库同步），
              // 替代原"写 getContext() 浅拷贝仅落库"的内存/DB 不一致路径。
              await this.deps.contextManagerProvider(agent).replaceMessages(compressed);
            } catch (compressError) {
              logger.warn('Semantic compression failed, falling back to simple truncation', {
                saveId, agentType,
                error: getErrorMessage(compressError),
              });
              await this.deps.contextService.compressContext(saveId, agentType, maxMessages);
            }
          } else {
            await this.deps.contextService.compressContext(saveId, agentType, maxMessages);
          }
        }
      } catch (error) {
        logger.warn('Failed to compress agent context', { saveId, agentType, error: getErrorMessage(error) });
      }
    }
  }

  private async compressNPCMemories(saveId: ID): Promise<void> {
    const gmMemoryDeps = this.deps.gmMemoryDeps;
    if (!gmMemoryDeps) return;
    const npcService = await gmMemoryDeps.npcServiceFactory(saveId);

    const compressionConfig = appConfig.contextCompression as {
      npcMemoryThreshold?: number; npcCustomDataSizeKB?: number; npcProtectThreshold?: number;
    } | undefined;
    const memoryThreshold = compressionConfig?.npcMemoryThreshold ?? 30;
    const customDataSizeKB = compressionConfig?.npcCustomDataSizeKB ?? 32;
    const protectThreshold = compressionConfig?.npcProtectThreshold ?? 4;

    try {
      const npcs = await npcService.listNPCs(saveId);
      for (const npc of npcs) {
        try {
          const memories = (npc.customData as Record<string, unknown>)?.memories;
          const memoryCount = Array.isArray(memories) ? memories.length : 0;
          const customDataStr = JSON.stringify(npc.customData);
          const customDataSize = Buffer.byteLength(customDataStr, 'utf-8');

          if (customDataSize >= customDataSizeKB * 1024 || memoryCount >= memoryThreshold) {
            await npcService.compressMemories(saveId, npc.id, { timeWindowMs: 86400000, protectThreshold });
          }
        } catch {
          // Skip individual NPC compression failures
        }
      }
    } catch {
      // Skip NPC memory compression if service fails
    }
  }

  private async checkMemoryThresholds(saveId: ID): Promise<void> {
    const episodicMemoryService = this.deps.gmMemoryDeps?.episodicMemoryService;
    const proceduralMemoryService = this.deps.gmMemoryDeps?.proceduralMemoryService;
    if (!episodicMemoryService || !proceduralMemoryService) return;

    try {
      await episodicMemoryService.checkAndCompressIfNeeded(saveId, this.deps.agentKey);
    } catch (error) {
      logger.warn('Failed to check episodic memory thresholds', {
        saveId, error: getErrorMessage(error),
      });
    }

    try {
      await proceduralMemoryService.checkAndPruneIfNeeded(saveId, this.deps.agentKey);
    } catch (error) {
      logger.warn('Failed to check procedural memory thresholds', {
        saveId, error: getErrorMessage(error),
      });
    }
  }
}
