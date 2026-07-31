import { describe, expect, it } from 'vitest';
import {
  CORE_AGENT_HOOKS,
  createAgentHookDispatcher,
} from '../runtime/agent-hooks.js';

describe('agent hook runtime', () => {
  it('应暴露 10 个核心 Hook 名称且顺序稳定', () => {
    expect(CORE_AGENT_HOOKS).toEqual([
      'before_model_select',
      'before_prompt_build',
      'before_tool_expose',
      'before_tool_call',
      'after_tool_call',
      'before_compaction',
      'after_compaction',
      'after_agent_fail',
      'report_progress',
      'on_task_complete',
    ]);
  });

  it('dispatcher 应按注册顺序执行并合并 patch', async () => {
    const dispatcher = createAgentHookDispatcher();

    dispatcher.register('before_prompt_build', async () => ({
      patch: { promptWarnings: ['a'] },
    }));
    dispatcher.register('before_prompt_build', async () => ({
      patch: { promptWarnings: ['b'], injectedContext: 'ctx' },
    }));

    const result = await dispatcher.dispatch('before_prompt_build', {
      requestId: 'req-1',
      agentRunId: 'run-1',
      iteration: 0,
      traceIds: { requestId: 'req-1', agentRunId: 'run-1' },
      snapshot: {} as never,
    });

    expect(result.patch).toEqual({
      promptWarnings: ['a', 'b'],
      injectedContext: 'ctx',
    });
  });

  it('blocked patch 应中止后续 Hook 执行', async () => {
    const dispatcher = createAgentHookDispatcher();
    const order: string[] = [];

    dispatcher.register('before_tool_call', async () => {
      order.push('first');
      return { blocked: true, reason: 'readonly-only' };
    });
    dispatcher.register('before_tool_call', async () => {
      order.push('second');
      return { patch: { normalizedArguments: { id: 'x' } } };
    });

    const result = await dispatcher.dispatch('before_tool_call', {
      requestId: 'req-1',
      agentRunId: 'run-1',
      iteration: 0,
      traceIds: { requestId: 'req-1', agentRunId: 'run-1' },
      snapshot: {} as never,
      payload: { toolName: 'inventory_service__equip_item' },
    });

    expect(order).toEqual(['first']);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('readonly-only');
  });
});
