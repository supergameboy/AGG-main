import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import knex, { type Knex } from 'knex';
import { MapService } from '../MapService.js';
import { LocationRepository } from '../LocationRepository.js';
import { LocationConnectionRepository } from '../LocationConnectionRepository.js';
import { DiscoveredLocationRepository } from '../DiscoveredLocationRepository.js';
import { EventRepository } from '../../event/EventRepository.js';
import { KnexTransactionManager } from '../../../database/TransactionManager.js';
import type { ICharacterService } from '../../character/types.js';
import type { ID } from '@ai-rpg/shared';

const SAVE_ID = 'save-001' as ID;

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

  await db.schema.createTable('locations', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
  });

  return db;
}

describe('MapService — getLocationNamesByIds', () => {
  let db: Knex;
  let service: MapService;

  beforeAll(async () => {
    db = await createTestDb();

    await db('saves').insert({
      id: SAVE_ID,
      name: 'Test Save',
      template_id: 'tpl-1',
      game_mode: 'text_adventure',
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // S2-1 重构后：MapService 通过 Repository + TransactionManager 构造（D8 组合根）
    // ICharacterService 在本测试不被调用，断言为接口类型即可
    const locationRepo = new LocationRepository(db);
    const connectionRepo = new LocationConnectionRepository(db);
    const discoveredRepo = new DiscoveredLocationRepository(db);
    const eventRepo = new EventRepository(db);
    const txManager = new KnexTransactionManager(db);
    service = new MapService(locationRepo, connectionRepo, discoveredRepo, {} as ICharacterService, eventRepo, txManager);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('应根据 ID 列表和 saveId 返回地点名称映射', async () => {
    await db('locations').insert([
      { id: 'loc-001', name: '铁匠铺', save_id: SAVE_ID },
      { id: 'loc-002', name: '酒馆', save_id: SAVE_ID },
    ]);

    const result = await service.getLocationNamesByIds(SAVE_ID, ['loc-001', 'loc-002'] as ID[]);
    expect(result).toBeInstanceOf(Map);
    expect(result.get('loc-001')).toBe('铁匠铺');
    expect(result.get('loc-002')).toBe('酒馆');
    expect(result.size).toBe(2);
  });

  it('空 ID 列表应返回空 Map', async () => {
    const result = await service.getLocationNamesByIds(SAVE_ID, []);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('不存在的 ID 应不在结果中', async () => {
    const result = await service.getLocationNamesByIds(SAVE_ID, ['nonexistent-loc'] as ID[]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('其他 saveId 的地点不应出现在结果中', async () => {
    const otherSaveId = 'save-002' as ID;
    await db('saves').insert({
      id: otherSaveId,
      name: 'Other Save',
      template_id: 'tpl-2',
      game_mode: 'text_adventure',
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    await db('locations').insert({
      id: 'loc-other',
      name: '秘密洞穴',
      save_id: otherSaveId,
    });

    const result = await service.getLocationNamesByIds(SAVE_ID, ['loc-other'] as ID[]);
    expect(result.size).toBe(0);
  });

  it('部分 ID 存在时应只返回存在的映射', async () => {
    const result = await service.getLocationNamesByIds(SAVE_ID, ['loc-001', 'nonexistent'] as ID[]);
    expect(result.size).toBe(1);
    expect(result.get('loc-001')).toBe('铁匠铺');
    expect(result.has('nonexistent')).toBe(false);
  });
});
