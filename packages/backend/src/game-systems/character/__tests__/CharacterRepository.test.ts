import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { CharacterRepository } from '../CharacterRepository.js';
import type { CharacterRow } from '../types.js';

function createMockQueryBuilder() {
  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    select: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(1),
    count: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  qb.first = vi.fn().mockResolvedValue({ cnt: 0 });
  return qb;
}

function createMockDb(qb: ReturnType<typeof createMockQueryBuilder>) {
  const db = vi.fn(() => qb) as unknown as Knex;
  return db;
}

describe('CharacterRepository', () => {
  it('应能正确实例化', () => {
    const repo = new CharacterRepository(createMockDb(createMockQueryBuilder()));
    expect(repo).toBeInstanceOf(CharacterRepository);
  });

  describe('rowToEntity', () => {
    it('应正确解析 JSON 字段（currency/attributes/derived_attributes/status）', () => {
      const repo = new CharacterRepository(createMockDb(createMockQueryBuilder()));
      const row = {
        id: 'char-1',
        save_id: 'save-1',
        name: '艾莉娅',
        gender: 'female',
        custom_gender: null,
        age_group: 'young',
        race: 'elf',
        class: 'ranger',
        background: 'noble',
        level: 5,
        experience: 1200,
        current_hp: 80,
        max_hp: 100,
        current_mp: 40,
        max_mp: 60,
        currency: '{"gold": 100, "silver": 50}',
        attributes: '{"strength": 14, "agility": 18}',
        derived_attributes: '{"attack": 20, "defense": 12}',
        status: '{"poisoned": false}',
        current_location_id: 'loc-1',
        created_at: 1000,
        updated_at: 2000,
      };
      const entity = (repo as unknown as { rowToEntity: (r: Record<string, unknown>) => unknown }).rowToEntity(row);
      expect(entity).toEqual({
        id: 'char-1',
        saveId: 'save-1',
        name: '艾莉娅',
        gender: 'female',
        customGender: undefined,
        ageGroup: 'young',
        race: 'elf',
        class: 'ranger',
        background: 'noble',
        level: 5,
        experience: 1200,
        currentLocationId: 'loc-1',
        attributes: { strength: 14, agility: 18 },
        derivedAttributes: { attack: 20, defense: 12 },
        currentHP: 80,
        maxHP: 100,
        currentMP: 40,
        maxMP: 60,
        currency: { gold: 100, silver: 50 },
        status: { poisoned: false },
      });
    });

    it('JSON 字段为空时应返回默认值', () => {
      const repo = new CharacterRepository(createMockDb(createMockQueryBuilder()));
      const row = {
        id: 'char-2',
        save_id: 'save-2',
        name: '测试',
        gender: 'male',
        custom_gender: null,
        age_group: null,
        race: 'human',
        class: 'warrior',
        background: 'soldier',
        level: 1,
        experience: 0,
        current_hp: 50,
        max_hp: 50,
        current_mp: 20,
        max_mp: 20,
        currency: null,
        attributes: null,
        derived_attributes: null,
        status: null,
        current_location_id: null,
        created_at: 0,
        updated_at: 0,
      };
      const entity = (repo as unknown as { rowToEntity: (r: Record<string, unknown>) => unknown }).rowToEntity(row);
      expect((entity as { currency: unknown }).currency).toEqual({});
      expect((entity as { attributes: unknown }).attributes).toEqual({});
      expect((entity as { derivedAttributes: unknown }).derivedAttributes).toEqual({});
      expect((entity as { status: unknown }).status).toEqual({});
    });
  });

  describe('findById', () => {
    it('应通过 save_id 查询并返回 CharacterRow', async () => {
      const qb = createMockQueryBuilder();
      const mockRow: CharacterRow = {
        id: 'char-1', save_id: 'save-1', name: 'Test', gender: 'male',
        custom_gender: null, age_group: null, race: 'human', class: 'warrior',
        background: 'soldier', level: 1, experience: 0, current_hp: 50, max_hp: 50,
        current_mp: 20, max_mp: 20, base_max_hp: 50, base_max_mp: 20,
        currency: '{}', attributes: '{}', custom_data: '{}',
        derived_attributes: '{}', status: '{}', current_location_id: null,
        created_at: 0, updated_at: 0,
      };
      // 覆盖 first 返回的链式调用结果
      qb.where.mockReturnValueOnce({
        first: vi.fn().mockResolvedValue(mockRow),
      });
      const repo = new CharacterRepository(createMockDb(qb));
      const result = await repo.findById('save-1');
      expect(result).toEqual(mockRow);
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
    });

    it('查询无结果时应返回 null', async () => {
      const qb = createMockQueryBuilder();
      qb.where.mockReturnValueOnce({
        first: vi.fn().mockResolvedValue(null),
      });
      const repo = new CharacterRepository(createMockDb(qb));
      const result = await repo.findById('save-none');
      expect(result).toBeNull();
    });
  });

  describe('updateCurrency', () => {
    it('应通过 save_id 更新 currency 字段（JSON.stringify）', async () => {
      const qb = createMockQueryBuilder();
      const updateMock = vi.fn().mockResolvedValue(undefined);
      qb.where.mockReturnValueOnce({ update: updateMock });
      const repo = new CharacterRepository(createMockDb(qb));
      await repo.updateCurrency('save-1', { gold: 200 });
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
        currency: JSON.stringify({ gold: 200 }),
      }));
    });
  });

  describe('deleteBySaveId', () => {
    it('应通过 save_id 删除记录并返回 void', async () => {
      const qb = createMockQueryBuilder();
      const delMock = vi.fn().mockResolvedValue(1);
      qb.where.mockReturnValueOnce({ del: delMock });
      const repo = new CharacterRepository(createMockDb(qb));
      const result = await repo.deleteBySaveId('save-1');
      expect(result).toBeUndefined();
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
      expect(delMock).toHaveBeenCalled();
    });
  });

  describe('trx 参数透传', () => {
    it('传入 trx 时应使用 trx 而非 db', async () => {
      const qb = createMockQueryBuilder();
      const db = createMockDb(qb);
      const trxMock = vi.fn(() => qb) as unknown as Knex.Transaction;
      const repo = new CharacterRepository(db);
      await repo.findById('save-1', trxMock);
      expect(trxMock).toHaveBeenCalledWith('characters');
      expect(db).not.toHaveBeenCalled();
    });
  });
});
