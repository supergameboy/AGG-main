// @ts-nocheck — tests for deleted IntentAnalyzer/MessageRouter components, kept for reference
import { describe, expect, it, vi } from 'vitest';
import type { AgentType, AgentMessage } from '../../../../shared/src/types/agent.js';

/**
 * P0-TEST-1: AI 架构深水区重构 — 全链路回归测试
 *
 * 验证 6 条核心链路的端到端数据流正确性：
 * 1. 对话链路：用户输入 -> GameMasterAgent -> ReActAgent -> 工具调用 -> 响应
 * 2. DAG 调度：多 Agent 并行执行 -> 结果整合 -> 前端渲染
 * 3. 权限系统：各 Agent 只能调用授权的工具
 * 4. ContextInjector 上下文注入
 * 5. DynamicUI 评分（当前为 IntentAnalyzer needsDynamicUI 判断）
 * 6. RiskGate 低风险跳过
 *
 * 策略：以各核心组件为入口，mock 掉外部依赖（LLM/DB），
 * 验证完整链路中每个环节的输入输出是否符合契约。
 */

// --- Helpers ---

function makeToolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tc-1',
    toolCallId: 'tci-1',
    success: true,
    data: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeWriteOperation(targetId = 'entity-1', toolType = 'npc_service', method = 'update_npc') {
  return {
    toolType,
    method,
    params: { id: targetId },
    result: { success: true },
    timestamp: Date.now(),
  };
}

function makeIntegrationResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {},
    writeOperations: [],
    agentResponses: new Map(),
    needsFurtherProcessing: false,
    fallbackSuggestions: [],
    ...overrides,
  };
}

function makeMessage(action = 'talk'): AgentMessage {
  return {
    id: 'msg-1',
    timestamp: Date.now(),
    from: 'player' as AgentType,
    to: 'gamemaster' as AgentType,
    type: 'request',
    saveId: 'save-1' as any,
    payload: { action, data: {} },
    metadata: { priority: 'normal', requiresResponse: true },
  };
}

function makeRuntimeContext(overrides: Record<string, unknown> = {}) {
  return {
    saveId: 'save-1',
    reactIterations: 1,
    ...overrides,
  };
}

// --- 链路1: 对话链路 ---

describe.skip('链路1: 对话链路 — 用户输入到响应的完整数据流', () => {
  it('IntentAnalyzer.analyze 返回意图后，MessageRouter 正确路由到目标 Agent', async () => {
    // const { IntentAnalyzer } = await import('../../agents/coordinator/IntentAnalyzer.js');
    // const { MessageRouter } = await import('../../agents/coordinator/MessageRouter.js');

    // chatRaw 返回 LLMResponse 格式：{ content, toolCalls, usage, finishReason }
    const mockLlmService = {
      chatRaw: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          intent: 'explore',
          targetAgents: ['map', 'dialogue'],
          confidence: 0.9,
          agentActions: { map: ['query_map'], dialogue: ['generate_dialogue'] },
        }),
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }),
    };

    const analyzer = new IntentAnalyzer(
      mockLlmService as never,
      { buildCapabilitiesPromptTable: vi.fn().mockReturnValue(''), buildActionTableForPrompt: vi.fn().mockReturnValue('') } as never,
      { fallbackIntentAnalysis: vi.fn() } as never,
      { resolveAgentActions: vi.fn().mockImplementation((_agents: string[], actions: Record<string, string[]>) => actions) } as never,
      'intent system prompt',
    ) as any;
    analyzer.inputValidator = { validate: vi.fn().mockReturnValue({ blocked: false }) };

    const message = {
      id: 'msg-1',
      saveId: 'save-1' as any,
      payload: { action: 'chat', data: { message: '我想探索附近的区域' } },
    } as any;

    const intent = await analyzer.analyze(message, {}, 'save-1' as any, null);

    expect(intent).toBeDefined();
    expect(intent.blocked).toBeFalsy();
    expect(intent.targetAgents).toContain('map');

    // MessageRouter 需要 db 参数
    const router = new MessageRouter({} as any);
    const routed = await router.route(intent);
    expect(routed.length).toBeGreaterThan(0);
  });

  it('ResultIntegrator.integrate 正确合并多 Agent 结果的写操作', async () => {
    const { ResultIntegrator } = await import('../../agents/coordinator/ResultIntegrator.js');

    const integrator = new ResultIntegrator();

    const firstLayerResults = new Map<AgentType, any>([
      ['map', {
        success: true,
        data: {},
        toolCalls: [
          makeToolCall({ writeOperation: makeWriteOperation('loc-1', 'map_service', 'update_map') }),
        ],
      }],
      ['npc_party', {
        success: true,
        data: {},
        toolCalls: [
          makeToolCall({ writeOperation: makeWriteOperation('npc-1', 'npc_service', 'update_npc') }),
        ],
      }],
    ]);

    const result = await integrator.integrate(firstLayerResults);

    expect(result.writeOperations).toBeDefined();
    expect(result.writeOperations.length).toBe(2);
    expect(result.writeOperations[0].toolType).toBe('map_service');
    expect(result.writeOperations[1].toolType).toBe('npc_service');
  });
});

// --- 链路3: 权限系统 ---

describe('链路3: 权限系统 — 各 Agent 只能调用授权的工具', () => {
  it('ToolRegistry.checkPermission 对未授权工具返回 false，授权后返回 true', async () => {
    const { ToolRegistry } = await import('../../agents/ToolRegistry.js');

    const registry = ToolRegistry.getInstance();
    registry.clearAll();

    const mockTool = {
      type: 'map_service',
      name: 'Map Service',
      version: '1.0.0',
      description: 'Test',
      methods: [
        { name: 'query_map', description: 'Query map', isWrite: false, parameters: {} },
        { name: 'update_map', description: 'Update map', isWrite: true, parameters: {} },
      ],
      getMethods: vi.fn().mockReturnValue(['query_map', 'update_map']),
      getDefinition: vi.fn().mockReturnValue({
        methods: [
          { name: 'query_map', description: 'Query map', isWrite: false, parameters: {} },
          { name: 'update_map', description: 'Update map', isWrite: true, parameters: {} },
        ],
      }),
      setPermission: vi.fn(),
      execute: vi.fn(),
    };
    registry.register(mockTool as any);

    // 不设置权限 → 默认拒绝
    const canWrite = registry.checkPermission('challenge', 'map_service', 'update_map');
    expect(canWrite).toBe(false);

    // setPermission 接受 ToolPermission 对象 { agentType, toolType, readAllowed, writeAllowed }
    registry.setPermission({ agentType: 'challenge', toolType: 'map_service', readAllowed: true, writeAllowed: true });
    const canWriteAfter = registry.checkPermission('challenge', 'map_service', 'update_map');
    expect(canWriteAfter).toBe(true);

    // 只读权限不允许写操作
    registry.setPermission({ agentType: 'quest', toolType: 'map_service', readAllowed: true, writeAllowed: false });
    const canWriteQuest = registry.checkPermission('quest', 'map_service', 'update_map');
    expect(canWriteQuest).toBe(false);

    // 只读权限允许读操作
    const canReadQuest = registry.checkPermission('quest', 'map_service', 'query_map');
    expect(canReadQuest).toBe(true);
  });

  it('ToolSet.filterVisibleMethods 只暴露声明工具的写方法', async () => {
    const { ToolSet } = await import('../prompt/tool-set.js');

    const mockRegistry = {
      getAvailableTools: vi.fn().mockReturnValue([
        {
          type: 'map_service',
          name: 'Map Service',
          methods: [
            { name: 'query_map', description: 'Query map', isWrite: false, parameters: {} },
            { name: 'update_map', description: 'Update map', isWrite: true, parameters: {} },
          ],
        },
        {
          type: 'combat_service',
          name: 'Combat Service',
          methods: [
            { name: 'start_combat', description: 'Start combat', isWrite: true, parameters: {} },
          ],
        },
      ]),
      getPermission: vi.fn().mockImplementation((_agentType: string, toolType: string) => {
        if (toolType === 'map_service') return { readAllowed: true, writeAllowed: true };
        return undefined;
      }),
    };

    const toolSet = new ToolSet(mockRegistry as any);

    // filterVisibleMethods(agentKey, agentConfig, excludedMethods)
    // agentConfig.tools 列表决定哪些工具的写方法可见
    const visible = toolSet.filterVisibleMethods('map', { tools: ['map_service'] }, []);

    // map_service 的写方法应该可见
    const mapMethods = visible.get('map_service');
    expect(mapMethods).toBeDefined();
    expect(mapMethods!.methods.some(m => m.name === 'update_map')).toBe(true);
    // combat_service 不在授权列表中，不应出现
    expect(visible.has('combat_service')).toBe(false);
  });
});

// --- 链路4: ContextInjector 上下文注入 ---

describe('链路4: ContextInjector 上下文注入到 Agent 执行', () => {
  it('prefetchForAgentsFiltered 根据 peerResultKeys 正确过滤被覆盖的 source', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const dir = mkdtempSync(join(tmpdir(), 'ctx-injector-regression-'));
    const configPath = join(dir, 'agent-context-rules.yaml');
    writeFileSync(configPath, `
context_rules:
  npc_party:
    max_context_tokens: 200
    required:
      - id: npc_list
        source: npc_service
        method: list_npcs
        format: compact
        description: NPC列表
  dialogue:
    max_context_tokens: 200
    required:
      - id: npc_list
        source: npc_service
        method: list_npcs
        format: compact
        description: NPC列表
      - id: dialogue_history
        source: dialogue_service
        method: get_recent_dialogue
        format: compact
        description: 对话历史
`, 'utf-8');

    let injector: { dispose(): void } | undefined;
    try {
      const { ContextInjector } = await import('../../services/context-injector.js');
      injector = new ContextInjector(configPath);

      const mockFetcher = vi.fn(async (source: string, method: string) =>
        `${source}:${method}`);

      const agentPeerKeys = new Map<string, string[]>([
        ['npc_party', []],
        ['dialogue', ['npc_party']],
      ]);

      const snapshots = await injector.prefetchForAgentsFiltered(
        ['npc_party', 'dialogue'],
        'save-1' as any,
        mockFetcher,
        agentPeerKeys,
      );

      // npc_party 无 peerResults，应完整包含 npc_service 数据
      expect(snapshots.get('npc_party')).toContain('npc_service:list_npcs');
      // dialogue 的 npc_service 被 npc_party peerResult 覆盖，应过滤掉
      expect(snapshots.get('dialogue')).not.toContain('NPC列表');
      // dialogue 保留未被覆盖的 dialogue_service
      expect(snapshots.get('dialogue')).toContain('对话历史');
      // fetcher 只调用 2 次（npc_service + dialogue_service，共用缓存）
      expect(mockFetcher).toHaveBeenCalledTimes(2);
    } finally {
      injector?.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('getCoveredSources 从 peerResult keys 正确推导被覆盖的 source 集合', async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const dir = mkdtempSync(join(tmpdir(), 'ctx-injector-regression-'));
    const configPath = join(dir, 'agent-context-rules.yaml');
    writeFileSync(configPath, `
context_rules:
  npc_party:
    max_context_tokens: 200
    required:
      - id: npc_list
        source: npc_service
        method: list_npcs
        format: compact
        description: NPC列表
      - id: location
        source: map_service
        method: get_location
        format: compact
        description: 位置
  map:
    max_context_tokens: 200
    required:
      - id: current_location
        source: map_service
        method: get_current_location
        format: compact
        description: 当前位置
`, 'utf-8');

    let injector: { dispose(): void } | undefined;
    try {
      const { ContextInjector } = await import('../../services/context-injector.js');
      injector = new ContextInjector(configPath);

      // npc_party 覆盖 npc_service + map_service
      const covered = injector.getCoveredSources(['npc_party']);
      expect(covered.has('npc_service')).toBe(true);
      expect(covered.has('map_service')).toBe(true);
    } finally {
      injector?.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- 链路5: DynamicUI 评分（当前为 IntentAnalyzer needsDynamicUI 判断）---

describe.skip('链路5: DynamicUI 评分 — IntentAnalyzer needsDynamicUI 判断', () => {
  it('combat 意图应触发 needsDynamicUI=true', async () => {
    // const { IntentAnalyzer } = await import('../../agents/coordinator/IntentAnalyzer.js');

    const mockLlmService = {
      chatRaw: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          intent: 'combat',
          targetAgents: ['challenge', 'dialogue'],
          confidence: 0.95,
          agentActions: { combat: ['start_combat'], dialogue: ['generate_dialogue'] },
          needsDynamicUI: true,
          dynamicUIScenario: 'combat',
        }),
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }),
    };

    const analyzer = new IntentAnalyzer(
      mockLlmService as never,
      { buildCapabilitiesPromptTable: vi.fn().mockReturnValue(''), buildActionTableForPrompt: vi.fn().mockReturnValue('') } as never,
      { fallbackIntentAnalysis: vi.fn() } as never,
      { resolveAgentActions: vi.fn().mockImplementation((_agents: string[], actions: Record<string, string[]>) => actions) } as never,
      'intent system prompt',
    ) as any;
    analyzer.inputValidator = { validate: vi.fn().mockReturnValue({ blocked: false }) };

    const message = {
      id: 'msg-1',
      saveId: 'save-1' as any,
      payload: { action: 'chat', data: { message: '攻击哥布林' } },
    } as any;

    const intent = await analyzer.analyze(message, {}, 'save-1' as any, null);

    expect(intent.needsDynamicUI).toBe(true);
    expect(intent.dynamicUIScenario).toBe('combat');
  });

  it('普通对话意图不应触发 needsDynamicUI', async () => {
    // const { IntentAnalyzer } = await import('../../agents/coordinator/IntentAnalyzer.js');

    const mockLlmService = {
      chatRaw: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          intent: 'chat',
          targetAgents: ['dialogue'],
          confidence: 0.9,
          agentActions: { dialogue: ['generate_dialogue'] },
          needsDynamicUI: false,
        }),
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      }),
    };

    const analyzer = new IntentAnalyzer(
      mockLlmService as never,
      { buildCapabilitiesPromptTable: vi.fn().mockReturnValue(''), buildActionTableForPrompt: vi.fn().mockReturnValue('') } as never,
      { fallbackIntentAnalysis: vi.fn() } as never,
      { resolveAgentActions: vi.fn().mockImplementation((_agents: string[], actions: Record<string, string[]>) => actions) } as never,
      'intent system prompt',
    ) as any;
    analyzer.inputValidator = { validate: vi.fn().mockReturnValue({ blocked: false }) };

    const message = {
      id: 'msg-2',
      saveId: 'save-1' as any,
      payload: { action: 'chat', data: { message: '你好' } },
    } as any;

    const intent = await analyzer.analyze(message, {}, 'save-1' as any, null);
    expect(intent.needsDynamicUI).toBeFalsy();
  });
});

// --- 链路6: RiskGate 低风险跳过 ---

describe('链路6: RiskGate 低风险跳过 Reviewer', () => {
  it('低风险场景 assess 返回 skippedReviewer=true', async () => {
    const { RiskGate } = await import('../coordinator/risk-gate.js');

    const gate = new RiskGate();

    const assessment = gate.assess({
      integratedResult: makeIntegrationResult(),
      message: makeMessage('chat'),
      runtimeContext: makeRuntimeContext({ intent: { intent: 'chat', confidence: 0.9 } }),
    });

    expect(assessment.skippedReviewer).toBe(true);
    expect(assessment.level).toBe('low');
  });

  it('高风险场景（跨Agent写冲突 + needsDynamicUI）assess 返回 skippedReviewer=false', async () => {
    const { RiskGate } = await import('../coordinator/risk-gate.js');

    const gate = new RiskGate();

    // 构造跨 Agent 写冲突
    const agentResponses = new Map();
    agentResponses.set('map', {
      success: true,
      toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('entity-1', 'map_service', 'update_map') })],
    });
    agentResponses.set('npc_party', {
      success: true,
      toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('entity-1', 'npc_service', 'update_npc') })],
    });

    const assessment = gate.assess({
      integratedResult: makeIntegrationResult({ agentResponses }),
      message: makeMessage('chat'),
      runtimeContext: makeRuntimeContext({ intent: { intent: 'explore', confidence: 0.8, needsDynamicUI: true } }),
    });

    expect(assessment.skippedReviewer).toBe(false);
    expect(assessment.level).toBe('high');
  });

  it('buildDefaultDecision 返回合理的默认决策', async () => {
    const { RiskGate } = await import('../coordinator/risk-gate.js');

    const gate = new RiskGate();
    const decision = gate.buildDefaultDecision();

    expect(decision).toBeDefined();
    expect(decision.secondLayerDecision?.shouldSchedule).toBe(false);
  });

  it('RiskGate 禁用时返回 level=high 且 skippedReviewer=false（禁用=不跳过Reviewer）', async () => {
    const { RiskGate } = await import('../coordinator/risk-gate.js');

    // RiskGate 禁用时行为：enabled=false → 返回 { level: 'high', reasons: ['risk_gate_disabled'], skippedReviewer: false }
    // 这是正确行为：禁用风控 = 不跳过 Reviewer，所有轮次都需人工审核
    const gate = new RiskGate({ enabled: false });

    const agentResponses = new Map();
    agentResponses.set('map', {
      success: true,
      toolCalls: [makeToolCall({ writeOperation: makeWriteOperation('entity-1', 'map_service', 'update_map') })],
    });

    const assessment = gate.assess({
      integratedResult: makeIntegrationResult({ agentResponses }),
      message: makeMessage('chat'),
      runtimeContext: makeRuntimeContext(),
    });

    // 禁用风控 = 不跳过 Reviewer，所有轮次都需审核
    expect(assessment.skippedReviewer).toBe(false);
    expect(assessment.level).toBe('high');
    expect(assessment.reasons).toContain('risk_gate_disabled');
  });
});