import { describe, expect, it, vi } from 'vitest';

import { StoryService } from '../StoryService.js';
import type { IStoryEventRepository, IAgentContextRepository, StoryEventRow } from '../types.js';
import type { ISaveRepository } from '../../save/types.js';
import type { ITransactionManager } from '../../../database/TransactionManager.js';

function createMockDeps() {
  return {
    storyEventRepo: {
      addStoryEvent: vi.fn(),
      getStoryEvents: vi.fn(),
      findExistingEvent: vi.fn(),
      countBySaveId: vi.fn(),
      deleteBySaveId: vi.fn(),
    } as unknown as IStoryEventRepository,
    agentContextRepo: {
      getContext: vi.fn(),
      upsert: vi.fn(),
      deleteBySaveId: vi.fn(),
    } as unknown as IAgentContextRepository,
    saveRepo: {
      getTemplateIdBySaveId: vi.fn(),
      getChapterBySaveId: vi.fn(),
    } as unknown as ISaveRepository,
    txManager: {
      transaction: vi.fn(),
    } as unknown as ITransactionManager,
  };
}

describe('StoryService story_events single write', () => {
  it('addStoryEvent 在同章同类型同标题已存在时应复用已有记录而不是重复写入', async () => {
    const existingRow: StoryEventRow = {
      id: 'evt-existing',
      save_id: 'save-1',
      chapter: 'chapter_1',
      event_type: 'major_record',
      title: '玩家首次确认村庄异变线索',
      description: '本轮存在可归档重大事件',
      importance: 'critical',
      participants: '[]',
      impact: '{}',
      timestamp: 123456,
    };

    const deps = createMockDeps();
    deps.storyEventRepo.findExistingEvent = vi.fn().mockResolvedValue(existingRow);
    deps.storyEventRepo.addStoryEvent = vi.fn(() => {
      throw new Error('should not insert duplicate story event');
    });

    const service = new StoryService(
      deps.storyEventRepo,
      deps.agentContextRepo,
      deps.saveRepo,
      deps.txManager,
    );

    const result = await service.addStoryEvent('save-1', {
      chapter: 'chapter_1',
      event_type: 'major_record',
      title: '玩家首次确认村庄异变线索',
      description: '本轮存在可归档重大事件',
      participants: [],
      impact: {},
    });

    expect(deps.storyEventRepo.findExistingEvent).toHaveBeenCalledWith(
      'save-1',
      'chapter_1',
      'major_record',
      '玩家首次确认村庄异变线索',
      undefined,
    );
    expect(deps.storyEventRepo.addStoryEvent).not.toHaveBeenCalled();
    expect(result.id).toBe('evt-existing');
    expect(result.importance).toBe('critical');
  });

  it('addStoryEvent 在新增记录时应持久化 importance，未提供时默认 minor', async () => {
    const deps = createMockDeps();
    deps.storyEventRepo.findExistingEvent = vi.fn().mockResolvedValue(null);
    deps.storyEventRepo.addStoryEvent = vi.fn().mockResolvedValue('evt-new');

    const service = new StoryService(
      deps.storyEventRepo,
      deps.agentContextRepo,
      deps.saveRepo,
      deps.txManager,
    );

    const result = await service.addStoryEvent('save-1', {
      chapter: 'chapter_1',
      event_type: 'quest',
      title: '玩家接到村长委托',
      description: '新的调查任务正式开启',
      participants: [],
      impact: {},
    });

    expect(deps.storyEventRepo.addStoryEvent).toHaveBeenCalledWith(
      'save-1',
      expect.objectContaining({
        event_type: 'quest',
        title: '玩家接到村长委托',
        importance: 'minor',
      }),
      undefined,
    );
    expect(result.id).toBe('evt-new');
    expect(result.importance).toBe('minor');
  });
});
