import { describe, expect, it } from 'vitest';
import { buildSelectOptionPlayerAction } from '../selectOption';

describe('buildSelectOptionPlayerAction', () => {
  it('应优先使用选项自带的 npcId 构造结构化动作', () => {
    expect(
      buildSelectOptionPlayerAction({
        id: 'option-help',
        text: '请求帮助',
        npcId: 'npc-blacksmith',
      })
    ).toEqual({
      type: 'select',
      selectedOptionId: 'option-help',
      targetNpcId: 'npc-blacksmith',
    });
  });

  it('选项缺少 npcId 时应直接抛错，禁止退化为猜测目标 NPC', () => {
    expect(() =>
      buildSelectOptionPlayerAction({
        id: 'option-help',
        text: '请求帮助',
      } as unknown as Parameters<typeof buildSelectOptionPlayerAction>[0])
    ).toThrow('对话选项缺少明确的目标 NPC');
  });

  it('选项 id 为空白时应直接抛错，禁止把坏 option 发送到后端', () => {
    expect(() =>
      buildSelectOptionPlayerAction({
        id: '   ',
        text: '请求帮助',
        npcId: 'npc-blacksmith',
      })
    ).toThrow('对话选项缺少稳定的 optionId');
  });
});
