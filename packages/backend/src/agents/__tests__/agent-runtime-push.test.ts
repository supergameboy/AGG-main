/**
 * AgentRuntime 统一面板变更推送机制测试
 *
 * 测试目标：
 * 1. buildUnifiedResponse 不再写入 GameResponse.panelUpdates 字段
 *    （panelUpdates 已改由 panelUpdateBroadcaster.pushPanelUpdates 程序化推送）
 * 2. buildGameMasterFinalResponse 在 ReAct flush 后调 panelUpdateBroadcaster.pushPanelUpdates
 *    （路径 A 权威推送：source='react_flush'，含合并后的 panelUpdates + triggeredOps）
 *
 * mock 策略：
 * - AgentRuntime 是大型类，构造函数依赖 AgentDeps（30+ 字段）。本测试仅实例化所需的最小 deps 子集
 *   （通过 `as unknown as AgentDeps` 绕过类型检查），并按需补齐 GMAgentDeps 字段触发 isGMAgentDeps 判定
 * - buildGameMasterFinalResponse 与 buildUnifiedResponse 都是 private 方法，通过 `as unknown as` 反射调用
 * - buildGameMasterFinalResponse 内部调用多个 private 方法（parseReActContent / buildIntegrationResult /
 *   postProcessReActResult / mergePlayerDialogueIntoFlushData / buildPlayerDialogueEcho / buildUnifiedResponse），
 *   通过 vi.spyOn 替换为可控的桩函数，让测试聚焦于 pushPanelUpdates 调用契约
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime.js';
import type { AgentDeps, GMAgentDeps } from '../agent-deps.js';
import type { PanelUpdates } from '../../../../shared/src/types/dynamic-ui.js';
import type {
  AgentMessage,
  AgentResponse,
  WriteOperation,
} from '../../../../shared/src/types/agent.js';
import type { ResponsePoolFlush } from '../../services/response-pool.js';
import type { IntegrationResult } from '../coordinator/types.js';
import type { ReActEngineResult } from '../ReActEngine.js';

// ─── mock deps 工厂 ───────────────────────────────────────────────────────────

/**
 * 创建最小 AgentDeps mock。仅包含 AgentRuntime 构造函数实际访问的字段。
 * 完整 AgentDeps 接口有 30+ 字段，但构造函数只访问其中一部分，其余字段
 * 仅在 ReAct 循环路径中使用（本测试不触达）。
 */
function createMockDeps(): AgentDeps {
  return {
    // BaseAgent / AgentRuntime 构造函数必填
    devTraceCollector: () => null,
    webSocketService: { broadcastToClient: vi.fn() } as never,
    devTraceHook: { onDevEvent: vi.fn() } as never,
    contextService: { get: vi.fn().mockResolvedValue(null) } as never,
    flushQueue: { enqueue: vi.fn(), flush: vi.fn() } as never,
    llmService: {} as never,
    writeQueue: {} as never,
    helpRegistry: { getRegisteredToolTypes: vi.fn().mockReturnValue([]) } as never,
    promptModule: {
      build: vi.fn(),
      rules: { getAllRulesForAgent: vi.fn().mockReturnValue([]) },
      skills: { getSkillByName: vi.fn().mockReturnValue(undefined) },
    } as never,

    // 本测试关注的字段
    panelUpdateBroadcaster: {
      pushPanelUpdates: vi.fn(),
      pushPanelUpdate: vi.fn(),
    } as never,
    createResponsePool: vi.fn(() => ({
      stage: vi.fn(),
      flush: vi.fn(),
    })) as never,
    // decisionLogService 设为 undefined：跳过 logDecision 调用，简化 mock
    decisionLogService: undefined,
  } as unknown as AgentDeps;
}

/**
 * 在 AgentDeps 基础上叠加 GM 专属字段，使 isGMAgentDeps() 判定为 true。
 *
 * isGMAgentDeps 检查 'storyKernel' / 'responseBuilder' / 'mapServiceFactory' 三字段存在性。
 * buildGameMasterFinalResponse 访问 gmDeps.resultIntegrator.clearWriteOperationLog 与
 * gmDeps.responseBuilder.extractAndRefreshPanelUpdates / extractDataChangesPublic / sanitizeAllOutputsPublic。
 */
function createMockGMDeps(): GMAgentDeps {
  const base = createMockDeps();
  return {
    ...base,
    storyKernel: {} as never,
    responseBuilder: {
      extractAndRefreshPanelUpdates: vi.fn().mockResolvedValue({}),
      extractDataChangesPublic: vi.fn().mockReturnValue([]),
      sanitizeAllOutputsPublic: vi.fn((data: Record<string, unknown>) => data),
      triggerAutoSave: vi.fn().mockResolvedValue(undefined),
    } as never,
    mapServiceFactory: (() => Promise.resolve({} as never)) as never,
    resultIntegrator: { clearWriteOperationLog: vi.fn() } as never,
  } as unknown as GMAgentDeps;
}

// ─── 测试夹具 ─────────────────────────────────────────────────────────────────

/**
 * 暴露 private 方法给测试用。仅用于类型擦除，不改变运行时行为。
 */
type RuntimeInternals = {
  buildUnifiedResponse: (
    flushData: ResponsePoolFlush,
    saveId: string | undefined,
    extraData?: Record<string, unknown>,
  ) => AgentResponse;
  buildGameMasterFinalResponse: (
    reactResult: ReActEngineResult,
    message: AgentMessage,
    saveId: string,
    startTime: number,
    invalidNpcIds: string[],
    stagingPool: unknown,
    shadowState: unknown,
  ) => Promise<AgentResponse>;
  parseReActContent: (reactResult: ReActEngineResult) => Record<string, unknown>;
  buildIntegrationResult: (
    parsedContent: Record<string, unknown>,
    reactResult: ReActEngineResult,
  ) => IntegrationResult;
  postProcessReActResult: (
    integrationResult: IntegrationResult,
    saveId: string,
    invalidNpcIds: string[],
    reactResult: ReActEngineResult,
    stagingPool: unknown,
    shadowState: unknown,
  ) => Promise<{
    gameTimeData: unknown;
    integrationResult: IntegrationResult;
    reactResult?: ReActEngineResult;
  }>;
  buildPlayerDialogueEcho: (message: AgentMessage) => unknown;
  mergePlayerDialogueIntoFlushData: (flushData: ResponsePoolFlush, playerMessage: unknown) => ResponsePoolFlush;
};

function asInternals(runtime: AgentRuntime): RuntimeInternals {
  return runtime as unknown as RuntimeInternals;
}

// ─── 测试用例 ─────────────────────────────────────────────────────────────────

describe('AgentRuntime: 统一面板变更推送机制', () => {
  let runtime: AgentRuntime;
  let mockDeps: GMAgentDeps;
  let pushPanelUpdatesSpy: ReturnType<typeof vi.fn>;
  let responsePoolFlushMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDeps = createMockGMDeps();
    pushPanelUpdatesSpy = (mockDeps as unknown as {
      panelUpdateBroadcaster: { pushPanelUpdates: ReturnType<typeof vi.fn> };
    }).panelUpdateBroadcaster.pushPanelUpdates;

    // responsePool.flush 由本测试控制返回值，覆盖 panelUpdates 空/非空场景
    responsePoolFlushMock = vi.fn();
    (mockDeps as unknown as { createResponsePool: ReturnType<typeof vi.fn> }).createResponsePool =
      vi.fn(() => ({
        stage: vi.fn(),
        flush: responsePoolFlushMock,
      })) as never;

    runtime = new AgentRuntime(
      mockDeps,
      {
        name: 'gamemaster',
        tools: [],
        max_iterations: 4,
        force_structured_output: true,
        isSubAgent: false,
      } as never,
      'gamemaster',
      'test system prompt',
    );
  });

  // ─── 场景 1：buildUnifiedResponse 不再写入 panelUpdates 字段 ──────────────────

  describe('buildUnifiedResponse 不再写入 GameResponse.panelUpdates 字段', () => {
    it('flushData 含 panelUpdates 时，response.data 不应包含 panelUpdates 键', () => {
      const flushData: ResponsePoolFlush = {
        uiDirective: ':::card',
        uiIntensity: 'full',
        panelUpdates: { character: { gold: 100 } } as PanelUpdates,
        time: undefined,
      };

      const response = asInternals(runtime).buildUnifiedResponse(flushData, 'save-1', {
        extra: 'data',
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      // 关键断言：panelUpdates 字段已从 GameResponse 移除
      expect('panelUpdates' in (response.data as Record<string, unknown>)).toBe(false);
      // 统一面板变更推送机制：dialogue 字段已从 response.data 移除（设计 5.13），由 panelUpdates.dialogue 推送
      // 其他字段仍正常写入
      expect((response.data as Record<string, unknown>).uiDirective).toBe(':::card');
      expect((response.data as Record<string, unknown>).uiIntensity).toBe('full');
      expect((response.data as Record<string, unknown>).extra).toBe('data');
    });

    it('flushData.panelUpdates 为空对象时也不写入 panelUpdates 字段', () => {
      const flushData: ResponsePoolFlush = {
        uiDirective: undefined,
        uiIntensity: undefined,
        panelUpdates: {},
        time: undefined,
      };

      const response = asInternals(runtime).buildUnifiedResponse(flushData, 'save-1');

      expect('panelUpdates' in (response.data as Record<string, unknown>)).toBe(false);
    });

    it('extraData 透传的 panelUpdates 也应被 sanitizeAllOutputsPublic 处理后不写入顶层', () => {
      // 即便 extraData 不慎携带 panelUpdates（不应发生但防御性测试），
      // buildUnifiedResponse 不会主动写入顶层 panelUpdates 字段。
      // sanitizeAllOutputsPublic mock 为透传，验证responseData 拼装过程不主动加 panelUpdates 键
      const flushData: ResponsePoolFlush = {
        uiDirective: undefined,
        uiIntensity: undefined,
        panelUpdates: { character: { gold: 1 } } as PanelUpdates,
        time: undefined,
      };

      const response = asInternals(runtime).buildUnifiedResponse(flushData, 'save-1', {
        gm: { processedAt: 1 },
      });

      // 顶层 panelUpdates 不应被写入（即使 flushData.panelUpdates 非空）
      expect('panelUpdates' in (response.data as Record<string, unknown>)).toBe(false);
      // extraData.gm 仍应保留
      expect((response.data as Record<string, unknown>).gm).toEqual({ processedAt: 1 });
    });
  });

  // ─── 场景 2-4：buildGameMasterFinalResponse 调 pushPanelUpdates ────────────────

  describe('buildGameMasterFinalResponse 在 ReAct flush 后调 pushPanelUpdates', () => {
    /**
     * 安装 private 方法桩，让 buildGameMasterFinalResponse 走最短路径到达 pushPanelUpdates 断言点。
     *
     * 桩策略：
     * - parseReActContent → {}（无 dialogue/uiDirective/panelUpdates 在 LLM 输出）
     * - buildIntegrationResult → 含指定 writeOperations 的 IntegrationResult
     * - postProcessReActResult → 透传 integrationResult，gameTimeData=undefined
     * - buildPlayerDialogueEcho → null（无玩家对话回声）
     * - mergePlayerDialogueIntoFlushData → 透传 flushData
     * - buildUnifiedResponse → 固定 AgentResponse（不进入其内部逻辑）
     * - responsePool.flush → 返回指定的 panelUpdates
     */
    function setupSpies(options: {
      flushPanelUpdates: PanelUpdates;
      writeOperations?: WriteOperation[];
    }) {
      const internals = asInternals(runtime);

      vi.spyOn(internals, 'parseReActContent' as never).mockReturnValue({} as never);

      const integrationResult: IntegrationResult = {
        success: true,
        data: {},
        agentResponses: new Map(),
        writeOperations: options.writeOperations ?? [],
        needsFurtherProcessing: false,
        fallbackSuggestions: [],
      };
      vi.spyOn(internals, 'buildIntegrationResult' as never).mockReturnValue(
        integrationResult as never,
      );
      vi.spyOn(internals, 'postProcessReActResult' as never).mockResolvedValue({
        gameTimeData: undefined,
        integrationResult,
        reactResult: undefined, // 让 finalReactResult = 入参 reactResult
      } as never);
      vi.spyOn(internals, 'buildPlayerDialogueEcho' as never).mockReturnValue(null as never);
      vi.spyOn(internals, 'mergePlayerDialogueIntoFlushData' as never).mockImplementation(
        (fd: ResponsePoolFlush) => fd,
      );
      vi.spyOn(internals, 'buildUnifiedResponse' as never).mockReturnValue({
        success: true,
        data: {},
        messages: [],
      } as never);

      responsePoolFlushMock.mockReturnValue({
        uiDirective: undefined,
        uiIntensity: undefined,
        panelUpdates: options.flushPanelUpdates,
        time: undefined,
      });
    }

    /** 构造最小 ReActEngineResult，仅满足 buildGameMasterFinalResponse 访问 .iterations 字段。 */
    function createReactResult(): ReActEngineResult {
      return {
        content: '',
        iterations: 1,
        toolCalls: [],
      } as ReActEngineResult;
    }

    /** 构造最小 AgentMessage，payload.data 为空。 */
    function createMessage(): AgentMessage {
      return { payload: {} } as unknown as AgentMessage;
    }

    it('flushData.panelUpdates 非空时调 pushPanelUpdates，source=react_flush，triggeredOps 来自 writeOperations', async () => {
      const writeOps: WriteOperation[] = [
        {
          toolType: 'inventory_service' as never,
          method: 'add_item',
          params: {},
          result: {},
          timestamp: 12345 as never,
        },
      ];
      setupSpies({
        flushPanelUpdates: { character: { gold: 100 } },
        writeOperations: writeOps,
      });

      await asInternals(runtime).buildGameMasterFinalResponse(
        createReactResult(),
        createMessage(),
        'save-123',
        Date.now(),
        [],
        {},
        {},
      );

      expect(pushPanelUpdatesSpy).toHaveBeenCalledTimes(1);
      const [saveId, panelUpdates, source, triggeredOps] = pushPanelUpdatesSpy.mock.calls[0];
      expect(saveId).toBe('save-123');
      expect(panelUpdates).toEqual({ character: { gold: 100 } });
      expect(source).toBe('react_flush');
      expect(triggeredOps).toEqual([{ toolType: 'inventory_service', method: 'add_item' }]);
    });

    it('flushData.panelUpdates 为空对象时不调 pushPanelUpdates', async () => {
      setupSpies({
        flushPanelUpdates: {},
        writeOperations: [
          {
            toolType: 'inventory_service' as never,
            method: 'add_item',
            params: {},
            result: {},
            timestamp: 123 as never,
          },
        ],
      });

      await asInternals(runtime).buildGameMasterFinalResponse(
        createReactResult(),
        createMessage(),
        'save-123',
        Date.now(),
        [],
        {},
        {},
      );

      expect(pushPanelUpdatesSpy).not.toHaveBeenCalled();
    });

    it('triggeredOps 仅取 toolType 与 method 两字段，不含 timestamp', async () => {
      // writeOperations 含 timestamp 字段；triggeredOps 映射时仅取 toolType + method
      setupSpies({
        flushPanelUpdates: { character: { gold: 50 } },
        writeOperations: [
          {
            toolType: 'map_service' as never,
            method: 'create_location',
            params: {},
            result: {},
            timestamp: 999 as never,
          },
          {
            toolType: 'quest_service' as never,
            method: 'create_quest',
            params: {},
            result: {},
            timestamp: 888 as never,
          },
        ],
      });

      await asInternals(runtime).buildGameMasterFinalResponse(
        createReactResult(),
        createMessage(),
        'save-abc',
        Date.now(),
        [],
        {},
        {},
      );

      expect(pushPanelUpdatesSpy).toHaveBeenCalledTimes(1);
      const triggeredOps = pushPanelUpdatesSpy.mock.calls[0][3];
      expect(triggeredOps).toEqual([
        { toolType: 'map_service', method: 'create_location' },
        { toolType: 'quest_service', method: 'create_quest' },
      ]);
      // 防御性断言：每个 op 仅含 toolType + method，不含 timestamp 等其他字段
      for (const op of triggeredOps) {
        expect(Object.keys(op).sort()).toEqual(['method', 'toolType']);
      }
    });

    it('writeOperations 为空数组时，triggeredOps 为空数组但仍调 pushPanelUpdates（panelUpdates 非空时）', async () => {
      setupSpies({
        flushPanelUpdates: { location: { currentLocationId: 'loc-1' } },
        writeOperations: [],
      });

      await asInternals(runtime).buildGameMasterFinalResponse(
        createReactResult(),
        createMessage(),
        'save-empty',
        Date.now(),
        [],
        {},
        {},
      );

      expect(pushPanelUpdatesSpy).toHaveBeenCalledTimes(1);
      const [saveId, panelUpdates, source, triggeredOps] = pushPanelUpdatesSpy.mock.calls[0];
      expect(saveId).toBe('save-empty');
      expect(panelUpdates).toEqual({ location: { currentLocationId: 'loc-1' } });
      expect(source).toBe('react_flush');
      expect(triggeredOps).toEqual([]);
    });
  });
});
