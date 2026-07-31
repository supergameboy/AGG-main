import { AgentType, WriteOperation, NeedAgentRequest } from '../../../../shared/src/types/agent.js';
import { AgentResponse } from '../types.js';
import type { FallbackSuggestion } from '@ai-rpg/shared/types/tool';
import type { ID } from '../../../../shared/src/types/core.js';
import type { TraceCollector } from '../../services/TraceCollector.js';
// P2-S1: UnifiedPostReviewDecision 已下沉到 shared/src/types/agent-coordination.ts
import type { UnifiedPostReviewDecision } from '../../../../shared/src/types/agent-coordination.js';

export interface IntentAnalysisResult {
  blocked?: boolean;
  blockCategory?: string;
  blockReason?: string;
  userMessage?: string;
  targetAgents: AgentType[];
  agentActions: Record<AgentType, string[]>;
  confidence: number;
  reasoning: string;
  contextConditions: Record<string, unknown>;
  targetNpcIds?: string[];
  npcRecognitionReasoning?: string;
  needsDynamicUI?: boolean;
  dynamicUIScenario?: string;
  dynamicUIReason?: string;
}

export interface IntegrationResult {
  success: boolean;
  data: Record<string, unknown>;
  writeOperations: WriteOperation[];
  agentResponses: Map<AgentType, AgentResponse>;
  needsFurtherProcessing: boolean;
  processingReason?: string;
  fallbackSuggestions: Array<{
    agentType: AgentType;
    suggestion: FallbackSuggestion;
  }>;
  needAgentRequests?: NeedAgentRequest[];
}

export interface InputValidationResult {
  blocked: boolean;
  reason: string;
  category: string;
  userMessage: string;
}

/**
 * 质量验收：单个Agent的输出质量评估
 */
export interface QualityVerification {
  agentType: string;
  passed: boolean;
  score?: number;
  issues?: string[];
  severity?: 'critical' | 'warning' | 'info';
}

/**
 * 合并后的后处理结果
 *
 * 纠正已融入 secondLayerAgents:
 *   - 纠正类: type=原Agent, data.correctionInstruction="..."
 *   - 协调类: type=其他Agent, data.reason="..."
 *   - needAgent: type=请求的Agent
 */
export interface MergedPostProcessingResult {
  qualityVerifications: QualityVerification[];
  needsSecondSchedule: boolean;
  secondLayerAgents: Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
  needsDynamicUI: boolean;
  dynamicUIScenario?: string;
  reasoning: string;
  overallQuality: number;
}

/** Runtime context for scheduler requests (migrated from DAGScheduler) */
export interface SchedulerRequestContext {
  saveId: ID;
  language?: string | null;
  reactIterations: number;
  templateContext?: string | null;
  specialRules?: Record<string, unknown> | null;
  injectedContexts?: Map<AgentType, string | null>;
  storyDirective?: import('../story/types.js').StoryDirective | null;
  postReviewDecision?: UnifiedPostReviewDecision | null;
  intent?: IntentAnalysisResult;
  peerResultKeys?: string[];
  secondLayerData?: Record<string, unknown> | null;
  agentTrace?: import('../../services/TraceCollector.js').AgentTraceData;
  traceCollector?: TraceCollector;
}

// ContextOverflowError 已迁移至 shared/src/types/errors.ts
// 此处 re-export 是设计 P1-S1.2 的明确要求（agents→shared←services 数据流）
// 迁移原因：打破 agents↔services 循环依赖，改为 agents→shared←services
// 详见 docs/design/fractal-design-20260626-backend-decoupling-refactor/
export { ContextOverflowError } from '../../../../shared/src/types/errors.js';

export const ALL_AGENT_TYPES: AgentType[] = [
  'gamemaster',
  'output',
  'challenge',
  'quest',
  'map',
  'npc_party',
  'inventory',
  'skill',
  'numerical',
  'event',
  'time'
];

/**
 * Domain Agent子集：数据丰富化时调度的Agent（初始化和翻译场景）
 * 这些Agent负责各自领域的数据初始化/翻译，不包含gamemaster/output
 */
export const DOMAIN_ENRICHMENT_AGENT_TYPES: AgentType[] = ALL_AGENT_TYPES.filter(
  t => ['inventory', 'npc_party', 'quest', 'map', 'skill'].includes(t)
);

/**
 * Domain Agent子集：排除gamemaster和output的所有Agent
 * 用于构建Agent列表和动态Prompt
 */
export const DOMAIN_AGENT_TYPES: AgentType[] = ALL_AGENT_TYPES.filter(
  t => t !== 'gamemaster' && t !== 'output'
);

/**
 * 可路由的Domain Agent子集：排除gamemaster和output
 * 用于IntentAnalyzer过滤LLM返回的targetAgents
 * gamemaster不参与路由，output由Layer 3确定性调度
 */
export const ROUTABLE_DOMAIN_AGENT_TYPES: AgentType[] = ALL_AGENT_TYPES.filter(
  t => t !== 'gamemaster' && t !== 'output'
);

/**
 * 需要动态UI的面板类型（特殊面板，需要UIAgent生成）
 * 这些面板不是固定面板，需要根据游戏状态动态生成
 */
export const DYNAMIC_UI_PANEL_TYPES: string[] = [
  'combat',
  'shop',
  'trade',
  'character_creation',
  'welcome',
];

/**
 * 普通面板类型（固定面板，由前端固定布局自动展示）
 * 这些面板由Domain Agent提供数据，前端固定面板自动消费
 */
export const NORMAL_PANEL_TYPES: string[] = [
  'character',
  'inventory',
  'quest',
  'map',
  'npc_party',
  'skill',
];

export interface KeywordRules {
  actionToAgents: Record<string, unknown>;
  keywordCategories: Record<string, unknown>;
  domainAgentRules: Record<string, unknown>;
  _version?: string;
  _lastUpdated?: number;
}


