import type { AgentRuntimeSnapshot } from './agent-runtime-snapshot.js';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('agent-hooks');

export const CORE_AGENT_HOOKS = [
  'before_model_select',
  'before_prompt_build',
  'before_tool_expose',
  'before_tool_call',
  'after_tool_call',
  'before_compaction',
  'after_compaction',
  'after_agent_fail',
  'report_progress',
  'on_task_complete',
] as const;

export type AgentHookName = typeof CORE_AGENT_HOOKS[number];

/**
 * 错误穿透白名单（EC5 核心 - v5.2 新增）。
 *
 * 这些 hook 抛错时不 catch，让错误向上抛到 ReActLoop.executeReActWithRecovery
 * 的 catch 块，进入 after_agent_fail 恢复逻辑。
 *
 * 设计文档：docs/design/fix/fix-20260716-audit-hook-suspend-resume-refactor.md §5.1
 *
 * 当前白名单：
 * - on_task_complete: 审核抛错必须穿透（禁止 audit-hook.ts 内 try/catch 包裹），
 *   由 ReActLoop catch 处理进入 after_agent_fail 恢复
 */
const ERROR_PROPAGATING_HOOKS: ReadonlySet<AgentHookName> = new Set<AgentHookName>([
  'on_task_complete',
]);

export interface ExecutionTraceIds {
  requestId: string;
  agentRunId: string;
  toolCallId?: string;
  auditRoundId?: string;
}

export interface AgentHookContext<TPayload = Record<string, unknown>> {
  requestId: string;
  agentRunId: string;
  iteration: number;
  traceIds: ExecutionTraceIds;
  snapshot: AgentRuntimeSnapshot;
  payload?: TPayload;
}

export interface AgentHookResult<TPatch = Record<string, unknown>> {
  blocked?: boolean;
  reason?: string;
  patch?: TPatch;
  emittedEvents?: Array<Record<string, unknown>>;
}

export type AgentHook<TPayload = Record<string, unknown>, TPatch = Record<string, unknown>> = (
  context: AgentHookContext<TPayload>,
) => Promise<AgentHookResult<TPatch> | undefined> | AgentHookResult<TPatch> | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeHookPatches(
  currentPatch: Record<string, unknown> | undefined,
  nextPatch: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!currentPatch) return nextPatch ? { ...nextPatch } : undefined;
  if (!nextPatch) return { ...currentPatch };

  const merged: Record<string, unknown> = { ...currentPatch };
  for (const [key, value] of Object.entries(nextPatch)) {
    const existing = merged[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = [...existing, ...value];
      continue;
    }
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = { ...existing, ...value };
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

export function createAgentHookDispatcher() {
  const hooks = new Map<AgentHookName, AgentHook[]>();

  /**
   * 链执行语义的唯一实现（一个概念只表达一次）：
   * 按序执行 + mergeHookPatches 累积 + blocked 短路 + ERROR_PROPAGATING 穿透。
   * dispatch（默认链）与 dispatchChain（M4 placement 拼接链）共用本实现。
   */
  async function executeChain(
    name: AgentHookName,
    chain: ReadonlyArray<AgentHook>,
    context: AgentHookContext,
  ): Promise<AgentHookResult<Record<string, unknown>>> {
    // v2 模块G #9 / P2-6: 使用 Array.from 快照避免迭代期间修改风险
    const snapshot = Array.from(chain);
    let patch: Record<string, unknown> | undefined;
    const emittedEvents: Array<Record<string, unknown>> = [];
    // v5.2 EC5: 错误穿透白名单检查（在循环外计算一次）
    // on_task_complete hook 抛错穿透到 ReActLoop catch → after_agent_fail 恢复
    const propagateError = ERROR_PROPAGATING_HOOKS.has(name);

    for (const hook of snapshot) {
      try {
        const result = await hook(context);
        if (!result) {
          continue;
        }

        patch = mergeHookPatches(patch, result.patch as Record<string, unknown> | undefined);
        if (result.emittedEvents?.length) {
          emittedEvents.push(...result.emittedEvents);
        }
        if (result.blocked) {
          return {
            blocked: true,
            reason: result.reason,
            patch,
            emittedEvents,
          };
        }
      } catch (hookError) {
        if (propagateError) {
          // v5.2 EC5: on_task_complete hook 抛错直接向上抛
          // 穿透到 ReActLoop.executeReActWithRecovery catch → after_agent_fail 恢复逻辑
          // 禁止 audit-hook.ts 回调内 try/catch 包裹 auditAgent.auditForReport
          throw hookError;
        }
        // v2 模块G #9 (P0-3 修复): 其他 Hook 异常不中断循环，记录 warn 日志继续执行下一个 hook
        logger.warn('Hook execution failed, continuing', {
          hookName: name,
          error: getErrorMessage(hookError),
          stack: hookError instanceof Error ? hookError.stack : undefined,
        });
        // 不中断循环，继续执行下一个 hook
      }
    }

    return {
      patch,
      emittedEvents,
    };
  }

  return {
    register(name: AgentHookName, hook: AgentHook): void {
      const queue = hooks.get(name) ?? [];
      queue.push(hook);
      hooks.set(name, queue);
    },

    /**
     * 默认链只读访问（M4 §8.3：HookDispatcher 拼接 baseHooks + placement 解析链用）。
     * 返回内部数组的只读视图，调用方禁止原地修改（执行前 executeChain 会快照）。
     */
    getHooks(name: AgentHookName): ReadonlyArray<AgentHook> {
      return hooks.get(name) ?? [];
    },

    async dispatch(
      name: AgentHookName,
      context: AgentHookContext,
    ): Promise<AgentHookResult<Record<string, unknown>>> {
      return executeChain(name, hooks.get(name) ?? [], context);
    },

    /**
     * 显式链执行（M4 §8.3：placement 拼接链与默认链共用同一执行语义）。
     * chain 不经过注册表——调用方（HookDispatcher）负责链的组装顺序。
     */
    async dispatchChain(
      name: AgentHookName,
      chain: ReadonlyArray<AgentHook>,
      context: AgentHookContext,
    ): Promise<AgentHookResult<Record<string, unknown>>> {
      return executeChain(name, chain, context);
    },
  };
}
