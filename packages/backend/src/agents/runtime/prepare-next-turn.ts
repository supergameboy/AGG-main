/**
 * prepareNextTurn —— 循环内动态切模型（M5）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M5-prepareNextTurn.md
 *
 * 职责：AgentLoopTurnUpdate / PrepareNextTurnContext / PrepareNextTurnHook 类型定义
 * + ModelSwitchGuard（模型抖动防护，总规划 §9.2 风险缓解落地）
 * + iteration-tier 内置策略 + createPrepareNextTurnHook 工厂
 * + IModelTierResolver 端口（G 层不直接依赖 H 层 ModelConfigService，init.ts 组合根适配）
 *
 * 挂载方式（D5.2）：ReActEngineContext 直接函数注入（pi 等价），不经 HookDispatcher 派发。
 * 架构约束：零 value import services/ 与 game-systems/；零 LLM 调用。
 */

import type { ID } from '../../../../shared/src/types/core.js';
import type { ToolResult } from '../../../../shared/src/types/agent.js';
import type {
  AgentConfig,
  IterationTierStrategyConfig,
  ModelSwitchGuardConfig,
} from '../../../../shared/src/types/agent-config.js';
import type { LLMMessageExtended, ChatOptions } from '@ai-rpg/ai';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('prepare-next-turn');

// ─── 类型定义（§7.1/§7.2） ───

/**
 * 服务层工具定义（ChatOptions.tools 元素形态，与 ReActEngineContext.apiTools 一致）。
 * 即 OpenAI wire 形态 `{type:'function', function:{name,description,parameters}}`，
 * 直接流入 chatRaw，引擎零转换。
 */
export type ApiToolDefinition = NonNullable<ChatOptions['tools']>[number];

/** 模型引用（具体值。tier 别名由策略层解析后填入，引擎零感知别名） */
export interface ModelRef {
  providerId?: string;
  model?: string;
}

/**
 * 思考级别（pi 6 级，D5.3 v1.2 拍板：严格 pi 划分，无 max）。
 * 直接映射 ChatOptions.reasoningEffort（packages/ai/src/types.ts）。
 * off = 真正 per-request 关闭思考（OpenAI→none；Anthropic→thinking disabled，
 * 历史消息含 thinking blocks 时 Provider 降级 low + warn，§2.1 映射表）。
 */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * 下一轮起生效的 turn 更新（总规划决策 4 方案 B 完整形态）。
 * 全部字段可选；缺省字段保持当前生效值（pi `??` 语义）。
 */
export interface AgentLoopTurnUpdate {
  /** 下一轮起生效的模型。经 ModelSwitchGuard 评估后应用 */
  model?: ModelRef;
  /** 下一轮起生效的思考级别 → chatRaw options.reasoningEffort */
  thinkingLevel?: ThinkingLevel;
  /**
   * 下一轮起生效的工具集（D5.4 v1.2 拍板：全量 apiTools 替换）。
   * 语义：整体替换 context.apiTools 发给 LLM；hook 可从 PrepareNextTurnContext.apiTools
   * 只读视图筛选/重排/改描述后构造返回。执行时白名单校验（context.allowedFunctionNames）
   * 是独立安全层，不受替换影响。
   */
  tools?: ApiToolDefinition[];
  /** 下一轮起替换 system 消息内容（messages[0]） */
  systemPromptOverride?: string;
}

export interface ModelSwitchStateSnapshot {
  readonly switchCount: number;
  readonly lastSwitchIteration: number | null;
}

/** hook 输入上下文（每轮构建，全部只读） */
export interface PrepareNextTurnContext {
  /** 即将开始的迭代序号（1-based）：第 N 次 LLM 调用前触发时 iteration = N */
  readonly iteration: number;
  readonly maxIterations: number;
  /** 当前循环消息（含以往轮次工具结果）。只读视图，禁止 mutate */
  readonly messages: readonly LLMMessageExtended[];
  /** 已执行的工具调用结果。只读视图 */
  readonly toolCalls: readonly ToolResult[];
  /** 累计 token 用量（截至上一轮） */
  readonly cumulativeTokens: { input: number; output: number };
  /** 当前生效模型（首轮 = baseline；其后 = 上次 update 应用后的值） */
  readonly currentModel: ModelRef;
  /** baseline 模型（before_model_select 解析结果，loop 开始时的 context 值） */
  readonly baselineModel: ModelRef;
  /** guard 状态快照（供策略决策参考，如"已切换过就不再切"） */
  readonly switchState: ModelSwitchStateSnapshot;
  readonly agentKey: string;
  readonly currentSaveId: ID;
  /**
   * 当前生效工具集（首轮 = context.apiTools；其后 = 上次 update.tools 应用后的值）。
   * 只读视图（D5.4 v1.2：全量替换形态下 hook 据此筛选/重排/构造替换集）。
   */
  readonly apiTools: readonly ApiToolDefinition[];
}

/**
 * prepareNextTurn hook（pi 等价签名，D5.2 直接函数注入）。
 *
 * 契约（强制）：
 * - 返回 undefined = 下一轮保持当前生效配置；
 * - 抛错/reject 由引擎 catch 降级为 undefined（warn 日志），循环不中断；
 * - 必须轻量：每轮调用，禁止在 hook 内做重 I/O（tier 解析由策略层 memoize）。
 */
export type PrepareNextTurnHook = (
  context: PrepareNextTurnContext,
) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

// ─── IModelTierResolver 端口（§8.1） ───

/** 模型 tier 解析端口（init.ts 闭包捕获 ModelConfigService 实现） */
export interface IModelTierResolver {
  /** 解析 tier 为具体 ModelRef；fast 未配置时返回 null */
  resolve(tier: 'fast' | 'default'): Promise<ModelRef | null>;
}

// ─── ModelSwitchGuard（§8.2，总规划 §9.2 风险缓解落地） ───

export type GuardDecision = { allowed: true } | { allowed: false; reason: string };

const DEFAULT_GUARD: Required<ModelSwitchGuardConfig> = {
  maxSwitchesPerLoop: 2,
  cooldownIterations: 1,
  allowSwitchBack: true,
};

/**
 * 模型切换 guard。per-execute() 新建（D5.6），状态随 loop 生命周期结束。
 * 仅评估 model 字段；update 其余字段不经 guard。
 */
export class ModelSwitchGuard {
  private switchCount = 0;
  private lastSwitchIteration: number | null = null;
  private readonly config: Required<ModelSwitchGuardConfig>;

  constructor(config?: ModelSwitchGuardConfig) {
    this.config = { ...DEFAULT_GUARD, ...config };
  }

  /** 评估一次切换请求。target == current 为幂等（不计数放行）。 */
  evaluate(args: {
    target: ModelRef;
    current: ModelRef;
    baseline: ModelRef;
    iteration: number;
  }): GuardDecision {
    const { target, current, baseline, iteration } = args;
    if (sameModelRef(target, current)) return { allowed: true };
    if (this.switchCount >= this.config.maxSwitchesPerLoop) {
      return { allowed: false, reason: `maxSwitchesPerLoop(${this.config.maxSwitchesPerLoop}) exceeded` };
    }
    if (
      this.lastSwitchIteration !== null
      && iteration - this.lastSwitchIteration <= this.config.cooldownIterations
    ) {
      return { allowed: false, reason: `cooldownIterations(${this.config.cooldownIterations}) active` };
    }
    if (!this.config.allowSwitchBack && sameModelRef(target, baseline)) {
      return { allowed: false, reason: 'allowSwitchBack=false' };
    }
    return { allowed: true };
  }

  /** 切换应用后记录（引擎调用） */
  recordSwitch(iteration: number): void {
    this.switchCount += 1;
    this.lastSwitchIteration = iteration;
  }

  snapshot(): ModelSwitchStateSnapshot {
    return { switchCount: this.switchCount, lastSwitchIteration: this.lastSwitchIteration };
  }
}

export function sameModelRef(a: ModelRef, b: ModelRef): boolean {
  return a.providerId === b.providerId && a.model === b.model;
}

// ─── 内置策略：iteration-tier（§8.3） ───

/** 典型场景：前 N 轮 baseline（强模型），第 N+1 轮起切 fast tier */
export function createIterationTierHook(
  config: IterationTierStrategyConfig,
  resolver: IModelTierResolver,
): PrepareNextTurnHook {
  let memoFast: ModelRef | null | undefined; // undefined = 未解析（本 hook 实例 = 本请求）
  let warned = false;

  return async (ctx: PrepareNextTurnContext) => {
    if (ctx.iteration <= config.fastAfterIteration) return undefined;
    // 本 loop 已切换过 → 幂等短路，避免每轮重复返回同一目标
    if (ctx.switchState.switchCount > 0) return undefined;
    if (memoFast === undefined) {
      memoFast = await resolver.resolve('fast'); // memoize：本请求仅解析一次
    }
    if (!memoFast) {
      if (!warned) {
        logger.warn('iteration-tier: fast tier 未配置（fastProviderId 为空），策略 no-op', {
          agentKey: ctx.agentKey,
        });
        warned = true;
      }
      return undefined;
    }
    if (sameModelRef(ctx.currentModel, memoFast)) return undefined; // 已在 fast
    return { model: memoFast };
  };
}

// ─── 工厂（§8.5） ───

/**
 * prepareNextTurn hook 工厂。
 * init.ts 闭包捕获 IModelTierResolver；per-request 调用，返回本请求专用 hook 实例
 * （tier 解析 memoize 作用域 = 请求）。
 */
export function createPrepareNextTurnHook(
  agentConfig: AgentConfig,
  resolver: IModelTierResolver,
): PrepareNextTurnHook | undefined {
  const cfg = agentConfig.prepareNextTurn;
  if (!cfg?.enabled) return undefined;
  if (cfg.strategy === 'iteration-tier' && cfg.iterationTier) {
    return createIterationTierHook(cfg.iterationTier, resolver);
  }
  logger.warn('prepareNextTurn 未知策略或缺参数，不启用', {
    strategy: cfg.strategy,
  });
  return undefined;
}
