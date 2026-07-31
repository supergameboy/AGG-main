/**
 * 默认 after_tool_call hook —— 结果信封规范化（M4 子任务B「默认行为平权」）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M4-4维度Hook.md §10
 *
 * 职责边界（§10.1/Q-6 拍板A）：
 * - after_tool_call 此前无默认 hook，本实现补齐最小职责：保证下游高特异性 hook
 *   与引擎拿到的 result 信封字段形态一致（success/error 标量齐全）
 * - 仅信封规范化，无任何副作用（不写库、不广播、不追加 warnings——
 *   审核注解是高特异性 hook 职责，通用默认 hook 不越权，§14.1 延伸原则）
 *
 * 设计约束（§10.2）：
 * - 幂等：对已规范的 result 返回 undefined（无 patch），多次执行结果收敛
 * - 非侵入：不触碰 data/_meta/writeOperation
 */
import type { AfterToolCallPatch, HookPayloadFor, TypedAgentHook } from './types.js';

/**
 * 创建 after_tool_call 信封规范化 hook（impl_id: result-normalizer）。
 *
 * 规范化规则（§10.2）：
 * 1. success 缺失（非 boolean）时从 isError/error 推导（工具实现缺陷防御）
 * 2. 失败结果缺 error 描述时补默认文案（LLM 可读性）
 */
export function createResultNormalizerHook(): TypedAgentHook<'after_tool_call'> {
  return async (context) => {
    // 单点收敛：payload 声明形态以 HookPayloadMap 为准（§6.4 收敛声明）
    const payload = context.payload as HookPayloadFor<'after_tool_call'> | undefined;
    if (!payload?.result) {
      return undefined;
    }

    const result = payload.result;
    const patch: AfterToolCallPatch = {};

    // 规范化 1：success 缺失时从 error/isError 推导
    if (typeof result.success !== 'boolean') {
      patch.isError = payload.isError || typeof result.error === 'string';
    }

    // 规范化 2：success=false 但 error 缺失 → 补默认错误描述
    const effectiveSuccess = patch.isError !== undefined
      ? !patch.isError
      : result.success === true;
    if (!effectiveSuccess && typeof result.error !== 'string') {
      patch.error = 'tool execution failed (no error message provided)';
    }

    return Object.keys(patch).length > 0 ? { patch } : undefined;
  };
}
