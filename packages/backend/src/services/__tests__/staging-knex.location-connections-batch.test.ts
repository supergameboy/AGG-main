/**
 * 回归测试：StagingKnex 条件丢失导致 location_connections 批量更新被 ShadowState 全量删除。
 *
 * 背景（bug-hunt-20260716-staging-knex-conditions-loss.md）：
 * - StagingQueryBuilder.whereIn 不更新 this.conditions
 * - LocationConnectionRepository.deleteByLocationId 使用 where(callback) 不被 StagingKnex 追踪
 * - scopeField 剥离后 where 变空，delete 匹配所有行，批量 update_location 连锁删除 pendingInserts
 *
 * 修复后期望：
 * - whereIn 更新 conditions（IN 语义）
 * - deleteByLocationId 拆分为显式 where(object)，仅删除指定地点的连接
 * - 批量 update_location 不误删前序 insert
 * - findConnectedIds 仅返回与指定地点相连的连接
 */
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../migrations/runner.js';
import { ShadowStateLayer } from '../ShadowStateLayer.js';
import { StagingPool } from '../StagingPool.js';
import { createStagingKnex } from '@ai-rpg/shared/tool-core';
import type { IDevTraceHook } from '@ai-rpg/shared/tool-core';
import { LocationConnectionRepository } from '../../game-systems/map/LocationConnectionRepository.js';

const mockDevTraceHook: IDevTraceHook = {
  emit: vi.fn(),
};

const SAVE_ID = 'save-batch-test';
const NOW = 1_700_000_000_000;

/**
 * 构造测试上下文：真实 SQLite 内存 DB + 真实 StagingPool/ShadowStateLayer + StagingKnex 代理 db。
 * location_connections 配置 scopeField='save_id'（复现 bug 的必要条件）。
 */
async function buildContext() {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await runMigrations(db);

  // 插入 save + locations（location_connections 的 FK 依赖）
  await db('saves').insert({
    id: SAVE_ID,
    name: 'batch-test',
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
  const locationIds = ['loc-plaza', 'loc-forge', 'loc-tavern', 'loc-mine', 'loc-forest'];
  for (const id of locationIds) {
    await db('locations').insert({
      id,
      save_id: SAVE_ID,
      name: id,
      type: 'settlement',
      description: '',
      location_level: 1,
      visible: 1,
      created_at: NOW,
      updated_at: NOW,
    });
  }

  // ShadowStateLayer 配置 location_connections 的 scopeField='save_id'（与 init.ts 一致）
  const shadowState = new ShadowStateLayer(
    db,
    { save_id: SAVE_ID },
    [{ table: 'location_connections', scopeField: 'save_id' }],
  );
  await shadowState.ensureSnapshot();

  const stagingPool = new StagingPool(mockDevTraceHook);
  stagingPool.bindShadowState(shadowState);

  const proxyDb = createStagingKnex(db, {
    stagingPool,
    shadowState,
    toolType: 'map_service',
    method: 'updateLocation',
    source: 'gamemaster',
  });

  // 通过代理 db 创建 Repository，模拟 ReAct 循环内的真实调用路径
  const connectionRepo = new LocationConnectionRepository(proxyDb);

  return { db, shadowState, stagingPool, proxyDb, connectionRepo };
}

describe('StagingKnex location_connections 批量更新回归测试', () => {
  let ctx: Awaited<ReturnType<typeof buildContext>>;

  beforeEach(async () => {
    ctx = await buildContext();
  });

  afterEach(async () => {
    await ctx.db.destroy();
  });

  describe('whereIn 更新 conditions（IN 语义）', () => {
    it('whereIn 条件的 read 应按 IN 语义匹配 ShadowState', async () => {
      const { proxyDb, stagingPool } = ctx;

      // 暂存 3 条连接
      await proxyDb('location_connections').insert({
        id: 'conn-1', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-forge',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-2', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-tavern',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-3', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-mine',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });

      expect(stagingPool.writeCount).toBe(3);

      // whereIn 查询：应命中 ShadowState（修复前 whereIn 不更新 conditions，会回退空 DB）
      const rows = await proxyDb('location_connections')
        .where({ save_id: SAVE_ID })
        .whereIn('to_location_id', ['loc-forge', 'loc-tavern'])
        .select('id', 'to_location_id');

      expect(rows).toHaveLength(2);
      const toIds = rows.map((r: Record<string, unknown>) => r.to_location_id).sort();
      expect(toIds).toEqual(['loc-forge', 'loc-tavern']);
    });

    it('whereIn 条件的 delete 应仅删除匹配行，不误删其他行', async () => {
      const { proxyDb, stagingPool } = ctx;

      // 暂存 3 条连接
      await proxyDb('location_connections').insert({
        id: 'conn-1', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-forge',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-2', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-tavern',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-3', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-mine',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });

      // whereIn 删除：仅删除 to_location_id IN [loc-forge, loc-tavern] 的行
      await proxyDb('location_connections')
        .where({ save_id: SAVE_ID })
        .whereIn('to_location_id', ['loc-forge', 'loc-tavern'])
        .del();

      // 读取剩余行（修复前 whereIn 不更新 conditions，delete 的 where 丢失 to_location_id，
      // scopeField 剥离后 where 为空，会删除当前 save 内所有连接）
      const remaining = await proxyDb('location_connections')
        .where({ save_id: SAVE_ID })
        .select('id', 'to_location_id');

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('conn-3');
      expect(remaining[0].to_location_id).toBe('loc-mine');
    });
  });

  describe('LocationConnectionRepository.deleteByLocationId 拆分为显式 where(object)', () => {
    it('删除单地点连接时不影响其他地点的连接', async () => {
      const { connectionRepo, proxyDb } = ctx;

      // 暂存双向连接：plaza↔forge, plaza↔tavern, forge↔mine
      await proxyDb('location_connections').insert({
        id: 'conn-plaza-forge', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-forge',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-forge-plaza', save_id: SAVE_ID,
        from_location_id: 'loc-forge', to_location_id: 'loc-plaza',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-plaza-tavern', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-tavern',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-tavern-plaza', save_id: SAVE_ID,
        from_location_id: 'loc-tavern', to_location_id: 'loc-plaza',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-forge-mine', save_id: SAVE_ID,
        from_location_id: 'loc-forge', to_location_id: 'loc-mine',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'conn-mine-forge', save_id: SAVE_ID,
        from_location_id: 'loc-mine', to_location_id: 'loc-forge',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });

      // 删除与 plaza 相连的所有连接（from=plaza 或 to=plaza）
      await connectionRepo.deleteByLocationId(SAVE_ID, 'loc-plaza');

      // 读取剩余连接：应只剩 forge↔mine 双向
      const remaining = await proxyDb('location_connections')
        .where({ save_id: SAVE_ID })
        .select('id', 'from_location_id', 'to_location_id');

      // 修复前：deleteByLocationId 使用 where(callback)，StagingKnex 不追踪 conditions，
      // scopeField 剥离后 where 为空，delete 匹配所有行 → 6 条全删
      expect(remaining).toHaveLength(2);
      const remainingIds = remaining.map((r: Record<string, unknown>) => r.id).sort();
      expect(remainingIds).toEqual(['conn-forge-mine', 'conn-mine-forge']);
    });
  });

  describe('批量 update_location 连接场景（核心 bug 回归）', () => {
    it('连续多次 update_location 的 delete+insert 不应连锁删除前序 insert', async () => {
      const { connectionRepo, proxyDb } = ctx;

      // 模拟 MapService.updateLocation 事务内的 delete + insert 路径
      // 场景：批量 enrich 多个地点的连接（bug 报告中的场景，这里用 5 个地点简化）
      // 注意：deleteByLocationId 是双向语义（删除 from=X 或 to=X 的连接），
      // 所以处理后续地点时会删除前序地点插入的"反向"连接（如 forge 处理时删除 plaza→forge）。
      const updates: Array<{ locationId: string; connections: string[] }> = [
        { locationId: 'loc-plaza', connections: ['loc-forge', 'loc-tavern', 'loc-mine', 'loc-forest'] },
        { locationId: 'loc-forge', connections: ['loc-plaza'] },
        { locationId: 'loc-tavern', connections: ['loc-plaza'] },
        { locationId: 'loc-mine', connections: ['loc-plaza', 'loc-forest'] },
        { locationId: 'loc-forest', connections: ['loc-plaza', 'loc-mine'] },
      ];

      // 按顺序执行 update_location 的连接更新（delete + insert）
      for (const { locationId, connections } of updates) {
        await connectionRepo.deleteByLocationId(SAVE_ID, locationId);
        for (const toId of connections) {
          await connectionRepo.insert(SAVE_ID, locationId, toId);
        }
      }

      // 关键断言：每次 deleteByLocationId 应仅删除该地点相关的连接，
      // 不应因 scopeField 剥离 + where 丢失而删除当前 save 内所有 insert。
      // 修复前（bug）：第一次 deleteByLocationId 即清空所有 pendingInserts，
      // 后续每次 delete 又清空当次 insert，最终只剩最后一批 2 条连接（forest→plaza, forest→mine）。
      // 修复后：双向 delete 仅删除涉及该地点的连接，其他地点的 insert 保留。
      const allConnections = await proxyDb('location_connections')
        .where({ save_id: SAVE_ID })
        .select('id', 'from_location_id', 'to_location_id');

      // 推演（双向 delete）：
      // 1. plaza: 无现存 → no-op；插入 4 条 (plaza→forge/tavern/mine/forest)
      // 2. forge: 删除 to=forge 即 plaza→forge (剩 3)；插入 forge→plaza (4)
      // 3. tavern: 删除 to=tavern 即 plaza→tavern (剩 3)；插入 tavern→plaza (4)
      // 4. mine: 删除 to=mine 即 plaza→mine (剩 3)；插入 mine→plaza, mine→forest (5)
      // 5. forest: 删除 to=forest 即 plaza→forest + mine→forest (剩 3)；插入 forest→plaza, forest→mine (5)
      expect(allConnections).toHaveLength(5);

      // 验证每个地点的最终连接数（按 from 分组）
      const countByFrom = new Map<string, number>();
      for (const conn of allConnections) {
        const from = conn.from_location_id as string;
        countByFrom.set(from, (countByFrom.get(from) ?? 0) + 1);
      }
      // plaza 的 4 条插入全部被后续地点的双向 delete 清空
      expect(countByFrom.get('loc-plaza') ?? 0).toBe(0);
      expect(countByFrom.get('loc-forge')).toBe(1);
      expect(countByFrom.get('loc-tavern')).toBe(1);
      expect(countByFrom.get('loc-mine')).toBe(1);
      expect(countByFrom.get('loc-forest')).toBe(2);
    });

    it('update_location 后通过 findConnectedIds 读取应返回非空连接', async () => {
      const { connectionRepo, proxyDb } = ctx;

      // 模拟 update_location: plaza 连接到 forge/tavern/mine
      await connectionRepo.deleteByLocationId(SAVE_ID, 'loc-plaza');
      await connectionRepo.insert(SAVE_ID, 'loc-plaza', 'loc-forge');
      await connectionRepo.insert(SAVE_ID, 'loc-plaza', 'loc-tavern');
      await connectionRepo.insert(SAVE_ID, 'loc-plaza', 'loc-mine');

      // 修复前：deleteByLocationId 误删所有 pendingInserts，
      // findConnectedIds 读取 ShadowState 返回 undefined → 回退空 DB → 返回空数组
      const connectedIds = await connectionRepo.findConnectedIds(SAVE_ID, 'loc-plaza');

      expect(connectedIds).toHaveLength(3);
      expect(connectedIds.sort()).toEqual(['loc-forge', 'loc-mine', 'loc-tavern']);
    });

    it('同地点二次 update_location 应替换旧连接而非累加', async () => {
      const { connectionRepo, proxyDb } = ctx;

      // 第一次 update_location: plaza → [forge, tavern]
      await connectionRepo.deleteByLocationId(SAVE_ID, 'loc-plaza');
      await connectionRepo.insert(SAVE_ID, 'loc-plaza', 'loc-forge');
      await connectionRepo.insert(SAVE_ID, 'loc-plaza', 'loc-tavern');

      // 第二次 update_location: plaza → [mine, forest]（替换）
      await connectionRepo.deleteByLocationId(SAVE_ID, 'loc-plaza');
      await connectionRepo.insert(SAVE_ID, 'loc-plaza', 'loc-mine');
      await connectionRepo.insert(SAVE_ID, 'loc-plaza', 'loc-forest');

      const connectedIds = await connectionRepo.findConnectedIds(SAVE_ID, 'loc-plaza');

      expect(connectedIds).toHaveLength(2);
      expect(connectedIds.sort()).toEqual(['loc-forest', 'loc-mine']);
    });
  });

  describe('findConnectedIds 拆分为显式 where(object)', () => {
    it('仅返回与指定地点相连的连接，不返回全 save 连接', async () => {
      const { connectionRepo, proxyDb } = ctx;

      // 暂存多组连接（plaza↔forge 双向 + tavern→mine + mine→forest）
      await proxyDb('location_connections').insert({
        id: 'c1', save_id: SAVE_ID,
        from_location_id: 'loc-plaza', to_location_id: 'loc-forge',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'c2', save_id: SAVE_ID,
        from_location_id: 'loc-forge', to_location_id: 'loc-plaza',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'c3', save_id: SAVE_ID,
        from_location_id: 'loc-tavern', to_location_id: 'loc-mine',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });
      await proxyDb('location_connections').insert({
        id: 'c4', save_id: SAVE_ID,
        from_location_id: 'loc-mine', to_location_id: 'loc-forest',
        connection_type: 'normal', created_at: NOW, updated_at: NOW,
      });

      // 查询与 plaza 相连的地点（from=plaza 得 to_location_id；to=plaza 得 from_location_id）
      // c1: plaza→forge → forge；c2: forge→plaza → forge；经 Set 去重后只剩 forge
      const plazaConnected = await connectionRepo.findConnectedIds(SAVE_ID, 'loc-plaza');

      // 修复前：findConnectedIds 使用 where(callback)/orWhere，StagingKnex 不追踪 conditions，
      // ShadowState 读取返回当前 save 内所有连接 → 把 4 条连接的 from/to 全部去重后返回
      // {forge, plaza, mine, forest}（4 个），而非仅 plaza 相连的 {forge}（1 个）。
      expect(plazaConnected).toHaveLength(1);
      expect(plazaConnected).toEqual(['loc-forge']);

      // 查询与 tavern 相连的地点（仅 c3: tavern→mine）
      const tavernConnected = await connectionRepo.findConnectedIds(SAVE_ID, 'loc-tavern');
      expect(tavernConnected).toHaveLength(1);
      expect(tavernConnected).toEqual(['loc-mine']);
    });
  });
});
