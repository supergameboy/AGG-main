// LLM Service (P1-S5: 从 @ai-rpg/ai re-export)
// M1: StreamChunk（LLMService 层）已删除，流式消费改用 LLMStreamEvent（直接从 @ai-rpg/ai 导入）
export { LLMService } from '@ai-rpg/ai';
export type {
  LLMMessageExtended,
  LLMResponse,
  ChatOptions,
  LLMServiceOptions,
} from '@ai-rpg/ai';

// Context Service
export { ContextService } from './context.js';

// Template Service
export { TemplateService } from './template.js';
export type {
  TemplateRecord,
  PromptConfig,
} from './template.js';

// Game Service
export { GameService } from './game.js';
export type {
  Character,
  GameState,
  GameTurnResult,
} from './game.js';

// Image Generation Service (Placeholder)
export { ImageGenService } from './imageGen.js';
export type {
  ImageGenOptions,
  ImageResult,
} from './imageGen.js';

// Decision Log Service
export { DecisionLogService } from './decision-log.js';
export type {
  DecisionLogQueryOptions,
  PaginatedDecisionLogs,
} from './decision-log.js';

// Model Config Service (P1-S5: 从 @ai-rpg/ai re-export)
export { ModelConfigService } from '@ai-rpg/ai';

// Panel Update Broadcaster (统一面板变更推送机制)
export { PanelUpdateBroadcaster } from './PanelUpdateBroadcaster.js';
