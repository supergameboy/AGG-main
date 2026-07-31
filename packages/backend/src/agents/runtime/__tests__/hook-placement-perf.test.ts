/**
 * hook-placement-resolver 性能基准（M4 设计 §15.3，用例 B1-B4）。
 *
 * 阈值全部取自设计文档 §15.3（B1 <100ms / B2 <500ms / B3 <50ms / B4 <5ms），禁止自造。
 * 解析路径零排序零正则（§12.2）：4 次 Map.get + 数组拼接 + LRU 查询，
 * 相对 LLM 调用（秒级）完全可忽略——本文件是该论证的可执行证据。
 */

import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { IWebSocketBroadcaster } from '@ai-rpg/shared/messaging';
import { HookImplRegistry, type HookImplDeps } from '../hook-impl-registry.js';
import { HookPlacementResolver } from '../hook-placement-resolver.js';
import {
  AGENT_REQUEST_PATHS,
  AGENT_TYPES,
  type HookPlacementEntry,
  type HookPlacementSelector,
} from '../hook-placement-config.js';
import type { HookEventName, HookPlacementContext } from '../types.js';

const implDeps: HookImplDeps = {
  webSocketService: {} as IWebSocketBroadcaster,
};

const DOMAIN_VALUES = ['map', 'quest', 'inventory', 'skill', 'npc'] as const;

/** 构造 count 个 entry（4 个维度均布，hookRef 逐一注册），模拟真实配置量级（§12.3：数十~一百） */
function buildPerfEntries(count: number): { entries: HookPlacementEntry[]; registry: HookImplRegistry } {
  const registry = new HookImplRegistry();
  const entries: HookPlacementEntry[] = [];
  for (let i = 0; i < count; i++) {
    const hookRef = `perf-impl-${i}`;
    registry.register(hookRef, () => async () => undefined);
    const dimension = i % 4;
    const selector: HookPlacementSelector =
      dimension === 1
        ? { hook: 'after_tool_call', agentTypes: [AGENT_TYPES[i % AGENT_TYPES.length]] }
        : dimension === 2
          ? { hook: 'after_tool_call', paths: [AGENT_REQUEST_PATHS[i % AGENT_REQUEST_PATHS.length]] }
          : dimension === 3
            ? { hook: 'after_tool_call', domains: [DOMAIN_VALUES[i % DOMAIN_VALUES.length]] }
            : { hook: 'after_tool_call' };
    entries.push({ id: `perf-entry-${i}`, hookRef, selector });
  }
  return { entries, registry };
}

/** 30 个混合维度上下文（§12.2：典型 GM 请求 10-30 次 resolvePlacement） */
function buildContexts(count: number): Array<{ name: HookEventName; ctx: HookPlacementContext }> {
  const contexts: Array<{ name: HookEventName; ctx: HookPlacementContext }> = [];
  for (let i = 0; i < count; i++) {
    contexts.push({
      name: 'after_tool_call',
      ctx: {
        agentType: AGENT_TYPES[i % AGENT_TYPES.length],
        path: AGENT_REQUEST_PATHS[i % AGENT_REQUEST_PATHS.length],
        domain: DOMAIN_VALUES[i % DOMAIN_VALUES.length],
      },
    });
  }
  return contexts;
}

describe('hook-placement-resolver 性能基准（M4 §15.3）', () => {
  it('B1: 10,000 次 resolvePlacement（混合维度，缓存开启）总耗时 < 100ms', () => {
    const { entries, registry } = buildPerfEntries(100);
    const resolver = new HookPlacementResolver({ entries, implRegistry: registry, implDeps });
    const contexts = buildContexts(30);

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const { name, ctx } = contexts[i % contexts.length];
      resolver.resolvePlacement(name, ctx);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it('B2: 10,000 次 resolvePlacement（缓存关闭）总耗时 < 500ms——验证缓存必要性', () => {
    const { entries, registry } = buildPerfEntries(100);
    const resolver = new HookPlacementResolver({
      entries,
      implRegistry: registry,
      implDeps,
      cacheCapacity: 0,
    });
    const contexts = buildContexts(30);

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const { name, ctx } = contexts[i % contexts.length];
      resolver.resolvePlacement(name, ctx);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it('B3: 索引构建（100 entry × 4 维度）< 50ms', () => {
    const { entries, registry } = buildPerfEntries(100);

    const start = performance.now();
    new HookPlacementResolver({ entries, implRegistry: registry, implDeps });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('B4: 模拟单请求 30 次派发端到端 < 5ms（不含 hook 执行体）', () => {
    const { entries, registry } = buildPerfEntries(100);
    const resolver = new HookPlacementResolver({ entries, implRegistry: registry, implDeps });
    const contexts = buildContexts(30);

    // 预热一轮：排除 JIT 冷启动对测量的干扰（阈值针对稳态解析开销）
    for (const { name, ctx } of contexts) {
      resolver.resolvePlacement(name, ctx);
    }

    const start = performance.now();
    for (const { name, ctx } of contexts) {
      resolver.resolvePlacement(name, ctx);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });
});
