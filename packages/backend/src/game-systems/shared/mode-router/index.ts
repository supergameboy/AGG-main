/**
 * ModeRouter 桶导出（架构规范 3.2 桶导出禁令）
 *
 * 仅导出本模块内容，不重新导出跨层引用。
 */

export type { IModeRouter, ModeRouteResult } from './types.js';
export type { IntentAgentMap, CanonicalGameMode } from './agent-mapping.js';
export {
  MODE_AGENT_MAPPING,
  DEPRECATED_GAME_MODE_NORMALIZATION,
  normalizeGameMode,
} from './agent-mapping.js';
export { ModeRouter } from './mode-router.js';
