/**
 * event/ 模块桶导出（S3-1 完整 Repository 模式）。
 *
 * EventBus + 实体类型已迁移到 shared/messaging/，此处不再重导出。
 * 消费方直接从 `@ai-rpg/shared/messaging` 导入 GameEvent/EventTrigger 等。
 *
 * S3-1: events 表 + event_triggers 表分属两个 Repository（D7 一表一 Repository），
 * EventService 通过 IEventRepository + IEventTriggerRepository 端口操作数据。
 * mappers.ts 是包内共享纯映射函数，不从桶导出（接口最小化）。
 */

export { EventService } from './EventService.js';
export { EventServiceTool } from './EventServiceTool.js';
export { EventRepository } from './EventRepository.js';
export { EventTriggerRepository } from './EventTriggerRepository.js';
export type {
  IEventRepository,
  IEventTriggerRepository,
  IEventService,
  EventInsertInput,
  EventTriggerInsertInput,
  EventTriggerUpdateInput,
} from './types.js';
