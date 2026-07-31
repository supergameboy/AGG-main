/**
 * ShadowStateLayer INSERT 覆盖 baseSnapshot 测试
 *
 * 验证 BUG #1 修复：当同一 PK 同时存在于 baseSnapshot 和 pendingInserts 时，
 * read() 应跳过被 INSERT 覆盖的 baseSnapshot 行，readOne 返回 INSERT 的数据。
 *
 * BUG 现象（修复前）：
 *   1. baseSnapshot 含 skill_pool id=pool_1, learned=1（DB 旧值）
 *   2. apply('skill_pool', 'insert', { id: 'pool_1', learned: 0 })
 *   3. read('skill_pool', { id: 'pool_1' }) → 返回两条记录（baseSnapshot + pendingInserts）
 *   4. readOne → 返回 baseSnapshot 行（learned=1，陈旧！）
 *
 * 修复后预期：
 *   3. read 返回单条记录（pendingInserts）
 *   4. readOne 返回 INSERT 的数据（learned=0）
 */
import { describe, it, expect, vi } from 'vitest';
import { ShadowStateLayer, type ShadowStateTableConfig } from '../ShadowStateLayer.js';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const TABLES: ShadowStateTableConfig[] = [
  { table: 'skill_pool', scopeField: 'save_id' },
  { table: 'item_pool', scopeField: 'save_id' },
  { table: 'inventory', scopeField: 'save_id' },
  { table: 'characters', scopeField: 'save_id' },
];

describe('ShadowStateLayer: INSERT 覆盖 baseSnapshot', () => {
  it('INSERT 同 PK 行后，readOne 返回 INSERT 的数据而非 baseSnapshot 旧数据', async () => {
    const mockDb = {
      // 模拟 baseSnapshot 已有 skill_pool 行
      skill_pool: () => ({
        where: () => Promise.resolve([
          { id: 'pool_1', save_id: 'save_1', learned: 1, skill_id: 'skill_火球术' },
        ]),
      }),
    } as never;

    const layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' as never }, TABLES);
    await layer.ensureSnapshot();

    // INSERT 同 PK 行，learned=0（与 baseSnapshot 的 learned=1 不同）
    layer.apply('skill_pool', 'insert', {
      id: 'pool_1',
      save_id: 'save_1',
      learned: 0,
      skill_id: 'skill_火球术',
    });

    const result = layer.readOne('skill_pool', { id: 'pool_1' });
    expect(result).toBeDefined();
    expect(result?.learned).toBe(0);  // 应该是 INSERT 的值，不是 baseSnapshot 的旧值
  });

  it('INSERT 后 read 返回单条记录（不重复）', async () => {
    const mockDb = {
      skill_pool: () => ({
        where: () => Promise.resolve([
          { id: 'pool_1', save_id: 'save_1', learned: 1 },
        ]),
      }),
    } as never;

    const layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' as never }, TABLES);
    await layer.ensureSnapshot();

    layer.apply('skill_pool', 'insert', {
      id: 'pool_1',
      save_id: 'save_1',
      learned: 0,
    });

    const results = layer.read('skill_pool', { id: 'pool_1' });
    expect(results).toBeDefined();
    expect(results).toHaveLength(1);  // 不应该是 2 条
    expect((results?.[0] as { learned: number })?.learned).toBe(0);
  });

  it('INSERT 覆盖后 UPDATE 仍能正确合并', async () => {
    const mockDb = {
      skill_pool: () => ({
        where: () => Promise.resolve([
          { id: 'pool_1', save_id: 'save_1', learned: 1, skill_id: 'skill_火球术' },
        ]),
      }),
    } as never;

    const layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' as never }, TABLES);
    await layer.ensureSnapshot();

    // INSERT 覆盖 baseSnapshot
    layer.apply('skill_pool', 'insert', {
      id: 'pool_1',
      save_id: 'save_1',
      learned: 0,
      skill_id: 'skill_火球术',
    });

    // UPDATE 同一行
    layer.apply('skill_pool', 'update', {
      learned: 2,
    }, {
      id: 'pool_1',
      save_id: 'save_1',
    });

    const result = layer.readOne('skill_pool', { id: 'pool_1' });
    expect(result).toBeDefined();
    expect(result?.learned).toBe(2);  // UPDATE 后的值
    expect(result?.skill_id).toBe('skill_火球术');  // INSERT 的字段保留
  });

  it('INSERT 覆盖 baseSnapshot 后 DELETE 仍能生效', async () => {
    const mockDb = {
      characters: () => ({
        where: () => Promise.resolve([
          { id: 'char_1', save_id: 'save_1', name: '旧英雄' },
        ]),
      }),
    } as never;

    const layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' as never }, TABLES);
    await layer.ensureSnapshot();

    // INSERT 覆盖
    layer.apply('characters', 'insert', {
      id: 'char_1',
      save_id: 'save_1',
      name: '新英雄',
    });

    // DELETE
    layer.apply('characters', 'delete', {}, { id: 'char_1', save_id: 'save_1' });

    expect(layer.readOne('characters', { id: 'char_1' })).toBeUndefined();
  });

  it('多个表同时存在 INSERT 覆盖场景', async () => {
    const mockDb = {
      skill_pool: () => ({
        where: () => Promise.resolve([
          { id: 'pool_1', save_id: 'save_1', learned: 1 },
        ]),
      }),
      item_pool: () => ({
        where: () => Promise.resolve([
          { id: 'item_1', save_id: 'save_1', taken: true },
        ]),
      }),
      inventory: () => ({
        where: () => Promise.resolve([
          { id: 'inv_1', save_id: 'save_1', equipped_slot: 'main_hand' },
        ]),
      }),
    } as never;

    const layer = new ShadowStateLayer(mockDb, { save_id: 'save_1' as never }, TABLES);
    await layer.ensureSnapshot();

    // 三个表都 INSERT 覆盖
    layer.apply('skill_pool', 'insert', { id: 'pool_1', save_id: 'save_1', learned: 0 });
    layer.apply('item_pool', 'insert', { id: 'item_1', save_id: 'save_1', taken: false });
    layer.apply('inventory', 'insert', { id: 'inv_1', save_id: 'save_1', equipped_slot: null });

    expect(layer.readOne('skill_pool', { id: 'pool_1' })?.learned).toBe(0);
    expect(layer.readOne('item_pool', { id: 'item_1' })?.taken).toBe(false);
    expect(layer.readOne('inventory', { id: 'inv_1' })?.equipped_slot).toBeNull();
  });
});
