/**
 * ReActLoop: 从 ReActAgent 提取的循环相关参数化函数集合。
 *
 * 设计目标：
 * - 分离循环逻辑和状态管理（状态由 AgentRuntime 管理）
 * - 零 value import services/（所有依赖通过 deps 注入）
 * - 零 value import game-systems/
 *
 * 详见 docs/design/fractal-design-20260626-backend-decoupling-refactor/
 *   fractal-design-20260626-backend-decoupling-refactor-模块B-Agent核心纯化.md 3.5 节
 */

// === type imports（零 value import services/） ===
import type { ReActEngine, ReActEngineContext, ReActEngineHooks, ReActEngineResult, CallToolFn } from './ReActEngine.js';
import type { RecoveryPlanner, RecoveryDecision, RecoveryPlannerInput } from './runtime/recovery-planner.js';
import type { AgentHookResult } from './runtime/agent-hooks.js';
import type { OnTaskCompletePatch } from './runtime/types.js';
import type { AgentResponse } from './types.js';
import type { PromptBuildResult, PromptContext } from './prompt/types.js';
import type { StagingPool } from '../services/StagingPool.js';
import type { ShadowStateLayer } from '../services/ShadowStateLayer.js';
import type { RequestScope } from '../services/RequestScope.js';
import type { ToolExposureRuntimeState } from './runtime/tool-exposure-budget.js';
import type { ExecutionTraceIds } from '../../../shared/src/types/execution-trace.js';
import type { ToolAbortSignal } from '@ai-rpg/shared/tool-core';
import type {
  AgentType,
  StandardAgentOutput,
  AgentUserContent,
  DialogueOption,
  NeedAgentRequest,
  ToolResult,
  TaskCenteredOutput,
  TaskStatus,
  TaskReport,
  TaskReportChange,
  ActionRecord,
  EntityRef,
  TaskResults,
  AgentMeta,
} from '../../../shared/src/types/agent';
import type { PanelUpdates } from '../../../shared/src/types/dynamic-ui';

// === value imports（仅 utils 和 @ai-rpg/ai，不 import services/） ===
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { parseLLMJson } from '../utils/llm-json.js';
import { createChildLogger } from '../utils/logger.js';
import { LLM_DEFAULTS } from '@ai-rpg/ai';

const logger = createChildLogger('react-loop');

// === 内部常量 ===

const MAX_PARSE_RETRIES = 3;

const ALLOWED_NEED_AGENT_REASONS = ['generate', 'correct', 'coordinate'] as const;
type NeedAgentReason = (typeof ALLOWED_NEED_AGENT_REASONS)[number];

// === 接口定义 ===

interface HookModelOverride {
  providerId?: string | null;
  model?: string | null;
  temperature?: number;
  maxTokens?: number;
}

export interface RecoveryState {
  attempts: number;
  readonlyMode: boolean;
}

/**
 * 请求上下文（与 ReActAgent.RequestContext 结构一致）。
 *
 * ReActLoop 函数仅访问 intentHint/skillUsed/rulesTriggered/tokenUsage 四个字段，
 * 其余字段由 AgentRuntime 通过 deps 回调消费（buildTraceIds/dispatchHook）。
 */
export interface RequestContext {
  intentHint: string;
  skillUsed?: string;
  rulesTriggered?: string[];
  tokenUsage?: { input: number; output: number };
  stagingPool?: StagingPool;
  shadowState?: ShadowStateLayer;
  toolExposureState?: ToolExposureRuntimeState;
  traceIds?: Partial<ExecutionTraceIds>;
  /**
   * 请求级 Service 缓存管理器（必填，架构债务治理）。
   * 在请求开始时由 AgentRuntime 创建，跨多次 callTool 共享同一实例。
   * AgentRuntime.callTool 从此字段取出 requestScope 注入到 ToolContext。
   */
  requestScope: RequestScope;
  /**
   * 请求级取消信号（可选，M6 §7.6.1）。
   *
   * AbortController 创建点在请求入口（AgentRuntime processMessage / GameService 层），
   * 经 reqCtx 透传至 ToolContext.abortSignal；非取消感知入口缺省 undefined 是合法降级。
   */
  abortSignal?: ToolAbortSignal;
}

/**
 * ReActLoop 依赖：循环执行所需的核心依赖。
 *
 * 不持有状态，所有依赖通过参数注入。
 * reactEngine/recoveryPlanner/dispatchHook/emitRuntimeEvent/buildTraceIds 由 AgentRuntime 提供并注入。
 */
export interface ReActLoopDeps {
  reactEngine: ReActEngine;
  recoveryPlanner: RecoveryPlanner;
  /** Hook 派发（由 AgentRuntime 提供） */
  dispatchHook: (
    event: string,
    requestId: string,
    agentRunId: string,
    payload: unknown,
  ) => Promise<AgentHookResult | undefined>;
  /** 运行时事件发射（由 AgentRuntime 提供） */
  emitRuntimeEvent: (saveId: string, event: unknown) => void;
  /** trace IDs 构建（由 AgentRuntime 提供） */
  buildTraceIds: (reqCtx: RequestContext, extra: { agentRunId: string }) => unknown;
  /** 技能完成标准查询（由 AgentRuntime 提供，用于 evaluateTaskStatus） */
  getSkillCompletionCriteria?: (skillName: string) => string | undefined;
}

/**
 * ReActLoop 上下文：每次调用的不可变配置。
 *
 * 替代 this.agentKey/this.agentConfig/this.maxIterations 等 this 状态。
 * 由 AgentRuntime 在调用 ReActLoop 时构建并传入。
 */
export interface ReActLoopContext {
  agentKey: string;
  englishId: string;
  currentAction: string | undefined;
  maxIterations: number;
  providerId: string | null;
  model: string | null;
  temperature: number;
  maxTokens: number;
}

/** executeReActWithRecovery 返回值：结果 + 最终恢复状态 */
export interface ReActRecoveryResult {
  result: ReActEngineResult;
  recoveryState: RecoveryState;
}

// === 内部辅助函数（纯函数，从 ReActAgent 提取，不导出） ===

function extractUserMessage(parsed: Record<string, unknown>): string {
  const contentFields = ['npcResponse', 'narrative', 'narrativeText', 'content', 'message'];
  for (const field of contentFields) {
    if (typeof parsed[field] === 'string' && parsed[field]) {
      return parsed[field] as string;
    }
  }
  return '';
}

function extractSpeaker(parsed: Record<string, unknown>): string {
  const speakerFields = ['npcName', 'speaker', 'name', 'npc'];
  for (const field of speakerFields) {
    if (typeof parsed[field] === 'string' && parsed[field]) {
      return parsed[field] as string;
    }
  }
  return '';
}

function extractOptions(parsed: Record<string, unknown>): DialogueOption[] {
  const options = parsed.options;
  if (!Array.isArray(options)) return [];

  return options.flatMap((opt: unknown) => {
    if (typeof opt !== 'object' || opt === null) {
      return [];
    }

    const obj = opt as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    const npcId = typeof obj.npcId === 'string' ? obj.npcId.trim() : '';
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';

    if (!id || !npcId || !text) {
      return [];
    }

    return [{
      id,
      text,
      nextTopic: obj.nextTopic as string | undefined,
      npcId,
    }];
  });
}

function extractContent(parsed: Record<string, unknown>): AgentUserContent {
  const userMessage = extractUserMessage(parsed);
  const options = extractOptions(parsed);
  const speaker = extractSpeaker(parsed);

  return {
    message: userMessage,
    speaker: speaker || undefined,
    options: options.length > 0 ? options : undefined,
  };
}

function normalizeNeedAgentReason(reason: unknown): NeedAgentReason | null {
  if (typeof reason !== 'string') {
    return null;
  }

  return (ALLOWED_NEED_AGENT_REASONS as readonly string[]).includes(reason)
    ? reason as NeedAgentReason
    : null;
}

function normalizeNeedAgentRequest(value: unknown): NeedAgentRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.agentType !== 'string' || typeof candidate.action !== 'string') {
    return null;
  }

  const reason = normalizeNeedAgentReason(candidate.reason);
  if (!reason) {
    return null;
  }

  const data = candidate.data;
  return {
    agentType: candidate.agentType as AgentType,
    action: candidate.action,
    reason,
    data: typeof data === 'object' && data !== null ? data as Record<string, unknown> : {},
  };
}

function extractNeedAgents(parsed: Record<string, unknown>): NeedAgentRequest[] {
  const needAgent = parsed.needAgent ?? parsed.needAgents;
  if (!needAgent) return [];

  if (Array.isArray(needAgent)) {
    return needAgent
      .map((n) => normalizeNeedAgentRequest(n))
      .filter((n): n is NeedAgentRequest => n !== null);
  }

  const normalized = normalizeNeedAgentRequest(needAgent);
  if (normalized) {
    return [normalized];
  }

  return [];
}

// === 导出函数 ===

// ─── 纯函数辅助（4 个） ───

/** 从 AgentResponse 提取任务摘要。替代 ReActAgent.extractTaskSummary (line 259-264)。 */
export function extractTaskSummary(result: AgentResponse): string {
  const meta = (result as unknown as Record<string, unknown>)._meta as Record<string, unknown> | undefined;
  if (meta?.summary) return meta.summary as string;
  const content = result.error || String(result.data ?? '');
  return content.length > 100 ? content.slice(0, 100) + '…' : content;
}

/** 应用 prompt context 补丁。替代 ReActAgent.applyPromptContextPatch (line 524-544)。 */
export function applyPromptContextPatch(
  promptContext: PromptContext,
  patch: Record<string, unknown> | undefined,
): PromptContext {
  const nextPromptContext = (patch?.promptContext ?? {}) as Partial<PromptContext>;
  return {
    ...promptContext,
    ...nextPromptContext,
    agentConfig: {
      ...promptContext.agentConfig,
      ...(nextPromptContext.agentConfig ?? {}),
    },
    message: nextPromptContext.message
      ? structuredClone(nextPromptContext.message)
      : promptContext.message,
    domain: {
      ...promptContext.domain,
      ...(nextPromptContext.domain ?? {}),
    },
  };
}

/** 解析模型覆盖。替代 ReActAgent.resolveModelOverride (line 546-563)。 */
export function resolveModelOverride(
  context: ReActLoopContext,
  patch: Record<string, unknown> | undefined,
  fallback?: HookModelOverride,
): HookModelOverride {
  const modelOverride = (patch?.modelOverride ?? {}) as HookModelOverride;
  const baseline = fallback ?? {
    providerId: context.providerId,
    model: context.model,
    temperature: context.temperature,
    maxTokens: context.maxTokens,
  };
  return {
    providerId: modelOverride.providerId ?? baseline.providerId ?? null,
    model: modelOverride.model ?? baseline.model ?? null,
    temperature: modelOverride.temperature ?? baseline.temperature ?? LLM_DEFAULTS.temperature,
    maxTokens: modelOverride.maxTokens ?? baseline.maxTokens ?? LLM_DEFAULTS.maxTokens,
  };
}

/** 应用工具暴露补丁。替代 ReActAgent.applyToolExposePatch (line 565-587)。 */
export function applyToolExposePatch(
  promptResult: PromptBuildResult,
  patch: Record<string, unknown> | undefined,
): PromptBuildResult {
  const allowedFunctionNames = patch?.allowedFunctionNames;
  const apiTools = patch?.apiTools;
  const toolVisibilityTrace = patch?.toolVisibilityTrace;
  const toolExposureTrace = patch?.toolExposureTrace;

  return {
    ...promptResult,
    apiTools: Array.isArray(apiTools) ? apiTools : promptResult.apiTools,
    allowedFunctionNames: Array.isArray(allowedFunctionNames)
      ? new Set(allowedFunctionNames.filter((value): value is string => typeof value === 'string'))
      : promptResult.allowedFunctionNames,
    toolVisibilityTrace: Array.isArray(toolVisibilityTrace)
      ? toolVisibilityTrace as PromptBuildResult['toolVisibilityTrace']
      : promptResult.toolVisibilityTrace,
    toolExposureTrace: toolExposureTrace
      ? structuredClone(toolExposureTrace as NonNullable<PromptBuildResult['toolExposureTrace']>)
      : promptResult.toolExposureTrace,
  };
}

// ─── 循环核心（5 个） ───

/**
 * 应用恢复决策。替代 ReActAgent.applyRecoveryDecision (line 589-606)。
 *
 * 原方法修改 this.recoveryRuntimeState.readonlyMode，参数化后通过返回值传递新的 recoveryState。
 */
export function applyRecoveryDecision(
  reactContext: ReActEngineContext,
  decision: RecoveryDecision,
  recoveryState: RecoveryState,
): { context: ReActEngineContext; recoveryState: RecoveryState } {
  const nextContext: ReActEngineContext = { ...reactContext };
  let nextRecoveryState = recoveryState;

  if (decision.action === 'retry_with_stable_model') {
    nextContext.model = decision.stableModel ?? nextContext.model;
  }
  if (decision.action === 'reload_help') {
    nextContext.userMessage = `${reactContext.userMessage}\n\n请重新阅读全文帮助文档后再继续。`;
  }
  if (decision.action === 'degrade_readonly') {
    nextRecoveryState = { ...recoveryState, readonlyMode: true };
  }

  return { context: nextContext, recoveryState: nextRecoveryState };
}

/**
 * 构建终态恢复结果。替代 ReActAgent.buildTerminalRecoveryResult (line 608-651)。
 *
 * 原方法依赖 this.recoveryRuntimeState.attempts，参数化后通过参数传入。
 */
export function buildTerminalRecoveryResult(
  decision: RecoveryDecision,
  reactContext: ReActEngineContext,
  attempts: number,
): ReActEngineResult {
  const message = decision.action === 'fallback_agent'
    ? `当前处理链路已切换到保守回复模式：${decision.reason}`
    : `当前请求未执行写入操作：${decision.reason}`;
  const recoveryPayload: Record<string, unknown> = {
    action: decision.action,
    reason: decision.reason,
  };

  if (decision.fallbackAgentType) {
    recoveryPayload.fallbackAgentType = decision.fallbackAgentType;
  }

  if (reactContext.agentKey === 'output') {
    return {
      content: JSON.stringify({
        dialogue: {
          messages: [{
            speaker: '旁白',
            content: message,
            messageType: 'narrator',
          }],
        },
        ui: {
          intensity: 'low',
        },
      }),
      iterations: attempts,
      toolCalls: [],
    };
  }

  return {
    content: JSON.stringify({
      message,
      recovery: recoveryPayload,
    }),
    iterations: attempts,
    toolCalls: [],
  };
}

/** 解析终态恢复决策。替代 ReActAgent.resolveTerminalRecoveryDecision (line 675-687)。 */
export function resolveTerminalRecoveryDecision(decision: RecoveryDecision): RecoveryDecision {
  if (decision.action === 'fallback_agent' || decision.action === 'explain_only') {
    return decision;
  }

  return {
    action: 'explain_only',
    reason: decision.reason,
    attempt: decision.attempt,
    finalDecision: true,
    fallbackAgentType: decision.fallbackAgentType,
  };
}

/**
 * ReAct 循环包装 + 恢复逻辑。替代 ReActAgent.executeReActWithRecovery (line 689-756)。
 *
 * 不持有状态，所有副作用通过 deps 参数注入。
 * recoveryState 作为局部可变变量，循环结束后随结果一起返回。
 */
export async function executeReActWithRecovery(
  deps: ReActLoopDeps,
  reactContext: ReActEngineContext,
  hooks: ReActEngineHooks | undefined,
  callToolFn: CallToolFn,
  requestId: string,
  agentRunId: string,
  failureStage: string,
  reqCtx: RequestContext,
  recoveryState: RecoveryState,
): Promise<ReActRecoveryResult> {
  let currentContext = { ...reactContext };
  let currentState = { ...recoveryState };

  while (true) {
    try {
      const result = await deps.reactEngine.execute(currentContext, hooks, callToolFn);

      // === on_task_complete hook：审核挂起-恢复点（设计文档 EC1-EC8） ===
      // v5.2 EC1: 移除条件包裹，只检查 taskContent 存在就触发 hook
      // 业务保证：GM/sub-Agent 路径下 taskContent 存在时，stagingPool/shadowState/templateId 必然齐全
      // 缺失则抛错（不 fallback），由 ReActLoop catch 进入 after_agent_fail 恢复逻辑
      if (currentContext.taskContent) {
        const { stagingPool, shadowState, templateId, taskContent } = currentContext;
        if (!stagingPool || !shadowState || !templateId) {
          throw new Error(
            `on_task_complete hook 触发条件不满足: taskContent 存在但 stagingPool/shadowState/templateId 缺失 (agentKey=${currentContext.agentKey})`,
          );
        }
        const taskCompleteResult = await deps.dispatchHook(
          'on_task_complete',
          requestId,
          agentRunId,
          {
            saveId: currentContext.currentSaveId,
            templateId,
            stagingPool,
            shadowState,
            taskContent,
            agentType: currentContext.agentType,
            agentRunId,
            result,
          },
        );

        const patch = taskCompleteResult?.patch as OnTaskCompletePatch | undefined;

        // 去重命中（auditSkipped）：loop 终止（EC4）
        if (patch?.auditSkipped) {
          return { result, recoveryState: currentState };
        }

        const auditReport = patch?.auditReport ?? null;

        // 有 issues：注入报告，continue 让 Agent 在同一 loop 内修复（EC2/EC3）
        if (auditReport && auditReport.issues.length > 0) {
          currentContext = {
            ...currentContext,
            auditReport,
            auditRound: 1,
          };
          continue;
        }

        // 无 issues 或无报告：loop 终止（EC8：只看 issues.length，不看 severity）
      }

      return { result, recoveryState: currentState };
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      logger.error('ReAct loop execution failed, entering recovery', {
        agent: currentContext.agentKey,
        saveId: currentContext.currentSaveId,
        failureStage,
        attempts: currentState.attempts,
        error: errorMessage,
      });

      // Emit agent_failed_or_recovered runtime event
      deps.emitRuntimeEvent(currentContext.currentSaveId, {
        type: 'agent_failed_or_recovered',
        at: Date.now(),
        traceIds: deps.buildTraceIds(reqCtx, { agentRunId }),
        source: currentContext.agentKey ?? 'gamemaster',
        summary: `Agent failed: ${errorMessage}`,
        detail: { error: errorMessage, recovered: false, failureStage, attempts: currentState.attempts },
      });

      const hookResult = await deps.dispatchHook(
        'after_agent_fail',
        requestId,
        agentRunId,
        {
          error: error instanceof Error ? { message: error.message } : { message: String(error) },
          reqCtx,
          failureStage,
          attempts: currentState.attempts,
        },
      );
      const plannerInput = ((hookResult?.patch?.recovery as RecoveryPlannerInput | undefined) ?? {
        reason: getErrorMessage(error),
      });
      const decision = deps.recoveryPlanner.plan(plannerInput, currentState.attempts + 1);

      if (!decision.finalDecision && decision.action !== 'fallback_agent' && decision.action !== 'explain_only') {
        currentState.attempts += 1;
        const recovered = applyRecoveryDecision(currentContext, decision, currentState);
        currentContext = recovered.context;
        currentState = recovered.recoveryState;

        // Emit recovery runtime event
        deps.emitRuntimeEvent(currentContext.currentSaveId, {
          type: 'agent_failed_or_recovered',
          at: Date.now(),
          traceIds: deps.buildTraceIds(reqCtx, { agentRunId }),
          source: currentContext.agentKey ?? 'gamemaster',
          summary: `Agent recovered: ${decision.reason}`,
          detail: { error: errorMessage, recovered: true, action: decision.action, attempts: currentState.attempts },
        });

        continue;
      }

      const terminalResult = buildTerminalRecoveryResult(
        resolveTerminalRecoveryDecision(decision),
        currentContext,
        currentState.attempts,
      );
      return { result: terminalResult, recoveryState: currentState };
    }
  }
}

// ─── 响应解析（4 个） ───

/**
 * 子Agent 响应解析重试。替代 ReActAgent.parseSubAgentResponseWithRetry (line 3719-3753)。
 */
export async function parseSubAgentResponseWithRetry(
  context: ReActLoopContext,
  response: { content: string; iterations: number; toolCalls: ToolResult[] },
  retryLLMFn?: () => Promise<string>,
  reqCtx?: RequestContext,
  getSkillCompletionCriteria?: (skillName: string) => string | undefined,
): Promise<StandardAgentOutput> {
  let currentContent = response.content;

  for (let retry = 0; retry <= MAX_PARSE_RETRIES; retry++) {
    const result = tryParseSubAgentResponse(context, currentContent, response, reqCtx, getSkillCompletionCriteria);
    if (result !== null) return result;

    if (retry < MAX_PARSE_RETRIES && retryLLMFn) {
      logger.warn(`JSON parse failed (sub-agent), retrying LLM call ${retry + 1}/${MAX_PARSE_RETRIES}`, {
        agent: context.agentKey,
        contentLength: currentContent.length,
      });

      try {
        currentContent = await retryLLMFn();
      } catch (retryError) {
        logger.error(`LLM retry call failed during sub-agent parse retry`, {
          agent: context.agentKey,
          error: getErrorMessage(retryError),
        });
        break;
      }
      continue;
    }

    break;
  }

  return buildSafeFallback(context, { content: currentContent, iterations: response.iterations }, reqCtx);
}

/**
 * 尝试解析子Agent。替代 ReActAgent.tryParseSubAgentResponse (line 3755-3769)。
 */
export function tryParseSubAgentResponse(
  context: ReActLoopContext,
  content: string,
  reactResult: { content: string; iterations: number; toolCalls: ToolResult[] },
  reqCtx?: RequestContext,
  getSkillCompletionCriteria?: (skillName: string) => string | undefined,
): StandardAgentOutput | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseLLMJson<Record<string, unknown>>(content, `ReActAgent:${context.agentKey}`);
  } catch {
    return null;
  }

  const taskOutput = buildTaskCenteredOutput(context, parsed, reactResult, reactResult.iterations, reqCtx, getSkillCompletionCriteria);
  return taskOutput.toStandardOutput();
}

/**
 * LLM 响应解析重试。替代 ReActAgent.parseLLMResponseWithRetry (line 3771-3809)。
 */
export async function parseLLMResponseWithRetry(
  context: ReActLoopContext,
  response: { content: string; iterations: number },
  retryLLMFn?: () => Promise<string>,
  reqCtx?: RequestContext,
): Promise<StandardAgentOutput> {
  let currentContent = response.content;

  for (let retry = 0; retry <= MAX_PARSE_RETRIES; retry++) {
    const result = tryParseLLMResponse(context, currentContent, response.iterations, reqCtx);
    if (result !== null) return result;

    if (retry < MAX_PARSE_RETRIES && retryLLMFn) {
      logger.warn(`JSON parse failed (likely truncation), retrying LLM call ${retry + 1}/${MAX_PARSE_RETRIES}`, {
        agent: context.agentKey,
        contentLength: currentContent.length,
      });

      try {
        currentContent = await retryLLMFn();
      } catch (retryError) {
        logger.error(`LLM retry call failed during parse retry`, {
          agent: context.agentKey,
          error: getErrorMessage(retryError),
        });
        break;
      }
      continue;
    }

    break;
  }

  const isOutputAgent = context.agentKey === 'output';
  if (isOutputAgent) {
    return buildOutputSafeFallback({ content: currentContent, iterations: response.iterations }, reqCtx);
  }
  return buildSafeFallback(context, { content: currentContent, iterations: response.iterations }, reqCtx);
}

/**
 * 尝试解析 LLM。替代 ReActAgent.tryParseLLMResponse (line 3811-3857)。
 */
export function tryParseLLMResponse(
  context: ReActLoopContext,
  content: string,
  iterations: number,
  reqCtx?: RequestContext,
): StandardAgentOutput | null {
  const isOutputAgent = context.agentKey === 'output';

  if (isOutputAgent) {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseLLMJson<Record<string, unknown>>(content, `ReActAgent:${context.agentKey}`);
    } catch {
      return null;
    }

    const dialogue = (parsed?.dialogue ?? parsed) as Record<string, unknown>;
    const ui = parsed?.ui as Record<string, unknown> | undefined;
    const messages = dialogue?.messages as Array<Record<string, unknown>> | undefined;

    const uiComponents = ui?.components as string ?? '';

    return {
      content: {
        message: Array.isArray(messages) && messages.length > 0
          ? messages.map((m: Record<string, unknown>) => m.content as string).join('\n')
          : '',
        speaker: Array.isArray(messages) && messages.length > 0
          ? messages[0].speaker as string
          : undefined,
        messages: Array.isArray(messages) && messages.length > 0 ? messages : undefined,
        options: dialogue?.options as DialogueOption[] | undefined,
      },
      data: {
        dialogue,
        markdown: uiComponents,
        uiIntensity: ui?.intensity as string | undefined,
      },
      panelUpdates: undefined,
      _meta: { agentType: 'output' as AgentType, englishId: 'output', action: '', intent: '', intentHint: reqCtx?.intentHint ?? '', iterations, success: true, skillUsed: reqCtx?.skillUsed, rulesTriggered: reqCtx?.rulesTriggered, tokenUsage: reqCtx?.tokenUsage },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseLLMJson<Record<string, unknown>>(content, `ReActAgent:${context.agentKey}`);
  } catch {
    return null;
  }

  return normalizeToStandardOutput(context, parsed, iterations, reqCtx);
}

// ─── 兜底构建（6 个） ───

/**
 * 安全兜底。替代 ReActAgent.buildSafeFallback (line 3859-3867)。
 */
export function buildSafeFallback(
  context: ReActLoopContext,
  response: { content: string; iterations: number },
  reqCtx?: RequestContext,
): StandardAgentOutput {
  const readableContent = extractReadableContentFromRaw(response.content);
  return {
    content: { message: readableContent },
    data: { rawResponse: response.content },
    panelUpdates: undefined,
    _meta: { agentType: context.agentKey as AgentType, englishId: context.englishId || context.agentKey, action: '', intent: '', intentHint: reqCtx?.intentHint ?? '', iterations: response.iterations, success: false, parseFailed: true, skillUsed: reqCtx?.skillUsed, rulesTriggered: reqCtx?.rulesTriggered, tokenUsage: reqCtx?.tokenUsage },
  };
}

/**
 * 提取可读内容。替代 ReActAgent.extractReadableContentFromRaw (line 3869-3901)。
 */
export function extractReadableContentFromRaw(raw: string): string {
  const messageMatches = raw.match(/"content"\s*:\s*"([^"]*?)"/g);
  if (messageMatches && messageMatches.length > 0) {
    const contents = messageMatches
      .map(m => {
        const match = m.match(/"content"\s*:\s*"([^"]*?)"/);
        return match ? match[1] : '';
      })
      .filter(c => c.length > 0);
    if (contents.length > 0) {
      return contents.join('\n');
    }
  }

  const speakerMatches = raw.match(/"speaker"\s*:\s*"([^"]*?)"[^}]*?"content"\s*:\s*"([^"]*?)"/g);
  if (speakerMatches && speakerMatches.length > 0) {
    const messages = speakerMatches.map(m => {
      const match = m.match(/"speaker"\s*:\s*"([^"]*?)"[^}]*?"content"\s*:\s*"([^"]*?)"/);
      if (match) return `${match[1]}：${match[2]}`;
      return '';
    }).filter(m => m.length > 0);
    if (messages.length > 0) {
      return messages.join('\n');
    }
  }

  const narrativeMatch = raw.match(/"(?:narrative|message|npcResponse)"\s*:\s*"([^"]{10,}?)"/);
  if (narrativeMatch) {
    return narrativeMatch[1];
  }

  return '（AI回复解析异常，请重试）';
}

/**
 * Output Agent 兜底。替代 ReActAgent.buildOutputSafeFallback (line 3904-3928)。
 */
export function buildOutputSafeFallback(
  response: { content: string; iterations: number },
  reqCtx?: RequestContext,
): StandardAgentOutput {
  return {
    content: {
      message: response.content,
      speaker: '旁白',
    },
    data: {
      dialogue: { messages: [{ speaker: '旁白', content: response.content, messageType: 'narrator' }] },
    },
    panelUpdates: undefined,
    _meta: {
      agentType: 'output' as AgentType,
      englishId: 'output',
      action: '',
      intent: '',
      intentHint: reqCtx?.intentHint ?? '',
      iterations: response.iterations,
      success: true,
      parseFailed: true,
      skillUsed: reqCtx?.skillUsed,
      rulesTriggered: reqCtx?.rulesTriggered,
      tokenUsage: reqCtx?.tokenUsage,
    },
  };
}

/**
 * 归一化标准输出。替代 ReActAgent.normalizeToStandardOutput (line 3930-3950)。
 */
export function normalizeToStandardOutput(
  context: ReActLoopContext,
  parsed: Record<string, unknown>,
  iterations: number,
  reqCtx?: RequestContext,
): StandardAgentOutput {
  const userMessage = extractUserMessage(parsed);
  const options = extractOptions(parsed);
  /** @deprecated 应使用 TaskCenteredOutput.taskStatus.needsFollowUp 替代 */
  const needAgents = extractNeedAgents(parsed);
  const speaker = extractSpeaker(parsed);

  const content: AgentUserContent = {
    message: userMessage,
    speaker: speaker || undefined,
    options: options.length > 0 ? options : undefined,
  };

  return {
    content,
    data: { ...parsed },
    panelUpdates: parsed.panelUpdates as PanelUpdates | undefined,
    needAgents: needAgents.length > 0 ? needAgents : undefined,
    _meta: { agentType: context.agentKey as AgentType, englishId: context.englishId || context.agentKey, action: '', intent: '', intentHint: reqCtx?.intentHint ?? '', iterations, success: true, skillUsed: reqCtx?.skillUsed, rulesTriggered: reqCtx?.rulesTriggered, tokenUsage: reqCtx?.tokenUsage },
  };
}

/**
 * 任务中心化输出。替代 ReActAgent.buildTaskCenteredOutput (line 3952-3997)。
 */
export function buildTaskCenteredOutput(
  context: ReActLoopContext,
  parsed: Record<string, unknown>,
  reactResult: { content: string; iterations: number; toolCalls: ToolResult[] },
  iterations: number,
  reqCtx?: RequestContext,
  getSkillCompletionCriteria?: (skillName: string) => string | undefined,
): TaskCenteredOutput {
  const taskStatus = evaluateTaskStatus(parsed, reactResult, reqCtx, getSkillCompletionCriteria);
  const actions = extractActionRecords(reactResult);
  const results = extractTaskResults(reactResult);
  const content = extractContent(parsed);

  const _meta: AgentMeta = {
    agentType: context.agentKey as AgentType,
    englishId: context.englishId || context.agentKey,
    action: context.currentAction || '',
    intent: '',
    intentHint: reqCtx?.intentHint ?? '',
    iterations,
    success: taskStatus.completed,
    parseFailed: false,
    skillUsed: reqCtx?.skillUsed,
    rulesTriggered: reqCtx?.rulesTriggered,
    tokenUsage: reqCtx?.tokenUsage,
  };

  const output: TaskCenteredOutput = {
    taskStatus,
    actions,
    results,
    content,
    panelUpdates: parsed.panelUpdates as PanelUpdates | undefined,
    _meta,
    toStandardOutput: () => ({
      content: output.content,
      data: {
        taskStatus: output.taskStatus,
        actions: output.actions,
        results: output.results,
      },
      panelUpdates: output.panelUpdates,
      needAgents: output.taskStatus.needsFollowUp ? extractNeedAgents(parsed) : undefined,
      _meta: output._meta,
    }),
  };
  return output;
}

/**
 * 评估任务状态。替代 ReActAgent.evaluateTaskStatus (line 3999-4023)。
 */
export function evaluateTaskStatus(
  parsed: Record<string, unknown>,
  reactResult: { content: string; iterations: number; toolCalls: ToolResult[] },
  reqCtx?: RequestContext,
  getSkillCompletionCriteria?: (skillName: string) => string | undefined,
): TaskStatus {
  const failedToolCalls = reactResult.toolCalls.filter(tc => !tc.success);
  const hasError = failedToolCalls.length > 0;
  const totalToolCalls = reactResult.toolCalls.length;
  const userMessage = extractUserMessage(parsed);
  const hasContent = !!userMessage;
  const baseSummary = userMessage ? userMessage.slice(0, 200) : '任务执行完成';

  let summary = baseSummary;
  if (reqCtx?.skillUsed && getSkillCompletionCriteria) {
    const completionCriteria = getSkillCompletionCriteria(reqCtx.skillUsed);
    if (completionCriteria) {
      summary = `${baseSummary} [完成标准: ${completionCriteria}]`;
    }
  }
  if (totalToolCalls > 0) {
    summary = `${summary} [工具调用: ${totalToolCalls - failedToolCalls.length}/${totalToolCalls} 成功]`;
  }

  let failureReason: string | undefined;
  if (hasError) {
    const failureDetails = failedToolCalls.map(tc => {
      const meta = tc._meta;
      const toolMethod = meta ? `${meta.toolType}.${meta.method}` : 'unknown';
      const errMsg = tc.error ? String(tc.error).slice(0, 120) : '未知错误';
      return `${toolMethod}(${errMsg})`;
    });
    failureReason = `${failedToolCalls.length}/${totalToolCalls} 个工具调用失败 — ${failureDetails.join('; ')}`;
  }

  return {
    completed: !hasError && hasContent,
    summary,
    failureReason,
    needsFollowUp: !!parsed.needAgents || !!parsed.needAgent,
    followUpDescription: parsed.needAgents ? '需要委派子Agent处理' : undefined,
    taskReport: extractTaskReport(parsed),
  };
}

/**
 * 从 LLM 输出中提取结构化任务报告（taskReport）。
 * LLM 主动输出时优先使用，未输出时返回 undefined（由 GM 端 buildSubAgentResultSummary 程序兜底拼接）。
 */
function extractTaskReport(parsed: Record<string, unknown>): TaskReport | undefined {
  const raw = parsed.taskReport;
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const summary = typeof r.summary === 'string' ? r.summary : '';
  const changesRaw = r.changes as Record<string, unknown> | undefined;
  if (!changesRaw || typeof changesRaw !== 'object') return undefined;
  const parseChangeList = (field: string): TaskReportChange[] => {
    const list = changesRaw[field];
    if (!Array.isArray(list)) return [];
    return list
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => ({
        type: typeof item.type === 'string' ? item.type : '',
        name: typeof item.name === 'string' ? item.name : '',
        id: typeof item.id === 'string' ? item.id : undefined,
        fields: Array.isArray(item.fields)
          ? item.fields.filter((f): f is string => typeof f === 'string')
          : undefined,
      }))
      .filter(item => item.type && item.name);
  };
  const changes = {
    created: parseChangeList('created'),
    updated: parseChangeList('updated'),
    deleted: parseChangeList('deleted'),
  };
  if (!summary && changes.created.length === 0 && changes.updated.length === 0 && changes.deleted.length === 0) {
    return undefined;
  }
  const keyDecisionsRaw = r.keyDecisions;
  const keyDecisions = Array.isArray(keyDecisionsRaw)
    ? keyDecisionsRaw.filter((d): d is string => typeof d === 'string')
    : undefined;
  const startingLocationId = typeof r.startingLocationId === 'string' ? r.startingLocationId : undefined;
  const startingLocationName = typeof r.startingLocationName === 'string' ? r.startingLocationName : undefined;
  return {
    summary,
    changes,
    ...(keyDecisions && keyDecisions.length > 0 ? { keyDecisions } : {}),
    ...(startingLocationId ? { startingLocationId } : {}),
    ...(startingLocationName ? { startingLocationName } : {}),
  };
}

// ─── 字段提取（2 个） ───

/** 提取 action 记录。替代 ReActAgent.extractActionRecords (line 4025-4038)。 */
export function extractActionRecords(
  reactResult: { content: string; iterations: number; toolCalls: ToolResult[] },
): ActionRecord[] {
  return reactResult.toolCalls
    .filter(tc => tc._meta)
    .map(tc => ({
      tool: tc._meta!.toolType || '',
      method: tc._meta!.method || '',
      params: tc._meta!.params || {},
      result: (tc.success ? 'success' : 'failure') as 'success' | 'failure' | 'partial',
      timestamp: tc.timestamp || Date.now(),
      summary: tc.success ? `${tc._meta!.method} 执行成功` : `${tc._meta!.method} 执行失败: ${tc.error || ''}`,
    }));
}

/** 提取任务结果。替代 ReActAgent.extractTaskResults (line 4040-4074)。 */
export function extractTaskResults(
  reactResult: { content: string; iterations: number; toolCalls: ToolResult[] },
): TaskResults {
  const created: EntityRef[] = [];
  const updated: EntityRef[] = [];
  const deleted: EntityRef[] = [];

  for (const tc of reactResult.toolCalls) {
    if (!tc.writeOperation) continue;
    const op = tc.writeOperation;
    const params = op.params as Record<string, unknown>;
    const method = op.method;

    const entityType = op.toolType.replace(/_data$|_service$/, '');
    const entityId = String(params.id || params.itemId || params.npcId || params.skillId || params.questId || '');
    const entityName = String(params.name || params.itemName || params.skillName || params.questName || params.npcName || entityId);

    const ref: EntityRef = {
      type: entityType,
      id: entityId,
      name: entityName,
      keyFields: params,
    };

    if (method.startsWith('add_') || method.startsWith('create_')) {
      created.push(ref);
    } else if (method.startsWith('remove_') || method.startsWith('delete_')) {
      deleted.push(ref);
    } else if (method.startsWith('update_') || method.startsWith('modify_')) {
      updated.push(ref);
    }
  }

  return { created, updated, deleted, computed: {}, custom: {} };
}
