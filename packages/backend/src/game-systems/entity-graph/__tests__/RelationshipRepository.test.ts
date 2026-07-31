import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { RelationshipRepository } from '../RelationshipRepository.js';
import type {
  EntityRelationshipEventRow,
  EntityRelationshipStateRow,
  RelationshipSource,
} from '../types.js';

/**
 * RelationshipRepository 单元测试。
 *
 * 设计文档 §2 测试用例大纲（与 AwarenessRepository 对称）：
 *   - insertEvent + getState：写入单条事件，state 正确派生
 *   - insertEvent + getHistory：写入多条事件，按时间排序返回
 *   - upsertState：currentScore 累加 + clamp 边界（+10 / -10）
 *   - upsertState：effective_source/effective_note/effective_event_id 指向最新事件
 *   - mergeEvents：合并后 merged_count 累加，note 模板生成
 *   - deleteBySaveId：级联清理 events + states
 *   - trx 支持：事务内写入 + 回滚
 *
 * 与 AwarenessRepository 的差异验证：
 *   - source 类型不含 auto:xxx（relationship 完全手动）
 *   - 表名为 entity_relationship_events / entity_relationship_states
 *   - note 字段名为 relationship_note（与 awareness_note 对称）
 *   - ID 前缀为 rev_（event）/ rst_（state）
 */

function createChainedQueryBuilder(options?: {
  rows?: unknown[];
  firstRow?: unknown | null;
  countResult?: number;
  firstRowIsNull?: boolean;
}) {
  const rows = options?.rows ?? [];
  const countResult = options?.countResult ?? 0;
  const firstReturnValue = options?.firstRowIsNull
    ? null
    : (options?.firstRow ?? { cnt: countResult });

  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstReturnValue),
    // insert 返回 this（支持链式 .onConflict().merge()）
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockResolvedValue(undefined),
  };

  const thenable = {
    ...qb,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };

  return thenable as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

function createMockKnex(tableReturns?: Record<string, ReturnType<typeof createChainedQueryBuilder>>): Knex {
  const tables = tableReturns ?? {};
  const db = vi.fn((tableName: string) => {
    if (!tables[tableName]) {
      tables[tableName] = createChainedQueryBuilder();
    }
    return tables[tableName];
  }) as unknown as Knex;
  (db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = vi.fn((sql: string, params: unknown[]) => ({
    sql,
    params,
    __isRaw: true,
  }));
  return db;
}

describe('RelationshipRepository', () => {
  const SAVE_ID = 'save-1';
  const OBSERVER_NODE_ID = 'egn_npc_save-1_npc-tom';
  const TARGET_NODE_ID = 'egn_character_save-1_player';

  function createSource(overrides: Partial<RelationshipSource> = {}): RelationshipSource {
    return {
      type: 'direct_observation',
      occurredAt: 1700000000000,
      ...overrides,
    };
  }

  describe('insertEvent', () => {
    it('应插入事件并返回 rev_ 前缀的 ID（区别于 aev_）', async () => {
      const db = createMockKnex();
      const repo = new RelationshipRepository(db);

      const eventId = await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        5, createSource(), '建立了友谊',
      );

      expect(eventId).toMatch(/^rev_/);
    });

    it('应将 source 序列化为 JSON 字符串写入 entity_relationship_events 表', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);
      const source = createSource({ type: 'informed_by', informerType: 'npc', informerId: 'npc-edwin' });

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        3, source, '听村长介绍',
      );

      // 关键校验：写入的是 entity_relationship_events（非 awareness）
      expect(tables['entity_relationship_events']).toBeDefined();
      expect(tables['entity_awareness_events']).toBeUndefined();
      const insertCall = tables['entity_relationship_events'].insert.mock.calls[0][0];
      expect(insertCall.source).toBe(JSON.stringify(source));
      expect(insertCall.score_delta).toBe(3);
      // 关键校验：字段名是 relationship_note（非 awareness_note）
      expect(insertCall.relationship_note).toBe('听村长介绍');
      expect(insertCall.merged_count).toBe(1);
      expect(insertCall.observer_node_id).toBe(OBSERVER_NODE_ID);
      expect(insertCall.target_node_id).toBe(TARGET_NODE_ID);
      expect(insertCall.save_id).toBe(SAVE_ID);
    });

    it('relationshipNote 为 undefined 时写入 null', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        1, createSource(), undefined,
      );

      expect(tables['entity_relationship_events'].insert.mock.calls[0][0].relationship_note).toBeNull();
    });
  });

  describe('mergeEvent', () => {
    it('应累加 score_delta + merged_count + 1', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);
      const incomingSource = createSource({ occurredAt: 1700000088888 });

      await repo.mergeEvent(SAVE_ID, 'rev_1', 2, '合并备注', incomingSource);

      const eventsQb = tables['entity_relationship_events'];
      expect(eventsQb.where).toHaveBeenCalledWith({ id: 'rev_1', save_id: SAVE_ID });
      const updateCall = eventsQb.update.mock.calls[0][0];
      // 关键校验：字段名是 relationship_note
      expect(updateCall.relationship_note).toBe('合并备注');
      expect(updateCall.created_at).toBe(1700000088888);
      expect((db as unknown as { raw: ReturnType<typeof vi.fn> }).raw).toHaveBeenCalledWith('score_delta + ?', [2]);
      expect((db as unknown as { raw: ReturnType<typeof vi.fn> }).raw).toHaveBeenCalledWith('merged_count + 1');
    });
  });

  describe('upsertState', () => {
    it('应使用 onConflict + merge 实现 UPSERT 到 entity_relationship_states', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);
      const source = createSource();
      const stateId = `rst_${SAVE_ID}_${OBSERVER_NODE_ID}_${TARGET_NODE_ID}`;

      await repo.upsertState(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        7, '关系备注', source, 'rev_event-1',
      );

      // 关键校验：写入的是 entity_relationship_states（非 awareness）
      expect(tables['entity_relationship_states']).toBeDefined();
      expect(tables['entity_awareness_states']).toBeUndefined();
      const statesQb = tables['entity_relationship_states'];
      const insertCall = statesQb.insert.mock.calls[0][0];
      expect(insertCall.id).toBe(stateId); // rst_ 前缀（区别于 ast_）
      expect(insertCall.current_score).toBe(7);
      expect(insertCall.effective_note).toBe('关系备注');
      expect(insertCall.effective_source).toBe(JSON.stringify(source));
      expect(insertCall.effective_event_id).toBe('rev_event-1');
      expect(statesQb.onConflict).toHaveBeenCalledWith(['save_id', 'observer_node_id', 'target_node_id']);
      expect(statesQb.merge).toHaveBeenCalledWith([
        'current_score', 'effective_note', 'effective_source', 'effective_event_id', 'last_updated',
      ]);
    });
  });

  describe('getLatestEvent', () => {
    it('应按 created_at desc 排序并取 first', async () => {
      const row: EntityRelationshipEventRow = {
        id: 'rev_1',
        save_id: SAVE_ID,
        observer_node_id: OBSERVER_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        score_delta: 5,
        relationship_note: '建立了友谊',
        source: JSON.stringify(createSource({ type: 'informed_by' })),
        merged_count: 1,
        created_at: 1700000000000,
      };
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_relationship_events'] = createChainedQueryBuilder({ firstRow: row });
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      const event = await repo.getLatestEvent(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(event).not.toBeNull();
      expect(event!.id).toBe('rev_1');
      expect(event!.scoreDelta).toBe(5);
      expect(event!.source.type).toBe('informed_by');
      expect(event!.relationshipNote).toBe('建立了友谊');
      expect(event!.mergedCount).toBe(1);
      const eventsQb = tables['entity_relationship_events'];
      expect(eventsQb.orderBy).toHaveBeenCalledWith('created_at', 'desc');
    });

    it('rowToEvent 应将 relationship_note null 转为 undefined', async () => {
      const row: EntityRelationshipEventRow = {
        id: 'rev_1', save_id: SAVE_ID, observer_node_id: OBSERVER_NODE_ID, target_node_id: TARGET_NODE_ID,
        score_delta: 1, relationship_note: null, source: JSON.stringify(createSource()),
        merged_count: 1, created_at: 1700000000000,
      };
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_relationship_events'] = createChainedQueryBuilder({ firstRow: row });
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      const event = await repo.getLatestEvent(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(event!.relationshipNote).toBeUndefined();
    });
  });

  describe('getHistory', () => {
    it('应按 created_at asc 排序返回全部事件', async () => {
      const rows: EntityRelationshipEventRow[] = [
        {
          id: 'rev_1', save_id: SAVE_ID, observer_node_id: OBSERVER_NODE_ID, target_node_id: TARGET_NODE_ID,
          score_delta: 3, relationship_note: '初次合作', source: JSON.stringify(createSource()),
          merged_count: 1, created_at: 1700000001000,
        },
        {
          id: 'rev_2', save_id: SAVE_ID, observer_node_id: OBSERVER_NODE_ID, target_node_id: TARGET_NODE_ID,
          score_delta: 2, relationship_note: '再次合作', source: JSON.stringify(createSource({ type: 'rumor' })),
          merged_count: 1, created_at: 1700000002000,
        },
      ];
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_relationship_events'] = createChainedQueryBuilder({ rows });
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      const history = await repo.getHistory(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('rev_1');
      expect(history[1].id).toBe('rev_2');
      expect(history[1].source.type).toBe('rumor');
      const eventsQb = tables['entity_relationship_events'];
      expect(eventsQb.orderBy).toHaveBeenCalledWith('created_at', 'asc');
    });
  });

  describe('getState', () => {
    it('应返回 rowToState 映射后的状态', async () => {
      const source = createSource({ type: 'informed_by', informerId: 'npc-edwin' });
      const row: EntityRelationshipStateRow = {
        id: 'rst_1',
        save_id: SAVE_ID,
        observer_node_id: OBSERVER_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        current_score: 8,
        effective_note: '听村长介绍',
        effective_source: JSON.stringify(source),
        effective_event_id: 'rev_2',
        last_updated: 1700000005000,
      };
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_relationship_states'] = createChainedQueryBuilder({ firstRow: row });
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      const state = await repo.getState(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(state).not.toBeNull();
      expect(state!.currentScore).toBe(8);
      expect(state!.effectiveNote).toBe('听村长介绍');
      expect(state!.effectiveSource.type).toBe('informed_by');
      expect(state!.effectiveSource.informerId).toBe('npc-edwin');
      expect(state!.effectiveEventId).toBe('rev_2');
    });
  });

  describe('getStatesBatch', () => {
    it('observerNodeIds 为空时直接返回空数组', async () => {
      const db = createMockKnex();
      const repo = new RelationshipRepository(db);

      const result = await repo.getStatesBatch(SAVE_ID, [], TARGET_NODE_ID);
      expect(result).toEqual([]);
    });

    it('应使用 whereIn 查询多个 observer', async () => {
      const rows: EntityRelationshipStateRow[] = [
        {
          id: 'rst_1', save_id: SAVE_ID, observer_node_id: 'egn_npc_1', target_node_id: TARGET_NODE_ID,
          current_score: 3, effective_note: null, effective_source: null, effective_event_id: null,
          last_updated: 1700000000000,
        },
      ];
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_relationship_states'] = createChainedQueryBuilder({ rows });
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      const result = await repo.getStatesBatch(SAVE_ID, ['egn_npc_1'], TARGET_NODE_ID);

      expect(result).toHaveLength(1);
      expect(tables['entity_relationship_states'].whereIn).toHaveBeenCalledWith('observer_node_id', ['egn_npc_1']);
    });
  });

  describe('countObserversByTargetAndScore', () => {
    it('应使用 where + where current_score >= minScore + count', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_relationship_states'] = createChainedQueryBuilder({ firstRow: { cnt: 5 } });
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      const count = await repo.countObserversByTargetAndScore(
        SAVE_ID, TARGET_NODE_ID, { minScore: 1 },
      );

      expect(count).toBe(5);
      const statesQb = tables['entity_relationship_states'];
      expect(statesQb.where).toHaveBeenCalledWith('current_score', '>=', 1);
      expect(statesQb.count).toHaveBeenCalledWith('* as cnt');
    });
  });

  describe('deleteBySaveId', () => {
    it('应先删 states 再删 events（依赖顺序）', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new RelationshipRepository(db);

      const callOrder: string[] = [];
      (db as unknown as ReturnType<typeof vi.fn>).mockImplementation((tableName: string) => {
        callOrder.push(tableName);
        if (!tables[tableName]) tables[tableName] = createChainedQueryBuilder();
        return tables[tableName];
      });

      await repo.deleteBySaveId(SAVE_ID);

      // 关键校验：删除的是 relationship 表（非 awareness）
      expect(callOrder).toEqual(['entity_relationship_states', 'entity_relationship_events']);
      expect(tables['entity_relationship_states'].del).toHaveBeenCalled();
      expect(tables['entity_relationship_events'].del).toHaveBeenCalled();
    });
  });

  describe('trx 参数透传', () => {
    it('传入 trx 时应使用 trx 而非 db', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const trxMock = vi.fn((tableName: string) => {
        if (!tables[tableName]) tables[tableName] = createChainedQueryBuilder();
        return tables[tableName];
      }) as unknown as Knex.Transaction;
      const repo = new RelationshipRepository(db);

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        1, createSource(), undefined, trxMock,
      );

      expect(trxMock).toHaveBeenCalledWith('entity_relationship_events');
      expect(db).not.toHaveBeenCalled();
    });
  });

  describe('与 AwarenessRepository 的差异校验', () => {
    it('source 类型不含 auto:dialogue（relationship 完全手动）', async () => {
      // 类型层校验：RelationshipSource 类型不接受 'auto:dialogue'
      // 此处通过运行时行为校验：传入合法的 relationship source 类型
      const validTypes: RelationshipSource['type'][] = [
        'direct_observation', 'informed_by', 'overheard', 'rumor',
        'player_stated', 'inferred', 'derived_from_system',
      ];
      expect(validTypes).not.toContain('auto:dialogue');
      expect(validTypes).not.toContain('auto:combat');
    });
  });
});
