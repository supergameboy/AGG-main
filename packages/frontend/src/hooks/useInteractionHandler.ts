import { useCallback } from 'react';
import type { UIInteractionType, UIInteractionData } from '@ai-rpg/shared';
import { useGameStore } from '@/stores/gameStore';
import { useDialogueStore } from '@/stores/dialogueStore';

function generateInteractionMessage(
  type: UIInteractionType,
  target?: string,
  params?: Record<string, unknown>
): string {
  const messages: Record<UIInteractionType, string> = {
    use_item: `使用物品 ${target ?? ''}`,
    equip_item: `装备物品 ${target ?? ''}`,
    unequip_item: `卸下装备 ${target ?? ''}`,
    drop_item: `丢弃物品 ${target ?? ''}`,
    examine_item: `查看物品 ${target ?? ''}`,
    learn_skill: `学习技能 ${target ?? ''}`,
    use_skill: `使用技能 ${(params?.skillName as string) ?? target ?? ''}`,
    view_skill: `查看技能 ${target ?? ''}`,
    travel: `前往 ${(params?.displayName as string) ?? target ?? ''}`,
    travel_to: `旅行至 ${(params?.displayName as string) ?? target ?? ''}`,
    talk_npc: `与 ${(params?.displayName as string) ?? target ?? ''} 对话`,
    accept_quest: `接受任务 ${target ?? ''}`,
    complete_quest: `完成任务 ${target ?? ''}`,
    abandon_quest: `放弃任务 ${target ?? ''}`,
    buy_item: `购买物品 ${target ?? ''}`,
    sell_item: `出售物品 ${target ?? ''}`,
    craft_item: `制作物品 ${target ?? ''}`,
    enhance_item: `强化装备 ${target ?? ''}`,
    deposit_item: `存入仓库 ${target ?? ''}`,
    withdraw_item: `取出物品 ${target ?? ''}`,
    select: `选择: ${target ?? ''}`,
    custom: (params?.message as string) ?? '自定义操作',
  };
  return messages[type];
}

export function useInteractionHandler() {
  const sendMessage = useGameStore((s) => s.sendMessage);
  const saveId = useGameStore((s) => s.saveId);
  const isTyping = useDialogueStore((s) => s.isTyping);

  const sendInteraction = useCallback(
    async (interaction: UIInteractionData) => {
      if (!saveId || isTyping) return null;

      const message = generateInteractionMessage(
        interaction.interactionType,
        interaction.target,
        interaction.params
      );

      // 三层路由：interactionType 即 intentHint，通过 resolveAction 映射到对应 action
      // 前端已知意图走 -LLM 直接路径，未知意图走 chat 间接路径
      // resolveAction 将 interactionType 映射为 action（如 use_item → inventory-LLM），
      // 实际路由在 gameStore.sendMessage → WSRequestBuilder.game.resolve() 中执行
      return sendMessage(message, interaction.interactionType, {
        interactionType: interaction.interactionType,
        target: interaction.target,
        params: interaction.params,
      });
    },
    [saveId, isTyping, sendMessage]
  );

  return { sendInteraction, isTyping };
}
