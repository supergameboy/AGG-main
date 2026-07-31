import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { StoryEventRepository } from '../StoryEventRepository.js';
import type { StoryEventRow } from '../types.js';

function createMockQueryBuilder() {
  const qb: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    select: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(1),
    count: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  return qb;
}

function createMockDb(qb: ReturnType<typeof createMockQueryBuilder>) {
  return vi.fn(() => qb) as unknown as Knex;
}

describe('StoryEventRepository', () => {
  it('应能正确实例化', () => {
    const repo = new StoryEventRepository(createMockDb(createMockQueryBuilder()));
    expect(repo).toBeInstanceOf(StoryEventRepository);
  });

  describe('rowToEntity', () => {
    it('应正确映射 story_events 行（participants 保持 JSON 字符串）', () => {
      const repo = new StoryEventRepository(createMockDb(createMockQueryBuilder()));
      const row = {
        id: 'evt-1',
        save_id: 'save-1',
        chapter: 'chapter_1',
        event_type: 'quest',
        title: '玩家接到委托',
        description: '新的任务',
        importance: 'major',
        participants: '["npc-1", "npc-2"]',
        impact: '{"faction": "village"}',
        timestamp: 123456,
      };
      const entity = (repo as unknown as { rowToEntity: (r: Record<string, unknown>) => unknown }).rowToEntity(row);
      expect(entity).toEqual({
        id: 'evt-1',
        save_id: 'save-1',
        chapter: 'chapter_1',
        event_type: 'quest',
        title: '玩家接到委托',
        description: '新的任务',
        importance: 'major',
        participants: '["npc-1", "npc-2"]',
        impact: '{"faction": "village"}',
        timestamp: 123456,
      });
    });

    it('字段缺失时应使用默认值', () => {
      const repo = new StoryEventRepository(createMockDb(createMockQueryBuilder()));
      const row = { id: 'evt-2', save_id: 'save-2', event_type: 'talk', title: '对话' };
      const entity = (repo as unknown as { rowToEntity: (r: Record<string, unknown>) => unknown }).rowToEntity(row);
      expect((entity as { chapter: string }).chapter).toBe('');
      expect((entity as { description: string }).description).toBe('');
      expect((entity as { importance: string }).importance).toBe('minor');
      expect((entity as { participants: string }).participants).toBe('[]');
      expect((entity as { impact: string }).impact).toBe('{}');
    });
  });

  describe('addStoryEvent', () => {
    it('应插入事件并返回生成的 id', async () => {
      const qb = createMockQueryBuilder();
      const insertMock = vi.fn().mockResolvedValue(undefined);
      qb.insert = insertMock;
      const repo = new StoryEventRepository(createMockDb(qb));
      const eventInput: Omit<StoryEventRow, 'id' | 'save_id' | 'timestamp'> = {
        chapter: 'chapter_1',
        event_type: 'quest',
        title: '测试事件',
        description: '描述',
        importance: 'major',
        participants: '[]',
        impact: '{}',
      };
      const id = await repo.addStoryEvent('save-1', eventInput);
      expect(id).toBeTruthy();
      expect(id.startsWith('story_')).toBe(true);
      expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
        save_id: 'save-1',
        chapter: 'chapter_1',
        event_type: 'quest',
        title: '测试事件',
        importance: 'major',
      }));
    });
  });

  describe('getStoryEvents', () => {
    it('应按 timestamp 降序查询并返回 StoryEventRow[]', async () => {
      const qb = createMockQueryBuilder();
      const mockRows: StoryEventRow[] = [
        { id: 'evt-2', save_id: 'save-1', chapter: '', event_type: 'talk', title: '事件2', description: '', importance: 'minor', participants: '[]', impact: '{}', timestamp: 200 },
        { id: 'evt-1', save_id: 'save-1', chapter: '', event_type: 'talk', title: '事件1', description: '', importance: 'minor', participants: '[]', impact: '{}', timestamp: 100 },
      ];
      const selectMock = vi.fn().mockResolvedValue(mockRows);
      qb.where.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValueOnce({ select: selectMock, limit: vi.fn().mockReturnThis() }),
      });
      const repo = new StoryEventRepository(createMockDb(qb));
      const result = await repo.getStoryEvents('save-1');
      expect(result).toEqual(mockRows);
      expect(qb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
    });

    it('传入 limit 时应应用 limit', async () => {
      const qb = createMockQueryBuilder();
      const selectMock = vi.fn().mockResolvedValue([]);
      // Knex 链式 API：where/orderBy/limit/select 都返回 query builder 自身
      // mock 的 query 对象必须支持链式调用（limit 返回 this），最终 query.select() 可调用
      const chainable = {
        select: selectMock,
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      };
      qb.where.mockReturnValueOnce({
        orderBy: vi.fn().mockReturnValueOnce(chainable),
      });
      const repo = new StoryEventRepository(createMockDb(qb));
      await repo.getStoryEvents('save-1', { limit: 10 });
      expect(chainable.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('deleteBySaveId', () => {
    it('应通过 save_id 删除记录并返回 void', async () => {
      const qb = createMockQueryBuilder();
      const delMock = vi.fn().mockResolvedValue(2);
      qb.where.mockReturnValueOnce({ del: delMock });
      const repo = new StoryEventRepository(createMockDb(qb));
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
      const repo = new StoryEventRepository(db);
      qb.where.mockReturnValueOnce({ del: vi.fn().mockResolvedValue(1) });
      await repo.deleteBySaveId('save-1', trxMock);
      expect(trxMock).toHaveBeenCalledWith('story_events');
      expect(db).not.toHaveBeenCalled();
    });
  });
});
