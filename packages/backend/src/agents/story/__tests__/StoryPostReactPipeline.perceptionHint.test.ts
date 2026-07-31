import { describe, expect, it } from 'vitest';
import { StoryPostReactPipeline } from '../StoryPostReactPipeline.js';
import type { ToolResult } from '../../../../../shared/src/types/agent.js';
import type { ReActEngineResult } from '../../ReActEngine.js';

/**
 * 模块3 单元测试：StoryPostReactPipeline.detectPerceptionUpdateHint
 *
 * 覆盖设计文档"实现效果描述"中的关键期望：
 * - L2-2 后处理引导：检测 4 类事件（战斗/对话/任务完成/剧情转折）
 * - perceptionUpdateHint 字段：无事件时 null，有事件时返回提示字符串
 * - 多事件去重：同一事件类型不重复出现
 * - 多事件拼接：多类事件用"、"分隔并合并提示
 * - 任务完成事件：仅 status=completed 触发，其他状态不触发
 * - 剧情转折事件：仅 eventType=major 触发，其他类型不触发
 *
 * 测试策略：通过 run() 间接调用 private detectPerceptionUpdateHint，
 *   构造含特定 _meta 的 toolCalls 注入 reactResult。
 */

function makeToolResult(meta: {
  toolType: string;
  method: string;
  params?: Record<string, unknown>;
}): ToolResult {
  return {
    id: `call-${Math.random().toString(36).slice(2)}`,
    toolCallId: 'tc-1',
    success: true,
    timestamp: Date.now(),
    _meta: {
      toolType: meta.toolType,
      method: meta.method,
      params: meta.params ?? {},
    },
  };
}

function makeReactResult(toolCalls: ToolResult[]): ReActEngineResult {
  return {
    content: '',
    iterations: 1,
    toolCalls,
  } as ReActEngineResult;
}

async function runPipeline(toolCalls: ToolResult[]) {
  const pipeline = new StoryPostReactPipeline({} as never);
  const result = await pipeline.run({
    saveId: 'save-1',
    storyRequestContext: {} as never,
    storyDirective: null,
    reactResult: makeReactResult(toolCalls),
    integrationResult: {
      success: true,
      data: {},
      writeOperations: [],
      agentResponses: new Map(),
      needsFurtherProcessing: false,
      fallbackSuggestions: [],
    } as never,
    stagingPool: {} as never,
    shadowState: {} as never,
  });
  return result.perceptionUpdateHint;
}

describe('StoryPostReactPipeline.detectPerceptionUpdateHint (模块3 L2-2)', () => {
  describe('无感知事件时返回 null', () => {
    it('空 toolCalls 数组返回 null', async () => {
      expect(await runPipeline([])).toBeNull();
    });

    it('无 _meta 的 toolCall 返回 null', async () => {
      const call = {
        id: 'c1',
        toolCallId: 'tc1',
        success: true,
        timestamp: Date.now(),
      } as ToolResult;
      expect(await runPipeline([call])).toBeNull();
    });

    it('非感知类工具调用返回 null', async () => {
      const call = makeToolResult({
        toolType: 'inventory_service',
        method: 'list_inventory',
        params: {},
      });
      expect(await runPipeline([call])).toBeNull();
    });
  });

  describe('战斗事件检测', () => {
    it('combat_service.complete_combat 触发战斗事件', async () => {
      const call = makeToolResult({
        toolType: 'combat_service',
        method: 'complete_combat',
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('战斗已完成');
      expect(hint).toContain('set_awareness');
      expect(hint).toContain('set_relationship');
    });

    it('combat_service.execute_combat_round 触发战斗事件', async () => {
      const call = makeToolResult({
        toolType: 'combat_service',
        method: 'execute_combat_round',
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('战斗已完成');
    });

    it('combat_service 其他方法不触发', async () => {
      const call = makeToolResult({
        toolType: 'combat_service',
        method: 'start_combat',
      });
      expect(await runPipeline([call])).toBeNull();
    });
  });

  describe('对话事件检测', () => {
    it('dialogue_service.add_dialogue_message 触发对话事件', async () => {
      const call = makeToolResult({
        toolType: 'dialogue_service',
        method: 'add_dialogue_message',
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('对话已发生');
    });

    it('dialogue_service.process_dialogue_choice 触发对话事件', async () => {
      const call = makeToolResult({
        toolType: 'dialogue_service',
        method: 'process_dialogue_choice',
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('对话已发生');
    });
  });

  describe('任务完成事件检测', () => {
    it('quest_service.update_quest status=completed (顶层 params.status) 触发任务完成事件', async () => {
      const call = makeToolResult({
        toolType: 'quest_service',
        method: 'update_quest',
        params: { status: 'completed' },
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('任务已完成');
    });

    it('quest_service.update_quest updates.status=completed (嵌套 updates) 触发任务完成事件', async () => {
      const call = makeToolResult({
        toolType: 'quest_service',
        method: 'update_quest',
        params: { updates: { status: 'completed' } },
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('任务已完成');
    });

    it('quest_service.update_quest status=active 不触发任务完成事件', async () => {
      const call = makeToolResult({
        toolType: 'quest_service',
        method: 'update_quest',
        params: { status: 'active' },
      });
      expect(await runPipeline([call])).toBeNull();
    });

    it('quest_service 其他方法不触发', async () => {
      const call = makeToolResult({
        toolType: 'quest_service',
        method: 'create_quest',
      });
      expect(await runPipeline([call])).toBeNull();
    });
  });

  describe('剧情转折事件检测', () => {
    it('event_service.trigger_event eventType=major (顶层 params.eventType) 触发剧情转折', async () => {
      const call = makeToolResult({
        toolType: 'event_service',
        method: 'trigger_event',
        params: { eventType: 'major' },
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('剧情已发生转折');
    });

    it('event_service.trigger_event eventData.eventType=major (嵌套 eventData) 触发剧情转折', async () => {
      const call = makeToolResult({
        toolType: 'event_service',
        method: 'trigger_event',
        params: { eventData: { eventType: 'major' } },
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('剧情已发生转折');
    });

    it('event_service.trigger_event eventType=minor 不触发剧情转折', async () => {
      const call = makeToolResult({
        toolType: 'event_service',
        method: 'trigger_event',
        params: { eventType: 'minor' },
      });
      expect(await runPipeline([call])).toBeNull();
    });
  });

  describe('多事件去重与拼接', () => {
    it('同类事件多次调用只出现一次', async () => {
      const calls = [
        makeToolResult({ toolType: 'combat_service', method: 'complete_combat' }),
        makeToolResult({ toolType: 'combat_service', method: 'execute_combat_round' }),
      ];
      const hint = await runPipeline(calls);
      expect(hint).not.toBeNull();
      // '战斗已完成' 只出现一次（用 split 计数避免子串匹配）
      const occurrences = (hint?.match(/战斗已完成/g) ?? []).length;
      expect(occurrences).toBe(1);
    });

    it('多类事件用"、"拼接', async () => {
      const calls = [
        makeToolResult({ toolType: 'combat_service', method: 'complete_combat' }),
        makeToolResult({ toolType: 'dialogue_service', method: 'add_dialogue_message' }),
        makeToolResult({
          toolType: 'quest_service',
          method: 'update_quest',
          params: { status: 'completed' },
        }),
        makeToolResult({
          toolType: 'event_service',
          method: 'trigger_event',
          params: { eventType: 'major' },
        }),
      ];
      const hint = await runPipeline(calls);
      expect(hint).not.toBeNull();
      expect(hint).toContain('战斗已完成');
      expect(hint).toContain('对话已发生');
      expect(hint).toContain('任务已完成');
      expect(hint).toContain('剧情已发生转折');
      expect(hint).toContain('、');
    });

    it('提示语含 observerType=npc 引导', async () => {
      const call = makeToolResult({
        toolType: 'combat_service',
        method: 'complete_combat',
      });
      const hint = await runPipeline([call]);
      expect(hint).toContain('observerType=npc');
      expect(hint).toContain('observerId=NPC ID');
    });
  });
});
