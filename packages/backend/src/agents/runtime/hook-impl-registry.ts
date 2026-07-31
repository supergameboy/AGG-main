/**
 * HookImplRegistry —— hook 实现的代码侧注册表（M4 子任务B「默认行为平权」）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M4-4维度Hook.md §9.1
 *
 * 职责边界（§9.1）：
 * - 配置（hook-placement.yaml，后续子任务）只引用 impl_id，不持有代码——YAML 无法表达函数
 * - 代码侧实现在此注册一次（一个概念只表达一次）
 * - 工厂模式：部分 hook 需要 per-AgentRuntime 依赖（audit-on-task-complete 需要
 *   auditAgent/auditContextBuilder/auditedKeys），工厂在组合根装配时闭包捕获
 *
 * 分层约束：本文件位于 runtime/（G 层），对 services/ 与 game-systems/ 仅 type import
 * （编译时擦除，零运行时依赖），实现工厂全部来自同层模块。
 */
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import type { IAuditAgent } from '../../game-systems/audit/ProgramChecker.js';
import type { AuditContextBuilder } from './audit-hook.js';
import { createOnTaskCompleteHook } from './audit-hook.js';
import {
  createArgNormalizerHook,
  createFailRecoverySeedHook,
  createProgressBroadcasterHook,
  createReadonlyGuardHook,
} from './default-agent-hooks.js';
import { createResultNormalizerHook } from './result-normalizer.js';
import type { HookEventName, TypedAgentHook } from './types.js';

/**
 * hook 实现工厂：deps 闭包捕获 → 类型化 hook 实例。
 * 返回类型用 HookEventName 擦除形态承载（注册表同质存储的需要）；
 * 具体工厂的 patch 类型经结构协变安全赋值。
 */
export type HookImplFactory = (deps: HookImplDeps) => TypedAgentHook<HookEventName>;

export interface HookImplDeps {
  webSocketService: IWebSocketBroadcaster;
  /** audit-on-task-complete 专用（audit-hook.ts 现有依赖签名不变） */
  auditAgent?: IAuditAgent;
  auditContextBuilder?: AuditContextBuilder;
  auditedKeys?: Set<string>;
}

export interface IHookImplRegistry {
  register(id: string, factory: HookImplFactory): void;
  /** 未找到返回 undefined（由 resolver 决定降级，§13 失败场景表） */
  get(id: string): HookImplFactory | undefined;
  has(id: string): boolean;
  listIds(): string[];
}

export class HookImplRegistry implements IHookImplRegistry {
  private readonly factories = new Map<string, HookImplFactory>();

  register(id: string, factory: HookImplFactory): void {
    this.factories.set(id, factory);
  }

  get(id: string): HookImplFactory | undefined {
    return this.factories.get(id);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  listIds(): string[] {
    return [...this.factories.keys()];
  }
}

/**
 * 注册 6 个内建实现（§9.1 内建实现注册表，行为等价搬迁 + result-normalizer 新增）。
 *
 * impl_id 命名即 hook-placement.yaml（后续子任务）的 hookRef 引用键：
 * readonly-guard / arg-normalizer / result-normalizer / fail-recovery-seed /
 * progress-broadcaster / audit-on-task-complete
 */
export function registerBuiltinHookImpls(registry: IHookImplRegistry): void {
  registry.register('readonly-guard', () => createReadonlyGuardHook());
  registry.register('arg-normalizer', () => createArgNormalizerHook());
  registry.register('result-normalizer', () => createResultNormalizerHook());
  registry.register('fail-recovery-seed', () => createFailRecoverySeedHook());
  registry.register('progress-broadcaster', (deps) =>
    createProgressBroadcasterHook({ webSocketService: deps.webSocketService }),
  );
  registry.register('audit-on-task-complete', (deps) => {
    // audit hook 的 3 个依赖缺一是装配缺陷——fail-fast 暴露（禁止 fallback 掩盖缺陷）
    if (!deps.auditAgent || !deps.auditContextBuilder || !deps.auditedKeys) {
      throw new Error(
        'audit-on-task-complete 缺少必需依赖（auditAgent/auditContextBuilder/auditedKeys）——组合根装配断裂',
      );
    }
    return createOnTaskCompleteHook({
      auditAgent: deps.auditAgent,
      auditContextBuilder: deps.auditContextBuilder,
      auditedKeys: deps.auditedKeys,
    });
  });
}

/**
 * 构建含全部内建实现的注册表（组合根装配入口，§9.2 init.ts 用法）。
 */
export function buildHookImplRegistry(): IHookImplRegistry {
  const registry = new HookImplRegistry();
  registerBuiltinHookImpls(registry);
  return registry;
}
