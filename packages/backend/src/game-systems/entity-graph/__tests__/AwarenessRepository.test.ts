import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { AwarenessRepository } from '../AwarenessRepository.js';
import type {
  EntityAwarenessEventRow,
  EntityAwarenessStateRow,
  AwarenessSource,
} from '../types.js';

/**
 * AwarenessRepository 单元测试。
 *
 * 设计文档 §1 测试用例大纲：
 *   - insertEvent + getState：写入单条事件，state 正确派生
 *   - insertEvent + getHistory：写入多条事件，按时间排序返回
 *   - upsertState：currentScore 累加 + clamp 边界（+10 / -10）
 *   - upsertState：effective_source/effective_note/effective_event_id 指向最新事件
 *   - mergeEvents：合并后 merged_count 累加，note 模板生成
 *   - deleteBySaveId：级联清理 events + states
 *   - trx 支持：事务内写入 + 回滚
 *
 * Mock 策略：
 *   - Knex query builder 链式调用 mock：query(table) → queryBuilder
 *   - queryBuilder.where/orderBy/first/insert/update/onConflict/whereIn/count/del 链式返回
 *   - 通过 mockReturnValue 返回链式 queryBuilder 或 Promise<row>
 *   - 验证 SQL 调用参数（表名、字段名、where 条件、orderBy 方向）
 *
 * Row → Entity 映射验证：
 *   - rowToEvent：JSON.parse(source)、awareness_note ?? undefined
 *   - rowToState：JSON.parse(effective_source)、effective_note ?? undefined
 */

function createChainedQueryBuilder(options?: {
  rows?: unknown[];            // 查询返回的行数组
  firstRow?: unknown | null;   // first() 返回的行（显式传 null 时返回 null）
  countResult?: number;        // count().first() 返回的 { cnt } 中的数值
  firstRowIsNull?: boolean;    // 显式标记 first() 应返回 null（区分未设置 vs 显式 null）
}) {
  const rows = options?.rows ?? [];
  const countResult = options?.countResult ?? 0;
  // 区分"未设置 firstRow"（默认 { cnt: countResult }，兼容 count().first() 场景）与"显式 null"（应返回 null）
  const firstReturnValue = options?.firstRowIsNull
    ? null
    : (options?.firstRow ?? { cnt: countResult });

  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstReturnValue),
    // insert/update 返回 this（支持链式 .onConflict().merge()），不直接 resolve
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockResolvedValue(undefined),
  };

  // 使 queryBuilder 可 thenable（await 时触发，返回 rows 数组）
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
  // 附加 raw 方法（mergeEvent 使用 query.raw）
  (db as unknown as { raw: ReturnType<typeof vi.fn> }).raw = vi.fn((sql: string, params: unknown[]) => ({
    sql,
    params,
    __isRaw: true,
  }));
  return db;
}

describe('AwarenessRepository', () => {
  const SAVE_ID = 'save-1';
  const OBSERVER_NODE_ID = 'egn_npc_save-1_npc-tom';
  const TARGET_NODE_ID = 'egn_character_save-1_player';

  function createSource(overrides: Partial<AwarenessSource> = {}): AwarenessSource {
    return {
      type: 'direct_observation',
      occurredAt: 1700000000000,
      ...overrides,
    };
  }

  describe('insertEvent', () => {
    it('应插入事件并返回 aev_ 前缀的 ID', async () => {
      const db = createMockKnex();
      const repo = new AwarenessRepository(db);
      const source = createSource();

      const eventId = await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        5, source, '看到了玩家',
      );

      expect(eventId).toMatch(/^aev_/);
      const eventsQb = (db as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === 'entity_awareness_events',
      );
      expect(eventsQb).toBeDefined();
    });

    it('应将 source 序列化为 JSON 字符串写入', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);
      const source = createSource({ type: 'informed_by', informerType: 'npc', informerId: 'npc-edwin' });

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        3, source, '听村长说',
      );

      const insertCall = tables['entity_awareness_events'].insert.mock.calls[0][0];
      expect(insertCall.source).toBe(JSON.stringify(source));
      expect(insertCall.score_delta).toBe(3);
      expect(insertCall.awareness_note).toBe('听村长说');
      expect(insertCall.merged_count).toBe(1);
      expect(insertCall.observer_node_id).toBe(OBSERVER_NODE_ID);
      expect(insertCall.target_node_id).toBe(TARGET_NODE_ID);
      expect(insertCall.save_id).toBe(SAVE_ID);
    });

    it('awarenessNote 为 undefined 时写入 null', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        1, createSource(), undefined,
      );

      expect(tables['entity_awareness_events'].insert.mock.calls[0][0].awareness_note).toBeNull();
    });

    it('created_at 使用 source.occurredAt', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);
      const occurredAt = 1700000099999;

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        1, createSource({ occurredAt }), undefined,
      );

      expect(tables['entity_awareness_events'].insert.mock.calls[0][0].created_at).toBe(occurredAt);
    });
  });

  describe('mergeEvent', () => {
    it('应累加 score_delta + merged_count + 1', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);
      const eventId = 'aev_existing-1';
      const incomingSource = createSource({ occurredAt: 1700000088888 });

      await repo.mergeEvent(SAVE_ID, eventId, 2, '合并备注', incomingSource);

      const eventsQb = tables['entity_awareness_events'];
      expect(eventsQb.where).toHaveBeenCalledWith({ id: eventId, save_id: SAVE_ID });
      const updateCall = eventsQb.update.mock.calls[0][0];
      expect(updateCall.awareness_note).toBe('合并备注');
      expect(updateCall.created_at).toBe(1700000088888);
      // score_delta + merged_count 使用 query.raw，验证 raw 调用
      expect((db as unknown as { raw: ReturnType<typeof vi.fn> }).raw).toHaveBeenCalledWith('score_delta + ?', [2]);
      expect((db as unknown as { raw: ReturnType<typeof vi.fn> }).raw).toHaveBeenCalledWith('merged_count + 1');
    });

    it('incomingNote 为 undefined 时 awareness_note 写入 null', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      await repo.mergeEvent(SAVE_ID, 'aev_1', 1, undefined, createSource());

      expect(tables['entity_awareness_events'].update.mock.calls[0][0].awareness_note).toBeNull();
    });
  });

  describe('upsertState', () => {
    it('应使用 onConflict + merge 实现 UPSERT', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);
      const source = createSource();
      const stateId = `ast_${SAVE_ID}_${OBSERVER_NODE_ID}_${TARGET_NODE_ID}`;

      await repo.upsertState(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        7, '有效备注', source, 'aev_event-1',
      );

      const statesQb = tables['entity_awareness_states'];
      const insertCall = statesQb.insert.mock.calls[0][0];
      expect(insertCall.id).toBe(stateId);
      expect(insertCall.save_id).toBe(SAVE_ID);
      expect(insertCall.observer_node_id).toBe(OBSERVER_NODE_ID);
      expect(insertCall.target_node_id).toBe(TARGET_NODE_ID);
      expect(insertCall.current_score).toBe(7);
      expect(insertCall.effective_note).toBe('有效备注');
      expect(insertCall.effective_source).toBe(JSON.stringify(source));
      expect(insertCall.effective_event_id).toBe('aev_event-1');
      expect(statesQb.onConflict).toHaveBeenCalledWith(['save_id', 'observer_node_id', 'target_node_id']);
      expect(statesQb.merge).toHaveBeenCalledWith([
        'current_score', 'effective_note', 'effective_source', 'effective_event_id', 'last_updated',
      ]);
    });

    it('effectiveNote 为 undefined 时写入 null', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      await repo.upsertState(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        5, undefined, createSource(), 'aev_1',
      );

      expect(tables['entity_awareness_states'].insert.mock.calls[0][0].effective_note).toBeNull();
    });
  });

  describe('getLatestEvent', () => {
    it('应按 created_at desc 排序并取 first', async () => {
      const row: EntityAwarenessEventRow = {
        id: 'aev_1',
        save_id: SAVE_ID,
        observer_node_id: OBSERVER_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        score_delta: 5,
        awareness_note: '看到了玩家',
        source: JSON.stringify(createSource({ type: 'informed_by' })),
        merged_count: 1,
        created_at: 1700000000000,
      };
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_events'] = createChainedQueryBuilder({ firstRow: row });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const event = await repo.getLatestEvent(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      const eventsQb = tables['entity_awareness_events'];
      expect(eventsQb.where).toHaveBeenCalledWith({
        save_id: SAVE_ID,
        observer_node_id: OBSERVER_NODE_ID,
        target_node_id: TARGET_NODE_ID,
      });
      expect(eventsQb.orderBy).toHaveBeenCalledWith('created_at', 'desc');
      expect(eventsQb.first).toHaveBeenCalled();
      expect(event).not.toBeNull();
      expect(event!.id).toBe('aev_1');
      expect(event!.scoreDelta).toBe(5);
      expect(event!.source.type).toBe('informed_by');
      expect(event!.awarenessNote).toBe('看到了玩家');
      expect(event!.mergedCount).toBe(1);
    });

    it('无记录时返回 null', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_events'] = createChainedQueryBuilder({ firstRowIsNull: true });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const event = await repo.getLatestEvent(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);
      expect(event).toBeNull();
    });

    it('rowToEvent 应将 awareness_note null 转为 undefined', async () => {
      const row: EntityAwarenessEventRow = {
        id: 'aev_1',
        save_id: SAVE_ID,
        observer_node_id: OBSERVER_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        score_delta: 1,
        awareness_note: null,
        source: JSON.stringify(createSource()),
        merged_count: 1,
        created_at: 1700000000000,
      };
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_events'] = createChainedQueryBuilder({ firstRow: row });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const event = await repo.getLatestEvent(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(event!.awarenessNote).toBeUndefined();
    });
  });

  describe('getHistory', () => {
    it('应按 created_at asc 排序返回全部事件', async () => {
      const rows: EntityAwarenessEventRow[] = [
        {
          id: 'aev_1', save_id: SAVE_ID, observer_node_id: OBSERVER_NODE_ID, target_node_id: TARGET_NODE_ID,
          score_delta: 3, awareness_note: '第一次见', source: JSON.stringify(createSource()),
          merged_count: 1, created_at: 1700000001000,
        },
        {
          id: 'aev_2', save_id: SAVE_ID, observer_node_id: OBSERVER_NODE_ID, target_node_id: TARGET_NODE_ID,
          score_delta: 2, awareness_note: '第二次见', source: JSON.stringify(createSource({ type: 'auto:dialogue' })),
          merged_count: 3, created_at: 1700000002000,
        },
      ];
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_events'] = createChainedQueryBuilder({ rows });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const history = await repo.getHistory(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('aev_1');
      expect(history[1].id).toBe('aev_2');
      expect(history[1].source.type).toBe('auto:dialogue');
      expect(history[1].mergedCount).toBe(3);
      const eventsQb = tables['entity_awareness_events'];
      expect(eventsQb.orderBy).toHaveBeenCalledWith('created_at', 'asc');
    });

    it('无记录时返回空数组', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_events'] = createChainedQueryBuilder({ rows: [] });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const history = await repo.getHistory(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);
      expect(history).toEqual([]);
    });
  });

  describe('getState', () => {
    it('应返回 rowToState 映射后的状态', async () => {
      const source = createSource({ type: 'informed_by', informerId: 'npc-edwin' });
      const row: EntityAwarenessStateRow = {
        id: 'ast_1',
        save_id: SAVE_ID,
        observer_node_id: OBSERVER_NODE_ID,
        target_node_id: TARGET_NODE_ID,
        current_score: 8,
        effective_note: '听村长说',
        effective_source: JSON.stringify(source),
        effective_event_id: 'aev_2',
        last_updated: 1700000005000,
      };
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_states'] = createChainedQueryBuilder({ firstRow: row });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const state = await repo.getState(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(state).not.toBeNull();
      expect(state!.currentScore).toBe(8);
      expect(state!.effectiveNote).toBe('听村长说');
      expect(state!.effectiveSource.type).toBe('informed_by');
      expect(state!.effectiveSource.informerId).toBe('npc-edwin');
      expect(state!.effectiveEventId).toBe('aev_2');
      expect(state!.lastUpdated).toBe(1700000005000);
    });

    it('effective_source 为 null 时 fallback 到空对象', async () => {
      const row: EntityAwarenessStateRow = {
        id: 'ast_1', save_id: SAVE_ID, observer_node_id: OBSERVER_NODE_ID, target_node_id: TARGET_NODE_ID,
        current_score: 5, effective_note: null, effective_source: null, effective_event_id: null,
        last_updated: 1700000005000,
      };
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_states'] = createChainedQueryBuilder({ firstRow: row });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const state = await repo.getState(SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID);

      expect(state!.effectiveNote).toBeUndefined();
      expect(state!.effectiveSource).toEqual({} as AwarenessSource);
      expect(state!.effectiveEventId).toBe('');
    });
  });

  describe('getStatesBatch', () => {
    it('observerNodeIds 为空时直接返回空数组（不查 DB）', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const result = await repo.getStatesBatch(SAVE_ID, [], TARGET_NODE_ID);
      expect(result).toEqual([]);
      expect(tables['entity_awareness_states']).toBeUndefined();
    });

    it('应使用 whereIn 查询多个 observer', async () => {
      const rows: EntityAwarenessStateRow[] = [
        {
          id: 'ast_1', save_id: SAVE_ID, observer_node_id: 'egn_npc_1', target_node_id: TARGET_NODE_ID,
          current_score: 3, effective_note: null, effective_source: null, effective_event_id: null,
          last_updated: 1700000000000,
        },
        {
          id: 'ast_2', save_id: SAVE_ID, observer_node_id: 'egn_npc_2', target_node_id: TARGET_NODE_ID,
          current_score: 5, effective_note: null, effective_source: null, effective_event_id: null,
          last_updated: 1700000001000,
        },
      ];
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_states'] = createChainedQueryBuilder({ rows });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const result = await repo.getStatesBatch(
        SAVE_ID,
        ['egn_npc_1', 'egn_npc_2'],
        TARGET_NODE_ID,
      );

      expect(result).toHaveLength(2);
      const statesQb = tables['entity_awareness_states'];
      expect(statesQb.where).toHaveBeenCalledWith({
        save_id: SAVE_ID,
        target_node_id: TARGET_NODE_ID,
      });
      expect(statesQb.whereIn).toHaveBeenCalledWith('observer_node_id', ['egn_npc_1', 'egn_npc_2']);
    });
  });

  describe('countObserversByTargetAndScore', () => {
    it('应使用 where + where current_score >= minScore + count', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      tables['entity_awareness_states'] = createChainedQueryBuilder({ firstRow: { cnt: 3 } });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const count = await repo.countObserversByTargetAndScore(
        SAVE_ID, TARGET_NODE_ID, { minScore: 1 },
      );

      expect(count).toBe(3);
      const statesQb = tables['entity_awareness_states'];
      expect(statesQb.where).toHaveBeenCalledWith({
        save_id: SAVE_ID,
        target_node_id: TARGET_NODE_ID,
      });
      expect(statesQb.where).toHaveBeenCalledWith('current_score', '>=', 1);
      expect(statesQb.count).toHaveBeenCalledWith('* as cnt');
      expect(statesQb.first).toHaveBeenCalled();
    });

    it('无记录时返回 0', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      // count().first() 无记录时返回 undefined（result?.cnt ?? 0 兜底为 0）
      tables['entity_awareness_states'] = createChainedQueryBuilder({ firstRowIsNull: true });
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const count = await repo.countObserversByTargetAndScore(
        SAVE_ID, TARGET_NODE_ID, { minScore: 1 },
      );

      expect(count).toBe(0);
    });
  });

  describe('deleteBySaveId', () => {
    it('应先删 states 再删 events（依赖顺序）', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      const callOrder: string[] = [];
      (db as unknown as ReturnType<typeof vi.fn>).mockImplementation((tableName: string) => {
        callOrder.push(tableName);
        if (!tables[tableName]) tables[tableName] = createChainedQueryBuilder();
        return tables[tableName];
      });

      await repo.deleteBySaveId(SAVE_ID);

      expect(callOrder).toEqual(['entity_awareness_states', 'entity_awareness_events']);
      expect(tables['entity_awareness_states'].where).toHaveBeenCalledWith({ save_id: SAVE_ID });
      expect(tables['entity_awareness_events'].where).toHaveBeenCalledWith({ save_id: SAVE_ID });
      expect(tables['entity_awareness_states'].del).toHaveBeenCalled();
      expect(tables['entity_awareness_events'].del).toHaveBeenCalled();
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
      const repo = new AwarenessRepository(db);

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        1, createSource(), undefined, trxMock,
      );

      expect(trxMock).toHaveBeenCalledWith('entity_awareness_events');
      expect(db).not.toHaveBeenCalled();
    });

    it('不传 trx 时使用 db', async () => {
      const tables: Record<string, ReturnType<typeof createChainedQueryBuilder>> = {};
      const db = createMockKnex(tables);
      const repo = new AwarenessRepository(db);

      await repo.insertEvent(
        SAVE_ID, OBSERVER_NODE_ID, TARGET_NODE_ID,
        1, createSource(), undefined,
      );

      expect(db).toHaveBeenCalledWith('entity_awareness_events');
    });
  });
});
