/**
 * 工具结果 Hook 合并（M4 子任务A：合并基建）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M4-4维度Hook.md §7.2/§7.3
 *
 * 职责：after_tool_call 字段级覆盖——单 patch 应用（applyAfterToolCallPatch）
 * 与多 hook 累积合并（mergeToolHookResult）。收敛 ReActEngine.ts 与 ReActLoop.ts
 * 两处逐字重复的本地实现（设计 §22 I-3，一个概念只表达一次）。
 * 另含 toolName → domain 解析（resolveDomainFromToolName，§16.1 文件清单归属）。
 *
 * 语义原则（pi 对齐，§7.1）：
 * - 省略字段保留原值；显式 undefined 视为省略（patch.x === undefined 等价无此键）
 * - 无深合并：仅 dataMerge（浅合并一层）与 appendWarnings（数组 concat）两个
 *   显式命名的合并语义字段
 * - 纯函数：不修改入参，返回新对象
 */

import { createChildLogger } from '../../utils/logger.js';
import type { AfterToolCallPatch } from './types.js';

const logger = createChildLogger('tool-result-merge');

/**
 * mergeToolHookResult 的返回形态。
 * terminate 不写入 result（§7.2 步骤6：由引擎消费，避免污染工具结果信封）。
 */
export interface ToolHookMergeOutcome {
  result: Record<string, unknown>;
  terminate: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将单个 AfterToolCallPatch 应用到工具结果（字段级覆盖，§7.2）。
 *
 * 应用顺序固定（确定性合并语义 G3 的前提）：
 * result（deprecated 基底）→ dataMerge → data → appendWarnings → error/isError。
 * 顺序不可调换：dataMerge 先于 data 使"整体替换"能覆盖"浅合并"，
 * appendWarnings 在 data 之后使警告追加到最终生效的 data 上。
 */
export function applyAfterToolCallPatch(
  base: Record<string, unknown>,
  patch: AfterToolCallPatch,
): Record<string, unknown> {
  let current: Record<string, unknown> = { ...base };

  // 步骤1 result（@deprecated 整对象形态）：浅合并为后续步骤的基底。
  // 必须是浅合并而非整体替换——既有语义要求部分 result patch 保留 base 的
  // success/_meta/writeOperation 等未覆盖字段（行为等价原则，基线测试钉死）。
  if (patch.result !== undefined) {
    current = { ...current, ...patch.result };
  }

  // 步骤2 dataMerge：仅当当前 data 为 plain object 时浅合并一层；
  // 目标非 plain object 时忽略并 warn（hook 故障不阻断主流程，§7.2 异常分支）
  if (patch.dataMerge !== undefined) {
    if (isPlainObject(current.data)) {
      current = { ...current, data: { ...current.data, ...patch.dataMerge } };
    } else {
      logger.warn('dataMerge ignored: current data is not a plain object', {
        dataType: typeof current.data,
      });
    }
  }

  // 步骤3 data：整体替换（与 dataMerge 同现时 dataMerge 先应用、data 后覆盖，§7.2 顺序）
  if (patch.data !== undefined) {
    current = { ...current, data: patch.data };
  }

  // 步骤4 appendWarnings：concat 到当前 data.warnings（warnings 非数组视为空，§7.2）
  if (patch.appendWarnings !== undefined) {
    if (isPlainObject(current.data)) {
      const existingWarnings = Array.isArray(current.data.warnings) ? current.data.warnings : [];
      current = {
        ...current,
        data: { ...current.data, warnings: [...existingWarnings, ...patch.appendWarnings] },
      };
    } else {
      logger.warn('appendWarnings ignored: current data is not a plain object', {
        dataType: typeof current.data,
      });
    }
  }

  // 步骤5 error / isError 标量覆盖（空字符串 error 是合法的"清除错误"语义，不能用真值判断）
  if (patch.error !== undefined) {
    current = { ...current, error: patch.error };
  }
  if (patch.isError !== undefined) {
    current = { ...current, success: !patch.isError };
    // isError=true 且 error 缺失时补默认描述（§7.2：保证 LLM 可读的错误信封）；
    // 显式清除（error:''）不视为缺失——hook 已明确表达了清除意图
    if (patch.isError && patch.error === undefined && typeof current.error !== 'string') {
      current = { ...current, error: 'marked-error-by-hook' };
    }
  }

  return current;
}

/**
 * 多 hook 字段级累积合并（G3 核心，§7.3）。
 *
 * 折叠语义：patches 按执行顺序（特异性升序，D4.4）依次应用——
 * 标量后执行者赢、dataMerge 逐层浅合并、appendWarnings 按序追加；
 * terminate 任一为 true 即 true（OR 语义，§7.3：AGG 单工具调用模型下与 pi 全 true 等价）。
 *
 * 全部 patch 缺省时返回 base 原引用（无覆盖语义，§13：patch 全字段无效 → 返回 base 原值）。
 */
export function mergeToolHookResult(
  base: Record<string, unknown>,
  patches: ReadonlyArray<AfterToolCallPatch | undefined>,
): ToolHookMergeOutcome {
  let current = base;
  let terminate = false;
  for (const patch of patches) {
    if (patch === undefined) {
      continue;
    }
    current = applyAfterToolCallPatch(current, patch);
    if (patch.terminate === true) {
      terminate = true;
    }
  }
  return { result: current, terminate };
}

/**
 * 从 toolName 解析领域标识（D4.6 / §8.1，§16.1 文件清单归属本文件）。
 *
 * 规则：`map_service__create_location` → 取 `__` 前缀 `map_service` →
 * 去 `_service` 后缀 → `map`；无 `_service` 后缀的前缀原样使用（`dynamic_ui__render`
 * → `dynamic_ui`）；无 `__` 分隔符或空前缀 → 无 domain（§13：不匹配领域维度 entry）。
 *
 * 与 default-agent-hooks.ts isWriteOperation 的 `__` 切分逻辑同构（一个概念一种切法）。
 */
export function resolveDomainFromToolName(toolName: string | undefined): string | undefined {
  if (!toolName) {
    return undefined;
  }
  const sepIndex = toolName.indexOf('__');
  if (sepIndex <= 0) {
    return undefined;
  }
  const prefix = toolName.slice(0, sepIndex);
  const SERVICE_SUFFIX = '_service';
  return prefix.endsWith(SERVICE_SUFFIX) ? prefix.slice(0, -SERVICE_SUFFIX.length) : prefix;
}
