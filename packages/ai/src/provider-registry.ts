/**
 * ProviderRegistry — Provider 注册中心
 *
 * 替代 providerFactory 的硬编码 switch，支持：
 * - 动态注册 Provider（M2 模块 OAuth/bedrock 扩展、第三方 Plugin Provider）
 * - 来源标识（builtin / plugin:xxx / oauth:xxx）
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M1 §6.3
 */

import type { LLMConfig, LLMClient } from './types.js';

/**
 * Provider 工厂函数
 */
export type ProviderFactoryFn = (config: LLMConfig) => LLMClient;

/**
 * Provider 注册信息
 */
interface ProviderRegistration {
  factory: ProviderFactoryFn;
  sourceId: string; // 'builtin' | 'plugin:xxx' | 'oauth:xxx'
}

class ProviderRegistry {
  private providers = new Map<string, ProviderRegistration>();

  register(type: string, factory: ProviderFactoryFn, sourceId = 'builtin'): void {
    if (this.providers.has(type)) {
      console.warn(`Provider type '${type}' already registered, overwriting`);
    }
    this.providers.set(type, { factory, sourceId });
  }

  get(type: string): ProviderFactoryFn | undefined {
    return this.providers.get(type)?.factory;
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  listTypes(): string[] {
    return Array.from(this.providers.keys());
  }

  clear(): void {
    this.providers.clear();
  }

  unregisterBySourceId(sourceId: string): void {
    for (const [type, registration] of this.providers) {
      if (registration.sourceId === sourceId) {
        this.providers.delete(type);
      }
    }
  }

  getSourceId(type: string): string | undefined {
    return this.providers.get(type)?.sourceId;
  }
}

const registry = new ProviderRegistry();

export function registerProvider(type: string, factory: ProviderFactoryFn, sourceId?: string): void {
  registry.register(type, factory, sourceId);
}

export function getProviderFactory(type: string): ProviderFactoryFn | undefined {
  return registry.get(type);
}

export function hasProvider(type: string): boolean {
  return registry.has(type);
}

export function listProviderTypes(): string[] {
  return registry.listTypes();
}

/**
 * 清空注册表（仅测试用）
 */
export function clearProviderRegistry(): void {
  registry.clear();
}

/**
 * 按 sourceId 批量注销（M2 §6.2，pi unregisterApiProviders 对齐）
 *
 * 用途：插件卸载、测试隔离。sourceId 不存在时为空操作（不抛错）；
 * 已被 ModelConfigService.providerCache 缓存的实例不受影响（新实例无法再创建）。
 */
export function unregisterProviders(sourceId: string): void {
  registry.unregisterBySourceId(sourceId);
}

/** 查询注册来源（诊断/审计用）；未注册返回 undefined */
export function getProviderSourceId(type: string): string | undefined {
  return registry.getSourceId(type);
}
