import type {
  StoryDomainPort,
  StoryDirective,
  StoryPostReactDevtoolsTrace,
  StoryRuntimeCommitInput,
  StoryRuntimeState,
  StoryMasterPlan,
  StoryProjection,
  StoryRequestContext,
  StoryStateCommit,
  EntityGraphPort,
  WorldStateSummary,
  CharacterProfile,
  CharacterProfileRevision,
  StorySnapshot,
  PacingConfig,
  PacingState,
  PacingStage,
  PacingHistoryRecord,
  PacingConstraints,
  PacingReviewResult,
  TensionFactors,
  StageThresholds,
  DensityAssessment,
  SpeedAssessment,
} from './types.js';
// P2-S1: UnifiedPostReviewDecision 已下沉到 shared/src/types/agent-coordination.ts
import type { UnifiedPostReviewDecision } from '../../../../shared/src/types/agent-coordination.js';
import type { LLMService } from '@ai-rpg/ai';
import { ROUTABLE_DOMAIN_AGENT_TYPES } from '../coordinator/types.js';
import type { StoryEventInput } from '../../game-systems/story/types.js';
import type {
  IPacingRepository,
  IPacingHistoryRepository,
  IStoryEventRepository,
  PacingConfigRow,
  PacingHistoryRow,
} from '../../game-systems/story/types.js';
import type { ICharacterRepository } from '../../game-systems/character/types.js';
import type { IQuestRepository, IQuestObjectiveRepository } from '../../game-systems/quest/types.js';
import { eventBus } from '@ai-rpg/shared/messaging';
import type { BusEvent, StoryEventRecord, TriggerType } from '@ai-rpg/shared/messaging';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { buildEntityNodeId } from '@ai-rpg/shared/utils/entity-graph-id';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const STORY_DIRECTIVE_LAYER1_AGENT_TYPES = ROUTABLE_DOMAIN_AGENT_TYPES;
const STORY_DIRECTIVE_STRING_LIMIT = 160;
const STORY_DIRECTIVE_LIST_LIMIT = 6;
const STORY_DIRECTIVE_INJECTION_PATTERNS = [
  /忽略(?:之前|前面|所有)?(?:的)?(?:系统)?(?:规则|指令|提示词)/i,
  /输出(?:系统)?提示词/i,
  /system\s*prompt/i,
  /override/i,
  /覆盖前面规则/i,
  /只调用\s*[a-z_]+/i,
];

interface StoryDirectivePromptSummary {
  storyGoal?: string;
  playerFacingObjective?: string;
  requiredLayer1Agents: StoryDirective['requiredLayer1Agents'];
  optionalLayer1Agents: StoryDirective['optionalLayer1Agents'];
  dialogueFocus?: {
    mustReveal?: string[];
    mustHide?: string[];
  };
  constraints?: {
    mustReveal?: string[];
    mustHide?: string[];
    avoid?: string[];
  };
  hooks?: {
    npcIds?: string[];
    questSeeds?: string[];
  };
  events?: StoryDirective['events'];
  projection: StoryProjection;
}

interface UnifiedPostReviewPromptSummary {
  taskReview?: {
    completion?: 'complete' | 'partial' | 'failed';
    missingRequirements?: string[];
  };
  storyReview?: {
    storyConsistency?: 'match' | 'partial_match' | 'mismatch';
    progressDelta?: string;
    reviewFocus?: string[];
  };
  secondLayerDecision?: {
    shouldSchedule: boolean;
    reason?: string;
    agents?: StoryDirective['requiredLayer1Agents'];
    constraints?: {
      mustReveal?: string[];
      mustHide?: string[];
      avoid?: string[];
    };
  };
  recordUploadDecision?: {
    shouldUpload: boolean;
    reason?: string;
    eventSummary?: string;
  };
}

export function buildStoryDirectiveFactSheet(storyDirective?: StoryDirective | null): string {
  const promptSummary = summarizeStoryDirective(storyDirective);
  const lines: string[] = ['## StoryDirective Facts'];

  if (promptSummary.storyGoal) {
    lines.push(`- 主线目标: ${promptSummary.storyGoal}`);
  }
  if (promptSummary.playerFacingObjective) {
    lines.push(`- 玩家当前目标: ${promptSummary.playerFacingObjective}`);
  }
  if (promptSummary.requiredLayer1Agents.length > 0) {
    lines.push(`- 必须一层 Agent: ${promptSummary.requiredLayer1Agents.join(', ')}`);
  }
  if (promptSummary.optionalLayer1Agents.length > 0) {
    lines.push(`- 可选一层 Agent: ${promptSummary.optionalLayer1Agents.join(', ')}`);
  }

  const mustReveal = firstNonEmptyList(
    promptSummary.constraints?.mustReveal,
    promptSummary.dialogueFocus?.mustReveal,
  );
  const mustHide = firstNonEmptyList(
    promptSummary.constraints?.mustHide,
    promptSummary.dialogueFocus?.mustHide,
  );
  const avoid = promptSummary.constraints?.avoid;
  if (mustReveal && mustReveal.length > 0) {
    lines.push(`- 必须揭示: ${mustReveal.join('；')}`);
  }
  if (mustHide && mustHide.length > 0) {
    lines.push(`- 必须隐藏: ${mustHide.join('；')}`);
  }
  if (avoid && avoid.length > 0) {
    lines.push(`- 明确避免: ${avoid.join('；')}`);
  }
  if (promptSummary.hooks?.npcIds && promptSummary.hooks.npcIds.length > 0) {
    lines.push(`- NPC 钩子: ${promptSummary.hooks.npcIds.join(', ')}`);
  }
  if (promptSummary.hooks?.questSeeds && promptSummary.hooks.questSeeds.length > 0) {
    lines.push(`- 任务钩子: ${promptSummary.hooks.questSeeds.join(', ')}`);
  }
  if (promptSummary.events) {
    const eventParts: string[] = [];
    if (promptSummary.events.checkTriggers && promptSummary.events.checkTriggers.length > 0) {
      eventParts.push(`检查触发: ${promptSummary.events.checkTriggers.join(', ')}`);
    }
    if (promptSummary.events.scheduleEvents && promptSummary.events.scheduleEvents.length > 0) {
      eventParts.push(`调度事件: ${promptSummary.events.scheduleEvents.join(', ')}`);
    }
    if (promptSummary.events.recordStoryEvent) {
      eventParts.push('记录故事事件');
    }
    if (eventParts.length > 0) {
      lines.push(`- 事件指令: ${eventParts.join('；')}`);
    }
  }
  if (promptSummary.projection.chapter) {
    lines.push(`- 当前章节投影: ${promptSummary.projection.chapter}`);
  }
  if (promptSummary.projection.mainQuest) {
    lines.push(`- 当前主线投影: ${promptSummary.projection.mainQuest}`);
  }

  return lines.join('\n');
}

export function buildUnifiedPostReviewFactSheet(
  postReviewDecision?: UnifiedPostReviewDecision | null,
): string {
  const promptSummary = summarizeUnifiedPostReviewDecision(postReviewDecision);
  const lines: string[] = ['## UnifiedPostReviewDecision Facts'];

  if (promptSummary.taskReview?.completion) {
    lines.push(`- 任务完成度: ${promptSummary.taskReview.completion}`);
  }
  if (promptSummary.taskReview?.missingRequirements && promptSummary.taskReview.missingRequirements.length > 0) {
    lines.push(`- 缺失要求: ${promptSummary.taskReview.missingRequirements.join('；')}`);
  }
  if (promptSummary.storyReview?.storyConsistency) {
    lines.push(`- 故事一致性: ${promptSummary.storyReview.storyConsistency}`);
  }
  if (promptSummary.storyReview?.progressDelta) {
    lines.push(`- 推进变化: ${promptSummary.storyReview.progressDelta}`);
  }
  if (promptSummary.storyReview?.reviewFocus && promptSummary.storyReview.reviewFocus.length > 0) {
    lines.push(`- 评审关注点: ${promptSummary.storyReview.reviewFocus.join('；')}`);
  }
  if (promptSummary.secondLayerDecision) {
    lines.push(`- 建议二层调度: ${promptSummary.secondLayerDecision.shouldSchedule ? '是' : '否'}`);
    if (promptSummary.secondLayerDecision.reason) {
      lines.push(`- 二层调度原因: ${promptSummary.secondLayerDecision.reason}`);
    }
    if (promptSummary.secondLayerDecision.agents && promptSummary.secondLayerDecision.agents.length > 0) {
      lines.push(`- 二层 Agent: ${promptSummary.secondLayerDecision.agents.join(', ')}`);
    }
    if (promptSummary.secondLayerDecision.constraints?.mustReveal?.length) {
      lines.push(`- 二层必须揭示: ${promptSummary.secondLayerDecision.constraints.mustReveal.join('；')}`);
    }
    if (promptSummary.secondLayerDecision.constraints?.mustHide?.length) {
      lines.push(`- 二层必须隐藏: ${promptSummary.secondLayerDecision.constraints.mustHide.join('；')}`);
    }
    if (promptSummary.secondLayerDecision.constraints?.avoid?.length) {
      lines.push(`- 二层明确避免: ${promptSummary.secondLayerDecision.constraints.avoid.join('；')}`);
    }
  }
  if (promptSummary.recordUploadDecision) {
    lines.push(`- 重大记录上传: ${promptSummary.recordUploadDecision.shouldUpload ? '是' : '否'}`);
    if (promptSummary.recordUploadDecision.eventSummary) {
      lines.push(`- 记录摘要: ${promptSummary.recordUploadDecision.eventSummary}`);
    }
    if (promptSummary.recordUploadDecision.reason) {
      lines.push(`- 上传原因: ${promptSummary.recordUploadDecision.reason}`);
    }
  }

  return lines.join('\n');
}

function summarizeStoryDirective(storyDirective?: StoryDirective | null): StoryDirectivePromptSummary {
  const directiveRecord = asRecordValue(storyDirective);
  const dialogueFocus = asRecordValue(directiveRecord.dialogueFocus);
  const constraints = asRecordValue(directiveRecord.constraints);
  const hooks = asRecordValue(directiveRecord.hooks);
  const projectionRecord = asRecordValue(directiveRecord.projection);

  return {
    storyGoal: sanitizeOptionalString(directiveRecord.storyGoal),
    playerFacingObjective: sanitizeOptionalString(directiveRecord.playerFacingObjective),
    requiredLayer1Agents: sanitizeLayer1Agents(directiveRecord.requiredLayer1Agents),
    optionalLayer1Agents: sanitizeLayer1Agents(
      directiveRecord.optionalLayer1Agents,
      new Set(sanitizeLayer1Agents(directiveRecord.requiredLayer1Agents)),
    ),
    dialogueFocus: buildPromptFocus(dialogueFocus),
    constraints: {
      mustReveal: sanitizeStringArray(constraints.mustReveal),
      mustHide: sanitizeStringArray(constraints.mustHide),
      avoid: sanitizeStringArray(constraints.avoid),
    },
    hooks: {
      npcIds: sanitizeStringArray(hooks.npcIds),
      questSeeds: sanitizeStringArray(hooks.questSeeds),
    },
    events: directiveRecord.events && typeof directiveRecord.events === 'object'
      ? {
          checkTriggers: Array.isArray((directiveRecord.events as Record<string, unknown>).checkTriggers)
            ? (directiveRecord.events as Record<string, unknown>).checkTriggers as import('@ai-rpg/shared/messaging').TriggerType[]
            : undefined,
          scheduleEvents: Array.isArray((directiveRecord.events as Record<string, unknown>).scheduleEvents)
            ? (directiveRecord.events as Record<string, unknown>).scheduleEvents as string[]
            : undefined,
          recordStoryEvent: typeof (directiveRecord.events as Record<string, unknown>).recordStoryEvent === 'boolean'
            ? (directiveRecord.events as Record<string, unknown>).recordStoryEvent as boolean
            : undefined,
        }
      : undefined,
    projection: {
      chapter: sanitizeOptionalString(projectionRecord.chapter) ?? null,
      mainQuest: sanitizeOptionalString(projectionRecord.mainQuest) ?? null,
    },
  };
}

function summarizeUnifiedPostReviewDecision(
  postReviewDecision?: unknown,
): UnifiedPostReviewPromptSummary {
  const decisionRecord = asRecordValue(postReviewDecision);
  const taskReview = asRecordValue(decisionRecord.taskReview);
  const storyReview = asRecordValue(decisionRecord.storyReview);
  const secondLayerDecision = asRecordValue(decisionRecord.secondLayerDecision);
  const secondLayerConstraints = asRecordValue(secondLayerDecision.constraints);
  const recordUploadDecision = asRecordValue(decisionRecord.recordUploadDecision);

  const missingRequirements = sanitizeStringArray(taskReview.missingRequirements);
  const reviewFocus = sanitizeStringArray(storyReview.reviewFocus);
  const secondLayerAgents = sanitizeLayer1Agents(secondLayerDecision.agents);

  return {
    taskReview: {
      completion: sanitizeCompletion(taskReview.completion),
      missingRequirements: missingRequirements.length > 0 ? missingRequirements : undefined,
    },
    storyReview: {
      storyConsistency: sanitizeStoryConsistency(storyReview.storyConsistency),
      progressDelta: sanitizeOptionalString(storyReview.progressDelta),
      reviewFocus: reviewFocus.length > 0 ? reviewFocus : undefined,
    },
    secondLayerDecision: Object.keys(secondLayerDecision).length > 0
      ? {
        shouldSchedule: secondLayerDecision.shouldSchedule === true,
        reason: sanitizeOptionalString(secondLayerDecision.reason),
        agents: secondLayerAgents.length > 0 ? secondLayerAgents : undefined,
        constraints: {
          mustReveal: sanitizeStringArray(secondLayerConstraints.mustReveal),
          mustHide: sanitizeStringArray(secondLayerConstraints.mustHide),
          avoid: sanitizeStringArray(secondLayerConstraints.avoid),
        },
      }
      : undefined,
    recordUploadDecision: Object.keys(recordUploadDecision).length > 0
      ? {
        shouldUpload: recordUploadDecision.shouldUpload === true,
        reason: sanitizeOptionalString(recordUploadDecision.reason),
        eventSummary: sanitizeOptionalString(recordUploadDecision.eventSummary),
      }
      : undefined,
  };
}

function hasMeaningfulUnifiedPostReviewDecision(summary: UnifiedPostReviewPromptSummary): boolean {
  return Boolean(
    summary.taskReview?.completion ||
    (summary.taskReview?.missingRequirements && summary.taskReview.missingRequirements.length > 0) ||
    summary.storyReview?.storyConsistency ||
    summary.storyReview?.progressDelta ||
    (summary.storyReview?.reviewFocus && summary.storyReview.reviewFocus.length > 0) ||
    (
      summary.secondLayerDecision &&
      (
        summary.secondLayerDecision.reason ||
        summary.secondLayerDecision.shouldSchedule ||
        (summary.secondLayerDecision.agents && summary.secondLayerDecision.agents.length > 0) ||
        (summary.secondLayerDecision.constraints?.mustReveal && summary.secondLayerDecision.constraints.mustReveal.length > 0) ||
        (summary.secondLayerDecision.constraints?.mustHide && summary.secondLayerDecision.constraints.mustHide.length > 0) ||
        (summary.secondLayerDecision.constraints?.avoid && summary.secondLayerDecision.constraints.avoid.length > 0)
      )
    ) ||
    (
      summary.recordUploadDecision &&
      (
        summary.recordUploadDecision.shouldUpload ||
        summary.recordUploadDecision.reason ||
        summary.recordUploadDecision.eventSummary
      )
    )
  );
}

function sanitizeCompletion(value: unknown): 'complete' | 'partial' | 'failed' | undefined {
  return value === 'complete' || value === 'partial' || value === 'failed'
    ? value
    : undefined;
}

function sanitizeStoryConsistency(value: unknown): 'match' | 'partial_match' | 'mismatch' | undefined {
  return value === 'match' || value === 'partial_match' || value === 'mismatch'
    ? value
    : undefined;
}

function buildPromptFocus(dialogueFocus: Record<string, unknown>): StoryDirectivePromptSummary['dialogueFocus'] {
  const mustReveal = sanitizeStringArray(dialogueFocus.mustReveal);
  const mustHide = sanitizeStringArray(dialogueFocus.mustHide);
  if (mustReveal.length === 0 && mustHide.length === 0) {
    return undefined;
  }
  return {
    mustReveal: mustReveal.length > 0 ? mustReveal : undefined,
    mustHide: mustHide.length > 0 ? mustHide : undefined,
  };
}

function firstNonEmptyList(...candidates: Array<string[] | undefined>): string[] | undefined {
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0);
}

function sanitizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  const segments = normalized
    .split(/[，,。；;]|(?:\s并\s)|(?:\s然后\s)|(?:\s且\s)/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !isDirectiveInjectionText(segment));
  const safeText = segments.join('；').trim();
  if (!safeText) {
    return undefined;
  }

  return safeText.length > STORY_DIRECTIVE_STRING_LIMIT
    ? `${safeText.slice(0, STORY_DIRECTIVE_STRING_LIMIT)}...`
    : safeText;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = sanitizeOptionalString(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= STORY_DIRECTIVE_LIST_LIMIT) {
      break;
    }
  }

  return result;
}

function sanitizeLayer1Agents(value: unknown, excluded?: Set<string>): StoryDirective['requiredLayer1Agents'] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: StoryDirective['requiredLayer1Agents'] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const normalized = item.trim();
    if (!normalized || excluded?.has(normalized)) {
      continue;
    }

    if (!STORY_DIRECTIVE_LAYER1_AGENT_TYPES.includes(normalized as typeof STORY_DIRECTIVE_LAYER1_AGENT_TYPES[number])) {
      continue;
    }

    if (!result.includes(normalized as StoryDirective['requiredLayer1Agents'][number])) {
      result.push(normalized as StoryDirective['requiredLayer1Agents'][number]);
    }
  }

  return result;
}

function asRecordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isDirectiveInjectionText(value: string): boolean {
  return STORY_DIRECTIVE_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * StoryKernel 依赖的 Repository 集合（S6: 替代原 db?: Knex）。
 * 所有 repos 为可选——未注入时节奏引擎回退到默认值（与原 db=undefined 行为一致）。
 */
export interface StoryKernelRepos {
  pacing: IPacingRepository;
  pacingHistory: IPacingHistoryRepository;
  storyEvent: IStoryEventRepository;
  character: ICharacterRepository;
  quest: IQuestRepository;
  questObjective: IQuestObjectiveRepository;
}

export class StoryKernel {
  /** 标记是否因 reviewPacing 发现严重问题需要重新生成配置 */
  private needsConfigRegeneration = false;

  private static readonly DEFAULT_PACING_CONFIG: PacingConfig = {
    tensionRange: { min: 20, max: 80 },
    tensionWeights: { combat: 0.30, threat: 0.25, resource: 0.20, info: 0.15, time: 0.10 },
    densityParams: { windowSize: 5, cooldownRounds: 2, rareBudget: 1, rareWindow: 10 },
    progressParams: { sigmoidK: 0.1, sigmoidT0: 25 },
    stageThresholds: { exposition: 20, rising: 40, climax: 70, falling: 50, resolution: 30 },
    pacingInterval: 5,
    generatedBy: 'default',
  };

  constructor(
    private readonly domain: StoryDomainPort,
    private readonly entityGraph?: EntityGraphPort,
    private readonly repos?: StoryKernelRepos,
    private readonly llmService?: LLMService,
  ) {}

  async prepareRequestContext(saveId: string): Promise<StoryRequestContext> {
    const snapshot = await this.domain.getSnapshot(saveId);
    const worldState = await this.safeGetWorldState(saveId);

    return {
      snapshot,
      projection: this.resolveProjection(snapshot),
      worldState,
    };
  }

  async saveStoryState(saveId: string, commit: StoryStateCommit): Promise<void> {
    await this.domain.saveStoryState(saveId, commit);
  }

  async addStoryEvent(saveId: string, event: StoryEventInput): Promise<void> {
    await this.domain.addStoryEvent(saveId, event);
  }

  buildInitialStoryState(masterPlan: StoryMasterPlan): StoryStateCommit {
    const projection = this.validateInitialProjection(masterPlan);
    const initialHooks = Array.isArray(masterPlan.initialHooks)
      ? masterPlan.initialHooks.filter((hook): hook is string => typeof hook === 'string' && hook.trim().length > 0)
      : [];

    // 提取角色画像和背景补充到 runtimeState 中持久化
    const runtimeState: Record<string, unknown> = {
      storyPhase: 'opening',
      activeHooks: initialHooks,
      masterPlan,
    };

    // 持久化角色画像——后续轮次 story-orchestration 需要用它来匹配故事方向
    if (masterPlan.characterAnalysis) {
      runtimeState.characterProfile = masterPlan.characterAnalysis;
    }

    // 持久化角色背景补充
    if (masterPlan.characterBackgroundSupplement &&
        masterPlan.characterBackgroundSupplement.trim().length > 0) {
      runtimeState.characterBackgroundSupplement = masterPlan.characterBackgroundSupplement;
    }

    return {
      runtimeState,
      projection,
    };
  }

  buildStoryDirectiveFactSheet(storyDirective?: StoryDirective | null): string {
    return buildStoryDirectiveFactSheet(storyDirective);
  }

  /**
   * 从 StoryRuntimeState 构建角色上下文字符串，供 story-orchestration 和 GM 使用。
   * 包含角色画像、背景补充和角色驱动故事的设计指引。
   */
  buildCharacterContext(runtimeState: Record<string, unknown>): string {
    const parts: string[] = [];

    const profile = runtimeState.characterProfile as CharacterProfile | undefined;
    if (profile) {
      parts.push('## 角色画像');
      parts.push(`- 特质总结: ${profile.traitSummary || '未知'}`);
      parts.push(`- 核心优势: ${profile.dominantStrength || '未知'}`);
      parts.push(`- 核心弱点: ${profile.coreWeakness || '未知'}`);
      parts.push(`- 个人动机: ${profile.personalMotivation || '未知'}`);
      parts.push(`- 核心冲突: ${profile.potentialConflict || '未知'}`);
    }

    const bgSupplement = runtimeState.characterBackgroundSupplement as string | undefined;
    if (bgSupplement && bgSupplement.trim().length > 0) {
      parts.push('');
      parts.push('## 角色背景补充');
      parts.push(bgSupplement);
    }

    if (parts.length === 0) {
      return '';
    }

    parts.push('');
    parts.push('## 角色驱动叙事指引');
    parts.push('- 故事线必须与角色的个人动机和核心冲突绑定，不跑题');
    parts.push('- 关键决策节点应考验角色的核心弱点，制造成长机会');
    parts.push('- 高光时刻应让角色发挥核心优势，体现种族/职业特质');
    parts.push('- 角色背景补充中的钩子应在适当时机激活');

    return parts.join('\n');
  }

  buildUnifiedPostReviewFactSheet(postReviewDecision?: UnifiedPostReviewDecision | null): string {
    return buildUnifiedPostReviewFactSheet(postReviewDecision);
  }

  buildRecordUploadStoryEvent(
    requestContext: StoryRequestContext,
    postReviewDecision?: UnifiedPostReviewDecision | null,
    projectionOverride?: StoryProjection,
  ): StoryEventInput | null {
    const summary = summarizeUnifiedPostReviewDecision(postReviewDecision);
    const recordUploadDecision = summary.recordUploadDecision;
    if (!recordUploadDecision?.shouldUpload) {
      return null;
    }

    const eventSummary = recordUploadDecision.eventSummary;
    if (!eventSummary) {
      return null;
    }

    const currentProjection = projectionOverride ?? this.resolveProjection(requestContext.snapshot);
    return {
      event_type: 'major_record',
      title: eventSummary,
      description: recordUploadDecision.reason ?? eventSummary,
      importance: 'critical',
      chapter: currentProjection.chapter ?? requestContext.projection.chapter ?? '',
      participants: [],
      impact: {
        source: 'post_review',
        storyConsistency: summary.storyReview?.storyConsistency ?? null,
      },
    };
  }

  buildRuntimeStoryStateCommit(
    requestContext: StoryRequestContext,
    input: StoryRuntimeCommitInput,
  ): StoryStateCommit {
    const currentState = this.asRecord(requestContext.snapshot.context.agentContext?.state);
    const currentRuntimeState = this.asRecord(currentState.runtimeState);
    const currentProjection = requestContext.projection ?? this.resolveProjection(requestContext.snapshot);
    const directiveSummary = input.storyDirective
      ? summarizeStoryDirective(input.storyDirective)
      : null;
    const previousDirectiveSummary = this.asRecord(currentRuntimeState.lastStoryDirective);
    const previousPostReviewDecision = this.normalizeUnifiedPostReviewDecision(currentRuntimeState.lastPostReviewDecision);
    const nextPostReviewDecision = this.normalizeUnifiedPostReviewDecision(input.postReviewDecision);
    const currentHooks = sanitizeStringArray(currentRuntimeState.activeHooks);
    const nextHooks = directiveSummary?.hooks?.questSeeds ?? [];
    const previousPostReactTraceSummary = this.normalizePostReactTraceSummary(currentRuntimeState.lastPostReactTraceSummary);
    const nextPostReactTraceSummary = this.normalizePostReactTraceSummary(input.postReactTraceSummary);
    const projection: StoryProjection = {
      chapter: directiveSummary?.projection.chapter ?? currentProjection.chapter,
      mainQuest: directiveSummary?.projection.mainQuest ?? currentProjection.mainQuest,
    };

    // 角色画像修正：从 storyDirective 中提取（story-orchestration LLM 直接输出在 directive 中）
    const profileRevision: CharacterProfileRevision | null =
      (input.storyDirective?.characterProfileRevision as CharacterProfileRevision) ?? null;

    return {
      runtimeState: {
        ...currentRuntimeState,
        activeHooks: Array.from(new Set([...currentHooks, ...nextHooks])),
        lastStoryDirective: directiveSummary ?? (
          Object.keys(previousDirectiveSummary).length > 0 ? previousDirectiveSummary : undefined
        ),
        lastResolvedLayer1Agents: sanitizeLayer1Agents(input.resolvedLayer1Agents),
        lastWriteToolTypes: sanitizeStringArray(input.writeToolTypes),
        lastNeedAgentReasons: sanitizeStringArray(input.needAgentReasons),
        lastPostReviewDecision: nextPostReviewDecision ?? previousPostReviewDecision ?? undefined,
        lastPostReactTraceSummary: nextPostReactTraceSummary ?? previousPostReactTraceSummary ?? undefined,
        lastRepairRoundCount:
          nextPostReactTraceSummary?.repairRoundCount
          ?? previousPostReactTraceSummary?.repairRoundCount
          ?? currentRuntimeState.lastRepairRoundCount,
        lastStoryStateUpdatedAt: Date.now(),
        // 角色画像增量修正：合并本轮修正到 characterProfile
        characterProfile: this.mergeCharacterProfile(
          currentRuntimeState.characterProfile as CharacterProfile | undefined,
          profileRevision,
        ),
        // 累积修正历史
        characterProfileRevisions: this.appendRevisionHistory(
          currentRuntimeState.characterProfileRevisions as CharacterProfileRevision[] | undefined,
          profileRevision,
        ),
      },
      projection,
    };
  }

  /**
   * 增量合并角色画像修正。只更新 revision 中提供的字段，保留未提供的字段。
   * revision 为 null 时原样返回 current。
   */
  private mergeCharacterProfile(
    current: CharacterProfile | undefined,
    revision: CharacterProfileRevision | null,
  ): CharacterProfile | undefined {
    if (!revision) return current;
    if (!current) return undefined;

    return {
      traitSummary: revision.traitSummary ?? current.traitSummary,
      dominantStrength: revision.dominantStrength ?? current.dominantStrength,
      coreWeakness: revision.coreWeakness ?? current.coreWeakness,
      personalMotivation: revision.personalMotivation ?? current.personalMotivation,
      potentialConflict: revision.potentialConflict ?? current.potentialConflict,
    };
  }

  /**
   * 追加修正到历史记录。无修正时原样返回。
   */
  private appendRevisionHistory(
    history: CharacterProfileRevision[] | undefined,
    revision: CharacterProfileRevision | null,
  ): CharacterProfileRevision[] | undefined {
    if (!revision) return history;
    return [...(history ?? []), revision];
  }

  normalizeStoryDirective(directive: unknown, fallbackProjection?: StoryProjection): StoryDirective {
    const directiveRecord = this.asRecord(directive);
    const projectionRecord = this.asRecord(directiveRecord.projection);
    const normalizedProjection: StoryProjection = {
      chapter: typeof projectionRecord.chapter === 'string'
        ? projectionRecord.chapter.trim() || null
        : fallbackProjection?.chapter ?? null,
      mainQuest: typeof projectionRecord.mainQuest === 'string'
        ? projectionRecord.mainQuest.trim() || null
        : fallbackProjection?.mainQuest ?? null,
    };

    const requiredLayer1Agents = this.normalizeLayer1Agents(directiveRecord.requiredLayer1Agents);
    const optionalLayer1Agents = this.normalizeLayer1Agents(
      directiveRecord.optionalLayer1Agents,
      new Set(requiredLayer1Agents),
    );

    const normalized: StoryDirective = {
      storyGoal: this.normalizeOptionalString(directiveRecord.storyGoal),
      playerFacingObjective: this.normalizeOptionalString(directiveRecord.playerFacingObjective),
      todoList: this.sanitizeStringArray(directiveRecord.todoList, 7),
      requiredLayer1Agents,
      optionalLayer1Agents,
      dialogueFocus: this.asRecord(directiveRecord.dialogueFocus),
      constraints: this.asRecord(directiveRecord.constraints),
      hooks: this.asRecord(directiveRecord.hooks),
      projection: normalizedProjection,
    };

    // 净化 events 字段
    if (directiveRecord.events && typeof directiveRecord.events === 'object') {
      const rawEvents = directiveRecord.events as Record<string, unknown>;
      normalized.events = {
        checkTriggers: this.sanitizeTriggerTypes(rawEvents.checkTriggers),
        scheduleEvents: this.sanitizeStringArray(rawEvents.scheduleEvents, 5),
        recordStoryEvent: typeof rawEvents.recordStoryEvent === 'boolean'
          ? rawEvents.recordStoryEvent
          : false,
      };
    }

    return normalized;
  }

  normalizeUnifiedPostReviewDecision(decision: unknown): UnifiedPostReviewDecision | null {
    const rawDecision = asRecordValue(decision);
    const summary = summarizeUnifiedPostReviewDecision(decision);
    const normalizedContinuityAudit = this.normalizeContinuityAudit(rawDecision.continuityAudit);
    const normalizedTodoCompletion = this.normalizeTodoCompletion(rawDecision.todoCompletion);

    if (!hasMeaningfulUnifiedPostReviewDecision(summary) && !normalizedContinuityAudit && !normalizedTodoCompletion) {
      return null;
    }
    if (summary.secondLayerDecision?.shouldSchedule && (!summary.secondLayerDecision.agents || summary.secondLayerDecision.agents.length === 0)) {
      return null;
    }

    const rawSecondLayer = asRecordValue(rawDecision.secondLayerDecision);

    return {
      taskReview: summary.taskReview
        ? {
          completion: summary.taskReview.completion,
          missingRequirements: summary.taskReview.missingRequirements ?? [],
          qualityVerifications: [],
        }
        : undefined,
      storyReview: summary.storyReview
        ? {
          storyConsistency: summary.storyReview.storyConsistency,
          progressDelta: summary.storyReview.progressDelta,
          reviewFocus: summary.storyReview.reviewFocus ?? [],
        }
        : undefined,
      continuityAudit: normalizedContinuityAudit,
      todoCompletion: normalizedTodoCompletion,
      secondLayerDecision: summary.secondLayerDecision
        ? {
          shouldSchedule: summary.secondLayerDecision.shouldSchedule,
          reason: summary.secondLayerDecision.reason,
          agents: summary.secondLayerDecision.agents ?? [],
          constraints: {
            mustReveal: summary.secondLayerDecision.constraints?.mustReveal ?? [],
            mustHide: summary.secondLayerDecision.constraints?.mustHide ?? [],
            avoid: summary.secondLayerDecision.constraints?.avoid ?? [],
          },
          needsDynamicUI: rawSecondLayer.needsDynamicUI === true || undefined,
          dynamicUIScenario: typeof rawSecondLayer.dynamicUIScenario === 'string' && rawSecondLayer.dynamicUIScenario.trim()
            ? rawSecondLayer.dynamicUIScenario.trim()
            : undefined,
          dynamicUIReason: typeof rawSecondLayer.dynamicUIReason === 'string' && rawSecondLayer.dynamicUIReason.trim()
            ? rawSecondLayer.dynamicUIReason.trim()
            : undefined,
        }
        : undefined,
      recordUploadDecision: summary.recordUploadDecision
        ? {
          shouldUpload: summary.recordUploadDecision.shouldUpload,
          reason: summary.recordUploadDecision.reason,
          eventSummary: summary.recordUploadDecision.eventSummary,
        }
        : undefined,
    };
  }

  private resolveProjection(snapshot: StoryRequestContext['snapshot']): StoryProjection {
    const state = snapshot.context.agentContext?.state;
    if (state && typeof state === 'object') {
      const projection = (state as Record<string, unknown>).projection;
      if (projection && typeof projection === 'object') {
        const projectionRecord = projection as Record<string, unknown>;

        return {
          chapter: typeof projectionRecord.chapter === 'string' ? projectionRecord.chapter : null,
          mainQuest: typeof projectionRecord.mainQuest === 'string' ? projectionRecord.mainQuest : null,
        };
      }
    }

    return {
      chapter: snapshot.chapter.chapter ?? null,
      mainQuest: snapshot.chapter.mainQuest ?? null,
    };
  }

  private validateInitialProjection(masterPlan: StoryMasterPlan): StoryProjection {
    let chapter = '';
    let mainQuest = '';

    const ip = masterPlan.initialProjection;
    if (ip && typeof ip === 'object') {
      chapter = typeof ip.chapter === 'string' ? ip.chapter.trim() : '';
      mainQuest = typeof ip.mainQuest === 'string' ? ip.mainQuest.trim() : '';
    }

    if (!chapter) {
      const topChapter = (masterPlan as Record<string, unknown>).chapter;
      chapter = typeof topChapter === 'string' ? topChapter.trim() : '';
    }
    if (!mainQuest) {
      const topMainQuest = (masterPlan as Record<string, unknown>).mainQuest;
      mainQuest = typeof topMainQuest === 'string' ? topMainQuest.trim() : '';
    }

    if (!chapter || !mainQuest) {
      throw new Error(
        `StoryMasterPlan 缺少初始主线投影: chapter="${chapter}", mainQuest="${mainQuest}". ` +
        `LLM output keys: ${Object.keys(masterPlan).join(', ')}`
      );
    }

    return { chapter, mainQuest };
  }

  private normalizeLayer1Agents(value: unknown, excluded?: Set<string>): StoryDirective['requiredLayer1Agents'] {
    return sanitizeLayer1Agents(value, excluded);
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized || undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private async safeGetWorldState(saveId: string): Promise<StoryRequestContext['worldState']> {
    if (!this.entityGraph) return undefined;
    try {
      return await this.entityGraph.getWorldStateSummary(saveId);
    } catch {
      return undefined;
    }
  }

  async getEntitySubgraph(saveId: string, entityType: string, entityId: string, depth = 1): Promise<StoryRequestContext['worldState'] | null> {
    if (!this.entityGraph) return null;
    const centerNodeId = buildEntityNodeId(entityType, saveId, entityId);
    const subgraph = await this.entityGraph.getSubgraph(saveId, centerNodeId, depth);
    if (!subgraph) return null;
    return {
      nodeCount: subgraph.nodes.length,
      edgeCount: subgraph.edges.length,
      nodesByType: subgraph.nodes.reduce<Record<string, number>>((acc, n) => {
        acc[n.entityType] = (acc[n.entityType] ?? 0) + 1;
        return acc;
      }, {}),
      edgesByRelation: subgraph.edges.reduce<Record<string, number>>((acc, e) => {
        acc[e.relation] = (acc[e.relation] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }

  /**
   * 处理触发器解决事件 — 上行桥接入口
   * 当EventService的resolveTrigger产生归档事件时，通过EventBus通知StoryKernel
   */
  async onTriggerResolved(event: BusEvent): Promise<void> {
    const data = event.data as {
      triggerId?: string;
      eventId?: string;
      archivedStoryEvent?: Pick<StoryEventRecord, 'importance' | 'chapter' | 'eventType' | 'title'>;
    };
    if (!data.archivedStoryEvent) return;

    const snapshot = await this.domain.getSnapshot(event.saveId);
    if (!snapshot) return;

    const currentProjection = this.resolveProjection(snapshot);
    const updatedProjection = this.updateProjectionFromEvent(currentProjection, data.archivedStoryEvent);

    await this.domain.saveStoryState(event.saveId, {
      runtimeState: this.extractRuntimeState(snapshot),
      projection: updatedProjection,
    });
  }

  /**
   * 处理故事进展事件 — story_progress订阅回调
   */
  async onStoryProgress(event: BusEvent): Promise<void> {
    const data = event.data as {
      chapter?: string | null;
      mainQuest?: string | null;
      delta?: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
    };
    const snapshot = await this.domain.getSnapshot(event.saveId);
    if (!snapshot) return;

    const currentProjection = this.resolveProjection(snapshot);
    const updatedProjection: StoryProjection = {
      chapter: data.chapter ?? currentProjection.chapter,
      mainQuest: data.mainQuest ?? currentProjection.mainQuest,
    };

    // delta 记录变更日志，当前 StoryProjection 仅含 chapter/mainQuest，
    // 后续扩展投影字段时可基于 delta 做更精细更新

    await this.domain.saveStoryState(event.saveId, {
      runtimeState: this.extractRuntimeState(snapshot),
      projection: updatedProjection,
    });
  }

  /**
   * 根据事件更新故事投影
   */
  private updateProjectionFromEvent(
    current: StoryProjection,
    storyEvent: Pick<StoryEventRecord, 'importance' | 'chapter' | 'eventType' | 'title'>
  ): StoryProjection {
    if (storyEvent.importance === 'critical' && storyEvent.chapter) {
      return {
        chapter: storyEvent.chapter,
        mainQuest: current.mainQuest,
      };
    }

    if (storyEvent.importance === 'major' && storyEvent.eventType === 'quest') {
      return {
        chapter: current.chapter,
        mainQuest: storyEvent.title,
      };
    }

    return current;
  }

  private extractRuntimeState(snapshot: { context: { agentContext: Record<string, unknown> | null } }): StoryRuntimeState {
    const state = this.asRecord(snapshot.context?.agentContext?.state);
    return (state?.runtimeState as StoryRuntimeState) ?? {};
  }

  private sanitizeTriggerTypes(values: unknown): TriggerType[] | undefined {
    const VALID_TRIGGER_TYPES: TriggerType[] = [
      'enter_location', 'combat_end', 'combat_start',
      'quest_complete', 'quest_fail', 'time_reached',
      'relation_change', 'low_health', 'discover_location'
    ];
    if (!Array.isArray(values)) return undefined;
    const filtered = values.filter((v): v is TriggerType => VALID_TRIGGER_TYPES.includes(v as TriggerType));
    return filtered.length > 0 ? filtered : undefined;
  }

  private sanitizeStringArray(values: unknown, limit: number): string[] | undefined {
    if (!Array.isArray(values)) return undefined;
    const filtered = values.filter((v): v is string => typeof v === 'string');
    return filtered.length > 0 ? filtered.slice(0, limit) : undefined;
  }

  private normalizeContinuityAudit(
    value: unknown,
  ): UnifiedPostReviewDecision['continuityAudit'] | undefined {
    const auditRecord = this.asRecord(value);
    if (Object.keys(auditRecord).length === 0) {
      return undefined;
    }

    const issues = Array.isArray(auditRecord.issues)
      ? auditRecord.issues.flatMap((issue): NonNullable<UnifiedPostReviewDecision['continuityAudit']>['issues'] => {
        const issueRecord = this.asRecord(issue);
        const dimension = issueRecord.dimension;
        const severity = issueRecord.severity;
        const problem = this.normalizeOptionalString(issueRecord.problem);
        const expectedValue = this.normalizeOptionalString(issueRecord.expectedValue);
        const actualValue = this.normalizeOptionalString(issueRecord.actualValue);
        const suggestion = this.normalizeOptionalString(issueRecord.suggestion);

        if (
          (dimension !== 'npc_location' && dimension !== 'item_ownership' && dimension !== 'numeric_range' && dimension !== 'timeline' && dimension !== 'pacing')
          || (severity !== 'error' && severity !== 'warning')
          || !problem
          || !expectedValue
          || !actualValue
          || !suggestion
        ) {
          return [];
        }

        return [{
          dimension,
          severity,
          problem,
          expectedValue,
          actualValue,
          suggestion,
        }];
      })
      : [];

    const passed = typeof auditRecord.passed === 'boolean'
      ? auditRecord.passed
      : issues.every(issue => issue.severity !== 'error');

    if (issues.length === 0 && typeof auditRecord.passed !== 'boolean') {
      return undefined;
    }

    return {
      issues,
      passed,
    };
  }

  private normalizeTodoCompletion(
    value: unknown,
  ): UnifiedPostReviewDecision['todoCompletion'] | undefined {
    const todoRecord = this.asRecord(value);
    if (Object.keys(todoRecord).length === 0) {
      return undefined;
    }

    const overallCompletion = sanitizeCompletion(todoRecord.overallCompletion);
    const completedItems = sanitizeStringArray(todoRecord.completedItems);
    const incompleteItems = sanitizeStringArray(todoRecord.incompleteItems);

    if (!overallCompletion && !completedItems?.length && !incompleteItems?.length) {
      return undefined;
    }

    return {
      completedItems: completedItems ?? [],
      incompleteItems: incompleteItems ?? [],
      overallCompletion: overallCompletion ?? 'partial',
    };
  }

  private normalizePostReactTraceSummary(value: unknown): StoryPostReactDevtoolsTrace | undefined {
    const traceRecord = this.asRecord(value);
    if (Object.keys(traceRecord).length === 0) {
      return undefined;
    }

    const decisionSummaryRecord = this.asRecord(traceRecord.decisionSummary);
    const runtimeCommitSummaryRecord = this.asRecord(traceRecord.runtimeCommitSummary);
    const todoCompletion = decisionSummaryRecord.todoCompletion;
    const auditPassed = decisionSummaryRecord.auditPassed;
    const auditRootCause = decisionSummaryRecord.auditRootCause;
    const storyConsistency = decisionSummaryRecord.storyConsistency;

    return {
      phase: 'post-react',
      repairRoundCount:
        typeof traceRecord.repairRoundCount === 'number' && traceRecord.repairRoundCount >= 0
          ? traceRecord.repairRoundCount
          : 0,
      requiresRepair: traceRecord.requiresRepair === true,
      decisionSummary: {
        storyConsistency:
          storyConsistency === 'consistent'
          || storyConsistency === 'partial_match'
          || storyConsistency === 'mismatch'
            ? storyConsistency
            : undefined,
        todoCompletion:
          todoCompletion === 'complete'
          || todoCompletion === 'partial'
          || todoCompletion === 'failed'
          || todoCompletion === 'missing'
            ? todoCompletion
            : undefined,
        auditPassed: typeof auditPassed === 'boolean' ? auditPassed : undefined,
        auditRootCause:
          auditRootCause === 'context_injection_error'
          || auditRootCause === 'llm_understanding_error'
          || auditRootCause === 'data_missing'
          || auditRootCause === 'tool_execution_failure'
            ? auditRootCause
            : undefined,
        secondLayerDecisionValid: decisionSummaryRecord.secondLayerDecisionValid === true,
      },
      repairReasons: sanitizeStringArray(traceRecord.repairReasons) ?? [],
      resolvedLayer1Agents: sanitizeLayer1Agents(traceRecord.resolvedLayer1Agents),
      needAgentReasons: sanitizeStringArray(traceRecord.needAgentReasons) ?? [],
      runtimeCommitSummary: {
        wrotePostReviewDecision: runtimeCommitSummaryRecord.wrotePostReviewDecision === true,
        wroteContinuityAudit: runtimeCommitSummaryRecord.wroteContinuityAudit === true,
        wroteTodoCompletion: runtimeCommitSummaryRecord.wroteTodoCompletion === true,
        wroteRepairMetadata: runtimeCommitSummaryRecord.wroteRepairMetadata === true,
      },
    };
  }

  // ========== 节奏引擎方法 ==========

  /** 节奏引擎是否启用 */
  isPacingEnabled(): boolean {
    return !!(this.repos && this.llmService);
  }

  /** 计算节奏状态（在 generateStoryDirective 前调用） */
  async computePacingState(
    saveId: string,
    worldState: WorldStateSummary | undefined,
    storySnapshot: StorySnapshot,
    _projection: StoryProjection,
    templateContext?: string,
  ): Promise<PacingState> {
    const config = await this.getOrCreatePacingConfig(saveId, templateContext);

    // 从 pacing_history 获取当前轮次
    const roundNumber = await this.incrementRoundNumber(saveId);
    const isCalculationRound = roundNumber % config.pacingInterval === 0;

    let tension: number;
    let factors: TensionFactors;
    let llmAdjustedValue: number | undefined;
    let adjustmentReason: string | undefined;
    let lastCalculationRound = roundNumber;
    let deterministicTension: number | undefined;

    // 提前获取上一轮记录（非计算轮复用 + 趋势判定都需要）
    const lastRecord = await this.getLastPacingRecord(saveId);
    const previousStage = lastRecord?.stage;

    if (isCalculationRound) {
      // 计算轮：执行确定性计算 + LLM修正
      const deterministic = await this.computeDeterministicTension(worldState, storySnapshot, config, saveId);
      tension = deterministic.tension;
      factors = deterministic.factors;
      deterministicTension = deterministic.tension;

      // 事件密度评估（确定性部分）
      const densityAssessment = await this.assessEventDensity(saveId, config);
      // 推进速度评估（确定性部分）
      const speedAssessment = await this.assessProgressSpeed(saveId, config);

      // 构建叙事上下文
      const recentHistory = await this.getRecentPacingHistory(saveId, 5);
      const narrativeContext = await this.buildNarrativeContext(saveId);

      // 统一 LLM 修正
      const correction = await this.correctPacingWithLLM(
        tension,
        densityAssessment.currentDensity,
        speedAssessment.deviation,
        factors,
        recentHistory,
        narrativeContext,
        this.determineStage(tension, config.stageThresholds, previousStage),
        densityAssessment.guidance,
        speedAssessment.guidance,
        config,
      );
      llmAdjustedValue = correction.adjustedTension;
      adjustmentReason = correction.reason;
      tension = llmAdjustedValue;
    } else {
      // 非计算轮：复用上次结果
      if (lastRecord) {
        tension = lastRecord.llmAdjustedValue ?? lastRecord.deterministicValue;
        factors = lastRecord.factors;
        lastCalculationRound = lastRecord.isCalculationRound
          ? lastRecord.roundNumber
          : await this.getLastCalculationRound(saveId);
      } else {
        // 无历史记录时执行一次计算
        const deterministic = await this.computeDeterministicTension(worldState, storySnapshot, config, saveId);
        tension = deterministic.tension;
        factors = deterministic.factors;
      }
    }

    const stage = this.determineStage(tension, config.stageThresholds, previousStage);

    // 获取主线任务进度
    const mainQuestProgress = await this.getMainQuestProgress(saveId);

    // 统计本轮事件数量
    const eventCount = await this.countRecentEvents(saveId);

    // 记录到 pacing_history
    await this.recordPacingHistory(saveId, {
      saveId,
      roundNumber,
      deterministicValue: deterministicTension ?? tension,
      llmAdjustedValue,
      adjustmentReason,
      factors,
      stage,
      eventCount,
      mainQuestProgress,
      isCalculationRound,
    });

    const pacingState: PacingState = {
      currentTension: tension,
      currentStage: stage,
      currentFactors: factors,
      roundNumber,
      isCalculationRound,
      lastCalculationRound,
      config,
    };

    // 发射节奏事件
    this.emitPacingEvents(saveId, pacingState, lastRecord?.stage, eventCount, mainQuestProgress);

    return pacingState;
  }

  /** 确定性紧张度计算 */
  private async computeDeterministicTension(
    worldState: WorldStateSummary | undefined,
    storySnapshot: StorySnapshot,
    config: PacingConfig,
    saveId: string,
  ): Promise<{ tension: number; factors: TensionFactors }> {
    const factors = await this.collectTensionFactors(worldState, storySnapshot, saveId);
    const { tensionWeights } = config;

    const weightedSum =
      factors.combat * tensionWeights.combat +
      factors.threat * tensionWeights.threat +
      factors.resource * tensionWeights.resource +
      factors.info * tensionWeights.info +
      factors.time * tensionWeights.time;

    // 钳制到 [0, 100] 绝对范围
    let tension = Math.round(
      Math.max(0, Math.min(100, weightedSum * 100)),
    );

    // 钳制到 tensionRange 配置范围（如 [20, 80]）
    tension = Math.round(
      Math.max(config.tensionRange.min, Math.min(config.tensionRange.max, tension)),
    );

    const { createChildLogger } = await import('../../utils/logger.js');
    createChildLogger('pacing').info('Deterministic tension computed', {
      factors,
      tension,
      tensionRange: config.tensionRange,
    });

    return { tension, factors };
  }

  /** 5维因子采集 */
  private async collectTensionFactors(
    worldState: WorldStateSummary | undefined,
    storySnapshot: StorySnapshot,
    saveId: string,
  ): Promise<TensionFactors> {
    const combat = this.assessCombatFactor(worldState);
    const threat = this.assessThreatFactor(worldState);
    const resource = await this.assessResourceFactor(saveId);
    // 006 升级：assessInfoFactor 改为异步 + 双维度加权（densityFactor 70% + spreadFactor 30%）
    const info = await this.assessInfoFactor(worldState, saveId, storySnapshot);
    const time = await this.assessTimeFactor(saveId);

    return {
      combat: this.clamp01(combat),
      threat: this.clamp01(threat),
      resource: this.clamp01(resource),
      info: this.clamp01(info),
      time: this.clamp01(time),
    };
  }

  /** 战斗强度因子 */
  private assessCombatFactor(worldState: WorldStateSummary | undefined): number {
    if (!worldState) return 0;

    // 检查 combat_states 节点
    const combatNodeCount = worldState.nodesByType?.['combat_states'] ?? 0;
    if (combatNodeCount > 0) return 0.7;

    // 检查战斗相关边
    const combatEdges = worldState.edgesByRelation?.['combat'] ?? 0;
    const attackEdges = worldState.edgesByRelation?.['attacking'] ?? 0;
    const combatEdgeTotal = combatEdges + attackEdges;
    if (combatEdgeTotal > 0) return Math.min(1.0, 0.3 + combatEdgeTotal * 0.1);

    return 0;
  }

  /** 威胁程度因子 */
  private assessThreatFactor(worldState: WorldStateSummary | undefined): number {
    if (!worldState) return 0;

    // 检查敌对 NPC 数量
    const hostileNpcCount = worldState.nodesByType?.['hostile_npc'] ?? 0;
    const enemyCount = worldState.nodesByType?.['enemy'] ?? 0;
    const totalHostile = hostileNpcCount + enemyCount;

    // 检查危险任务
    const dangerousQuestCount = worldState.edgesByRelation?.['dangerous_quest'] ?? 0;

    const hostileFactor = Math.min(1.0, totalHostile / 5);
    const questFactor = Math.min(1.0, dangerousQuestCount / 3);

    return Math.max(hostileFactor, questFactor);
  }

  /**
   * 信息揭示因子（006 升级：异步 + 双维度加权）。
   *
   * 期望效果（设计文档 §10）：
   *   - densityFactor（70% 权重）：story_event/reveals/secret 边数量归一化
   *   - spreadFactor（30% 权重）：NPC 群体对 mainQuest 的 awareness 覆盖率（线性归一化）
   *   - 合成：assessInfoFactor = densityFactor * 0.7 + spreadFactor * 0.3，clamp [0, 1]
   *
   * 双维度必要性：
   *   - 单纯 densityFactor 只反映"剧情揭示事件密度"，无法体现"NPC 群体对主线认知程度"
   *   - spreadFactor 补足"信息是否已扩散到 NPC 群体"维度，引导 GM 调用 set_awareness 扩散主线认知
   *
   * 数值示例：
   *   - densityFactor=0.5, spreadFactor=0.4 → 0.5*0.7 + 0.4*0.3 = 0.35 + 0.12 = 0.47
   *   - densityFactor=0, spreadFactor=0.8 → 0 + 0.24 = 0.24
   *   - densityFactor=1.0, spreadFactor=1.0 → 0.7 + 0.3 = 1.0
   */
  private async assessInfoFactor(
    worldState: WorldStateSummary | undefined,
    saveId: string,
    storySnapshot: StorySnapshot,
  ): Promise<number> {
    // densityFactor：故事相关边数量归一化（原 assessInfoFactor 逻辑）
    let densityFactor = 0;
    if (worldState) {
      const storyEdges = worldState.edgesByRelation?.['story_event'] ?? 0;
      const revealEdges = worldState.edgesByRelation?.['reveals'] ?? 0;
      const secretEdges = worldState.edgesByRelation?.['secret'] ?? 0;
      const infoEdgeTotal = storyEdges + revealEdges + secretEdges;
      densityFactor = Math.min(1.0, infoEdgeTotal / 5);
    }

    // spreadFactor：NPC 群体对 mainQuest 的 awareness 覆盖率
    const spreadFactor = await this.assessInfoSpreadFactor(worldState, saveId, storySnapshot);

    // 双维度加权合成
    return densityFactor * 0.7 + spreadFactor * 0.3;
  }

  /**
   * 信息扩散因子（006 升级新增）：NPC 群体对当前主线任务的 awareness 覆盖率。
   *
   * 期望效果（设计文档 §10）：
   *   - mainQuest 未设置 → 返回 0
   *   - NPC 总数为 0 → 返回 0
   *   - entityGraph Port 不可用 → 返回 0（不抛错）
   *   - 正常场景：coverage = awareNpcCount / npcCount，线性归一化（clamp [0, 1]）
   *   - minScore=1：任何 current_score >= 1 的 NPC 都计入 aware
   *   - countAwarenessByTopic 抛错 → 捕获并返回 0（不传播异常）
   *
   * 设计依据（项目记忆 2026-07-21 决策）：
   *   - 线性归一化（coverage = awareNpcCount / npcCount，非线性阈值）
   *   - 30% 权重（与 densityFactor 70% 配比，避免 spreadFactor 主导）
   *   - minScore=1（任何 current_score >= 1 的 NPC 都计入 aware，不要求深度认知）
   */
  private async assessInfoSpreadFactor(
    worldState: WorldStateSummary | undefined,
    saveId: string,
    storySnapshot: StorySnapshot,
  ): Promise<number> {
    // mainQuest 未设置 → 返回 0
    const mainQuestId = storySnapshot.context?.saveInfo?.main_quest;
    if (!mainQuestId) return 0;

    // NPC 总数为 0 → 返回 0
    const npcCount = worldState?.nodesByType?.['npc'] ?? 0;
    if (npcCount === 0) return 0;

    // entityGraph Port 不可用 → 返回 0
    if (!this.entityGraph) return 0;

    // countAwarenessByTopic 抛错 → 捕获并返回 0
    let awareNpcCount = 0;
    try {
      awareNpcCount = await this.entityGraph.countAwarenessByTopic(saveId, 'quest', mainQuestId);
    } catch (error) {
      const { createChildLogger } = await import('../../utils/logger.js');
      createChildLogger('pacing').warn('countAwarenessByTopic failed, fallback spreadFactor=0', {
        saveId,
        mainQuestId,
        error: getErrorMessage(error),
      });
      return 0;
    }

    // 线性归一化 coverage = awareNpcCount / npcCount
    return this.clamp01(awareNpcCount / npcCount);
  }

  /** 资源消耗因子（从 characters 表采集 HP/MP/金币消耗率） */
  private async assessResourceFactor(saveId: string): Promise<number> {
    if (!this.repos) return 0;

    try {
      const character = await this.repos.character.getResourceStatus(saveId);
      if (!character) return 0;

      // HP 消耗率：HP 越低消耗越大
      const maxHp = character.max_hp || 100;
      const hp = character.hp;
      const hpDepletion = maxHp > 0 ? 1 - hp / maxHp : 0;

      // MP 消耗率
      const maxMp = character.max_mp || 100;
      const mp = character.mp;
      const mpDepletion = maxMp > 0 ? 1 - mp / maxMp : 0;

      // HP<20% 或 MP<10% 时视为严重消耗
      const criticalDepletion = hpDepletion > 0.8 || mpDepletion > 0.9 ? 0.3 : 0;

      return Math.min(1.0, (hpDepletion + mpDepletion) / 2 + criticalDepletion);
    } catch {
      return 0;
    }
  }

  /** 时间压力因子（从 quests 表采集 time_limit 紧迫度） */
  private async assessTimeFactor(saveId: string): Promise<number> {
    if (!this.repos) return 0;

    try {
      // 查询有截止时间的活跃任务（time_limit > 0 表示限时任务，单位秒）
      const activeQuests = await this.repos.quest.getActiveTimeLimitedQuests(saveId);

      if (activeQuests.length === 0) return 0;

      const now = Date.now();
      let maxUrgency = 0;

      for (const quest of activeQuests) {
        const timeLimitSeconds = quest.time_limit;
        if (!timeLimitSeconds || timeLimitSeconds <= 0) continue;

        const createdAt = quest.created_at || now;
        const deadline = createdAt + timeLimitSeconds * 1000;
        const totalDuration = deadline - createdAt;
        if (totalDuration <= 0) continue;

        const remaining = deadline - now;
        const elapsedRatio = 1 - Math.max(0, remaining) / totalDuration;

        // 已过截止时间 → 最大压力
        if (remaining <= 0) {
          maxUrgency = 1.0;
          break;
        }

        // 剩余时间不足20% → 高压力
        const urgency = Math.min(1.0, Math.max(0, elapsedRatio - 0.5) * 2);
        maxUrgency = Math.max(maxUrgency, urgency);
      }

      return maxUrgency;
    } catch {
      return 0;
    }
  }

  /** 节奏阶段判定（Freytag 五阶段映射，结合历史趋势） */
  private determineStage(tension: number, thresholds: StageThresholds, previousStage?: PacingStage): PacingStage {
    // 基于绝对紧张度的基本判定
    if (tension < thresholds.exposition) {
      // 低紧张度：可能是 exposition 或 resolution
      // 如果之前处于 falling，则进入 resolution
      return previousStage === 'falling' ? 'resolution' : 'exposition';
    }
    if (tension >= thresholds.climax) {
      return 'climax';
    }
    // 中间区间 [exposition, climax)：需要结合趋势判定
    if (previousStage === 'climax') {
      // 从高潮回落 → falling
      return 'falling';
    }
    if (previousStage === 'falling') {
      // 仍在回落区间 → 保持 falling（直到 tension < exposition 进入 resolution）
      return tension < thresholds.falling ? 'resolution' : 'falling';
    }
    if (previousStage === 'resolution') {
      // 从 resolution 重新上升 → rising
      return 'rising';
    }
    // 默认：exposition 或 rising 区间
    return tension < thresholds.rising ? 'exposition' : 'rising';
  }

  /** 生成节奏约束（注入 StoryDirective） */
  generatePacingConstraints(
    pacingState: PacingState,
    densityAssessment: DensityAssessment,
    speedAssessment: SpeedAssessment,
  ): PacingConstraints {
    return {
      tension: pacingState.currentTension,
      stage: pacingState.currentStage,
      densityGuidance: densityAssessment.guidance,
      speedGuidance: speedAssessment.guidance,
      maxEventDensity: densityAssessment.currentDensity > 0
        ? Math.ceil(densityAssessment.currentDensity * 1.5)
        : undefined,
      cooldownTypes: densityAssessment.cooldownTypes.length > 0
        ? densityAssessment.cooldownTypes
        : undefined,
    };
  }

  /** 节奏审查（PostReview 中调用） */
  async reviewPacing(saveId: string, pacingState: PacingState): Promise<PacingReviewResult> {
    if (!this.repos) {
      return {
        tensionConsistent: true,
        consecutiveHighPressure: false,
        consecutiveLowPressure: false,
        progressDeviation: 0,
        suggestions: [],
      };
    }

    const records = await this.getRecentPacingHistory(saveId, 10);
    const { stageThresholds } = pacingState.config;

    // 连续高压检查：连续3+轮 tension > climax 阈值
    let consecutiveHighCount = 0;
    for (let i = records.length - 1; i >= 0; i--) {
      const tension = records[i].llmAdjustedValue ?? records[i].deterministicValue;
      if (tension > stageThresholds.climax) {
        consecutiveHighCount++;
      } else {
        break;
      }
    }
    const consecutiveHighPressure = consecutiveHighCount >= 3;

    // 连续低压检查：连续5+轮 tension < exposition 阈值
    let consecutiveLowCount = 0;
    for (let i = records.length - 1; i >= 0; i--) {
      const tension = records[i].llmAdjustedValue ?? records[i].deterministicValue;
      if (tension < stageThresholds.exposition) {
        consecutiveLowCount++;
      } else {
        break;
      }
    }
    const consecutiveLowPressure = consecutiveLowCount >= 5;

    // 推进偏离检查
    const progressDeviation = this.calculateProgressDeviation(records, pacingState.config);

    // 紧张度与阶段是否匹配
    const tensionConsistent = !consecutiveHighPressure && !consecutiveLowPressure;

    // 生成修复建议
    const suggestions: string[] = [];
    if (consecutiveHighPressure) {
      suggestions.push('连续高压轮次过多，建议引入休息场景或降低威胁等级');
    }
    if (consecutiveLowPressure) {
      suggestions.push('连续低压轮次过多，建议引入新冲突或提高威胁等级');
    }
    if (Math.abs(progressDeviation) > 0.3) {
      suggestions.push(
        progressDeviation > 0
          ? '推进速度过快，建议增加支线内容或放慢节奏'
          : '推进速度过慢，建议聚焦主线或增加关键信息揭示',
      );
    }

    const result: PacingReviewResult = {
      tensionConsistent,
      consecutiveHighPressure,
      consecutiveLowPressure,
      progressDeviation,
      suggestions,
    };

    // 发射节奏审查告警事件 + 标记需要重新生成配置
    if (!tensionConsistent || Math.abs(progressDeviation) > 0.3) {
      // 严重节奏问题：标记下次 computePacingState 时重新生成配置
      this.needsConfigRegeneration = true;

      try {
        eventBus.emit('pacing:review_alert', {
          type: 'pacing:review_alert',
          saveId,
          data: result as unknown as Record<string, unknown>,
          timestamp: Date.now(),
        });
      } catch {
        // 事件发射失败不影响主流程
      }
    }

    return result;
  }

  /** 获取或创建 PacingConfig */
  private async getOrCreatePacingConfig(saveId: string, templateContext?: string): Promise<PacingConfig> {
    const defaultConfig = { ...StoryKernel.DEFAULT_PACING_CONFIG };

    if (!this.repos) return defaultConfig;

    // 查询数据库
    const row = await this.repos.pacing.getConfig(saveId);

    if (row) {
      const existingConfig = this.parsePacingConfigRow(row);

      // F-03: 距上次生成超过10轮时重新生成
      if (await this.shouldRegenerateConfig(saveId, existingConfig, templateContext)) {
        const regenerated = await this.regenerateConfig(saveId, existingConfig, templateContext);
        if (regenerated) return regenerated;
      }

      return existingConfig;
    }

    // 无记录：尝试 LLM 生成配置
    let config = defaultConfig;
    if (this.llmService) {
      try {
        const tc = templateContext;
        if (tc) {
          const llmConfig = await this.generatePacingConfigWithLLM(tc);
          config = this.deepMergePacingConfig(defaultConfig, llmConfig);
          config.generatedBy = 'llm';
        }
      } catch (error) {
        const logger = await import('../../utils/logger.js').then((m) => m.createChildLogger('pacing'));
        logger.warn('LLM pacing config generation failed, using defaults', {
          error: getErrorMessage(error),
        });
      }
    }

    // config/pacing.json 覆盖
    config = this.applyPacingJsonOverride(config);

    // 写入数据库
    await this.insertPacingConfig(saveId, config, templateContext);

    return config;
  }

  /** 判断是否需要重新生成配置 */
  private async shouldRegenerateConfig(saveId: string, _currentConfig: PacingConfig, templateContext?: string): Promise<boolean> {
    if (!this.repos) return false;

    // reviewPacing 发现严重问题时重新生成
    if (this.needsConfigRegeneration) {
      this.needsConfigRegeneration = false;
      const { createChildLogger } = await import('../../utils/logger.js');
      createChildLogger('pacing').info('Config regeneration triggered: reviewPacing flagged', { saveId });
      return true;
    }

    // F-04: templateContext 变更检测
    if (templateContext) {
      const templateContextHash = await this.repos.pacing.getTemplateContextHash(saveId);

      if (templateContextHash) {
        const currentHash = this.hashTemplateContext(templateContext);
        if (currentHash !== templateContextHash) {
          const { createChildLogger } = await import('../../utils/logger.js');
          createChildLogger('pacing').info('Config regeneration triggered: templateContext changed', { saveId });
          return true;
        }
      }
    }

    // F-03: 距上次生成超过10轮时重新生成
    const lastRecord = await this.getLastPacingRecord(saveId);
    if (!lastRecord) return false;

    // 查询配置的创建/更新时间
    const configUpdatedAt = await this.repos.pacing.getUpdatedAt(saveId);
    if (configUpdatedAt === null) return false;

    // 查找配置更新后经过了多少轮
    const roundsCount = await this.repos.pacingHistory.countSince(saveId, configUpdatedAt);

    if (roundsCount >= 10) {
      const { createChildLogger } = await import('../../utils/logger.js');
      createChildLogger('pacing').info('Config regeneration triggered: 10+ rounds since last update', { saveId, roundsCount });
      return true;
    }
    return false;
  }

  /** 计算 templateContext 的简单哈希（用于变更检测） */
  private hashTemplateContext(templateContext: string): string {
    let hash = 0;
    for (let i = 0; i < templateContext.length; i++) {
      const char = templateContext.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  /** 重新生成配置 */
  private async regenerateConfig(saveId: string, baseConfig: PacingConfig, templateContext?: string): Promise<PacingConfig | null> {
    if (!this.llmService || !templateContext || !this.repos) return null;

    try {
      const llmConfig = await this.generatePacingConfigWithLLM(templateContext);
      const newConfig = this.deepMergePacingConfig(baseConfig, llmConfig);
      newConfig.generatedBy = 'llm';

      // 应用 pacing.json 覆盖
      const finalConfig = this.applyPacingJsonOverride(newConfig);

      // 更新数据库
      await this.repos.pacing.update(saveId, {
        tension_range: JSON.stringify(finalConfig.tensionRange),
        tension_weights: JSON.stringify(finalConfig.tensionWeights),
        density_params: JSON.stringify(finalConfig.densityParams),
        progress_params: JSON.stringify(finalConfig.progressParams),
        stage_thresholds: JSON.stringify(finalConfig.stageThresholds),
        pacing_interval: finalConfig.pacingInterval,
        generated_by: finalConfig.generatedBy,
        template_context_hash: this.hashTemplateContext(templateContext),
      });

      return finalConfig;
    } catch {
      return null;
    }
  }

  /** LLM 生成节奏配置 */
  private async generatePacingConfigWithLLM(templateContext: string): Promise<Partial<PacingConfig>> {
    const promptTemplate = this.loadPacingPrompt('pacing-config-generation');
    if (!promptTemplate) return {};

    const userMessage = promptTemplate.replace('{templateAIConstraints}', templateContext);

    const llmResponse = await this.llmService!.chat(
      [
        { role: 'system', content: '根据模板约束生成节奏配置参数。仅输出JSON。' },
        { role: 'user', content: userMessage },
      ],
      {
        temperature: 0.3,
        maxTokens: 600,
        responseFormat: { type: 'json_object' },
      },
    );

    const content = llmResponse.content?.trim() || '';
    return this.parsePacingConfigFromLLM(content);
  }

  private parsePacingConfigFromLLM(content: string): Partial<PacingConfig> {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return {};

      const parsed = JSON.parse(jsonMatch[0]);
      const result: Partial<PacingConfig> = {};

      if (parsed.tensionRange && typeof parsed.tensionRange === 'object') {
        result.tensionRange = {
          min: typeof parsed.tensionRange.min === 'number' ? parsed.tensionRange.min : 20,
          max: typeof parsed.tensionRange.max === 'number' ? parsed.tensionRange.max : 80,
        };
      }

      if (parsed.tensionWeights && typeof parsed.tensionWeights === 'object') {
        const w = parsed.tensionWeights;
        result.tensionWeights = {
          combat: typeof w.combat === 'number' ? w.combat : 0.30,
          threat: typeof w.threat === 'number' ? w.threat : 0.25,
          resource: typeof w.resource === 'number' ? w.resource : 0.20,
          info: typeof w.info === 'number' ? w.info : 0.15,
          time: typeof w.time === 'number' ? w.time : 0.10,
        };
        // 确保权重总和为 1.0
        const sum = result.tensionWeights.combat + result.tensionWeights.threat +
          result.tensionWeights.resource + result.tensionWeights.info + result.tensionWeights.time;
        if (Math.abs(sum - 1.0) > 0.01) {
          const scale = 1.0 / sum;
          result.tensionWeights.combat *= scale;
          result.tensionWeights.threat *= scale;
          result.tensionWeights.resource *= scale;
          result.tensionWeights.info *= scale;
          result.tensionWeights.time *= scale;
        }
      }

      if (parsed.densityParams && typeof parsed.densityParams === 'object') {
        result.densityParams = {
          windowSize: typeof parsed.densityParams.windowSize === 'number' ? parsed.densityParams.windowSize : 5,
          cooldownRounds: typeof parsed.densityParams.cooldownRounds === 'number' ? parsed.densityParams.cooldownRounds : 2,
          rareBudget: typeof parsed.densityParams.rareBudget === 'number' ? parsed.densityParams.rareBudget : 1,
          rareWindow: typeof parsed.densityParams.rareWindow === 'number' ? parsed.densityParams.rareWindow : 10,
        };
      }

      if (parsed.progressParams && typeof parsed.progressParams === 'object') {
        result.progressParams = {
          sigmoidK: typeof parsed.progressParams.sigmoidK === 'number' ? parsed.progressParams.sigmoidK : 0.1,
          sigmoidT0: typeof parsed.progressParams.sigmoidT0 === 'number' ? parsed.progressParams.sigmoidT0 : 25,
        };
      }

      if (parsed.stageThresholds && typeof parsed.stageThresholds === 'object') {
        result.stageThresholds = {
          exposition: typeof parsed.stageThresholds.exposition === 'number' ? parsed.stageThresholds.exposition : 20,
          rising: typeof parsed.stageThresholds.rising === 'number' ? parsed.stageThresholds.rising : 40,
          climax: typeof parsed.stageThresholds.climax === 'number' ? parsed.stageThresholds.climax : 70,
          falling: typeof parsed.stageThresholds.falling === 'number' ? parsed.stageThresholds.falling : 50,
          resolution: typeof parsed.stageThresholds.resolution === 'number' ? parsed.stageThresholds.resolution : 30,
        };
      }

      if (typeof parsed.pacingInterval === 'number') {
        result.pacingInterval = Math.max(1, Math.min(10, parsed.pacingInterval));
      }

      return result;
    } catch {
      return {};
    }
  }

  /** 事件密度评估 */
  async assessEventDensity(saveId: string, config: PacingConfig): Promise<DensityAssessment> {
    if (!this.repos) {
      return { currentDensity: 0, guidance: 'maintain', cooldownTypes: [] };
    }

    const records = await this.getRecentPacingHistory(saveId, config.densityParams.windowSize);
    const eventCounts = records.map((r) => r.eventCount);
    const currentDensity = eventCounts.length > 0
      ? eventCounts.reduce((sum, c) => sum + c, 0) / eventCounts.length
      : 0;

    // 同类事件冷却检查：在 cooldownRounds 轮内重复出现的事件类型
    const cooldownTypes = await this.detectCooldownTypes(saveId, config.densityParams.cooldownRounds);

    // 高冲击事件预算检查：在 rareWindow 轮内，高冲击轮次（eventCount >= 3）不超过 rareBudget
    const rareWindowRecords = await this.getRecentPacingHistory(saveId, config.densityParams.rareWindow);
    const highImpactRounds = rareWindowRecords.filter((r) => r.eventCount >= 3).length;
    const rareBudgetExceeded = highImpactRounds > config.densityParams.rareBudget;

    let guidance: DensityAssessment['guidance'] = 'maintain';
    if (rareBudgetExceeded || currentDensity > config.densityParams.rareBudget * 2) {
      guidance = 'decrease';
    } else if (currentDensity < 0.5) {
      guidance = 'increase';
    }

    const { createChildLogger: createLogger1 } = await import('../../utils/logger.js');
    createLogger1('pacing').info('Event density assessed', {
      currentDensity, guidance, highImpactRounds, rareBudget: config.densityParams.rareBudget, rareBudgetExceeded,
    });

    return {
      currentDensity,
      guidance,
      cooldownTypes,
    };
  }

  /** 检测冷却期内重复出现的事件类型 */
  private async detectCooldownTypes(saveId: string, cooldownRounds: number): Promise<string[]> {
    if (!this.repos) return [];

    try {
      // 获取最近 cooldownRounds 轮的记录
      const recentRecords = await this.repos.pacingHistory.getRecentFactors(saveId, cooldownRounds);

      if (recentRecords.length < 2) return [];

      // 统计每个因子维度在冷却期内是否持续非零（表示同类事件持续发生）
      const cooldownTypes: string[] = [];
      const dimensionMap: Record<string, string> = {
        combat: 'combat',
        threat: 'threat',
        resource: 'resource',
        info: 'info',
        time: 'time',
      };

      for (const [key, type] of Object.entries(dimensionMap)) {
        const allActive = recentRecords.every((r) => {
          try {
            const factors = typeof r.factors === 'string' ? JSON.parse(r.factors) : r.factors;
            return factors[key] > 0.3;
          } catch {
            return false;
          }
        });
        if (allActive) {
          cooldownTypes.push(type);
        }
      }

      return cooldownTypes;
    } catch {
      return [];
    }
  }

  /** 推进速度评估 */
  async assessProgressSpeed(saveId: string, config: PacingConfig): Promise<SpeedAssessment> {
    if (!this.repos) {
      return { deviation: 0, guidance: 'maintain' };
    }

    const records = await this.getRecentPacingHistory(saveId, 10);
    const deviation = this.calculateProgressDeviation(records, config);

    let guidance: SpeedAssessment['guidance'] = 'maintain';
    if (deviation > 0.3) {
      guidance = 'decelerate';
    } else if (deviation < -0.3) {
      guidance = 'accelerate';
    }

    const { createChildLogger: createLogger2 } = await import('../../utils/logger.js');
    createLogger2('pacing').info('Progress speed assessed', { deviation, guidance });

    return { deviation, guidance };
  }

  /** 统一 LLM 修正调用（紧张度+密度+推进速度） */
  private async correctPacingWithLLM(
    tension: number,
    density: number,
    speedDeviation: number,
    factors: TensionFactors,
    history: PacingHistoryRecord[],
    narrativeContext: string,
    currentStage: PacingStage | undefined,
    deterministicDensityGuidance: 'increase' | 'decrease' | 'maintain' | undefined,
    deterministicSpeedGuidance: 'accelerate' | 'decelerate' | 'maintain' | undefined,
    config: PacingConfig,
  ): Promise<{
    adjustedTension: number;
    adjustedDensityGuidance: 'increase' | 'decrease' | 'maintain';
    adjustedSpeedGuidance: 'accelerate' | 'decelerate' | 'maintain';
    reason: string;
  }> {
    if (!this.llmService) {
      return {
        adjustedTension: tension,
        adjustedDensityGuidance: deterministicDensityGuidance ?? 'maintain',
        adjustedSpeedGuidance: deterministicSpeedGuidance ?? 'maintain',
        reason: 'LLM service not available',
      };
    }

    try {
      const promptTemplate = this.loadPacingPrompt('pacing-correction');
      if (!promptTemplate) {
        return {
          adjustedTension: tension,
          adjustedDensityGuidance: deterministicDensityGuidance ?? 'maintain',
          adjustedSpeedGuidance: deterministicSpeedGuidance ?? 'maintain',
          reason: 'Pacing correction prompt not found',
        };
      }

      const recentHistoryStr = history
        .slice(0, 5)
        .map((r) => `R${r.roundNumber}: tension=${r.llmAdjustedValue ?? r.deterministicValue}, stage=${r.stage}`)
        .join('\n');

      const userMessage = promptTemplate
        .replace('{deterministicTension}', String(tension))
        .replace('{factors}', JSON.stringify(factors))
        .replace('{currentStage}', currentStage ?? 'unknown')
        .replace('{deterministicDensityGuidance}', deterministicDensityGuidance ?? 'maintain')
        .replace('{deterministicSpeedGuidance}', deterministicSpeedGuidance ?? 'maintain')
        .replace('{currentDensity}', String(density))
        .replace('{speedDeviation}', String(speedDeviation))
        .replace('{recentHistory}', recentHistoryStr)
        .replace('{narrativeContext}', narrativeContext);

      const llmResponse = await this.llmService.chat(
        [
          { role: 'system', content: '根据数据修正节奏参数，严格遵循修正规则。仅输出JSON。' },
          { role: 'user', content: userMessage },
        ],
        {
          temperature: 0.2,
          maxTokens: 400,
          responseFormat: { type: 'json_object' },
        },
      );

      const content = llmResponse.content?.trim() || '';
      const parsed = this.parsePacingCorrectionResponse(content, tension, deterministicDensityGuidance, deterministicSpeedGuidance, config);
      return parsed;
    } catch (error) {
      const logger = await import('../../utils/logger.js').then((m) => m.createChildLogger('pacing'));
      logger.error('LLM pacing correction failed, falling back to deterministic values', {
        error: getErrorMessage(error),
      });
      return {
        adjustedTension: tension,
        adjustedDensityGuidance: deterministicDensityGuidance ?? 'maintain',
        adjustedSpeedGuidance: deterministicSpeedGuidance ?? 'maintain',
        reason: `LLM correction failed: ${getErrorMessage(error)}`,
      };
    }
  }

  private loadPacingPrompt(promptName: string): string | null {
    try {
      const CONFIG_DIR = process.env.AGENT_CONFIG_DIR || resolve(process.cwd(), 'config');
      const promptPath = resolve(CONFIG_DIR, 'agent-profiles', 'prompts', `${promptName}.md`);
      return readFileSync(promptPath, 'utf-8');
    } catch {
      return null;
    }
  }

  private parsePacingCorrectionResponse(
    content: string,
    deterministicTension: number,
    deterministicDensityGuidance?: 'increase' | 'decrease' | 'maintain',
    deterministicSpeedGuidance?: 'accelerate' | 'decelerate' | 'maintain',
    config?: PacingConfig,
  ): {
    adjustedTension: number;
    adjustedDensityGuidance: 'increase' | 'decrease' | 'maintain';
    adjustedSpeedGuidance: 'accelerate' | 'decelerate' | 'maintain';
    reason: string;
  } {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);

      // 紧张度修正：有界 ±20
      let adjustedTension = typeof parsed.adjustedTension === 'number' ? parsed.adjustedTension : deterministicTension;
      if (typeof parsed.adjustedTension !== 'number') {
        import('../../utils/logger.js').then((m) => m.createChildLogger('pacing'))
          .then((l) => l.warn('LLM returned non-number adjustedTension, falling back to deterministic', {
            returned: parsed.adjustedTension, deterministicTension,
          }));
      }
      const minTension = Math.max(0, deterministicTension - 20);
      const maxTension = Math.min(100, deterministicTension + 20);
      if (adjustedTension < minTension || adjustedTension > maxTension) {
        import('../../utils/logger.js').then((m) => m.createChildLogger('pacing'))
          .then((l) => l.warn('LLM adjustedTension out of ±20 bounds, clamping', {
            adjustedTension, deterministicTension, minTension, maxTension,
          }));
        adjustedTension = Math.max(minTension, Math.min(maxTension, adjustedTension));
      }

      // 钳制到 tensionRange 配置范围
      if (config?.tensionRange && (adjustedTension < config.tensionRange.min || adjustedTension > config.tensionRange.max)) {
        import('../../utils/logger.js').then((m) => m.createChildLogger('pacing'))
          .then((l) => l.warn('Adjusted tension out of tensionRange, clamping', {
            adjustedTension, tensionRange: config.tensionRange,
          }));
        adjustedTension = Math.round(
          Math.max(config.tensionRange.min, Math.min(config.tensionRange.max, adjustedTension)),
        );
      }

      // 密度指导修正：仅允许相邻档位调整
      const validDensityGuidances: Array<'increase' | 'decrease' | 'maintain'> = ['increase', 'decrease', 'maintain'];
      let adjustedDensityGuidance = validDensityGuidances.includes(parsed.adjustedDensityGuidance)
        ? parsed.adjustedDensityGuidance
        : (deterministicDensityGuidance ?? 'maintain');
      adjustedDensityGuidance = this.clampAdjacentGuidance(adjustedDensityGuidance, deterministicDensityGuidance ?? 'maintain');

      // 推进指导修正：仅允许相邻档位调整
      const validSpeedGuidances: Array<'accelerate' | 'decelerate' | 'maintain'> = ['accelerate', 'decelerate', 'maintain'];
      let adjustedSpeedGuidance = validSpeedGuidances.includes(parsed.adjustedSpeedGuidance)
        ? parsed.adjustedSpeedGuidance
        : (deterministicSpeedGuidance ?? 'maintain');
      adjustedSpeedGuidance = this.clampAdjacentSpeedGuidance(adjustedSpeedGuidance, deterministicSpeedGuidance ?? 'maintain');

      return {
        adjustedTension,
        adjustedDensityGuidance,
        adjustedSpeedGuidance,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'LLM correction applied',
      };
    } catch {
      return {
        adjustedTension: deterministicTension,
        adjustedDensityGuidance: deterministicDensityGuidance ?? 'maintain',
        adjustedSpeedGuidance: deterministicSpeedGuidance ?? 'maintain',
        reason: 'Failed to parse LLM correction response',
      };
    }
  }

  /** 密度指导相邻档位约束 */
  private clampAdjacentGuidance(
    adjusted: 'increase' | 'decrease' | 'maintain',
    deterministic: 'increase' | 'decrease' | 'maintain',
  ): 'increase' | 'decrease' | 'maintain' {
    if (adjusted === deterministic) return adjusted;
    // maintain 可以变为 increase 或 decrease
    // increase 只能变为 maintain
    // decrease 只能变为 maintain
    if (deterministic === 'maintain') return adjusted;
    if (adjusted === 'maintain') return adjusted;
    // increase→decrease 或 decrease→increase 不允许，回退到 deterministic
    return deterministic;
  }

  /** 推进指导相邻档位约束 */
  private clampAdjacentSpeedGuidance(
    adjusted: 'accelerate' | 'decelerate' | 'maintain',
    deterministic: 'accelerate' | 'decelerate' | 'maintain',
  ): 'accelerate' | 'decelerate' | 'maintain' {
    if (adjusted === deterministic) return adjusted;
    if (deterministic === 'maintain') return adjusted;
    if (adjusted === 'maintain') return adjusted;
    return deterministic;
  }

  // ========== 节奏引擎辅助方法 ==========

  /** 构建叙事上下文（用于 LLM 修正） */
  private async buildNarrativeContext(saveId: string): Promise<string> {
    if (!this.repos) return 'No narrative context available';

    try {
      // 取最近3轮 story_events 的 title + description 拼接
      const events = await this.repos.storyEvent.getRecentForNarrative(saveId, 3);

      if (events.length === 0) return 'No recent story events';

      const parts = events.map((e) => {
        const title = e.title || 'Untitled';
        const desc = e.description;
        return desc ? `${title}: ${desc}` : title;
      }).join('; ');

      return parts.slice(0, 500);
    } catch {
      return 'No narrative context available';
    }
  }

  /** 递增轮次计数器 */
  private async incrementRoundNumber(saveId: string): Promise<number> {
    if (!this.repos) return 1;

    const maxRound = await this.repos.pacingHistory.getMaxRoundNumber(saveId);
    return maxRound + 1;
  }

  /** 获取最后一条 pacing_history 记录 */
  private async getLastPacingRecord(saveId: string): Promise<PacingHistoryRecord | null> {
    if (!this.repos) return null;

    const row = await this.repos.pacingHistory.getLast(saveId);

    return row ? this.parsePacingHistoryRow(row) : null;
  }

  /** 获取上次计算轮的轮次号 */
  private async getLastCalculationRound(saveId: string): Promise<number> {
    if (!this.repos) return 0;

    const row = await this.repos.pacingHistory.getLastCalculationRound(saveId);

    return row?.round_number ?? 0;
  }

  /** 获取最近 N 条 pacing_history 记录 */
  private async getRecentPacingHistory(saveId: string, limit: number): Promise<PacingHistoryRecord[]> {
    if (!this.repos) return [];

    const rows = await this.repos.pacingHistory.getRecent(saveId, limit);

    return rows.map((row) => this.parsePacingHistoryRow(row));
  }

  /** 记录到 pacing_history */
  private async recordPacingHistory(saveId: string, record: Omit<PacingHistoryRecord, 'id' | 'createdAt'>): Promise<void> {
    if (!this.repos) return;

    await this.repos.pacingHistory.insert(saveId, {
      round_number: record.roundNumber,
      deterministic_value: record.deterministicValue,
      llm_adjusted_value: record.llmAdjustedValue ?? null,
      adjustment_reason: record.adjustmentReason ?? null,
      factors: JSON.stringify(record.factors),
      stage: record.stage,
      event_count: record.eventCount,
      main_quest_progress: record.mainQuestProgress ?? null,
      is_calculation_round: record.isCalculationRound ? 1 : 0,
    });

    // 清理超过 200 轮的旧记录
    await this.cleanOldPacingHistory(saveId);
  }

  /** 清理旧的 pacing_history 记录（保留最近 200 轮） */
  private async cleanOldPacingHistory(saveId: string): Promise<void> {
    if (!this.repos) return;

    await this.repos.pacingHistory.cleanOld(saveId, 200);
  }

  /** 计算推进偏离度 */
  private calculateProgressDeviation(records: PacingHistoryRecord[], config: PacingConfig): number {
    if (records.length === 0) return 0;

    const latestRecord = records[records.length - 1];
    const round = latestRecord.roundNumber;
    const { sigmoidK, sigmoidT0 } = config.progressParams;

    // Sigmoid 目标曲线: target = 100 / (1 + exp(-k * (round - t0)))
    const target = 100 / (1 + Math.exp(-sigmoidK * (round - sigmoidT0)));
    const actual = latestRecord.mainQuestProgress ?? 0;

    return (actual - target) / 100;
  }

  /** 解析 pacing_config 数据库行为 PacingConfig */
  private parsePacingConfigRow(row: PacingConfigRow): PacingConfig {
    return {
      tensionRange: JSON.parse(row.tension_range),
      tensionWeights: JSON.parse(row.tension_weights),
      densityParams: JSON.parse(row.density_params),
      progressParams: JSON.parse(row.progress_params),
      stageThresholds: JSON.parse(row.stage_thresholds),
      pacingInterval: row.pacing_interval,
      generatedBy: row.generated_by as PacingConfig['generatedBy'],
    };
  }

  /** 插入 pacing_config 到数据库 */
  private async insertPacingConfig(saveId: string, config: PacingConfig, templateContext?: string): Promise<void> {
    if (!this.repos) return;

    await this.repos.pacing.insert(saveId, {
      tension_range: JSON.stringify(config.tensionRange),
      tension_weights: JSON.stringify(config.tensionWeights),
      density_params: JSON.stringify(config.densityParams),
      progress_params: JSON.stringify(config.progressParams),
      stage_thresholds: JSON.stringify(config.stageThresholds),
      pacing_interval: config.pacingInterval,
      generated_by: config.generatedBy,
      template_context_hash: templateContext ? this.hashTemplateContext(templateContext) : null,
    });
  }

  /** 应用 config/pacing.json 覆盖 */
  private applyPacingJsonOverride(base: PacingConfig): PacingConfig {
    try {
      const configPath = resolve(process.cwd(), 'config', 'pacing.json');
      const content = readFileSync(configPath, 'utf-8');
      const override = JSON.parse(content) as Partial<PacingConfig>;
      return this.deepMergePacingConfig(base, override);
    } catch {
      // 文件不存在或解析失败，使用基础配置
      return base;
    }
  }

  /** 深合并 PacingConfig */
  private deepMergePacingConfig(base: PacingConfig, override: Partial<PacingConfig>): PacingConfig {
    return {
      tensionRange: override.tensionRange
        ? { ...base.tensionRange, ...override.tensionRange }
        : base.tensionRange,
      tensionWeights: override.tensionWeights
        ? { ...base.tensionWeights, ...override.tensionWeights }
        : base.tensionWeights,
      densityParams: override.densityParams
        ? { ...base.densityParams, ...override.densityParams }
        : base.densityParams,
      progressParams: override.progressParams
        ? { ...base.progressParams, ...override.progressParams }
        : base.progressParams,
      stageThresholds: override.stageThresholds
        ? { ...base.stageThresholds, ...override.stageThresholds }
        : base.stageThresholds,
      pacingInterval: override.pacingInterval ?? base.pacingInterval,
      generatedBy: Object.keys(override).length > 0 ? 'config' : base.generatedBy,
    };
  }

  /** 解析 pacing_history 数据库行为 PacingHistoryRecord */
  private parsePacingHistoryRow(row: PacingHistoryRow): PacingHistoryRecord {
    return {
      id: row.id,
      saveId: row.save_id,
      roundNumber: row.round_number,
      deterministicValue: row.deterministic_value,
      llmAdjustedValue: row.llm_adjusted_value ?? undefined,
      adjustmentReason: row.adjustment_reason ?? undefined,
      factors: JSON.parse(row.factors),
      stage: row.stage as PacingStage,
      eventCount: row.event_count ?? 0,
      mainQuestProgress: row.main_quest_progress ?? undefined,
      isCalculationRound: row.is_calculation_round === 1,
      createdAt: row.created_at,
    };
  }

  /** 发射节奏变化事件 */
  private emitPacingEvents(saveId: string, pacingState: PacingState, previousStage: PacingStage | undefined, eventCount: number, mainQuestProgress: number | undefined): void {
    try {
      // 紧张度变化事件
      eventBus.emit('pacing:tension_change', {
        type: 'pacing:tension_change',
        saveId,
        data: {
          tension: pacingState.currentTension,
          stage: pacingState.currentStage,
          factors: pacingState.currentFactors,
          roundNumber: pacingState.roundNumber,
          eventCount,
          mainQuestProgress,
        },
        timestamp: Date.now(),
      });

      // 阶段变化事件
      if (previousStage && previousStage !== pacingState.currentStage) {
        eventBus.emit('pacing:stage_change', {
          type: 'pacing:stage_change',
          saveId,
          data: {
            previousStage,
            currentStage: pacingState.currentStage,
            tension: pacingState.currentTension,
          },
          timestamp: Date.now(),
        });
      }
    } catch {
      // 事件发射失败不影响主流程
    }
  }

  /** 获取主线任务进度（0-100） */
  private async getMainQuestProgress(saveId: string): Promise<number | undefined> {
    if (!this.repos) return undefined;

    try {
      const questId = await this.repos.quest.getMainQuestId(saveId);
      if (!questId) return undefined;

      const objectives = await this.repos.questObjective.getProgressByQuestId(questId);
      if (objectives.length === 0) return 0;

      const totalRequired = objectives.reduce((sum, o) => sum + (o.required || 0), 0);
      const totalCurrent = objectives.reduce((sum, o) => sum + (o.current || 0), 0);

      return totalRequired > 0 ? Math.round((totalCurrent / totalRequired) * 100) : 0;
    } catch {
      return undefined;
    }
  }

  /** 统计最近一轮的事件数量 */
  private async countRecentEvents(saveId: string): Promise<number> {
    if (!this.repos) return 0;

    try {
      // 取最近一条 pacing_history 的创建时间作为本轮起始
      const since = await this.repos.pacingHistory.getCreatedAtOfLast(saveId);

      if (since !== null) {
        return await this.repos.storyEvent.countSince(saveId, since);
      }

      // 首轮：统计全部事件
      return await this.repos.storyEvent.countBySaveId(saveId);
    } catch {
      return 0;
    }
  }

  /** 将值限制在 [0, 1] 范围内 */
  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
