import { describe, expect, it, vi } from 'vitest';

import { EventService } from '../EventService.js';
import type { GameEvent, EventTrigger } from '@ai-rpg/shared/messaging';

/**
 * S3-1: EventService 测试适配新的 6 参数构造函数。
 * 测试核心场景：story_events 写路径委托 IStoryEventWriter 端口。
 *
 * mock 策略：每个测试用例只 mock 实际被调用的依赖方法，其余留空。
 * 不再 mock db（已移除），改为 mock 端口接口。
 */

describe('EventService story_events write path', () => {
  const createEvent = (overrides: Partial<GameEvent> = {}): GameEvent => ({
    id: 'event-1',
    templateId: 'template-1',
    name: '普通事件',
    description: '一次普通即时反馈',
    type: 'random',
    triggerType: 'enter_location',
    triggerData: {},
    effects: [],
    priority: 1,
    repeatable: true,
    cooldown: 0,
    ...overrides,
  });

  it('recordStoryEvent 应委托 StoryService.addStoryEvent 作为单写入口', async () => {
    const storyEventWriter = {
      addStoryEvent: vi.fn().mockResolvedValue({
        id: 'evt-1',
        save_id: 'save-1',
        chapter: 'chapter_1',
        event_type: 'major_record',
        title: '玩家首次确认村庄异变线索',
        description: '本轮存在可归档重大事件',
        importance: 'critical',
        participants: '["npc-village-chief"]',
        impact: '{"source":"event_service"}',
        timestamp: 123456,
      }),
      getStoryEvents: vi.fn(),
    };

    const service = new EventService(
      {} as any,
      {} as any,
      storyEventWriter as any,
      {} as any,
      {} as any,
    );

    const result = await service.recordStoryEvent('save-1' as any, {
      chapter: 'chapter_1',
      eventType: 'major_record',
      title: '玩家首次确认村庄异变线索',
      description: '本轮存在可归档重大事件',
      importance: 'minor',
      participants: ['npc-village-chief'],
      impact: { source: 'event_service' },
    });

    expect(storyEventWriter.addStoryEvent).toHaveBeenCalledWith('save-1', {
      chapter: 'chapter_1',
      event_type: 'major_record',
      title: '玩家首次确认村庄异变线索',
      description: '本轮存在可归档重大事件',
      importance: 'minor',
      participants: ['npc-village-chief'],
      impact: { source: 'event_service' },
    });
    expect(result).toEqual({
      id: 'evt-1',
      saveId: 'save-1',
      chapter: 'chapter_1',
      eventType: 'major_record',
      title: '玩家首次确认村庄异变线索',
      description: '本轮存在可归档重大事件',
      importance: 'critical',
      participants: ['npc-village-chief'],
      impact: { source: 'event_service' },
      timestamp: 123456,
    });
  });

  it('triggerEvent 对普通即时事件不应写入 story_events', async () => {
    const eventRepo = {
      findById: vi.fn().mockResolvedValue(createEvent()),
    };
    const triggerRepo = {
      insert: vi.fn().mockResolvedValue({
        id: 'evt-trigger-1',
        saveId: 'save-1',
        eventId: 'event-1',
        triggeredAt: 123456,
        resolvedAt: null,
        status: 'pending',
        resultData: {},
      } as EventTrigger),
    };
    const storyEventWriter = {
      addStoryEvent: vi.fn(),
      getStoryEvents: vi.fn(),
    };

    const service = new EventService(
      eventRepo as any,
      triggerRepo as any,
      storyEventWriter as any,
      {} as any,
      {} as any,
    );

    const result = await service.triggerEvent('save-1' as any, 'event-1' as any, {
      locationId: 'village-gate',
      rollType: 'random',
    });

    expect(triggerRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        status: 'pending',
      }),
      'save-1',
      undefined,
    );
    expect(storyEventWriter.addStoryEvent).not.toHaveBeenCalled();
    expect(result.status).toBe('pending');
  });

  it('resolveTrigger 对主线事实事件应委托 StoryService.addStoryEvent 并标记为 major', async () => {
    const pendingTrigger: EventTrigger = {
      id: 'trigger-1',
      saveId: 'save-1',
      eventId: 'event-story',
      triggeredAt: 123450,
      resolvedAt: null,
      status: 'pending',
      resultData: {},
    };
    const updatedTrigger: EventTrigger = {
      id: 'trigger-1',
      saveId: 'save-1',
      eventId: 'event-story',
      triggeredAt: 123450,
      resolvedAt: 123456,
      status: 'resolved',
      resultData: { source: 'unit-test' },
    };
    const questEvent = createEvent({
      id: 'event-story',
      name: '主线推进',
      description: '玩家解锁了新的主线任务',
      type: 'quest',
      effects: [
        {
          type: 'quest_unlock',
          params: { questId: 'quest-main-2' },
        },
      ],
    });

    const eventRepo = {
      findById: vi.fn().mockResolvedValue(questEvent),
    };
    const triggerRepo = {
      findById: vi.fn().mockResolvedValue(pendingTrigger),
      update: vi.fn().mockResolvedValue(updatedTrigger),
    };
    const storyEventWriter = {
      addStoryEvent: vi.fn().mockResolvedValue({
        id: 'evt-story',
        save_id: 'save-1',
        chapter: 'chapter_2',
        event_type: 'quest',
        title: '主线推进',
        description: '玩家解锁了新的主线任务',
        importance: 'major',
        participants: '[]',
        impact: '{}',
        timestamp: 123456,
      }),
      getStoryEvents: vi.fn(),
    };
    const saveRepo = {
      getChapterBySaveId: vi.fn().mockResolvedValue('chapter_2'),
    };
    const mockTrx = {} as any;
    const txManager = {
      transaction: vi.fn(async (work: (trx: any) => Promise<unknown>) => work(mockTrx)),
    };

    const service = new EventService(
      eventRepo as any,
      triggerRepo as any,
      storyEventWriter as any,
      saveRepo as any,
      txManager as any,
    );

    const result = await service.resolveTrigger('save-1' as any, 'trigger-1' as any, {
      source: 'unit-test',
    });

    expect(saveRepo.getChapterBySaveId).toHaveBeenCalledWith('save-1', mockTrx);
    expect(storyEventWriter.addStoryEvent).toHaveBeenCalledWith(
      'save-1',
      expect.objectContaining({
        chapter: 'chapter_2',
        event_type: 'quest',
        title: '主线推进',
        description: '玩家解锁了新的主线任务',
        importance: 'major',
        impact: expect.objectContaining({
          eventId: 'event-story',
          sourceTriggerId: 'trigger-1',
        }),
      }),
      mockTrx,
    );
    expect(result.status).toBe('resolved');
  });
});
