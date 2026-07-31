/**
 * BaseAgent.callTool 进度桥接 + 取消信号透传测试（M6 §8.2 call-tool-progress-bridge）。
 *
 * 覆盖：
 * ① handler 调 onUpdate → reportProgress 收到 phase='tool_call' 且 detail.progress 字段正确
 * ② abortSignal 经 reqCtx 透传到 ToolContext
 * ③ reqCtx.abortSignal 缺省 → ToolContext.abortSignal undefined（降级合法）
 * ④ BaseAgent.callTool 基类组装点同样填充 onUpdate/abortSignal
 *    （基类 reportToolProgress 默认降级，override 后可观测桥接到达）
 */

import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime.js';
import { BaseAgent } from '../BaseAgent.js';
import { RequestScope } from '../../services/RequestScope.js';
import type { Knex } from 'knex';
import type { ID } from '../../../../shared/src/types/core.js';
import type {
  AgentMessage,
  AgentType,
  LLMMessage,
} from '../../../../shared/src/types/agent.js';
import type { AgentResponse, LLMOptions, LLMResponse } from '../types.js';
import type { RequestContext } from '../ReActLoop.js';
import type {
  ToolContext,
  ToolResponse,
} from '@ai-rpg/shared/types/tool';
import type { ToolProgress, ToolAbortSignal } from '@ai-rpg/shared/tool-core';
import type { ProgressPhase, ProgressDetail } from '@ai-rpg/shared';

/** AgentRuntime 测试访问视图：暴露私有 reportProgress 与受保护 toolRegistry（仅测试注入用） */
type AgentRuntimeTestView = {
  toolRegistry: {
    execute: (
      agentType: string,
      toolType: string,
      method: string,
      params: Record<string, unknown>,
      context: ToolContext,
    ) => Promise<ToolResponse>;
  };
  reportProgress: (phase: ProgressPhase, detail?: ProgressDetail) => void;
};

function asTestView(agent: AgentRuntime): AgentRuntimeTestView {
  return agent as unknown as AgentRuntimeTestView;
}

function createGameMasterRuntime(): AgentRuntime {
  return new AgentRuntime(
    {
      llmService: {} as never,
      db: vi.fn() as never,
      promptModule: {
        build: vi.fn(),
        rules: { getAllRulesForAgent: vi.fn().mockReturnValue([]) },
        skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
      } as never,
      devTraceCollector: () => null,
      createTraceCollector: () => ({}) as never,
      createResponsePool: () => ({ stage: vi.fn(), flush: vi.fn().mockReturnValue({ uiDirective: undefined, uiIntensity: undefined, panelUpdates: {}, time: undefined }), hasUIDirective: vi.fn().mockReturnValue(false), hasPanelUpdates: vi.fn().mockReturnValue(false), clear: vi.fn() }) as never,
      createStagingPool: () => ({ stage: vi.fn(), hasWrites: vi.fn().mockReturnValue(false), flush: vi.fn(), writeCount: 0, rollbackFrom: vi.fn().mockReturnValue(0), getAllWrites: vi.fn().mockReturnValue([]), clear: vi.fn(), clearDirtyAfterFlush: vi.fn(), getFailedWrites: vi.fn().mockReturnValue([]), isDirtyAfterFlush: vi.fn().mockReturnValue(false), bindShadowState: vi.fn(), bindGraphUpdater: vi.fn(), adoptFrom: vi.fn() }) as never,
      createShadowStateLayer: () => ({ read: vi.fn().mockReturnValue(undefined), readOne: vi.fn().mockReturnValue(undefined), ensureSnapshot: vi.fn().mockResolvedValue(undefined), apply: vi.fn(), reset: vi.fn() }) as never,
      createRequestScope: () => new RequestScope({} as unknown as Knex),
      npcServiceFactory: (() => Promise.resolve({} as never)) as never,
      requestEventBridge: { drainPendingEvents: () => [] } as never,
    } as never,
    {
      name: 'GameMaster',
      tools: ['map_service'],
      max_iterations: 4,
      force_structured_output: true,
      isSubAgent: false,
      temperature: 0.7,
      max_tokens: 4096,
    } as never,
    'gamemaster',
    'test system prompt',
  );
}

function buildReqCtx(overrides?: Partial<RequestContext>): RequestContext {
  return {
    intentHint: 'test',
    requestScope: new RequestScope({} as unknown as Knex),
    ...overrides,
  };
}

describe('AgentRuntime.callTool 进度桥接 + abortSignal 透传（M6 §8.2）', () => {
  it('① handler 调 onUpdate → reportProgress 收到 phase=tool_call 且 detail.progress 正确', async () => {
    const agent = createGameMasterRuntime();
    const view = asTestView(agent);
    const reportProgressSpy = vi.spyOn(view, 'reportProgress');

    let capturedContext: ToolContext | undefined;
    view.toolRegistry = {
      execute: vi.fn(
        async (
          _agentType: string,
          _toolType: string,
          _method: string,
          _params: Record<string, unknown>,
          context: ToolContext,
        ): Promise<ToolResponse> => {
          capturedContext = context;
          context.onUpdate?.({ percent: 50, message: '初始化世界数据中', stage: 'game_init' });
          return { success: true, data: { ok: true } };
        },
      ),
    };

    const result = await agent.callTool('map_service', 'describe_area', {}, 'save-1' as ID, buildReqCtx());

    expect(result.success).toBe(true);
    expect(capturedContext?.onUpdate).toBeDefined();
    expect(reportProgressSpy).toHaveBeenCalledTimes(1);
    expect(reportProgressSpy).toHaveBeenCalledWith('tool_call', {
      toolName: 'map_service.describe_area',
      progress: { percent: 50, message: '初始化世界数据中', stage: 'game_init' },
    });
  });

  it('② abortSignal 经 reqCtx 透传到 ToolContext', async () => {
    const agent = createGameMasterRuntime();
    const view = asTestView(agent);
    const signal: ToolAbortSignal = { aborted: false };

    let capturedContext: ToolContext | undefined;
    view.toolRegistry = {
      execute: vi.fn(
        async (
          _agentType: string,
          _toolType: string,
          _method: string,
          _params: Record<string, unknown>,
          context: ToolContext,
        ): Promise<ToolResponse> => {
          capturedContext = context;
          return { success: true, data: { ok: true } };
        },
      ),
    };

    await agent.callTool('map_service', 'describe_area', {}, 'save-1' as ID, buildReqCtx({ abortSignal: signal }));

    expect(capturedContext?.abortSignal).toBe(signal);
  });

  it('③ reqCtx.abortSignal 缺省 → ToolContext.abortSignal undefined（降级合法）', async () => {
    const agent = createGameMasterRuntime();
    const view = asTestView(agent);

    let capturedContext: ToolContext | undefined;
    view.toolRegistry = {
      execute: vi.fn(
        async (
          _agentType: string,
          _toolType: string,
          _method: string,
          _params: Record<string, unknown>,
          context: ToolContext,
        ): Promise<ToolResponse> => {
          capturedContext = context;
          return { success: true, data: { ok: true } };
        },
      ),
    };

    await agent.callTool('map_service', 'describe_area', {}, 'save-1' as ID, buildReqCtx());

    expect(capturedContext?.abortSignal).toBeUndefined();
    // onUpdate 始终接线（与 abortSignal 缺省降级独立）
    expect(capturedContext?.onUpdate).toBeDefined();
  });
});

describe('BaseAgent.callTool 基类组装点（M6 §7.6.1 命名接线位）', () => {
  class ProgressRecordingAgent extends BaseAgent {
    public recorded: Array<{ toolType: string; method: string; progress: ToolProgress }> = [];

    async processMessage(_message: AgentMessage): Promise<AgentResponse> {
      return { success: true, data: { ok: true } };
    }

    async callLLM(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
      return { success: true, content: 'ok' };
    }

    protected override reportToolProgress(toolType: string, method: string, progress: ToolProgress): void {
      this.recorded.push({ toolType, method, progress });
    }
  }

  it('④ 基类组装点填充 onUpdate/abortSignal，onUpdate 桥接到达 reportToolProgress', async () => {
    const agent = new ProgressRecordingAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });
    const signal: ToolAbortSignal = { aborted: false };

    let capturedContext: ToolContext | undefined;
    const view = agent as unknown as AgentRuntimeTestView;
    view.toolRegistry = {
      execute: vi.fn(
        async (
          _agentType: string,
          _toolType: string,
          _method: string,
          _params: Record<string, unknown>,
          context: ToolContext,
        ): Promise<ToolResponse> => {
          capturedContext = context;
          context.onUpdate?.({ message: '处理 1/3 项' });
          return { success: true, data: { ok: true } };
        },
      ),
    };

    const result = await agent.callTool(
      'event_service',
      'get_event_snapshot',
      {},
      'save-1' as ID,
      buildReqCtx({ abortSignal: signal }),
    );

    expect(result.success).toBe(true);
    expect(capturedContext?.abortSignal).toBe(signal);
    expect(agent.recorded).toEqual([
      { toolType: 'event_service', method: 'get_event_snapshot', progress: { message: '处理 1/3 项' } },
    ]);
  });
});
