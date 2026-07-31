import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ID } from '../../../../shared/src/types/core.js';
import { ContextInjector } from '../context-injector.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tempDirs: string[] = [];
const createdInjectors: ContextInjector[] = [];

function createConfigFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'context-injector-'));
  tempDirs.push(dir);
  const filePath = join(dir, 'agent-context-rules.yaml');
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * 创建 ContextInjector 并登记到 createdInjectors，供 afterEach 统一 dispose。
 * 必须使用本 helper 而非直接 `new ContextInjector`，避免文件监听器资源泄漏。
 */
function createInjector(configPath: string): ContextInjector {
  const injector = new ContextInjector(configPath);
  createdInjectors.push(injector);
  return injector;
}

afterEach(() => {
  for (const injector of createdInjectors) {
    injector.dispose();
  }
  createdInjectors.length = 0;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('ContextInjector', () => {
  it('应并行抓取规则并保持输出顺序稳定', async () => {
    const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 200
    required:
      - id: first
        source: memory
        method: getFirst
        format: compact
        description: 第一段
      - id: second
        source: memory
        method: getSecond
        format: compact
        description: 第二段
`);
    const injector = createInjector(configPath);
    const firstDeferred = createDeferred<string>();
    const secondDeferred = createDeferred<string>();
    const startedMethods: string[] = [];

    const injectPromise = injector.injectForAgent(
      'dialogue',
      'save-1' as ID,
      async (_source, method) => {
        startedMethods.push(method);
        if (method === 'getFirst') {
          return firstDeferred.promise;
        }
        return secondDeferred.promise;
      }
    );

    await Promise.resolve();
    expect(startedMethods).toEqual(['getFirst', 'getSecond']);

    secondDeferred.resolve('第二条上下文');
    firstDeferred.resolve('第一条上下文');

    const injected = await injectPromise;
    expect(injected).toContain('## 第一段');
    expect(injected).toContain('## 第二段');
    expect(injected!.indexOf('## 第一段')).toBeLessThan(injected!.indexOf('## 第二段'));
  });

  it('对同一 agent/saveId 的并发请求应复用 in-flight 快照', async () => {
    const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 200
    required:
      - id: snapshot
        source: memory
        method: getSnapshot
        format: compact
        description: 快照
`);
    const injector = createInjector(configPath);
    const deferred = createDeferred<string>();
    const fetcher = vi.fn(async () => deferred.promise);

    const firstPromise = injector.injectForAgent('dialogue', 'save-1' as ID, fetcher);
    const secondPromise = injector.injectForAgent('dialogue', 'save-1' as ID, fetcher);

    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    deferred.resolve('共享快照');
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toBe(second);
  });

  it('超出 token 预算时应保持前缀优先语义并停止后续注入', async () => {
    const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 10
    required:
      - id: first
        source: memory
        method: first
        format: compact
        description: 第一段
      - id: second
        source: memory
        method: second
        format: compact
        description: 第二段
      - id: third
        source: memory
        method: third
        format: compact
        description: 第三段
`);
    const injector = createInjector(configPath);

    const injected = await injector.injectForAgent(
      'dialogue',
      'save-1' as ID,
      async (_source, method) => {
        if (method === 'first') return '123456';
        if (method === 'second') return '12345678901234567890';
        return '123';
      }
    );

    expect(injected).toContain('## 第一段');
    expect(injected).not.toContain('## 第二段');
    expect(injected).not.toContain('## 第三段');
  });

  it('命中 token 预算后不应继续抓取后续规则', async () => {
    const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 10
    required:
      - id: first
        source: memory
        method: first
        format: compact
        description: 第一段
      - id: second
        source: memory
        method: second
        format: compact
        description: 第二段
      - id: third
        source: memory
        method: third
        format: compact
        description: 第三段
`);
    const injector = createInjector(configPath);
    const fetcher = vi.fn(async (_source: string, method: string) => {
      if (method === 'first') return '123456';
      if (method === 'second') return '12345678901234567890';
      return 'should-not-fetch';
    });

    await injector.injectForAgent('dialogue', 'save-1' as ID, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => call[1])).toEqual(['first', 'second']);
  });

  it('应对多个 agent 聚合去重并共享抓取结果', async () => {
    const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 200
    required:
      - id: shared_location
        source: map_service
        method: get_current_location
        format: compact
        description: 当前位置
      - id: dialogue_history
        source: dialogue_service
        method: get_recent_dialogue
        format: compact
        description: 最近对话
  ui:
    max_context_tokens: 200
    required:
      - id: shared_location
        source: map_service
        method: get_current_location
        format: compact
        description: 当前位置
      - id: active_quests
        source: quest_service
        method: get_active_quests
        format: compact
        description: 当前任务
`);
    const injector = createInjector(configPath);
    const fetcher = vi.fn(async (source: string, method: string) => `${source}:${method}`);

    const snapshots = await (injector as any).prefetchForAgents(
      ['dialogue', 'ui'],
      'save-1' as ID,
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenCalledWith('map_service', 'get_current_location', { saveId: 'save-1' }, 'save-1', undefined);
    expect(fetcher).toHaveBeenCalledWith('dialogue_service', 'get_recent_dialogue', { saveId: 'save-1' }, 'save-1', undefined);
    expect(fetcher).toHaveBeenCalledWith('quest_service', 'get_active_quests', { saveId: 'save-1' }, 'save-1', undefined);
    expect(snapshots.get('dialogue')).toContain('map_service:get_current_location');
    expect(snapshots.get('dialogue')).toContain('dialogue_service:get_recent_dialogue');
    expect(snapshots.get('ui')).toContain('map_service:get_current_location');
    expect(snapshots.get('ui')).toContain('quest_service:get_active_quests');
  });

  it('批量预取时单个 agent 上下文失败不应拖垮其他 agent', async () => {
    const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 4
    required:
      - id: huge_context
        source: story_service
        method: get_context
        format: compact
        description: 巨大上下文
  ui:
    max_context_tokens: 200
    required:
      - id: location
        source: map_service
        method: get_current_location
        format: compact
        description: 当前位置
`);
    const injector = createInjector(configPath);

    const snapshots = await injector.prefetchForAgents(
      ['dialogue', 'ui'],
      'save-1' as ID,
      async (source: string, method: string) => {
        if (source === 'story_service') {
          return `${method}-0123456789-very-long-context`;
        }
        return `${source}:${method}`;
      },
    );

    expect(snapshots.get('dialogue')).toBeNull();
    expect(snapshots.get('ui')).toContain('map_service:get_current_location');
  });

  it('中间规则无数据时仍应继续抓取并注入后续可用规则', async () => {
    const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 200
    required:
      - id: first
        source: memory
        method: first
        format: compact
        description: 第一段
      - id: second
        source: memory
        method: second
        format: compact
        description: 第二段
      - id: third
        source: memory
        method: third
        format: compact
        description: 第三段
`);
    const injector = createInjector(configPath);
    const fetcher = vi.fn(async (_source: string, method: string) => {
      if (method === 'first') return 'first-context';
      if (method === 'second') return null;
      return 'third-context';
    });

    const injected = await injector.injectForAgent('dialogue', 'save-1' as ID, fetcher);

    expect(fetcher.mock.calls.map((call) => call[1])).toEqual(['first', 'second', 'third']);
    expect(injected).toContain('## 第一段');
    expect(injected).not.toContain('## 第二段');
    expect(injected).toContain('## 第三段');
  });

  describe('自动去重机制', () => {
    it('getCoveredSources 应根据 peerResult keys 推导被覆盖的 sources', () => {
      const configPath = createConfigFile(`
context_rules:
  npc_party:
    max_context_tokens: 200
    required:
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
      - id: npc_location
        source: map_service
        method: get_location
        format: compact
        description: NPC位置
  map:
    max_context_tokens: 200
    required:
      - id: current_location
        source: map_service
        method: get_current_location
        format: compact
        description: 当前位置
  dialogue:
    max_context_tokens: 200
    required:
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
      - id: dialogue_history
        source: dialogue_service
        method: get_recent_dialogue
        format: compact
        description: 最近对话
`);
      const injector = createInjector(configPath);

      // npc_party 覆盖 npc_service + map_service
      const covered = injector.getCoveredSources(['npc_party', 'map']);
      expect(covered.has('npc_service')).toBe(true);
      expect(covered.has('map_service')).toBe(true);
      expect(covered.has('dialogue_service')).toBe(false);
    });

    it('getCoveredSources 对空 peerResult keys 应返回空集', () => {
      const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 200
    required:
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
`);
      const injector = createInjector(configPath);
      const covered = injector.getCoveredSources([]);
      expect(covered.size).toBe(0);
    });

    it('buildContextSnapshotFiltered 应自动过滤被 peerResults 覆盖的预加载项', async () => {
      const configPath = createConfigFile(`
context_rules:
  npc_party:
    max_context_tokens: 200
    required:
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
      - id: npc_location
        source: map_service
        method: get_location
        format: compact
        description: NPC位置
  dialogue:
    max_context_tokens: 200
    required:
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
      - id: dialogue_history
        source: dialogue_service
        method: get_recent_dialogue
        format: compact
        description: 最近对话
`);
      const injector = createInjector(configPath);
      const fetcher = vi.fn(async (source: string, method: string) => `${source}:${method}`);

      // dialogue 的预加载中，npc_service 被 npc_party 的 peerResult 覆盖
      const result = await injector.buildContextSnapshotFiltered(
        'dialogue',
        'save-1' as ID,
        fetcher,
        ['npc_party'],
      );

      // npc_service 的规则应被过滤，只保留 dialogue_service
      expect(result.context).not.toContain('附近NPC');
      expect(result.context).toContain('最近对话');
      // 只调用了 dialogue_service，没调用 npc_service
      expect(fetcher).toHaveBeenCalledWith('dialogue_service', 'get_recent_dialogue', { saveId: 'save-1' }, 'save-1', undefined);
      expect(fetcher).not.toHaveBeenCalledWith('npc_service', expect.anything(), expect.anything(), expect.anything(), expect.anything());
    });

    it('prefetchForAgentsFiltered 应为不同 Agent 传入不同的 peerResult keys', async () => {
      const configPath = createConfigFile(`
context_rules:
  npc_party:
    max_context_tokens: 200
    required:
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
  dialogue:
    max_context_tokens: 200
    required:
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
      - id: dialogue_history
        source: dialogue_service
        method: get_recent_dialogue
        format: compact
        description: 最近对话
`);
      const injector = createInjector(configPath);
      const fetcher = vi.fn(async (source: string, method: string) => `${source}:${method}`);

      const agentPeerKeys = new Map<string, string[]>([
        ['npc_party', []],           // Layer 1: 无 peerResults，不过滤
        ['dialogue', ['npc_party']], // Layer 3: npc_party 覆盖 npc_service
      ]);

      const snapshots = await injector.prefetchForAgentsFiltered(
        ['npc_party', 'dialogue'],
        'save-1' as ID,
        fetcher,
        agentPeerKeys,
      );

      // npc_party 应包含 npc_service 数据
      expect(snapshots.get('npc_party')).toContain('npc_service:list_npcs');
      // dialogue 应过滤掉 npc_service，只保留 dialogue_service
      expect(snapshots.get('dialogue')).not.toContain('附近NPC');
      expect(snapshots.get('dialogue')).toContain('最近对话');
    });
  });

  // ────────────────────────────────────────────────
  // C10: 预加载上下文不得暴露 source.method
  // 修复点：buildContextSection 使用 rule.description 作为标题，
  //         而非 `来源: ${source.method}`，避免 LLM 推断工具调用名
  //         破坏 pre-load 第一层隐藏机制
  // ────────────────────────────────────────────────
  describe('预加载上下文隐藏机制（C10）', () => {
    it('注入内容不暴露 source.method（修复 pre-load 第一层隐藏机制泄露）', async () => {
      const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 200
    required:
      - id: character_status
        source: character_service
        method: get_full_status
        format: compact
        description: 角色当前状态
`);
      const injector = createInjector(configPath);
      const fetcher = vi.fn(async () => '角色数据：HP=100, MP=50');

      const injected = await injector.injectForAgent('dialogue', 'save-1' as ID, fetcher);

      expect(injected).not.toBeNull();
      // 标题应使用 description，不应暴露 source.method
      expect(injected).toContain('## 角色当前状态');
      expect(injected).not.toContain('character_service.get_full_status');
      expect(injected).not.toContain('character_service__get_full_status');
      expect(injected).not.toContain('来源: character_service');
    });

    it('多条规则的注入内容均不暴露 source.method', async () => {
      const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 500
    required:
      - id: character_status
        source: character_service
        method: get_full_status
        format: compact
        description: 角色当前状态
      - id: nearby_npcs
        source: npc_service
        method: list_npcs
        format: compact
        description: 附近NPC
      - id: current_location
        source: map_service
        method: get_current_location
        format: compact
        description: 当前位置
`);
      const injector = createInjector(configPath);
      const fetcher = vi.fn(async (_source: string, method: string) => {
        if (method === 'get_full_status') return 'HP=100';
        if (method === 'list_npcs') return '村长, 商人';
        return '白杨村';
      });

      const injected = await injector.injectForAgent('dialogue', 'save-1' as ID, fetcher);

      expect(injected).not.toBeNull();
      // 三条规则都应使用 description 作为标题
      expect(injected).toContain('## 角色当前状态');
      expect(injected).toContain('## 附近NPC');
      expect(injected).toContain('## 当前位置');
      // 不应暴露任何 source.method 组合
      expect(injected).not.toContain('character_service');
      expect(injected).not.toContain('npc_service');
      expect(injected).not.toContain('map_service');
      expect(injected).not.toContain('get_full_status');
      expect(injected).not.toContain('list_npcs');
      expect(injected).not.toContain('get_current_location');
    });

    it('injectedMethods 仍保留 source/method 元数据供程序内部使用', async () => {
      const configPath = createConfigFile(`
context_rules:
  dialogue:
    max_context_tokens: 200
    required:
      - id: character_status
        source: character_service
        method: get_full_status
        format: compact
        description: 角色当前状态
`);
      const injector = createInjector(configPath);
      const fetcher = vi.fn(async () => 'HP=100');

      const result = await injector.injectForAgentDetailed('dialogue', 'save-1' as ID, fetcher);

      // 元数据保留在 injectedMethods 中供程序去重使用
      expect(result.injectedMethods).toHaveLength(1);
      expect(result.injectedMethods[0]).toEqual({
        source: 'character_service',
        method: 'get_full_status',
      });
      // 但 context 字符串本身不应暴露
      expect(result.context).not.toContain('character_service');
      expect(result.context).not.toContain('get_full_status');
    });
  });
});
