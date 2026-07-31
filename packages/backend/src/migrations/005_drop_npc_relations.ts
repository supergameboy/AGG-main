import { Knex } from 'knex';

/**
 * 005: 删除 npc_relations 表。
 *
 * 模块2 设计（L1 决策：方案A 硬删除，不迁移历史数据）：
 * - 旧关系系统：npc_relations 表 + NPCService.updateRelation/getPlayerRelation 等 5 个方法
 * - 新关系系统：entity_graph_edges 表 PERCEIVES 边 + EntityGraphService.setRelationship
 * - 开发阶段，不迁移历史数据（旧关系数据已废弃）
 *
 * 删除后关系数据单一数据源：
 * - entity_graph_edges 表 PERCEIVES 边（由 GM 通过 entity_graph_service.set_relationship 维护）
 * - DialogueService 不再读写关系数据（NPC_PARTY 不写关系）
 *
 * 幂等设计：
 * - 旧库（有 npc_relations 表）：DROP TABLE
 * - 新库（无 npc_relations 表）：跳过
 *
 * 设计文档: docs/design/fractal-design-20260717-story-engine-entity-graph-integration/...-模块2-旧关系系统迁移.md
 */
export async function up(knex: Knex): Promise<void> {
  const tableExists = await knex.schema.hasTable('npc_relations');
  if (tableExists) {
    await knex.schema.dropTableIfExists('npc_relations');
    console.log('005_drop_npc_relations: dropped npc_relations table');
  } else {
    console.log('005_drop_npc_relations: npc_relations table not found, skipping migration');
  }
}

export async function down(knex: Knex): Promise<void> {
  // 回滚：重建空的 npc_relations 表（数据不可逆）
  const tableExists = await knex.schema.hasTable('npc_relations');
  if (tableExists) {
    return;
  }

  await knex.raw(`
    CREATE TABLE npc_relations (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      npc_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_value INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id),
      UNIQUE(save_id, npc_id, target_type, target_id),
      FOREIGN KEY (save_id, npc_id) REFERENCES npcs(save_id, id) ON DELETE CASCADE
    )
  `);
}
