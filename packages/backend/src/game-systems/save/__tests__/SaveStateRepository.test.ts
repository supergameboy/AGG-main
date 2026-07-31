import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { SaveStateRepository } from '../SaveStateRepository.js';
import type { SaveStateRow } from '../types.js';

function createMockQueryBuilder() {
  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockReturnThis(),
    del: vi.fn().mockResolvedValue(1),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
  };
  return qb;
}

function createMockDb(qb: ReturnType<typeof createMockQueryBuilder>) {
  return vi.fn(() => qb) as unknown as Knex;
}

describe('SaveStateRepository', () => {
  it('应能正确实例化', () => {
    const repo = new SaveStateRepository(createMockDb(createMockQueryBuilder()));
    expect(repo).toBeInstanceOf(SaveStateRepository);
  });

  describe('rowToEntity', () => {
    it('应直接返回 row（data_value 保持 string）', () => {
      const repo = new SaveStateRepository(createMockDb(createMockQueryBuilder()));
      const row: SaveStateRow = {
        id: 'gs-1',
        save_id: 'save-1',
        data_type: 'pacing',
        data_key: 'tension',
        data_value: '{"tension": 0.8}',
        updated_at: 1000,
      };
      const entity = (repo as unknown as { rowToEntity: (r: Record<string, unknown>) => unknown }).rowToEntity(row as unknown as Record<string, unknown>);
      expect(entity).toEqual(row);
    });
  });

  describe('findBySaveIdAndTypeAndKey', () => {
    it('应通过 save_id + data_type + data_key 精确查询单条记录', async () => {
      const qb = createMockQueryBuilder();
      const mockRow: SaveStateRow = {
        id: 'gs-1', save_id: 'save-1', data_type: 'game', data_key: 'turn_count',
        data_value: '5', updated_at: 1000,
      };
      qb.where.mockReturnValueOnce({ first: vi.fn().mockResolvedValue(mockRow) });
      const repo = new SaveStateRepository(createMockDb(qb));
      const result = await repo.findBySaveIdAndTypeAndKey('save-1', 'game', 'turn_count');
      expect(result).toEqual(mockRow);
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1', data_type: 'game', data_key: 'turn_count' });
    });

    it('查询无结果时应返回 null', async () => {
      const qb = createMockQueryBuilder();
      qb.where.mockReturnValueOnce({ first: vi.fn().mockResolvedValue(null) });
      const repo = new SaveStateRepository(createMockDb(qb));
      const result = await repo.findBySaveIdAndTypeAndKey('save-none', 'game', 'turn_count');
      expect(result).toBeNull();
    });
  });

  describe('findBySaveIdAndType', () => {
    it('应通过 save_id + data_type 查询并返回数组（同一 data_type 可有多条 data_key）', async () => {
      const qb = createMockQueryBuilder();
      const mockRows: SaveStateRow[] = [
        { id: 'gs-1', save_id: 'save-1', data_type: 'pacing', data_key: 'tension', data_value: '0.8', updated_at: 1000 },
        { id: 'gs-2', save_id: 'save-1', data_type: 'pacing', data_key: 'pace', data_value: 'fast', updated_at: 1001 },
      ];
      qb.where.mockReturnValueOnce({ select: vi.fn().mockResolvedValue(mockRows) });
      const repo = new SaveStateRepository(createMockDb(qb));
      const result = await repo.findBySaveIdAndType('save-1', 'pacing');
      expect(result).toEqual(mockRows);
      expect(result).toHaveLength(2);
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1', data_type: 'pacing' });
    });

    it('查询无结果时应返回空数组', async () => {
      const qb = createMockQueryBuilder();
      qb.where.mockReturnValueOnce({ select: vi.fn().mockResolvedValue([]) });
      const repo = new SaveStateRepository(createMockDb(qb));
      const result = await repo.findBySaveIdAndType('save-none', 'pacing');
      expect(result).toEqual([]);
    });
  });

  describe('upsert', () => {
    it('应使用 insert + onConflict(save_id, data_type, data_key) + merge 模式', async () => {
      const qb = createMockQueryBuilder();
      const mergeMock = vi.fn().mockResolvedValue(undefined);
      const onConflictMock = vi.fn().mockReturnValue({ merge: mergeMock });
      const insertMock = vi.fn().mockReturnValue({ onConflict: onConflictMock });
      qb.insert = insertMock;
      const repo = new SaveStateRepository(createMockDb(qb));
      const dataValue = JSON.stringify({ tension: 0.8 });
      await repo.upsert('save-1', 'pacing', 'tension', dataValue);
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        save_id: 'save-1',
        data_type: 'pacing',
        data_key: 'tension',
        data_value: dataValue,
      }));
      expect(onConflictMock).toHaveBeenCalledWith(['save_id', 'data_type', 'data_key']);
      expect(mergeMock).toHaveBeenCalled();
    });
  });

  describe('deleteBySaveId', () => {
    it('应通过 save_id 删除记录并返回 void', async () => {
      const qb = createMockQueryBuilder();
      const delMock = vi.fn().mockResolvedValue(2);
      qb.where.mockReturnValueOnce({ del: delMock });
      const repo = new SaveStateRepository(createMockDb(qb));
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
      const repo = new SaveStateRepository(db);
      qb.where.mockReturnValueOnce({ del: vi.fn().mockResolvedValue(1) });
      await repo.deleteBySaveId('save-1', trxMock);
      expect(trxMock).toHaveBeenCalledWith('save_game_state');
      expect(db).not.toHaveBeenCalled();
    });
  });
});
