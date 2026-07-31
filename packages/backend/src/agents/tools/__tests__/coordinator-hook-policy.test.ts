import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentType, LLMMessage, ToolType } from '../../../../../shared/src/types/agent.js';
import type { AgentHookPoliciesConfig } from '../../../../../shared/src/types/agent-config.js';
import type { ID, Timestamp } from '../../../../../shared/src/types/core.js';
import { BaseAgent } from '../../BaseAgent.js';
import type { AgentResponse, LLMOptions, LLMResponse } from '../../types.js';
import type { ToolContext } from '@ai-rpg/shared/types/tool';
import { CoordinatorServiceTool } from '../coordinator-service.js';
import { RequestScope } from '../../../services/RequestScope.js';
import type { Knex } from 'knex';

class HookPolicyAgent extends BaseAgent {
  private hookPolicies?: AgentHookPoliciesConfig;

  constructor(
    config: { type: AgentType; name: string; systemPrompt: string },
    initialHookPolicies: AgentHookPoliciesConfig | undefined,
    private readonly capturedPolicies: Array<AgentHookPoliciesConfig | undefined>,
  ) {
    super(config);
    this.hookPolicies = initialHookPolicies ? structuredClone(initialHookPolicies) : undefined;
  }

  // 模拟 AgentRuntime 在生产环境的行为：parentAgent（gamemaster）允许 spawn 子 Agent
  // BaseAgent 默认 canSpawnAgent=false 是冗余防线，真实 AgentRuntime 按 isSubAgent override
  override get canSpawnAgent(): boolean {
    return true;
  }

  override get configuredTools(): string[] {
    return ['event_service'];
  }

  getHookPolicies(): AgentHookPoliciesConfig | undefined {
    return this.hookPolicies ? structuredClone(this.hookPolicies) : undefined;
  }

  applyHookPolicies(policies?: AgentHookPoliciesConfig): void {
    this.hookPolicies = policies ? structuredClone(policies) : undefined;
  }

  async processMessage(_message: AgentMessage): Promise<AgentResponse> {
    this.capturedPolicies.push(this.getHookPolicies());
    return { success: true, data: { ok: true } };
  }

  async callLLM(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
    return { success: true, content: 'ok' };
  }
}

function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    saveId: 'save-1' as ID,
    agentType: 'gamemaster',
    timestamp: Date.now() as Timestamp,
    requestScope: new RequestScope({} as unknown as Knex),
    ...overrides,
  };
}

describe('CoordinatorServiceTool hook policy inheritance', () => {
  it('spawn_agent 应继承父Agent策略并应用 child hookPolicies 裁剪', async () => {
    const capturedPolicies: Array<AgentHookPoliciesConfig | undefined> = [];
    const parentAgent = new HookPolicyAgent({
      type: 'gamemaster' as AgentType,
      name: 'GameMaster',
      systemPrompt: 'gm prompt',
    }, {
      disable: ['after_compaction'],
      recovery: {
        enableReadonlyDegrade: true,
        enableFallbackAgent: true,
        maxAttempts: 2,
      },
    }, []);
    const childAgent = new HookPolicyAgent({
      type: 'event' as AgentType,
      name: 'Event Agent',
      systemPrompt: 'event prompt',
    }, {
      disable: ['before_compaction'],
      recovery: {
        enableFallbackAgent: false,
      },
    }, capturedPolicies);

    const tool = new CoordinatorServiceTool({
      injectForAgentDetailed: async () => ({
        context: null,
        injectedMethods: [],
      }),
    } as never);
    tool.setPermission({
      toolType: 'coordinator_service' as ToolType,
      agentType: 'gamemaster',
      readAllowed: true,
      writeAllowed: true,
    });
    tool.setAgentRegistry(new Map([
      ['gamemaster' as AgentType, parentAgent],
      ['event' as AgentType, childAgent],
    ]));

    const response = await tool.execute('spawn_agent', {
      agent_type: 'event',
      task: 'check event flow',
    }, createToolContext());

    expect(response.success).toBe(true);
    expect(capturedPolicies).toEqual([{
      disable: ['after_compaction', 'before_compaction'],
      recovery: {
        enableReadonlyDegrade: true,
        enableFallbackAgent: false,
        maxAttempts: 2,
      },
    }]);
  });
});
