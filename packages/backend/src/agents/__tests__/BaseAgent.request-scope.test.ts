import { describe, expect, it, vi } from 'vitest';
import { BaseAgent } from '../BaseAgent.js';
import type { AgentMessage, AgentType, LLMMessage } from '../../../../shared/src/types/agent.js';
import type { ID } from '../../../../shared/src/types/core.js';
import type { AgentResponse, LLMOptions, LLMResponse } from '../types.js';
import { StagingPool } from '../../services/StagingPool.js';
import type { AgentRuntimeSnapshot } from '../runtime/agent-runtime-snapshot.js';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import { RequestScope } from '../../services/RequestScope.js';
import type { Knex } from 'knex';

// AP-L1: StagingPool 构造函数注入 IDevTraceHook，测试提供最小 mock
const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

class TestAgent extends BaseAgent {
  async processMessage(_message: AgentMessage): Promise<AgentResponse> {
    return { success: true, data: { ok: true } };
  }

  async callLLM(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
    return { success: true, content: 'ok' };
  }

  setContextState(key: string, value: string): void {
    this.context.state[key] = value;
  }

  getContextState(key: string): string | undefined {
    return this.context.state[key] as string | undefined;
  }
}

function createRuntimeSnapshot(overrides: Partial<AgentRuntimeSnapshot> = {}): AgentRuntimeSnapshot {
  return {
    requestId: 'req-1',
    sessionId: 'save-1',
    agentKey: 'dialogue',
    createdAt: 1,
    modelSnapshot: {
      providerId: 'openai',
      model: 'gpt-test',
      temperature: 0.2,
      maxTokens: 1024,
    },
    permissionSnapshot: {
      configuredTools: ['event_service', 'map_service'],
      defaultDeny: true,
    },
    ruleSnapshot: [
      { name: 'always-rule', source: 'alwaysApply' },
    ],
    skillSnapshot: [
      { name: 'story-skill', source: 'matched' },
    ],
    helpSnapshot: [
      { tool: 'event_service', method: 'get_event_snapshot' },
    ],
    toolVisibilitySnapshot: {
      allowedToolTypes: ['event_service'],
      allowedFunctionNames: ['event_service__get_event_snapshot'],
    },
    promptSnapshot: {
      systemPrompt: 'system snapshot',
      userPrompt: 'user snapshot',
    },
    contextSnapshot: {
      language: 'zh-CN',
      templateId: 'template-1',
    },
    debugSnapshot: {
      source: 'unit-test',
    },
    ...overrides,
  };
}

describe('BaseAgent request-scoped copy', () => {
  it('应创建请求级副本并隔离 prompt 与上下文状态', () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });
    agent.setContextState('shared', 'origin');
    agent.currentLanguage = 'zh-CN';

    const scoped = agent.createRequestScopedCopy() as TestAgent;
    scoped.systemPrompt = 'scoped prompt';
    scoped.setContextState('shared', 'scoped');
    scoped.currentLanguage = 'en-US';

    expect(agent.systemPrompt).toBe('base prompt');
    expect(agent.currentLanguage).toBe('zh-CN');
    expect(agent.getContextState('shared')).toBe('origin');

    expect(scoped.systemPrompt).toBe('scoped prompt');
    expect(scoped.currentLanguage).toBe('en-US');
    expect(scoped.getContextState('shared')).toBe('scoped');
  });

  it('请求级副本应复制所有请求级属性', () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });

    agent.currentLanguage = 'ja-JP';
    agent.currentInjectedContext = 'injected context data';
    agent.currentTemplateContext = 'world setting context';
    agent.currentSpecialRules = { has_kp: true };
    agent.currentStoryDirective = { storyGoal: 'test goal' };
    agent.currentPostReviewDecision = { taskReview: { completion: 'complete' } };

    const scoped = agent.createRequestScopedCopy() as TestAgent;

    expect(scoped.currentLanguage).toBe('ja-JP');
    expect(scoped.currentInjectedContext).toBe('injected context data');
    expect(scoped.currentTemplateContext).toBe('world setting context');
    expect(scoped.currentSpecialRules).toEqual({ has_kp: true });
    expect(scoped.currentStoryDirective).toEqual({ storyGoal: 'test goal' });
    expect(scoped.currentPostReviewDecision).toEqual({ taskReview: { completion: 'complete' } });
  });

  it('修改副本不应影响原始实例的上下文', () => {
    const agent = new TestAgent({
      type: 'challenge' as AgentType,
      name: 'Combat Agent',
      systemPrompt: 'combat base',
    });

    const scoped = agent.createRequestScopedCopy() as TestAgent;
    scoped.setContextState('battleState', 'active');

    expect(agent.getContextState('battleState')).toBeUndefined();
    expect(scoped.getContextState('battleState')).toBe('active');
  });

  it('修改副本的嵌套请求态对象不应回写原始实例', () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });

    agent.currentSpecialRules = { nested: { enabled: true } };
    agent.currentStoryDirective = { todoList: [{ id: 'story-1', status: 'pending' }] };
    agent.currentPostReviewDecision = { taskReview: { completion: 'pending' } };

    const scoped = agent.createRequestScopedCopy() as TestAgent;
    (scoped.currentSpecialRules as { nested: { enabled: boolean } }).nested.enabled = false;
    ((scoped.currentStoryDirective as { todoList: Array<{ status: string }> }).todoList[0]).status = 'done';
    ((scoped.currentPostReviewDecision as { taskReview: { completion: string } }).taskReview).completion = 'complete';

    expect((agent.currentSpecialRules as { nested: { enabled: boolean } }).nested.enabled).toBe(true);
    expect((agent.currentStoryDirective as { todoList: Array<{ status: string }> }).todoList[0].status).toBe('pending');
    expect((agent.currentPostReviewDecision as { taskReview: { completion: string } }).taskReview.completion).toBe('pending');
  });

  it('兄弟请求副本的注入方法数组应相互隔离', () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });

    agent.currentInjectedMethods = [{ source: 'base', method: 'scan' }];

    const scopedA = agent.createRequestScopedCopy() as TestAgent;
    const scopedB = agent.createRequestScopedCopy() as TestAgent;

    scopedA.currentInjectedMethods.push({ source: 'a', method: 'alpha' });
    scopedB.currentInjectedMethods.push({ source: 'b', method: 'beta' });

    expect(agent.currentInjectedMethods).toEqual([{ source: 'base', method: 'scan' }]);
    expect(scopedA.currentInjectedMethods).toEqual([
      { source: 'base', method: 'scan' },
      { source: 'a', method: 'alpha' },
    ]);
    expect(scopedB.currentInjectedMethods).toEqual([
      { source: 'base', method: 'scan' },
      { source: 'b', method: 'beta' },
    ]);
  });

  it('请求级副本默认不继承运行时资源并支持显式绑定和清空', () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });

    agent.currentStagingPool = new StagingPool(mockDevTraceHook);
    agent.currentStoryDirective = { goal: 'origin' };

    const scoped = agent.createRequestScopedCopy() as TestAgent;

    expect(scoped.currentStagingPool).toBeUndefined();

    const requestStagingPool = new StagingPool(mockDevTraceHook);
    const scopedStoryDirective = { goal: 'scoped' };
    (scoped as TestAgent & {
      applyRequestScope: (runtime: {
        storyDirective?: unknown;
        stagingPool?: StagingPool;
        injectedMethods?: Array<{ source: string; method: string }>;
        templateContext?: string | null;
      }) => void;
    }).applyRequestScope({
      storyDirective: scopedStoryDirective,
      stagingPool: requestStagingPool,
      injectedMethods: [{ source: 'scope', method: 'bind' }],
      templateContext: 'scoped context',
    });

    expect(scoped.currentStagingPool).toBe(requestStagingPool);
    expect(scoped.currentInjectedMethods).toEqual([{ source: 'scope', method: 'bind' }]);
    expect(scoped.currentStoryDirective).toEqual({ goal: 'scoped' });
    expect(scoped.currentTemplateContext).toBe('scoped context');
    expect(agent.currentStoryDirective).toEqual({ goal: 'origin' });

    scopedStoryDirective.goal = 'mutated';
    expect(scoped.currentStoryDirective).toEqual({ goal: 'scoped' });

    (scoped as TestAgent & {
      applyRequestScope: (runtime: {
        storyDirective?: unknown;
        stagingPool?: StagingPool;
        injectedMethods?: Array<{ source: string; method: string }>;
        templateContext?: string | null;
      }) => void;
    }).applyRequestScope({
      storyDirective: null,
      stagingPool: undefined,
      injectedMethods: undefined,
      templateContext: null,
    });

    expect(scoped.currentStoryDirective).toBeNull();
    expect(scoped.currentStagingPool).toBeUndefined();
    expect(scoped.currentInjectedMethods).toEqual([]);
    expect(scoped.currentTemplateContext).toBeNull();
  });

  it('应支持绑定请求级 runtime snapshot 且隔离外部变更', () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });

    const runtimeSnapshot = createRuntimeSnapshot();

    (agent as TestAgent & {
      applyRequestScope: (runtime: {
        runtimeSnapshot?: AgentRuntimeSnapshot | null;
      }) => void;
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).applyRequestScope({
      runtimeSnapshot,
    });

    runtimeSnapshot.toolVisibilitySnapshot.allowedToolTypes.push('inventory_service');
    runtimeSnapshot.contextSnapshot.language = 'en-US';

    expect((agent as TestAgent & {
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).getRuntimeSnapshot()).toEqual(createRuntimeSnapshot());
  });

  it('callTool 应将当前 runtime snapshot 透传给 ToolContext', async () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });
    const runtimeSnapshot = createRuntimeSnapshot();
    let capturedContext: any = null;

    agent.setRuntimeSnapshot(runtimeSnapshot);
    (agent as any).db = {};
    (agent as any).toolRegistry = {
      execute: vi.fn(async (_agentType, _toolType, _method, _params, context) => {
        capturedContext = context;
        return { success: true, data: { ok: true } };
      }),
    };

    await agent.callTool('event_service', 'get_event_snapshot', {}, 'save-1' as ID, { intentHint: 'test', requestScope: new RequestScope({} as unknown as Knex) });

    expect(capturedContext?.runtimeSnapshot).toEqual(createRuntimeSnapshot());
  });

  it('请求级副本应继承 runtime snapshot 的深拷贝而不回写父实例', () => {
    const agent = new TestAgent({
      type: 'dialogue' as AgentType,
      name: 'Test Agent',
      systemPrompt: 'base prompt',
    });

    (agent as TestAgent & {
      applyRequestScope: (runtime: {
        runtimeSnapshot?: AgentRuntimeSnapshot | null;
      }) => void;
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).applyRequestScope({
      runtimeSnapshot: createRuntimeSnapshot(),
    });

    const scoped = agent.createRequestScopedCopy() as TestAgent & {
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    };
    const scopedSnapshot = scoped.getRuntimeSnapshot();

    expect(scopedSnapshot).not.toBeNull();
    if (!scopedSnapshot) {
      return;
    }

    scopedSnapshot.toolVisibilitySnapshot.allowedToolTypes.push('skill_service');
    scopedSnapshot.debugSnapshot.source = 'scoped-copy';

    const parentSnapshot = (agent as TestAgent & {
      getRuntimeSnapshot: () => AgentRuntimeSnapshot | null;
    }).getRuntimeSnapshot();

    expect(parentSnapshot?.toolVisibilitySnapshot.allowedToolTypes).toEqual(['event_service']);
    expect(parentSnapshot?.debugSnapshot.source).toBe('unit-test');
  });
});
