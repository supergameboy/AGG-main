import type { ToolExposureBudgetConfig } from '../../../../shared/src/types/agent-config.js';

interface PromptContextOptions {}

export interface PromptContext {
  agentKey: string;
  agentConfig: {
    tools: string[];
    maxIterations?: number;
    toolBudget?: ToolExposureBudgetConfig;
    [key: string]: unknown;
  };
  excludedMethods: Array<{ source: string; method: string }>;
  language: string | null;
  templateId?: string;
  message: { payload?: { action?: string; intentHint?: string; data?: unknown } };
  templateContext: string | null;
  domain: Record<string, unknown>;
  options: PromptContextOptions;
}

export interface LayerBuildOutput {
  content: string | null;
  metadata: Record<string, unknown>;
}

export interface PromptLayer {
  readonly name: string;
  readonly order: number;
  build(ctx: PromptContext): Promise<LayerBuildOutput>;
}

export interface BlockBuildOutput {
  content: string | null;
  fields: FieldBuildResult[];
}

export interface PromptBlock {
  readonly name: string;
  build(ctx: PromptContext): Promise<BlockBuildOutput>;
}

export interface FieldMapping {
  key: string;
  label: string;
  extract: (ctx: PromptContext) => unknown;
  format: (value: unknown) => string;
}

export interface LayerBuildResult {
  name: string;
  order: number;
  content: string | null;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface SystemPromptBuildResult {
  content: string;
  totalTokens: number;
  layers: LayerBuildResult[];
}

export interface FieldBuildResult {
  key: string;
  label: string;
  present: boolean;
  content: string | null;
}

export interface BlockBuildResult {
  name: string;
  content: string | null;
  fields: FieldBuildResult[];
}

export interface UserPromptBuildResult {
  content: string;
  totalTokens: number;
  action: string | null;
  intentHint: string | null;
  blocks: BlockBuildResult[];
}

export interface VisibleToolSummary {
  toolType: string;
  methodName: string;
  functionName: string;
  summary: string;
  riskLevel: 'read_only' | 'write_low' | 'write_high';
}

export interface ToolExposureTrace {
  visibleTools: VisibleToolSummary[];
  deferredTools: VisibleToolSummary[];
  visibleHelpSummaries: Array<{ tool: string; method: string }>;
  budget: {
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
  trimmedReasons: string[];
}

export interface PromptBuildResult {
  systemPrompt: string;
  userPrompt: string;
  apiTools: unknown[];
  allowedFunctionNames: Set<string>;
  toolVisibilityTrace?: Array<{
    toolType: string;
    methodNames: string[];
  }>;
  toolExposureTrace?: ToolExposureTrace;
  systemPromptTrace?: SystemPromptBuildResult;
  userPromptTrace?: UserPromptBuildResult;
}