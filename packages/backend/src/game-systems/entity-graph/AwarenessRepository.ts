import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type {
  IAwarenessRepository,
  EntityAwarenessEvent,
  EntityAwarenessState,
  EntityAwarenessEventRow,
  EntityAwarenessStateRow,
  AwarenessSource,
} from './types.js';

/**
 * Awareness Repository 实现（006 迁移配套）。
 *
 * 双表方案：
 * - entity_awareness_events：变更事件追加（全量历史 + 写入时压缩）
 * - entity_awareness_states：派生单值当前状态（UNIQUE 约束）
 *
 * 设计依据：
 * - D5 BaseRepository 不适用（操作 2 张表），手动持有 db: Knex
 * - D7 一表一 Repository（本类仅访问 awareness 两表，relationship 在独立 Repository）
 * - D9 所有方法支持 trx? 可选参数
 * - D3 不跨领域表访问
 * - §9.2 Row 类型单一化：source/effective_source 等 JSON 字段在 Row 中为 string，rowToXxx 负责 JSON.parse
 *
 * 设计文档: docs/design/fix/fix-20260721-awareness-relationship-upgrade.md
 */
export class AwarenessRepository implements IAwarenessRepository {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  // === 写入 ===

  async insertEvent(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    scoreDelta: number,
    source: AwarenessSource,
    awarenessNote: string | undefined,
    trx?: Knex.Transaction,
  ): Promise<string> {
    const query = trx ?? this.db;
    const id = `aev_${randomUUID()}`;
    const now = Date.now();

    await query('entity_awareness_events').insert({
      id,
      save_id: saveId,
      observer_node_id: observerNodeId,
      target_node_id: targetNodeId,
      score_delta: scoreDelta,
      awareness_note: awarenessNote ?? null,
      source: JSON.stringify(source),
      merged_count: 1,
      created_at: source.occurredAt ?? now,
    });

    return id;
  }

  async mergeEvent(
    saveId: string,
    eventId: string,
    incomingDelta: number,
    incomingNote: string | undefined,
    incomingSource: AwarenessSource,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const query = trx ?? this.db;
    const now = Date.now();

    // 合并策略（R1）：
    // - score_delta 累加（保留同符号累加语义）
    // - merged_count +1
    // - awareness_note 更新为合并后的模板字符串
    // - source 保留原事件的 source（同 source.type 才合并）
    // - created_at 更新为 incoming 的 occurredAt（合并后事件时间戳为最新）
    await query('entity_awareness_events')
      .where({ id: eventId, save_id: saveId })
      .update({
        score_delta: query.raw('score_delta + ?', [incomingDelta]),
        merged_count: query.raw('merged_count + 1'),
        awareness_note: incomingNote ?? null,
        created_at: incomingSource.occurredAt ?? now,
      });
  }

  async upsertState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    newScore: number,
    effectiveNote: string | undefined,
    effectiveSource: AwarenessSource,
    effectiveEventId: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const query = trx ?? this.db;
    const now = Date.now();
    const stateId = `ast_${saveId}_${observerNodeId}_${targetNodeId}`;

    await query('entity_awareness_states')
      .insert({
        id: stateId,
        save_id: saveId,
        observer_node_id: observerNodeId,
        target_node_id: targetNodeId,
        current_score: newScore,
        effective_note: effectiveNote ?? null,
        effective_source: JSON.stringify(effectiveSource),
        effective_event_id: effectiveEventId,
        last_updated: now,
      })
      .onConflict(['save_id', 'observer_node_id', 'target_node_id'])
      .merge([
        'current_score',
        'effective_note',
        'effective_source',
        'effective_event_id',
        'last_updated',
      ]);
  }

  // === 查询 ===

  async getLatestEvent(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessEvent | null> {
    const query = trx ?? this.db;
    const row = await query('entity_awareness_events')
      .where({
        save_id: saveId,
        observer_node_id: observerNodeId,
        target_node_id: targetNodeId,
      })
      .orderBy('created_at', 'desc')
      .first();
    return row ? this.rowToEvent(row) : null;
  }

  async getHistory(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessEvent[]> {
    const query = trx ?? this.db;
    const rows = await query('entity_awareness_events')
      .where({
        save_id: saveId,
        observer_node_id: observerNodeId,
        target_node_id: targetNodeId,
      })
      .orderBy('created_at', 'asc');
    return rows.map((r: EntityAwarenessEventRow) => this.rowToEvent(r));
  }

  async getState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessState | null> {
    const query = trx ?? this.db;
    const row = await query('entity_awareness_states')
      .where({
        save_id: saveId,
        observer_node_id: observerNodeId,
        target_node_id: targetNodeId,
      })
      .first();
    return row ? this.rowToState(row) : null;
  }

  async getStatesBatch(
    saveId: string,
    observerNodeIds: string[],
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityAwarenessState[]> {
    const query = trx ?? this.db;
    if (observerNodeIds.length === 0) return [];
    const rows = await query('entity_awareness_states')
      .where({
        save_id: saveId,
        target_node_id: targetNodeId,
      })
      .whereIn('observer_node_id', observerNodeIds);
    return rows.map((r: EntityAwarenessStateRow) => this.rowToState(r));
  }

  async countObserversByTargetAndScore(
    saveId: string,
    targetNodeId: string,
    options: { minScore: number },
    trx?: Knex.Transaction,
  ): Promise<number> {
    const query = trx ?? this.db;
    const result = await query('entity_awareness_states')
      .where({
        save_id: saveId,
        target_node_id: targetNodeId,
      })
      .where('current_score', '>=', options.minScore)
      .count('* as cnt')
      .first();
    return Number(result?.cnt ?? 0);
  }

  // === 清理 ===

  async deleteBySaveId(saveId: string, trx?: Knex.Transaction): Promise<void> {
    const query = trx ?? this.db;
    // 顺序：先 states（依赖 events 派生），后 events
    await query('entity_awareness_states').where({ save_id: saveId }).del();
    await query('entity_awareness_events').where({ save_id: saveId }).del();
  }

  // === Row → Entity 映射（§9.2 JSON.parse） ===

  private rowToEvent(row: EntityAwarenessEventRow): EntityAwarenessEvent {
    return {
      id: row.id,
      saveId: row.save_id,
      observerNodeId: row.observer_node_id,
      targetNodeId: row.target_node_id,
      scoreDelta: row.score_delta,
      awarenessNote: row.awareness_note ?? undefined,
      source: JSON.parse(row.source) as AwarenessSource,
      mergedCount: row.merged_count,
      createdAt: row.created_at,
    };
  }

  private rowToState(row: EntityAwarenessStateRow): EntityAwarenessState {
    return {
      id: row.id,
      saveId: row.save_id,
      observerNodeId: row.observer_node_id,
      targetNodeId: row.target_node_id,
      currentScore: row.current_score,
      effectiveNote: row.effective_note ?? undefined,
      effectiveSource: JSON.parse(row.effective_source ?? '{}') as AwarenessSource,
      effectiveEventId: row.effective_event_id ?? '',
      lastUpdated: row.last_updated,
    };
  }
}
