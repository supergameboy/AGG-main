/**
 * EntityResolverBase 单元测试（13.2 规则）。
 *
 * 测试目标：
 * - 验证 resolve 方法的三阶段解析流程（ID 匹配 → name 匹配 → 时间戳消歧）
 * - 验证 resolveMany 批量解析（并行 + 单个失败即整体抛错）
 * - 验证 trx 事务透传到子类方法
 * - 验证 EntityResolutionError 三种 reason（not_found / multiple_match_no_timestamp / multiple_match_ambiguous）
 * - 验证 not_found 错误含候选列表（最多 10 个，按 createdAt DESC 排序）
 *
 * 测试策略：
 * - 创建 TestEntityResolver 子类，通过 vi.fn() mock findById/findByName/listCandidates
 * - 不依赖具体领域 Repository，专注测试基类逻辑
 */

import { describe, it, expect, vi } from 'vitest';
import type { Knex } from 'knex';
import { EntityResolverBase } from '../EntityResolverBase.js';
import { EntityResolutionError } from '../EntityResolutionError.js';
import type { EntityRef, ResolvedEntity } from '../types.js';

// ─── 测试用子类 ──────────────────────────────────────────────────────────

class TestEntityResolver extends EntityResolverBase {
  findByIdMock = vi.fn<(saveId: string, ref: string, trx?: Knex.Transaction) => Promise<ResolvedEntity | null>>();
  findByNameMock = vi.fn<(saveId: string, ref: string, trx?: Knex.Transaction) => Promise<ResolvedEntity[]>>();
  listCandidatesMock = vi.fn<(saveId: string, trx: Knex.Transaction | undefined, limit: number) => Promise<ResolvedEntity[]>>();

  constructor() {
    super({} as unknown as Knex);
  }

  protected override findById(saveId: string, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity | null> {
    return this.findByIdMock(saveId, ref, trx);
  }

  protected override findByName(saveId: string, ref: string, trx?: Knex.Transaction): Promise<ResolvedEntity[]> {
    return this.findByNameMock(saveId, ref, trx);
  }

  protected override listCandidates(
    saveId: string,
    trx: Knex.Transaction | undefined,
    limit: number,
  ): Promise<ResolvedEntity[]> {
    return this.listCandidatesMock(saveId, trx, limit);
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────

function makeResolved(
  entityId: string,
  label: string,
  matchedBy: 'id' | 'name',
  timestamp?: number,
): ResolvedEntity {
  return {
    entityId,
    label,
    entityType: 'npc', // 测试用任意类型
    matchedBy,
    timestampMatched: 'none', // 由基类覆写
    timestamp,
  };
}

function makeRef(ref: string, options?: { timestamp?: number }): EntityRef {
  return {
    saveId: 'save-001',
    entityType: 'npc',
    ref,
    timestamp: options?.timestamp,
  };
}

// ─── 测试用例 ──────────────────────────────────────────────────────────

describe('EntityResolverBase', () => {
  describe('resolve — 阶段1: ID 精确匹配', () => {
    it('ID 命中时直接返回，跳过 name 匹配', async () => {
      const resolver = new TestEntityResolver();
      const expected = makeResolved('npc_001', '艾莉娅', 'id', 1000);
      resolver.findByIdMock.mockResolvedValue(expected);
      resolver.findByNameMock.mockResolvedValue([]);

      const result = await resolver.resolve(makeRef('npc_001'));

      expect(result).toEqual(expected);
      expect(resolver.findByIdMock).toHaveBeenCalledWith('save-001', 'npc_001', undefined);
      expect(resolver.findByNameMock).not.toHaveBeenCalled();
    });

    it('ID 匹配时透传 trx 到子类 findById', async () => {
      const resolver = new TestEntityResolver();
      const trx = { isTransaction: true } as unknown as Knex.Transaction;
      resolver.findByIdMock.mockResolvedValue(makeResolved('npc_001', '艾莉娅', 'id'));

      await resolver.resolve(makeRef('npc_001'), trx);

      expect(resolver.findByIdMock).toHaveBeenCalledWith('save-001', 'npc_001', trx);
    });
  });

  describe('resolve — 阶段2: name 单匹配', () => {
    it('ID 未命中 + name 单匹配 → 返回 matchedBy=name', async () => {
      const resolver = new TestEntityResolver();
      const byName = makeResolved('npc_002', '艾莉娅', 'name', 1000);
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([byName]);

      const result = await resolver.resolve(makeRef('艾莉娅'));

      expect(result.entityId).toBe('npc_002');
      expect(result.matchedBy).toBe('name');
    });

    it('name 单匹配时无 timestamp → timestampMatched=none', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([makeResolved('npc_002', '艾莉娅', 'name', 1000)]);

      const result = await resolver.resolve(makeRef('艾莉娅'));

      expect(result.timestampMatched).toBe('none');
    });

    it('name 单匹配时 timestamp 相同 → timestampMatched=same', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([makeResolved('npc_002', '艾莉娅', 'name', 1000)]);

      const result = await resolver.resolve(makeRef('艾莉娅', { timestamp: 1000 }));

      expect(result.timestampMatched).toBe('same');
    });

    it('name 单匹配时 timestamp 不同 → timestampMatched=different', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([makeResolved('npc_002', '艾莉娅', 'name', 1000)]);

      const result = await resolver.resolve(makeRef('艾莉娅', { timestamp: 2000 }));

      expect(result.timestampMatched).toBe('different');
    });
  });

  describe('resolve — 阶段3: name 多匹配 + 时间戳消歧', () => {
    it('多匹配 + timestamp 相同的只有一个 → 返回该实体', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', '艾莉娅', 'name', 1000),
        makeResolved('npc_002', '艾莉娅', 'name', 2000),
      ]);

      const result = await resolver.resolve(makeRef('艾莉娅', { timestamp: 1000 }));

      expect(result.entityId).toBe('npc_001');
      expect(result.timestampMatched).toBe('same');
    });

    it('多匹配 + same 唯一 → 返回该实体（timestampMatched=same）', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', '艾莉娅', 'name', 1000), // same
        makeResolved('npc_002', '艾莉娅', 'name', 2000), // different
      ]);

      const result = await resolver.resolve(makeRef('艾莉娅', { timestamp: 1000 }));

      expect(result.entityId).toBe('npc_001');
      expect(result.timestampMatched).toBe('same');
    });

    it('多匹配 + same=0 + different>1 → 抛 multiple_match_ambiguous', async () => {
      // byName.length=2, ref.timestamp 不匹配任何实体 → same=0, different=2
      // different.length > 1 → 抛错（different.length===1 分支不可达，因进入阶段3 要求 byName>1）
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', '艾莉娅', 'name', 1000),
        makeResolved('npc_002', '艾莉娅', 'name', 2000),
      ]);

      try {
        await resolver.resolve(makeRef('艾莉娅', { timestamp: 9999 }));
        expect.fail('应抛 EntityResolutionError');
      } catch (error) {
        expect(error).toBeInstanceOf(EntityResolutionError);
        expect((error as EntityResolutionError).reason).toBe('multiple_match_ambiguous');
        // candidates 是 different 列表（2 个）
        expect((error as EntityResolutionError).candidates).toHaveLength(2);
      }
    });

    it('多匹配 + 同 timestamp 仍多匹配 → 抛 multiple_match_ambiguous', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', '艾莉娅', 'name', 1000),
        makeResolved('npc_002', '艾莉娅', 'name', 1000),
      ]);

      try {
        await resolver.resolve(makeRef('艾莉娅', { timestamp: 1000 }));
        expect.fail('应抛 EntityResolutionError');
      } catch (error) {
        expect(error).toBeInstanceOf(EntityResolutionError);
        expect((error as EntityResolutionError).reason).toBe('multiple_match_ambiguous');
        expect((error as EntityResolutionError).candidates).toHaveLength(2);
      }
    });

    it('多匹配 + 不同 timestamp 仍多匹配 → 抛 multiple_match_ambiguous', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', '艾莉娅', 'name', 1000),
        makeResolved('npc_002', '艾莉娅', 'name', 2000),
        makeResolved('npc_003', '艾莉娅', 'name', 3000),
      ]);

      try {
        await resolver.resolve(makeRef('艾莉娅', { timestamp: 9999 }));
        expect.fail('应抛 EntityResolutionError');
      } catch (error) {
        expect(error).toBeInstanceOf(EntityResolutionError);
        expect((error as EntityResolutionError).reason).toBe('multiple_match_ambiguous');
        // 不同 timestamp 的有 3 个
        expect((error as EntityResolutionError).candidates).toHaveLength(3);
      }
    });

    it('多匹配 + 无 timestamp → 抛 multiple_match_no_timestamp', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', '艾莉娅', 'name', 1000),
        makeResolved('npc_002', '艾莉娅', 'name', 2000),
      ]);

      try {
        await resolver.resolve(makeRef('艾莉娅'));
        expect.fail('应抛 EntityResolutionError');
      } catch (error) {
        expect(error).toBeInstanceOf(EntityResolutionError);
        expect((error as EntityResolutionError).reason).toBe('multiple_match_no_timestamp');
      }
    });
  });

  describe('resolve — not_found 错误', () => {
    it('ID 未命中 + name 0 匹配 → 抛 not_found 含候选列表', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([]);
      const candidates = [
        makeResolved('npc_101', '候选1', 'name', 5000),
        makeResolved('npc_102', '候选2', 'name', 4000),
      ];
      resolver.listCandidatesMock.mockResolvedValue(candidates);

      try {
        await resolver.resolve(makeRef('不存在的NPC'));
        expect.fail('应抛 EntityResolutionError');
      } catch (error) {
        expect(error).toBeInstanceOf(EntityResolutionError);
        expect((error as EntityResolutionError).reason).toBe('not_found');
        expect((error as EntityResolutionError).candidates).toEqual(candidates);
      }

      // listCandidates 应被调用，limit=10
      expect(resolver.listCandidatesMock).toHaveBeenCalledWith('save-001', undefined, 10);
    });

    it('not_found 时透传 trx 到 listCandidates', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([]);
      resolver.listCandidatesMock.mockResolvedValue([]);
      const trx = { isTransaction: true } as unknown as Knex.Transaction;

      try {
        await resolver.resolve(makeRef('不存在'), trx);
      } catch {
        // 预期抛错
      }

      expect(resolver.listCandidatesMock).toHaveBeenCalledWith('save-001', trx, 10);
    });
  });

  describe('resolve — trx 透传', () => {
    it('trx 透传到 findByName（ID 未命中时）', async () => {
      const resolver = new TestEntityResolver();
      const trx = { isTransaction: true } as unknown as Knex.Transaction;
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([makeResolved('npc_001', '艾莉娅', 'name')]);

      await resolver.resolve(makeRef('艾莉娅'), trx);

      expect(resolver.findByNameMock).toHaveBeenCalledWith('save-001', '艾莉娅', trx);
    });
  });

  describe('resolveMany — 批量解析', () => {
    it('全部解析成功 → 返回数组（顺序一致）', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock
        .mockResolvedValueOnce(makeResolved('npc_001', 'A', 'id'))
        .mockResolvedValueOnce(makeResolved('npc_002', 'B', 'id'));

      const refs = [makeRef('npc_001'), makeRef('npc_002')];
      const results = await resolver.resolveMany(refs);

      expect(results).toHaveLength(2);
      expect(results[0].entityId).toBe('npc_001');
      expect(results[1].entityId).toBe('npc_002');
    });

    it('任一失败 → 整体抛错', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock
        .mockResolvedValueOnce(makeResolved('npc_001', 'A', 'id'))
        .mockResolvedValueOnce(null); // 第二个 ID 未命中
      resolver.findByNameMock
        .mockResolvedValueOnce([]) // 第二个 name 也未匹配
        .mockResolvedValueOnce([]);
      resolver.listCandidatesMock.mockResolvedValue([]);

      const refs = [makeRef('npc_001'), makeRef('不存在')];

      await expect(resolver.resolveMany(refs)).rejects.toThrow(EntityResolutionError);
    });

    it('空数组 → 返回空数组', async () => {
      const resolver = new TestEntityResolver();
      const results = await resolver.resolveMany([]);
      expect(results).toEqual([]);
    });

    it('trx 透传到批量解析的所有 resolve 调用', async () => {
      const resolver = new TestEntityResolver();
      const trx = { isTransaction: true } as unknown as Knex.Transaction;
      resolver.findByIdMock.mockResolvedValue(makeResolved('npc_001', 'A', 'id'));

      await resolver.resolveMany([makeRef('npc_001'), makeRef('npc_002')], trx);

      // 两次 findById 调用都应透传 trx
      expect(resolver.findByIdMock).toHaveBeenNthCalledWith(1, 'save-001', 'npc_001', trx);
      expect(resolver.findByIdMock).toHaveBeenNthCalledWith(2, 'save-001', 'npc_002', trx);
    });
  });

  describe('EntityResolutionError — 错误信息构建', () => {
    it('not_found 错误信息含 entityType、ref、候选列表、修复建议', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([]);
      resolver.listCandidatesMock.mockResolvedValue([
        makeResolved('npc_101', '候选1', 'name', 5000),
      ]);

      try {
        await resolver.resolve(makeRef('不存在'));
      } catch (error) {
        const err = error as EntityResolutionError;
        expect(err.message).toContain('npc');
        expect(err.message).toContain("ref='不存在'");
        expect(err.message).toContain('saveId=save-001');
        expect(err.message).toContain('候选1');
        expect(err.message).toContain('list_entities_by_type');
      }
    });

    it('multiple_match 错误信息含 reason 说明', async () => {
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', 'A', 'name', 1000),
        makeResolved('npc_002', 'B', 'name', 2000),
      ]);

      try {
        await resolver.resolve(makeRef('艾莉娅'));
      } catch (error) {
        const err = error as EntityResolutionError;
        expect(err.message).toContain('label 匹配多个节点且未传 timestamp');
        expect(err.message).toContain('timestamp');
      }
    });
  });

  describe('不可达路径防护', () => {
    it('timestamp 过滤后 same=0 + different=0 应抛错（不可达）', async () => {
      // 此路径不可达：byName.length > 1 已被拦截，same + different 必然 > 0
      // 但若子类 findByName 返回 timestamp=undefined 的实体，filter 会全部归入 different
      const resolver = new TestEntityResolver();
      resolver.findByIdMock.mockResolvedValue(null);
      // 两个 timestamp=undefined 的实体
      resolver.findByNameMock.mockResolvedValue([
        makeResolved('npc_001', 'A', 'name', undefined),
        makeResolved('npc_002', 'B', 'name', undefined),
      ]);

      // ref.timestamp=1000，same=0（因 entity.timestamp=undefined !== 1000），different=2
      // 应抛 multiple_match_ambiguous
      await expect(resolver.resolve(makeRef('A', { timestamp: 1000 }))).rejects.toThrow(EntityResolutionError);
    });
  });
});
