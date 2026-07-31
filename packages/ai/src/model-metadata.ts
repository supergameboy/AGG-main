/**
 * Model 元数据（M2-2，裁剪版 §15-D5）
 *
 * 为已知模型提供静态元数据（cost/contextWindow/能力标志），支持 DB extraConfig.metadata 覆盖。
 * 解析优先级（高 → 低）：dbOverride（E 层解析后传入，H 层不碰 DB）> 静态表 > undefined。
 *
 * 诚实裁剪（与 pi 差异）：不做代码生成管线，静态表为手工维护的"维护性快照"（R5）；
 * 未知模型返回 undefined，禁止编造默认值；模型调价后由管理员经 DB override 热修正。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.3
 */

import { createChildLogger } from './utils/logger.js';

/** 成本元数据（单位：USD / 百万 tokens，与 pi 对齐） */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Provider 兼容标志（扁平一套，替代 pi 三套 Compat）
 * 消费方：OpenAICompatibleProvider / AnthropicCompatibleProvider 内部适配
 */
export interface ModelCompat {
  /** 支持 prompt cache（cache_control / 自动缓存统计）。默认按 Provider 内建行为 */
  supportsPromptCache?: boolean;
  /** 支持 thinking/reasoning effort 参数 */
  supportsThinkingEffort?: boolean;
  /** 支持工具调用 */
  supportsTools?: boolean;
  /** 支持视觉输入（image_url 内容块） */
  supportsImages?: boolean;
  /** toolCall ID 最大长度（Anthropic=64；归一化截断依据） */
  maxToolCallIdLength?: number;
  /** toolCall ID 合法字符集（正则源码字符串，如 '^[a-zA-Z0-9_-]+$'） */
  toolCallIdPattern?: string;
  /**
   * usage.promptTokens 与 cache token 的口径约定（calculateCost 依据）。
   * 为什么需要本字段：OpenAI/DeepSeek 风格 prompt_tokens 含 cache 命中部分（inclusive），
   * Anthropic 风格 input_tokens 不含 cache（exclusive）——两种口径下同一公式不可能同时正确，
   * 不区分口径的成本计算等于编造数据。
   * 缺省按 'inclusive'（OpenAI 系多数派）。
   */
  promptCacheConvention?: 'inclusive' | 'exclusive';
}

/** 模型元数据（静态表条目 + DB extraConfig 覆盖后的合并结果） */
export interface ModelMetadata {
  /** 模型 ID（如 'deepseek-chat'、'claude-sonnet-4-5'） */
  id: string;
  /** 所属 Provider 类型（如 'deepseek'、'anthropic'） */
  provider: string;
  /** 显示名（前端展示） */
  name?: string;
  /** 上下文窗口（tokens）。MemoryController 压缩预算依据 */
  contextWindow?: number;
  /** 单次最大输出 tokens */
  maxOutputTokens?: number;
  /** 成本（未知模型为 undefined，禁止编造 0） */
  cost?: ModelCost;
  /** 兼容标志 */
  compat?: ModelCompat;
}

/** token 用量（calculateCost 输入，与 LLMStreamUsage 子集对齐） */
export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

/** 成本计算结果（USD） */
export interface ModelCostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

/** Anthropic 系公共 compat（exclusive 口径 + toolCall ID 约束 + prompt cache） */
const ANTHROPIC_COMPAT: ModelCompat = {
  supportsPromptCache: true,
  supportsThinkingEffort: true,
  supportsTools: true,
  supportsImages: true,
  maxToolCallIdLength: 64,
  toolCallIdPattern: '^[a-zA-Z0-9_-]+$',
  promptCacheConvention: 'exclusive',
};

const OPENAI_COMPAT: ModelCompat = {
  supportsPromptCache: true,
  supportsTools: true,
  supportsImages: true,
  promptCacheConvention: 'inclusive',
};

/**
 * 静态元数据表（手工维护已知模型；未知模型不在表中）。
 * 仅收录确认值的字段：价格/上下文不确定的字段一律省略而非编造（R5 快照性质，
 * 管理员可经 model_providers.extraConfig.metadata 热修正）。成本单位 USD/百万 tokens。
 */
const BUILTIN_MODEL_METADATA: ReadonlyArray<ModelMetadata> = [
  // ---- deepseek（inclusive 口径：prompt_cache_hit+miss = prompt_tokens）----
  { id: 'deepseek-chat', provider: 'deepseek', name: 'DeepSeek Chat', contextWindow: 65536, maxOutputTokens: 8192, cost: { input: 0.27, output: 1.1, cacheRead: 0.07 }, compat: { supportsPromptCache: true, supportsTools: true, promptCacheConvention: 'inclusive' } },
  { id: 'deepseek-reasoner', provider: 'deepseek', name: 'DeepSeek Reasoner', contextWindow: 65536, maxOutputTokens: 8192, cost: { input: 0.55, output: 2.19, cacheRead: 0.14 }, compat: { supportsPromptCache: true, supportsThinkingEffort: true, supportsTools: true, promptCacheConvention: 'inclusive' } },

  // ---- anthropic（exclusive 口径：input_tokens 不含 cache）----
  { id: 'claude-sonnet-4-5', provider: 'anthropic', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxOutputTokens: 64000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, compat: ANTHROPIC_COMPAT },
  { id: 'claude-opus-4-1', provider: 'anthropic', name: 'Claude Opus 4.1', contextWindow: 200000, maxOutputTokens: 32000, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, compat: ANTHROPIC_COMPAT },
  { id: 'claude-haiku-4-5', provider: 'anthropic', name: 'Claude Haiku 4.5', contextWindow: 200000, maxOutputTokens: 64000, cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, compat: ANTHROPIC_COMPAT },
  { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', name: 'Claude 3.5 Sonnet', contextWindow: 200000, maxOutputTokens: 8192, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, compat: ANTHROPIC_COMPAT },
  { id: 'claude-3-5-haiku-20241022', provider: 'anthropic', name: 'Claude 3.5 Haiku', contextWindow: 200000, maxOutputTokens: 8192, cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 }, compat: ANTHROPIC_COMPAT },

  // ---- openai（inclusive 口径；cached_tokens 按 cacheRead 价）----
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, cost: { input: 2.5, output: 10, cacheRead: 1.25 }, compat: OPENAI_COMPAT },
  { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o mini', contextWindow: 128000, maxOutputTokens: 16384, cost: { input: 0.15, output: 0.6, cacheRead: 0.075 }, compat: OPENAI_COMPAT },
  { id: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1', contextWindow: 1047576, maxOutputTokens: 32768, cost: { input: 2, output: 8, cacheRead: 0.5 }, compat: OPENAI_COMPAT },
  { id: 'gpt-4.1-mini', provider: 'openai', name: 'GPT-4.1 mini', contextWindow: 1047576, maxOutputTokens: 32768, cost: { input: 0.4, output: 1.6, cacheRead: 0.1 }, compat: OPENAI_COMPAT },
  { id: 'gpt-4.1-nano', provider: 'openai', name: 'GPT-4.1 nano', contextWindow: 1047576, maxOutputTokens: 32768, cost: { input: 0.1, output: 0.4, cacheRead: 0.025 }, compat: OPENAI_COMPAT },
  { id: 'o4-mini', provider: 'openai', name: 'o4-mini', contextWindow: 200000, maxOutputTokens: 100000, cost: { input: 1.1, output: 4.4, cacheRead: 0.275 }, compat: { ...OPENAI_COMPAT, supportsThinkingEffort: true } },
  { id: 'o3', provider: 'openai', name: 'o3', contextWindow: 200000, maxOutputTokens: 100000, compat: { ...OPENAI_COMPAT, supportsThinkingEffort: true } },

  // ---- gemini ----
  { id: 'gemini-2.5-pro', provider: 'gemini', name: 'Gemini 2.5 Pro', contextWindow: 1048576, maxOutputTokens: 65536, cost: { input: 1.25, output: 10 }, compat: { supportsThinkingEffort: true, supportsTools: true, supportsImages: true } },
  { id: 'gemini-2.5-flash', provider: 'gemini', name: 'Gemini 2.5 Flash', contextWindow: 1048576, maxOutputTokens: 65536, cost: { input: 0.3, output: 2.5 }, compat: { supportsThinkingEffort: true, supportsTools: true, supportsImages: true } },
  { id: 'gemini-2.0-flash', provider: 'gemini', name: 'Gemini 2.0 Flash', contextWindow: 1048576, maxOutputTokens: 8192, cost: { input: 0.1, output: 0.4 }, compat: { supportsTools: true, supportsImages: true } },
  { id: 'gemini-2.0-flash-lite', provider: 'gemini', name: 'Gemini 2.0 Flash Lite', contextWindow: 1048576, maxOutputTokens: 8192, cost: { input: 0.075, output: 0.3 }, compat: { supportsTools: true, supportsImages: true } },

  // ---- glm（人民币计价，不编造 USD 成本；仅上下文窗口）----
  { id: 'glm-4-plus', provider: 'glm', name: 'GLM-4 Plus', contextWindow: 128000, compat: { supportsTools: true } },
  { id: 'glm-4-flash', provider: 'glm', name: 'GLM-4 Flash', contextWindow: 128000, compat: { supportsTools: true } },
  { id: 'glm-4.5', provider: 'glm', name: 'GLM-4.5', contextWindow: 128000, compat: { supportsThinkingEffort: true, supportsTools: true } },

  // ---- kimi ----
  { id: 'moonshot-v1-8k', provider: 'kimi', name: 'Moonshot v1 8K', contextWindow: 8192, compat: { supportsTools: true } },
  { id: 'moonshot-v1-32k', provider: 'kimi', name: 'Moonshot v1 32K', contextWindow: 32768, compat: { supportsTools: true } },
  { id: 'moonshot-v1-128k', provider: 'kimi', name: 'Moonshot v1 128K', contextWindow: 131072, compat: { supportsTools: true } },
  { id: 'kimi-k2-0711-preview', provider: 'kimi', name: 'Kimi K2', contextWindow: 131072, compat: { supportsTools: true } },

  // ---- qwen ----
  { id: 'qwen-plus', provider: 'qwen', name: 'Qwen Plus', contextWindow: 131072, compat: { supportsTools: true } },
  { id: 'qwen-turbo', provider: 'qwen', name: 'Qwen Turbo', contextWindow: 1000000, compat: { supportsTools: true } },

  // ---- ernie（上下文窗口依型号命名）----
  { id: 'ernie-4.0-8k', provider: 'ernie', name: 'ERNIE 4.0 8K', contextWindow: 8192, compat: { supportsTools: true } },
  { id: 'ernie-speed-128k', provider: 'ernie', name: 'ERNIE Speed 128K', contextWindow: 131072, compat: { supportsTools: true } },

  // ---- siliconflow（聚合平台，按上游模型 ID）----
  { id: 'deepseek-ai/DeepSeek-V3', provider: 'siliconflow', name: 'DeepSeek V3 (SiliconFlow)', contextWindow: 65536, compat: { supportsTools: true } },
  { id: 'Qwen/Qwen2.5-72B-Instruct', provider: 'siliconflow', name: 'Qwen2.5 72B (SiliconFlow)', contextWindow: 131072, compat: { supportsTools: true } },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * sanitizeOverride 的返回类型：cost 为部分字段（仅管理员显式提供的键），
 * 避免未提供的 input/output 被默认值污染静态表回落（字段级合并语义）。
 */
type SanitizedOverride = Partial<Omit<ModelMetadata, 'cost'>> & { cost?: Partial<ModelCost> };

/**
 * dbOverride 字段校验：非法值（非正数的窗口、负数价格等）忽略该字段并 warn，
 * 不抛错——管理员配置错误不应打断 LLM 调用主流程，但必须留下可观测日志。
 */
function sanitizeOverride(
  provider: string,
  modelId: string,
  override: Partial<ModelMetadata>,
): SanitizedOverride {
  const warn = (field: string, value: unknown): void => {
    // 延迟获取 logger（而非模块级常量）：测试可在 import 后注册工厂捕获 warn
    createChildLogger('model-metadata').warn('Ignoring invalid dbOverride field', {
      provider, modelId, field, value: String(value),
    });
  };

  const result: SanitizedOverride = {};

  if (override.name !== undefined) {
    if (typeof override.name === 'string' && override.name.length > 0) result.name = override.name;
    else warn('name', override.name);
  }
  if (override.contextWindow !== undefined) {
    if (Number.isFinite(override.contextWindow) && override.contextWindow > 0) result.contextWindow = override.contextWindow;
    else warn('contextWindow', override.contextWindow);
  }
  if (override.maxOutputTokens !== undefined) {
    if (Number.isFinite(override.maxOutputTokens) && override.maxOutputTokens > 0) result.maxOutputTokens = override.maxOutputTokens;
    else warn('maxOutputTokens', override.maxOutputTokens);
  }
  if (override.cost !== undefined) {
    if (isPlainObject(override.cost)) {
      const cost: Partial<ModelCost> = {};
      let hasAny = false;
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
        const value = override.cost[key];
        if (value === undefined) continue;
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          cost[key] = value;
          hasAny = true;
        } else {
          warn(`cost.${key}`, value);
        }
      }
      if (hasAny) result.cost = cost;
    } else {
      warn('cost', override.cost);
    }
  }
  if (override.compat !== undefined) {
    if (isPlainObject(override.compat)) result.compat = { ...override.compat };
    else warn('compat', override.compat);
  }

  return result;
}

/** 仅查静态表（不含 DB 覆盖） */
export function getBuiltinModelMetadata(provider: string, modelId: string): ModelMetadata | undefined {
  return BUILTIN_MODEL_METADATA.find(m => m.provider === provider && m.id === modelId);
}

/** 列出静态表全部条目（前端 model-config UI 展示用） */
export function listBuiltinModelMetadata(): ReadonlyArray<ModelMetadata> {
  return BUILTIN_MODEL_METADATA;
}

/**
 * 成本字段级合并：input/output 任一缺失则不产出 cost（不完整成本等于编造，宁缺毋滥）。
 */
function mergeCost(base: ModelCost | undefined, override: Partial<ModelCost> | undefined): ModelCost | undefined {
  if (!base && !override) return undefined;
  const input = override?.input ?? base?.input;
  const output = override?.output ?? base?.output;
  if (input === undefined || output === undefined) return undefined;
  return {
    input,
    output,
    cacheRead: override?.cacheRead ?? base?.cacheRead,
    cacheWrite: override?.cacheWrite ?? base?.cacheWrite,
  };
}

/**
 * 解析模型元数据（优先级：DB override > 静态表 > undefined）
 * @param dbOverride model_providers.extraConfig.metadata（E 层解析后传入，H 层不碰 DB）
 */
export function resolveModelMetadata(
  provider: string,
  modelId: string,
  dbOverride?: Partial<ModelMetadata>,
): ModelMetadata | undefined {
  const base = getBuiltinModelMetadata(provider, modelId);
  if (!dbOverride) return base;

  const valid = sanitizeOverride(provider, modelId, dbOverride);
  if (!base) {
    // 未知模型 + 有覆盖：以覆盖字段构造（覆盖本身即管理员显式声明，非编造）
    const metadata: ModelMetadata = { id: modelId, provider, ...valid, cost: mergeCost(undefined, valid.cost) };
    return metadata;
  }

  return {
    ...base,
    ...valid,
    // cost/compat 为嵌套对象：字段级合并而非整体替换，保证部分覆盖时其余字段回落静态表
    cost: mergeCost(base.cost, valid.cost),
    compat: base.compat || valid.compat ? { ...base.compat, ...valid.compat } : undefined,
  };
}

/**
 * 计算成本（USD）。cost 元数据缺失返回 undefined（禁止返回 0 掩盖未知）。
 * 消费方：LLMMetricsSink 落库时附带；前端成本报表。
 *
 * 口径（见 ModelCompat.promptCacheConvention）：
 * - inclusive（OpenAI/DeepSeek）：promptTokens 含 cache 命中，计费输入 = promptTokens - hit
 * - exclusive（Anthropic）：promptTokens 不含 cache，计费输入 = promptTokens
 * cacheRead/cacheWrite 单价缺失时该项按 0 计（§6.8）。
 */
export function calculateCost(metadata: ModelMetadata, usage: ModelUsage): ModelCostBreakdown | undefined {
  const cost = metadata.cost;
  if (!cost) return undefined;

  const hit = usage.promptCacheHitTokens ?? 0;
  const miss = usage.promptCacheMissTokens ?? 0;
  const inclusive = metadata.compat?.promptCacheConvention !== 'exclusive';
  const billedInputTokens = inclusive ? Math.max(0, usage.promptTokens - hit) : usage.promptTokens;

  const inputCost = (billedInputTokens / 1_000_000) * cost.input;
  const outputCost = (usage.completionTokens / 1_000_000) * cost.output;
  const cacheReadCost = (hit / 1_000_000) * (cost.cacheRead ?? 0);
  const cacheWriteCost = (miss / 1_000_000) * (cost.cacheWrite ?? 0);

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}
