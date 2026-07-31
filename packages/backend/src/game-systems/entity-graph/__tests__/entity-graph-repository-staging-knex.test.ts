/**
 * 回归测试：EntityGraphRepository where(callback).orWhere 反模式导致 StagingKnex 条件丢失。
 *
 * 背景（fix-20260716-entity-graph-repository-where-callback-conditions-loss.md）：
 * - EntityGraphRepository.getEdges/getSubgraph 使用 where(callback).orWhere(orWhereIn)
 * - StagingKnex 不追踪 where(callback)/orWhere/orWhereIn，仅追踪 where(object)
 * - scopeField 剥离后 where 变空，ShadowState 读取/删除会匹配当前 save 内所有行
 * - 导致 EntityGraphAuditor.auditInventoryWrites 误报 source_mismatch，修复循环不收敛
 *
 * 修复后期望：
 * - getEdges 拆分为两个 where(object) 查询，仅返回与 nodeId 相连的边
 * - getSubgraph 拆分为两个 whereIn 查询，BFS 每层仅返回与当前层节点相连的边
 * - 自环边和双向引用按 edge.id 去重
 */
import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../../migrations/runner.js';
import { ShadowStateLayer } from '../../../services/ShadowStateLayer.js';
import { StagingPool } from '../../../services/StagingPool.js';
import { createStagingKnex } from '@ai-rpg/shared/tool-core';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import { EntityGraphRepository } from '../EntityGraphRepository.js';
import { buildEntityNodeId } from '@ai-rpg/shared/utils/entity-graph-id';

const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

const SAVE_ID = 'save-eg-staging-test';
const NOW = 1_700_000_000_000;

/**
 * 构造测试上下文：真实 SQLite 内存 DB + 真实 StagingPool/ShadowStateLayer + StagingKnex 代理 db。
 * entity_graph_nodes 和 entity_graph_edges 配置 scopeField='save_id'（复现 bug 的必要条件）。
 *
 * seedFn 在 ensureSnapshot 之前调用，用于通过真实 db 插入测试数据。
 * 这样 ShadowState.ensureSnapshot 会加载这些数据，通过 proxyDb 查询走 ShadowState。
 */
async function buildContext(seedFn?: (db: knex.Knex) => Promise<void>) {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await runMigrations(db);

  // 插入 save（entity_graph_nodes/edges 的 FK 依赖）
  await db('saves').insert({
    id: SAVE_ID,
    name: 'eg-staging-test',
    template_id: 'tpl-1',
    game_mode: 'turn_based_rpg',
    chapter: '',
    location: '',
    level: 1,
    main_quest: '',
    play_time: 0,
    thumbnail: '',
    created_at: NOW,
    updated_at: NOW,
  });

  // 通过真实 db 插入测试数据（在 ensureSnapshot 之前）
  if (seedFn) {
    await seedFn(db);
  }

  // ShadowStateLayer 配置 entity_graph_nodes 和 entity_graph_edges 的 scopeField='save_id'
  // （与 init.ts SHADOW_STATE_TABLES 配置一致）
  const shadowState = new ShadowStateLayer(
    db,
    { save_id: SAVE_ID },
    [
      { table: 'entity_graph_nodes', scopeField: 'save_id' },
      { table: 'entity_graph_edges', scopeField: 'save_id' },
    ],
  );
  await shadowState.ensureSnapshot();

  const stagingPool = new StagingPool(mockDevTraceHook);
  stagingPool.bindShadowState(shadowState);

  const proxyDb = createStagingKnex(db, {
    stagingPool,
    shadowState,
    toolType: 'audit',
    method: 'auditStagedWrites',
    source: 'gamemaster',
  });

  // 通过代理 db 创建 Repository，模拟 Auditor 通过 createAuditGraphProviderFactory 创建的路径
  const repo = new EntityGraphRepository(proxyDb);

  return { db, shadowState, stagingPool, proxyDb, repo };
}

/**
 * 插入节点 row 到 entity_graph_nodes。
 */
async function insertNode(
  db: knex.Knex,
  id: string,
  type: string,
  entityId: string,
  label: string,
): Promise<void> {
  await db('entity_graph_nodes').insert({
    id,
    save_id: SAVE_ID,
    entity_type: type,
    entity_id: entityId,
    label,
    properties: '{}',
    created_at: NOW,
    updated_at: NOW,
  });
}

/**
 * 插入边 row 到 entity_graph_edges。
 */
async function insertEdge(
  db: knex.Knex,
  id: string,
  fromNodeId: string,
  toNodeId: string,
  relation: string,
): Promise<void> {
  await db('entity_graph_edges').insert({
    id,
    save_id: SAVE_ID,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    relation,
    weight: 1.0,
    properties: '{}',
    created_at: NOW,
    updated_at: NOW,
  });
}

describe('EntityGraphRepository StagingKnex 条件追踪回归测试', () => {
  let ctx: Awaited<ReturnType<typeof buildContext>>;

  afterEach(async () => {
    if (ctx) {
      await ctx.db.destroy();
    }
  });

  describe('getEdges 拆分 where(callback).orWhere', () => {
    it('仅返回与 nodeId 相连的边，不返回全 save 边', async () => {
      // 场景：3 个物品的 OWNS 边，查询 item1 应仅返回 1 条边
      // 修复前：where(callback) 不被追踪，ShadowState 返回全 save 3 条边
      // 修复后：where(object) 被追踪，仅返回 1 条边
      const charNodeId = buildEntityNodeId('character', SAVE_ID, 'char1');
      const npcNodeId = buildEntityNodeId('npc', SAVE_ID, 'npc1');
      const item1NodeId = buildEntityNodeId('item', SAVE_ID, 'item1');
      const item2NodeId = buildEntityNodeId('item', SAVE_ID, 'item2');
      const item3NodeId = buildEntityNodeId('item', SAVE_ID, 'item3');

      ctx = await buildContext(async (db) => {
        await insertNode(db, charNodeId, 'character', 'char1', 'Hero');
        await insertNode(db, npcNodeId, 'npc', 'npc1', 'Merchant');
        await insertNode(db, item1NodeId, 'item', 'item1', 'Sword');
        await insertNode(db, item2NodeId, 'item', 'item2', 'Shield');
        await insertNode(db, item3NodeId, 'item', 'item3', 'Potion');
        await insertEdge(db, `ege_${charNodeId}_OWNS_${item1NodeId}`, charNodeId, item1NodeId, 'OWNS');
        await insertEdge(db, `ege_${charNodeId}_OWNS_${item2NodeId}`, charNodeId, item2NodeId, 'OWNS');
        await insertEdge(db, `ege_${npcNodeId}_OWNS_${item3NodeId}`, npcNodeId, item3NodeId, 'OWNS');
      });

      const edges = await ctx.repo.getEdges(SAVE_ID, item1NodeId);

      expect(edges).toHaveLength(1);
      expect(edges[0].fromNodeId).toBe(charNodeId);
      expect(edges[0].toNodeId).toBe(item1NodeId);
      expect(edges[0].relation).toBe('OWNS');
    });

    it('节点同时作为 from 和 to 时按 edge.id 去重', async () => {
      // 场景：A→B 和 B→C，查询 B 应返回 2 条边（不重复）
      // 修复前：where(callback) 不被追踪，ShadowState 返回全 save 边
      // 修复后：两次 where(object) 查询命中，按 edge.id 去重后返回 2 条
      const aNodeId = buildEntityNodeId('character', SAVE_ID, 'a');
      const bNodeId = buildEntityNodeId('npc', SAVE_ID, 'b');
      const cNodeId = buildEntityNodeId('item', SAVE_ID, 'c');

      ctx = await buildContext(async (db) => {
        await insertNode(db, aNodeId, 'character', 'a', 'A');
        await insertNode(db, bNodeId, 'npc', 'b', 'B');
        await insertNode(db, cNodeId, 'item', 'c', 'C');
        await insertEdge(db, `ege_${aNodeId}_KNOWS_${bNodeId}`, aNodeId, bNodeId, 'KNOWS');
        await insertEdge(db, `ege_${bNodeId}_KNOWS_${cNodeId}`, bNodeId, cNodeId, 'KNOWS');
      });

      const edges = await ctx.repo.getEdges(SAVE_ID, bNodeId);

      expect(edges).toHaveLength(2);
      const edgeIds = edges.map((e) => e.id).sort();
      expect(edgeIds).toEqual(
        [`ege_${aNodeId}_KNOWS_${bNodeId}`, `ege_${bNodeId}_KNOWS_${cNodeId}`].sort(),
      );
    });

    it('自环边按 edge.id 去重返回 1 条', async () => {
      // 场景：A→A 自环边，查询 A 应仅返回 1 条边
      // 修复后：两次 where(object) 查询都命中同一条边，按 edge.id 去重返回 1 条
      const aNodeId = buildEntityNodeId('character', SAVE_ID, 'a');

      ctx = await buildContext(async (db) => {
        await insertNode(db, aNodeId, 'character', 'a', 'A');
        await insertEdge(db, `ege_${aNodeId}_KNOWS_${aNodeId}`, aNodeId, aNodeId, 'KNOWS');
      });

      const edges = await ctx.repo.getEdges(SAVE_ID, aNodeId);

      expect(edges).toHaveLength(1);
      expect(edges[0].fromNodeId).toBe(aNodeId);
      expect(edges[0].toNodeId).toBe(aNodeId);
    });

    it('无相连边时返回空数组', async () => {
      // 场景：图中有多条边，但查询的节点没有任何相连边
      // 修复前：where(callback) 不被追踪，ShadowState 返回全 save 边
      // 修复后：where(object) 被追踪，返回空数组
      const charNodeId = buildEntityNodeId('character', SAVE_ID, 'char1');
      const item1NodeId = buildEntityNodeId('item', SAVE_ID, 'item1');
      const orphanNodeId = buildEntityNodeId('item', SAVE_ID, 'orphan');

      ctx = await buildContext(async (db) => {
        await insertNode(db, charNodeId, 'character', 'char1', 'Hero');
        await insertNode(db, item1NodeId, 'item', 'item1', 'Sword');
        await insertNode(db, orphanNodeId, 'item', 'orphan', 'Orphan');
        await insertEdge(db, `ege_${charNodeId}_OWNS_${item1NodeId}`, charNodeId, item1NodeId, 'OWNS');
      });

      const edges = await ctx.repo.getEdges(SAVE_ID, orphanNodeId);

      expect(edges).toHaveLength(0);
    });
  });

  describe('getSubgraph 拆分 whereIn(callback).orWhereIn', () => {
    it('BFS 每层仅返回与当前层节点相连的边，不返回全 save 边', async () => {
      // 场景：center=A，depth=1，A→B 一条边；另有不相关的 C→D 边
      // 修复前：whereIn(callback) 不被追踪，ShadowState 返回全 save 边（含 C→D）
      // 修复后：两次 whereIn 查询，仅返回 A→B
      const aNodeId = buildEntityNodeId('character', SAVE_ID, 'a');
      const bNodeId = buildEntityNodeId('npc', SAVE_ID, 'b');
      const cNodeId = buildEntityNodeId('item', SAVE_ID, 'c');
      const dNodeId = buildEntityNodeId('item', SAVE_ID, 'd');

      ctx = await buildContext(async (db) => {
        await insertNode(db, aNodeId, 'character', 'a', 'A');
        await insertNode(db, bNodeId, 'npc', 'b', 'B');
        await insertNode(db, cNodeId, 'item', 'c', 'C');
        await insertNode(db, dNodeId, 'item', 'd', 'D');
        await insertEdge(db, `ege_${aNodeId}_KNOWS_${bNodeId}`, aNodeId, bNodeId, 'KNOWS');
        await insertEdge(db, `ege_${cNodeId}_KNOWS_${dNodeId}`, cNodeId, dNodeId, 'KNOWS');
      });

      const subgraph = await ctx.repo.getSubgraph(SAVE_ID, aNodeId, 1);

      // 应包含 A 和 B 两个节点，1 条 A→B 边
      expect(subgraph.nodes).toHaveLength(2);
      expect(subgraph.nodes.map((n) => n.id).sort()).toEqual([aNodeId, bNodeId].sort());
      expect(subgraph.edges).toHaveLength(1);
      expect(subgraph.edges[0].fromNodeId).toBe(aNodeId);
      expect(subgraph.edges[0].toNodeId).toBe(bNodeId);
    });

    it('BFS depth=2 跨层查询正确收敛', async () => {
      // 场景：A→B→C 链，depth=2 从 A 出发应返回 3 个节点 2 条边
      // 修复后：第 1 层 whereIn 查询 A 的边（A→B），第 2 层 whereIn 查询 B 的边（B→C）
      const aNodeId = buildEntityNodeId('character', SAVE_ID, 'a');
      const bNodeId = buildEntityNodeId('npc', SAVE_ID, 'b');
      const cNodeId = buildEntityNodeId('item', SAVE_ID, 'c');

      ctx = await buildContext(async (db) => {
        await insertNode(db, aNodeId, 'character', 'a', 'A');
        await insertNode(db, bNodeId, 'npc', 'b', 'B');
        await insertNode(db, cNodeId, 'item', 'c', 'C');
        await insertEdge(db, `ege_${aNodeId}_KNOWS_${bNodeId}`, aNodeId, bNodeId, 'KNOWS');
        await insertEdge(db, `ege_${bNodeId}_KNOWS_${cNodeId}`, bNodeId, cNodeId, 'KNOWS');
      });

      const subgraph = await ctx.repo.getSubgraph(SAVE_ID, aNodeId, 2);

      expect(subgraph.nodes).toHaveLength(3);
      expect(subgraph.edges).toHaveLength(2);
      const edgeIds = subgraph.edges.map((e) => e.id).sort();
      expect(edgeIds).toEqual(
        [`ege_${aNodeId}_KNOWS_${bNodeId}`, `ege_${bNodeId}_KNOWS_${cNodeId}`].sort(),
      );
    });

    it('BFS 不相关边不被错误纳入子图', async () => {
      // 场景：A→B，C→D，D→E；从 A 出发 depth=2，C/D/E 不应出现
      // 修复前：whereIn(callback) 不被追踪，ShadowState 返回全 save 边，BFS 会错误遍历 C→D→E
      // 修复后：whereIn 被追踪，仅返回与当前层节点相连的边
      const aNodeId = buildEntityNodeId('character', SAVE_ID, 'a');
      const bNodeId = buildEntityNodeId('npc', SAVE_ID, 'b');
      const cNodeId = buildEntityNodeId('item', SAVE_ID, 'c');
      const dNodeId = buildEntityNodeId('item', SAVE_ID, 'd');
      const eNodeId = buildEntityNodeId('item', SAVE_ID, 'e');

      ctx = await buildContext(async (db) => {
        await insertNode(db, aNodeId, 'character', 'a', 'A');
        await insertNode(db, bNodeId, 'npc', 'b', 'B');
        await insertNode(db, cNodeId, 'item', 'c', 'C');
        await insertNode(db, dNodeId, 'item', 'd', 'D');
        await insertNode(db, eNodeId, 'item', 'e', 'E');
        await insertEdge(db, `ege_${aNodeId}_KNOWS_${bNodeId}`, aNodeId, bNodeId, 'KNOWS');
        await insertEdge(db, `ege_${cNodeId}_KNOWS_${dNodeId}`, cNodeId, dNodeId, 'KNOWS');
        await insertEdge(db, `ege_${dNodeId}_KNOWS_${eNodeId}`, dNodeId, eNodeId, 'KNOWS');
      });

      const subgraph = await ctx.repo.getSubgraph(SAVE_ID, aNodeId, 2);

      // 应仅包含 A 和 B，不包含 C/D/E
      expect(subgraph.nodes).toHaveLength(2);
      expect(subgraph.nodes.map((n) => n.id).sort()).toEqual([aNodeId, bNodeId].sort());
      expect(subgraph.edges).toHaveLength(1);
    });

    it('中心节点不存在时返回空图', async () => {
      // 场景：图中有多条边，但查询的中心节点不存在
      const aNodeId = buildEntityNodeId('character', SAVE_ID, 'a');
      const bNodeId = buildEntityNodeId('npc', SAVE_ID, 'b');
      const missingNodeId = buildEntityNodeId('item', SAVE_ID, 'missing');

      ctx = await buildContext(async (db) => {
        await insertNode(db, aNodeId, 'character', 'a', 'A');
        await insertNode(db, bNodeId, 'npc', 'b', 'B');
        await insertEdge(db, `ege_${aNodeId}_KNOWS_${bNodeId}`, aNodeId, bNodeId, 'KNOWS');
      });

      const subgraph = await ctx.repo.getSubgraph(SAVE_ID, missingNodeId, 2);

      expect(subgraph.nodes).toHaveLength(0);
      expect(subgraph.edges).toHaveLength(0);
    });
  });
});
