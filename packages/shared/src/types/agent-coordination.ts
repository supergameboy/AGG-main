/**
 * 跨层共享的 Agent 协调类型定义
 *
 * 仅放置需要被多个包（如 backend/agents 与 backend/services）共同引用的协调类型，
 * 以打破 agents↔services 的双向类型依赖（参见 fractal-design-20260626-backend-decoupling-refactor）。
 *
 * 规则：
 * - 此文件中的 interface 仅做"属性定义"级别的类型声明，不包含运行时逻辑
 * - 不依赖任何 agents/ 或 services/ 层类型（shared 是最底层包）
 * - 仅依赖 shared/ 内部类型（如 AgentType）
 */

import type { AgentType } from './agent';
import type { AuditResult } from './audit';

/**
 * 审计问题维度
 *
 * 由 ContinuityAuditor 填充，描述程序化审计发现的问题。
 * 迁移自 packages/backend/src/agents/story/types.ts
 * 原因：UnifiedPostReviewDecision 引用此类型，一起下沉以消除 agents→shared 反向依赖。
 *
 * 方案M迁移后：此类型仅供旧 continuityAudit 字段使用，新代码应使用 auditResult（AuditResult）。
 */
export interface AuditIssue {
  dimension: 'npc_location' | 'item_ownership' | 'numeric_range' | 'timeline' | 'pacing' | 'fk_reference';
  severity: 'error' | 'warning';
  problem: string;
  expectedValue: string;
  actualValue: string;
  suggestion: string;
}

/**
 * 统一的事后审查决策
 *
 * 由 risk-gate（services 层）与 StoryKernel/StoryPostReactPipeline（agents 层）共同消费。
 * 迁移自 packages/backend/src/agents/story/types.ts
 * 原因：services/risk-gate.ts 引用此类型，下沉到 shared 后 services→shared←agents，
 * 消除 services→agents 的类型依赖边。
 */
export interface UnifiedPostReviewDecision {
  taskReview?: {
    completion?: 'complete' | 'partial' | 'failed';
    missingRequirements?: string[];
    qualityVerifications?: Array<{
      agentType?: string;
      summary?: string;
      severity?: 'info' | 'warning' | 'error';
    }>;
  };
  storyReview?: {
    storyConsistency?: 'match' | 'partial_match' | 'mismatch';
    progressDelta?: string;
    reviewFocus?: string[];
  };
  /** 程序化审计结果（由 ContinuityAuditor 填充，LLM 不生成）—— 旧字段，方案M迁移后保留兼容 */
  continuityAudit?: {
    issues: AuditIssue[];
    passed: boolean;
  };
  /**
   * 方案M迁移后新增：AuditAgent 产出的结构化审核结果。
   * 包含 failures + rootCause + repairSuggestion，供 StoryPostReactPipeline 做修复决策。
   * 新代码应消费此字段而非 continuityAudit。
   */
  auditResult?: AuditResult;
  /** 完成度评估 */
  todoCompletion?: {
    completedItems: string[];
    incompleteItems: string[];
    overallCompletion: 'complete' | 'partial' | 'failed';
  };
  secondLayerDecision?: {
    shouldSchedule?: boolean;
    reason?: string;
    agents?: AgentType[];
    constraints?: {
      mustReveal?: string[];
      mustHide?: string[];
      avoid?: string[];
    };
    needsDynamicUI?: boolean;
    dynamicUIScenario?: string;
    dynamicUIReason?: string;
  };
  recordUploadDecision?: {
    shouldUpload?: boolean;
    reason?: string;
    eventSummary?: string;
  };
  [key: string]: unknown;
}
