/**
 * HookPlacementResolver —— 4 维度 hook 放置解析（M4 子任务C「placement 配置 + 解析器」）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M4-4维度Hook.md §8/§12/§13
 *
 * 职责：
 * - 加载期（构造/reload）将 entries 预计算为 4 个维度桶并预排序（§12.1）——
 *   解析路径零排序零正则，每请求 10-30 次派发的匹配开销可忽略（G7）
 * - resolvePlacement = 4 次 Map 查找 + AND 过滤 + 拼接（§12.2）+ LRU 缓存
 * - 异常降级（D4.7）：任何内部异常自行 catch → 默认链 + degraded:true，绝不抛出
 *
 * 确定性论证（§8.4）：秩是静态常量、声明序是配置静态顺序、AND/OR 匹配是纯函数，
 * 同一配置 + 同一 placement 上下文必得唯一链序（构建期显式排序，Map 迭代序不参与）。
 *
 * 分层约束：runtime/（G 层），对 services/ 与 game-systems/ 零 value import。
 */
import type { AgentType } from '../../../../shared/src/types/agent.js';
import { createChildLogger } from '../../utils/logger.js';
import { createDefaultAgentHooks, type DefaultAgentHookEntry } from './default-agent-hooks.js';
import type { HookImplDeps, HookImplFactory, IHookImplRegistry } from './hook-impl-registry.js';
import type {
  AgentRequestPath,
  HookPlacementEntry,
  HookPlacementSelector,
} from './hook-placement-config.js';
import type {
  HookEventName,
  HookPlacementContext,
  IHookPlacementResolver,
  ResolvedHookChain,
  TypedAgentHook,
} from './types.js';

const logger = createChildLogger('hook-placement-resolver');

/** LRU 默认容量（§12.2：首版带缓存，成本极低，基准测试 B1/B2 验证其必要性） */
const DEFAULT_CACHE_CAPACITY = 256;

/**
 * 维度特异性固定秩（D4.3 / §23 Q-3 拍板A）：
 * 通用(0) < Agent类型(1) < 路径(2) < 领域(3)。
 * 组合维度 entry 的秩 = 其最高维度秩（§8.4）。
 */
type DimensionRank = 0 | 1 | 2 | 3;

const RANK_AGENT_TYPE: DimensionRank = 1;
const RANK_PATH: DimensionRank = 2;
const RANK_DOMAIN: DimensionRank = 3;

/**
 * 预计算后的 entry（§12.1 ResolvedEntry）。
 * selector 保留用于解析期 AND 复核：桶只按 entry 的最高维度索引，
 * 组合维度 entry 的其余条件必须在命中后重新校验。
 */
interface ResolvedEntry {
  entryId: string;
  factory: HookImplFactory;
  rank: DimensionRank;
  declarationIndex: number;
  order?: number;
  selector: HookPlacementSelector;
}

/** 4 个维度桶（§12.1）：通用桶仅按 hookName 索引，其余按 hookName + 维度值二级索引 */
interface PlacementIndex {
  generic: Map<HookEventName, ResolvedEntry[]>;
  byAgentType: Map<HookEventName, Map<AgentType, ResolvedEntry[]>>;
  byPath: Map<HookEventName, Map<AgentRequestPath, ResolvedEntry[]>>;
  byDomain: Map<HookEventName, Map<string, ResolvedEntry[]>>;
}

export interface HookPlacementResolverDeps {
  entries: ReadonlyArray<HookPlacementEntry>;
  implRegistry: IHookImplRegistry;
  implDeps: HookImplDeps;
  /**
   * LRU 容量（缺省 256，§12.2）。
   * 0 = 关闭缓存——性能基准 B2 需要测量无缓存路径以验证缓存必要性。
   */
  cacheCapacity?: number;
}

/** 组合维度秩 = 最高维度秩（§8.4）；无任何限定条件 = 通用秩 0 */
function computeEntryRank(selector: HookPlacementSelector): DimensionRank {
  if (selector.domains !== undefined && selector.domains.length > 0) {
    return RANK_DOMAIN;
  }
  if (selector.paths !== undefined && selector.paths.length > 0) {
    return RANK_PATH;
  }
  if (selector.agentTypes !== undefined && selector.agentTypes.length > 0) {
    return RANK_AGENT_TYPE;
  }
  return 0;
}

/**
 * AND 复核（§8.2 selector 语义：多维度 AND、同维度多值 OR、缺省维度通配）。
 * 桶查找已保证 entry 最高维度命中，此处复核其余维度条件；
 * context.domain 缺失时任何 domains 约束均不命中（§13 domain 解析 Edge path）。
 */
function matchesSelector(selector: HookPlacementSelector, context: HookPlacementContext): boolean {
  if (selector.agentTypes !== undefined && !selector.agentTypes.includes(context.agentType)) {
    return false;
  }
  if (selector.paths !== undefined && !selector.paths.includes(context.path)) {
    return false;
  }
  if (selector.domains !== undefined) {
    if (context.domain === undefined || !selector.domains.includes(context.domain)) {
      return false;
    }
  }
  return true;
}

/**
 * 同桶预排序比较器（§12.1：按 order ?? declarationIndex 排序，声明序兜底）。
 * 桶内秩一致，故无需比较 rank；declarationIndex 决胜保证相等键下顺序确定。
 */
function compareEntries(a: ResolvedEntry, b: ResolvedEntry): number {
  const byOrder = (a.order ?? a.declarationIndex) - (b.order ?? b.declarationIndex);
  return byOrder !== 0 ? byOrder : a.declarationIndex - b.declarationIndex;
}

function pushToNestedBucket<K>(
  outer: Map<HookEventName, Map<K, ResolvedEntry[]>>,
  hook: HookEventName,
  key: K,
  entry: ResolvedEntry,
): void {
  let inner = outer.get(hook);
  if (inner === undefined) {
    inner = new Map<K, ResolvedEntry[]>();
    outer.set(hook, inner);
  }
  const list = inner.get(key);
  if (list !== undefined) {
    list.push(entry);
  } else {
    inner.set(key, [entry]);
  }
}

/**
 * 构建 4 维度预计算索引（§12.1）。
 *
 * 每个 entry 只进入其最高维度的桶（组合维度的其余条件留给解析期 AND 复核），
 * 桶内按 (order ?? declarationIndex) 预排序——解析期 4 桶按秩拼接即全局有序，零排序。
 *
 * hookRef 未注册时跳过该 entry + warn（§13：V2 已在启动期拦截，此为热重载竞态兜底）。
 */
function buildIndex(
  entries: ReadonlyArray<HookPlacementEntry>,
  implRegistry: IHookImplRegistry,
): PlacementIndex {
  const index: PlacementIndex = {
    generic: new Map(),
    byAgentType: new Map(),
    byPath: new Map(),
    byDomain: new Map(),
  };

  entries.forEach((entry, declarationIndex) => {
    if (entry.enabled === false) {
      return;
    }
    const factory = implRegistry.get(entry.hookRef);
    if (factory === undefined) {
      logger.warn('hook placement entry skipped: hookRef not registered', {
        entryId: entry.id,
        hookRef: entry.hookRef,
      });
      return;
    }

    const resolved: ResolvedEntry = {
      entryId: entry.id,
      factory,
      rank: computeEntryRank(entry.selector),
      declarationIndex,
      order: entry.order,
      selector: entry.selector,
    };
    const hook = entry.selector.hook;

    switch (resolved.rank) {
      case RANK_DOMAIN:
        for (const domain of entry.selector.domains ?? []) {
          pushToNestedBucket(index.byDomain, hook, domain, resolved);
        }
        break;
      case RANK_PATH:
        for (const path of entry.selector.paths ?? []) {
          pushToNestedBucket(index.byPath, hook, path, resolved);
        }
        break;
      case RANK_AGENT_TYPE:
        for (const agentType of entry.selector.agentTypes ?? []) {
          pushToNestedBucket(index.byAgentType, hook, agentType, resolved);
        }
        break;
      default: {
        const list = index.generic.get(hook);
        if (list !== undefined) {
          list.push(resolved);
        } else {
          index.generic.set(hook, [resolved]);
        }
      }
    }
  });

  for (const list of index.generic.values()) {
    list.sort(compareEntries);
  }
  for (const outer of [index.byAgentType, index.byPath, index.byDomain] as const) {
    for (const inner of outer.values()) {
      for (const list of inner.values()) {
        list.sort(compareEntries);
      }
    }
  }
  return index;
}

/**
 * 4 维度桶查找 + 按秩拼接（§12.2：4 次 Map.get + 数组拼接，零排序）。
 * 拼接序 = 秩升序（通用→Agent类型→路径→领域），桶内已预排序，
 * 故结果即全局执行序（特异性升序，D4.4）。
 */
function collectCandidates(
  index: PlacementIndex,
  name: HookEventName,
  context: HookPlacementContext,
): ResolvedEntry[] {
  const domainBucket = context.domain === undefined
    ? undefined
    : index.byDomain.get(name)?.get(context.domain);
  return [
    ...(index.generic.get(name) ?? []),
    ...(index.byAgentType.get(name)?.get(context.agentType) ?? []),
    ...(index.byPath.get(name)?.get(context.path) ?? []),
    ...(domainBucket ?? []),
  ];
}

function buildCacheKey(name: HookEventName, context: HookPlacementContext): string {
  return `${name}|${context.agentType}|${context.path}|${context.domain ?? ''}`;
}

export class HookPlacementResolver implements IHookPlacementResolver {
  /**
   * 索引不可用时为 null（构建失败 = 降级模式）——
   * 索引不可用 ≠ 服务不可用：降级默认链保住 readonly 防护等关键默认 hook（D4.7）。
   */
  private index: PlacementIndex | null = null;
  private readonly cache = new Map<string, ResolvedHookChain>();
  private readonly cacheCapacity: number;
  private readonly fallbackHooks: ReadonlyArray<DefaultAgentHookEntry>;

  constructor(private readonly deps: HookPlacementResolverDeps) {
    this.cacheCapacity = deps.cacheCapacity ?? DEFAULT_CACHE_CAPACITY;
    // 降级链取自 createDefaultAgentHooks 的直接工厂，不经过 implRegistry——
    // 即使注册表整体损坏（§13 Failure path），降级链依然可构造
    this.fallbackHooks = createDefaultAgentHooks({
      webSocketService: deps.implDeps.webSocketService,
    });
    this.buildIndexSafely(deps.entries);
  }

  /** 配置热重载（§11.3）：重建索引 + 清空缓存；索引原子替换（不可变数据整体换指针） */
  reload(entries: ReadonlyArray<HookPlacementEntry>): void {
    this.cache.clear();
    this.buildIndexSafely(entries);
  }

  /**
   * 构建索引并原子替换（成功才换指针，失败保留旧索引/置 null）。
   * implRegistry.get 抛异常（P14 场景）时进入降级模式：index=null，
   * 此后所有 resolvePlacement 走默认链 + degraded:true。
   */
  private buildIndexSafely(entries: ReadonlyArray<HookPlacementEntry>): void {
    try {
      this.index = buildIndex(entries, this.deps.implRegistry);
    } catch (error) {
      this.index = null;
      this.cache.clear();
      logger.error('hook placement index build failed, falling back to default chain', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  resolvePlacement<N extends HookEventName>(
    name: N,
    context: HookPlacementContext,
  ): ResolvedHookChain<N> {
    // D4.7：本方法任何异常不得抛出到 HookDispatcher 之外——自行 catch 降级默认链
    try {
      const index = this.index;
      if (index === null) {
        return this.degradedChain(name) as ResolvedHookChain<N>;
      }

      const cacheKey = buildCacheKey(name, context);
      if (this.cacheCapacity > 0) {
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
          // LRU 触碰：重插到 Map 尾部维持"最近使用"序（Map 迭代序 = 插入序）
          this.cache.delete(cacheKey);
          this.cache.set(cacheKey, cached);
          // 窄化方向 cast：缓存以 HookEventName 擦除形态存储（注册表同质存储的需要），
          // 缓存键含 hookName、entry 的 selector.hook 经 V3 校验，
          // 运行时保证链上 hook 的 patch 形态与 N 一致
          return cached as ResolvedHookChain<N>;
        }
      }

      const resolved = this.resolveUncached(index, name, context);
      if (this.cacheCapacity > 0) {
        if (this.cache.size >= this.cacheCapacity) {
          const oldest = this.cache.keys().next();
          if (!oldest.done) {
            this.cache.delete(oldest.value);
          }
        }
        this.cache.set(cacheKey, resolved);
      }
      return resolved as ResolvedHookChain<N>;
    } catch (error) {
      logger.error('resolvePlacement failed, falling back to default chain', {
        hookName: name,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.degradedChain(name) as ResolvedHookChain<N>;
    }
  }

  /**
   * 桶查找 + AND 复核 + 工厂物化。
   * 单 entry 工厂抛异常时跳过该 entry + error 日志，其余 entry 正常
   * （§13：hook 构造期缺陷不拖垮整条链）。
   */
  private resolveUncached(
    index: PlacementIndex,
    name: HookEventName,
    context: HookPlacementContext,
  ): ResolvedHookChain {
    const hooks: TypedAgentHook<HookEventName>[] = [];
    const matchedEntryIds: string[] = [];

    for (const entry of collectCandidates(index, name, context)) {
      if (!matchesSelector(entry.selector, context)) {
        continue;
      }
      let hook: TypedAgentHook<HookEventName>;
      try {
        hook = entry.factory(this.deps.implDeps);
      } catch (error) {
        logger.error('hook impl factory threw, entry skipped', {
          entryId: entry.entryId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      hooks.push(hook);
      matchedEntryIds.push(entry.entryId);
    }
    return { hooks, matchedEntryIds, degraded: false };
  }

  /**
   * 降级链（D4.7）：默认 hook 链中属于 name 的部分。
   * matchedEntryIds 为空——降级链不来自配置 entry，诊断时不应伪造命中记录。
   */
  private degradedChain(name: HookEventName): ResolvedHookChain {
    const hooks: TypedAgentHook<HookEventName>[] = [];
    for (const entry of this.fallbackHooks) {
      if (entry.name === name) {
        // 注册表/工厂是同质擦除存储；此处恢复泛型形态的安全性由调用点保证：
        // 降级链与 name 的对应关系即 createDefaultAgentHooks 的声明形态
        hooks.push(entry.hook as TypedAgentHook<HookEventName>);
      }
    }
    return { hooks, matchedEntryIds: [], degraded: true };
  }
}

/** 组合根装配入口（§9.2 init.ts 用法）：构造即完成索引预计算 */
export function buildHookPlacementResolver(deps: HookPlacementResolverDeps): IHookPlacementResolver {
  return new HookPlacementResolver(deps);
}
