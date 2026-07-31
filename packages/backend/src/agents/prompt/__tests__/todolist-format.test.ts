import { describe, expect, it } from 'vitest';

describe('TASK_FIELDS storyDirective todoList format', () => {
  // 从 index.ts 中提取的 format 逻辑
  const formatStoryDirective = (v: unknown): string => {
    const directive = v as Record<string, unknown>;
    const todoList = directive?.todoList as string[] | undefined;
    const todoSection = todoList && todoList.length > 0
      ? `\n## 任务清单\n${todoList.map((item, i) => `${i + 1}. ${item}`).join('\n')}`
      : '';
    return `<story_directive>\n${JSON.stringify(v, null, 2)}\n</story_directive>${todoSection}`;
  };

  it('包含 todoList 时输出任务清单段', () => {
    const directive = {
      storyGoal: '引导玩家发现线索',
      todoList: ['调查村口', '寻找线索', '汇报村长'],
      requiredLayer1Agents: ['npc_party'],
      optionalLayer1Agents: [],
      projection: { chapter: '第一章', mainQuest: '调查' },
    };

    const result = formatStoryDirective(directive);

    expect(result).toContain('<story_directive>');
    expect(result).toContain('</story_directive>');
    expect(result).toContain('## 任务清单');
    expect(result).toContain('1. 调查村口');
    expect(result).toContain('2. 寻找线索');
    expect(result).toContain('3. 汇报村长');
  });

  it('todoList 为空数组时不输出任务清单段', () => {
    const directive = {
      storyGoal: '引导玩家',
      todoList: [],
      requiredLayer1Agents: [],
      optionalLayer1Agents: [],
      projection: { chapter: null, mainQuest: null },
    };

    const result = formatStoryDirective(directive);

    expect(result).not.toContain('## 任务清单');
  });

  it('无 todoList 字段时不输出任务清单段', () => {
    const directive = {
      storyGoal: '引导玩家',
      requiredLayer1Agents: [],
      optionalLayer1Agents: [],
      projection: { chapter: null, mainQuest: null },
    };

    const result = formatStoryDirective(directive);

    expect(result).not.toContain('## 任务清单');
  });

  it('todoList 单项时正确编号', () => {
    const directive = {
      storyGoal: '测试',
      todoList: ['唯一任务'],
      requiredLayer1Agents: [],
      optionalLayer1Agents: [],
      projection: { chapter: null, mainQuest: null },
    };

    const result = formatStoryDirective(directive);

    expect(result).toContain('1. 唯一任务');
    expect(result).not.toContain('2.');
  });
});
