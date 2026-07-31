/**
 * hook-placement 集成测试（M4 子任务D，设计 §15.4，用例 I1-I7）。
 *
 * 验证真实接线：HookDispatcher + HookPlacementResolver + HookImplRegistry +
 * mergeToolHookResult 全链路协作。运行期身份匿名性经 buildHookImplRegistry
 * 自然覆盖（P2/P4 已断言命名导出与注册表工厂引用相等）。
 *
 * logger mock 说明：被测模块在模块顶层捕获 createChildLogger(source) 返回值
 * 为模块级 const，mock 返回持久子 logger 并登记进 childLoggers 注册表，
 * 断言按 source 查找。tests/setup.ts 在测试文件加载前已用真实 logger 评估过
 * 被测模块（setup 初始化整个 Agent 系统），必须 resetModules + 动态导入
 * 重新评估，logger mock 才能生效（与 tool-result-merge.test.ts /
 * prepare-next-turn.test.ts 同一模式）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import type { HookImplFactory, IHookImplRegistry } from '../runtime/hook-impl-registry.js';
import type { HookPlacementEntry } from '../runtime/hook-placement-config.js';
import type { AgentHook, AgentHookResult } from '../runtime/agent-hooks.js';
import type {
  HookPlacementContext,
  HookSeedSnapshotFields,
  IHookPlacementResolver,
} from '../runtime/types.js';

// ─── logger mock（vi.hoisted：mock 工厂提升执行，注册表必须同源提升） ───

const loggerMocks = vi.hoisted(() => {
  interface MockChildLogger {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  }
  const childLoggers = new Map<string, MockChildLogger>();
  const createChildLogger = (source: string): MockChildLogger => {
    const child: MockChildLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    childLoggers.set(source, child);
    return child;
  };
  return { childLoggers, createChildLogger };
});

vi.mock('../../utils/logger.js', () => ({
  createChildLogger: loggerMocks.createChildLogger,
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── 被测模块绑定（beforeEach 内 resetModules + 动态导入重新评估） ───

let HookDispatcher: typeof import('../runtime/hook-dispatcher.js').HookDispatcher;
let MAX_DISPATCH_DEPTH: number;
let HookPlacementResolver: typeof import('../runtime/hook-placement-resolver.js').HookPlacementResolver;
let buildHookImplRegistry: typeof import('../runtime/hook-impl-registry.js').buildHookImplRegistry;
let mergeToolHookResult: typeof import('../runtime/tool-result-merge.js').mergeToolHookResult;
let createInitialAgentRuntimeState: typeof import('../runtime/agent-runtime-state.js').createInitialAgentRuntimeState;
let ConfigLoader: typeof import('../config/ConfigLoader.js').ConfigLoader;

beforeEach(async () => {
  vi.resetModules();
  ({ HookDispatcher, MAX_DISPATCH_DEPTH } = await import('../runtime/hook-dispatcher.js'));
  ({ HookPlacementResolver } = await import('../runtime/hook-placement-resolver.js'));
  ({ buildHookImplRegistry } = await import('../runtime/hook-impl-registry.js'));
  ({ mergeToolHookResult } = await import('../runtime/tool-result-merge.js'));
  ({ createInitialAgentRuntimeState } = await import('../runtime/agent-runtime-state.js'));
  ({ ConfigLoader } = await import('../config/ConfigLoader.js'));
});

// ─── 共享工具 ───

const gmPlacement: HookPlacementContext = { agentType: 'gamemaster', path: 'game_master' };

const seedSnapshotFields: HookSeedSnapshotFields = {
  saveId: undefined,
  providerId: null,
  model: null,
  temperature: 0.7,
  maxTokens: 4096,
  configuredTools: [],
  systemPrompt: '',
  language: null,
  templateId: null,
};

function entry(
  id: string,
  hookRef: string,
  selector: HookPlacementEntry['selector'],
  extra?: Partial<Pick<HookPlacementEntry, 'order' | 'enabled'>>,
): HookPlacementEntry {
  return { id, hookRef, selector, ...extra };
}

function makeResolver(
  entries: HookPlacementEntry[],
  customize?: (registry: IHookImplRegistry) => void,
): IHookPlacementResolver {
  const registry = buildHookImplRegistry();
  customize?.(registry);
  return new HookPlacementResolver({
    entries,
    implRegistry: registry,
    implDeps: { webSocketService: {} as IWebSocketBroadcaster },
  });
}

function makeDispatcher(deps: { placementResolver?: IHookPlacementResolver }) {
  return new HookDispatcher({
    agentKey: 'integration-test-agent',
    agentTypeLabel: 'gamemaster',
    webSocketService: {} as IWebSocketBroadcaster,
    snapshotProvider: () => null,
    stateReader: createInitialAgentRuntimeState(),
    seedSnapshotFactory: () => ({ ...seedSnapshotFields }),
    hookPolicies: undefined,
    onTaskCompleteHook: async () => undefined,
    placementResolver: deps.placementResolver,
  });
}

/** 桩 factory：物化的 hook 执行时推 tag 进 calls（I4 顺序断言用） */
function makeStubFactory(calls: string[], tag: string): HookImplFactory {
  return () => async () => {
    calls.push(tag);
    return undefined;
  };
}

describe('hook-placement 集成（M4 §15.4）', () => {
  it('I1: 审核警告注入——领域 hook appendWarnings 追加到 data.warnings，其余字段无损（§2.3 场景A）', async () => {
    const AUDIT_WARNING = '审核警告：create_location 生成的地点缺少与既有地图的连接边';
    const resolver = makeResolver(
      [
        entry('generic-result-normalizer', 'result-normalizer', { hook: 'after_tool_call' }),
        entry('map-audit-warning', 'map-warning-injector', { hook: 'after_tool_call', domains: ['map'] }),
      ],
      (registry) =>
        registry.register('map-warning-injector', () => async () => ({
          patch: { appendWarnings: [AUDIT_WARNING] },
        })),
    );
    const dispatcher = makeDispatcher({ placementResolver: resolver });

    const baseResult: Record<string, unknown> = {
      success: true,
      data: { locationId: 'loc-001', name: '老汤姆的小屋', warnings: ['既有警告'] },
      _subAgentSummary: '子Agent摘要（回归保留）',
      _meta: { source: 'integration-test' },
    };
    const hookResult = await dispatcher.dispatch('after_tool_call', {
      requestId: 'req-i1',
      agentRunId: 'run-i1',
      payload: {
        toolName: 'map_service__create_location',
        result: baseResult,
        isError: false,
        readonlyMode: false,
      },
      placement: { ...gmPlacement, domain: 'map' },
    });
    const { result: finalResult } = mergeToolHookResult(baseResult, [hookResult.patch]);

    const finalData = finalResult.data as Record<string, unknown>;
    expect(finalData.warnings).toEqual(['既有警告', AUDIT_WARNING]);
    expect(finalData.locationId).toBe('loc-001');
    expect(finalResult._subAgentSummary).toBe('子Agent摘要（回归保留）');
    expect(finalResult._meta).toEqual({ source: 'integration-test' });
  });

  it('I2: RiskGate 翻转——领域 hook isError:true 翻转 success + appendWarnings，回归字段无损（§2.3 场景B）', async () => {
    const GATE_REASON = '审核驳回：地点缺乏连接边';
    const resolver = makeResolver(
      [
        entry('generic-result-normalizer', 'result-normalizer', { hook: 'after_tool_call' }),
        entry('map-risk-gate', 'map-risk-gate-impl', { hook: 'after_tool_call', domains: ['map'] }),
      ],
      (registry) =>
        registry.register('map-risk-gate-impl', () => async () => ({
          patch: { isError: true, appendWarnings: [GATE_REASON] },
        })),
    );
    const dispatcher = makeDispatcher({ placementResolver: resolver });

    const baseResult: Record<string, unknown> = {
      success: true,
      data: { locationId: 'loc-002', name: '空旷之地' },
      _subAgentSummary: '保留',
    };
    const hookResult = await dispatcher.dispatch('after_tool_call', {
      requestId: 'req-i2',
      agentRunId: 'run-i2',
      payload: {
        toolName: 'map_service__create_location',
        result: baseResult,
        isError: false,
        readonlyMode: false,
      },
      placement: { ...gmPlacement, domain: 'map' },
    });
    const { result: finalResult } = mergeToolHookResult(baseResult, [hookResult.patch]);

    expect(finalResult.success).toBe(false);
    expect((finalResult.data as Record<string, unknown>).warnings).toEqual([GATE_REASON]);
    expect((finalResult.data as Record<string, unknown>).locationId).toBe('loc-002');
    expect(finalResult._subAgentSummary).toBe('保留');
  });

  it('I3: resolver 崩溃降级——索引构建失败 → 默认链完整执行 + 日志可观测（§15.3 D4.7）', async () => {
    const brokenRegistry: IHookImplRegistry = {
      register: () => undefined,
      get: () => {
        throw new Error('registry corrupted');
      },
      has: () => false,
      listIds: () => [],
    };
    const resolver = new HookPlacementResolver({
      entries: [entry('g1', 'result-normalizer', { hook: 'after_tool_call' })],
      implRegistry: brokenRegistry,
      implDeps: { webSocketService: {} as IWebSocketBroadcaster },
    });
    const dispatcher = makeDispatcher({ placementResolver: resolver });

    // result 缺 success 标量 → 降级链的 result-normalizer 仍规范化（从 isError 推导）
    const hookResult = await dispatcher.dispatch('after_tool_call', {
      requestId: 'req-i3',
      agentRunId: 'run-i3',
      payload: {
        toolName: 'map_service__create_location',
        result: { data: {}, error: 'kaboom' },
        isError: true,
        readonlyMode: false,
      },
      placement: { ...gmPlacement, domain: 'map' },
    });

    expect(hookResult.patch).toEqual({ isError: true });
    expect(
      loggerMocks.childLoggers.get('hook-placement-resolver')?.error,
    ).toHaveBeenCalledWith(
      'hook placement index build failed, falling back to default chain',
      expect.objectContaining({ error: 'registry corrupted' }),
    );
  });

  it('I4: 配置新增 hook 即时生效——3 个领域 audit 按 YAML 声明序执行，默认链不丢（§2.1 纯加链）', async () => {
    const calls: string[] = [];
    const DOMAIN_IMPLS = ['audit-map', 'audit-npc', 'audit-quest'] as const;
    const customize = (registry: IHookImplRegistry): void => {
      for (const implId of DOMAIN_IMPLS) {
        registry.register(implId, makeStubFactory(calls, implId));
      }
    };
    const configured = makeResolver(
      DOMAIN_IMPLS.map((implId, i) =>
        entry(`domain-${i}`, implId, { hook: 'after_tool_call', domains: ['map'] }),
      ),
      customize,
    );
    const dispatcher = makeDispatcher({ placementResolver: configured });

    // result 缺 success 标量 → 默认链 result-normalizer 产生规范化 patch（证明默认链在位）
    const hookResult = await dispatcher.dispatch('after_tool_call', {
      requestId: 'req-i4',
      agentRunId: 'run-i4',
      payload: {
        toolName: 'map_service__create_location',
        result: { data: {} },
        isError: false,
        readonlyMode: false,
      },
      placement: { ...gmPlacement, domain: 'map' },
    });

    expect(calls).toEqual([...DOMAIN_IMPLS]);
    expect(hookResult.patch).toEqual({ isError: false });

    // ConfigLoader 真读 YAML：证明「纯 YAML 追加」路径可加载且声明序保留
    const dir = mkdtempSync(join(tmpdir(), 'hook-placement-i4-'));
    writeFileSync(
      join(dir, 'hook-placement.yaml'),
      yaml.dump({
        version: 1,
        entries: DOMAIN_IMPLS.map((implId, i) => ({
          id: `domain-${i}`,
          hookRef: implId,
          selector: { hook: 'after_tool_call', domains: ['map'] },
        })),
      }),
      'utf-8',
    );
    const loaded = new ConfigLoader(dir).loadHookPlacement(new Set([...DOMAIN_IMPLS]));
    expect(loaded.entries.map((e) => e.hookRef)).toEqual([...DOMAIN_IMPLS]);
  });

  it('I5: on_task_complete 透传——hook 抛错传播给调用方，绝不静默吞掉（§10.2 透明语义）', async () => {
    const resolver = makeResolver(
      [entry('task-audit', 'task-audit-impl', { hook: 'on_task_complete', agentTypes: ['gamemaster'] })],
      (registry) =>
        registry.register('task-audit-impl', () => async () => {
          throw new Error('boom-task');
        }),
    );
    const dispatcher = makeDispatcher({ placementResolver: resolver });

    const rejection = await dispatcher
      .dispatch('on_task_complete', {
        requestId: 'req-i5',
        agentRunId: 'run-i5',
        payload: { saveId: 'save-1', success: true },
        placement: gmPlacement,
      })
      .then(
        () => ({ threw: false as const, error: undefined as unknown }),
        (error: unknown) => ({ threw: true as const, error }),
      );

    expect(rejection.threw).toBe(true);
    expect(rejection.error).toBeInstanceOf(Error);
    expect((rejection.error as Error).message).toContain('boom-task');
  });

  it('I6: 循环防护——MAX_DISPATCH_DEPTH 超限中止嵌套派发并记录错误（§8.6）', async () => {
    const dispatcher = makeDispatcher({});
    // hook 执行体经闭包再入同一 dispatcher（现状最深嵌套路径：
    // dispatch → hook 执行体 → reportProgress 的 dispatch 的故障放大形态）
    const recursiveHook: AgentHook = async (context) => {
      await dispatcher.dispatch('before_compaction', {
        requestId: context.requestId,
        agentRunId: context.agentRunId,
      });
      return undefined;
    };
    dispatcher.register('before_compaction', recursiveHook);

    const result: AgentHookResult<Record<string, unknown>> = await dispatcher.dispatch(
      'before_compaction',
      { requestId: 'req-i6', agentRunId: 'run-i6' },
    );

    // 防护触发后整链正常收尾（不栈溢出、不悬挂）
    expect(result).toBeDefined();
    const errorSpy = loggerMocks.childLoggers.get('hook-dispatcher')?.error;
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Hook dispatch depth exceeded, aborting nested dispatch',
      expect.objectContaining({
        eventName: 'before_compaction',
        depth: MAX_DISPATCH_DEPTH + 1,
        maxDepth: MAX_DISPATCH_DEPTH,
      }),
    );
  });

  it('I7: 渐进兼容——无 placement 参数时仅默认链执行，与现状行为完全一致（§4 兼容契约）', async () => {
    const resolver = makeResolver([
      entry('generic-extra', 'result-normalizer', { hook: 'after_tool_call' }),
    ]);
    const dispatcher = makeDispatcher({ placementResolver: resolver });

    // 无 placement：resolver 不参与，等价 dispatcher 未注入 resolver
    const noPlacement = await dispatcher.dispatch('after_tool_call', {
      requestId: 'req-i7',
      agentRunId: 'run-i7',
      payload: {
        toolName: 'map_service__create_location',
        result: { success: true, data: { id: 'x' } },
        isError: false,
        readonlyMode: false,
      },
    });
    // 默认链 result-normalizer 对规范结果幂等返回 undefined（无 patch）；
    // 配置 entry 未被解析执行
    expect(noPlacement.patch).toBeUndefined();
  });
});
