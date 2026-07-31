import type { IntegrationResult, SchedulerRequestContext } from './types.js';
import type { AgentMessage, WriteOperation } from '../../../../shared/src/types/agent.js';
// P2-S1: UnifiedPostReviewDecision 已下沉到 shared/，消除 services→agents 类型依赖边
import type { UnifiedPostReviewDecision } from '../../../../shared/src/types/agent-coordination.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('risk-gate');

export interface RiskGateConfig {
  enabled: boolean;
  toolFailureThreshold: number;
}

export interface RiskAssessmentInput {
  integratedResult: IntegrationResult;
  message: AgentMessage;
  runtimeContext: SchedulerRequestContext;
  toolFailureRate?: number;
}

export interface RiskAssessment {
  level: 'low' | 'high';
  reasons: string[];
  skippedReviewer: boolean;
}

const DEFAULT_CONFIG: RiskGateConfig = {
  enabled: true,
  toolFailureThreshold: 0.5,
};

export class RiskGate {
  private config: RiskGateConfig;

  constructor(config?: Partial<RiskGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  assess(input: RiskAssessmentInput): RiskAssessment {
    if (!this.config.enabled) {
      return { level: 'high', reasons: ['risk_gate_disabled'], skippedReviewer: false };
    }

    const reasons: string[] = [];

    // 1. Cross-agent write conflict
    if (this.hasCrossAgentWriteConflict(input.integratedResult)) {
      reasons.push('cross_agent_write_conflict');
    }

    // 2. Need agent requests
    if ((input.integratedResult.needAgentRequests?.length ?? 0) > 0) {
      reasons.push('need_agent_requests');
    }

    // 3. Dynamic UI needed
    if (input.runtimeContext.intent?.needsDynamicUI === true) {
      reasons.push('dynamic_ui_needed');
    }

    // 4. Tool failure rate exceeded
    if (input.toolFailureRate !== undefined && input.toolFailureRate > this.config.toolFailureThreshold) {
      reasons.push('tool_failure_rate_exceeded');
    }

    // 5. Execution failure
    if (!input.integratedResult.success) {
      reasons.push('execution_failed');
    }

    // 6. Needs further processing
    if (input.integratedResult.needsFurtherProcessing) {
      reasons.push('needs_further_processing');
    }

    // 7. Correction action
    if (input.message.payload?.action === 'correct') {
      reasons.push('correction_action');
    }

    // 8. Second layer schedule
    if (input.runtimeContext.reactIterations > 1) {
      reasons.push('second_layer_schedule');
    }

    // 9. 13.3 规则: 归属一致性校验——owner_id/owner_type 缺失、非法枚举、不配对即为高风险
    const ownershipIssues = this.assessOwnershipConsistency(input.integratedResult.writeOperations);
    if (ownershipIssues.length > 0) {
      reasons.push('ownership_inconsistency');
      logger.warn('RiskGate: ownership inconsistency detected', { issues: ownershipIssues });
    }

    const level = reasons.length > 0 ? 'high' : 'low';
    const skippedReviewer = level === 'low';

    if (skippedReviewer) {
      logger.info('RiskGate: low risk, skipping Reviewer');
    } else {
      logger.info('RiskGate: high risk, entering Reviewer', { reasons });
    }

    return { level, reasons, skippedReviewer };
  }

  /**
   * 13.3 规则: 归属一致性静态校验。
   * 检查 write operations 中涉及 owner_id/owner_type 的写入是否合法：
   * - owner_id 存在但 owner_type 缺失（或反之）= 不配对
   * - owner_type 非 'character'/'npc' = 非法枚举
   * - owner_id 为空字符串 = 空值
   *
   * 数据库存在性校验（owner_id 是否真实存在于 characters/npcs 表）由审计层 ItemOwnershipChecker 负责。
   */
  private assessOwnershipConsistency(writeOperations: WriteOperation[]): string[] {
    const issues: string[] = [];
    const LEGAL_OWNER_TYPES = new Set(['character', 'npc']);

    for (const op of writeOperations) {
      const params = op.params ?? {};
      const hasOwnerId = 'ownerId' in params || 'owner_id' in params;
      const hasOwnerType = 'ownerType' in params || 'owner_type' in params;
      const ownerId = String(params.ownerId ?? params.owner_id ?? '');
      const ownerType = String(params.ownerType ?? params.owner_type ?? '');

      // 跳过不涉及归属的写入操作
      if (!hasOwnerId && !hasOwnerType) continue;

      // 校验配对
      if (hasOwnerId && !hasOwnerType) {
        issues.push(`${op.toolType}.${op.method}: ownerId present but ownerType missing`);
      }
      if (hasOwnerType && !hasOwnerId) {
        issues.push(`${op.toolType}.${op.method}: ownerType present but ownerId missing`);
      }

      // 校验空值
      if (hasOwnerId && ownerId === '') {
        issues.push(`${op.toolType}.${op.method}: ownerId is empty string`);
      }

      // 校验枚举
      if (hasOwnerType && ownerType !== '' && !LEGAL_OWNER_TYPES.has(ownerType)) {
        issues.push(`${op.toolType}.${op.method}: ownerType=${ownerType} not in {character, npc}`);
      }
    }

    return issues;
  }

  buildDefaultDecision(): UnifiedPostReviewDecision {
    return {
      taskReview: {
        completion: 'complete',
        qualityVerifications: [],
      },
      storyReview: {
        storyConsistency: 'match',
        progressDelta: 'low_risk_auto_approved',
      },
      secondLayerDecision: {
        shouldSchedule: false,
      },
      recordUploadDecision: {
        shouldUpload: true,
        reason: 'auto_approved_by_risk_gate',
      },
    };
  }

  /**
   * Detect cross-agent write conflicts by checking if multiple agents
   * have write operations targeting the same toolType + method + entity.
   */
  private hasCrossAgentWriteConflict(result: IntegrationResult): boolean {
    const writesByTarget = new Map<string, Set<string>>();

    for (const [agentType, response] of result.agentResponses) {
      if (!response.toolCalls) continue;

      for (const toolCall of response.toolCalls) {
        if (!toolCall.success || !toolCall.writeOperation) continue;

        const op = toolCall.writeOperation as WriteOperation;
        const targetKey = this.computeWriteTargetKey(op);

        if (!writesByTarget.has(targetKey)) {
          writesByTarget.set(targetKey, new Set());
        }
        writesByTarget.get(targetKey)!.add(agentType);
      }
    }

    for (const agents of writesByTarget.values()) {
      if (agents.size > 1) return true;
    }

    return false;
  }

  /**
   * Compute a target key from a write operation for conflict detection.
   * Two operations targeting the same entity (same toolType + method + entity ID in params)
   * are considered conflicting.
   */
  private computeWriteTargetKey(op: WriteOperation): string {
    // Extract entity ID from params if available
    const params = op.params ?? {};
    const entityId = (params as Record<string, unknown>).id
      ?? (params as Record<string, unknown>).npcId
      ?? (params as Record<string, unknown>).questId
      ?? (params as Record<string, unknown>).locationId
      ?? (params as Record<string, unknown>).itemId
      ?? (params as Record<string, unknown>).skillId
      ?? JSON.stringify(params);

    return `${op.toolType}:${op.method}:${entityId}`;
  }
}
