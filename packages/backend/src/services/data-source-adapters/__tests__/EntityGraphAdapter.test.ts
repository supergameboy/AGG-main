import { describe, expect, it } from 'vitest';
import { EntityGraphAdapter } from '../EntityGraphAdapter.js';
import type {
  ContextSection,
  DataProviders,
  ExpandContext,
} from '../../../../../shared/src/types/context-manifest.js';
import type { ID } from '../../../../../shared/src/types/core.js';

/**
 * 模块4 单元测试：EntityGraphAdapter
 *
 * 覆盖设计文档"实现效果描述"中的关键期望：
 * - 期望效果 1：9 个 tag 后缀路由正确
 * - 期望效果 1：filter 必填字段缺失抛错（含 tag 名 + 字段名）
 * - 期望效果 2：provider 9 方法签名一一对应
 * - 期望效果 3：default 分支抛错含合法值清单
 *
 * 测试策略：
 * - 用 mock provider 返回可识别字符串，断言 adapter 调用了正确的方法
 * - 用空 mock provider 触发 filter 缺失抛错，断言错误信息
 * - 子图默认 depth=2，entityType 默认 'npc'，构造 centerNodeId 格式正确
 */

function createMockProvider(): DataProviders['entityGraphProvider'] & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const track =
    <M extends string>(method: M) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return Promise.resolve(`mock:${method}`);
    };
  return {
    getNpcProfile: track('getNpcProfile') as never,
    getLocationSummary: track('getLocationSummary') as never,
    getEntityRelations: track('getEntityRelations') as never,
    getWorldStateSummary: track('getWorldStateSummary') as never,
    getFullGraph: track('getFullGraph') as never,
    getSubgraph: track('getSubgraph') as never,
    getNodesByType: track('getNodesByType') as never,
    getPerceivesEdges: track('getPerceivesEdges') as never,
    getEntityAwareness: track('getEntityAwareness') as never,
    calls,
  };
}

function createExpandContext(
  provider: DataProviders['entityGraphProvider'],
  saveId: ID = 'save-test',
): ExpandContext {
  return {
    saveId,
    templateId: 'tpl-1',
    providers: {
      templateRecordProvider: { get: () => null },
      templatePoolProvider: { listSkills: async () => [], listItems: async () => [] },
      savePoolProvider: {
        listCharacters: async () => [],
        listLocations: async () => [],
        listNpcs: async () => [],
        listQuests: async () => [],
        listSkills: async () => [],
        listItems: async () => [],
        listDialogues: async () => [],
        listEvents: async () => [],
        getCombatState: async () => null,
      },
      gameStateProvider: {
        getFullStatus: async () => null,
        getGameTime: async () => null,
        getPacingState: async () => null,
      },
      entityGraphProvider: provider,
    },
  };
}

function makeSection(tag: string, filter?: ContextSection['filter'], format?: ContextSection['format']): ContextSection {
  return { tag, filter, format };
}

describe('EntityGraphAdapter', () => {
  it('tagPrefix 为 "关系数据."', () => {
    const adapter = new EntityGraphAdapter();
    expect(adapter.tagPrefix).toBe('关系数据.');
  });

  describe('9 个 tag 后缀路由正确', () => {
    it('关系数据.NPC关系 → provider.getNpcProfile(saveId, entityId)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(
        makeSection('关系数据.NPC关系', { entityId: 'npc_001' }),
        createExpandContext(provider),
      );
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toEqual({
        method: 'getNpcProfile',
        args: ['save-test', 'npc_001'],
      });
    });

    it('关系数据.地点关系 → provider.getLocationSummary(saveId, entityId)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(
        makeSection('关系数据.地点关系', { entityId: 'loc_village' }),
        createExpandContext(provider),
      );
      expect(provider.calls[0]).toEqual({
        method: 'getLocationSummary',
        args: ['save-test', 'loc_village'],
      });
    });

    it('关系数据.实体关系 → provider.getEntityRelations(saveId, entityType, entityId)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(
        makeSection('关系数据.实体关系', { entityId: 'npc_001', entityType: 'npc' }),
        createExpandContext(provider),
      );
      expect(provider.calls[0]).toEqual({
        method: 'getEntityRelations',
        args: ['save-test', 'npc', 'npc_001'],
      });
    });

    it('关系数据.全图概览 → provider.getWorldStateSummary(saveId)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(makeSection('关系数据.全图概览'), createExpandContext(provider));
      expect(provider.calls[0]).toEqual({
        method: 'getWorldStateSummary',
        args: ['save-test'],
      });
    });

    it('关系数据.全图 → provider.getFullGraph(saveId)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(makeSection('关系数据.全图'), createExpandContext(provider));
      expect(provider.calls[0]).toEqual({
        method: 'getFullGraph',
        args: ['save-test'],
      });
    });

    it('关系数据.子图 → provider.getSubgraph(saveId, centerNodeId, depth)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(
        makeSection('关系数据.子图', { entityId: 'npc_001', entityType: 'npc', depth: 3 }),
        createExpandContext(provider, 'save-1'),
      );
      expect(provider.calls[0]).toEqual({
        method: 'getSubgraph',
        args: ['save-1', 'npc:save-1:npc_001', 3],
      });
    });

    it('关系数据.子图 默认 entityType=npc, depth=2', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(
        makeSection('关系数据.子图', { entityId: 'entity_x' }),
        createExpandContext(provider, 'save-2'),
      );
      expect(provider.calls[0]).toEqual({
        method: 'getSubgraph',
        args: ['save-2', 'npc:save-2:entity_x', 2],
      });
    });

    it('关系数据.节点列表 → provider.getNodesByType(saveId, entityType)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(
        makeSection('关系数据.节点列表', { entityType: 'location' }),
        createExpandContext(provider),
      );
      expect(provider.calls[0]).toEqual({
        method: 'getNodesByType',
        args: ['save-test', 'location'],
      });
    });

    it('关系数据.感知边 → provider.getPerceivesEdges(saveId)', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(makeSection('关系数据.感知边'), createExpandContext(provider));
      expect(provider.calls[0]).toEqual({
        method: 'getPerceivesEdges',
        args: ['save-test'],
      });
    });

    it('关系数据.感知查询 → provider.getEntityAwareness(saveId, entityType, entityId) 3 参数', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await adapter.expand(
        makeSection('关系数据.感知查询', { entityId: 'npc_001', entityType: 'npc' }),
        createExpandContext(provider),
      );
      // 设计偏差修订后：3 参数（saveId, entityType, entityId）
      expect(provider.calls[0]).toEqual({
        method: 'getEntityAwareness',
        args: ['save-test', 'npc', 'npc_001'],
      });
    });
  });

  describe('filter 必填字段缺失抛错', () => {
    it('NPC关系 缺失 entityId 抛错，错误信息含 tag + 字段名', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(makeSection('关系数据.NPC关系', {}), createExpandContext(provider)),
      ).rejects.toThrow('关系数据.NPC关系 需要 filter.entityId 参数');
      expect(provider.calls).toHaveLength(0);
    });

    it('地点关系 缺失 entityId 抛错', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(makeSection('关系数据.地点关系'), createExpandContext(createMockProvider())),
      ).rejects.toThrow('关系数据.地点关系 需要 filter.entityId 参数');
    });

    it('实体关系 缺失 entityId 抛错（优先于 entityType）', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(
          makeSection('关系数据.实体关系', { entityType: 'npc' }),
          createExpandContext(createMockProvider()),
        ),
      ).rejects.toThrow('关系数据.实体关系 需要 filter.entityId 参数');
    });

    it('实体关系 缺失 entityType 抛错', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(
          makeSection('关系数据.实体关系', { entityId: 'x' }),
          createExpandContext(createMockProvider()),
        ),
      ).rejects.toThrow('关系数据.实体关系 需要 filter.entityType 参数');
    });

    it('子图 缺失 entityId 抛错', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(
          makeSection('关系数据.子图', { depth: 2 }),
          createExpandContext(createMockProvider()),
        ),
      ).rejects.toThrow('关系数据.子图 需要 filter.entityId 参数');
    });

    it('节点列表 缺失 entityType 抛错', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(makeSection('关系数据.节点列表'), createExpandContext(createMockProvider())),
      ).rejects.toThrow('关系数据.节点列表 需要 filter.entityType 参数');
    });

    it('感知查询 缺失 entityId 抛错（优先于 entityType）', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(
          makeSection('关系数据.感知查询', { entityType: 'npc' }),
          createExpandContext(createMockProvider()),
        ),
      ).rejects.toThrow('关系数据.感知查询 需要 filter.entityId 参数');
    });

    it('感知查询 缺失 entityType 抛错', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(
          makeSection('关系数据.感知查询', { entityId: 'x' }),
          createExpandContext(createMockProvider()),
        ),
      ).rejects.toThrow('关系数据.感知查询 需要 filter.entityType 参数');
    });
  });

  describe('default 分支抛错含合法值清单', () => {
    it('未知后缀抛错含 9 个合法值', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(makeSection('关系数据.未知'), createExpandContext(createMockProvider())),
      ).rejects.toThrow(/未知的关系数据 tag 后缀: 未知/);
    });

    it('错误信息包含全部 9 个合法后缀', async () => {
      const adapter = new EntityGraphAdapter();
      await expect(
        adapter.expand(makeSection('关系数据.未知'), createExpandContext(createMockProvider())),
      ).rejects.toThrow(
        'NPC关系/地点关系/实体关系/全图概览/全图/子图/节点列表/感知边/感知查询',
      );
    });
  });

  describe('format 选项正确传递', () => {
    it('yaml_block 格式（默认）', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      const result = await adapter.expand(
        makeSection('关系数据.全图概览', undefined, 'yaml_block'),
        createExpandContext(provider),
      );
      // mock 返回 'mock:getWorldStateSummary' 字符串 → toYamlBlock 直接 String(data)
      expect(result).toBe('mock:getWorldStateSummary');
    });

    it('full_data 格式输出 JSON', async () => {
      const provider = createMockProvider();
      const adapter = new EntityGraphAdapter();
      const result = await adapter.expand(
        makeSection('关系数据.全图概览', undefined, 'full_data'),
        createExpandContext(provider),
      );
      expect(result).toBe(JSON.stringify('mock:getWorldStateSummary', null, 2));
    });
  });
});
