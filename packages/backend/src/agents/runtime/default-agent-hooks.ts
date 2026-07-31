/**
 * 默认 hook 链工厂（M4 子任务B「默认行为平权」）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M4-4维度Hook.md §9.1/§10
 *
 * 平权改造：原模块级匿名 hook 改为命名工厂（readonly-guard / arg-normalizer /
 * fail-recovery-seed / progress-broadcaster），与 result-normalizer、audit-hook
 * 同为 HookImplRegistry 可注册的平级实现——默认行为不再是写死在注册函数里的
 * 特权代码，而是可经 impl_id 引用、可被 placement 配置编排的普通 hook 实现。
 *
 * 依赖注入：webSocketService 通过函数签名显式注入（v1.4 起禁止模块级 value import）。
 */
import type { AgentHook, AgentHookName } from './agent-hooks.js';
import type { AgentHookPoliciesConfig } from '../../../../shared/src/types/agent-config.js';
import type { ProgressEvent } from '@ai-rpg/shared';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import { logger } from '../../utils/logger.js';
import { createResultNormalizerHook } from './result-normalizer.js';
import type { HookPayloadFor, TypedAgentHook } from './types.js';

type HookRegistrationTarget = {
  register: (name: AgentHookName, hook: AgentHook) => void;
};

/**
 * 默认 hook 链条目（hook 名 + 类型化实现）。
 * hook 字段用 AgentHook 承载：TypedAgentHook<N> 的 patch 类型经结构协变可安全赋值，
 * 注册侧（dispatcher）本就以 AgentHook 擦除形态存储。
 */
export interface DefaultAgentHookEntry {
  name: AgentHookName;
  hook: AgentHook;
}

/**
 * 默认 hook 依赖（v1.4 新增）：通过函数签名显式注入，替代模块级 value import。
 */
export interface DefaultAgentHooksDeps {
  webSocketService: IWebSocketBroadcaster;
}

function isWriteOperation(toolName: string | undefined): boolean {
  if (!toolName) {
    return false;
  }

  // v2 模块H H13: 无 __ 分隔符不视为写操作（避免误判无前缀工具）
  const sepIndex = toolName.indexOf('__');
  if (sepIndex < 0) {
    return false;
  }
  const method = toolName.slice(sepIndex + 2);
  if (!method) {
    return false;
  }

  // v2 模块H H13: 补全 fetch_/search_/lookup_/scan_/has_/is_/exists_/ensure_/test_ 只读前缀
  return !/^(get_|list_|describe_|read_|find_|query_|check_|validate_|can_|preview_|resolve_|fetch_|search_|lookup_|scan_|has_|is_|exists_|ensure_|test_)/.test(method);
}

/**
 * impl_id: readonly-guard —— before_tool_call 只读降级阻断。
 * 行为等价迁移自原 registerDefaultAgentHooks 组合 hook 的前半段（readonlyMode 下写操作阻断）。
 */
export function createReadonlyGuardHook(): TypedAgentHook<'before_tool_call'> {
  return async (context) => {
    const payload = context.payload as HookPayloadFor<'before_tool_call'> | undefined;
    if (payload?.readonlyMode && isWriteOperation(payload.toolName)) {
      return {
        blocked: true,
        reason: 'readonly-degrade-active',
      };
    }
    return undefined;
  };
}

/**
 * impl_id: arg-normalizer —— before_tool_call 参数归一化。
 * 行为等价迁移自原组合 hook 的后半段（args 透传为 normalizedArguments）。
 */
export function createArgNormalizerHook(): TypedAgentHook<'before_tool_call'> {
  return async (context) => {
    const payload = context.payload as HookPayloadFor<'before_tool_call'> | undefined;
    if (payload?.args) {
      return {
        patch: {
          normalizedArguments: payload.args,
        },
      };
    }
    return undefined;
  };
}

/**
 * impl_id: fail-recovery-seed —— after_agent_fail 恢复种子（错误消息写入 recovery.reason）。
 */
export function createFailRecoverySeedHook(): TypedAgentHook<'after_agent_fail'> {
  return async (context) => {
    const payload = context.payload as HookPayloadFor<'after_agent_fail'> | undefined;
    // 调用方实测可能传 Error 实例（HookPayloadMap 是收敛声明，运行时容错保留）
    const errorValue = payload?.error as { message?: string } | Error | undefined;
    const message = errorValue instanceof Error
      ? errorValue.message
      : errorValue?.message ?? 'unknown failure';

    return {
      patch: {
        recovery: {
          reason: message,
        },
      },
    };
  };
}

/**
 * impl_id: progress-broadcaster —— report_progress WS 广播。
 * v2: ProgressContext 经 snapshot 传递（单一数据源）；广播失败仅 warn 绝不阻塞。
 */
export function createProgressBroadcasterHook(
  deps: DefaultAgentHooksDeps,
): TypedAgentHook<'report_progress'> {
  return async (context) => {
    const payload = context.payload as HookPayloadFor<'report_progress'> | undefined;
    if (!payload) {
      return undefined;
    }

    const ctx = context.snapshot?.progressContext;
    if (!ctx) {
      // 无 ProgressContext：未初始化或非标准路径，静默跳过
      return undefined;
    }

    const event: ProgressEvent = {
      phase: payload.phase,
      agentType: payload.agentType,
      agentRunId: ctx.agentRunId,
      taskDescription: payload.taskDescription,
      parentTask: payload.parentTask,
      detail: payload.detail,
      timestamp: Date.now(),
    };

    // v2: 统一通过 broadcastToClient 发送，池生成和游戏流走同一条路径
    try {
      deps.webSocketService.broadcastToClient(
        ctx.broadcastClientId,
        'agent_progress',
        event,
        ctx.requestId,
      );
    } catch (wsError) {
      logger.warn('report_progress WS broadcast failed', {
        error: wsError,
        clientId: ctx.broadcastClientId,
        phase: payload.phase,
      });
    }

    return undefined;
  };
}

/**
 * 创建默认 hook 链（工厂形态，§9.1/§10）。
 *
 * 链序即执行序：readonly-guard 先于 arg-normalizer（阻断短路语义与原组合 hook 一致）；
 * result-normalizer 是 after_tool_call 派发链第一棒（§10.1），为降级链保留规范化能力（D4.7）。
 */
export function createDefaultAgentHooks(
  deps: DefaultAgentHooksDeps,
): ReadonlyArray<DefaultAgentHookEntry> {
  return [
    { name: 'before_tool_call', hook: createReadonlyGuardHook() },
    { name: 'before_tool_call', hook: createArgNormalizerHook() },
    { name: 'after_tool_call', hook: createResultNormalizerHook() },
    { name: 'after_agent_fail', hook: createFailRecoverySeedHook() },
    { name: 'report_progress', hook: createProgressBroadcasterHook(deps) },
  ];
}

/**
 * 注册默认 hook 链（hookPolicies.disable 按 hook 名过滤，语义不变）。
 * 签名保持 M3 兼容：hook-dispatcher.ts 调用点零变更。
 */
export function registerDefaultAgentHooks(
  target: HookRegistrationTarget,
  policies: AgentHookPoliciesConfig | undefined,
  deps: DefaultAgentHooksDeps,
): void {
  const disabled = new Set(policies?.disable ?? []);
  for (const { name, hook } of createDefaultAgentHooks(deps)) {
    if (!disabled.has(name)) {
      target.register(name, hook);
    }
  }
}
