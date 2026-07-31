/**
 * ToolExecutor —— AgentRuntime 侧工具执行的编排者（M3 模块 4）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M3-AgentRuntime拆分.md §10
 *
 * 职责：构建 ReActEngineHooks（before/after 工具调用的 hook 桥接 + 子 Agent
 * 进度上报与结果修补）、确定性动作预执行（deterministicActions/
 * initDeterministicActions）、工具权限管理、上下文抓取器。
 *
 * 迁移自 AgentRuntime（行为等价，纯移动）：
 * buildRequestHooks / executeDeterministicActions / executeInitDeterministicActions /
 * findToolTypeByMethod / grantAllToolPermissions / getGrantedToolTypes /
 * buildContextFetcher + 子 Agent 结果解析纯函数 x3（D3.7）
 *
 * 边界（§10.1/§10.5）：ReActEngine 循环内的工具分发保持现状不动；
 * BaseAgent.callTool 作为低层执行器保留（经 deps.callToolFn 注入）。
 *
 * 依赖方向：仅依赖 types.ts 接口 + ReActLoop 纯函数，零 import facade。
 */

import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import { createProgressReporter } from '@ai-rpg/shared/tool-core';
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type {
  AgentType,
  TaskStatus,
  TaskReport,
  ActionRecord,
  TaskResults,
  ToolType,
} from '../../../../shared/src/types/agent.js';
import type {
  TaskEndDetail,
  ToolCallDetail,
  ToolResultDetail,
  IterationDetail,
  SubAgentDetail,
  ErrorDetail,
} from '@ai-rpg/shared';
import type { ReActEngineHooks } from '../ReActEngine.js';
import type { RequestContext } from '../ReActLoop.js';
import { mergeToolHookResult, resolveDomainFromToolName } from './tool-result-merge.js';
import type {
  BuildEngineHooksArgs,
  ContextFetcherFn,
  IToolExecutor,
  PreExecutedToolCall,
  ToolExecutorDeps,
} from './types.js';

const logger = createChildLogger('tool-executor');

// ─── 子 Agent 结果解析纯函数（D3.7，模块导出） ───

export function extractSubAgentTaskCompleted(subAgentResult: unknown): boolean {
  if (!subAgentResult || typeof subAgentResult !== 'object') return false;
  const data = (subAgentResult as Record<string, unknown>).data as Record<string, unknown> | undefined;
  if (!data) return false;
  const taskStatus = data.taskStatus as { completed?: boolean } | undefined;
  return taskStatus?.completed === true;
}

/**
 * 提取子 Agent 的结构化任务报告（taskReport）。
 * 优先使用 LLM 主动输出的 taskReport，未输出时由 actions/results 程序兜底拼接。
 */
export function extractSubAgentTaskReport(
  subAgentResult: unknown,
  agentType: string,
): TaskReport | null {
  if (!subAgentResult || typeof subAgentResult !== 'object') return null;
  const data = (subAgentResult as Record<string, unknown>).data as Record<string, unknown> | undefined;
  if (!data) return null;

  // 优先使用 LLM 主动输出的 taskReport
  const taskStatus = data.taskStatus as TaskStatus | undefined;
  if (taskStatus?.taskReport) {
    return taskStatus.taskReport;
  }

  // 程序兜底：从 actions/results 拼接
  const results = data.results as TaskResults | undefined;
  const changes: TaskReport['changes'] = { created: [], updated: [], deleted: [] };
  if (results) {
    if (results.created?.length) {
      changes.created = results.created.map(e => ({ type: e.type, name: e.name, id: e.id }));
    }
    if (results.updated?.length) {
      changes.updated = results.updated.map(e => ({
        type: e.type,
        name: e.name,
        id: e.id,
        fields: Object.keys(e.keyFields ?? {}),
      }));
    }
    if (results.deleted?.length) {
      changes.deleted = results.deleted.map(e => ({ type: e.type, name: e.name, id: e.id }));
    }
  }
  const hasChange = changes.created.length > 0 || changes.updated.length > 0 || changes.deleted.length > 0;
  if (!hasChange) return null;
  return {
    summary: taskStatus?.summary ?? `${agentType} 任务执行完成`,
    changes,
  };
}

/**
 * 构建子 Agent 的文本摘要（透传给 GM LLM 使用）。
 * 优先使用 LLM 主动输出的 taskReport，未输出时由 actions/results 程序兜底拼接。
 */
export function buildSubAgentResultSummary(
  subAgentResult: unknown,
  agentType: string,
): string | null {
  if (!subAgentResult || typeof subAgentResult !== 'object') return null;

  const data = (subAgentResult as Record<string, unknown>).data as Record<string, unknown> | undefined;
  if (!data) return null;

  const taskStatus = data.taskStatus as TaskStatus | undefined;
  const taskReport = extractSubAgentTaskReport(subAgentResult, agentType);
  const actions = data.actions as ActionRecord[] | undefined;

  const lines: string[] = [];
  lines.push(`[${agentType} 子Agent执行结果]`);

  if (taskStatus) {
    const statusLabel = taskStatus.completed ? '已完成' : '未完成';
    lines.push(`任务状态: ${statusLabel} — ${taskStatus.summary}`);
    if (!taskStatus.completed && taskStatus.failureReason) {
      lines.push(`失败原因: ${taskStatus.failureReason}`);
    }
    if (taskStatus.needsFollowUp && taskStatus.followUpDescription) {
      lines.push(`后续建议: ${taskStatus.followUpDescription}`);
    }
  }

  // 优先使用 taskReport（LLM 主动输出或程序兜底）
  if (taskReport) {
    if (taskReport.summary) {
      lines.push(`任务摘要: ${taskReport.summary}`);
    }
    const entityChanges: string[] = [];
    if (taskReport.changes.created.length > 0) {
      entityChanges.push(`创建: ${taskReport.changes.created.map(e => `${e.name}(${e.type}${e.id ? `, id=${e.id}` : ''})`).join(', ')}`);
    }
    if (taskReport.changes.updated.length > 0) {
      entityChanges.push(`更新: ${taskReport.changes.updated.map(e => `${e.name}(${e.type}${e.id ? `, id=${e.id}` : ''}${e.fields && e.fields.length > 0 ? `, fields=[${e.fields.join(',')}]` : ''})`).join(', ')}`);
    }
    if (taskReport.changes.deleted.length > 0) {
      entityChanges.push(`删除: ${taskReport.changes.deleted.map(e => `${e.name}(${e.type}${e.id ? `, id=${e.id}` : ''})`).join(', ')}`);
    }
    if (entityChanges.length > 0) {
      lines.push(`实体变更: ${entityChanges.join('; ')}`);
    }
    if (taskReport.keyDecisions && taskReport.keyDecisions.length > 0) {
      lines.push(`关键决策: ${taskReport.keyDecisions.join('; ')}`);
    }
    if (taskReport.startingLocationId || taskReport.startingLocationName) {
      const parts: string[] = [];
      if (taskReport.startingLocationName) parts.push(`name=${taskReport.startingLocationName}`);
      if (taskReport.startingLocationId) parts.push(`id=${taskReport.startingLocationId}`);
      lines.push(`起始地点: ${parts.join(', ')}`);
    }
  } else if (actions?.length) {
    // 兜底兜底：taskReport 完全缺失时从 actions 拼接
    const successActions = actions.filter(a => a.result !== 'failure');
    const failedActions = actions.filter(a => a.result === 'failure');
    if (successActions.length) {
      lines.push(`执行操作: ${successActions.map(a => `${a.tool}.${a.method}: ${a.summary}`).join('; ')}`);
    }
    if (failedActions.length) {
      lines.push(`失败操作: ${failedActions.map(a => `${a.tool}.${a.method}: ${a.summary}`).join('; ')}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// ─── ToolExecutor ───

export class ToolExecutor implements IToolExecutor {
  private readonly deps: ToolExecutorDeps;

  constructor(deps: ToolExecutorDeps) {
    this.deps = deps;
  }

  buildEngineHooks(args: BuildEngineHooksArgs): ReActEngineHooks {
    const { saveId, requestId, agentRunId, reqCtx } = args;
    const agentName = args.agentName ?? 'gamemaster';
    const deps = this.deps;

    return {
      beforeToolCall: async (toolCall) => {
        deps.emitRuntimeEvent(saveId, {
          type: 'tool_called',
          at: Date.now(),
          traceIds: deps.buildTraceIds(reqCtx, { toolCallId: toolCall.id }),
          source: agentName,
          summary: `Tool called: ${toolCall.function.name}`,
          detail: { toolName: toolCall.function.name, toolCallId: toolCall.id },
        });

        deps.reportProgress('tool_call', { toolName: toolCall.function.name } as ToolCallDetail);

        let parsedArguments: Record<string, unknown> = {};
        try {
          parsedArguments = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          parsedArguments = {};
        }

        const hookResult = await deps.hookDispatcher.dispatch(
          'before_tool_call',
          {
            requestId,
            agentRunId,
            payload: {
              toolName: toolCall.function.name,
              args: parsedArguments,
              readonlyMode: deps.state.recovery.readonlyMode,
            },
            toolCallId: toolCall.id,
            // M4 §14.1：4 维度 placement（domain 从 toolName 前缀解析）
            placement: {
              agentType: deps.agentType,
              path: deps.state.currentPath,
              domain: resolveDomainFromToolName(toolCall.function.name),
            },
          },
        );

        return {
          block: hookResult.blocked,
          reason: hookResult.reason,
          // M4 类型化后 patch.normalizedArguments 已是精确类型（BeforeToolCallPatch），无需断言
          patch: hookResult.patch?.normalizedArguments
            ? {
                normalizedArguments: hookResult.patch.normalizedArguments,
              }
            : undefined,
          emittedEvents: hookResult.emittedEvents,
        };
      },

      afterToolCall: async (toolCall, result, isError) => {
        deps.emitRuntimeEvent(saveId, {
          type: 'tool_returned',
          at: Date.now(),
          traceIds: deps.buildTraceIds(reqCtx, { toolCallId: toolCall.id }),
          source: agentName,
          summary: `Tool returned: ${toolCall.function.name} (${isError ? 'error' : 'ok'})`,
          detail: { toolName: toolCall.function.name, toolCallId: toolCall.id, success: !isError },
        });

        const resultSummary = typeof result === 'object' && result !== null
          ? (isError ? String((result as Record<string, unknown>).error ?? '') : String((result as Record<string, unknown>).data ?? ''))
          : undefined;
        deps.reportProgress('tool_result', {
          toolName: toolCall.function.name,
          success: !isError,
          summary: resultSummary ? (resultSummary.length > 100 ? resultSummary.slice(0, 100) : resultSummary) : undefined,
        } as ToolResultDetail);

        let patchedResult = result;
        const emittedEvents: Array<Record<string, unknown>> = [];

        if (!isError && result.data && toolCall.function.name.startsWith('coordinator_service__spawn_agent')) {
          const spawnData = result.data as { agent_type?: string; result?: unknown };
          if (spawnData.agent_type) {
            let spawnArgs: Record<string, unknown> = {};
            try {
              spawnArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
            } catch { /* fallback to default */ }
            const taskArg = spawnArgs.task as string | undefined;
            const subTaskDesc = taskArg
              ? (taskArg.length > 50 ? taskArg.slice(0, 50) + '…' : taskArg)
              : `spawned by ${agentName}`;
            deps.reportProgress('sub_agent_start', {
              subAgentType: spawnData.agent_type,
              subTaskDescription: subTaskDesc,
            } as SubAgentDetail);
            deps.reportProgress('sub_agent_end', {
              success: true,
              summary: buildSubAgentResultSummary(spawnData.result, spawnData.agent_type) ?? 'sub-agent completed',
            } as TaskEndDetail);

            const summary = buildSubAgentResultSummary(spawnData.result, spawnData.agent_type);
            if (summary) {
              patchedResult = { ...patchedResult, _subAgentSummary: summary };
            }
          }
        }

        if (!isError && result.data && toolCall.function.name.startsWith('coordinator_service__batch_spawn_agents')) {
          const batchData = result.data as { results?: Array<{ agent_type: string; result: unknown; success?: boolean }> };
          if (batchData.results) {
            const summaries: string[] = [];
            const failedAgents: string[] = [];
            for (const item of batchData.results) {
              const itemSuccess = item.success !== false;
              const taskCompleted = extractSubAgentTaskCompleted(item.result);
              if (!itemSuccess || !taskCompleted) {
                failedAgents.push(item.agent_type);
              }
              deps.reportProgress('sub_agent_start', {
                subAgentType: item.agent_type,
                subTaskDescription: `${item.agent_type} task`,
              } as SubAgentDetail);
              deps.reportProgress('sub_agent_end', {
                success: itemSuccess && taskCompleted,
                summary: buildSubAgentResultSummary(item.result, item.agent_type) ?? `${item.agent_type} completed`,
              } as TaskEndDetail);
              const summary = buildSubAgentResultSummary(item.result, item.agent_type);
              if (summary) {
                summaries.push(summary);
              }
            }
            if (failedAgents.length > 0) {
              const warning = `⚠️ 以下子Agent未完成：${failedAgents.join(', ')}。必须直接调用对应 service 工具补充缺失内容，禁止继续后续步骤。`;
              patchedResult = { ...patchedResult, _subAgentSummary: `${warning}\n\n${summaries.join('\n')}` };
            } else if (summaries.length > 0) {
              patchedResult = { ...patchedResult, _subAgentSummary: summaries.join('\n') };
            }
          }
        }

        const hookResult = await deps.hookDispatcher.dispatch(
          'after_tool_call',
          {
            requestId,
            agentRunId,
            payload: {
              toolName: toolCall.function.name,
              result: patchedResult,
              isError,
              readonlyMode: deps.state.recovery.readonlyMode,
            },
            toolCallId: toolCall.id,
            // M4 §14.1：4 维度 placement（domain 从 toolName 前缀解析）
            placement: {
              agentType: deps.agentType,
              path: deps.state.currentPath,
              domain: resolveDomainFromToolName(toolCall.function.name),
            },
          },
        );

        if (hookResult.emittedEvents?.length) {
          emittedEvents.push(...hookResult.emittedEvents);
        }

        const merged = mergeToolHookResult(patchedResult, [hookResult.patch]);

        return {
          patch: {
            result: merged.result,
          },
          // M4 §14.2：terminate 仅透传给引擎（由引擎标记 tool result message，
          // 首版不改变循环控制流）；合并语义 OR 已在 mergeToolHookResult 内完成
          terminate: merged.terminate,
          emittedEvents: emittedEvents.length > 0 ? emittedEvents : undefined,
        };
      },

      transformMessages: async (messages) => messages,

      onIterationStart: (iterationId, iterationNumber) => {
        if (reqCtx?.traceIds) {
          reqCtx.traceIds.iterationId = iterationId;
        }
        deps.reportProgress('iteration', {
          iteration: iterationNumber,
          maxIterations: deps.getMaxIterations(),
        } as IterationDetail);
      },

      onError: (error: Error, errorType?: string, recoverable?: boolean) => {
        deps.reportProgress('error', { error: error.message, errorType, recoverable } as ErrorDetail);
      },
    };
  }

  async executeDeterministicActions(saveId: ID, reqCtx: RequestContext): Promise<PreExecutedToolCall[]> {
    if (this.deps.deterministicActions.length === 0) return [];

    const results: PreExecutedToolCall[] = [];

    for (const methodName of this.deps.deterministicActions) {
      const toolType = this.findToolTypeByMethod(methodName);
      if (!toolType) {
        logger.warn(`deterministicActions: method '${methodName}' not found in any registered tool, skipping`);
        continue;
      }

      try {
        const toolResult = await this.deps.callToolFn(toolType, methodName, { saveId }, saveId, reqCtx);
        const toolName = `${toolType}__${methodName}`;
        const displayName = toolResult.success
          ? `${toolType}.${methodName} (预执行成功)`
          : `${toolType}.${methodName} (预执行失败)`;

        results.push({
          toolName,
          displayName,
          result: toolResult.success
            ? (toolResult.data as Record<string, unknown>) ?? { success: true }
            : { success: false, error: toolResult.error ?? 'Pre-execution failed' },
        });

        logger.info(`deterministicActions: pre-executed ${toolType}.${methodName}`, {
          saveId,
          success: toolResult.success,
        });
      } catch (error) {
        logger.warn(`deterministicActions: pre-execution failed for ${methodName}`, {
          saveId,
          error: getErrorMessage(error),
        });
      }
    }

    return results;
  }

  async executeInitDeterministicActions(saveId: ID, reqCtx: RequestContext): Promise<PreExecutedToolCall[]> {
    if (this.deps.initDeterministicActions.length === 0) return [];

    const results: PreExecutedToolCall[] = [];

    for (const methodName of this.deps.initDeterministicActions) {
      const toolType = this.findToolTypeByMethod(methodName);
      if (!toolType) {
        logger.warn(`initDeterministicActions: method '${methodName}' not found in any registered tool, skipping`);
        continue;
      }

      try {
        const toolResult = await this.deps.callToolFn(toolType, methodName, { saveId }, saveId, reqCtx);
        const toolName = `${toolType}__${methodName}`;
        const displayName = toolResult.success
          ? `${toolType}.${methodName} (初始化预执行成功)`
          : `${toolType}.${methodName} (初始化预执行失败)`;

        results.push({
          toolName,
          displayName,
          result: toolResult.success
            ? (toolResult.data as Record<string, unknown>) ?? { success: true }
            : { success: false, error: toolResult.error ?? 'Pre-execution failed' },
        });

        logger.info(`initDeterministicActions: pre-executed ${toolType}.${methodName}`, {
          saveId,
          success: toolResult.success,
        });
      } catch (error) {
        logger.warn(`initDeterministicActions: pre-execution failed for ${methodName}`, {
          saveId,
          error: getErrorMessage(error),
        });
      }
    }

    return results;
  }

  buildContextFetcher(): ContextFetcherFn {
    return async (source, method, params, saveId, _templateId) => {
      try {
        const toolType = source as ToolType;
        const tool = this.deps.toolRegistry.getTool(toolType);
        if (!tool) return null;
        const toolMethods = tool.getMethods();
        if (!toolMethods.includes(method)) return null;
        const effectiveTemplateId = _templateId || this.deps.getCurrentTemplateId();
        const result = await tool.execute(method, { ...params, saveId }, {
          saveId,
          agentType: this.deps.agentKey,
          timestamp: Date.now() as Timestamp,
          templateId: effectiveTemplateId,
          requestScope: this.deps.createRequestScope(),
          // M6 §7.6.1：上下文抓取可能触发长查询，同步接入进度桥接；
          // 该路径无 reqCtx 在场，abortSignal 缺省（合法降级）
          onUpdate: createProgressReporter(
            (progress) => {
              try {
                this.deps.reportProgress('tool_call', {
                  toolName: `${toolType}.${method}`,
                  progress,
                });
              } catch (err) {
                logger.warn('progress bridge failed', { error: getErrorMessage(err) });
              }
            },
            { throttleMs: 200 },
          ),
        });
        return result.success ? result.data : null;
      } catch {
        return null;
      }
    };
  }

  grantAllToolPermissions(): void {
    const allToolTypes = this.deps.toolRegistry.getRegisteredToolTypes();
    for (const toolType of allToolTypes) {
      this.deps.toolRegistry.setPermission({
        toolType: toolType as ToolType,
        agentType: this.deps.agentKey as AgentType,
        readAllowed: true,
        writeAllowed: true,
      });
    }
  }

  getGrantedToolTypes(): string[] {
    if (this.deps.configuredTools.includes('all')) {
      return this.deps.toolRegistry.getRegisteredToolTypes();
    }

    return [...this.deps.configuredTools];
  }

  private findToolTypeByMethod(methodName: string): string | undefined {
    for (const toolType of this.deps.toolRegistry.getRegisteredToolTypes()) {
      const tool = this.deps.toolRegistry.getTool(toolType as ToolType);
      if (tool?.hasMethod(methodName)) {
        return toolType;
      }
    }
    return undefined;
  }
}
