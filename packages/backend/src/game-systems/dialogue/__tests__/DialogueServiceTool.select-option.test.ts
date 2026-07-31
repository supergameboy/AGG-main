import { describe, expect, it } from 'vitest';
import { DialogueServiceTool } from '../DialogueServiceTool.js';
import type { NPCServiceTool } from '../../npc/NPCServiceTool.js';
import type { QuestServiceTool } from '../../quest/QuestServiceTool.js';
import type { InventoryServiceTool } from '../../inventory/InventoryServiceTool.js';

/**
 * S3-3 Phase D: 测试适配。
 * 原 test 使用 new DialogueServiceTool()（无参构造），
 * 重构后改为构造注入 3 个 ServiceTool（mock 为最小对象，仅验证 action mapping）。
 */
describe('DialogueServiceTool select_option action mapping', () => {
  it('应将 process_choice 映射到 process_dialogue_choice', () => {
    const mockNpcServiceTool = {} as NPCServiceTool;
    const mockQuestServiceTool = {} as QuestServiceTool;
    const mockInventoryServiceTool = {} as InventoryServiceTool;
    const tool = new DialogueServiceTool(
      mockNpcServiceTool,
      mockQuestServiceTool,
      mockInventoryServiceTool,
    ) as unknown as { handledActions: Array<{ action: string; method: string }> };

    const handler = tool.handledActions.find((entry) => entry.action === 'process_choice');

    expect(handler).toMatchObject({
      action: 'process_choice',
      method: 'process_dialogue_choice',
    });
  });
});
