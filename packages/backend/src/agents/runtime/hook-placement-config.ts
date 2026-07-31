/**
 * hook-placement 配置契约与启动期校验（M4 子任务C「placement 配置 + 解析器」）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M4-4维度Hook.md §8.1/§11
 *
 * 职责边界：
 * - 本文件只定义配置类型 + V1-V8 校验（§11.2），不持有解析逻辑
 *   （4 维度匹配归 hook-placement-resolver.ts——配置契约与解析器分离，单一职责）
 * - 配置缺陷必须在启动期 fail-fast 暴露（§11.2 校验时机：组合根装配时），
 *   禁止运行期才发现拼错的 hookRef / 非法枚举值
 *
 * 分层约束：runtime/（G 层），对 services/ 与 game-systems/ 零 value import。
 */
import type { AgentType } from '../../../../shared/src/types/agent.js';
import { CORE_AGENT_HOOKS, type AgentHookName } from './agent-hooks.js';

/**
 * 请求路径维度三枚举（D4.5 / §23 Q-2 拍板A）。
 *
 * AGG 实测仅 3 条请求路径（sub_agent / game_master / pool_generation），
 * 枚举化使 V5 启动校验成为可能；自由字符串无法校验、确定性无从谈起。
 */
export const AGENT_REQUEST_PATHS = ['sub_agent', 'game_master', 'pool_generation'] as const;
export type AgentRequestPath = (typeof AGENT_REQUEST_PATHS)[number];

/**
 * 12 个 AgentType 的运行时清单（V4 校验用）。
 *
 * shared 仅导出 AgentType type（编译时擦除），此处是唯一的运行时枚举来源。
 * 编译期完备性断言保证与 AgentType 漂移时 tsc 立即报错——配置校验不可静默漏检新类型。
 */
export const AGENT_TYPES = [
  'gamemaster',
  'output',
  'challenge',
  'quest',
  'map',
  'npc_party',
  'inventory',
  'skill',
  'numerical',
  'event',
  'time',
  'game',
] as const satisfies ReadonlyArray<AgentType>;

type ExactUnion<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never;
const agentTypesExactCheck: ExactUnion<(typeof AGENT_TYPES)[number], AgentType> = true;
void agentTypesExactCheck;

/** 领域维度仅对工具调用 hook 有意义（V6，§11.2：domain 对其他 hook 无意义，防误配置） */
const DOMAIN_CAPABLE_HOOKS: ReadonlySet<AgentHookName> = new Set<AgentHookName>([
  'before_tool_call',
  'after_tool_call',
]);

/** 放置选择器（§11.1）：多维度条件为 AND，同维度多值为 OR，缺省维度 = 通配 */
export interface HookPlacementSelector {
  hook: AgentHookName;
  agentTypes?: AgentType[];
  paths?: AgentRequestPath[];
  domains?: string[];
}

export interface HookPlacementEntry {
  /** 配置内唯一 id（V1 启动期校验重复） */
  id: string;
  /** 引用 HookImplRegistry 的 hookImplId（V2 校验存在性，防幽灵引用） */
  hookRef: string;
  selector: HookPlacementSelector;
  /** 同秩内显式次序微调；缺省 = YAML 声明序（§8.4 同秩冲突规则） */
  order?: number;
  /** 缺省 true；false = 跳过（等效删除但保留配置痕迹，§11.1） */
  enabled?: boolean;
}

export interface HookPlacementConfig {
  version: 1;
  entries: HookPlacementEntry[];
}

/**
 * hookRef 存在性查询的最小结构契约。
 * Set<string> 与 IHookImplRegistry 均天然满足（均有 has 方法）——
 * 校验函数不依赖注册表具体类型，测试可直接传 Set。
 */
export interface HookRefLookup {
  has(id: string): boolean;
}

/**
 * 启动期校验（§11.2 V1-V8，fail-fast）。
 *
 * 任一规则违反即抛错，错误信息含 entry 定位（下标 + id）——
 * 配置文件可能数百行，无定位信息的错误等于没有错误。
 *
 * V7（纯 `{hook}` 选择器 = 通用维度，合法）是许可性规则，无需校验动作，
 * 在此显式注释以防评审误判遗漏。
 */
export function validateHookPlacementConfig(
  config: HookPlacementConfig,
  hookRefs: HookRefLookup,
): void {
  // V8：版本未知 → 拒绝（版本号是配置格式演进的唯一闸门）
  if (config.version !== 1) {
    throw new Error(
      `hook-placement 配置校验失败：不支持的 version=${String(config.version)}（当前仅支持 1）`,
    );
  }
  if (!Array.isArray(config.entries)) {
    throw new Error('hook-placement 配置校验失败：entries 缺失或不是数组');
  }

  const seenIds = new Set<string>();
  config.entries.forEach((entry, index) => {
    const at = `entries[${index}]${typeof entry.id === 'string' && entry.id ? ` (id: "${entry.id}")` : ''}`;
    const fail = (rule: string, detail: string): never => {
      throw new Error(`hook-placement 配置校验失败 [${rule}] ${at}：${detail}`);
    };

    // V1：id 全局唯一（重复 id 使诊断日志 matchedEntryIds 失去意义）
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      fail('V1', '缺少 id 或 id 为空');
    }
    if (seenIds.has(entry.id)) {
      fail('V1', `id "${entry.id}" 重复`);
    }
    seenIds.add(entry.id);

    // V2：hookRef 必须存在于 HookImplRegistry（防配置引用幽灵实现）
    if (!hookRefs.has(entry.hookRef)) {
      fail('V2', `hookRef "${entry.hookRef}" 未在 HookImplRegistry 注册`);
    }

    const selector = entry.selector;
    if (selector === undefined || selector === null) {
      fail('V3', '缺少 selector');
    }

    // V3：selector.hook 必须是合法 AgentHookName
    if (!(CORE_AGENT_HOOKS as ReadonlyArray<string>).includes(selector.hook)) {
      fail('V3', `selector.hook "${String(selector.hook)}" 不是合法 AgentHookName`);
    }

    // V4：agentTypes 值必须在 AgentType 枚举内
    for (const agentType of selector.agentTypes ?? []) {
      if (!(AGENT_TYPES as ReadonlyArray<string>).includes(agentType)) {
        fail('V4', `selector.agentTypes 含非法值 "${String(agentType)}"`);
      }
    }

    // V5：paths 值必须在 AgentRequestPath 枚举内
    for (const path of selector.paths ?? []) {
      if (!(AGENT_REQUEST_PATHS as ReadonlyArray<string>).includes(path)) {
        fail(
          'V5',
          `selector.paths 含非法值 "${String(path)}"（合法值：${AGENT_REQUEST_PATHS.join(' / ')}）`,
        );
      }
    }

    // V6：domains 仅允许出现在工具调用 hook 的 entry（domain 对其他 hook 无意义）
    if (selector.domains !== undefined && selector.domains.length > 0) {
      if (!DOMAIN_CAPABLE_HOOKS.has(selector.hook)) {
        fail('V6', `domains 仅允许用于 before_tool_call / after_tool_call，当前 hook="${selector.hook}"`);
      }
    }
  });
}
