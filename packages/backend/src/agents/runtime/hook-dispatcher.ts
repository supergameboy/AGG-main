/**
 * HookDispatcher —— Hook 生命周期的唯一拥有者（M3 模块 2）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M3-AgentRuntime拆分.md §8
 *
 * 职责：Hook 注册（默认 hooks + 策略 + 动态注册）、派发（快照获取 + ProgressContext
 * 注入 + 错误传播策略）、进度上报（report_progress 统一入口）、种子快照构建。
 *
 * 迁移自 AgentRuntime（行为等价，纯移动）：
 * resetHookRuntime / registerHook / applyHookPolicies / getHookPolicies /
 * reportProgress / dispatchHook / createHookSeedSnapshot
 *
 * 错误传播策略（§8.4 保持现状）：
 * - ERROR_PROPAGATING_HOOKS（agent-hooks.ts）内 hook 异常向上传播
 * - 其余 hook 异常 warn 后继续后续 hook
 * - report_progress 派发失败仅 warn，绝不阻塞主流程
 *
 * M4 扩展（模块M4-4维度Hook §8.3/§8.6）：
 * - dispatch 接受可选 placement 上下文：baseHooks 在前 + placementResolver
 *   解析链（特异性升序）在后拼接执行；无 placement 或无 resolver 走现状默认链
 * - 循环派发防护：AsyncLocalStorage 跟踪因果嵌套深度，深度 > MAX_DISPATCH_DEPTH(3)
 *   时 error 日志 + 返回空结果（链不执行）。
 *   深度必须按因果链计量而非 per-instance 在途计数：dispatcher 是 per-AgentRuntime
 *   共享单例，triggerCompression 的 4 路并发压缩任务与 fire-and-forget 的
 *   reportProgress 都是合法的并发兄弟派发，在途计数会把并发误判为循环
 *   （基线回归：react-agent-hook-runtime before_compaction veto 用例）。
 *
 * 依赖方向：仅依赖 types.ts 接口 + agent-hooks/default-agent-hooks 同层模块 +
 * 外部端口（IWebSocketBroadcaster），零 import facade（D3.3 snapshotProvider 回调注入）。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentHookPoliciesConfig } from '../../../../shared/src/types/agent-config.js';
import type { ProgressPhase, ProgressDetail } from '@ai-rpg/shared';
import { createChildLogger } from '../../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import {
  createAgentHookDispatcher,
  type AgentHook,
  type AgentHookName,
  type AgentHookResult,
} from './agent-hooks.js';
import { registerDefaultAgentHooks } from './default-agent-hooks.js';
import type { AgentRuntimeSnapshot } from './agent-runtime-snapshot.js';
import type {
  HookDispatchArgs,
  HookDispatcherDeps,
  HookEventName,
  HookPatchMap,
  IHookDispatcher,
} from './types.js';

const logger = createChildLogger('hook-dispatcher');

/**
 * 循环派发深度上限（M4 §8.6）。
 * 现状最深因果嵌套 = 2（dispatch → hook 执行体 → reportProgress 的 dispatch），
 * MAX=3 容纳现状且封堵更深的循环；触发即缺陷信号（logger.error，非 warn）。
 */
export const MAX_DISPATCH_DEPTH = 3;

/**
 * 因果派发深度上下文（§8.6）。
 * ALS 沿 await 链传播：嵌套派发（dispatch → hook → dispatch）深度递增；
 * 并发兄弟派发（4 路压缩任务、fire-and-forget reportProgress）各自从
 * 其因果父上下文派生深度，互不叠加——在途并发数不参与循环判定。
 */
const dispatchDepthContext = new AsyncLocalStorage<{ depth: number }>();

export class HookDispatcher implements IHookDispatcher {
  private dispatcher = createAgentHookDispatcher();
  private registeredHooks: Array<{ name: AgentHookName; hook: AgentHook }> = [];
  private policies: AgentHookPoliciesConfig | undefined;
  private readonly deps: HookDispatcherDeps;

  constructor(deps: HookDispatcherDeps) {
    this.deps = deps;
    this.policies = deps.hookPolicies ? structuredClone(deps.hookPolicies) : undefined;
    this.resetRuntime();
  }

  register(name: AgentHookName, hook: AgentHook): void {
    this.registeredHooks.push({ name, hook });
    this.dispatcher.register(name, hook);
  }

  async dispatch<K extends HookEventName>(
    eventName: K,
    args: HookDispatchArgs,
  ): Promise<AgentHookResult<HookPatchMap[K]>> {
    // §8.6：循环派发是缺陷信号——error 级日志 + 空结果，链不执行。
    // 深度取因果父上下文 +1；无上下文（顶层派发）从 1 起计
    const depth = (dispatchDepthContext.getStore()?.depth ?? 0) + 1;
    if (depth > MAX_DISPATCH_DEPTH) {
      logger.error('Hook dispatch depth exceeded, aborting nested dispatch', {
        eventName,
        depth,
        maxDepth: MAX_DISPATCH_DEPTH,
      });
      return { emittedEvents: [] };
    }

    return dispatchDepthContext.run({ depth }, async () => {
      const baseSnapshot = this.deps.snapshotProvider() ?? this.createSeedSnapshot(args.requestId);
      const progressContext = this.deps.stateReader.progressContext;
      const snapshot: AgentRuntimeSnapshot = progressContext
        ? { ...baseSnapshot, progressContext }
        : baseSnapshot;

      const context = {
        requestId: args.requestId,
        agentRunId: args.agentRunId,
        iteration: this.deps.stateReader.recovery.attempts,
        traceIds: {
          requestId: args.requestId,
          agentRunId: args.agentRunId,
          toolCallId: args.toolCallId,
        },
        snapshot,
        payload: args.payload,
      };

      // §8.3 伪代码落地：无 placement 或无 resolver → 现状默认链（渐进兼容）；
      // 有 placement → baseHooks 在前（通用语义）+ resolved 按特异性升序在后
      // （越具体越后执行，标量后执行者赢）。resolved 内部异常已自行降级（D4.7），
      // 此处不再 try/catch。
      let result: AgentHookResult<Record<string, unknown>>;
      if (args.placement !== undefined && this.deps.placementResolver !== undefined) {
        const resolved = this.deps.placementResolver.resolvePlacement(eventName, args.placement);
        const chain: AgentHook[] = [...this.dispatcher.getHooks(eventName), ...resolved.hooks];
        result = await this.dispatcher.dispatchChain(eventName, chain, context);
      } else {
        result = await this.dispatcher.dispatch(eventName, context);
      }
      // 底层 createAgentHookDispatcher（agent-hooks.ts）返回宽泛 Record 形态；
      // hook 名 → patch 类型的绑定由 IHookDispatcher 泛型签名保证，此处是类型边界的单点窄化
      return result as AgentHookResult<HookPatchMap[K]>;
    });
  }

  reportProgress(phase: ProgressPhase, detail?: ProgressDetail): void {
    const ctx = this.deps.stateReader.progressContext;
    if (!ctx) return;  // 未初始化，静默跳过

    this.dispatch('report_progress', {
      requestId: ctx.requestId,
      agentRunId: ctx.agentRunId,
      payload: {
        phase,
        agentType: this.deps.agentTypeLabel,
        taskDescription: ctx.taskDescription,
        parentTask: ctx.parentTask,
        detail,
      },
    }).catch(err => {
      logger.warn('report_progress hook failed', { error: getErrorMessage(err) });
    });
  }

  applyPolicies(policies: AgentHookPoliciesConfig | undefined): void {
    this.policies = policies ? structuredClone(policies) : undefined;
    this.resetRuntime();
  }

  getPolicies(): AgentHookPoliciesConfig | undefined {
    return this.policies ? structuredClone(this.policies) : undefined;
  }

  resetRuntime(): void {
    this.dispatcher = createAgentHookDispatcher();
    registerDefaultAgentHooks(
      this.dispatcher,
      this.policies,
      { webSocketService: this.deps.webSocketService },
    );
    for (const { name, hook } of this.registeredHooks) {
      this.dispatcher.register(name, hook);
    }
    // v5.2 EC7: on_task_complete hook 注册（审核挂起-恢复模式核心）
    this.dispatcher.register('on_task_complete', this.deps.onTaskCompleteHook);
  }

  getRegisteredHooks(): ReadonlyArray<{ name: AgentHookName; hook: AgentHook }> {
    return this.registeredHooks;
  }

  restoreRegisteredHooks(hooks: ReadonlyArray<{ name: AgentHookName; hook: AgentHook }>): void {
    this.registeredHooks = [...hooks];
    for (const { name, hook } of hooks) {
      this.dispatcher.register(name, hook);
    }
  }

  /** 种子快照（getRuntimeSnapshot 为 null 时兜底，等价迁移自 createHookSeedSnapshot） */
  private createSeedSnapshot(requestId: string): AgentRuntimeSnapshot {
    const fields = this.deps.seedSnapshotFactory();
    return {
      requestId,
      sessionId: fields.saveId ?? 'unknown-session',
      agentKey: this.deps.agentKey,
      createdAt: Date.now(),
      modelSnapshot: {
        providerId: fields.providerId,
        model: fields.model,
        temperature: fields.temperature,
        maxTokens: fields.maxTokens,
      },
      permissionSnapshot: {
        configuredTools: [...fields.configuredTools],
        defaultDeny: true,
      },
      ruleSnapshot: [],
      skillSnapshot: [],
      helpSnapshot: [],
      toolVisibilitySnapshot: {
        allowedToolTypes: [],
        allowedFunctionNames: [],
      },
      promptSnapshot: {
        systemPrompt: fields.systemPrompt,
        userPrompt: '',
      },
      contextSnapshot: {
        language: fields.language,
        templateId: fields.templateId,
      },
      debugSnapshot: {
        source: 'hook-seed',
      },
    };
  }
}
