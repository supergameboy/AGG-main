import { LLMService, LLMMessageExtended, ChatOptions } from '@ai-rpg/ai';
import { ToolResult, AgentType } from '../../../shared/src/types/agent';
import { Timestamp, ID } from '../../../shared/src/types/core';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
// import { withTimeout, getTimeoutConfig } from '../utils/timeout.js'; // 超时已禁用
import { getTimeoutConfig } from '../utils/timeout.js';
import { parseLLMJson } from '../utils/llm-json.js';
import { estimateTokens } from '@ai-rpg/shared/utils/token-estimate';
import type { TraceCollector } from '../services/TraceCollector.js';
import type { DatabaseWriteQueue } from '../services/DatabaseWriteQueue';
import type { StagingPool } from '../services/StagingPool.js';
import type { ShadowStateLayer } from '../services/ShadowStateLayer.js';
import { ToolRegistry } from './ToolRegistry.js';
import { randomUUID } from 'crypto';
import type { HelpRegistry } from '../services/help-registry.js';
import type { ToolExposureRuntimeState } from './runtime/tool-exposure-budget.js';
import { consumeOnDemandLoad, resetOnDemandLoads } from './runtime/tool-exposure-budget.js';
import type { InjectedMethodState, IRequestScope } from '@ai-rpg/shared/types/tool';
import type { TaskContent, AuditReport } from '../../../shared/src/types/audit.js';
import type { ModelSwitchGuardConfig } from '../../../shared/src/types/agent-config.js';
import {
  ModelSwitchGuard,
  sameModelRef,
  type AgentLoopTurnUpdate,
  type ApiToolDefinition,
  type ModelRef,
  type PrepareNextTurnHook,
  type ThinkingLevel,
} from './runtime/prepare-next-turn.js';
import { mergeToolHookResult } from './runtime/tool-result-merge.js';
import type { AfterToolCallPatch } from './runtime/types.js';

const logger = createChildLogger('react-engine');

function hasInjectedMethod(
  injectedMethods: ReActEngineContext['injectedMethods'],
  toolType: string,
  method: string,
  requiredLevel: 'summary' | 'detail' = 'detail',
): boolean {
  return injectedMethods.some(
    (entry) =>
      entry.source === toolType
      && entry.method === method
      && (entry.level ?? 'detail') === requiredLevel,
  );
}

function markInjectedMethod(
  injectedMethods: ReActEngineContext['injectedMethods'],
  toolType: string,
  method: string,
  level: 'summary' | 'detail',
): void {
  const existing = injectedMethods.find(
    (entry) => entry.source === toolType && entry.method === method,
  );
  if (existing) {
    if ((existing.level ?? 'detail') === 'detail' || existing.level === level) {
      return;
    }
    existing.level = 'detail';
    return;
  }
  injectedMethods.push({ source: toolType, method, level });
}

// ─── 接口定义 ────────────────────────────────────────────────

export interface ReActEngineDeps {
  llmService: LLMService;
  toolRegistry: ToolRegistry;
  writeQueue?: DatabaseWriteQueue;
  helpRegistry?: HelpRegistry;
}

export interface ReActEngineContext {
  systemPrompt: string;
  userMessage: string;
  apiTools: NonNullable<ChatOptions['tools']>;
  allowedFunctionNames: Set<string>;
  injectedContext: string | null;
  injectedMethods: InjectedMethodState[];
  currentSaveId: ID;
  agentType: string;
  agentKey: string;
  maxIterations: number;
  forceStructuredOutput: boolean;
  temperature: number;
  maxTokens: number;
  providerId?: string;
  model?: string;
  currentAction: string | string[] | undefined;
  autoLoadOnFirstUse?: boolean;
  traceCollector?: TraceCollector;
  stagingPool?: StagingPool;
  shadowState?: ShadowStateLayer;
  /** 当前存档所属的模板ID，从 saves.template_id 解析，通过 context 传递 */
  templateId?: string;
  toolExposureState?: ToolExposureRuntimeState;
  syncToolExposureState?: (state: ToolExposureRuntimeState) => void;
  requestId?: string;
  /** 请求级 Service 缓存 + db 提供者（v1.5：替代 db: Knex 字段，D4 决策） */
  requestScope: IRequestScope;

  // H6 Hook: deterministic action pre-execution
  // If provided, these tool calls are pre-executed before the ReAct loop starts
  // and their results are injected as fake tool return messages
  preExecutedToolCalls?: Array<{
    toolName: string;     // e.g., 'inventory_service__list_inventory'
    displayName: string;  // e.g., '查询背包列表'
    result: Record<string, unknown>;  // pre-executed result
  }>;

  // === on_task_complete hook 相关字段（审核挂起-恢复模式） ===
  /**
   * 任务内容 - 所有 Agent 必填。
   * 用于 on_task_complete hook 审核去重和报告回传。
   * GM 从 todoList/storyDirective 构建，子 Agent 从 taskContract 构建。
   */
  taskContent?: TaskContent;

  /**
   * 审核报告 - 由 on_task_complete hook 通过 patch 注入。
   * Agent 在 prompt 构建时读取此字段，若存在则展示 issues 给 LLM 引导修复。
   */
  auditReport?: AuditReport;

  /**
   * 审核轮次 - 永远是 1（仅一轮，auditKey 去重保证）。
   * 与 auditReport 同时存在，标识当前 loop 处于"修复 iteration"阶段。
   */
  auditRound?: 1;

  // === M5: prepareNextTurn hook（循环内动态切模型，可选，缺省不启用） ===
  /**
   * 每轮 LLM 调用前调用的 turn 更新 hook（per-request 实例，由 AgentRuntime 注入）。
   * 返回 undefined 表示本轮无更新；返回的字段从下一轮起生效（pi `??` 语义）。
   */
  prepareNextTurn?: PrepareNextTurnHook;
  /** 模型切换 guard 配置（缺省用 ModelSwitchGuard 默认值） */
  prepareNextTurnGuard?: ModelSwitchGuardConfig;
}

export interface ReActEngineHooks {
  beforeToolCall?: (toolCall: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }) => Promise<{
    block?: boolean;
    reason?: string;
    patch?: {
      normalizedArguments?: Record<string, unknown>;
    };
    emittedEvents?: Array<Record<string, unknown>>;
  } | undefined>;
  afterToolCall?: (
    toolCall: {
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    },
    result: Record<string, unknown>,
    isError: boolean,
  ) => Promise<{
    /**
     * M4 §14.2：字段级覆盖 patch（AfterToolCallPatch，替代旧的 { result } 整体替换形态；
     * deprecated result 通道仍兼容——ToolExecutor 预合并后的完整结果信封经此通道回传）
     */
    patch?: AfterToolCallPatch;
    /**
     * M4 §14.2：循环早终止提示（对齐 pi terminate，首版仅透传）。
     * 引擎读到 true 时在 tool result message 的 _meta.terminate 标记，
     * 不改变循环控制流；消费方（M5+）后续从 message 读取。
     */
    terminate?: boolean;
    emittedEvents?: Array<Record<string, unknown>>;
  } | undefined>;
  transformMessages?: (messages: LLMMessageExtended[]) => Promise<LLMMessageExtended[]>;

  // H6 Hook: called when a deterministic action is pre-executed
  // Allows the caller to track which deterministic actions were executed
  onDeterministicAction?: (toolName: string, result: Record<string, unknown>) => void;

  // Trace hooks: called at key lifecycle points for execution tracing
  onIterationStart?: (iterationId: string, iterationNumber: number) => void;

  // Error hook: called when an error occurs during ReAct loop execution
  onError?: (error: Error, errorType?: string, recoverable?: boolean) => void;
}

export interface LlmDebugIssue {
  type: 'tool_failure' | 'data_inconsistency' | 'state_loss' | 'missing_dependency' | 'loop_detection';
  description: string;
  toolName?: string;
  expected?: unknown;
  actual?: unknown;
  context?: string;
}

export interface LlmDebugReport {
  agentType: string;
  issues: LlmDebugIssue[];
  raw?: unknown;
}

export interface ReActEngineResult {
  content: string;
  iterations: number;
  toolCalls: ToolResult[];
  usage?: { input: number; output: number };
  success?: boolean;
  /** LLM 自报告的 debug 信息（从 content 中剥离，供 DevTools 展示） */
  debug?: LlmDebugReport;
}

// ─── Fake Context Hook (H4/H6 unified) ──────────────────────

export interface FakeContextEntry {
  role: 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface FakeContextHook {
  // Build fake context messages to inject before the ReAct loop
  buildFakeContext(): FakeContextEntry[];
}

// ─── 工具调用签名 ────────────────────────────────────────────

export type CallToolFn = (
  toolType: string,
  method: string,
  params: Record<string, unknown>,
  saveId: ID,
  agentType: string,
) => Promise<ToolResult>;

// ─── 审核反馈消息构造（v5.2 EC2 核心） ──────────────────────────────

/**
 * 构建审核反馈 user message 文本（v5.2 新增，14.3 增强）。
 *
 * 当 ReActLoop continue 再次调用 reactEngine.execute 时，context.auditReport 存在，
 * 本函数将 auditReport 转换为 user message 文本，push 到 messages 数组。
 * Agent 在新一次 ReAct loop 内看到此 message，自主修复 issues。
 *
 * 关键架构点：
 * - ReActLoop 的 continue 是外层 while(true) 的 continue，会再次调用 reactEngine.execute
 * - reactEngine.execute 重新构建 messages 数组（不复用上一次的 messages）
 * - 所以 context.auditReport 可以在 reactEngine.execute 内部被读取并注入到 messages 数组
 * - 不需要重建 prompt（promptModule.build），只需要在 messages 初始化后追加一条 user message
 *
 * 14.3 审核反馈必须引导修改而非重新创建：
 * - 填充 suggestedFix（来自 AuditIssue.suggestedFix，由 AuditAgent.wrapFailures 生成）
 * - 新增 <current_state> 段：当前已存在实体清单（来自 AuditReport.currentState）
 * - 结尾明确修复策略：优先使用 update_xxx 修改已存在实体，create_xxx 会自动增量更新
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-hook-suspend-resume-refactor.md §5.2
 */
function buildAuditFeedbackMessage(auditReport: AuditReport): string {
  const sections: string[] = ['<audit_feedback>'];
  sections.push(`  <task>${auditReport.taskContent.description}</task>`);
  sections.push(`  <summary>${auditReport.summary}</summary>`);

  // 14.3 第3条：current_state 必须提供，列出当前已存在实体清单
  if (auditReport.currentState && auditReport.currentState.length > 0) {
    sections.push('  <current_state>');
    sections.push('    以下实体已存在，请优先使用 update_xxx 修改而非 create_xxx 重新创建：');
    for (const entity of auditReport.currentState) {
      sections.push(`    - ${entity}`);
    }
    sections.push('  </current_state>');
  }

  sections.push('  <issues>');
  for (const issue of auditReport.issues) {
    sections.push(`    <issue dimension="${issue.dimension}" severity="${issue.severity}">`);
    sections.push(`      <entity>${issue.entity}</entity>`);
    sections.push(`      <description>${issue.description}</description>`);
    if (issue.evidence) {
      sections.push(`      <evidence>${issue.evidence}</evidence>`);
    }
    if (issue.suggestedFix) {
      sections.push(`      <suggested_fix>${issue.suggestedFix}</suggested_fix>`);
    }
    sections.push('    </issue>');
  }
  sections.push('  </issues>');

  // 14.3 第2条：修复策略必须明确 modify vs recreate
  sections.push('  <repair_strategy>');
  sections.push('    1. 优先使用 update_xxx 修改已存在实体（避免重复创建）');
  sections.push('    2. 如需补充新实体，使用 create_xxx 会自动增量更新已存在数据（返回 alreadyExists=true + warnings）');
  sections.push('    3. 仅在实体确实不存在时才创建新实体');
  sections.push('    4. 请在本次 ReAct loop 内继续 iteration 修复上述 issues');
  sections.push('  </repair_strategy>');
  sections.push('</audit_feedback>');
  return sections.join('\n');
}

// ─── ReActEngine ─────────────────────────────────────────────

export class ReActEngine {
  private readonly llmService: LLMService;
  private readonly toolRegistry: ToolRegistry;
  private readonly writeQueue?: DatabaseWriteQueue;
  private readonly helpRegistry?: HelpRegistry;

  constructor(deps: ReActEngineDeps) {
    this.llmService = deps.llmService;
    this.toolRegistry = deps.toolRegistry;
    this.writeQueue = deps.writeQueue;
    this.helpRegistry = deps.helpRegistry;
  }

  async execute(
    context: ReActEngineContext,
    hooks?: ReActEngineHooks,
    callToolFn?: CallToolFn,
  ): Promise<ReActEngineResult> {
    const messages: LLMMessageExtended[] = [
      { role: 'system', content: context.systemPrompt },
      { role: 'user', content: context.userMessage },
    ];

    // 预加载上下文作为 user 消息注入：避免伪装 tool 调用暴露被屏蔽的工具名
    // injectedContext 已包含预加载数据契约（见 GM prompt），直接以 user 消息形式注入即可
    if (context.injectedMethods.length > 0 && context.injectedContext) {
      const preloadedMessages = this.buildPreloadedContextMessages(context.injectedContext);
      messages.push(...preloadedMessages);
    }

    // H6 Hook: inject pre-executed deterministic action results
    if (context.preExecutedToolCalls && context.preExecutedToolCalls.length > 0) {
      const fakeMessages = this.buildPreExecutedToolMessages(context.preExecutedToolCalls);
      messages.push(...fakeMessages);

      for (const preExec of context.preExecutedToolCalls) {
        if (hooks?.onDeterministicAction) {
          hooks.onDeterministicAction(preExec.toolName, preExec.result);
        }
      }
    }

    // v5.2 EC2: 审核反馈 user message 注入
    // 当 ReActLoop continue 再次调用 reactEngine.execute 时，context.auditReport 存在
    // 将 auditReport 转换为 user message，让 Agent 在新一次 ReAct loop 内看到 issues
    // 关键：reactEngine.execute 重新构建 messages（不复用上一次），所以这里能注入到新 messages
    if (context.auditReport && context.auditReport.issues.length > 0) {
      const auditFeedbackText = buildAuditFeedbackMessage(context.auditReport);
      messages.push({ role: 'user', content: auditFeedbackText });
    }

    let iterations = 0;
    let consecutiveFailures = 0;
    let previousMessageCount = messages.length;
    const MAX_CONSECUTIVE_FAILURES = 3;
    const toolCalls: ToolResult[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const timeoutConfig = getTimeoutConfig();
    const maxTotalTokens = timeoutConfig.reactMaxTokens;
    let estimatedTokens = 0;

    estimatedTokens += estimateTokens(context.systemPrompt) + estimateTokens(context.userMessage);

    // M5: prepareNextTurn 状态（per-execute() 新建，恢复重试时 guard 重置，baseline 取新 context 值）
    const turnGuard = new ModelSwitchGuard(context.prepareNextTurnGuard);
    const baselineModel: ModelRef = { providerId: context.providerId, model: context.model };
    let effectiveModel: ModelRef = { ...baselineModel };
    let effectiveThinkingLevel: ThinkingLevel | undefined;
    // v1.2 D5.4：全量替换形态；undefined = 未替换（用 context.apiTools）
    let effectiveApiTools: ApiToolDefinition[] | undefined;

    while (iterations < context.maxIterations) {
      if (resetOnDemandLoads(context.toolExposureState)) {
        context.syncToolExposureState?.(context.toolExposureState!);
      }

      if (estimatedTokens >= maxTotalTokens) {
        logger.warn(`ReAct loop approaching token limit, forcing termination`, {
          agent: context.agentKey,
          estimatedTokens,
          maxTotalTokens,
          iterations,
        });
        break;
      }

      iterations++;
      const iterationId = `iter:${randomUUID()}`;
      // M3 §14：日志仅当次迭代信息，禁止输出累计上下文（cumulativeMessages 已删除）
      logger.debug(`ReAct iteration ${iterations}/${context.maxIterations}`, {
        tag: 'REACT-ITER',
        requestId: context.requestId,
        iteration: iterations,
        agent: context.agentKey,
        currentIteration: iterations,
        maxIterations: context.maxIterations,
      });

      hooks?.onIterationStart?.(iterationId, iterations);

      const toolSectionsForTrace = this.extractToolSectionsForTrace(messages);

      context.traceCollector?.recordIteration({
        agentType: context.agentKey,
        iteration: iterations,
        maxIterations: context.maxIterations,
        llmInput: toolSectionsForTrace.length > 0
          ? { toolSections: toolSectionsForTrace, messageCount: messages.length }
          : undefined,
      });

      // M5: prepareNextTurn（在 transformMessages 之前，顺序固定见 M5 设计 §7.3）
      if (context.prepareNextTurn) {
        let update: AgentLoopTurnUpdate | undefined;
        try {
          update = await context.prepareNextTurn({
            iteration: iterations,
            maxIterations: context.maxIterations,
            messages,
            toolCalls,
            cumulativeTokens: { input: totalInputTokens, output: totalOutputTokens },
            currentModel: effectiveModel,
            baselineModel,
            switchState: turnGuard.snapshot(),
            agentKey: context.agentKey,
            currentSaveId: context.currentSaveId,
            apiTools: effectiveApiTools ?? context.apiTools,
          });
        } catch (hookError) {
          logger.warn('prepareNextTurn hook 抛错，降级为无更新', {
            agentKey: context.agentKey,
            iteration: iterations,
            error: getErrorMessage(hookError),
          });
          update = undefined;
        }
        if (update?.model) {
          const decision = turnGuard.evaluate({
            target: update.model,
            current: effectiveModel,
            baseline: baselineModel,
            iteration: iterations,
          });
          if (decision.allowed) {
            if (!sameModelRef(update.model, effectiveModel)) {
              turnGuard.recordSwitch(iterations);
              effectiveModel = {
                providerId: update.model.providerId ?? effectiveModel.providerId,
                model: update.model.model ?? effectiveModel.model,
              };
              logger.info('prepareNextTurn 模型切换生效', {
                agentKey: context.agentKey,
                iteration: iterations,
                providerId: effectiveModel.providerId,
                model: effectiveModel.model,
              });
            }
          } else {
            logger.warn('prepareNextTurn 模型切换被 guard 拒绝', {
              agentKey: context.agentKey,
              iteration: iterations,
              reason: decision.reason,
            });
          }
        }
        if (update?.thinkingLevel !== undefined) {
          effectiveThinkingLevel = update.thinkingLevel;
        }
        if (update?.tools) {
          // v1.2 D5.4：全量替换 context.apiTools（执行时白名单校验独立兜底，L1020）
          effectiveApiTools = update.tools;
        }
        if (update?.systemPromptOverride !== undefined && messages[0]?.role === 'system') {
          messages[0] = { ...messages[0], content: update.systemPromptOverride };
        }
      }

      // hooks.transformMessages: 允许调用方在每次 LLM 调用前变换消息
      const messagesForLLM = hooks?.transformMessages
        ? await hooks.transformMessages(messages)
        : messages;

      let response = await this.llmService.chatRaw(messagesForLLM, {
        tools: effectiveApiTools ?? context.apiTools,
        toolChoice: 'auto',
        temperature: context.temperature,
        maxTokens: context.maxTokens,
        responseFormat: context.forceStructuredOutput ? { type: 'json_object' } : undefined,
        providerId: effectiveModel.providerId,
        model: effectiveModel.model,
        reasoningEffort: effectiveThinkingLevel,
        agentType: context.agentKey,
        loggingMetadata: this.buildLoggingMetadata('react-loop', iterations, toolCalls.length),
        requestId: context.requestId,
        iteration: iterations,
        previousMessageCount,
      }, context.currentSaveId || undefined);

      if (response.usage) {
        totalInputTokens += response.usage.promptTokens;
        totalOutputTokens += response.usage.completionTokens;
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.info(`Agent ${context.agentKey} completed, ${iterations} iterations`, {
          tag: 'AGENT-END',
          requestId: context.requestId,
          agent: context.agentKey,
          iterations,
          totalTokens: totalInputTokens + totalOutputTokens,
          elapsed: 0,
          success: true,
          finishReason: response.finishReason,
          toolCallsExecuted: toolCalls.length,
        });

        if (response.content) {
          try {
            parseLLMJson(response.content, `ReActEngine:${context.agentKey}`);
            logger.info(`ReAct final response is valid JSON, skipping structured output generation`, {
              agent: context.agentKey,
            });
          } catch (parseError) {
            logger.debug('ReAct final response JSON parse failed', {
              agent: context.agentKey,
              error: getErrorMessage(parseError),
              contentPreview: response.content.slice(0, 200),
            });
            if (context.forceStructuredOutput) {
              logger.info(`ReAct final response not JSON despite forceStructuredOutput, generating structured output`, {
                agent: context.agentKey,
              });
            } else {
              logger.info(`ReAct final response not JSON, generating structured output with clean context`, {
                agent: context.agentKey,
              });
            }
            try {
              const structuredResult = await this.generateStructuredOutput(
                response.content,
                messages,
                iterations,
                toolCalls.length,
                context,
              );
              if (structuredResult.usage) {
                totalInputTokens += structuredResult.usage.promptTokens;
                totalOutputTokens += structuredResult.usage.completionTokens;
              }
              const { content: cleanContent, debug } = this.extractDebugFromContent(structuredResult.content, context.agentKey);
              return { content: cleanContent, iterations, toolCalls, usage: { input: totalInputTokens, output: totalOutputTokens }, debug };
            } catch (structError) {
              logger.warn('Structured output generation failed, using original response', {
                agent: context.agentKey,
                error: getErrorMessage(structError),
              });
            }
          }
        }

        const { content: finalContent, debug: finalDebug } = this.extractDebugFromContent(response.content, context.agentKey);
        return { content: finalContent, iterations, toolCalls, usage: { input: totalInputTokens, output: totalOutputTokens }, debug: finalDebug };
      }

      messages.push({
        role: 'assistant',
        content: response.content || '',
        reasoningContent: response.reasoningContent,
        toolCalls: response.toolCalls,
      });

      if (response.content) {
        estimatedTokens += estimateTokens(response.content);
      }

      const toolCallEntries: Array<{
        toolCall: typeof response.toolCalls[0];
        toolResult: Record<string, unknown>;
        hookEvents?: Array<Record<string, unknown>>;
      }> = [];
      for (const toolCall of response.toolCalls) {
        const startTime = Date.now();
        // 防御 LLM 幻觉调用不存在的工具名（如模仿审查指令标签 task_conformance_audit）。
        // 不合法的函数名直接拒绝，避免 parseFunctionName 抛异常导致整个 ReAct loop 崩溃。
        if (!toolCall.function.name.includes('__')) {
          logger.warn('Tool call rejected: invalid function name format', {
            agent: context.agentKey,
            functionName: toolCall.function.name,
            toolCallId: toolCall.id,
          });
          toolCallEntries.push({
            toolCall,
            toolResult: {
              success: false,
              error: `Unknown function: ${toolCall.function.name}. Only use tools listed in your available tools (format: toolType__methodName).`,
            } as Record<string, unknown>,
          });
          continue;
        }
        const [preToolType, preMethod] = this.parseFunctionName(toolCall.function.name);
        let preArgs: Record<string, unknown> = {};
        try { preArgs = JSON.parse(toolCall.function.arguments); } catch (parseError) {
          logger.debug('Tool call arguments JSON.parse failed', {
            agent: context.agentKey,
            rawArgs: toolCall.function.arguments,
            error: getErrorMessage(parseError),
          });
        }
        logger.info(`Tool call: ${preToolType}.${preMethod}`, {
          tag: 'TOOL-CALL',
          requestId: context.requestId,
          iteration: iterations,
          agent: context.agentKey,
          toolType: preToolType,
          method: preMethod,
          toolCallId: toolCall.id,
          args: preArgs,
          isPreExecuted: false,
        });

        let normalizedToolCall = toolCall;
        let hookEvents: Array<Record<string, unknown>> = [];
        if (hooks?.beforeToolCall) {
          const hookResult = await hooks.beforeToolCall(toolCall);
          if (hookResult?.emittedEvents?.length) {
            hookEvents.push(...hookResult.emittedEvents);
          }
          if (hookResult?.block) {
            logger.info(`Tool call blocked by beforeToolCall hook`, {
              agent: context.agentKey,
              functionName: toolCall.function.name,
              reason: hookResult.reason,
            });
            toolCallEntries.push({
              toolCall,
              toolResult: {
                success: false,
                error: hookResult.reason || 'Tool call blocked by hook',
              } as Record<string, unknown>,
              hookEvents: hookEvents.length > 0 ? hookEvents : undefined,
            });
            continue;
          }
          if (hookResult?.patch?.normalizedArguments) {
            normalizedToolCall = {
              ...toolCall,
              function: {
                ...toolCall.function,
                arguments: JSON.stringify(hookResult.patch.normalizedArguments),
              },
            };
          }
        }

        // autoLoadOnFirstUse: 首次调用工具方法时自动注入帮助文档
        const [toolType, method] = this.parseFunctionName(normalizedToolCall.function.name);
        const alreadyInjected = hasInjectedMethod(context.injectedMethods, toolType, method, 'detail');

        if (
          context.autoLoadOnFirstUse
          && !alreadyInjected
          && this.helpRegistry
          && this.helpRegistry.hasHelp(toolType, method)
        ) {
          const helpContent = await this.helpRegistry.getHelp(toolType, method);
          if (helpContent) {
            const budgetResult = consumeOnDemandLoad(context.toolExposureState);
            if (!budgetResult.success) {
              logger.info(`autoLoadOnFirstUse skipped because budget exhausted for ${toolType}.${method}`, {
                agent: context.agentKey,
              });
            } else {
              markInjectedMethod(context.injectedMethods, toolType, method, 'detail');
              context.syncToolExposureState?.(context.toolExposureState!);
              logger.info(`autoLoadOnFirstUse: injecting help for ${toolType}.${method}`, {
                agent: context.agentKey,
              });

              const formattedHelp = this.helpRegistry.formatHelpForPrompt(helpContent, toolType, method);

              // 拦截工具调用，注入帮助后让LLM重新决策
              // 自动注入帮助后，将该方法加入 allowedFunctionNames，确保 LLM 可以调用
              const autoFunctionName = `${toolType}__${method}`;
              if (!context.allowedFunctionNames.has(autoFunctionName)) {
                context.allowedFunctionNames.add(autoFunctionName);
              }

              toolCallEntries.push({
                toolCall: normalizedToolCall,
                toolResult: {
                  success: true,
                  data: { help: formattedHelp, _autoInjected: true },
                } as Record<string, unknown>,
                hookEvents: hookEvents.length > 0 ? hookEvents : undefined,
              });
              continue;
            }
          }
        }

        const toolResult = await this.executeToolCall(normalizedToolCall, context, callToolFn, hooks);
        const duration = Date.now() - startTime;

        let finalResult = toolResult;
        if (hooks?.afterToolCall) {
          const hookResult = await hooks.afterToolCall(normalizedToolCall, toolResult, !toolResult.success);
          const mergeOutcome = mergeToolHookResult(
            toolResult,
            [hookResult?.patch],
          );
          finalResult = mergeOutcome.result;
          // M4 §14.2：terminate 双通道 OR 汇合——ToolExecutor 预合并后经 hook 返回值的
          // terminate 独立字段透传；直连引擎的 hook 也可经 patch.terminate 由引擎侧 merge 提取
          const terminate = hookResult?.terminate === true || mergeOutcome.terminate;
          if (terminate) {
            // M4 §14.2：在 tool result 的 _meta.terminate 标记（首版仅透传，不改变循环
            // 控制流；随信封流入 ToolResult 记录，消费方 M5+ 从记录的 _meta 读取）
            finalResult = {
              ...finalResult,
              _meta: { ...(finalResult._meta as Record<string, unknown> | undefined), terminate: true },
            };
          }
          if (hookResult?.emittedEvents?.length) {
            hookEvents.push(...hookResult.emittedEvents);
          }
        }

        // 命中后加载全文：LLM 通过 help_service 发现并加载某个 deferred 工具的帮助全文后，
        // 将该工具方法加入 allowedFunctionNames，使其在后续迭代中可被调用
        if (toolResult.success && (toolType === 'help_service')) {
          const helpMethod = method; // get_tool_help_detail / get_tool_help
          if (helpMethod === 'get_tool_help_detail' || helpMethod === 'get_tool_help') {
            try {
              const helpArgs = JSON.parse(normalizedToolCall.function.arguments);
              const helpTargetType = helpArgs.toolType as string;
              const helpTargetMethod = helpArgs.method as string;
              if (helpTargetType && helpTargetMethod) {
                const helpTargetFunctionName = `${helpTargetType}__${helpTargetMethod}`;
                if (!context.allowedFunctionNames.has(helpTargetFunctionName)) {
                  context.allowedFunctionNames.add(helpTargetFunctionName);
                }
              }
            } catch (parseError) {
              logger.debug('help_service args JSON.parse failed', {
                agent: context.agentKey,
                rawArgs: normalizedToolCall.function.arguments,
                error: getErrorMessage(parseError),
              });
            }
          }
        }

        const isReadOperation = !finalResult.writeOperation;
        context.traceCollector?.recordIteration({
          agentType: context.agentKey,
          iteration: iterations,
          maxIterations: context.maxIterations,
          toolCall: {
            tool: normalizedToolCall.function.name,
            args: (() => { try { return JSON.parse(normalizedToolCall.function.arguments); } catch { return {}; } })(),
            resultPreview: typeof finalResult.data === 'string'
              ? finalResult.data.slice(0, 200)
              : finalResult.data !== undefined && finalResult.data !== null
                ? JSON.stringify(finalResult.data).slice(0, 200)
                : '(no data)',
            duration,
            isReadOperation,
          },
        });

        const [resultToolType, resultMethod] = this.parseFunctionName(normalizedToolCall.function.name);
        const compressedResult = this.compressToolResult(finalResult);
        const originalSize = JSON.stringify(finalResult).length;
        const compressedSize = compressedResult.length;
        logger.info(`Tool result: ${resultToolType}.${resultMethod} → ${finalResult.success !== false ? 'success' : 'error'}`, {
          tag: 'TOOL-RESULT',
          requestId: context.requestId,
          iteration: iterations,
          agent: context.agentKey,
          toolType: resultToolType,
          method: resultMethod,
          toolCallId: normalizedToolCall.id,
          success: finalResult.success !== false,
          resultData: finalResult,
          originalSize,
          compressedSize,
          isPreExecuted: false,
        });

        toolCallEntries.push({
          toolCall: normalizedToolCall,
          toolResult: finalResult,
          hookEvents: hookEvents.length > 0 ? hookEvents : undefined,
        });
      }

      let batchHasSuccess = false;
      for (const { toolCall, toolResult, hookEvents } of toolCallEntries) {
        const isAutoInjected = (toolResult as Record<string, unknown>)._autoInjected === true;

        toolCalls.push({
          id: this.generateId(),
          toolCallId: toolCall.id || this.generateId(),
          success: toolResult.success as boolean,
          data: toolResult.data,
          error: toolResult.error as string | undefined,
          timestamp: Date.now() as Timestamp,
          hookEvents,
          _meta: toolResult._meta as ToolResult['_meta'],
          writeOperation: toolResult.writeOperation as {
            toolType: string; method: string; params: Record<string, unknown>;
            result: unknown; timestamp: Timestamp;
          } | undefined,
        });

        if (!toolResult.success) {
          if (toolResult.error && String(toolResult.error).includes('Permission denied')) {
            toolResult.error = `${toolResult.error}. 你没有权限执行此操作，请直接生成最终回复，不要再尝试调用此工具。`;
          }
        } else {
          batchHasSuccess = true;
        }

        // autoLoadOnFirstUse 注入的帮助：特殊格式提示LLM重新调用
        const toolMessageContent = isAutoInjected
          ? this.formatAutoInjectedHelpMessage(toolResult)
          : this.compressToolResult(toolResult);

        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          name: toolCall.function.name,
          content: toolMessageContent,
        });

        estimatedTokens += estimateTokens(toolMessageContent);
      }

      // 增量消息追踪：记录本轮新增的消息
      const newMessages = messages.slice(previousMessageCount);
      if (newMessages.length > 0 && iterations > 1) {
        logger.info(`ReAct delta: +${newMessages.length} messages for ${context.agentKey} iteration ${iterations}`, {
          tag: 'REACT-DELTA',
          requestId: context.requestId,
          iteration: iterations,
          agent: context.agentKey,
          deltaMessages: newMessages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content.substring(0, 500) : JSON.stringify(m.content).substring(0, 500),
            toolCallId: m.toolCallId,
            toolCalls: m.toolCalls,
            isPreExecuted: (m as any).metadata?.isPreExecuted || false,
          })),
        });
      }
      previousMessageCount = messages.length;

      if (!batchHasSuccess && toolCallEntries.length > 0) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.warn(`ReAct loop: ${MAX_CONSECUTIVE_FAILURES} consecutive tool failures, forcing termination`, {
            agent: context.agentKey,
            iterations,
          });
          messages.push({
            role: 'user',
            content: `系统提示：你已经连续${consecutiveFailures}次工具调用失败，请立即停止调用工具，直接根据已有信息生成最终JSON回复。不要再尝试任何工具调用。`,
          });
          const forceResponse = await this.llmService.chatRaw(messages, {
            temperature: Math.min(context.temperature * 0.5, 0.4),
            maxTokens: context.maxTokens,
            responseFormat: { type: 'json_object' },
            providerId: context.providerId,
            model: context.model,
            agentType: context.agentKey,
            loggingMetadata: this.buildLoggingMetadata('react-force-final', iterations, toolCalls.length),
          }, context.currentSaveId || undefined);
          if (forceResponse.usage) {
            totalInputTokens += forceResponse.usage.promptTokens;
            totalOutputTokens += forceResponse.usage.completionTokens;
          }
          return { content: forceResponse.content, iterations, toolCalls, usage: { input: totalInputTokens, output: totalOutputTokens } };
        }
      } else {
        consecutiveFailures = 0;
      }
    }

    logger.warn(`Agent ${context.agentKey} reached max iterations: ${context.maxIterations}`, {
      tag: 'AGENT-END',
      requestId: context.requestId,
      agent: context.agentKey,
      iterations,
      totalTokens: totalInputTokens + totalOutputTokens,
      elapsed: 0,
      success: false,
      finishReason: 'max_iterations',
      toolCallsExecuted: toolCalls.length,
    });

    context.traceCollector?.setReachedMax(context.agentKey, true);

    const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
    const lastContent = lastAssistantMsg?.content;
    const reactSummary = typeof lastContent === 'string'
      ? lastContent
      : Array.isArray(lastContent)
        ? lastContent.map(c => c.type === 'text' ? c.text : '').join('')
        : '';

    try {
      const structuredResult = await this.generateStructuredOutput(
        reactSummary, messages, iterations, toolCalls.length, context,
      );
      if (structuredResult.usage) {
        totalInputTokens += structuredResult.usage.promptTokens;
        totalOutputTokens += structuredResult.usage.completionTokens;
      }
      return { content: structuredResult.content, iterations, toolCalls, usage: { input: totalInputTokens, output: totalOutputTokens } };
    } catch (finalError) {
      logger.error('Structured output generation failed after max iterations, returning raw data', {
        agent: context.agentKey,
        error: getErrorMessage(finalError),
      });
      return {
        content: reactSummary || 'Processing completed but final response generation failed.',
        iterations,
        toolCalls,
        usage: { input: totalInputTokens, output: totalOutputTokens },
      };
    }
  }

  // ─── 私有方法 ──────────────────────────────────────────────

  private async generateStructuredOutput(
    reactResult: string,
    originalMessages: LLMMessageExtended[],
    iterations: number,
    toolCallsCount: number,
    context: ReActEngineContext,
  ): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
    // const timeoutConfig = getTimeoutConfig(); // 超时已禁用

    const toolResults = originalMessages
      .filter(m => m.role === 'tool')
      .map(m => m.content)
      .join('\n');

    const outputFormatHint = context.agentKey === 'output'
      ? `\n\nCRITICAL FORMAT RULE for output agent:\n1. Output a complete JSON object with "dialogue" and "ui" fields only\n2. "ui" must only contain "intensity" field, do NOT include "components" in JSON\n3. After the JSON closing }, add a new line with "---UI---" separator\n4. Write all :::component syntax AFTER the ---UI--- line\n5. This separation ensures the JSON is always valid`
      : '';

    const cleanMessages: LLMMessageExtended[] = [
      { role: 'system', content: context.systemPrompt },
      {
        role: 'user',
        content: `Based on the following analysis results, generate your final response as a JSON object matching your output format specification. Output pure JSON without markdown code blocks. Respond in Chinese.${outputFormatHint}

Analysis result:
${reactResult}

${toolResults ? `Tool data collected:\n${toolResults}` : ''}`,
      },
    ];

    // 超时已禁用：直接执行，不包裹 withTimeout
    const structuredResponse = await this.llmService.chatRaw(cleanMessages, {
        temperature: Math.min(context.temperature * 0.5, 0.4),
        maxTokens: context.maxTokens,
        responseFormat: { type: 'json_object' },
        providerId: context.providerId,
        model: context.model,
        agentType: context.agentKey,
        loggingMetadata: this.buildLoggingMetadata('react-structured-output', iterations, toolCallsCount),
      }, context.currentSaveId || undefined);
    // const structuredResponse = await withTimeout(
    //   this.llmService.chatRaw(cleanMessages, {
    //     temperature: Math.min(context.temperature * 0.5, 0.4),
    //     maxTokens: context.maxTokens,
    //     responseFormat: { type: 'json_object' },
    //     providerId: context.providerId,
    //     model: context.model,
    //     agentType: context.agentKey,
    //     loggingMetadata: this.buildLoggingMetadata('react-structured-output', iterations, toolCallsCount),
    //   }, context.currentSaveId || undefined),
    //   {
    //     timeoutMs: timeoutConfig.reactIteration,
    //     context: `ReActEngine(${context.agentKey}) structured output generation`,
    //   },
    // );

    return { content: structuredResponse.content, usage: structuredResponse.usage };
  }

  private async executeToolCall(
    toolCall: {
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    },
    context: ReActEngineContext,
    callToolFn?: CallToolFn,
    hooks?: ReActEngineHooks,
  ): Promise<Record<string, unknown>> {
    try {
      const functionName = toolCall.function.name;

      if (!context.allowedFunctionNames.has(functionName)) {
        logger.warn('Tool call rejected: function not in allowed list', { agent: context.agentKey, functionName, allowedCount: context.allowedFunctionNames.size });
        return { success: false, error: `Unknown function: ${functionName}. Only use tools listed in your available tools.` };
      }

      const args = JSON.parse(toolCall.function.arguments);
      const [toolType, method] = this.parseFunctionName(functionName);

      // 优先使用外部注入的 callToolFn，否则走 ToolRegistry
      let result: ToolResult;
      if (callToolFn) {
        result = await callToolFn(toolType, method, args, context.currentSaveId, context.agentKey as AgentType);
      } else {
        result = await this.executeViaToolRegistry(
          toolType, method, args, context.currentSaveId, context.agentKey as AgentType,
          context.stagingPool, context.shadowState, context.templateId,
          context.requestScope,
          hooks,
        );
      }

      return {
        success: result.success,
        data: result.data,
        error: result.error,
        _meta: result._meta,
        writeOperation: result.writeOperation,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Tool call execution failed`, {
        agent: context.agentKey,
        toolCallId: toolCall.id,
        error: errorMessage,
      });
      hooks?.onError?.(error instanceof Error ? error : new Error(errorMessage), 'tool_execution', true);
      return { success: false, error: errorMessage };
    }
  }

  /** 通过 ToolRegistry 执行工具调用（默认路径） */
  private async executeViaToolRegistry(
    toolType: string,
    method: string,
    params: Record<string, unknown>,
    saveId: ID,
    agentType: AgentType,
    stagingPool: StagingPool | undefined,
    shadowState: ShadowStateLayer | undefined,
    templateId: string | undefined,
    requestScope: IRequestScope,
    hooks: ReActEngineHooks | undefined,
  ): Promise<ToolResult> {
    const toolCallId = this.generateId();
    const timestamp = Date.now() as Timestamp;

    try {
      const response = await this.toolRegistry.execute(
        agentType,
        toolType as import('../../../shared/src/types/agent').ToolType,
        method,
        params,
        {
          saveId,
          agentType,
          timestamp,
          writeQueue: this.writeQueue,
          stagingPool,
          shadowState,
          agentSource: agentType === 'gamemaster' ? 'gamemaster' : 'subagent',
          templateId,
          requestScope,
        },
      );

      return {
        id: this.generateId(),
        toolCallId,
        success: response.success,
        data: response.data as Record<string, unknown>,
        error: response.error,
        timestamp: Date.now() as Timestamp,
        _meta: { toolType, method, params },
        writeOperation: response.writeOperation,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Tool execution failed in executeViaToolRegistry', {
        agent: agentType,
        toolType,
        method,
        toolCallId,
        error: errorMessage,
      });
      hooks?.onError?.(error instanceof Error ? error : new Error(errorMessage), 'tool_execution', true);
      return {
        id: this.generateId(),
        toolCallId,
        success: false,
        error: errorMessage,
        timestamp: Date.now() as Timestamp,
      };
    }
  }

  /**
   * 从 LLM 响应 content 中提取并剥离 _debug 字段。
   * - 解析 content JSON，若含 _debug 字段则提取到 LlmDebugReport
   * - 从对象中 delete _debug 后重新 stringify 作为新 content
   * - 解析失败或无 _debug 字段时返回原 content，debug 为 undefined
   */
  private extractDebugFromContent(
    content: string,
    agentKey: string,
  ): { content: string; debug?: LlmDebugReport } {
    if (!content) return { content };

    try {
      const parsed = parseLLMJson<Record<string, unknown>>(content, `ReActEngine.extractDebug:${agentKey}`);
      if (!parsed || typeof parsed !== 'object' || !('_debug' in parsed)) {
        return { content };
      }

      const rawDebug = parsed._debug as Record<string, unknown>;
      const rawIssues = Array.isArray(rawDebug?.issues) ? rawDebug.issues : [];
      const validTypes = new Set<LlmDebugIssue['type']>([
        'tool_failure', 'data_inconsistency', 'state_loss', 'missing_dependency', 'loop_detection',
      ]);

      const issues: LlmDebugIssue[] = rawIssues.map((issue: unknown) => {
        const i = (issue ?? {}) as Record<string, unknown>;
        const type = typeof i.type === 'string' && validTypes.has(i.type as LlmDebugIssue['type'])
          ? i.type as LlmDebugIssue['type']
          : 'data_inconsistency';
        return {
          type,
          description: typeof i.description === 'string' ? i.description : '',
          toolName: typeof i.toolName === 'string' ? i.toolName : undefined,
          expected: i.expected,
          actual: i.actual,
          context: typeof i.context === 'string' ? i.context : undefined,
        };
      });

      const debug: LlmDebugReport = {
        agentType: agentKey,
        issues,
        raw: rawDebug,
      };

      // 从对象中剥离 _debug，重新 stringify
      delete parsed._debug;
      const cleanContent = JSON.stringify(parsed);

      logger.info(`[LLM_DEBUG] ${agentKey} reported ${issues.length} issue(s)`, {
        agent: agentKey,
        issueCount: issues.length,
        types: issues.map(i => i.type),
      });

      return { content: cleanContent, debug };
    } catch {
      // 解析失败不影响主流程
      return { content };
    }
  }

  private parseFunctionName(functionName: string): [string, string] {
    const separator = functionName.lastIndexOf('__');
    if (separator === -1) {
      throw new Error(`Invalid function name format: ${functionName}. Expected: toolType__methodName`);
    }
    const toolType = functionName.substring(0, separator);
    const method = functionName.substring(separator + 2);
    return [toolType, method];
  }

  private static readonly TOOL_RESULT_EXCLUDED_KEYS = new Set([
    'created_at', 'updated_at',
    'saveId', 'save_id',
  ]);

  private compressToolResult(toolResult: Record<string, unknown>): string {
    if (!toolResult.success) {
      // batch 部分失败时 data 是每项结果的数组，必须保留每项的 success/error/message
      // 否则 LLM 只看到 "1 项执行失败"，无法定位哪项失败及原因，盲猜重试相同参数
      // 会触发 3 consecutive tool failures 强制终止
      if (Array.isArray(toolResult.data)) {
        return JSON.stringify({
          success: false,
          error: toolResult.error ?? 'Batch execution failed',
          data: toolResult.data,
        });
      }
      const error = toolResult.error || this.extractErrorFromData(toolResult.data) || 'Execution failed';
      return JSON.stringify({ success: false, error });
    }

    const compressed: Record<string, unknown> = { success: true };

    if (toolResult.data !== undefined) {
      const data = toolResult.data;
      if (typeof data === 'object' && data !== null) {
        compressed.data = this.stripExcludedKeys(data);
      } else {
        compressed.data = data;
      }
    }

    if (toolResult.message) {
      compressed.message = toolResult.message;
    }

    const subAgentSummary = toolResult._subAgentSummary as string | undefined;
    if (subAgentSummary) {
      compressed.subAgentSummary = subAgentSummary;
    }

    return JSON.stringify(compressed);
  }

  /**
   * 格式化 autoLoadOnFirstUse 自动注入的帮助消息
   * 告知LLM这是帮助文档，提示其根据帮助内容重新调用工具
   */
  private formatAutoInjectedHelpMessage(toolResult: Record<string, unknown>): string {
    const helpData = toolResult.data as { help?: string } | undefined;
    const helpContent = helpData?.help ?? '';
    return [
      '【系统自动注入】以下是此工具方法的详细帮助文档，请仔细阅读后重新调用：',
      '',
      helpContent,
      '',
      '请根据以上帮助文档，使用正确的参数重新调用此工具方法。',
    ].join('\n');
  }

  private extractErrorFromData(data: unknown): string | null {
    if (Array.isArray(data)) {
      const firstError = data.find(d => d && typeof d === 'object' && 'error' in (d as Record<string, unknown>));
      if (firstError) {
        return String((firstError as Record<string, unknown>).error);
      }
    }
    return null;
  }

  private stripExcludedKeys(data: unknown): unknown {
    if (Array.isArray(data)) {
      return data.map(item => this.stripExcludedKeys(item));
    }
    if (typeof data === 'object' && data !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (ReActEngine.TOOL_RESULT_EXCLUDED_KEYS.has(key)) continue;
        if (typeof value === 'string' && value.length > 500) {
          result[key] = value.substring(0, 500) + '...[truncated]';
        } else if (typeof value === 'object' && value !== null) {
          result[key] = this.stripExcludedKeys(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    return data;
  }

  /**
   * 构建预加载上下文消息。
   *
   * 设计理由：预加载数据作为 user 消息注入，而非伪装成 tool 调用。
   * 旧实现（buildFakeToolReturnMessages）通过伪造 assistant.toolCalls 和 tool 消息暴露被屏蔽的工具名，
   * 导致 LLM 通过 in-context learning 学到这些工具可调用，产生 "Unknown function" 错误。
   * 改用 user 消息注入后，injectedContext 包含预加载数据契约（见 GM prompt），
   * 既保留预加载数据，又不暴露工具名。
   */
  private buildPreloadedContextMessages(injectedContext: string): LLMMessageExtended[] {
    logger.info('Injected preloaded context as user message', {
      contextLength: injectedContext.length,
    });
    return [{
      role: 'user',
      content: injectedContext,
    }];
  }

  private buildPreExecutedToolMessages(
    preExecutedToolCalls: NonNullable<ReActEngineContext['preExecutedToolCalls']>,
  ): LLMMessageExtended[] {
    const messages: LLMMessageExtended[] = [];

    const toolCalls = preExecutedToolCalls.map((preExec, i) => ({
      id: `preexec_tc_${i}_${Date.now()}`,
      type: 'function' as const,
      function: {
        name: preExec.toolName,
        arguments: '{}',
      },
    }));

    messages.push({
      role: 'assistant',
      content: '',
      // 预执行动作无真实推理过程，但 deepseek thinking 模式要求带 tool_calls 的 assistant message 必须有非空 reasoning_content，否则返回 400
      reasoningContent: '预执行确定性动作，无需推理。',
      toolCalls,
    });

    for (let i = 0; i < preExecutedToolCalls.length; i++) {
      const preExec = preExecutedToolCalls[i];
      messages.push({
        role: 'tool',
        toolCallId: toolCalls[i].id,
        name: preExec.toolName,
        content: JSON.stringify(preExec.result),
        metadata: { isPreExecuted: true },
      } as LLMMessageExtended);
    }

    logger.info('Injected pre-executed deterministic action messages', {
      actionCount: preExecutedToolCalls.length,
      actions: preExecutedToolCalls.map(p => p.toolName),
    });

    return messages;
  }

  private extractToolSectionsForTrace(
    messages: LLMMessageExtended[],
  ): Array<{ section: string; fields: string[] }> {
    const result: Array<{ section: string; fields: string[] }> = [];
    for (const m of messages) {
      if (m.role === 'tool' && typeof m.content === 'string') {
        const sectionMatch = m.content.match(/^## (.+?)(?:\n|$)/);
        const sectionTitle = sectionMatch ? sectionMatch[1] : m.content.substring(0, 80);
        const fields: string[] = [];
        const fieldMatches = m.content.matchAll(/"?(\w+)"?\s*:\s*("?[^,\n]{1,60}"?)/g);
        for (const fm of fieldMatches) {
          fields.push(`${fm[1]}=${fm[2]}`);
        }
        result.push({ section: sectionTitle, fields: fields.slice(0, 10) });
      }
    }
    return result;
  }

  private buildLoggingMetadata(
    stage: string,
    reactIterations: number,
    toolCallsCount: number,
  ): NonNullable<ChatOptions['loggingMetadata']> {
    return { stage, reactIterations, toolCallsCount };
  }

  private generateId(): ID {
    return randomUUID() as ID;
  }
}