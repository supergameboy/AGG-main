import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import type {
  IRelationshipRepository,
  EntityRelationshipEvent,
  EntityRelationshipState,
  EntityRelationshipEventRow,
  EntityRelationshipStateRow,
  RelationshipSource,
} from './types.js';

/**
 * Relationship Repository 实现（006 迁移配套）。
 *
 * 双表方案（与 AwarenessRepository 对称）：
 * - entity_relationship_events：变更事件追加（全量历史 + 写入时压缩）
 * - entity_relationship_states：派生单值当前状态（UNIQUE 约束）
 *
 * 与 AwarenessRepository 的差异：
 * - source 类型不含 auto:xxx（relationship 完全手动，不自动化）
 * - note 字段名为 relationship_note（与 awareness_note 对称）
 *
 * 设计文档: docs/design/fix/fix-20260721-awareness-relationship-upgrade.md
 */
export class RelationshipRepository implements IRelationshipRepository {
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
    source: RelationshipSource,
    relationshipNote: string | undefined,
    trx?: Knex.Transaction,
  ): Promise<string> {
    const query = trx ?? this.db;
    const id = `rev_${randomUUID()}`;
    const now = Date.now();

    await query('entity_relationship_events').insert({
      id,
      save_id: saveId,
      observer_node_id: observerNodeId,
      target_node_id: targetNodeId,
      score_delta: scoreDelta,
      relationship_note: relationshipNote ?? null,
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
    incomingSource: RelationshipSource,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const query = trx ?? this.db;
    const now = Date.now();

    await query('entity_relationship_events')
      .where({ id: eventId, save_id: saveId })
      .update({
        score_delta: query.raw('score_delta + ?', [incomingDelta]),
        merged_count: query.raw('merged_count + 1'),
        relationship_note: incomingNote ?? null,
        created_at: incomingSource.occurredAt ?? now,
      });
  }

  async upsertState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    newScore: number,
    effectiveNote: string | undefined,
    effectiveSource: RelationshipSource,
    effectiveEventId: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const query = trx ?? this.db;
    const now = Date.now();
    const stateId = `rst_${saveId}_${observerNodeId}_${targetNodeId}`;

    await query('entity_relationship_states')
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
  ): Promise<EntityRelationshipEvent | null> {
    const query = trx ?? this.db;
    const row = await query('entity_relationship_events')
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
  ): Promise<EntityRelationshipEvent[]> {
    const query = trx ?? this.db;
    const rows = await query('entity_relationship_events')
      .where({
        save_id: saveId,
        observer_node_id: observerNodeId,
        target_node_id: targetNodeId,
      })
      .orderBy('created_at', 'asc');
    return rows.map((r: EntityRelationshipEventRow) => this.rowToEvent(r));
  }

  async getState(
    saveId: string,
    observerNodeId: string,
    targetNodeId: string,
    trx?: Knex.Transaction,
  ): Promise<EntityRelationshipState | null> {
    const query = trx ?? this.db;
    const row = await query('entity_relationship_states')
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
  ): Promise<EntityRelationshipState[]> {
    const query = trx ?? this.db;
    if (observerNodeIds.length === 0) return [];
    const rows = await query('entity_relationship_states')
      .where({
        save_id: saveId,
        target_node_id: targetNodeId,
      })
      .whereIn('observer_node_id', observerNodeIds);
    return rows.map((r: EntityRelationshipStateRow) => this.rowToState(r));
  }

  async countObserversByTargetAndScore(
    saveId: string,
    targetNodeId: string,
    options: { minScore: number },
    trx?: Knex.Transaction,
  ): Promise<number> {
    const query = trx ?? this.db;
    const result = await query('entity_relationship_states')
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
    await query('entity_relationship_states').where({ save_id: saveId }).del();
    await query('entity_relationship_events').where({ save_id: saveId }).del();
  }

  // === Row → Entity 映射 ===

  private rowToEvent(row: EntityRelationshipEventRow): EntityRelationshipEvent {
    return {
      id: row.id,
      saveId: row.save_id,
      observerNodeId: row.observer_node_id,
      targetNodeId: row.target_node_id,
      scoreDelta: row.score_delta,
      relationshipNote: row.relationship_note ?? undefined,
      source: JSON.parse(row.source) as RelationshipSource,
      mergedCount: row.merged_count,
      createdAt: row.created_at,
    };
  }

  private rowToState(row: EntityRelationshipStateRow): EntityRelationshipState {
    return {
      id: row.id,
      saveId: row.save_id,
      observerNodeId: row.observer_node_id,
      targetNodeId: row.target_node_id,
      currentScore: row.current_score,
      effectiveNote: row.effective_note ?? undefined,
      effectiveSource: JSON.parse(row.effective_source ?? '{}') as RelationshipSource,
      effectiveEventId: row.effective_event_id ?? '',
      lastUpdated: row.last_updated,
    };
  }
}
