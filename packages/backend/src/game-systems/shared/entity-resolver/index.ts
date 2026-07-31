/**
 * 统一实体引用解析设施桶导出（13.2 规则）。
 * 仅导出本模块内容，禁止跨层桶导出（架构规范 3.2 桶导出禁令）。
 */

export type {
  EntityType,
  OwnerType,
  EntityRef,
  ResolvedEntity,
  IEntityResolver,
} from './types.js';

export { EntityResolverBase } from './EntityResolverBase.js';
export { EntityResolutionError } from './EntityResolutionError.js';
export type { EntityResolutionReason } from './EntityResolutionError.js';
export { resolveEntityRef, resolveEntityRefs } from './resolve-helpers.js';
