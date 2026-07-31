import type { ProgressContext } from '@ai-rpg/shared';
import type { IAgentRuntimeSnapshot } from '@ai-rpg/shared/tool-core';

export interface ModelSelectionSnapshot {
  providerId: string | null;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

export interface PermissionSnapshot {
  configuredTools: string[];
  defaultDeny: boolean;
}

export interface RuleSnapshot {
  name: string;
  source: string;
}

export interface SkillSnapshot {
  name: string;
  source: string;
}

export interface HelpSnapshot {
  tool: string;
  method: string;
}

export interface ToolVisibilitySnapshot {
  allowedToolTypes: string[];
  allowedFunctionNames: string[];
  deferredFunctionNames?: string[];
  toolExposureBudget?: {
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
  };
}

export interface PromptBuildSnapshot {
  systemPrompt: string;
  userPrompt: string;
}

export interface RuntimeContextSnapshot {
  language: string | null;
  templateId: string | null;
}

export interface DebugSnapshot {
  source: string;
}

export interface AgentRuntimeSnapshot extends IAgentRuntimeSnapshot {
  requestId: string;
  sessionId: string;
  agentKey: string;
  parentAgentRunId?: string;
  createdAt: number;
  /** v2 新增：请求级不可变进度上下文，用于 report_progress Hook 广播 */
  progressContext?: ProgressContext;
  modelSnapshot: ModelSelectionSnapshot;
  permissionSnapshot: PermissionSnapshot;
  ruleSnapshot: RuleSnapshot[];
  skillSnapshot: SkillSnapshot[];
  helpSnapshot: HelpSnapshot[];
  toolVisibilitySnapshot: ToolVisibilitySnapshot;
  promptSnapshot: PromptBuildSnapshot;
  contextSnapshot: RuntimeContextSnapshot;
  debugSnapshot: DebugSnapshot;
}

export interface RuntimeSnapshotDevtoolsSummary {
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
  toolExposureBudget: ToolVisibilitySnapshot['toolExposureBudget'] | null;
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
  context: RuntimeContextSnapshot;
  debug: DebugSnapshot;
}

export function buildRuntimeSnapshotDevtoolsSummary(
  snapshot: AgentRuntimeSnapshot,
): RuntimeSnapshotDevtoolsSummary {
  return {
    requestId: snapshot.requestId,
    agentKey: snapshot.agentKey,
    parentAgentRunId: snapshot.parentAgentRunId,
    model: {
      providerId: snapshot.modelSnapshot.providerId,
      model: snapshot.modelSnapshot.model,
    },
    permissions: {
      configuredTools: [...snapshot.permissionSnapshot.configuredTools],
      defaultDeny: snapshot.permissionSnapshot.defaultDeny,
      visibleToolTypes: [...snapshot.toolVisibilitySnapshot.allowedToolTypes],
      visibleFunctionCount: snapshot.toolVisibilitySnapshot.allowedFunctionNames.length,
      deferredFunctionCount: snapshot.toolVisibilitySnapshot.deferredFunctionNames?.length ?? 0,
    },
    toolExposureBudget: structuredClone(snapshot.toolVisibilitySnapshot.toolExposureBudget ?? null),
    deferredTools: [...(snapshot.toolVisibilitySnapshot.deferredFunctionNames ?? [])],
    knowledge: {
      ruleNames: snapshot.ruleSnapshot.map((rule) => rule.name),
      skillNames: snapshot.skillSnapshot.map((skill) => skill.name),
      helpMethods: snapshot.helpSnapshot.map((entry) => `${entry.tool}.${entry.method}`),
    },
    prompt: {
      systemPromptLength: snapshot.promptSnapshot.systemPrompt.length,
      userPromptLength: snapshot.promptSnapshot.userPrompt.length,
    },
    context: structuredClone(snapshot.contextSnapshot),
    debug: structuredClone(snapshot.debugSnapshot),
  };
}
