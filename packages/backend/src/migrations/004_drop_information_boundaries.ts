import { Knex } from 'knex';

/**
 * 004: 删除 information_boundaries 表 + 数据迁移到 PERCEIVES 边 + 清除 NPC customData.knowledge。
 *
 * 模块3 设计（L2-8）：
 * - InformationBoundary.knownFacts → PERCEIVES 边（awarenessScore=5, awarenessNote=原 description）
 * - InformationBoundary.unknownFacts → 跳过（新模型无"不应知道"概念）
 * - NPC customData.knowledge → 清除字段（free-form 数据无法可靠映射到目标实体）
 * - 删除 information_boundaries 表
 *
 * 幂等设计：
 * - 旧库（有 information_boundaries 表）：迁移数据 → 删表 → 清字段
 * - 新库（无 information_boundaries 表）：跳过迁移，仅清字段（兼容 001_init 已删表定义）
 *
 * 设计文档: docs/design/fractal-design-20260716-entity-graph-simplification/...-模块3-信息边界管理能力增强.md
 */

/** 构造 entity_graph_nodes 主键 id（与 shared/utils/entity-graph-id.ts 保持一致，迁移内联以保持自包含） */
function buildEntityNodeId(entityType: string, saveId: string, entityId: string): string {
  return `egn_${entityType}_${saveId}_${entityId}`;
}

/** 构造 entity_graph_edges 主键 id */
function buildEntityEdgeId(fromNodeId: string, relation: string, toNodeId: string): string {
  return `ege_${fromNodeId}_${relation}_${toNodeId}`;
}

interface InformationBoundaryRow {
  id: string;
  save_id: string;
  entity_id: string;
  entity_type: string;
  known_facts: string;
  unknown_facts: string;
  created_at: number;
  updated_at: number;
}

interface FactRow {
  entityId: string;
  entityType: string;
  description: string;
  source?: string;
  reason?: string;
  timestamp?: number;
}

export async function up(knex: Knex): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  // Step 1: 迁移 information_boundaries → PERCEIVES 边
  // ═══════════════════════════════════════════════════════════
  const tableExists = await knex.schema.hasTable('information_boundaries');
  if (tableExists) {
    const boundaries: InformationBoundaryRow[] = await knex('information_boundaries').select('*');
    let migratedCount = 0;
    let skippedNoObserver = 0;
    let skippedNoTarget = 0;
    let skippedInvalidFact = 0;

    for (const boundary of boundaries) {
      const observerNodeId = buildEntityNodeId(boundary.entity_type, boundary.save_id, boundary.entity_id);

      // 校验 observer 节点存在
      const observerExists = await knex('entity_graph_nodes').where({ id: observerNodeId }).first();
      if (!observerExists) {
        skippedNoObserver++;
        continue;
      }

      // 解析 knownFacts
      let knownFacts: FactRow[] = [];
      try {
        knownFacts = JSON.parse(boundary.known_facts || '[]');
      } catch {
        skippedInvalidFact++;
        continue;
      }

      const now = Date.now();
      for (const fact of knownFacts) {
        if (!fact.entityId || !fact.entityType) {
          skippedInvalidFact++;
          continue;
        }

        const targetNodeId = buildEntityNodeId(fact.entityType, boundary.save_id, fact.entityId);

        // 校验 target 节点存在
        const targetExists = await knex('entity_graph_nodes').where({ id: targetNodeId }).first();
        if (!targetExists) {
          skippedNoTarget++;
          continue;
        }

        const edgeId = buildEntityEdgeId(observerNodeId, 'PERCEIVES', targetNodeId);
        const properties = JSON.stringify({
          awarenessScore: 5,
          awarenessNote: fact.description || '',
          source: fact.source || 'migration',
          lastUpdated: now,
        });

        // INSERT OR IGNORE：若边已存在（唯一约束）则跳过，保留已有数据
        await knex.raw(
          `INSERT OR IGNORE INTO entity_graph_edges (id, save_id, from_node_id, to_node_id, relation, weight, properties, created_at, updated_at) VALUES (?, ?, ?, ?, 'PERCEIVES', 1.0, ?, ?, ?)`,
          [edgeId, boundary.save_id, observerNodeId, targetNodeId, properties, now, now],
        );
        migratedCount++;
      }
      // unknownFacts 跳过：新模型无"不应知道"概念
    }

    console.log(
      `004_drop_information_boundaries: migrated ${migratedCount} knownFacts to PERCEIVES edges, ` +
        `skipped (no observer: ${skippedNoObserver}, no target: ${skippedNoTarget}, invalid: ${skippedInvalidFact})`,
    );

    // 删除表
    await knex.schema.dropTableIfExists('information_boundaries');
    console.log('004_drop_information_boundaries: dropped information_boundaries table');
  } else {
    console.log('004_drop_information_boundaries: information_boundaries table not found, skipping migration');
  }

  // ═══════════════════════════════════════════════════════════
  // Step 2: 清除 NPC custom_data.knowledge 字段
  // ═══════════════════════════════════════════════════════════
  const npcs: Array<{ id: string; save_id: string; custom_data: string }> = await knex('npcs').select(
    'id',
    'save_id',
    'custom_data',
  );
  let clearedCount = 0;

  for (const npc of npcs) {
    if (!npc.custom_data) continue;

    let customData: Record<string, unknown>;
    try {
      customData = JSON.parse(npc.custom_data);
    } catch {
      continue; // 跳过无效 JSON
    }

    if (customData.knowledge === undefined) continue;

    delete customData.knowledge;
    await knex('npcs').where({ id: npc.id, save_id: npc.save_id }).update({
      custom_data: JSON.stringify(customData),
    });
    clearedCount++;
  }

  console.log(`004_drop_information_boundaries: cleared custom_data.knowledge from ${clearedCount} NPCs`);
}

export async function down(knex: Knex): Promise<void> {
  // 回滚：重建空的 information_boundaries 表（数据不可逆）
  const tableExists = await knex.schema.hasTable('information_boundaries');
  if (tableExists) {
    return;
  }

  await knex.raw(`
    CREATE TABLE information_boundaries (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      known_facts TEXT NOT NULL DEFAULT '[]',
      unknown_facts TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE,
      UNIQUE(save_id, entity_type, entity_id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ib_save ON information_boundaries(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ib_entity ON information_boundaries(save_id, entity_type, entity_id)');
}
