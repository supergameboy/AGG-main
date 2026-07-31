import { describe, expect, it, vi } from 'vitest';
import { StoryKernel } from '../StoryKernel.js';

describe('normalizeStoryDirective todoList', () => {
  function createKernel() {
    return new StoryKernel({
      getSnapshot: vi.fn(),
      saveStoryState: vi.fn(),
      addStoryEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    });
  }

  it('保留合法的 todoList 数组', () => {
    const kernel = createKernel();
    const result = kernel.normalizeStoryDirective({
      storyGoal: '追查灰雾源头',
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      todoList: ['调查村口', '寻找线索', '汇报村长'],
      projection: { chapter: 'chapter_1', mainQuest: '调查村口骚动' },
    });

    expect(result.todoList).toEqual(['调查村口', '寻找线索', '汇报村长']);
  });

  it('过滤非字符串项，只保留字符串', () => {
    const kernel = createKernel();
    const result = kernel.normalizeStoryDirective({
      storyGoal: '追查灰雾源头',
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      todoList: ['调查村口', 42, null, '寻找线索', undefined, '汇报村长'],
      projection: { chapter: 'chapter_1', mainQuest: '调查村口骚动' },
    });

    expect(result.todoList).toEqual(['调查村口', '寻找线索', '汇报村长']);
  });

  it('限制 todoList 最多7项', () => {
    const kernel = createKernel();
    const items = Array.from({ length: 10 }, (_, i) => `任务${i + 1}`);
    const result = kernel.normalizeStoryDirective({
      storyGoal: '追查灰雾源头',
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      todoList: items,
      projection: { chapter: 'chapter_1', mainQuest: '调查村口骚动' },
    });

    expect(result.todoList).toHaveLength(7);
    expect(result.todoList).toEqual([
      '任务1', '任务2', '任务3', '任务4', '任务5', '任务6', '任务7',
    ]);
  });

  it('空 todoList 数组输出 undefined', () => {
    const kernel = createKernel();
    const result = kernel.normalizeStoryDirective({
      storyGoal: '追查灰雾源头',
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      todoList: [],
      projection: { chapter: 'chapter_1', mainQuest: '调查村口骚动' },
    });

    expect(result.todoList).toBeUndefined();
  });

  it('无 todoList 字段输出 undefined', () => {
    const kernel = createKernel();
    const result = kernel.normalizeStoryDirective({
      storyGoal: '追查灰雾源头',
      requiredLayer1Agents: ['quest'],
      optionalLayer1Agents: [],
      projection: { chapter: 'chapter_1', mainQuest: '调查村口骚动' },
    });

    expect(result.todoList).toBeUndefined();
  });
});
