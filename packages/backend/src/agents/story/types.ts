import type {
  ChapterInfo,
  StoryContext,
  StoryEvent,
  StoryEventInput,
} from '../../game-systems/story/types.js';
import type { TriggerType } from '@ai-rpg/shared/messaging';
import type { AgentType } from '../../../../shared/src/types/agent.js';
import type { ReActEngineResult } from '../ReActEngine.js';
import type { IntegrationResult } from '../coordinator/types.js';
import type { StagingPool } from '../../services/StagingPool.js';
import type { ShadowStateLayer } from '../../services/ShadowStateLayer.js';
// P2-S1: AuditIssue + UnifiedPostReviewDecision 已下沉到 shared/src/types/agent-coordination.ts
// 消费方直接从 shared 引用，此处不保留 re-export（开发阶段原则）
import type { UnifiedPostReviewDecision } from '../../../../shared/src/types/agent-coordination.js';
// 方案M迁移：AuditRootCause 用于 buildRepairReasons 的根因分类
import type { AuditRootCause } from '../../../../shared/src/types/audit.js';

export interface StoryHistorySnapshot {
  events: StoryEvent[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  compressionSummaries?: string;
  hint?: string;
}

export interface StorySnapshot {
  context: StoryContext & { hint?: string };
  history: StoryHistorySnapshot;
  chapter: ChapterInfo;
}

export interface StoryProjection {
  chapter: string | null;
  mainQuest: string | null;
}

export interface StoryDirectiveEvents {
  /** 应检查的触发类型，如 ['enter_location', 'combat_end'] */
  checkTriggers?: TriggerType[];
  /** 应调度/触发的事件模板ID列表 */
  scheduleEvents?: string[];
  /** 是否应记录本轮为故事事件 */
  recordStoryEvent?: boolean;
}

export interface StoryDirective {
  storyGoal?: string;
  playerFacingObjective?: string;
  /** 对话级任务清单（3-7项自然语言任务） */
  todoList?: string[];
  requiredLayer1Agents: AgentType[];
  optionalLayer1Agents: AgentType[];
  dialogueFocus?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  projection: StoryProjection;
  /** 事件调度指令 */
  events?: StoryDirectiveEvents;
  /**
   * 角色画像修正——当观察到的玩家行为与当前画像不一致时，由 story-orchestration 提出修正。
   * 增量更新：只包含需要修改的字段，未提供的字段保持不变。
   * 为 null 或未提供时表示本轮无需修正。
   */
  characterProfileRevision?: CharacterProfileRevision | null;
  [key: string]: unknown;
}

/**
 * 角色画像修正——当实际玩家行为与画像不符时的增量更新。
 * 只填需要修正的字段，不修正的留空。reason 必填。
 */
export interface CharacterProfileRevision {
  traitSummary?: string;
  dominantStrength?: string;
  coreWeakness?: string;
  personalMotivation?: string;
  potentialConflict?: string;
  /** 修正原因——为什么需要修正当前画像 */
  reason: string;
}

// P2-S1: UnifiedPostReviewDecision + AuditIssue 已下沉到 shared/src/types/agent-coordination.ts
// 消费方直接从 shared 引用，此处不保留 re-export（开发阶段原则）

/**
 * 角色画像——提取自玩家创建角色数据，用于驱动故事生成。
 * 由 story-master-plan LLM 分析生成，持久化到 StoryRuntimeState 中以供后续轮次使用。
 */
export interface CharacterProfile {
  /** 角色特质的简短总结 */
  traitSummary: string;
  /** 核心优势（基于最高属性+职业+种族） */
  dominantStrength: string;
  /** 核心弱点（基于最低属性+背景） */
  coreWeakness: string;
  /** 角色的个人动机（为什么踏上冒险？） */
  personalMotivation: string;
  /** 角色将要面对的核心冲突 */
  potentialConflict: string;
}

/**
 * 角色背景补充——当角色 background 不完整时，由 story-master-plan LLM 补充。
 * 持久化到 StoryRuntimeState 中供 GM 后续使用。
 */
export interface CharacterBackgroundSupplement {
  /** 补充的完整背景故事 */
  narrative: string;
  /** 背景中埋入的故事钩子（可在后续章节激活） */
  hooks: string[];
}

export interface StoryMasterPlan {
  initialProjection: StoryProjection;
  initialHooks?: string[];
  storyGoal?: string;
  /** 角色画像——由 LLM 分析角色数据生成 */
  characterAnalysis?: CharacterProfile;
  /** 角色背景补充——当 background 不完整时由 LLM 补充 */
  characterBackgroundSupplement?: string;
  [key: string]: unknown;
}

export interface WorldStateSummary {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByRelation: Record<string, number>;
  boundaryCount?: number;
  snapshotCount?: number;
}

export interface EntityGraphPort {
  getWorldStateSummary(saveId: string): Promise<WorldStateSummary>;
  getSubgraph(saveId: string, centerNodeId: string, depth: number): Promise<{
    nodes: Array<{ id: string; entityType: string; entityId: string; label: string; properties: Record<string, unknown> }>;
    edges: Array<{ fromNodeId: string; relation: string; toNodeId: string }>;
  } | null>;

  // 模块1 L2-1：结构化数据查询通道（未来扩展点）
  // MEDIUM-2 第三轮修订：当前无消费者（模块3 L2-1 简化后 StoryKernel 不查询），
  // 接口能力预留为未来扩展点（子 Agent 上下文注入/审计/风险评估等）。
  // Layer 不使用，Layer 保持批量 XML 生成路径。
  getNpcProfile(saveId: string, npcId: string): Promise<NpcProfileData | null>;
  getLocationSummary(saveId: string, locationId: string): Promise<LocationSummaryData | null>;
  getEntityRelations(saveId: string, entityType: string, entityId: string): Promise<EntityRelationsData | null>;

  /**
   * 查询对指定主题有 awareness 记录的 NPC 数量（current_score >= 1）。
   *
   * 006 升级新增（设计文档 §9）：紧张度引擎 assessInfoSpreadFactor 评估信息扩散度。
   *   - 期望效果：返回 awareness states 表中 target_node_id 对应 topic 节点
   *     且 current_score >= 1 的记录数
   *   - 用途：StoryKernel.assessInfoSpreadFactor 评估信息扩散度（紧张度引擎 info 因子）
   *   - 失败时返回 0（不抛错，与 safeGetWorldState 模式一致）
   */
  countAwarenessByTopic(
    saveId: string,
    topicType: string,
    topicId: string,
  ): Promise<number>;
}

/**
 * NPC 画像数据（Port 层类型，独立于 entity-graph 内部类型）。
 *
 * 设计决策（M1/M2）：Port 类型与 EntityGraphService 内部返回类型刻意分离，
 * 体现端口-适配器模式解耦——Port 不依赖 entity-graph/RelationType 枚举，
 * relation 字段在 Port 层为 string（由 Port wrapper 做 RelationType→string 映射）。
 *
 * 期望效果：未来消费者通过 EntityGraphPort 获取 NPC 画像，包含结构关系和感知数据。
 */
export interface NpcProfileData {
  npc: { id: string; name: string; type: string; location?: string };
  structuralRelations: Array<{ targetId: string; targetType: string; relation: string }>;
  perceptions: Array<{
    targetId: string;
    targetType: string;
    relationshipScore?: number;
    relationshipNote?: string;
    awarenessScore?: number;
    awarenessNote?: string;
  }>;
}

/**
 * 地点概览数据（Port 层类型）。
 * 期望效果：未来消费者通过 EntityGraphPort 获取地点概览，包含 NPC/物品/子地点/连接。
 */
export interface LocationSummaryData {
  location: { id: string; name: string; type: string };
  npcs: Array<{ id: string; name: string; role?: string }>;
  items: Array<{ id: string; name: string; type: string }>;
  subLocations: Array<{ id: string; name: string }>;
  connections: Array<{ targetLocationId: string; targetName: string }>;
}

/**
 * 实体关系数据（Port 层类型）。
 * 期望效果：未来消费者通过 EntityGraphPort 获取实体关系，包含结构关系和感知数据。
 */
export interface EntityRelationsData {
  structuralRelations: Array<{ targetId: string; targetType: string; relation: string }>;
  perceptions: Array<{
    targetId: string;
    targetType: string;
    relationshipScore?: number;
    relationshipNote?: string;
    awarenessScore?: number;
    awarenessNote?: string;
  }>;
}

export interface StoryRequestContext {
  snapshot: StorySnapshot;
  projection: StoryProjection;
  worldState?: WorldStateSummary;
}

export interface StoryRuntimeState extends Record<string, unknown> {}

export interface StoryStateCommit {
  runtimeState: StoryRuntimeState;
  projection: StoryProjection;
}

export interface StoryRuntimeCommitInput {
  storyDirective?: StoryDirective | null;
  resolvedLayer1Agents?: AgentType[];
  writeToolTypes?: string[];
  needAgentReasons?: string[];
  postReviewDecision?: UnifiedPostReviewDecision | null;
  postReactTraceSummary?: StoryPostReactDevtoolsTrace;
}

export interface StoryPostReactPipelineInput {
  saveId: string;
  storyRequestContext: StoryRequestContext;
  storyDirective: StoryDirective | null;
  postReviewDecision?: UnifiedPostReviewDecision | null;
  reactResult: ReActEngineResult;
  integrationResult: IntegrationResult;
  stagingPool: StagingPool;
  shadowState: ShadowStateLayer;
  pacingReviewResult?: PacingReviewResult;
}

export interface StoryPostReactDevtoolsTrace {
  phase: 'post-react';
  repairRoundCount: number;
  requiresRepair: boolean;
  decisionSummary: {
    storyConsistency?: 'consistent' | 'partial_match' | 'mismatch';
    todoCompletion?: 'complete' | 'partial' | 'failed' | 'missing';
    /** 方案M迁移后：审核结果是否通过（替代旧 continuitySeverity） */
    auditPassed?: boolean;
    /** 方案M迁移后：失败根因分类（仅 auditPassed=false 时有值） */
    auditRootCause?: AuditRootCause;
    secondLayerDecisionValid: boolean;
  };
  repairReasons: string[];
  resolvedLayer1Agents: AgentType[];
  needAgentReasons: string[];
  runtimeCommitSummary: {
    wrotePostReviewDecision: boolean;
    wroteContinuityAudit: boolean;
    wroteTodoCompletion: boolean;
    wroteRepairMetadata: boolean;
  };
}

export interface StoryPostReactPipelineResult {
  postReviewDecision: UnifiedPostReviewDecision | null;
  resolvedLayer1Agents: AgentType[];
  needAgentReasons: string[];
  requiresRepair: boolean;
  storyStateCommit: StoryStateCommit;
  devtoolsTrace: StoryPostReactDevtoolsTrace;
  /**
   * 感知更新引导提示（模块3 L2-2 后处理引导）。
   *
   * 由 StoryPostReactPipeline.run() 内部 detectPerceptionUpdateHint 生成：
   * - 检测到战斗/对话/任务完成/剧情转折等事件时，返回提示字符串
   * - 无感知相关事件时返回 null
   *
   * 由 AgentRuntime 持久化到实例字段 pendingPerceptionHint，
   * 在下一轮 GM systemPrompt 构建时注入 `<perception_hint>` 段并清空字段（一次性消费）。
   */
  perceptionUpdateHint?: string | null;
}

export interface StoryServiceLike {
  getContext(saveId: string): Promise<StoryContext & { hint?: string }>;
  getHistory(saveId: string, options?: { page?: number; pageSize?: number }): Promise<StoryHistorySnapshot>;
  getChapter(saveId: string): Promise<ChapterInfo>;
  commitStoryState(saveId: string, commit: StoryStateCommit): Promise<void>;
  addStoryEvent(saveId: string, event: StoryEventInput): Promise<StoryEvent>;
}

export interface StoryDomainPort {
  getSnapshot(saveId: string): Promise<StorySnapshot>;
  saveStoryState(saveId: string, commit: StoryStateCommit): Promise<void>;
  addStoryEvent(saveId: string, event: StoryEventInput): Promise<StoryEvent>;
}

// === 节奏引擎类型 ===

/** 紧张度5维因子 */
export interface TensionFactors {
  combat: number;      // 战斗强度 [0,1]
  threat: number;      // 威胁程度 [0,1]
  resource: number;    // 资源消耗 [0,1]
  info: number;        // 信息揭示 [0,1]
  time: number;        // 时间压力 [0,1]
}

/** 紧张度权重配置 */
export interface TensionWeights {
  combat: number;      // 默认 0.30
  threat: number;      // 默认 0.25
  resource: number;    // 默认 0.20
  info: number;        // 默认 0.15
  time: number;        // 默认 0.10
}

/** 紧张度范围 */
export interface TensionRange {
  min: number;  // 默认 20
  max: number;  // 默认 80
}

/** 事件密度参数 */
export interface DensityParams {
  windowSize: number;       // 滚动窗口大小，默认 5
  cooldownRounds: number;   // 同类事件冷却轮数，默认 2
  rareBudget: number;       // 高冲击事件预算，默认 1
  rareWindow: number;       // 高冲击事件窗口，默认 10
}

/** 推进速度参数 */
export interface ProgressParams {
  sigmoidK: number;    // Sigmoid 曲率，默认 0.1
  sigmoidT0: number;   // Sigmoid 中点，默认 25
}

/** 节奏阶段阈值 */
export interface StageThresholds {
  exposition: number;  // 默认 20
  rising: number;      // 默认 40
  climax: number;      // 默认 70
  falling: number;     // 默认 50
  resolution: number;  // 默认 30
}

/** 节奏阶段 */
export type PacingStage = 'exposition' | 'rising' | 'climax' | 'falling' | 'resolution';

/** 节奏配置（完整） */
export interface PacingConfig {
  tensionRange: TensionRange;
  tensionWeights: TensionWeights;
  densityParams: DensityParams;
  progressParams: ProgressParams;
  stageThresholds: StageThresholds;
  pacingInterval: number;  // 计算间隔，默认 5
  generatedBy: 'default' | 'llm' | 'config';
}

/** 节奏历史记录 */
export interface PacingHistoryRecord {
  id?: number;
  saveId: string;
  roundNumber: number;
  deterministicValue: number;
  llmAdjustedValue?: number;
  adjustmentReason?: string;
  factors: TensionFactors;
  stage: PacingStage;
  eventCount: number;
  mainQuestProgress?: number;
  isCalculationRound: boolean;
  createdAt?: number;
}

/** 节奏状态（请求级缓存） */
export interface PacingState {
  currentTension: number;
  currentStage: PacingStage;
  currentFactors: TensionFactors;
  roundNumber: number;
  isCalculationRound: boolean;
  lastCalculationRound: number;
  config: PacingConfig;
}

/** LLM 修正请求 */
export interface PacingLLMCorrectionRequest {
  deterministicTension: number;
  factors: TensionFactors;
  recentHistory: PacingHistoryRecord[];
  narrativeContext: string;
  currentStage: PacingStage;
  deterministicDensityGuidance: 'increase' | 'decrease' | 'maintain';
  deterministicSpeedGuidance: 'accelerate' | 'decelerate' | 'maintain';
  currentDensity: number;
  speedDeviation: number;
}

/** LLM 修正响应 */
export interface PacingLLMCorrectionResponse {
  adjustedTension: number;
  reason: string;
  stageOverride?: PacingStage;
  adjustedDensityGuidance?: 'increase' | 'decrease' | 'maintain';
  adjustedSpeedGuidance?: 'accelerate' | 'decelerate' | 'maintain';
}

/** 节奏审查结果 */
export interface PacingReviewResult {
  tensionConsistent: boolean;
  consecutiveHighPressure: boolean;
  consecutiveLowPressure: boolean;
  progressDeviation: number;
  suggestions: string[];
}

/** 节奏约束（注入 StoryDirective.constraints） */
export interface PacingConstraints {
  tension: number;
  stage: PacingStage;
  densityGuidance: 'increase' | 'decrease' | 'maintain';
  speedGuidance: 'accelerate' | 'decelerate' | 'maintain';
  maxEventDensity?: number;
  cooldownTypes?: string[];
}

/** 事件密度评估结果 */
export interface DensityAssessment {
  currentDensity: number;
  guidance: 'increase' | 'decrease' | 'maintain';
  cooldownTypes: string[];
}

/** 推进速度评估结果 */
export interface SpeedAssessment {
  deviation: number;
  guidance: 'accelerate' | 'decelerate' | 'maintain';
}
