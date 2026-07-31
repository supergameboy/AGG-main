/**
 * transform-messages — 跨 Provider 历史消息回放归一化（M2-3，裁剪版 §15-D6）
 *
 * 为什么需要 toolCall ID 归一化：Anthropic 要求 tool_use.id / tool_result.tool_use_id
 * 匹配 ^[a-zA-Z0-9_-]{1,64}$，而 OpenAI Responses / 部分国内 Provider 生成的 ID
 * 可能超长（450+ 字符）或含 `|`/`.` 等特殊字符。M5 prepareNextTurn 跨模型切换后，
 * 历史消息中的 toolCall 原样回放会被 Anthropic 校验拒绝，必须在 Provider 边界归一化。
 *
 * 裁剪说明（与设计 §5.3 对齐）：仅保留 normalizeToolCallIds；
 * image downgrade 无消费者暂缓；thinking 块跨模型处理 AGG 天然无需（reasoningContent
 * 是字符串字段，跨模型时本就不发送）。
 *
 * 签名与设计 §6.4 的差异说明：设计签名固定 LLMMessageExtended[]，但真实消费方
 * AnthropicCompatibleProvider.convertMessages 处理的是 shared 的 LLMMessage[]
 * （role 含 'function'，与 LLMMessageExtended 互不兼容）。这里用泛型结构子集
 * ToolCallIdCarrier 表达"本函数只触碰 role/toolCallId/toolCalls 三个字段"的契约，
 * LLMMessage / LLMMessageExtended 均满足，且对 LLMMessageExtended 调用时与设计
 * 签名完全等价（泛型实例化后返回类型即 LLMMessageExtended[]）。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.4
 */

import { createHash } from 'node:crypto';

/** 归一化目标 API 形态 */
export type ToolCallIdTarget = 'anthropic' | 'openai';

/**
 * 归一化所需的最小消息结构（LLMMessage / LLMMessageExtended 均满足）。
 * content/name/reasoningContent 等字段本函数不读取不修改，泛型透传。
 */
export interface ToolCallIdCarrier {
  role: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/** 归一化结果 */
export interface NormalizeToolCallIdsResult<T extends ToolCallIdCarrier> {
  /** 归一化后的消息列表（未变更的消息保持原引用，便于调用方 diff） */
  messages: T[];
  /** originalId → normalizedId 映射（仅包含实际发生替换的条目） */
  idMap: ReadonlyMap<string, string>;
  /** 是否发生任何替换 */
  changed: boolean;
}

/** 目标约束：anthropic 字符集 + 长度双约束；openai 仅长度约束（字符集不约束） */
interface TargetLimits {
  pattern: RegExp | null;
  maxLength: number;
}

const TARGET_LIMITS: Record<ToolCallIdTarget, TargetLimits> = {
  anthropic: { pattern: /^[a-zA-Z0-9_-]{1,64}$/, maxLength: 64 },
  openai: { pattern: null, maxLength: 64 },
};

/**
 * 跨 Provider toolCall ID 归一化
 *
 * 规则：
 * - target='anthropic'：ID 必须匹配 ^[a-zA-Z0-9_-]{1,64}$，不合规 ID 替换为 `tc_${sha256hex16}`
 * - target='openai'：仅替换超长 ID（>64），字符集不约束
 * - 同一 originalId 在消息列表内保持一致映射（assistant.toolCalls[].id 与
 *   tool 角色消息 toolCallId 同步替换，配对不断裂）
 * - 已合规 ID 原样保留且不进 idMap（幂等：对已归一化列表再次调用 changed=false）
 * - 替换值确定性：同一 originalId 任意时刻归一化结果相同（sha256 前 16 hex，总长 19 ≤ 64）
 *
 * 消费方：AnthropicCompatibleProvider.convertMessages 前置调用；
 *        M5 prepareNextTurn 跨模型切换后的历史回放路径。
 */
export function normalizeToolCallIds<T extends ToolCallIdCarrier>(
  messages: T[],
  target: ToolCallIdTarget,
): NormalizeToolCallIdsResult<T> {
  const limits = TARGET_LIMITS[target];
  const idMap = new Map<string, string>();
  // normalized → original 反向索引：处理 sha256 前缀冲突（理论可能，§6.8 Edge path）
  const usedNormalized = new Map<string, string>();

  const isCompliant = (id: string): boolean =>
    id.length <= limits.maxLength && (limits.pattern === null || limits.pattern.test(id));

  const normalize = (id: string): string => {
    const mapped = idMap.get(id);
    if (mapped !== undefined) return mapped;
    if (isCompliant(id)) return id;

    const base = `tc_${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
    let normalized = base;
    // 冲突处理：不同 originalId 得到相同 hash 前缀时追加序号（`_1`/`_2` 仍在合法字符集内）
    for (let suffix = 1; usedNormalized.has(normalized) && usedNormalized.get(normalized) !== id; suffix++) {
      normalized = `${base}_${suffix}`;
    }

    idMap.set(id, normalized);
    usedNormalized.set(normalized, id);
    return normalized;
  };

  let anyChanged = false;
  const result = messages.map((message) => {
    const toolCallId = message.toolCallId;
    const toolCalls = message.toolCalls;
    const hasToolCalls = toolCalls !== undefined && toolCalls.length > 0;
    if (toolCallId === undefined && !hasToolCalls) return message;

    let next = message;

    if (toolCallId !== undefined) {
      const normalizedId = normalize(toolCallId);
      if (normalizedId !== toolCallId) {
        next = { ...next, toolCallId: normalizedId };
      }
    }

    if (hasToolCalls) {
      let toolCallsChanged = false;
      const normalizedToolCalls = toolCalls.map((toolCall) => {
        const normalizedId = normalize(toolCall.id);
        if (normalizedId === toolCall.id) return toolCall;
        toolCallsChanged = true;
        return { ...toolCall, id: normalizedId };
      });
      if (toolCallsChanged) {
        next = { ...next, toolCalls: normalizedToolCalls };
      }
    }

    if (next !== message) anyChanged = true;
    return next;
  });

  return {
    // 零替换时返回原数组引用：T1/T8 的"原样返回"语义，调用方可用 === 快速判断无变更
    messages: anyChanged ? result : messages,
    idMap,
    changed: anyChanged,
  };
}
