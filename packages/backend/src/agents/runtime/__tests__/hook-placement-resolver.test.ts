/**
 * hook-placement-resolver 单元测试（M4 设计 §15.1，用例 P1-P16 + V1-V8 配置校验）。
 *
 * 链序断言统一走 matchedEntryIds（设计 §8.3 诊断字段）——
 * 链上 hook 实例是工厂闭包产物无身份可比性，entry id 序即执行序。
 * 标量冲突"后执行者赢"的合并语义归 tool-result-merge.test.ts（M8），此处不重复。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import {
  HookImplRegistry,
  buildHookImplRegistry,
  type HookImplDeps,
  type HookImplFactory,
  type IHookImplRegistry,
} from '../hook-impl-registry.js';
import { HookPlacementResolver } from '../hook-placement-resolver.js';
import { resolveDomainFromToolName } from '../tool-result-merge.js';
import {
  validateHookPlacementConfig,
  type HookPlacementConfig,
  type HookPlacementEntry,
  type HookPlacementSelector,
} from '../hook-placement-config.js';
import type { HookPlacementContext } from '../types.js';

const implDeps: HookImplDeps = {
  // 测试只物化 hook 不执行（progress-broadcaster 的 WS 广播不会被触发），空实现满足结构契约
  webSocketService: {} as IWebSocketBroadcaster,
};

/** 空操作 hook 工厂：物化产物仅用于计数断言，不执行 */
function stubFactory(): HookImplFactory {
  return () => async () => undefined;
}

function entry(
  id: string,
  hookRef: string,
  selector: HookPlacementSelector,
  extra?: Partial<Pick<HookPlacementEntry, 'order' | 'enabled'>>,
): HookPlacementEntry {
  return { id, hookRef, selector, ...extra };
}

/** 按 entries 自动注册同名 hookRef 的桩注册表 + 构造 resolver */
function makeResolver(
  entries: HookPlacementEntry[],
  overrides?: { cacheCapacity?: number },
): HookPlacementResolver {
  const registry = new HookImplRegistry();
  for (const e of entries) {
    registry.register(e.hookRef, stubFactory());
  }
  return new HookPlacementResolver({ entries, implRegistry: registry, implDeps, ...overrides });
}

const gmMasterCtx: HookPlacementContext = { agentType: 'gamemaster', path: 'game_master' };

describe('hook-placement-resolver（M4 §15.1 四维度组合）', () => {
  it('P1: 纯通用匹配——selector 仅 hook 时所有 agentType/path/domain 命中', () => {
    const resolver = makeResolver([entry('g1', 'impl-g', { hook: 'after_tool_call' })]);
    const contexts: HookPlacementContext[] = [
      { agentType: 'gamemaster', path: 'game_master' },
      { agentType: 'npc_party', path: 'sub_agent', domain: 'map' },
      { agentType: 'quest', path: 'pool_generation', domain: 'quest' },
    ];
    for (const ctx of contexts) {
      const chain = resolver.resolvePlacement('after_tool_call', ctx);
      expect(chain.matchedEntryIds).toEqual(['g1']);
      expect(chain.hooks).toHaveLength(1);
      expect(chain.degraded).toBe(false);
    }
  });

  it('P2: Agent 类型匹配——gamemaster 命中 / npc_party 不命中', () => {
    const resolver = makeResolver([
      entry('t1', 'impl-t', { hook: 'after_tool_call', agentTypes: ['gamemaster'] }),
    ]);
    expect(
      resolver.resolvePlacement('after_tool_call', gmMasterCtx).matchedEntryIds,
    ).toEqual(['t1']);
    expect(
      resolver.resolvePlacement('after_tool_call', { agentType: 'npc_party', path: 'game_master' })
        .matchedEntryIds,
    ).toEqual([]);
  });

  it('P3: 路径匹配——pool_generation 命中 / game_master 不命中', () => {
    const resolver = makeResolver([
      entry('p1', 'impl-p', { hook: 'after_tool_call', paths: ['pool_generation'] }),
    ]);
    expect(
      resolver.resolvePlacement('after_tool_call', { agentType: 'gamemaster', path: 'pool_generation' })
        .matchedEntryIds,
    ).toEqual(['p1']);
    expect(resolver.resolvePlacement('after_tool_call', gmMasterCtx).matchedEntryIds).toEqual([]);
  });

  it('P4: 领域匹配——domain=map 命中 / domain=quest 不命中 / domain 缺失不命中', () => {
    const resolver = makeResolver([
      entry('d1', 'impl-d', { hook: 'after_tool_call', domains: ['map'] }),
    ]);
    expect(
      resolver.resolvePlacement('after_tool_call', { ...gmMasterCtx, domain: 'map' }).matchedEntryIds,
    ).toEqual(['d1']);
    expect(
      resolver.resolvePlacement('after_tool_call', { ...gmMasterCtx, domain: 'quest' }).matchedEntryIds,
    ).toEqual([]);
    expect(resolver.resolvePlacement('after_tool_call', gmMasterCtx).matchedEntryIds).toEqual([]);
  });

  it('P5: 组合维度 AND——agentTypes 与 domains 同时满足才命中', () => {
    const resolver = makeResolver([
      entry('combo', 'impl-c', {
        hook: 'after_tool_call',
        agentTypes: ['gamemaster'],
        domains: ['map'],
      }),
    ]);
    const cases: Array<[HookPlacementContext, string[]]> = [
      [{ agentType: 'gamemaster', path: 'game_master', domain: 'map' }, ['combo']],
      [{ agentType: 'gamemaster', path: 'game_master', domain: 'quest' }, []],
      [{ agentType: 'npc_party', path: 'game_master', domain: 'map' }, []],
    ];
    for (const [ctx, expected] of cases) {
      expect(resolver.resolvePlacement('after_tool_call', ctx).matchedEntryIds).toEqual(expected);
    }
  });

  it('P6: 同维度多值 OR——agentTypes [gamemaster, npc_party] 两者均命中', () => {
    const resolver = makeResolver([
      entry('t2', 'impl-t', { hook: 'after_tool_call', agentTypes: ['gamemaster', 'npc_party'] }),
    ]);
    expect(resolver.resolvePlacement('after_tool_call', gmMasterCtx).matchedEntryIds).toEqual(['t2']);
    expect(
      resolver.resolvePlacement('after_tool_call', { agentType: 'npc_party', path: 'sub_agent' })
        .matchedEntryIds,
    ).toEqual(['t2']);
    expect(
      resolver.resolvePlacement('after_tool_call', { agentType: 'quest', path: 'sub_agent' })
        .matchedEntryIds,
    ).toEqual([]);
  });

  it('P7: 4 维度并列冲突——执行序 = 通用→Agent类型→路径→领域（固定秩，与声明序无关）', () => {
    const resolver = makeResolver([
      // 声明序故意与秩序相反：验证执行序由固定秩决定而非声明序
      entry('domain-e', 'impl-d', { hook: 'after_tool_call', domains: ['map'] }),
      entry('path-e', 'impl-p', { hook: 'after_tool_call', paths: ['game_master'] }),
      entry('type-e', 'impl-t', { hook: 'after_tool_call', agentTypes: ['gamemaster'] }),
      entry('generic-e', 'impl-g', { hook: 'after_tool_call' }),
    ]);
    const chain = resolver.resolvePlacement('after_tool_call', {
      agentType: 'gamemaster',
      path: 'game_master',
      domain: 'map',
    });
    expect(chain.matchedEntryIds).toEqual(['generic-e', 'type-e', 'path-e', 'domain-e']);
    expect(chain.hooks).toHaveLength(4);
  });

  it('P8: 同秩声明序——2 个通用 entry 按声明序执行', () => {
    const resolver = makeResolver([
      entry('first', 'impl-1', { hook: 'before_tool_call' }),
      entry('second', 'impl-2', { hook: 'before_tool_call' }),
    ]);
    expect(resolver.resolvePlacement('before_tool_call', gmMasterCtx).matchedEntryIds).toEqual([
      'first',
      'second',
    ]);
  });

  it('P9: order 微调——同秩后者 order:-1 时 order 小者先执行', () => {
    const resolver = makeResolver([
      entry('declared-first', 'impl-1', { hook: 'before_tool_call' }),
      entry('declared-second', 'impl-2', { hook: 'before_tool_call' }, { order: -1 }),
    ]);
    expect(resolver.resolvePlacement('before_tool_call', gmMasterCtx).matchedEntryIds).toEqual([
      'declared-second',
      'declared-first',
    ]);
  });

  it('P10: 无匹配——hooks 空链且不抛错（语义"无覆盖"，非错误）', () => {
    const resolver = makeResolver([
      entry('t1', 'impl-t', { hook: 'after_tool_call', agentTypes: ['gamemaster'] }),
    ]);
    const chain = resolver.resolvePlacement('after_tool_call', {
      agentType: 'quest',
      path: 'sub_agent',
    });
    expect(chain.hooks).toEqual([]);
    expect(chain.matchedEntryIds).toEqual([]);
    expect(chain.degraded).toBe(false);
  });

  it('P11: enabled:false——entry 禁用即跳过（等效删除但保留配置痕迹）', () => {
    const resolver = makeResolver([
      entry('disabled-e', 'impl-1', { hook: 'before_tool_call' }, { enabled: false }),
      entry('active-e', 'impl-2', { hook: 'before_tool_call' }),
    ]);
    expect(resolver.resolvePlacement('before_tool_call', gmMasterCtx).matchedEntryIds).toEqual([
      'active-e',
    ]);
  });

  it('P12: 组合 entry 秩 = 最高维——agentTypes+domains 组合秩=3（晚于路径秩 2 执行）', () => {
    const resolver = makeResolver([
      // 组合 entry 声明在前，若按声明序会先执行；秩=3 决定其必须晚于路径秩 2
      entry('combo', 'impl-c', {
        hook: 'after_tool_call',
        agentTypes: ['gamemaster'],
        domains: ['map'],
      }),
      entry('path-only', 'impl-p', { hook: 'after_tool_call', paths: ['game_master'] }),
    ]);
    const chain = resolver.resolvePlacement('after_tool_call', {
      agentType: 'gamemaster',
      path: 'game_master',
      domain: 'map',
    });
    expect(chain.matchedEntryIds).toEqual(['path-only', 'combo']);
  });

  it('P13: 缓存一致性——同参数二次解析引用相等；reload 后缓存清空', () => {
    const entries = [entry('g1', 'impl-g', { hook: 'after_tool_call' })];
    const resolver = makeResolver(entries);

    const first = resolver.resolvePlacement('after_tool_call', gmMasterCtx);
    const second = resolver.resolvePlacement('after_tool_call', gmMasterCtx);
    expect(second).toBe(first);

    resolver.reload(entries);
    const third = resolver.resolvePlacement('after_tool_call', gmMasterCtx);
    expect(third).not.toBe(first);
    expect(third.matchedEntryIds).toEqual(['g1']);
  });

  it('P14: resolver 异常降级——implRegistry.get 抛异常 → 默认链 + degraded:true，不抛出', () => {
    const brokenRegistry: IHookImplRegistry = {
      register: () => undefined,
      get: () => {
        throw new Error('registry corrupted');
      },
      has: () => false,
      listIds: () => [],
    };
    const entries = [entry('g1', 'impl-g', { hook: 'before_tool_call' })];

    let resolver: HookPlacementResolver | undefined;
    expect(() => {
      resolver = new HookPlacementResolver({ entries, implRegistry: brokenRegistry, implDeps });
    }).not.toThrow();

    // before_tool_call 默认链 = readonly-guard + arg-normalizer（D4.7：降级不能丢 readonly 防护）
    const beforeChain = resolver?.resolvePlacement('before_tool_call', gmMasterCtx);
    expect(beforeChain?.degraded).toBe(true);
    expect(beforeChain?.hooks).toHaveLength(2);
    expect(beforeChain?.matchedEntryIds).toEqual([]);

    // after_tool_call 默认链 = result-normalizer 单 hook
    expect(resolver?.resolvePlacement('after_tool_call', gmMasterCtx).hooks).toHaveLength(1);

    // 无默认 hook 的 hook 名 → 空链而非抛错
    const emptyChain = resolver?.resolvePlacement('before_model_select', gmMasterCtx);
    expect(emptyChain?.degraded).toBe(true);
    expect(emptyChain?.hooks).toEqual([]);
  });

  it('P16: domain 解析——map_service 去后缀 / dynamic_ui 原样 / 无分隔符与空串无 domain', () => {
    expect(resolveDomainFromToolName('map_service__create_location')).toBe('map');
    expect(resolveDomainFromToolName('help_service__get_help')).toBe('help');
    expect(resolveDomainFromToolName('dynamic_ui__render')).toBe('dynamic_ui');
    expect(resolveDomainFromToolName('noSep')).toBeUndefined();
    expect(resolveDomainFromToolName('')).toBeUndefined();
    expect(resolveDomainFromToolName(undefined)).toBeUndefined();
    expect(resolveDomainFromToolName('__no-prefix')).toBeUndefined();
  });
});

describe('hook-placement-config 启动期校验（M4 §11.2 V1-V8）', () => {
  const KNOWN_REFS = new Set(['impl-a', 'impl-b']);

  function asConfig(loose: unknown): HookPlacementConfig {
    // 非法配置构造助手：V1-V8 校验的输入本就是类型系统之外的 YAML 解析产物
    return loose as HookPlacementConfig;
  }

  const validEntry = { id: 'e1', hookRef: 'impl-a', selector: { hook: 'before_tool_call' } };

  it('V1: entry.id 全局唯一——重复 id 启动抛错（含 entry 定位）', () => {
    const config = asConfig({ version: 1, entries: [validEntry, { ...validEntry, hookRef: 'impl-b' }] });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).toThrow(/V1.*entries\[1\].*"e1".*重复/);
  });

  it('V2: hookRef 必须存在于 HookImplRegistry——幽灵引用启动抛错', () => {
    const config = asConfig({ version: 1, entries: [{ ...validEntry, hookRef: 'ghost-impl' }] });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).toThrow(/V2.*"ghost-impl"/);
  });

  it('V3: selector.hook 必须是合法 AgentHookName——非法 hook 名启动抛错', () => {
    const config = asConfig({
      version: 1,
      entries: [{ ...validEntry, selector: { hook: 'not-a-hook' } }],
    });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).toThrow(/V3.*"not-a-hook"/);
  });

  it('V4: selector.agentTypes 值必须在 AgentType 枚举内——非法值启动抛错', () => {
    const config = asConfig({
      version: 1,
      entries: [{ ...validEntry, selector: { hook: 'before_tool_call', agentTypes: ['not-a-type'] } }],
    });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).toThrow(/V4.*"not-a-type"/);
  });

  it('V5: selector.paths 值必须在 AgentRequestPath 枚举内——非法值启动抛错', () => {
    const config = asConfig({
      version: 1,
      entries: [{ ...validEntry, selector: { hook: 'before_tool_call', paths: ['not-a-path'] } }],
    });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).toThrow(/V5.*"not-a-path"/);
  });

  it('V6: domains 仅允许工具调用 hook——其他 hook 配 domains 启动抛错，工具调用 hook 合法', () => {
    const illegal = asConfig({
      version: 1,
      entries: [{ ...validEntry, selector: { hook: 'before_model_select', domains: ['map'] } }],
    });
    expect(() => validateHookPlacementConfig(illegal, KNOWN_REFS)).toThrow(/V6/);

    const legal = asConfig({
      version: 1,
      entries: [
        { ...validEntry, selector: { hook: 'before_tool_call', domains: ['map'] } },
        { id: 'e2', hookRef: 'impl-b', selector: { hook: 'after_tool_call', domains: ['quest'] } },
      ],
    });
    expect(() => validateHookPlacementConfig(legal, KNOWN_REFS)).not.toThrow();
  });

  it('V7: 纯 {hook} 选择器 = 通用维度——合法不抛错', () => {
    const config = asConfig({ version: 1, entries: [validEntry] });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).not.toThrow();
  });

  it('V8: version 必须为 1——未知版本启动抛错', () => {
    const config = asConfig({ version: 2, entries: [validEntry] });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).toThrow(/version=2/);
  });

  it('合法全量配置——4 维度组合 entry 全部通过', () => {
    const config = asConfig({
      version: 1,
      entries: [
        validEntry,
        { id: 'e2', hookRef: 'impl-b', selector: { hook: 'after_tool_call', agentTypes: ['gamemaster'] } },
        { id: 'e3', hookRef: 'impl-a', selector: { hook: 'after_tool_call', paths: ['pool_generation'] } },
        {
          id: 'e4',
          hookRef: 'impl-b',
          selector: { hook: 'after_tool_call', agentTypes: ['gamemaster'], domains: ['map'] },
          order: -1,
          enabled: false,
        },
      ],
    });
    expect(() => validateHookPlacementConfig(config, KNOWN_REFS)).not.toThrow();
  });
});

describe('hook-placement.yaml 交付物一致性（补充守卫：子任务E接线前 YAML 的唯一防漂移用例）', () => {
  it('YAML 通过 V1-V8 校验 + 6 内建 entry 与 HookImplRegistry 对应关系正确 + 真实注册表可解析', () => {
    const yamlPath = fileURLToPath(new URL('../../../../config/hook-placement.yaml', import.meta.url));
    const config = yaml.load(readFileSync(yamlPath, 'utf-8')) as HookPlacementConfig;

    const registry = buildHookImplRegistry();
    expect(() => validateHookPlacementConfig(config, registry)).not.toThrow();

    const pairs = config.entries.map((e) => [e.hookRef, e.selector.hook]);
    expect(pairs).toEqual([
      ['readonly-guard', 'before_tool_call'],
      ['arg-normalizer', 'before_tool_call'],
      ['result-normalizer', 'after_tool_call'],
      ['fail-recovery-seed', 'after_agent_fail'],
      ['progress-broadcaster', 'report_progress'],
      ['audit-on-task-complete', 'on_task_complete'],
    ]);

    // 真实注册表端到端解析（before_tool_call 两个内建工厂无外部依赖，可安全物化）
    const resolver = new HookPlacementResolver({ entries: config.entries, implRegistry: registry, implDeps });
    const chain = resolver.resolvePlacement('before_tool_call', {
      agentType: 'gamemaster',
      path: 'game_master',
      domain: 'map',
    });
    expect(chain.degraded).toBe(false);
    expect(chain.matchedEntryIds).toEqual(['generic-readonly-guard', 'generic-arg-normalizer']);
    expect(chain.hooks).toHaveLength(2);
  });
});
