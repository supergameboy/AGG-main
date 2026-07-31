import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryKernel } from '../StoryKernel.js';
import type { StoryKernelRepos } from '../StoryKernel.js';
import type { PacingConfigRow, PacingHistoryRow } from '../../../game-systems/story/types.js';
import type { PacingState, WorldStateSummary } from '../types.js';

/**
 * 创建 StoryKernelRepos mock 对象。
 * S6: StoryKernel 从 db 依赖改为 Repository 端口接口注入，测试 mock 随之迁移。
 *
 * 默认返回空数据（无 config、无 history），模拟首轮场景。
 * 通过 options 注入特定数据以测试不同场景。
 */
function createMockRepos(options?: {
  pacingConfigRow?: PacingConfigRow | null;
  pacingHistoryRows?: PacingHistoryRow[];
}): StoryKernelRepos {
  const configRow = options?.pacingConfigRow ?? null;
  const historyRows = options?.pacingHistoryRows ?? [];
  const maxRound = historyRows.length > 0
    ? historyRows.reduce((m, r) => Math.max(m, r.round_number), 0)
    : 0;
  const lastRecord = historyRows.length > 0 ? historyRows[historyRows.length - 1] : null;

  return {
    pacing: {
      getConfig: vi.fn().mockResolvedValue(configRow),
      getTemplateContextHash: vi.fn().mockResolvedValue(null),
      getUpdatedAt: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    pacingHistory: {
      countSince: vi.fn().mockResolvedValue(0),
      getRecentFactors: vi.fn().mockResolvedValue(historyRows),
      getMaxRoundNumber: vi.fn().mockResolvedValue(maxRound),
      getLast: vi.fn().mockResolvedValue(lastRecord),
      getLastCalculationRound: vi.fn().mockResolvedValue(null),
      getRecent: vi.fn().mockResolvedValue(historyRows),
      insert: vi.fn().mockResolvedValue(undefined),
      getCreatedAtOfLast: vi.fn().mockResolvedValue(null),
      cleanOld: vi.fn().mockResolvedValue(undefined),
    },
    storyEvent: {
      getRecentForNarrative: vi.fn().mockResolvedValue([]),
      countSince: vi.fn().mockResolvedValue(0),
      countBySaveId: vi.fn().mockResolvedValue(0),
    },
    character: {
      getResourceStatus: vi.fn().mockResolvedValue(null),
    },
    quest: {
      getActiveTimeLimitedQuests: vi.fn().mockResolvedValue([]),
      getMainQuestId: vi.fn().mockResolvedValue(null),
    },
    questObjective: {
      getProgressByQuestId: vi.fn().mockResolvedValue([]),
    },
  } as unknown as StoryKernelRepos;
}

function createMockDomain() {
  return {
    getSnapshot: vi.fn().mockResolvedValue({
      context: { agentContext: { state: {} } },
      history: { events: [] },
      chapter: { chapter: '第一章', mainQuest: '主线任务' },
    }),
    saveStoryState: vi.fn().mockResolvedValue(undefined),
    addStoryEvent: vi.fn().mockResolvedValue(undefined),
  };
}

const DEFAULT_WORLD_STATE: WorldStateSummary = {
  nodeCount: 10,
  edgeCount: 5,
  nodesByType: { npc: 3, location: 2, combat_states: 1 },
  edgesByRelation: { HOSTILE_TO: 1, COMBAT: 1, STORY_RELATED: 2 },
};

describe('StoryKernel 节奏引擎', () => {
  describe('isPacingEnabled', () => {
    it('无 repos 和 llmService 时返回 false', () => {
      const kernel = new StoryKernel(createMockDomain());
      expect(kernel.isPacingEnabled()).toBe(false);
    });

    it('有 repos 和 llmService 时返回 true', () => {
      const repos = createMockRepos();
      const llmService = { chat: vi.fn() };
      const kernel = new StoryKernel(createMockDomain(), undefined, repos, llmService as any);
      expect(kernel.isPacingEnabled()).toBe(true);
    });
  });

  describe('computeDeterministicTension', () => {
    it('无战斗时紧张度低', async () => {
      const repos = createMockRepos();
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const state = await kernel.computePacingState(
        'save-1',
        { nodeCount: 5, edgeCount: 2, nodesByType: { npc: 2, location: 2 }, edgesByRelation: {} },
        { context: { agentContext: { state: {} } }, history: { events: [] }, chapter: { chapter: '第一章', mainQuest: '主线' } } as any,
        { chapter: '第一章', mainQuest: '主线' },
      );
      expect(state.currentTension).toBeGreaterThanOrEqual(0);
      expect(state.currentTension).toBeLessThanOrEqual(100);
      expect(state.currentFactors).toBeDefined();
    });

    it('有战斗和威胁时紧张度较高', async () => {
      const repos = createMockRepos();
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const state = await kernel.computePacingState(
        'save-1',
        DEFAULT_WORLD_STATE,
        { context: { agentContext: { state: {} } }, history: { events: [] }, chapter: { chapter: '第一章', mainQuest: '主线' } } as any,
        { chapter: '第一章', mainQuest: '主线' },
      );
      expect(state.currentTension).toBeGreaterThan(0);
    });
  });

  describe('determineStage', () => {
    it('低紧张度为 exposition', async () => {
      const repos = createMockRepos();
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const state = await kernel.computePacingState(
        'save-1',
        { nodeCount: 1, edgeCount: 0, nodesByType: {}, edgesByRelation: {} },
        { context: { agentContext: { state: {} } }, history: { events: [] }, chapter: { chapter: '第一章', mainQuest: '主线' } } as any,
        { chapter: '第一章', mainQuest: '主线' },
      );
      expect(['exposition', 'rising']).toContain(state.currentStage);
    });
  });

  describe('generatePacingConstraints', () => {
    it('生成完整的节奏约束', () => {
      const kernel = new StoryKernel(createMockDomain());
      const pacingState: PacingState = {
        currentTension: 50,
        currentStage: 'rising',
        currentFactors: { combat: 0.3, threat: 0.2, resource: 0.1, info: 0.15, time: 0.1 },
        roundNumber: 5,
        isCalculationRound: true,
        lastCalculationRound: 5,
        config: StoryKernel['DEFAULT_PACING_CONFIG'],
      };
      const constraints = kernel.generatePacingConstraints(pacingState, {
        currentDensity: 2,
        guidance: 'maintain',
        cooldownTypes: [],
      }, {
        deviation: 0.1,
        guidance: 'maintain',
      });
      expect(constraints.tension).toBe(50);
      expect(constraints.stage).toBe('rising');
      expect(constraints.densityGuidance).toBe('maintain');
      expect(constraints.speedGuidance).toBe('maintain');
    });
  });

  describe('reviewPacing', () => {
    it('无历史数据时返回通过', async () => {
      const repos = createMockRepos({ pacingHistoryRows: [] });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const result = await kernel.reviewPacing('save-1', {
        currentTension: 50,
        currentStage: 'rising',
        currentFactors: { combat: 0.3, threat: 0.2, resource: 0.1, info: 0.15, time: 0.1 },
        roundNumber: 5,
        isCalculationRound: true,
        lastCalculationRound: 5,
        config: StoryKernel['DEFAULT_PACING_CONFIG'],
      });
      expect(result.tensionConsistent).toBe(true);
    });
  });

  describe('assessEventDensity', () => {
    it('无历史数据时返回 increase（密度为0，建议增加）', async () => {
      const repos = createMockRepos({ pacingHistoryRows: [] });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const result = await kernel.assessEventDensity('save-1', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(result.currentDensity).toBe(0);
      expect(result.guidance).toBe('increase');
    });
  });

  describe('assessProgressSpeed', () => {
    it('无历史数据时返回 maintain', async () => {
      const repos = createMockRepos({ pacingHistoryRows: [] });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const result = await kernel.assessProgressSpeed('save-1', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(result.guidance).toBe('maintain');
    });
  });

  describe('boundary scenarios', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('LLM修正返回超出±20范围的值时 clamp 到 [deterministic-20, deterministic+20]', async () => {
      const repos = createMockRepos();
      const factors = { combat: 0.5, threat: 0.5, resource: 0, info: 0, time: 0 };

      // 上界：deterministicTension=50, LLM返回100, 应 clamp 到 70
      const llmUpper = { chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ adjustedTension: 100, adjustedDensityGuidance: 'maintain', adjustedSpeedGuidance: 'maintain', reason: 'test' }) }) };
      const kernelUpper = new StoryKernel(createMockDomain(), undefined, repos, llmUpper as any);
      vi.spyOn(kernelUpper as any, 'loadPacingPrompt').mockReturnValue('prompt');
      const resultUpper = await (kernelUpper as any).correctPacingWithLLM(50, 0, 0, factors, [], 'ctx', 'rising', 'maintain', 'maintain', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(resultUpper.adjustedTension).toBe(70);

      // 下界：deterministicTension=50, LLM返回0, 应 clamp 到 30
      const llmLower = { chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ adjustedTension: 0, adjustedDensityGuidance: 'maintain', adjustedSpeedGuidance: 'maintain', reason: 'test' }) }) };
      const kernelLower = new StoryKernel(createMockDomain(), undefined, repos, llmLower as any);
      vi.spyOn(kernelLower as any, 'loadPacingPrompt').mockReturnValue('prompt');
      const resultLower = await (kernelLower as any).correctPacingWithLLM(50, 0, 0, factors, [], 'ctx', 'rising', 'maintain', 'maintain', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(resultLower.adjustedTension).toBe(30);
    });

    it('LLM修正返回非数字时回退到确定性值', async () => {
      const repos = createMockRepos();
      const llmService = { chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ adjustedTension: 'high', adjustedDensityGuidance: 'maintain', adjustedSpeedGuidance: 'maintain', reason: 'test' }) }) };
      const kernel = new StoryKernel(createMockDomain(), undefined, repos, llmService as any);
      vi.spyOn(kernel as any, 'loadPacingPrompt').mockReturnValue('prompt');
      const result = await (kernel as any).correctPacingWithLLM(50, 0, 0, { combat: 0, threat: 0, resource: 0, info: 0, time: 0 }, [], 'ctx', 'exposition', 'maintain', 'maintain', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(result.adjustedTension).toBe(50);
    });

    it('LLM修正返回null时回退到确定性值', async () => {
      const repos = createMockRepos();
      const llmService = { chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ adjustedTension: null, adjustedDensityGuidance: 'maintain', adjustedSpeedGuidance: 'maintain', reason: 'test' }) }) };
      const kernel = new StoryKernel(createMockDomain(), undefined, repos, llmService as any);
      vi.spyOn(kernel as any, 'loadPacingPrompt').mockReturnValue('prompt');
      const result = await (kernel as any).correctPacingWithLLM(50, 0, 0, { combat: 0, threat: 0, resource: 0, info: 0, time: 0 }, [], 'ctx', 'exposition', 'maintain', 'maintain', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(result.adjustedTension).toBe(50);
    });

    it('LLM修正调用失败时回退到确定性值', async () => {
      const repos = createMockRepos();
      const llmService = { chat: vi.fn().mockRejectedValue(new Error('LLM unavailable')) };
      const kernel = new StoryKernel(createMockDomain(), undefined, repos, llmService as any);
      vi.spyOn(kernel as any, 'loadPacingPrompt').mockReturnValue('prompt');
      const result = await (kernel as any).correctPacingWithLLM(50, 0, 0, { combat: 0, threat: 0, resource: 0, info: 0, time: 0 }, [], 'ctx', 'exposition', 'maintain', 'maintain', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(result.adjustedTension).toBe(50);
      expect(result.reason).toContain('LLM correction failed');
    });

    it('pacing_config无记录且LLM生成失败时返回代码默认值', async () => {
      const repos = createMockRepos({ pacingConfigRow: null });
      const llmService = { chat: vi.fn().mockRejectedValue(new Error('LLM failed')) };
      const kernel = new StoryKernel(createMockDomain(), undefined, repos, llmService as any);
      vi.spyOn(kernel as any, 'loadPacingPrompt').mockReturnValue('prompt');
      vi.spyOn(kernel as any, 'applyPacingJsonOverride').mockImplementation((c: unknown) => c);
      const config = await (kernel as any).getOrCreatePacingConfig('save-1', 'test template');
      expect(config.generatedBy).toBe('default');
      expect(config.pacingInterval).toBe(5);
    });

    it('游戏首轮（无历史数据）5维因子中"最近N轮"类指标默认为0', async () => {
      const repos = createMockRepos({ pacingHistoryRows: [] });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const factors = await (kernel as any).collectTensionFactors(
        { nodeCount: 5, edgeCount: 2, nodesByType: { npc: 2, location: 2 }, edgesByRelation: {} },
        { context: { agentContext: { state: {} } }, history: { events: [] }, chapter: { chapter: '第一章', mainQuest: '主线' } } as any,
        'save-1',
      );
      expect(factors.resource).toBe(0);
      expect(factors.time).toBe(0);
    });

    it('紧张度边界值0和100 clamp 到 [0,100]', async () => {
      const repos = createMockRepos();
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const snapshot = { context: { agentContext: { state: {} } }, history: { events: [] }, chapter: { chapter: '第一章', mainQuest: '主线' } } as any;
      const config = StoryKernel['DEFAULT_PACING_CONFIG'];

      const lowResult = await (kernel as any).computeDeterministicTension(
        { nodeCount: 0, edgeCount: 0, nodesByType: {}, edgesByRelation: {} },
        snapshot,
        config,
        'save-1',
      );
      expect(lowResult.tension).toBe(20); // tensionRange [20,80] 钳制

      const highResult = await (kernel as any).computeDeterministicTension(
        { nodeCount: 20, edgeCount: 20, nodesByType: { combat_states: 10, hostile_npc: 5 }, edgesByRelation: { combat: 7, story_event: 5 } },
        snapshot,
        config,
        'save-1',
      );
      expect(highResult.tension).toBeLessThanOrEqual(80); // tensionRange [20,80] 钳制
      expect(highResult.tension).toBeGreaterThanOrEqual(20);
    });

    it('200轮数据清理：超过200轮时清理最旧记录', async () => {
      const repos = createMockRepos();
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      await (kernel as any).cleanOldPacingHistory('save-1');

      // S6: cleanOld 是 Repository 单方法，验证调用参数
      expect(repos.pacingHistory.cleanOld).toHaveBeenCalledWith('save-1', 200);
    });
  });

  describe('reviewPacing 连续高压/低压场景', () => {
    it('连续3+轮高压时标记 tensionConsistent=false', async () => {
      // 构造3轮高压历史（tension > 70）
      const highTensionHistory: PacingHistoryRow[] = [
        { id: 1, save_id: 'save-1', round_number: 3, deterministic_value: 75, llm_adjusted_value: null, adjustment_reason: null, factors: '{}', stage: 'climax', event_count: 2, main_quest_progress: 0.3, is_calculation_round: 1, created_at: Date.now() },
        { id: 2, save_id: 'save-1', round_number: 2, deterministic_value: 78, llm_adjusted_value: null, adjustment_reason: null, factors: '{}', stage: 'climax', event_count: 3, main_quest_progress: 0.2, is_calculation_round: 1, created_at: Date.now() },
        { id: 3, save_id: 'save-1', round_number: 1, deterministic_value: 72, llm_adjusted_value: null, adjustment_reason: null, factors: '{}', stage: 'rising', event_count: 1, main_quest_progress: 0.1, is_calculation_round: 1, created_at: Date.now() },
      ];
      const repos = createMockRepos({ pacingHistoryRows: highTensionHistory });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const result = await kernel.reviewPacing('save-1', {
        currentTension: 76,
        currentStage: 'climax',
        currentFactors: { combat: 0.7, threat: 0.6, resource: 0.1, info: 0.1, time: 0.1 },
        roundNumber: 4,
        isCalculationRound: true,
        lastCalculationRound: 4,
        config: StoryKernel['DEFAULT_PACING_CONFIG'],
      });
      expect(result.tensionConsistent).toBe(false);
    });

    it('连续5+轮低压时标记 tensionConsistent=false', async () => {
      const lowTensionHistory: PacingHistoryRow[] = Array.from({ length: 5 }, (_, i) => ({
        id: i + 1, save_id: 'save-1', round_number: i + 1, deterministic_value: 19, llm_adjusted_value: null, adjustment_reason: null, factors: '{}', stage: 'exposition', event_count: 0, main_quest_progress: 0.05, is_calculation_round: 1, created_at: Date.now(),
      }));
      const repos = createMockRepos({ pacingHistoryRows: lowTensionHistory });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const result = await kernel.reviewPacing('save-1', {
        currentTension: 19,
        currentStage: 'exposition',
        currentFactors: { combat: 0, threat: 0, resource: 0, info: 0, time: 0 },
        roundNumber: 6,
        isCalculationRound: true,
        lastCalculationRound: 6,
        config: StoryKernel['DEFAULT_PACING_CONFIG'],
      });
      expect(result.tensionConsistent).toBe(false);
    });
  });

  describe('assessEventDensity rareBudget 窗口预算', () => {
    it('rareWindow轮内高冲击轮次超过rareBudget时返回decrease', async () => {
      // 构造10轮历史，其中3轮eventCount>=3（超过默认rareBudget=1）
      const history: PacingHistoryRow[] = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, save_id: 'save-1', round_number: i + 1, deterministic_value: 50, llm_adjusted_value: null, adjustment_reason: null, factors: '{}', stage: 'rising', event_count: i % 3 === 0 ? 4 : 1, main_quest_progress: 0.1, is_calculation_round: 1, created_at: Date.now(),
      }));
      const repos = createMockRepos({ pacingHistoryRows: history });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const result = await kernel.assessEventDensity('save-1', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(result.guidance).toBe('decrease');
    });

    it('rareWindow轮内高冲击轮次未超过rareBudget时保持maintain', async () => {
      // 构造10轮历史，仅1轮eventCount>=3（等于默认rareBudget=1，未超过）
      const history: PacingHistoryRow[] = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1, save_id: 'save-1', round_number: i + 1, deterministic_value: 50, llm_adjusted_value: null, adjustment_reason: null, factors: '{}', stage: 'rising', event_count: i === 0 ? 3 : 1, main_quest_progress: 0.1, is_calculation_round: 1, created_at: Date.now(),
      }));
      const repos = createMockRepos({ pacingHistoryRows: history });
      const kernel = new StoryKernel(createMockDomain(), undefined, repos);
      const result = await kernel.assessEventDensity('save-1', StoryKernel['DEFAULT_PACING_CONFIG']);
      expect(result.guidance).toBe('maintain');
    });
  });

  describe('配置优先级链路', () => {
    it('代码默认 < LLM生成 < pacing.json覆盖 优先级正确', async () => {
      const repos = createMockRepos({ pacingConfigRow: null });
      const llmService = {
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            tensionWeights: { combat: 0.4, threat: 0.3, resource: 0.1, info: 0.1, time: 0.1 },
            tensionRange: { min: 10, max: 90 },
            pacingInterval: 3,
          }),
        }),
      };
      const kernel = new StoryKernel(createMockDomain(), undefined, repos, llmService as any);
      vi.spyOn(kernel as any, 'loadPacingPrompt').mockReturnValue('prompt');
      // 模拟 pacing.json 覆盖：deepMergePacingConfig 会将 generatedBy 设为 'config'
      vi.spyOn(kernel as any, 'applyPacingJsonOverride').mockImplementation((c: unknown) => ({
        ...(c as any),
        pacingInterval: 7, // pacing.json 覆盖
        generatedBy: 'config', // deepMergePacingConfig 逻辑：有覆盖字段时标记为 config
      }));

      const config = await (kernel as any).getOrCreatePacingConfig('save-1', 'test template');
      // pacing.json 覆盖后 generatedBy 应为 'config'
      expect(config.generatedBy).toBe('config');
      // pacing.json 覆盖的 pacingInterval 应为 7
      expect(config.pacingInterval).toBe(7);
      // LLM 生成的 tensionRange 应保留（pacing.json 未覆盖此字段）
      expect(config.tensionRange.min).toBe(10);
      expect(config.tensionRange.max).toBe(90);
    });
  });

  // === 006 升级：紧张度引擎 awareness 扩散度因子测试（设计文档 §9 测试用例大纲 9-10） ===

  /**
   * 创建 mock EntityGraphPort，包含 countAwarenessByTopic 方法。
   * 006 升级新增：assessInfoSpreadFactor 通过 EntityGraphPort.countAwarenessByTopic 读取 awareness 数据。
   */
  function createMockEntityGraphPort(options?: {
    awareNpcCount?: number;
    shouldThrow?: boolean;
  }): import('../types.js').EntityGraphPort {
    const awareNpcCount = options?.awareNpcCount ?? 0;
    const shouldThrow = options?.shouldThrow ?? false;
    return {
      getWorldStateSummary: vi.fn().mockResolvedValue(null),
      getSubgraph: vi.fn().mockResolvedValue(null),
      getNpcProfile: vi.fn().mockResolvedValue(null),
      getLocationSummary: vi.fn().mockResolvedValue(null),
      getEntityRelations: vi.fn().mockResolvedValue(null),
      countAwarenessByTopic: shouldThrow
        ? vi.fn().mockRejectedValue(new Error('mock countAwarenessByTopic error'))
        : vi.fn().mockResolvedValue(awareNpcCount),
    } as unknown as import('../types.js').EntityGraphPort;
  }

  /**
   * 创建 StorySnapshot mock，含 saveInfo.main_quest。
   * assessInfoSpreadFactor 依赖 storySnapshot.context.saveInfo.main_quest。
   */
  function createMockStorySnapshot(mainQuest: string | null = 'quest-main-001'): import('../types.js').StorySnapshot {
    return {
      context: {
        agentContext: { state: {} },
        saveInfo: {
          chapter: '第一章',
          location: null,
          main_quest: mainQuest,
          level: null,
        },
      },
      history: { events: [] },
      chapter: { chapter: '第一章', mainQuest },
    } as unknown as import('../types.js').StorySnapshot;
  }

  describe('assessInfoSpreadFactor（006 升级 awareness 扩散度因子）', () => {
    it('mainQuest 未设置时返回 0', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 3 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot(null);
      const result = await (kernel as any).assessInfoSpreadFactor(worldState, 'save-1', snapshot);
      expect(result).toBe(0);
      expect(entityGraph.countAwarenessByTopic).not.toHaveBeenCalled();
    });

    it('NPC 总数为 0 时返回 0', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 3 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 5, edgeCount: 2,
        nodesByType: { location: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoSpreadFactor(worldState, 'save-1', snapshot);
      expect(result).toBe(0);
      expect(entityGraph.countAwarenessByTopic).not.toHaveBeenCalled();
    });

    it('entityGraph Port 不可用（undefined）时返回 0', async () => {
      const kernel = new StoryKernel(createMockDomain(), undefined, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoSpreadFactor(worldState, 'save-1', snapshot);
      expect(result).toBe(0);
    });

    it('5 个 NPC 中 3 个有 awareness（coverage=0.6）返回 0.6（线性归一化）', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 3 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoSpreadFactor(worldState, 'save-1', snapshot);
      expect(result).toBeCloseTo(0.6, 5);
      expect(entityGraph.countAwarenessByTopic).toHaveBeenCalledWith('save-1', 'quest', 'quest-main-001');
    });

    it('5 个 NPC 中 5 个有 awareness（coverage=1.0）返回 1.0', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 5 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoSpreadFactor(worldState, 'save-1', snapshot);
      expect(result).toBe(1.0);
    });

    it('5 个 NPC 中 0 个有 awareness（coverage=0）返回 0', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 0 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoSpreadFactor(worldState, 'save-1', snapshot);
      expect(result).toBe(0);
    });

    it('countAwarenessByTopic 抛错时捕获并返回 0（不传播异常）', async () => {
      const entityGraph = createMockEntityGraphPort({ shouldThrow: true });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoSpreadFactor(worldState, 'save-1', snapshot);
      expect(result).toBe(0);
      expect(entityGraph.countAwarenessByTopic).toHaveBeenCalled();
    });
  });

  describe('assessInfoFactor（006 升级双维度合成：densityFactor 70% + spreadFactor 30%）', () => {
    it('densityFactor=0.4(infoEdgeTotal=2) + spreadFactor=0.6(3/5) → 0.28+0.18=0.46', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 3 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: { story_event: 2 },
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoFactor(worldState, 'save-1', snapshot);
      // densityFactor = min(1.0, 2/5) = 0.4
      // spreadFactor = 3/5 = 0.6
      // assessInfoFactor = 0.4*0.7 + 0.6*0.3 = 0.28 + 0.18 = 0.46
      expect(result).toBeCloseTo(0.46, 5);
    });

    it('densityFactor=0(infoEdgeTotal=0) + spreadFactor=0.8(4/5) → 0+0.24=0.24', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 4 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: {},
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoFactor(worldState, 'save-1', snapshot);
      // densityFactor = 0
      // spreadFactor = 4/5 = 0.8
      // assessInfoFactor = 0*0.7 + 0.8*0.3 = 0.24
      expect(result).toBeCloseTo(0.24, 5);
    });

    it('densityFactor=1.0(infoEdgeTotal=5) + spreadFactor=1.0(5/5) → 0.7+0.3=1.0', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 5 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: { story_event: 5 },
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoFactor(worldState, 'save-1', snapshot);
      // densityFactor = min(1.0, 5/5) = 1.0
      // spreadFactor = 5/5 = 1.0
      // assessInfoFactor = 1.0*0.7 + 1.0*0.3 = 1.0
      expect(result).toBeCloseTo(1.0, 5);
    });

    it('densityFactor=0.8(infoEdgeTotal=4) + spreadFactor=0(0/5) → 0.56+0=0.56', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 0 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 10, edgeCount: 5,
        nodesByType: { npc: 5 },
        edgesByRelation: { reveals: 4 },
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoFactor(worldState, 'save-1', snapshot);
      // densityFactor = min(1.0, 4/5) = 0.8
      // spreadFactor = 0/5 = 0
      // assessInfoFactor = 0.8*0.7 + 0*0.3 = 0.56
      expect(result).toBeCloseTo(0.56, 5);
    });

    it('worldState=undefined 时返回 0（densityFactor=0 + npcCount=0 → spreadFactor=0）', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 3 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoFactor(undefined, 'save-1', snapshot);
      // worldState=undefined → densityFactor=0, npcCount=0 → spreadFactor=0
      // assessInfoFactor = 0*0.7 + 0*0.3 = 0
      expect(result).toBe(0);
    });

    it('合成结果不会超过 1.0（densityFactor 和 spreadFactor 都在 [0,1] 范围内）', async () => {
      const entityGraph = createMockEntityGraphPort({ awareNpcCount: 10 });
      const kernel = new StoryKernel(createMockDomain(), entityGraph, createMockRepos());
      const worldState: WorldStateSummary = {
        nodeCount: 20, edgeCount: 20,
        nodesByType: { npc: 5 },
        edgesByRelation: { story_event: 10, reveals: 10, secret: 10 },
      };
      const snapshot = createMockStorySnapshot('quest-main-001');
      const result = await (kernel as any).assessInfoFactor(worldState, 'save-1', snapshot);
      // densityFactor = min(1.0, 30/5) = 1.0（clamp）
      // spreadFactor = min(1.0, 10/5) = 1.0（clamp，awareNpcCount > npcCount 时 clamp 到 1.0）
      // assessInfoFactor = 1.0*0.7 + 1.0*0.3 = 1.0（不会超过 1.0）
      expect(result).toBeLessThanOrEqual(1.0);
      expect(result).toBeCloseTo(1.0, 5);
    });
  });
});
