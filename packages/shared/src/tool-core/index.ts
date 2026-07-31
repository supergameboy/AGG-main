/**
 * shared/tool-core 桶导出（v1.3 新增）
 *
 * 导出端口接口契约、BaseTool、toolResultCache、createStagingKnex。
 * backend 通过 `@ai-rpg/shared/tool-core` 导入。
 *
 * 注：工具核心类型定义已迁移到 shared/src/types/tool.ts（Phase 4 模块D 统一收敛），
 * 类型应从 `@ai-rpg/shared/types/tool` 导入，本桶不再 re-export 类型以维护单一数据源。
 */

// 端口接口契约
export type {
  IStagingPool,
  IShadowStateLayer,
  IWriteQueue,
  IAgentRuntimeSnapshot,
  IDevTraceHook,
  DevTraceType,
} from './port-interfaces.js';

// 工具结果缓存
export { ToolResultCache, toolResultCache, initCleanupScheduler } from './tool-result-cache.js';

// StagingKnex 暂存查询构建器
export { createStagingKnex } from './staging-knex.js';

// BaseTool 工具基类 + 超时配置注册 + 工具事件发射器注册（M6）
export { BaseTool, registerTimeoutConfig, registerToolEventEmitter } from './BaseTool.js';
export type { ToolEventEmitter } from './BaseTool.js';

// M6 工具进度契约（tool-core 自有类型，经本桶导出）
export { createProgressReporter } from './tool-progress.js';
export type {
  ToolProgress,
  ToolProgressCallback,
  ProgressReporterOptions,
} from './tool-progress.js';

// M6 工具取消契约（结构接口 + 检查辅助）
export {
  ToolAbortError,
  throwIfAborted,
  isAbortError,
  abortReasonToMessage,
} from './abort-signal.js';
export type { ToolAbortSignal } from './abort-signal.js';
