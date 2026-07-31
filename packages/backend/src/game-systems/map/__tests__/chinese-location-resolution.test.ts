import { describe, it, expect, beforeEach } from 'vitest';
import knex from 'knex';

describe('MapService resolveLocationId — 中文感知名称解析', () => {
  let db: knex.Knex;
  let mapService: any;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });

    // 创建最小表结构（maps 表已由 migration 070 删除，location_level 替代层级）
    await db.schema.createTable('saves', (table) => {
      table.text('id').primary();
    });
    await db.schema.createTable('locations', (table) => {
      table.text('id').primary();
      table.text('save_id').references('id').inTable('saves');
      table.text('name');
      table.text('type');
      table.text('description');
      table.integer('location_level');
      table.text('parent_location_id');
      table.boolean('visible').defaultTo(true);
    });
    await db.schema.createTable('location_connections', (table) => {
      table.increments('id').primary();
      table.text('save_id');
      table.text('from_location_id');
      table.text('to_location_id');
      table.text('connection_type');
      table.text('travel_description');
    });
    await db.schema.createTable('events', (table) => {
      table.text('id').primary();
      table.text('save_id').references('id').inTable('saves');
      table.text('name');
      table.text('description');
      table.text('trigger_condition');
      table.text('effect');
      table.boolean('recurring').defaultTo(false);
      table.boolean('visible').defaultTo(true);
    });

    // 插入测试数据
    await db('saves').insert({ id: 'save-test' });
    await db('locations').insert([
      { id: 'loc-village', save_id: 'save-test', name: '村庄广场', type: 'settlement', description: '热闹的村庄中心', location_level: 1 },
      { id: 'loc-forge', save_id: 'save-test', name: '铁匠铺', type: 'shop', description: '铁匠工作的地方', location_level: 2, parent_location_id: 'loc-village' },
      { id: 'loc-mine', save_id: 'save-test', name: '铁矿洞', type: 'dungeon', description: '废弃的矿洞', location_level: 1 },
      { id: 'loc-forest', save_id: 'save-test', name: '暗影森林', type: 'wilderness', description: '危险的森林', location_level: 1 },
      { id: 'loc-tavern', save_id: 'save-test', name: '老橡树酒馆', type: 'tavern', description: '冒险者聚集的酒馆', location_level: 2, parent_location_id: 'loc-village' },
    ]);
    await db('events').insert([
      { id: 'evt-1', save_id: 'save-test', name: '暗影入侵', description: '暗影势力入侵', trigger_condition: 'night', effect: 'spawn_enemies' },
      { id: 'evt-2', save_id: 'save-test', name: '丰收祭典', description: '村庄庆祝丰收', trigger_condition: 'autumn', effect: 'festival' },
    ]);

    // S2-1 重构后：MapService 通过 Repository + TransactionManager 构造（D8 组合根）
    const { MapService } = await import('../MapService.js');
    const { LocationRepository } = await import('../LocationRepository.js');
    const { LocationConnectionRepository } = await import('../LocationConnectionRepository.js');
    const { DiscoveredLocationRepository } = await import('../DiscoveredLocationRepository.js');
    const { EventRepository } = await import('../../event/EventRepository.js');
    const { LocationEntityResolver } = await import('../LocationEntityResolver.js');
    const { KnexTransactionManager } = await import('../../../database/TransactionManager.js');
    const locationRepo = new LocationRepository(db);
    const connectionRepo = new LocationConnectionRepository(db);
    const discoveredRepo = new DiscoveredLocationRepository(db);
    const eventRepo = new EventRepository(db);
    const txManager = new KnexTransactionManager(db);
    const locationResolver = new LocationEntityResolver(locationRepo, db);
    // ICharacterService 在本测试不被调用，断言为接口类型即可（测试聚焦 locationRepo 行为）
    const characterService = {} as import('../../character/types.js').ICharacterService;
    mapService = new MapService(locationRepo, connectionRepo, discoveredRepo, characterService, eventRepo, txManager, locationResolver);
  });

  describe('resolveLocationId', () => {
    it('通过精确 ID 匹配', async () => {
      const result = await mapService.resolveLocationId('loc-forge', 'save-test');
      expect(result).toBe('loc-forge');
    });

    it('通过精确中文名称匹配', async () => {
      const result = await mapService.resolveLocationId('铁匠铺', 'save-test');
      expect(result).toBe('loc-forge');
    });

    it('通过中文部分名称匹配（"匠铺"匹配"铁匠铺"）', async () => {
      const result = await mapService.resolveLocationId('匠铺', 'save-test');
      expect(result).toBe('loc-forge');
    });

    it('通过中文部分名称匹配（"铁"匹配"铁匠铺"或"铁矿洞"）', async () => {
      // "铁" 会匹配第一个找到的，可能是铁匠铺或铁矿洞
      const result = await mapService.resolveLocationId('铁', 'save-test');
      expect(result).toMatch(/^loc-(forge|mine)$/);
    });

    it('通过中文全名匹配（"暗影森林"）', async () => {
      const result = await mapService.resolveLocationId('暗影森林', 'save-test');
      expect(result).toBe('loc-forest');
    });

    it('通过中文部分名称匹配（"森林"匹配"暗影森林"）', async () => {
      const result = await mapService.resolveLocationId('森林', 'save-test');
      expect(result).toBe('loc-forest');
    });

    it('通过中文部分名称匹配（"酒馆"匹配"老橡树酒馆"）', async () => {
      const result = await mapService.resolveLocationId('酒馆', 'save-test');
      expect(result).toBe('loc-tavern');
    });

    it('找不到时抛出错误', async () => {
      await expect(mapService.resolveLocationId('不存在的地点', 'save-test'))
        .rejects.toThrow('Location not found');
    });
  });

  describe('getLocationByName — 中文搜索', () => {
    it('通过精确中文名称获取地点', async () => {
      const result = await mapService.getLocationByName('save-test', '铁匠铺');
      expect(result).toBeDefined();
      expect(result.name).toBe('铁匠铺');
    });

    it('通过部分中文名称搜索地点', async () => {
      const result = await mapService.getLocationByName('save-test', '广场');
      expect(result).toBeDefined();
      expect(result.name).toBe('村庄广场');
    });

    it('通过描述中的中文关键词搜索地点', async () => {
      const result = await mapService.getLocationByName('save-test', '铁匠');
      expect(result).toBeDefined();
      expect(result.id).toBe('loc-forge');
    });
  });

  describe('searchLocations — 中文搜索', () => {
    it('通过中文名称关键词搜索', async () => {
      const results = await mapService.searchLocations('save-test', { name: '酒馆' });
      const locations = Array.isArray(results) ? results : (results as any).locations;
      expect(locations.length).toBeGreaterThanOrEqual(1);
      expect(locations.some((l: any) => l.name === '老橡树酒馆')).toBe(true);
    });

    it('通过中文类型关键词搜索', async () => {
      const results = await mapService.searchLocations('save-test', { type: 'shop' });
      const locations = Array.isArray(results) ? results : (results as any).locations;
      expect(locations.length).toBeGreaterThanOrEqual(1);
    });
  });
});
