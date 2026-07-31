import { llmClient, apiClient } from './client';
import type { UITheme, UILayout, DialogueOption, PanelUpdates } from '@/types';
import type { Gender, AgeGroup, NPCGoal, GoalCategory, TemplateSkillPoolEntry, TemplateItemPoolEntry } from '@ai-rpg/shared';

export interface CharacterData {
  name: string;
  gender: Gender;
  customGender?: string;
  ageGroup?: AgeGroup;
  race: string;
  classType: string;
  background: string;
  attributes: Record<string, number>;
  customOptions?: Record<string, string | number | boolean>;
}

export interface InitGameParams {
  templateId?: string;
  characterData: CharacterData;
  saveId?: string;
  language?: string;
}

export interface InitStepResult {
  step: number;
  stepName: string;
  success: boolean;
  durationMs: number;
  data?: Record<string, unknown>;
}

export interface InitGameResponse {
  saveId: string;
  templateId: string | null;
  characterData: {
    characterId: string;
    name: string;
    level: number;
    gold: number;
    currency?: Record<string, number>;
    attributes: Record<string, number>;
    attributeNames?: Record<string, string>;
  };
  startingScene: {
    title: string;
    content: string;
    atmosphere: string;
  };
  dialogue?: {
    message?: string;
    speaker?: string;
    options?: DialogueOption[];
    messages?: Array<{ speaker: string; content: string; emotion?: string }>;
  };
  /** @deprecated 使用顶层 uiDirective 替代 dynamicUI.uiDirective */
  dynamicUI?: {
    uiDirective?: string;
    panelUpdates?: PanelUpdates;
  };
  /** 扁平化GameResponse字段：UI指令 */
  uiDirective?: string;
  /** 扁平化GameResponse字段：UI强度等级 */
  uiIntensity?: 'full' | 'partial' | 'minimal' | 'none';
  /** 扁平化GameResponse字段：面板更新 */
  panelUpdates?: PanelUpdates;
  npcWarnings?: {
    warningType: string;
    filteredOutNpcs: Array<{ id: string; name: string }>;
    currentLocationName: string;
  };
  time?: {
    currentTime: {
      day: number;
      hour: number;
      minute: number;
      period: string;
      season: string;
      description: string;
    };
  };
  uiLayout?: UILayout;
  uiTheme?: UITheme;
  steps: InitStepResult[];
  totalDurationMs: number;
}

export interface ChatParams {
  message: string;
  saveId: string;
  action?: string;
  data?: Record<string, unknown>;
  npcId?: string;
  targetNpcIds?: string[];
  playerAction?: {
    type: string;
    itemId?: string;
    itemName?: string;
    targetNpcId?: string;
    selectedOptionId?: string;
  };
  dataChanges?: Record<string, unknown>;
}

export interface GmInfo {
  processedAt: number;
  duration: number;
  reactIterations: number;
  agentsInvolved: string[];
}

export interface ChatResponse {
  gm?: GmInfo;
  [agentType: string]: unknown;
  saveId?: string;
  dialogue?: {
    message?: string;
    speaker?: string;
    options?: DialogueOption[];
    messages?: Array<{ speaker: string; content: string; emotion?: string }>;
  };
  /** @deprecated 使用顶层 uiDirective 替代 dynamicUI.uiDirective */
  dynamicUI?: {
    uiDirective?: string;
    panelUpdates?: PanelUpdates;
  };
  /** 扁平化GameResponse字段：UI指令 */
  uiDirective?: string;
  /** 扁平化GameResponse字段：UI强度等级 */
  uiIntensity?: 'full' | 'partial' | 'minimal' | 'none';
  /** 扁平化GameResponse字段：面板更新 */
  panelUpdates?: PanelUpdates;
  time?: {
    currentTime: {
      day: number;
      hour: number;
      minute: number;
      period: string;
      season: string;
      description: string;
    };
  };
  writeOperations?: Array<{
    toolType: string;
    method: string;
    timestamp: number;
  }>;
  dataChanges?: Record<string, { toolType: string; method: string; summary: string }>;
}

export interface ChatResult {
  data: ChatResponse;
  messages: Array<Record<string, unknown>>;
  toolCalls?: Array<Record<string, unknown>>;
  metadata: {
    processingTime: number;
    messageId: string;
    processedAt: string;
    partialSuccess?: boolean;
    isInitialization?: boolean;
    /** 阶段五新增：当前挑战模式（供前端 UI 感知） */
    challengeMode?: import('@ai-rpg/shared').ChallengeMode | null;
    /** 阶段五新增：挑战是否已结束（清空 challengeMode 信号） */
    challengeEnded?: boolean;
  };
}

export interface AgentStatusInfo {
  coordinator: {
    status: string;
    type: string;
    name: string;
    currentScheduleDepth: number;
    registeredAgentsCount: number;
  };
  agents: Array<{
    type: string;
    status: string;
  }>;
  tools: {
    total: number;
    types: string[];
  };
  system: {
    timestamp: number;
    uptime: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
    };
  };
}

export interface DecisionLogQuery {
  agentType?: string;
  limit?: number;
  offset?: number;
  saveId?: string;
}

export interface DecisionLogResult {
  data: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
  saveId: string;
  agentType?: string;
  totalPages?: number;
}

export interface HealthCheckResult {
  status: string;
  database: string;
  migrations: {
    applied: number;
    pending: number;
  };
  websocket: {
    connectedClients: number;
  };
}

export interface StoryHistoryEvent {
  id: string;
  save_id: string;
  chapter: string;
  event_type: string;
  title: string;
  description: string;
  importance: 'critical' | 'major' | 'minor';
  participants: string;
  impact: string;
  timestamp: number;
}

export interface StoryHistoryResult {
  events: StoryHistoryEvent[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  compressionSummaries?: string;
  hint?: string;
}

interface EntityGraphData {
  nodes: Array<{
    id: string;
    saveId: string;
    entityType: string;
    entityId: string;
    label: string;
    properties: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
  }>;
  edges: Array<{
    id: string;
    saveId: string;
    fromNodeId: string;
    relation: string;
    toNodeId: string;
    weight: number;
    properties: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
  }>;
}

interface EntityGraphSubgraph {
  nodes: Array<{ id: string; entityType: string; entityId: string; label: string; properties: Record<string, unknown> }>;
  edges: Array<{ fromNodeId: string; relation: string; toNodeId: string }>;
}

interface EntityAwarenessResult {
  observer: { id: string; type: string; label: string };
  awareness: Array<{
    target: string;
    targetType: string;
    targetId: string;
    awarenessScore: number | null;
    awarenessNote: string | null;
    relationshipScore: number | null;
    relationshipNote: string | null;
  }>;
}

interface GraphSnapshotItem {
  id: string;
  saveId: string;
  snapshotType: string;
  chapterNumber: number | null;
  deltaFromSnapshotId: string | null;
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  nodesCount: number;
  edgesCount: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface DirectMessageResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  metadata: {
    processingTime: number;
    targetAgent: string;
    messageId: string;
    processedAt: string;
    isDirectMessage: boolean;
  };
}

export interface LayerBuildResult {
  name: string;
  order: number;
  content: string | null;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface PromptCompositionResponse {
  agentKey: string;
  intentHint: string | null;
  action: string | null;
  timestamp: number;
  systemPrompt: {
    totalTokens: number;
    layers: LayerBuildResult[];
  };
  userPrompt: {
    totalTokens: number;
    action: string | null;
    intentHint: string | null;
    blocks: Array<{
      name: string;
      content: string | null;
      fields: Array<{ key: string; label: string; present: boolean; content: string | null }>;
    }>;
  };
  tools: {
    totalTools: number;
    totalMethods: number;
    visibleTools: number;
    deferredTools: number;
    maxOnDemandLoads: number;
    usedOnDemandLoads: number;
    visibleToolNames?: string[];
    deferredToolNames?: string[];
    trimmedReasons?: string[];
  };
}

export interface ToolExposureBudgetResponse {
  maxVisibleTools: number;
  usedVisibleTools: number;
  maxVisibleHelpDocs: number;
  usedVisibleHelpDocs: number;
  maxToolSummaryTokens: number;
  usedToolSummaryTokens: number;
  maxHelpSummaryTokens: number;
  usedHelpSummaryTokens: number;
  maxOnDemandLoadsPerTurn: number;
  usedOnDemandLoads: number;
}

export interface KnowledgeItemResponse {
  type: 'skill' | 'rule' | 'help';
  name: string;
  filePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  lastModified: string;
}

export interface HelpRegistryResponse {
  totalDocs: number;
  docs: Array<{
    name: string;
    service: string;
    methodCount: number;
    filePath: string;
  }>;
}

export interface StagingPoolResponse {
  saveId: string;
  stagingWriteTraces: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
  }>;
  traceCount: number;
}

export interface ContinuityAuditResponse {
  saveId: string;
  auditTraces: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
  }>;
  traceCount: number;
}

export interface EventBusResponse {
  saveId: string;
  eventBusTraces: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
  }>;
  traceCount: number;
}

export interface EntityGraphChangesResponse {
  saveId: string;
  graphChangeTraces: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: number;
  }>;
  traceCount: number;
}

export interface RuntimeSnapshotTraceResponse {
  saveId: string;
  runtimeSnapshots: Array<{
    type: string;
    data: {
      requestId: string;
      agentKey: string;
      parentAgentRunId?: string;
      model: {
        providerId: string | null;
        model: string | null;
      };
      permissions: {
        configuredTools: string[];
        defaultDeny: boolean;
        visibleToolTypes: string[];
        visibleFunctionCount: number;
        deferredFunctionCount: number;
      };
      toolExposureBudget: ToolExposureBudgetResponse | null;
      deferredTools: string[];
      knowledge: {
        ruleNames: string[];
        skillNames: string[];
        helpMethods: string[];
      };
      prompt: {
        systemPromptLength: number;
        userPromptLength: number;
      };
      context: {
        language: string | null;
        templateId: string | null;
      };
      debug: {
        source: string;
      };
    };
    timestamp: number;
  }>;
  traceCount: number;
}

export interface StoryPostReactDevtoolsTrace {
  phase: 'post-react';
  repairRoundCount: number;
  requiresRepair: boolean;
  decisionSummary: {
    storyConsistency?: 'consistent' | 'partial_match' | 'mismatch';
    todoCompletion?: 'complete' | 'partial' | 'failed' | 'missing';
    continuitySeverity?: 'pass' | 'warning' | 'error';
    secondLayerDecisionValid: boolean;
  };
  repairReasons: string[];
  resolvedLayer1Agents: string[];
  needAgentReasons: string[];
  runtimeCommitSummary: {
    wrotePostReviewDecision: boolean;
    wroteContinuityAudit: boolean;
    wroteTodoCompletion: boolean;
    wroteRepairMetadata: boolean;
  };
}

export interface PostReactTraceResponse {
  saveId: string;
  postReactTraces: Array<{
    type: string;
    data: StoryPostReactDevtoolsTrace;
    timestamp: number;
  }>;
  traceCount: number;
}

export interface RuntimeEventsResponse {
  saveId: string;
  events: Array<{
    type: string;
    at: number;
    traceIds: {
      requestId: string;
      sessionId: string;
      agentRunId: string;
      parentAgentRunId?: string;
      iterationId?: string;
      toolCallId?: string;
      commandId?: string;
      eventId?: string;
      auditRoundId?: string;
    };
    source: string;
    summary: string;
    detail?: Record<string, unknown>;
  }>;
  eventCount: number;
}

export interface PromptConfigResponse {
  rules: {
    totalRules: number;
    alwaysApplyCount: number;
    hookedCount: number;
    rules: Array<{
      name: string;
      alwaysApply: boolean;
      hook: string[];
      targetAgent: string[];
      description: string;
      priority: number;
      enabled: boolean;
      filePath: string;
    }>;
  };
  skills: {
    totalSkills: number;
    skills: Array<{
      name: string;
      description: string;
      targetAgent: string[];
      trigger: string[];
      whenToUse: string;
      recommendedTools: string[];
      relatedRules: string[];
      enabled: boolean;
      filePath: string;
    }>;
  };
}

export const gameApi = {
  healthCheck: async (): Promise<HealthCheckResult> => {
    return apiClient.get('/health');
  },

  databaseStatus: async (): Promise<{
    connected: boolean;
    migrations: { applied: number[]; pending: number[] };
    databasePath: string;
  }> => {
    return apiClient.get('/database/status');
  },

  getStatus: async (): Promise<AgentStatusInfo> => {
    return apiClient.get('/agent/status');
  },

  getTools: async (): Promise<{ tools: Array<Record<string, unknown>>; count: number }> => {
    return apiClient.get('/agent/tools');
  },

  getAgents: async (): Promise<{
    agents: Array<{ type: string; name: string; status: string; systemPrompt: string }>;
    count: number;
  }> => {
    return apiClient.get('/agent/agents');
  },

  getDecisionLogs: async (query?: DecisionLogQuery): Promise<DecisionLogResult> => {
    const params: Record<string, string> = {};
    if (query?.agentType) params.agentType = query.agentType;
    if (query?.limit !== undefined) params.limit = String(query.limit);
    if (query?.offset !== undefined) params.offset = String(query.offset);
    if (query?.saveId) params.saveId = query.saveId;
    const searchParams = new URLSearchParams(params).toString();
    const url = searchParams ? `/agent/decisions?${searchParams}` : '/agent/decisions';
    return apiClient.get(url);
  },

  sendDirectMessage: async (
    agentType: string,
    message: string,
    saveId?: string,
    action?: string
  ): Promise<DirectMessageResult> => {
    return llmClient.post('/agent/message', { agentType, message, saveId, action });
  },

  getStoryHistory: async (
    saveId: string,
    options?: { page?: number; pageSize?: number }
  ): Promise<StoryHistoryResult> => {
    const params = new URLSearchParams();
    if (options?.page !== undefined) params.set('page', String(options.page));
    if (options?.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
    const query = params.toString();
    const url = query ? `/saves/${saveId}/story/history?${query}` : `/saves/${saveId}/story/history`;
    return apiClient.get(url);
  },

  getEntityGraph: async (saveId: string): Promise<EntityGraphData> => {
    return apiClient.get(`/dev/entity-graph?saveId=${encodeURIComponent(saveId)}`);
  },

  getEntityGraphSubgraph: async (saveId: string, centerNodeId: string, depth: number = 1): Promise<EntityGraphSubgraph> => {
    return apiClient.get(`/dev/entity-graph/subgraph?saveId=${encodeURIComponent(saveId)}&centerNodeId=${encodeURIComponent(centerNodeId)}&depth=${depth}`);
  },

  // 模块3: /entity-graph/awareness — 基于 PERCEIVES 边查询实体感知（替代旧 /boundary）
  getEntityGraphAwareness: async (saveId: string, entityType: string, entityId: string): Promise<EntityAwarenessResult> => {
    return apiClient.get(`/dev/entity-graph/awareness?saveId=${encodeURIComponent(saveId)}&entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
  },

  getEntityGraphSnapshots: async (saveId: string): Promise<GraphSnapshotItem[]> => {
    return apiClient.get(`/dev/entity-graph/snapshots?saveId=${encodeURIComponent(saveId)}`);
  },

  getNpcGoals: async (saveId: string, npcId: string, status?: string): Promise<NPCGoal[]> => {
    const params = new URLSearchParams({ saveId, npcId });
    if (status) params.set('status', status);
    return apiClient.get(`/dev/npc-goals?${params.toString()}`) as unknown as Promise<NPCGoal[]>;
  },

  createNpcGoal: async (saveId: string, npcId: string, goal: {
    type: 'long_term' | 'mid_term';
    category: GoalCategory;
    description: string;
    priority?: number;
    relatedEntityIds?: string[];
  }): Promise<string> => {
    const response = await apiClient.post('/dev/npc-goals', { saveId, npcId, ...goal });
    return (response as unknown as { goalId: string }).goalId;
  },

  updateNpcGoal: async (saveId: string, goalId: string, updates: {
    status?: NPCGoal['status'];
    priority?: number;
    progress?: string;
    description?: string;
  }): Promise<void> => {
    await apiClient.patch(`/dev/npc-goals/${encodeURIComponent(goalId)}`, { saveId, ...updates });
  },

  modifyNpcCurrency: async (saveId: string, npcId: string, currencyType: string, delta: number): Promise<Record<string, number>> => {
    return apiClient.post('/dev/npc-currency/modify', { saveId, npcId, currencyType, delta }) as unknown as Promise<Record<string, number>>;
  },

  fetchPromptComposition: async (params: { saveId: string; agentKey?: string; intentHint?: string }) => {
    const query = new URLSearchParams({ saveId: params.saveId });
    if (params.agentKey) query.set('agentKey', params.agentKey);
    if (params.intentHint) query.set('intentHint', params.intentHint);
    return apiClient.get(`/dev/prompt-composition?${query.toString()}`) as Promise<PromptCompositionResponse>;
  },

  fetchPromptConfig: async () => {
    return apiClient.get('/dev/prompt-config') as Promise<PromptConfigResponse>;
  },

  fetchKnowledgeItem: async (type: 'skill' | 'rule' | 'help', name: string) => {
    return apiClient.get(`/dev/knowledge/${type}/${name}`) as Promise<KnowledgeItemResponse>;
  },

  fetchHelpRegistry: async () => {
    return apiClient.get('/dev/help-registry') as Promise<HelpRegistryResponse>;
  },

  fetchStagingPool: async (saveId: string) => {
    return apiClient.get(`/dev/staging-pool?saveId=${saveId}`) as Promise<StagingPoolResponse>;
  },

  fetchContinuityAudit: async (saveId: string, limit = 20) => {
    return apiClient.get(`/dev/continuity-audit?saveId=${saveId}&limit=${limit}`) as Promise<ContinuityAuditResponse>;
  },

  fetchEventBus: async (saveId: string, limit = 50) => {
    return apiClient.get(`/dev/event-bus?saveId=${saveId}&limit=${limit}`) as Promise<EventBusResponse>;
  },

  fetchEntityGraphChanges: async (saveId: string, limit = 50) => {
    return apiClient.get(`/dev/entity-graph-changes?saveId=${saveId}&limit=${limit}`) as Promise<EntityGraphChangesResponse>;
  },

  fetchRuntimeSnapshots: async (saveId: string, limit = 20) => {
    return apiClient.get(
      `/dev/runtime-snapshots?saveId=${encodeURIComponent(saveId)}&limit=${limit}`
    ) as Promise<RuntimeSnapshotTraceResponse>;
  },

  fetchPostReactTraces: async (saveId: string, limit = 20) => {
    return apiClient.get(
      `/dev/post-react-traces?saveId=${encodeURIComponent(saveId)}&limit=${limit}`
    ) as Promise<PostReactTraceResponse>;
  },

  fetchRuntimeEvents: async (saveId: string, params?: { type?: string; requestId?: string; limit?: number }) => {
    const query = new URLSearchParams({ saveId });
    if (params?.type) query.set('type', params.type);
    if (params?.requestId) query.set('requestId', params.requestId);
    if (params?.limit) query.set('limit', String(params.limit));
    return apiClient.get(`/dev/runtime-events?${query.toString()}`) as Promise<RuntimeEventsResponse>;
  },

  // Pool DevTools
  getPoolTemplateSkills: (saveId: string, params?: { category?: string; recommendedClass?: string }) => {
    return apiClient.get(`/game/${saveId}/pool/template/skills`, { params }) as Promise<{ skills: TemplateSkillPoolEntry[] }>;
  },
  getPoolTemplateItems: (saveId: string, params?: { category?: string; equippedSlot?: string; recommendedClass?: string; quality?: string }) => {
    return apiClient.get(`/game/${saveId}/pool/template/items`, { params }) as Promise<{ items: TemplateItemPoolEntry[] }>;
  },
  getPoolSaveSkills: (saveId: string, params?: { category?: string; learned?: boolean }) => {
    return apiClient.get(`/game/${saveId}/pool/save/skills`, { params }) as Promise<{ skills: TemplateSkillPoolEntry[] }>;
  },
  getPoolSaveItems: (saveId: string, params?: { category?: string; taken?: boolean }) => {
    return apiClient.get(`/game/${saveId}/pool/save/items`, { params }) as Promise<{ items: TemplateItemPoolEntry[] }>;
  },
  getPoolStats: (saveId: string) => {
    return apiClient.get(`/game/${saveId}/pool/stats`) as Promise<{
      templatePool: { skillCount: number; itemCount: number; skillCategories: Record<string, number>; itemCategories: Record<string, number> };
      savePool: { skillCount: number; learnedCount: number; itemCount: number; takenCount: number };
    }>;
  },
};
