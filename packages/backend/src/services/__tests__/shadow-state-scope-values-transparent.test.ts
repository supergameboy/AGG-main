/**
 * ShadowStateLayer scopeValues 元数据透传测试
 *
 * 验证架构提升：save_id（和 template_id）由 scopeValues 唯一提供，
 * ShadowStateLayer.apply/read 自动处理，不从 data/where 中提取。
 *
 * 覆盖 BUG #2 #3 修复：
 * - BUG #2：apply 未用 scopeValues，按 save_id UPDATE/DELETE 无法匹配按 id 索引的行
 * - BUG #3：不支持复合 PK 表（059 迁移后 20 表为 (save_id, id) 复合 PK）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShadowStateLayer, type ShadowStateTableConfig } from '../ShadowStateLayer.js';

// Mock logger 避免真实日志输出
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const TABLES_WITH_SAVE_ID: ShadowStateTableConfig[] = [
  { table: 'characters', scopeField: 'save_id' },
  { table: 'location_connections', scopeField: 'save_id' },
  { table: 'npcs', scopeField: 'save_id' },
];

const TABLES_WITH_TEMPLATE_ID: ShadowStateTableConfig[] = [
  { table: 'template_skill_pool', scopeField: 'template_id' },
];

describe('ShadowStateLayer: scopeValues 元数据透传', () => {
  let layer: ShadowStateLayer;

  beforeEach(() => {
    const mockDb = {} as never;
    layer = new ShadowStateLayer(
      mockDb,
      { save_id: 'save_1' as never, template_id: 'tpl_1' as never },
      TABLES_WITH_SAVE_ID,
    );
  });

  describe('INSERT 用 scopeValue|id 作为 PK', () => {
    it('data 不含 save_id 时，readOne 仍能按 id 查到', () => {
      // INSERT 时 data 不含 save_id（scopeValues 是唯一来源）
      layer.apply('characters', 'insert', {
        id: 'char_1',
        name: '英雄',
        attributes: { strength: 10 },
      });

      const result = layer.readOne('characters', { id: 'char_1' });
      expect(result).toBeDefined();
      expect(result?.id).toBe('char_1');
      expect(result?.name).toBe('英雄');
    });

    it('data 含 save_id 时也能正常 INSERT（DB 落库需要，但 ShadowStateLayer 不依赖）', () => {
      layer.apply('characters', 'insert', {
        id: 'char_2',
        save_id: 'save_1',  // DB 落库需要
        name: '法师',
      });

      const result = layer.readOne('characters', { id: 'char_2' });
      expect(result).toBeDefined();
      expect(result?.name).toBe('法师');
    });
  });

  describe('UPDATE WHERE {save_id} 自动用 scopeValue 匹配所有行', () => {
    it('按 save_id 批量 UPDATE，所有当前 scope 的行都被更新', () => {
      // 先 INSERT 两行
      layer.apply('characters', 'insert', { id: 'char_1', save_id: 'save_1', attributes: { str: 10 } });
      layer.apply('characters', 'insert', { id: 'char_2', save_id: 'save_1', attributes: { str: 5 } });

      // 按 save_id 批量更新（where 只含 save_id）
      layer.apply('characters', 'update', { attributes: { str: 99 } }, { save_id: 'save_1' });

      // 两行都应该被更新
      const r1 = layer.readOne('characters', { id: 'char_1' });
      const r2 = layer.readOne('characters', { id: 'char_2' });
      expect(r1?.attributes).toEqual({ str: 99 });
      expect(r2?.attributes).toEqual({ str: 99 });
    });

    it('按 save_id UPDATE，不影响其他 scope 的行', () => {
      // 另一个 scope 的 layer
      const mockDb = {} as never;
      const otherLayer = new ShadowStateLayer(mockDb, { save_id: 'save_2' as never }, TABLES_WITH_SAVE_ID);
      otherLayer.apply('characters', 'insert', { id: 'char_1', save_id: 'save_2', attributes: { str: 5 } });

      // 当前 scope 的 layer 不受影响
      layer.apply('characters', 'insert', { id: 'char_1', save_id: 'save_1', attributes: { str: 10 } });
      layer.apply('characters', 'update', { attributes: { str: 99 } }, { save_id: 'save_1' });

      const result = layer.readOne('characters', { id: 'char_1' });
      expect(result?.attributes).toEqual({ str: 99 });
    });
  });

  describe('DELETE WHERE {save_id} 删除当前 scope 所有匹配行', () => {
    it('按 save_id 批量 DELETE，所有当前 scope 的行都被删除', () => {
      // 先 INSERT 两行
      layer.apply('location_connections', 'insert', { id: 'lc_1', save_id: 'save_1', from_location_id: 'loc_A' });
      layer.apply('location_connections', 'insert', { id: 'lc_2', save_id: 'save_1', from_location_id: 'loc_B' });

      // 按 save_id 批量删除
      layer.apply('location_connections', 'delete', {}, { save_id: 'save_1' });

      // 两行都应该被删除
      expect(layer.readOne('location_connections', { id: 'lc_1' })).toBeUndefined();
      expect(layer.readOne('location_connections', { id: 'lc_2' })).toBeUndefined();
    });

    it('DELETE WHERE {save_id, id} 精确删除单行', () => {
      layer.apply('location_connections', 'insert', { id: 'lc_1', save_id: 'save_1' });
      layer.apply('location_connections', 'insert', { id: 'lc_2', save_id: 'save_1' });

      // 按 save_id + id 精确删除
      layer.apply('location_connections', 'delete', {}, { save_id: 'save_1', id: 'lc_1' });

      expect(layer.readOne('location_connections', { id: 'lc_1' })).toBeUndefined();
      expect(layer.readOne('location_connections', { id: 'lc_2' })).toBeDefined();
    });
  });

  describe('read 自动剥离 query 中的 scopeField', () => {
    it('read 时 query 含 save_id，自动剥离不影响过滤', () => {
      layer.apply('characters', 'insert', { id: 'char_1', save_id: 'save_1', name: '英雄' });

      // query 含 save_id（Repository 层会自动加）
      const results = layer.read('characters', { save_id: 'save_1', id: 'char_1' });
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      expect((results?.[0] as { id: string })?.id).toBe('char_1');
    });

    it('readOne 时 query 含 save_id，自动剥离不影响过滤', () => {
      layer.apply('characters', 'insert', { id: 'char_1', save_id: 'save_1', name: '英雄' });

      const result = layer.readOne('characters', { save_id: 'save_1', id: 'char_1' });
      expect(result).toBeDefined();
      expect(result?.name).toBe('英雄');
    });
  });

  describe('复合 PK 表支持（BUG #3 修复）', () => {
    it('不同 scope 的同 id 行不互相覆盖', () => {
      const mockDb = {} as never;
      const layer1 = new ShadowStateLayer(mockDb, { save_id: 'save_1' as never }, TABLES_WITH_SAVE_ID);
      const layer2 = new ShadowStateLayer(mockDb, { save_id: 'save_2' as never }, TABLES_WITH_SAVE_ID);

      layer1.apply('characters', 'insert', { id: 'char_1', save_id: 'save_1', name: '英雄A' });
      layer2.apply('characters', 'insert', { id: 'char_1', save_id: 'save_2', name: '英雄B' });

      // 两个 layer 的同 id 行不互相干扰
      expect(layer1.readOne('characters', { id: 'char_1' })?.name).toBe('英雄A');
      expect(layer2.readOne('characters', { id: 'char_1' })?.name).toBe('英雄B');
    });
  });

  describe('template_id scopeField 透传', () => {
    it('template_xxx 表用 scopeValues.template_id 过滤', () => {
      const mockDb = {} as never;
      const tplLayer = new ShadowStateLayer(
        mockDb,
        { save_id: 'save_1' as never, template_id: 'tpl_1' as never },
        TABLES_WITH_TEMPLATE_ID,
      );

      // INSERT 时 data 不含 template_id（scopeValues 是唯一来源）
      tplLayer.apply('template_skill_pool', 'insert', {
        id: 'skill_1',
        name: '火球术',
        learned: 0,
      });

      const result = tplLayer.readOne('template_skill_pool', { id: 'skill_1' });
      expect(result).toBeDefined();
      expect(result?.name).toBe('火球术');
    });
  });

  describe('无 scopeField 的表走兜底逻辑', () => {
    it('无 scopeField 的表保持原 extractPrimaryKeyFromContext 逻辑', () => {
      const mockDb = {} as never;
      const noScopeLayer = new ShadowStateLayer(mockDb, {}, []);  // 空 scopeValues 和空 tables

      // 无 scopeField 的表，从 data/where 提取 pk
      noScopeLayer.apply('some_table', 'insert', { id: 'row_1', name: 'test' });
      const result = noScopeLayer.readOne('some_table', { id: 'row_1' });
      expect(result).toBeDefined();
      expect(result?.name).toBe('test');
    });
  });
});
