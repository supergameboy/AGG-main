/**
 * M5 单测：prepareNextTurn（ModelSwitchGuard + iteration-tier 策略 + 工厂）。
 *
 * 设计文档：docs/design/solution-design-20260726-pi-reference-upgrade/
 *   solution-design-20260726-pi-reference-upgrade-模块M5-prepareNextTurn.md §9.1
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AgentConfig } from '../../../../../../shared/src/types/agent-config.js';
import type { ID } from '../../../../../../shared/src/types/core.js';
import type {
  IModelTierResolver,
  ModelRef,
  PrepareNextTurnContext,
} from '../prepare-next-turn.js';

// Mock logger（U10/U12 断言 warn 次数）；vi.hoisted 保证在 vi.mock 工厂执行前初始化
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock('../../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// tests/setup.ts 在测试文件加载前已用真实 logger 评估过 prepare-next-turn（模块级 logger 单例），
// 必须 resetModules + 动态导入重新评估，logger mock 才能生效
// （与 react-engine-prepare-next-turn.test.ts 同一模式）
let ModelSwitchGuard: typeof import('../prepare-next-turn.js').ModelSwitchGuard;
let createIterationTierHook: typeof import('../prepare-next-turn.js').createIterationTierHook;
let createPrepareNextTurnHook: typeof import('../prepare-next-turn.js').createPrepareNextTurnHook;
let sameModelRef: typeof import('../prepare-next-turn.js').sameModelRef;

beforeEach(async () => {
  vi.resetModules();
  ({
    ModelSwitchGuard,
    createIterationTierHook,
    createPrepareNextTurnHook,
    sameModelRef,
  } = await import('../prepare-next-turn.js'));
  mockWarn.mockClear();
});

// ─── 测试夹具 ───

const BASELINE: ModelRef = { providerId: 'p-strong', model: 'm-strong' };
const FAST: ModelRef = { providerId: 'p-fast', model: 'm-fast' };
const OTHER: ModelRef = { providerId: 'p-other', model: 'm-other' };

function createCtx(overrides: Partial<PrepareNextTurnContext> = {}): PrepareNextTurnContext {
  return {
    iteration: 1,
    maxIterations: 4,
    messages: [],
    toolCalls: [],
    cumulativeTokens: { input: 0, output: 0 },
    currentModel: { ...BASELINE },
    baselineModel: { ...BASELINE },
    switchState: { switchCount: 0, lastSwitchIteration: null },
    agentKey: 'story',
    currentSaveId: 'save-1' as ID,
    apiTools: [],
    ...overrides,
  };
}

function createResolver(fast: ModelRef | null = FAST): IModelTierResolver & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() { return state.calls; },
    async resolve(tier) {
      state.calls += 1;
      if (tier === 'fast') return fast;
      return { ...BASELINE };
    },
  };
}

// ─── U1-U6：ModelSwitchGuard ───

describe('ModelSwitchGuard', () => {
  it('U1: 首次切换（未超限）→ allowed', () => {
    const guard = new ModelSwitchGuard({ maxSwitchesPerLoop: 2, cooldownIterations: 0, allowSwitchBack: true });
    const decision = guard.evaluate({ target: FAST, current: BASELINE, baseline: BASELINE, iteration: 2 });
    expect(decision).toEqual({ allowed: true });
  });

  it('U2: 达 maxSwitchesPerLoop → rejected，reason 含 maxSwitchesPerLoop', () => {
    const guard = new ModelSwitchGuard({ maxSwitchesPerLoop: 1, cooldownIterations: 0, allowSwitchBack: true });
    guard.recordSwitch(2);
    const decision = guard.evaluate({ target: OTHER, current: FAST, baseline: BASELINE, iteration: 4 });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('maxSwitchesPerLoop');
  });

  it('U3: 冷却期内第 2 次切换拒绝；冷却后轮放行', () => {
    const guard = new ModelSwitchGuard({ maxSwitchesPerLoop: 3, cooldownIterations: 1, allowSwitchBack: true });
    guard.recordSwitch(2);
    // iteration 3：距上次切换 1 轮（<= cooldown 1）→ 拒绝
    const cooling = guard.evaluate({ target: OTHER, current: FAST, baseline: BASELINE, iteration: 3 });
    expect(cooling.allowed).toBe(false);
    if (!cooling.allowed) expect(cooling.reason).toContain('cooldownIterations');
    // iteration 4：距上次切换 2 轮（> cooldown 1）→ 放行
    const passed = guard.evaluate({ target: OTHER, current: FAST, baseline: BASELINE, iteration: 4 });
    expect(passed).toEqual({ allowed: true });
  });

  it('U4: allowSwitchBack=false 切回 baseline → rejected，reason 含 allowSwitchBack', () => {
    const guard = new ModelSwitchGuard({ maxSwitchesPerLoop: 3, cooldownIterations: 0, allowSwitchBack: false });
    guard.recordSwitch(2);
    const decision = guard.evaluate({ target: BASELINE, current: FAST, baseline: BASELINE, iteration: 3 });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('allowSwitchBack');
  });

  it('U5: target == current 幂等 → allowed 且 switchCount 不变', () => {
    const guard = new ModelSwitchGuard({ maxSwitchesPerLoop: 1, cooldownIterations: 99, allowSwitchBack: false });
    const before = guard.snapshot();
    const decision = guard.evaluate({ target: FAST, current: FAST, baseline: BASELINE, iteration: 2 });
    expect(decision).toEqual({ allowed: true });
    expect(guard.snapshot()).toEqual(before);
  });

  it('U6: 缺省配置 → max=2 / cooldown=1 / allowBack=true', () => {
    const guard = new ModelSwitchGuard();
    // 切换 2 次均放行（max=2）
    guard.recordSwitch(2);
    guard.recordSwitch(4);
    // 第 3 次超限
    const exceeded = guard.evaluate({ target: OTHER, current: FAST, baseline: BASELINE, iteration: 6 });
    expect(exceeded.allowed).toBe(false);
    // cooldown=1：新建 guard 切换后隔 1 轮拒绝
    const guard2 = new ModelSwitchGuard();
    guard2.recordSwitch(2);
    const cooling = guard2.evaluate({ target: OTHER, current: FAST, baseline: BASELINE, iteration: 3 });
    expect(cooling.allowed).toBe(false);
    // allowSwitchBack=true：切回 baseline 不被规则 3 拦截（会撞 cooldown，故新建 guard 验证）
    const guard3 = new ModelSwitchGuard();
    const switchBack = guard3.evaluate({ target: BASELINE, current: FAST, baseline: BASELINE, iteration: 2 });
    expect(switchBack).toEqual({ allowed: true });
  });
});

// ─── U7-U10：iteration-tier 策略 ───

describe('createIterationTierHook', () => {
  it('U7: iteration <= N → undefined，resolver 未被调用', async () => {
    const resolver = createResolver();
    const hook = createIterationTierHook({ fastAfterIteration: 1 }, resolver);
    expect(await hook(createCtx({ iteration: 1 }))).toBeUndefined();
    expect(resolver.calls).toBe(0);
  });

  it('U8: iteration > N 首次 → {model: fastRef}；resolver 调用恰好 1 次（memoize）', async () => {
    const resolver = createResolver();
    const hook = createIterationTierHook({ fastAfterIteration: 1 }, resolver);
    const update = await hook(createCtx({ iteration: 2 }));
    expect(update).toEqual({ model: FAST });
    expect(resolver.calls).toBe(1);
  });

  it('U9: 已在 fast（currentModel == fastRef）→ undefined', async () => {
    const resolver = createResolver();
    const hook = createIterationTierHook({ fastAfterIteration: 1 }, resolver);
    const update = await hook(createCtx({ iteration: 2, currentModel: { ...FAST } }));
    expect(update).toBeUndefined();
  });

  it('U9-补: 本 loop 已切换过（switchCount > 0）→ undefined（幂等短路）', async () => {
    const resolver = createResolver();
    const hook = createIterationTierHook({ fastAfterIteration: 1 }, resolver);
    const update = await hook(createCtx({
      iteration: 3,
      switchState: { switchCount: 1, lastSwitchIteration: 2 },
    }));
    expect(update).toBeUndefined();
  });

  it('U10: fast 未配置 → undefined + warn 恰好 1 次（连续 3 轮验证 memoize + 单次 warn）', async () => {
    const resolver = createResolver(null);
    const hook = createIterationTierHook({ fastAfterIteration: 1 }, resolver);
    expect(await hook(createCtx({ iteration: 2 }))).toBeUndefined();
    expect(await hook(createCtx({ iteration: 3 }))).toBeUndefined();
    expect(await hook(createCtx({ iteration: 4 }))).toBeUndefined();
    expect(resolver.calls).toBe(1);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});

// ─── U11-U13：工厂 ───

function createAgentConfig(prepareNextTurn?: AgentConfig['prepareNextTurn']): AgentConfig {
  return {
    name: 'Story',
    description: 'story agent',
    system_prompt_file: 'story.md',
    tools: [],
    prepareNextTurn,
  };
}

describe('createPrepareNextTurnHook', () => {
  it('U11: 无配置 / enabled=false → undefined', () => {
    const resolver = createResolver();
    expect(createPrepareNextTurnHook(createAgentConfig(undefined), resolver)).toBeUndefined();
    expect(createPrepareNextTurnHook(createAgentConfig({ enabled: false, strategy: 'iteration-tier', iterationTier: { fastAfterIteration: 1 } }), resolver)).toBeUndefined();
  });

  it('U12: 未知 strategy → undefined + warn', () => {
    const resolver = createResolver();
    const config = createAgentConfig({ enabled: true, iterationTier: { fastAfterIteration: 1 } });
    expect(createPrepareNextTurnHook(config, resolver)).toBeUndefined();
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('U13: enabled + iteration-tier → 返回函数且行为同 U7-U9', async () => {
    const resolver = createResolver();
    const hook = createPrepareNextTurnHook(
      createAgentConfig({ enabled: true, strategy: 'iteration-tier', iterationTier: { fastAfterIteration: 1 } }),
      resolver,
    );
    expect(hook).toBeTypeOf('function');
    if (!hook) return;
    expect(await hook(createCtx({ iteration: 1 }))).toBeUndefined();
    expect(await hook(createCtx({ iteration: 2 }))).toEqual({ model: FAST });
  });
});

// ─── sameModelRef ───

describe('sameModelRef', () => {
  it('providerId 与 model 均相等 → true', () => {
    expect(sameModelRef({ providerId: 'p', model: 'm' }, { providerId: 'p', model: 'm' })).toBe(true);
  });

  it('任一字段不等 → false', () => {
    expect(sameModelRef({ providerId: 'p', model: 'm' }, { providerId: 'p', model: 'x' })).toBe(false);
    expect(sameModelRef({ providerId: 'p' }, { providerId: 'p', model: 'm' })).toBe(false);
    expect(sameModelRef({}, {})).toBe(true);
  });
});
