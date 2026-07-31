import { describe, expect, it } from 'vitest';
import type { AgentRuntimeSnapshot } from '../agent-runtime-snapshot.js';
import { deriveChildRuntimeSnapshot } from '../derive-child-runtime-snapshot.js';

function createParentSnapshot(overrides: Partial<AgentRuntimeSnapshot> = {}): AgentRuntimeSnapshot {
  return {
    requestId: 'req-parent',
    sessionId: 'save-1',
    agentKey: 'gamemaster',
    createdAt: Date.now(),
    modelSnapshot: {
      providerId: null,
      model: null,
      temperature: 0.7,
      maxTokens: 4096,
    },
    permissionSnapshot: {
      configuredTools: ['map_service', 'combat_service', 'help_service'],
      defaultDeny: true,
    },
    ruleSnapshot: [],
    skillSnapshot: [],
    helpSnapshot: [],
    toolVisibilitySnapshot: {
      allowedToolTypes: ['map_service', 'combat_service', 'help_service'],
      allowedFunctionNames: [
        'map_service__get_current_top_location',
        'map_service__move_to',
        'combat_service__execute_turn',
        'help_service__get_tool_help_detail',
      ],
      deferredFunctionNames: ['combat_service__flee'],
      toolExposureBudget: {
        maxVisibleTools: 3,
        usedVisibleTools: 2,
        maxVisibleHelpDocs: 2,
        usedVisibleHelpDocs: 1,
        maxToolSummaryTokens: 500,
        usedToolSummaryTokens: 100,
        maxHelpSummaryTokens: 200,
        usedHelpSummaryTokens: 50,
        maxOnDemandLoadsPerTurn: 2,
        usedOnDemandLoads: 0,
      },
    },
    promptSnapshot: {
      systemPrompt: 'system',
      userPrompt: 'user',
    },
    contextSnapshot: {
      language: 'zh-CN',
      templateId: null,
    },
    debugSnapshot: {
      source: 'test',
    },
    ...overrides,
  };
}

describe('deriveChildRuntimeSnapshot', () => {
  it('应将 deferredFunctionNames 按子 Agent 可见工具过滤后传播', () => {
    const parent = createParentSnapshot();
    const child = deriveChildRuntimeSnapshot(parent, {
      agentKey: 'challenge',
      configuredTools: ['combat_service', 'help_service'],
    });

    expect(child).not.toBeNull();
    expect(child!.toolVisibilitySnapshot.deferredFunctionNames).toEqual(['combat_service__flee']);
  });

  it('应将 toolExposureBudget 完整传播到子 Agent 快照', () => {
    const parent = createParentSnapshot();
    const child = deriveChildRuntimeSnapshot(parent, {
      agentKey: 'challenge',
      configuredTools: ['combat_service', 'help_service'],
    });

    expect(child).not.toBeNull();
    expect(child!.toolVisibilitySnapshot.toolExposureBudget).toEqual({
      maxVisibleTools: 3,
      usedVisibleTools: 2,
      maxVisibleHelpDocs: 2,
      usedVisibleHelpDocs: 1,
      maxToolSummaryTokens: 500,
      usedToolSummaryTokens: 100,
      maxHelpSummaryTokens: 200,
      usedHelpSummaryTokens: 50,
      maxOnDemandLoadsPerTurn: 2,
      usedOnDemandLoads: 0,
    });
  });

  it('父快照无 deferredFunctionNames 时应返回空数组', () => {
    const parent = createParentSnapshot({
      toolVisibilitySnapshot: {
        allowedToolTypes: ['map_service'],
        allowedFunctionNames: ['map_service__move_to'],
      },
    });
    const child = deriveChildRuntimeSnapshot(parent, {
      agentKey: 'map',
      configuredTools: ['map_service'],
    });

    expect(child).not.toBeNull();
    expect(child!.toolVisibilitySnapshot.deferredFunctionNames).toEqual([]);
  });

  it('应按子 Agent 可见工具过滤 allowedFunctionNames', () => {
    const parent = createParentSnapshot();
    const child = deriveChildRuntimeSnapshot(parent, {
      agentKey: 'map',
      configuredTools: ['map_service', 'help_service'],
    });

    expect(child).not.toBeNull();
    expect(child!.toolVisibilitySnapshot.allowedFunctionNames).toEqual([
      'map_service__get_current_top_location',
      'map_service__move_to',
      'help_service__get_tool_help_detail',
    ]);
  });
});
