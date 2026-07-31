import type { PromptContext, ToolExposureTrace, VisibleToolSummary } from './types.js';
import type { BatchConfig } from '@ai-rpg/shared/types/tool';
import type { ToolExposureBudgetConfig } from '../../../../shared/src/types/agent-config.js';
import { estimateTokens } from '@ai-rpg/shared/utils/token-estimate';

export interface ToolMethodDefinition {
  name: string;
  description?: string;
  summary?: string;
  isWrite: boolean;
  parameters?: Record<string, unknown>;
  batch?: BatchConfig;
  returns?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolMethodInfo {
  toolName: string;
  methods: ToolMethodDefinition[];
}

export interface ToolSetResult {
  apiTools: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  allowedFunctionNames: Set<string>;
  visibleMethods: Map<string, ToolMethodInfo>;
  toolExposureTrace: ToolExposureTrace;
}

export interface ToolRegistryPort {
  getAvailableTools(
    agentType: string,
    allowedToolTypes?: string[]
  ): Array<{
    type: string;
    name: string;
    methods: Array<{
      name: string;
      description: string;
      summary?: string;
      isWrite: boolean;
      parameters: Record<string, unknown>;
      batch?: BatchConfig;
      returns?: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
      };
    }>;
  }>;
  getPermission(
    agentType: string,
    toolType: string
  ): { readAllowed: boolean; writeAllowed: boolean } | undefined;
}

export interface HelpRegistryPort {
  getHelpSummaryByMethod(
    toolType: string,
    method: string,
  ): {
    description: string;
    summary?: string;
    whenToUse?: string[];
    returnsSummary?: string;
  } | null;
}

export class ToolSet {
  private static readonly ALWAYS_VISIBLE_TOOL_TYPES = new Set(['help_service', 'skill_loader']);

  constructor(
    private registry: ToolRegistryPort,
    private helpRegistry?: HelpRegistryPort,
  ) {}

  private resolveBudget(
    config: ToolExposureBudgetConfig | undefined,
    candidateToolCount: number,
    candidateHelpDocCount: number,
  ) {
    return {
      maxVisibleTools: config?.maxVisibleTools ?? candidateToolCount,
      maxVisibleHelpDocs: config?.maxVisibleHelpDocs ?? candidateHelpDocCount,
      maxToolSummaryTokens: config?.maxToolSummaryTokens ?? Number.MAX_SAFE_INTEGER,
      maxHelpSummaryTokens: config?.maxHelpSummaryTokens ?? Number.MAX_SAFE_INTEGER,
      maxOnDemandLoadsPerTurn: config?.maxOnDemandLoadsPerTurn ?? 2,
    };
  }

  private buildHelpSummaryText(toolType: string, methodName: string, fallback: string): string {
    const helpSummary = this.helpRegistry?.getHelpSummaryByMethod(toolType, methodName);
    if (!helpSummary) {
      return fallback;
    }

    return [
      helpSummary.summary,
      helpSummary.description,
      ...(helpSummary.whenToUse ?? []),
      helpSummary.returnsSummary,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ');
  }

  filterVisibleMethods(
    agentKey: string,
    agentConfig: { tools: string[] },
    excludedMethods: Array<{ source: string; method: string }>,
  ): Map<string, ToolMethodInfo> {
    const tools = this.registry.getAvailableTools(agentKey);
    const writableTools = new Set(agentConfig.tools);
    const excludedSet = new Set(
      excludedMethods.map((e) => `${e.source}.${e.method}`),
    );
    const result = new Map<string, ToolMethodInfo>();

    for (const tool of tools) {
      const methods: ToolMethodDefinition[] = [];

      for (const method of tool.methods) {
        const isExcluded = excludedSet.has(`${tool.type}.${method.name}`);
        if (isExcluded) continue;

        if (method.isWrite && !writableTools.has(tool.type)) continue;

        methods.push({
          name: method.name,
          description: method.description,
          summary: (method as typeof method & { summary?: string }).summary,
          isWrite: method.isWrite,
          parameters: method.parameters,
          batch: method.batch,
          returns: method.returns,
        });
      }

      if (methods.length > 0) {
        result.set(tool.type, { toolName: tool.name, methods });
      }
    }

    return result;
  }

  build(ctx: PromptContext): ToolSetResult {
    const visibleMethods = this.filterVisibleMethods(
      ctx.agentKey,
      ctx.agentConfig,
      ctx.excludedMethods,
    );
    const toolCandidates = Array.from(visibleMethods.entries()).map(([toolType, info]) => {
      const methods = info.methods.map((method) => ({
        toolType,
        methodName: method.name,
        functionName: `${toolType}__${method.name}`,
        description: method.description ?? '',
        summary: this.buildHelpSummaryText(
          toolType,
          method.name,
          method.summary ?? method.description ?? '',
        ),
        riskLevel: method.isWrite ? 'write_high' : 'read_only' as const,
        parameters: method.parameters,
      }));

      return {
        toolType,
        methods,
        isAlwaysVisible: ToolSet.ALWAYS_VISIBLE_TOOL_TYPES.has(toolType),
        summaryTokens: methods.reduce((total, method) => total + estimateTokens(method.summary), 0),
      };
    });
    const budgetedToolCount = toolCandidates.filter((candidate) => !candidate.isAlwaysVisible).length;
    const budgetedHelpDocCount = toolCandidates
      .filter((candidate) => !candidate.isAlwaysVisible)
      .reduce((total, candidate) => total + candidate.methods.length, 0);
    const budget = this.resolveBudget(
      ctx.agentConfig.toolBudget as ToolExposureBudgetConfig | undefined,
      budgetedToolCount,
      budgetedHelpDocCount,
    );
    const trimmedReasons: string[] = [];
    const visibleTools: VisibleToolSummary[] = [];
    const deferredTools: VisibleToolSummary[] = [];
    let usedVisibleTools = 0;
    let usedToolSummaryTokens = 0;

    for (const candidate of toolCandidates) {
      const exceedsToolCount = !candidate.isAlwaysVisible && usedVisibleTools >= budget.maxVisibleTools;
      const exceedsToolTokens = !candidate.isAlwaysVisible
        && usedToolSummaryTokens + candidate.summaryTokens > budget.maxToolSummaryTokens;

      if (exceedsToolCount || exceedsToolTokens) {
        deferredTools.push(...candidate.methods.map((method) => ({
          toolType: method.toolType,
          methodName: method.methodName,
          functionName: method.functionName,
          summary: method.summary,
          riskLevel: method.riskLevel,
        } as import('./types.js').VisibleToolSummary)));
        if (exceedsToolCount && !trimmedReasons.includes('maxVisibleTools exceeded')) {
          trimmedReasons.push('maxVisibleTools exceeded');
        }
        if (exceedsToolTokens && !trimmedReasons.includes('maxToolSummaryTokens exceeded')) {
          trimmedReasons.push('maxToolSummaryTokens exceeded');
        }
        continue;
      }

      visibleTools.push(...candidate.methods.map((method) => ({
        toolType: method.toolType,
        methodName: method.methodName,
        functionName: method.functionName,
        summary: method.summary,
        riskLevel: method.riskLevel,
      } as import('./types.js').VisibleToolSummary)));
      if (!candidate.isAlwaysVisible) {
        usedVisibleTools += 1;
        usedToolSummaryTokens += candidate.summaryTokens;
      }
    }

    const visibleHelpSummaries: Array<{ tool: string; method: string }> = [];
    const helpBudgetVisibleTools: VisibleToolSummary[] = [];
    let usedHelpSummaryTokens = 0;
    for (const tool of visibleTools) {
      if (ToolSet.ALWAYS_VISIBLE_TOOL_TYPES.has(tool.toolType)) {
        helpBudgetVisibleTools.push(tool);
        continue;
      }

      const helpSummaryText = this.buildHelpSummaryText(tool.toolType, tool.methodName, tool.summary);
      const summaryTokens = estimateTokens(helpSummaryText);
      const exceedsHelpCount = visibleHelpSummaries.length >= budget.maxVisibleHelpDocs;
      const exceedsHelpTokens = usedHelpSummaryTokens + summaryTokens > budget.maxHelpSummaryTokens;
      if (exceedsHelpCount || exceedsHelpTokens) {
        deferredTools.push(tool);
        if (exceedsHelpCount && !trimmedReasons.includes('maxVisibleHelpDocs exceeded')) {
          trimmedReasons.push('maxVisibleHelpDocs exceeded');
        }
        if (exceedsHelpTokens && !trimmedReasons.includes('maxHelpSummaryTokens exceeded')) {
          trimmedReasons.push('maxHelpSummaryTokens exceeded');
        }
        continue;
      }
      helpBudgetVisibleTools.push(tool);
      visibleHelpSummaries.push({ tool: tool.toolType, method: tool.methodName });
      usedHelpSummaryTokens += summaryTokens;
    }

    const apiTools: ToolSetResult['apiTools'] = helpBudgetVisibleTools.map((entry) => {
      const method = visibleMethods.get(entry.toolType)?.methods.find((item) => item.name === entry.methodName);
      return {
        type: 'function',
        function: {
          name: entry.functionName,
          description: entry.summary,
          parameters: method?.parameters,
        },
      };
    });
    const allowedFunctionNames = new Set(helpBudgetVisibleTools.map((entry) => entry.functionName));
    // 预加载方法从 prompt 工具列表中隐藏（第一层），但仍允许 LLM 调用（第二层拒绝逻辑已删除）
    for (const excluded of ctx.excludedMethods) {
      allowedFunctionNames.add(`${excluded.source}__${excluded.method}`);
    }
    const finalUsedVisibleTools = new Set(
      helpBudgetVisibleTools
        .filter((tool) => !ToolSet.ALWAYS_VISIBLE_TOOL_TYPES.has(tool.toolType))
        .map((tool) => tool.toolType),
    ).size;
    const toolExposureTrace: ToolExposureTrace = {
      visibleTools: helpBudgetVisibleTools,
      deferredTools,
      visibleHelpSummaries,
      budget: {
        maxVisibleTools: budget.maxVisibleTools,
        usedVisibleTools: finalUsedVisibleTools,
        maxVisibleHelpDocs: budget.maxVisibleHelpDocs,
        usedVisibleHelpDocs: visibleHelpSummaries.length,
        maxToolSummaryTokens: budget.maxToolSummaryTokens,
        usedToolSummaryTokens: helpBudgetVisibleTools
          .filter((tool) => !ToolSet.ALWAYS_VISIBLE_TOOL_TYPES.has(tool.toolType))
          .reduce((total, tool) => total + estimateTokens(tool.summary), 0),
        maxHelpSummaryTokens: budget.maxHelpSummaryTokens,
        usedHelpSummaryTokens,
        maxOnDemandLoadsPerTurn: budget.maxOnDemandLoadsPerTurn,
        usedOnDemandLoads: 0,
      },
      trimmedReasons,
    };

    return { apiTools, allowedFunctionNames, visibleMethods, toolExposureTrace };
  }
}