/**
 * event 领域纯映射函数。
 *
 * 从 EventService 私有方法迁入（rowToGameEvent L748 / rowToEventTrigger L768），
 * 供 EventRepository / EventTriggerRepository 共享。
 * 另含 StoryEvent → StoryEventRecord 跨领域映射（覆盖 EventService L644-661 手工映射）。
 */
import type { ID, Timestamp } from '../../../../shared/src/types/core.js';
import type {
  GameEvent,
  EventTrigger,
  StoryEventRecord,
} from '@ai-rpg/shared/messaging';
import type { StoryEvent } from '../story/types.js';

type StoryEventImportance = StoryEventRecord['importance'];

/** 规范化 importance 字段，非法值兜底为 'minor'（边界处校验） */
function normalizeStoryEventImportance(importance?: string): StoryEventImportance {
  if (importance === 'critical' || importance === 'major' || importance === 'minor') {
    return importance;
  }
  return 'minor';
}

/** JSON 字段安全解析：字符串则 parse，对象则直返，空值用 fallback */
function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

/** events 表行 → GameEvent 实体 */
export function rowToGameEvent(row: Record<string, unknown>): GameEvent {
  return {
    id: row.id as ID,
    templateId: (row.template_id as string) ?? '',
    name: row.name as string,
    description: (row.description as string) || '',
    type: row.type as GameEvent['type'],
    triggerType: row.trigger_type as GameEvent['triggerType'],
    triggerData: parseJsonField<Record<string, unknown>>(row.trigger_data, {}),
    effects: parseJsonField<GameEvent['effects']>(row.effects, []),
    priority: (row.priority as number) || 0,
    repeatable: !!(row.repeatable as number),
    cooldown: (row.cooldown as number) || 0,
  };
}

/** event_triggers 表行 → EventTrigger 实体 */
export function rowToEventTrigger(row: Record<string, unknown>): EventTrigger {
  return {
    id: row.id as ID,
    saveId: row.save_id as ID,
    eventId: row.event_id as ID,
    triggeredAt: row.triggered_at as Timestamp,
    resolvedAt: (row.resolved_at as Timestamp | null) ?? null,
    status: row.status as EventTrigger['status'],
    resultData: parseJsonField<Record<string, unknown>>(row.result_data, {}),
  };
}

/**
 * StoryEvent（story 领域，snake_case，participants/impact 为 JSON 字符串）
 * → StoryEventRecord（shared/messaging，camelCase，participants/impact 已解析）
 *
 * 覆盖 EventService.recordStoryEvent L644-661 手工映射 + getStoryEvents 返回值映射。
 */
export function storyEventToRecord(storyEvent: StoryEvent): StoryEventRecord {
  return {
    id: storyEvent.id,
    saveId: storyEvent.save_id,
    chapter: storyEvent.chapter || '',
    eventType: storyEvent.event_type,
    title: storyEvent.title,
    description: storyEvent.description || '',
    importance: normalizeStoryEventImportance(storyEvent.importance),
    participants: parseJsonField<string[]>(storyEvent.participants, []),
    impact: parseJsonField<Record<string, unknown>>(storyEvent.impact, {}),
    timestamp: storyEvent.timestamp as Timestamp,
  };
}
