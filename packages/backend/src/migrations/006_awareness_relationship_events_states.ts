import { Knex } from 'knex';

/**
 * 006: 新增 awareness/relationship 专用表（4 张）。
 *
 * 设计文档: docs/design/fix/fix-20260721-awareness-relationship-upgrade.md
 *
 * 改造目标：
 * - PERCEIVES 边的 awareness/relationship 字段从 entity_graph_edges.properties 迁移到独立表
 * - 数据模型：events 表（变更追加全量历史）+ states 表（派生当前状态）
 * - score 语义：delta（本次变更量），累加 + clamp [-10, +10]
 * - source 字段：结构化对象（含 type/informerType/informerId/topicType/topicId/note）
 *
 * 4 张表：
 * - entity_awareness_events：awareness 变更事件追加（全量历史 + 写入时压缩）
 * - entity_awareness_states：awareness 当前状态（派生单值，UNIQUE 约束）
 * - entity_relationship_events：relationship 变更事件追加
 * - entity_relationship_states：relationship 当前状态
 *
 * 开发阶段，不迁移历史数据：
 * - entity_graph_edges 表中 PERCEIVES 边的 properties.awarenessScore/relationshipScore 字段保留但不读
 * - 旧数据视为废弃，新数据写入新表
 * - 老汤姆场景修复依赖新表数据，旧数据不影响
 *
 * 幂等设计：检查表是否存在，存在则跳过
 */
export async function up(knex: Knex): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  // 1. entity_awareness_events 表（awareness 变更事件追加）
  // ═══════════════════════════════════════════════════════════
  const awarenessEventsExists = await knex.schema.hasTable('entity_awareness_events');
  if (!awarenessEventsExists) {
    await knex.raw(`
      CREATE TABLE entity_awareness_events (
        id TEXT PRIMARY KEY,
        save_id TEXT NOT NULL,
        observer_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        score_delta INTEGER NOT NULL,
        awareness_note TEXT,
        source TEXT NOT NULL,
        merged_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE
      )
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_ae_save_target ON entity_awareness_events(save_id, observer_node_id, target_node_id, created_at)');
    console.log('006: created entity_awareness_events table');
  } else {
    console.log('006: entity_awareness_events table already exists, skipping');
  }

  // ═══════════════════════════════════════════════════════════
  // 2. entity_awareness_states 表（awareness 当前状态，派生单值）
  // ═══════════════════════════════════════════════════════════
  const awarenessStatesExists = await knex.schema.hasTable('entity_awareness_states');
  if (!awarenessStatesExists) {
    await knex.raw(`
      CREATE TABLE entity_awareness_states (
        id TEXT PRIMARY KEY,
        save_id TEXT NOT NULL,
        observer_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        current_score INTEGER NOT NULL,
        effective_note TEXT,
        effective_source TEXT,
        effective_event_id TEXT,
        last_updated INTEGER NOT NULL,
        FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE,
        UNIQUE(save_id, observer_node_id, target_node_id)
      )
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_as_save_target ON entity_awareness_states(save_id, target_node_id, current_score)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_as_save_observer ON entity_awareness_states(save_id, observer_node_id)');
    console.log('006: created entity_awareness_states table');
  } else {
    console.log('006: entity_awareness_states table already exists, skipping');
  }

  // ═══════════════════════════════════════════════════════════
  // 3. entity_relationship_events 表（relationship 变更事件追加）
  // ═══════════════════════════════════════════════════════════
  const relEventsExists = await knex.schema.hasTable('entity_relationship_events');
  if (!relEventsExists) {
    await knex.raw(`
      CREATE TABLE entity_relationship_events (
        id TEXT PRIMARY KEY,
        save_id TEXT NOT NULL,
        observer_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        score_delta INTEGER NOT NULL,
        relationship_note TEXT,
        source TEXT NOT NULL,
        merged_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE
      )
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_re_save_target ON entity_relationship_events(save_id, observer_node_id, target_node_id, created_at)');
    console.log('006: created entity_relationship_events table');
  } else {
    console.log('006: entity_relationship_events table already exists, skipping');
  }

  // ═══════════════════════════════════════════════════════════
  // 4. entity_relationship_states 表（relationship 当前状态，派生单值）
  // ═══════════════════════════════════════════════════════════
  const relStatesExists = await knex.schema.hasTable('entity_relationship_states');
  if (!relStatesExists) {
    await knex.raw(`
      CREATE TABLE entity_relationship_states (
        id TEXT PRIMARY KEY,
        save_id TEXT NOT NULL,
        observer_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        current_score INTEGER NOT NULL,
        effective_note TEXT,
        effective_source TEXT,
        effective_event_id TEXT,
        last_updated INTEGER NOT NULL,
        FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE,
        UNIQUE(save_id, observer_node_id, target_node_id)
      )
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_rs_save_target ON entity_relationship_states(save_id, target_node_id, current_score)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_rs_save_observer ON entity_relationship_states(save_id, observer_node_id)');
    console.log('006: created entity_relationship_states table');
  } else {
    console.log('006: entity_relationship_states table already exists, skipping');
  }
}

export async function down(knex: Knex): Promise<void> {
  // 回滚：删除 4 张表（数据不可逆）
  await knex.schema.dropTableIfExists('entity_relationship_states');
  await knex.schema.dropTableIfExists('entity_relationship_events');
  await knex.schema.dropTableIfExists('entity_awareness_states');
  await knex.schema.dropTableIfExists('entity_awareness_events');
  console.log('006: dropped 4 awareness/relationship tables');
}
