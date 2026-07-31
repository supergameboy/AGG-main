import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { AgentContextRepository } from '../AgentContextRepository.js';
import type { AgentContextRow } from '../types.js';

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

describe('AgentContextRepository', () => {
  it('应能正确实例化', () => {
    const repo = new AgentContextRepository(createMockDb(createMockQueryBuilder()));
    expect(repo).toBeInstanceOf(AgentContextRepository);
  });

  describe('rowToEntity', () => {
    it('应直接返回 row（messages + state 保持 string）', () => {
      const repo = new AgentContextRepository(createMockDb(createMockQueryBuilder()));
      const row = {
        id: 'ctx-1',
        save_id: 'save-1',
        agent_type: 'story',
        messages: '[]',
        state: '{"chapter": "ch1"}',
        updated_at: 123456,
      };
      const entity = (repo as unknown as { rowToEntity: (r: Record<string, unknown>) => unknown }).rowToEntity(row);
      expect(entity).toEqual(row);
    });
  });

  describe('getContext', () => {
    it('应通过 save_id + agent_type 查询并返回 AgentContextRow（含 messages + state）', async () => {
      const qb = createMockQueryBuilder();
      const mockRow: AgentContextRow = {
        id: 'ctx-1', save_id: 'save-1', agent_type: 'story',
        messages: '[]', state: '{}', updated_at: 1000,
      };
      qb.where.mockReturnValueOnce({ first: vi.fn().mockResolvedValue(mockRow) });
      const repo = new AgentContextRepository(createMockDb(qb));
      const result = await repo.getContext('save-1', 'story');
      expect(result).toEqual(mockRow);
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1', agent_type: 'story' });
    });

    it('查询无结果时应返回 null', async () => {
      const qb = createMockQueryBuilder();
      qb.where.mockReturnValueOnce({ first: vi.fn().mockResolvedValue(null) });
      const repo = new AgentContextRepository(createMockDb(qb));
      const result = await repo.getContext('save-none', 'story');
      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('应使用 insert + onConflict(save_id, agent_type) + merge 写入 messages + state', async () => {
      const qb = createMockQueryBuilder();
      const mergeMock = vi.fn().mockResolvedValue(undefined);
      const onConflictMock = vi.fn().mockReturnValue({ merge: mergeMock });
      const insertMock = vi.fn().mockReturnValue({ onConflict: onConflictMock });
      qb.insert = insertMock;
      const repo = new AgentContextRepository(createMockDb(qb));
      const messages = JSON.stringify([{ role: 'user', content: 'hello' }]);
      const state = JSON.stringify({ chapter: 'chapter_2' });
      await repo.upsert('save-1', 'story', messages, state);
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        save_id: 'save-1',
        agent_type: 'story',
        messages,
        state,
      }));
      expect(onConflictMock).toHaveBeenCalledWith(['save_id', 'agent_type']);
      expect(mergeMock).toHaveBeenCalled();
    });
  });

  describe('deleteBySaveId', () => {
    it('应通过 save_id 删除记录并返回 void', async () => {
      const qb = createMockQueryBuilder();
      const delMock = vi.fn().mockResolvedValue(3);
      qb.where.mockReturnValueOnce({ del: delMock });
      const repo = new AgentContextRepository(createMockDb(qb));
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
      const repo = new AgentContextRepository(db);
      qb.where.mockReturnValueOnce({ del: vi.fn().mockResolvedValue(1) });
      await repo.deleteBySaveId('save-1', trxMock);
      expect(trxMock).toHaveBeenCalledWith('agent_contexts');
      expect(db).not.toHaveBeenCalled();
    });
  });
});
