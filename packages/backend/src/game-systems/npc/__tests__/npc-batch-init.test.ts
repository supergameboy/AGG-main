import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import knex, { type Knex } from 'knex';
import { NPCService } from '../NPCService.js';
import { NPCRepository } from '../NPCRepository.js';
import { NPCGoalRepository } from '../NPCGoalRepository.js';
import { SaveRepository } from '../../save/SaveRepository.js';
import { KnexTransactionManager } from '../../../database/TransactionManager.js';
import type { IMapService } from '../../map/types.js';
import type { ICharacterService } from '../../character/types.js';
import type { ITemplateProvider } from '../../shared/types.js';
import type { INumericalService } from '../../numerical/types.js';
import type { ID } from '@ai-rpg/shared';

/**
 * P0-1 批量 NPC 初始化方法测试。
 * 覆盖 batchCheckInitStatus 与 batchMarkInitialized 的正常路径、边界值与错误路径。
 */
async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });

  await db.schema.createTable('saves', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('template_id').notNullable();
    table.text('game_mode').notNullable();
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
  });

  await db.schema.createTable('npcs', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.integer('attr_initialized').defaultTo(0).notNullable();
    table.integer('inv_initialized').defaultTo(0).notNullable();
    table.integer('skill_initialized').defaultTo(0).notNullable();
    table.integer('updated_at').notNullable();
  });

  return db;
}

async function seedNpc(db: Knex, id: string, name: string, saveId: string): Promise<void> {
  await db('npcs').insert({
    id,
    name,
    save_id: saveId,
    attr_initialized: 0,
    inv_initialized: 0,
    skill_initialized: 0,
    updated_at: Date.now(),
  });
}

async function getInitFlags(db: Knex, npcId: string): Promise<{ attr: number; inv: number; skill: number }> {
  const row = await db('npcs').where({ id: npcId }).first('attr_initialized', 'inv_initialized', 'skill_initialized');
  return {
    attr: row?.attr_initialized ?? 0,
    inv: row?.inv_initialized ?? 0,
    skill: row?.skill_initialized ?? 0,
  };
}

describe('NPCService — P0-1 批量初始化', () => {
  let db: Knex;
  let service: NPCService;
  const SAVE_ID = 'save-batch-init' as ID;

  beforeAll(async () => {
    db = await createTestDb();

    await db('saves').insert({
      id: SAVE_ID,
      name: 'Batch Init Test',
      template_id: 'tpl-1',
      game_mode: 'text_adventure',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const npcRepo = new NPCRepository(db);
    const goalRepo = new NPCGoalRepository(db);
    const saveRepo = new SaveRepository(db);
    const txManager = new KnexTransactionManager(db);
    service = new NPCService(
      npcRepo,
      goalRepo,
      {} as IMapService,
      {} as ICharacterService,
      saveRepo,
      {} as ITemplateProvider,
      {} as INumericalService,
      txManager,
    );
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db('npcs').del();
  });

  // ===========================================================================
  // batchCheckInitStatus
  // ===========================================================================

  describe('batchCheckInitStatus', () => {
    it('多个 NPC 全部未初始化时返回 needsInit=true', async () => {
      await seedNpc(db, 'npc-1', '村长', SAVE_ID as string);
      await seedNpc(db, 'npc-2', '铁匠', SAVE_ID as string);

      const results = await service.batchCheckInitStatus(SAVE_ID, ['npc-1', 'npc-2'] as ID[]);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        npcId: 'npc-1',
        attrNeedsInit: true,
        invNeedsInit: true,
        skillNeedsInit: true,
      });
      expect(results[1]).toEqual({
        npcId: 'npc-2',
        attrNeedsInit: true,
        invNeedsInit: true,
        skillNeedsInit: true,
      });
    });

    it('部分 NPC 部分字段已初始化时返回正确状态', async () => {
      await db('npcs').insert({
        id: 'npc-mixed',
        name: '艾琳',
        save_id: SAVE_ID,
        attr_initialized: 1,
        inv_initialized: 0,
        skill_initialized: 1,
        updated_at: Date.now(),
      });

      const results = await service.batchCheckInitStatus(SAVE_ID, ['npc-mixed'] as ID[]);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        npcId: 'npc-mixed',
        attrNeedsInit: false,
        invNeedsInit: true,
        skillNeedsInit: false,
      });
    });

    it('返回结果与入参顺序一致', async () => {
      await seedNpc(db, 'npc-a', 'A', SAVE_ID as string);
      await seedNpc(db, 'npc-b', 'B', SAVE_ID as string);
      await seedNpc(db, 'npc-c', 'C', SAVE_ID as string);

      const results = await service.batchCheckInitStatus(SAVE_ID, ['npc-c', 'npc-a', 'npc-b'] as ID[]);

      expect(results.map(r => r.npcId)).toEqual(['npc-c', 'npc-a', 'npc-b']);
    });

    it('空 NPC ID 列表返回空数组', async () => {
      const results = await service.batchCheckInitStatus(SAVE_ID, [] as ID[]);
      expect(results).toEqual([]);
    });

    it('NPC 不存在时该 NPC 三类 needsInit 均为 true（findInitFlag 返回 false，取反后 needsInit=true）', async () => {
      const results = await service.batchCheckInitStatus(SAVE_ID, ['nonexistent-npc'] as ID[]);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        npcId: 'nonexistent-npc',
        attrNeedsInit: true,
        invNeedsInit: true,
        skillNeedsInit: true,
      });
    });
  });

  // ===========================================================================
  // batchMarkInitialized
  // ===========================================================================

  describe('batchMarkInitialized', () => {
    it('批量标记多个 NPC 的三类 init flag 全部完成', async () => {
      await seedNpc(db, 'npc-1', '村长', SAVE_ID as string);
      await seedNpc(db, 'npc-2', '铁匠', SAVE_ID as string);

      await service.batchMarkInitialized(SAVE_ID, [
        { npcId: 'npc-1' as ID, attrInitialized: true, invInitialized: true, skillInitialized: true },
        { npcId: 'npc-2' as ID, attrInitialized: true, invInitialized: true, skillInitialized: true },
      ]);

      const flags1 = await getInitFlags(db, 'npc-1');
      const flags2 = await getInitFlags(db, 'npc-2');
      expect(flags1).toEqual({ attr: 1, inv: 1, skill: 1 });
      expect(flags2).toEqual({ attr: 1, inv: 1, skill: 1 });
    });

    it('仅标记 attrInitialized 时其他字段保持原状态', async () => {
      await seedNpc(db, 'npc-only-attr', '艾琳', SAVE_ID as string);

      await service.batchMarkInitialized(SAVE_ID, [
        { npcId: 'npc-only-attr' as ID, attrInitialized: true },
      ]);

      const flags = await getInitFlags(db, 'npc-only-attr');
      expect(flags).toEqual({ attr: 1, inv: 0, skill: 0 });
    });

    it('未提供字段（undefined）保持原状态，false 也不修改', async () => {
      await db('npcs').insert({
        id: 'npc-partial',
        name: '测试NPC',
        save_id: SAVE_ID,
        attr_initialized: 1,
        inv_initialized: 0,
        skill_initialized: 0,
        updated_at: Date.now(),
      });

      await service.batchMarkInitialized(SAVE_ID, [
        { npcId: 'npc-partial' as ID, invInitialized: true },
      ]);

      const flags = await getInitFlags(db, 'npc-partial');
      expect(flags).toEqual({ attr: 1, inv: 1, skill: 0 });
    });

    it('空更新列表不执行任何操作', async () => {
      await seedNpc(db, 'npc-empty', '空测试', SAVE_ID as string);

      await service.batchMarkInitialized(SAVE_ID, []);

      const flags = await getInitFlags(db, 'npc-empty');
      expect(flags).toEqual({ attr: 0, inv: 0, skill: 0 });
    });

    it('支持混合标记：不同 NPC 标记不同字段', async () => {
      await seedNpc(db, 'npc-a', 'A', SAVE_ID as string);
      await seedNpc(db, 'npc-b', 'B', SAVE_ID as string);
      await seedNpc(db, 'npc-c', 'C', SAVE_ID as string);

      await service.batchMarkInitialized(SAVE_ID, [
        { npcId: 'npc-a' as ID, attrInitialized: true },
        { npcId: 'npc-b' as ID, attrInitialized: true, invInitialized: true },
        { npcId: 'npc-c' as ID, attrInitialized: true, invInitialized: true, skillInitialized: true },
      ]);

      expect(await getInitFlags(db, 'npc-a')).toEqual({ attr: 1, inv: 0, skill: 0 });
      expect(await getInitFlags(db, 'npc-b')).toEqual({ attr: 1, inv: 1, skill: 0 });
      expect(await getInitFlags(db, 'npc-c')).toEqual({ attr: 1, inv: 1, skill: 1 });
    });

    it('非存在 NPC 不影响已存在 NPC 的标记（updateInitFlag 影响行 0 不抛错）', async () => {
      // SQLite 的 UPDATE 语句在 WHERE 命中 0 行时不会抛错，而是默默不生效。
      // 本用例验证：批量标记中混入不存在的 NPC 时，已存在 NPC 的标记照常生效，
      // 不存在的 NPC 不会导致事务失败，也不会污染已存在 NPC 的其他字段。
      await seedNpc(db, 'npc-exist', '存在', SAVE_ID as string);

      await service.batchMarkInitialized(SAVE_ID, [
        { npcId: 'npc-exist' as ID, attrInitialized: true },
        { npcId: 'npc-not-exist' as ID, invInitialized: true },
      ]);

      // npc-exist 的 attr 应被标记为 1，inv 未提供标记应保持 0
      const flags = await getInitFlags(db, 'npc-exist');
      expect(flags.attr).toBe(1);
      expect(flags.inv).toBe(0);
    });
  });
});
