/**
 * AgentRuntimeState —— AgentRuntime 请求级可变状态的单一聚合接口。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M3-AgentRuntime拆分.md §6
 *
 * 对标 pi:AgentState 单一接口聚合模式。
 * 不含 BaseAgent 状态（D3.1）；不含 GM 跨请求状态（§6.1 C 类）。
 *
 * 生命周期：per-AgentRuntime 实例。子 Agent 请求经
 * createRequestScopedCopy 整体拷贝（结构化深拷贝）。
 */

import type { TaskContract } from '../../../../shared/src/types/audit.js';
import type { ProgressContext } from '@ai-rpg/shared';
import type { TraceCollector } from '../../services/TraceCollector.js';
import type { AgentRuntimeSnapshot } from './agent-runtime-snapshot.js';
import type { AgentRequestPath } from './hook-placement-config.js';

/** 恢复运行时状态（RecoveryCoordinator 单写者，其余模块只读） */
export interface RecoveryRuntimeState {
  attempts: number;
  readonlyMode: boolean;
}

export interface AgentRuntimeState {
  /** 当前 action（消息路由意图，per-request） */
  currentAction: string | undefined;
  /** 当前任务契约（coordinator-service 传递，per-request） */
  currentTaskContract: TaskContract | undefined;
  /** 已授权工具函数名集合（grantAllToolPermissions/LLM 动态授权） */
  allowedFunctionNames: Set<string>;
  /** 排除的方法清单（prompt 层工具曝光过滤） */
  excludedMethods: Array<{ source: string; method: string }>;
  /** 请求级 trace 收集器（deps.createTraceCollector 创建） */
  traceCollector: TraceCollector | undefined;
  /** 请求级进度上下文（report_progress Hook 广播载体） */
  progressContext: ProgressContext | null;
  /** 恢复运行时状态（RecoveryCoordinator 单写者） */
  recovery: RecoveryRuntimeState;
  /** 待应用的 RuntimeSnapshot 刷新队列（并发请求排队） */
  pendingRuntimeRefreshes: AgentRuntimeSnapshot[];
  /** GM 感知提示（一次性消费，per-request） */
  pendingPerceptionHint: string | null;
  /** 已审核 key 集合（on_task_complete 去重，processMessageCore 入口清空） */
  auditedKeys: Set<string>;
  /**
   * 当前请求路径（M4 §14.4：4 维度 placement 的 path 维度来源）。
   * facade（AgentRuntime）单写者——路由进三条路径处理方法时写入；
   * ToolExecutor/dispatchHook 只读。初始值 game_master 仅为占位，
   * 派发前必经路由覆写，无默认值参与解析的场景。
   */
  currentPath: AgentRequestPath;
}

/** Mutable 版本（对标 pi:MutableAgentState；当前与只读接口同形） */
export type MutableAgentRuntimeState = AgentRuntimeState;

export function createInitialAgentRuntimeState(): AgentRuntimeState {
  return {
    currentAction: undefined,
    currentTaskContract: undefined,
    allowedFunctionNames: new Set(),
    excludedMethods: [],
    traceCollector: undefined,
    progressContext: null,
    recovery: { attempts: 0, readonlyMode: false },
    pendingRuntimeRefreshes: [],
    pendingPerceptionHint: null,
    auditedKeys: new Set(),
    currentPath: 'game_master',
  };
}

/**
 * 请求级拷贝（createRequestScopedCopy 专用）。
 * 防御性拷贝集合/数组字段，标量字段直接复制。
 */
export function cloneAgentRuntimeStateForRequestScope(
  state: AgentRuntimeState,
): AgentRuntimeState {
  return {
    currentAction: state.currentAction,
    currentTaskContract: structuredClone(state.currentTaskContract),
    allowedFunctionNames: new Set(state.allowedFunctionNames),
    excludedMethods: structuredClone(state.excludedMethods),
    traceCollector: state.traceCollector,
    progressContext: state.progressContext,
    recovery: structuredClone(state.recovery),
    pendingRuntimeRefreshes: [...state.pendingRuntimeRefreshes],
    pendingPerceptionHint: state.pendingPerceptionHint,
    auditedKeys: new Set(state.auditedKeys),
    currentPath: state.currentPath,
  };
}
