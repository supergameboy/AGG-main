import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import type { ProgressPhase, ProgressDetail, ProgressContext } from '@ai-rpg/shared';
import { registerDefaultAgentHooks } from '../runtime/default-agent-hooks.js';

/**
 * v2 测试：report_progress Hook
 *
 * 验证点：
 * - Hook 从 context.snapshot.progressContext 读取广播元信息
 * - 使用 broadcastToClient(clientId, ...) 而非 broadcastToSave
 * - 事件 payload 包含 agentRunId（来自 progressContext），不包含 taskIndex
 * - progressContext 缺失时不广播
 * - WS 广播失败时不抛出异常
 */
function createProgressContext(overrides: Partial<{
  requestId: string;
  agentRunId: string;
  taskDescription: string;
  parentTask: string | null;
  broadcastClientId: string;
  phase: ProgressPhase;
  agentType: string;
  detail: ProgressDetail;
}> = {}) {
  const progressContext: ProgressContext = {
    requestId: overrides.requestId ?? 'req-1',
    agentRunId: overrides.agentRunId ?? 'gamemaster:run-001',
    taskDescription: overrides.taskDescription ?? 'initialize',
    parentTask: overrides.parentTask ?? null,
    broadcastClientId: overrides.broadcastClientId ?? 'client-test-123',
  };

  return {
    requestId: progressContext.requestId,
    agentRunId: progressContext.agentRunId,
    iteration: 0,
    traceIds: { requestId: progressContext.requestId, agentRunId: progressContext.agentRunId },
    snapshot: { progressContext },
    payload: {
      phase: overrides.phase ?? 'task_start',
      agentType: overrides.agentType ?? 'gamemaster',
      taskDescription: progressContext.taskDescription,
      parentTask: progressContext.parentTask,
      detail: overrides.detail,
    },
  } as Record<string, unknown>;
}

describe('report_progress Hook', () => {
  let reportProgressHook: (context: Record<string, unknown>) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let broadcastSpy: any;

  beforeAll(() => {
    const mockBroadcaster = {
      broadcastToClient: vi.fn(),
    };
    broadcastSpy = mockBroadcaster.broadcastToClient;

    let capturedHook: ((context: Record<string, unknown>) => Promise<unknown>) | undefined;
    const mockRegistry = {
      register: (_name: string, hook: (context: Record<string, unknown>) => Promise<unknown>) => {
        if (_name === 'report_progress') {
          capturedHook = hook;
        }
      },
    };
    registerDefaultAgentHooks(mockRegistry as never, undefined, { webSocketService: mockBroadcaster as never });
    if (!capturedHook) throw new Error('report_progress hook not registered');
    reportProgressHook = capturedHook;
  });

  beforeEach(() => {
    broadcastSpy.mockClear();
  });

  it('应通过 broadcastToClient 广播 agent_progress 事件', async () => {
    await reportProgressHook(createProgressContext());

    expect(broadcastSpy).toHaveBeenCalledWith(
      'client-test-123',
      'agent_progress',
      expect.objectContaining({
        phase: 'task_start',
        agentType: 'gamemaster',
        agentRunId: 'gamemaster:run-001',
        taskDescription: 'initialize',
        parentTask: null,
      }),
      'req-1',
    );
  });

  it('payload 中不应包含 taskIndex（D8 决策）', async () => {
    await reportProgressHook(createProgressContext());

    const call = broadcastSpy.mock.calls[0];
    const payload = call[2] as Record<string, unknown>;
    expect(payload.taskIndex).toBeUndefined();
  });

  it('progressContext 缺失时应跳过广播', async () => {
    const contextWithoutProgressContext = {
      requestId: 'req-1',
      agentRunId: 'run-1',
      iteration: 0,
      traceIds: { requestId: 'req-1', agentRunId: 'run-1' },
      snapshot: {}, // 无 progressContext
      payload: {
        phase: 'task_start',
        agentType: 'gamemaster',
        taskDescription: 'initialize',
        parentTask: null,
      },
    } as Record<string, unknown>;

    await reportProgressHook(contextWithoutProgressContext);

    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('应包含 timestamp 字段', async () => {
    await reportProgressHook(createProgressContext());

    const call = broadcastSpy.mock.calls[0];
    const payload = call[2] as { timestamp: number };
    expect(typeof payload.timestamp).toBe('number');
    expect(payload.timestamp).toBeGreaterThan(0);
  });

  it('WS 广播失败时不应抛出异常', async () => {
    broadcastSpy.mockImplementationOnce(() => {
      throw new Error('WS connection lost');
    });

    const result = await reportProgressHook(createProgressContext());
    expect(result).toBeUndefined();
  });

  it('应正确传递子Agent进度事件', async () => {
    await reportProgressHook(createProgressContext({
      agentRunId: 'skill:run-002',
      phase: 'sub_agent_start',
      agentType: 'skill',
      taskDescription: 'generate skills',
      parentTask: 'task:gamemaster:run-001',
      detail: {
        subAgentType: 'skill',
        subTaskDescription: 'generate skills for warrior',
      },
    }));

    expect(broadcastSpy).toHaveBeenCalledWith(
      'client-test-123',
      'agent_progress',
      expect.objectContaining({
        phase: 'sub_agent_start',
        agentType: 'skill',
        agentRunId: 'skill:run-002',
        parentTask: 'task:gamemaster:run-001',
      }),
      'req-1',
    );
  });

  it('应使用 progressContext.broadcastClientId 作为广播目标', async () => {
    const customClientId = 'client-custom-456';
    await reportProgressHook(createProgressContext({ broadcastClientId: customClientId }));

    expect(broadcastSpy).toHaveBeenCalledWith(
      customClientId,
      'agent_progress',
      expect.any(Object),
      'req-1',
    );
  });
});
