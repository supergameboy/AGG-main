import { IntegrationResult } from './types.js';
import { AgentType, WriteOperation, NeedAgentRequest } from '../../../../shared/src/types/agent.js';
import { AgentResponse } from '../types.js';
import type { FallbackSuggestion } from '@ai-rpg/shared/types/tool';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('result-integrator');

export class ResultIntegrator {
  private writeOperationLog: WriteOperation[] = [];

  constructor() {}

  async integrate(results: Map<AgentType, AgentResponse>): Promise<IntegrationResult> {
    logger.info('Integrating results from multiple agents', {
      agentCount: results.size
    });

    const writeOperations: WriteOperation[] = [];
    const data: Record<string, unknown> = {};
    let allSuccess = true;
    let hasWriteConflicts = false;
    const fallbackSuggestions: IntegrationResult['fallbackSuggestions'] = [];
    const needAgentRequests: NeedAgentRequest[] = [];

    for (const [agentType, response] of results) {
      if (!response.success) {
        allSuccess = false;
        logger.warn(`Agent ${agentType} returned unsuccessful response`, {
          error: response.error
        });
      }

      const responseData = response.data as Record<string, unknown> | undefined;
      const fallbackSource = responseData?.fallbackSuggestion || (responseData?.data as Record<string, unknown> | undefined)?.fallbackSuggestion;
      if (fallbackSource) {
        fallbackSuggestions.push({
          agentType,
          suggestion: fallbackSource as FallbackSuggestion
        });
        logger.info(`Collected fallback suggestion from ${agentType}`, {
          suggestionType: (fallbackSource as Record<string, unknown>).type
        });
      }

      if (!response.success) {
        continue;
      }

      data[agentType] = response.data;

      // 收集 needAgent 请求
      if (responseData && typeof responseData === 'object') {
        const needAgents = responseData.needAgents || (responseData.data as Record<string, unknown> | undefined)?.needAgents;
        if (Array.isArray(needAgents)) {
          needAgentRequests.push(...needAgents);
        }
      }

      if (response.toolCalls) {
        for (const toolCall of response.toolCalls) {
          if (toolCall.success && toolCall.data) {
            const writeOp = toolCall.writeOperation as WriteOperation | undefined;
            if (writeOp) {
              const conflicts = this.checkWriteConflicts([writeOp]);

              if (conflicts.length > 0) {
                hasWriteConflicts = true;
                logger.warn(`Write conflict detected for agent ${agentType}`, {
                  operation: writeOp,
                  conflicts
                });
              } else {
                writeOperations.push(writeOp);
                this.writeOperationLog.push(writeOp);
              }
            }

            // 统一面板变更推送机制：识别 toolCall.data.writeOperations 数组字段（透传的子 Agent writeOps）。
            // batch_spawn_agents handler 在 result.data.writeOperations 透传子 Agent 的 writeOperation 数组，
            // 这里合并到 GM Agent 的 finalIntegrationResult.writeOperations，
            // 让 GM 的 extractAndRefreshPanelUpdates 能感知子 Agent 写入的领域（触发对应 RefreshConfig）。
            const toolCallData = toolCall.data as { writeOperations?: WriteOperation[] } | undefined;
            if (toolCallData?.writeOperations && Array.isArray(toolCallData.writeOperations)) {
              const conflicts = this.checkWriteConflicts(toolCallData.writeOperations);
              if (conflicts.length > 0) {
                hasWriteConflicts = true;
                logger.warn(`Nested writeOperations conflicts detected for agent ${agentType}`, {
                  conflictCount: conflicts.length,
                  conflicts
                });
              }
              for (const nestedOp of toolCallData.writeOperations) {
                if (!conflicts.includes(nestedOp)) {
                  writeOperations.push(nestedOp);
                  this.writeOperationLog.push(nestedOp);
                }
              }
            }
          }
        }
      }
    }

    const integrationResult: IntegrationResult = {
      success: allSuccess && !hasWriteConflicts,
      data,
      writeOperations,
      agentResponses: results,
      needsFurtherProcessing: false,
      fallbackSuggestions,
      needAgentRequests: needAgentRequests.length > 0 ? needAgentRequests : undefined,
    };

    return integrationResult;
  }

  mergeResults(first: IntegrationResult, second: IntegrationResult): IntegrationResult {
    const mergedNeedAgentRequests: NeedAgentRequest[] = [
      ...(first.needAgentRequests ?? []),
      ...(second.needAgentRequests ?? [])
    ];

    return {
      ...second,
      data: {
        ...first.data,
        ...second.data,
        firstLayerData: first.data
      },
      writeOperations: [
        ...first.writeOperations,
        ...second.writeOperations
      ],
      needAgentRequests: mergedNeedAgentRequests.length > 0 ? mergedNeedAgentRequests : undefined,
    };
  }

  checkWriteConflicts(operations: WriteOperation[]): WriteOperation[] {
    const conflicts: WriteOperation[] = [];

    for (const newOp of operations) {
      const existingOp = this.writeOperationLog.find(existing =>
        existing.toolType === newOp.toolType &&
        existing.method === newOp.method &&
        JSON.stringify(existing.params) === JSON.stringify(newOp.params)
      );

      if (existingOp) {
        logger.warn('Write conflict detected and skipped', {
          newOperation: newOp,
          existingOperation: existingOp
        });
        conflicts.push(newOp);
      }
    }

    return conflicts;
  }

  clearWriteOperationLog(): void {
    this.writeOperationLog = [];
  }

  getWriteOperationLog(): WriteOperation[] {
    return this.writeOperationLog;
  }
}
