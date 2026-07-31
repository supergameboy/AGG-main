import type { Knex } from 'knex';
import type { IRequestScope } from '@ai-rpg/shared/types/tool';

/**
 * 请求级 Service 缓存管理器（实现 IRequestScope）。
 *
 * 在单次请求内共享 Service 实例，避免跨领域 ServiceTool 级联创建重复实例。
 * 生命周期: 请求开始时由 AgentRuntime 创建，保存在 RequestContext 中，
 * 请求结束后随 RequestContext 一起被 GC 回收。
 *
 * v1.5: 持有 db 引用，通过 getDb() 提供给工具层（D4 决策：Agent 层零 db 传递，
 * 工具层通过 requestScope.getDb() 获取 db 创建 Repository）。
 *
 * 设计原则:
 * - 零依赖: 不依赖任何 ServiceTool，通过 factory 回调注入创建逻辑
 * - 职责单一: 仅负责缓存管理，不负责 Service 创建
 * - 并发安全: 缓存 Promise 而非值，避免并发重复创建
 */
export class RequestScope implements IRequestScope {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(private readonly db: Knex) {}

  getDb(): Knex {
    return this.db;
  }

  async getOrCompute<T>(
    key: string,
    factory: () => Promise<T>,
  ): Promise<T> {
    if (!this.cache.has(key)) {
      this.cache.set(key, factory());
    }
    return this.cache.get(key) as Promise<T>;
  }
}
