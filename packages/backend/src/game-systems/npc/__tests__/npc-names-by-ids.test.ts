import { describe, expect, it, beforeAll, afterAll } from 'vitest';
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
  });

  return db;
}

describe('NPCService — getNPCNamesByIds', () => {
  let db: Knex;
  let service: NPCService;

  beforeAll(async () => {
    db = await createTestDb();

    await db('saves').insert({
      id: 'save-001',
      name: 'Test Save',
      template_id: 'tpl-1',
      game_mode: 'text_adventure',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // S2-1 重构后：NPCService 通过 Repository + TransactionManager 构造（D8 组合根）
    // getNPCNamesByIds 仅依赖 npcRepo.findNamesByIds，其余依赖断言为接口类型即可
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

  it('应根据 ID 列表返回 NPC 名称映射', async () => {
    await db('npcs').insert([
      { id: 'npc-001', name: '铁匠', save_id: 'save-001' },
      { id: 'npc-002', name: '药师', save_id: 'save-001' },
    ]);

    const result = await service.getNPCNamesByIds(['npc-001', 'npc-002'] as ID[]);
    expect(result).toBeInstanceOf(Map);
    expect(result.get('npc-001')).toBe('铁匠');
    expect(result.get('npc-002')).toBe('药师');
    expect(result.size).toBe(2);
  });

  it('空 ID 列表应返回空 Map', async () => {
    const result = await service.getNPCNamesByIds([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('不存在的 ID 应不在结果中', async () => {
    const result = await service.getNPCNamesByIds(['nonexistent-npc'] as ID[]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('部分 ID 存在时应只返回存在的映射', async () => {
    const result = await service.getNPCNamesByIds(['npc-001', 'nonexistent'] as ID[]);
    expect(result.size).toBe(1);
    expect(result.get('npc-001')).toBe('铁匠');
    expect(result.has('nonexistent')).toBe(false);
  });
});
