import type { DialogueOption } from '@/components/game/DialogueBox';

export function buildSelectOptionPlayerAction(option: DialogueOption) {
  const trimmedId = option.id?.trim();

  if (!trimmedId) {
    throw new Error('对话选项缺少稳定的 optionId');
  }

  if (!option.npcId?.trim()) {
    throw new Error('对话选项缺少明确的目标 NPC');
  }

  return {
    type: 'select' as const,
    selectedOptionId: trimmedId,
    targetNpcId: option.npcId.trim(),
  };
}

/** 构建 dialogue-LLM 路径的请求数据 */
export function buildDialogueSelectData(option: DialogueOption) {
  const playerAction = buildSelectOptionPlayerAction(option);
  return {
    interactionType: 'select',
    selectedOptionId: playerAction.selectedOptionId,
    targetNpcId: playerAction.targetNpcId,
    optionText: option.text,
  };
}
