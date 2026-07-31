import type {
  StoryPostReactPipelineInput,
  StoryPostReactPipelineResult,
  StoryProjection,
} from './types.js';
// P2-S1: UnifiedPostReviewDecision 已下沉到 shared/src/types/agent-coordination.ts
import type { UnifiedPostReviewDecision } from '../../../../shared/src/types/agent-coordination.js';
import type { AgentType, ToolResult } from '../../../../shared/src/types/agent.js';
import type { AuditRootCause } from '../../../../shared/src/types/audit.js';
import { ROUTABLE_DOMAIN_AGENT_TYPES } from '../coordinator/types.js';

const VALID_AGENT_TYPES = new Set<AgentType>(ROUTABLE_DOMAIN_AGENT_TYPES);

/**
 * 方案M迁移：rootCause → repairReason 映射。
 * 根因分类指导修复方向，避免无脑二次派发。
 */
const ROOT_CAUSE_REPAIR_REASONS: Record<AuditRootCause, string> = {
  context_injection_error: 'audit:context_injection_error',
  llm_understanding_error: 'audit:llm_understanding_error',
  data_missing: 'audit:data_missing',
  tool_execution_failure: 'audit:tool_execution_failure',
};

export class StoryPostReactPipeline {
  constructor(private readonly deps: Record<string, unknown>) {
    void this.deps;
  }

  async run(input: StoryPostReactPipelineInput): Promise<StoryPostReactPipelineResult> {
    const postReviewDecision = this.resolvePostReviewDecision(input);
    const secondLayerDecision = postReviewDecision?.secondLayerDecision;
    const auditResult = postReviewDecision?.auditResult;
    const todoCompletionState =
      postReviewDecision?.todoCompletion?.overallCompletion
      ?? (input.storyDirective?.todoList?.length ? 'missing' : undefined);
    const resolvedLayer1Agents = this.resolveLayer1Agents(secondLayerDecision);
    const needAgentReasons = this.resolveNeedAgentReasons(secondLayerDecision);
    const secondLayerDecisionValid =
      secondLayerDecision == null
        ? false
        : secondLayerDecision.shouldSchedule !== true || resolvedLayer1Agents.length > 0;
    const repairReasons = this.buildRepairReasons({
      auditPassed: auditResult?.pass,
      auditRootCause: auditResult?.rootCause,
      todoCompletionState,
      secondLayerDecision,
      secondLayerDecisionValid,
      pacingReviewResult: input.pacingReviewResult,
    });
    const requiresRepair = repairReasons.length > 0;

    // 模块3 L2-2：后处理引导——检测感知变化事件，生成 perceptionUpdateHint
    const perceptionUpdateHint = this.detectPerceptionUpdateHint(input.reactResult.toolCalls);

    return {
      postReviewDecision,
      resolvedLayer1Agents,
      needAgentReasons,
      requiresRepair,
      storyStateCommit: {
        runtimeState: {},
        projection: this.resolveProjection(input),
      },
      devtoolsTrace: {
        phase: 'post-react',
        repairRoundCount: 0,
        requiresRepair,
        decisionSummary: {
          storyConsistency: this.resolveStoryConsistency(postReviewDecision),
          todoCompletion: todoCompletionState,
          auditPassed: auditResult?.pass,
          auditRootCause: auditResult?.rootCause,
          secondLayerDecisionValid,
        },
        repairReasons,
        resolvedLayer1Agents,
        needAgentReasons,
        runtimeCommitSummary: {
          wrotePostReviewDecision: false,
          wroteContinuityAudit: false,
          wroteTodoCompletion: false,
          wroteRepairMetadata: false,
        },
      },
      perceptionUpdateHint,
    };
  }

  /**
   * 分析 toolCalls，检测感知变化事件，生成感知更新建议（模块3 L2-2 后处理引导）。
   *
   * 调用点：在 StoryPostReactPipeline.run() 内部，resolvePostReviewDecision 之后调用。
   *
   * 期望效果：
   * - 任务完成后，若检测到战斗/对话/任务完成/剧情转折等事件，
   *   返回 perceptionUpdateHint 提示 GM 调用 set_awareness/set_relationship。
   * - 无感知相关事件时返回 null，不注入下一轮 prompt。
   *
   * @param toolCalls ReActEngineResult.toolCalls（每个 ToolResult 含 _meta.toolType + _meta.method）
   * @returns 感知更新提示字符串，或 null
   */
  private detectPerceptionUpdateHint(toolCalls: ToolResult[]): string | null {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;

    const detectedEvents: string[] = [];

    for (const call of toolCalls) {
      const meta = call._meta;
      if (!meta) continue;

      const { toolType, method, params } = meta;

      // 战斗事件：combat_service.complete_combat / execute_combat_round
      if (toolType === 'combat_service' && (method === 'complete_combat' || method === 'execute_combat_round')) {
        if (!detectedEvents.includes('combat')) {
          detectedEvents.push('combat');
        }
        continue;
      }

      // 对话事件：dialogue_service.add_dialogue_message / process_dialogue_choice
      if (toolType === 'dialogue_service' && (method === 'add_dialogue_message' || method === 'process_dialogue_choice')) {
        if (!detectedEvents.includes('dialogue')) {
          detectedEvents.push('dialogue');
        }
        continue;
      }

      // 任务完成事件：quest_service.update_quest (status=completed)
      if (toolType === 'quest_service' && method === 'update_quest') {
        const updates = (params?.updates ?? {}) as Record<string, unknown>;
        const status = (params?.status ?? updates.status) as unknown;
        if (status === 'completed' && !detectedEvents.includes('quest_complete')) {
          detectedEvents.push('quest_complete');
        }
        continue;
      }

      // 剧情转折事件：event_service.trigger_event (eventType=major)
      if (toolType === 'event_service' && method === 'trigger_event') {
        const eventData = (params?.eventData ?? {}) as Record<string, unknown>;
        const eventType = (params?.eventType ?? eventData.eventType) as unknown;
        if (eventType === 'major' && !detectedEvents.includes('plot_turn')) {
          detectedEvents.push('plot_turn');
        }
        continue;
      }
    }

    if (detectedEvents.length === 0) return null;

    const eventDescriptions: Record<string, string> = {
      combat: '战斗已完成',
      dialogue: '对话已发生',
      quest_complete: '任务已完成',
      plot_turn: '剧情已发生转折',
    };

    const eventList = detectedEvents.map(e => eventDescriptions[e]).join('、');
    // 006 升级：set_awareness/set_relationship 改为 delta 语义（score 是变更量累加，非绝对值）
    // 设计文档 §31：提示文本补充 delta 语义说明，避免 GM 误传绝对值
    return `${eventList}，请评估参战/交互 NPC 对玩家及相关实体的感知变化，必要时调用 entity_graph_service.set_awareness/set_relationship 更新（observerType=npc，observerId=NPC ID，scoreDelta 为变更量非绝对值，正负号表示提升/降低）`;
  }

  private resolveProjection(input: StoryPostReactPipelineInput): StoryProjection {
    return input.storyRequestContext?.projection ?? {
      chapter: null,
      mainQuest: null,
    };
  }

  private resolvePostReviewDecision(input: StoryPostReactPipelineInput): UnifiedPostReviewDecision | null {
    if (input.postReviewDecision) {
      return input.postReviewDecision;
    }

    const integrationResult = this.asRecord(input.integrationResult);
    const integrationData = this.asRecord(integrationResult.data);
    const rawDecision = integrationData.unifiedDecision ?? integrationResult.unifiedDecision;
    const decision = this.asRecord(rawDecision);

    if (Object.keys(decision).length === 0) {
      return null;
    }

    return decision as UnifiedPostReviewDecision;
  }

  private resolveLayer1Agents(secondLayerDecision: UnifiedPostReviewDecision['secondLayerDecision']): AgentType[] {
    if (secondLayerDecision?.shouldSchedule !== true || !Array.isArray(secondLayerDecision.agents)) {
      return [];
    }

    return secondLayerDecision.agents.filter(
      (agent): agent is AgentType => typeof agent === 'string' && VALID_AGENT_TYPES.has(agent as AgentType),
    );
  }

  private resolveNeedAgentReasons(secondLayerDecision: UnifiedPostReviewDecision['secondLayerDecision']): string[] {
    if (typeof secondLayerDecision?.reason !== 'string') {
      return [];
    }

    const reason = secondLayerDecision.reason.trim();
    return reason ? [reason] : [];
  }

  private resolveStoryConsistency(
    postReviewDecision: UnifiedPostReviewDecision | null,
  ): 'consistent' | 'partial_match' | 'mismatch' | undefined {
    if (postReviewDecision?.storyReview?.storyConsistency === 'match') {
      return 'consistent';
    }

    if (postReviewDecision?.storyReview?.storyConsistency === 'partial_match') {
      return 'partial_match';
    }

    if (postReviewDecision?.storyReview?.storyConsistency === 'mismatch') {
      return 'mismatch';
    }

    return undefined;
  }

  /**
   * 方案M迁移：buildRepairReasons 基于 auditResult.rootCause 分类。
   * - 审核未通过时，根据 rootCause 添加对应的修复原因
   * - 保留 todoCompletion/secondLayerDecision/pacing 的修复原因
   */
  private buildRepairReasons(params: {
    auditPassed?: boolean;
    auditRootCause?: AuditRootCause;
    todoCompletionState?: 'complete' | 'partial' | 'failed' | 'missing';
    secondLayerDecision?: UnifiedPostReviewDecision['secondLayerDecision'];
    secondLayerDecisionValid: boolean;
    pacingReviewResult?: import('./types.js').PacingReviewResult;
  }): string[] {
    const repairReasons: string[] = [];

    // 方案M迁移：审核未通过时，根据 rootCause 添加修复原因
    if (params.auditPassed === false) {
      const rootCause = params.auditRootCause;
      if (rootCause && ROOT_CAUSE_REPAIR_REASONS[rootCause]) {
        repairReasons.push(ROOT_CAUSE_REPAIR_REASONS[rootCause]);
      } else {
        // rootCause 缺失时使用通用审核失败原因
        repairReasons.push('audit:failed_unknown_root_cause');
      }
    }

    if (params.todoCompletionState === 'failed') {
      repairReasons.push('todo_completion:failed');
    }
    if (params.todoCompletionState === 'missing') {
      repairReasons.push('todo_completion:missing');
    }
    if (params.secondLayerDecision?.shouldSchedule === true && !params.secondLayerDecisionValid) {
      repairReasons.push('second_layer_decision:invalid');
    }

    // 节奏修复原因
    if (params.pacingReviewResult?.consecutiveHighPressure) {
      repairReasons.push('pacing:consecutive_high_pressure');
    }
    if (params.pacingReviewResult?.consecutiveLowPressure) {
      repairReasons.push('pacing:consecutive_low_pressure');
    }
    if (Math.abs(params.pacingReviewResult?.progressDeviation ?? 0) > 0.3) {
      repairReasons.push('pacing:progress_deviation');
    }

    return repairReasons;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }
}
