import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { GameTimeRepository } from '../GameTimeRepository.js';
import type { GameTimeRow } from '../types.js';

function createMockQueryBuilder() {
  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(1),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockResolvedValue(undefined),
  };
  return qb;
}

function createMockDb(qb: ReturnType<typeof createMockQueryBuilder>) {
  return vi.fn(() => qb) as unknown as Knex;
}

describe('GameTimeRepository', () => {
  it('应能正确实例化', () => {
    const repo = new GameTimeRepository(createMockDb(createMockQueryBuilder()));
    expect(repo).toBeInstanceOf(GameTimeRepository);
  });

  describe('rowToEntity', () => {
    it('应直接返回 row（无 JSON 字段需解析）', () => {
      const repo = new GameTimeRepository(createMockDb(createMockQueryBuilder()));
      const row = {
        id: 'time-1',
        save_id: 'save-1',
        total_minutes: 600,
        day_number: 1,
        last_action: 'init',
        last_action_at: 1000,
        updated_at: 2000,
      };
      const entity = (repo as unknown as { rowToEntity: (r: Record<string, unknown>) => unknown }).rowToEntity(row);
      expect(entity).toEqual(row);
    });
  });

  describe('findBySaveId', () => {
    it('应通过 save_id 查询并返回 GameTimeRow', async () => {
      const qb = createMockQueryBuilder();
      const mockRow: GameTimeRow = {
        id: 'time-1', save_id: 'save-1', total_minutes: 600,
        day_number: 1, last_action: 'init', last_action_at: 1000, updated_at: 2000,
      };
      qb.where.mockReturnValueOnce({ first: vi.fn().mockResolvedValue(mockRow) });
      const repo = new GameTimeRepository(createMockDb(qb));
      const result = await repo.findBySaveId('save-1');
      expect(result).toEqual(mockRow);
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
    });

    it('查询无结果时应返回 null', async () => {
      const qb = createMockQueryBuilder();
      qb.where.mockReturnValueOnce({ first: vi.fn().mockResolvedValue(null) });
      const repo = new GameTimeRepository(createMockDb(qb));
      const result = await repo.findBySaveId('save-none');
      expect(result).toBeNull();
    });
  });

  describe('insert', () => {
    it('应插入时间记录', async () => {
      const qb = createMockQueryBuilder();
      const insertMock = vi.fn().mockResolvedValue(undefined);
      qb.insert = insertMock;
      const repo = new GameTimeRepository(createMockDb(qb));
      await repo.insert('save-1', 'time-1', 600, 1, 'init');
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'time-1',
        save_id: 'save-1',
        total_minutes: 600,
        day_number: 1,
        last_action: 'init',
      }));
    });
  });

  describe('update', () => {
    it('应通过 save_id 更新时间记录', async () => {
      const qb = createMockQueryBuilder();
      const updateMock = vi.fn().mockResolvedValue(undefined);
      qb.where.mockReturnValueOnce({ update: updateMock });
      const repo = new GameTimeRepository(createMockDb(qb));
      await repo.update('save-1', 1200, 2, 'move');
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
      expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
        total_minutes: 1200,
        day_number: 2,
        last_action: 'move',
      }));
    });
  });

  describe('upsert', () => {
    it('应使用 insert + onConflict(save_id) + merge 模式', async () => {
      const qb = createMockQueryBuilder();
      const mergeMock = vi.fn().mockResolvedValue(undefined);
      const onConflictMock = vi.fn().mockReturnValue({ merge: mergeMock });
      const insertMock = vi.fn().mockReturnValue({ onConflict: onConflictMock });
      qb.insert = insertMock;
      const repo = new GameTimeRepository(createMockDb(qb));
      await repo.upsert('save-1', 'time-1', 600, 1, 'init');
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'time-1',
        save_id: 'save-1',
        total_minutes: 600,
      }));
      expect(onConflictMock).toHaveBeenCalledWith(['save_id']);
      expect(mergeMock).toHaveBeenCalled();
    });
  });

  describe('deleteBySaveId', () => {
    it('应通过 save_id 删除记录并返回 void', async () => {
      const qb = createMockQueryBuilder();
      const delMock = vi.fn().mockResolvedValue(1);
      qb.where.mockReturnValueOnce({ del: delMock });
      const repo = new GameTimeRepository(createMockDb(qb));
      const result = await repo.deleteBySaveId('save-1');
      expect(result).toBeUndefined();
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
    });
  });

  describe('trx 参数透传', () => {
    it('传入 trx 时应使用 trx 而非 db', async () => {
      const qb = createMockQueryBuilder();
      const db = createMockDb(qb);
      const trxMock = vi.fn(() => qb) as unknown as Knex.Transaction;
      const repo = new GameTimeRepository(db);
      qb.where.mockReturnValueOnce({ del: vi.fn().mockResolvedValue(1) });
      await repo.deleteBySaveId('save-1', trxMock);
      expect(trxMock).toHaveBeenCalledWith('save_game_time');
      expect(db).not.toHaveBeenCalled();
    });
  });
});
