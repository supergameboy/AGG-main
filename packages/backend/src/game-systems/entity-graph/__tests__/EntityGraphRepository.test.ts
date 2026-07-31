import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { EntityGraphRepository } from '../EntityGraphRepository.js';

/**
 * EntityGraphRepository 不继承 BaseRepository（操作两张表）。
 * mock 策略：db/trx 是函数，调用表名后返回 queryBuilder。
 * queryBuilder.where 返回 { del } 链式调用。
 */
function createMockQueryBuilderForTable(delResult = 0) {
  return {
    where: vi.fn().mockReturnValue({ del: vi.fn().mockResolvedValue(delResult) }),
  };
}

describe('EntityGraphRepository', () => {
  it('应能正确实例化', () => {
    const db = vi.fn() as unknown as Knex;
    const repo = new EntityGraphRepository(db);
    expect(repo).toBeInstanceOf(EntityGraphRepository);
  });

  describe('deleteBySaveId', () => {
    it('应按 FK 依赖顺序删除 edges → nodes → snapshots（EG-M1-7）', async () => {
      const edgesQb = createMockQueryBuilderForTable(2);
      const nodesQb = createMockQueryBuilderForTable(3);
      const snapshotsQb = createMockQueryBuilderForTable(1);
      const callOrder: string[] = [];
      const tableQbMap: Record<string, ReturnType<typeof createMockQueryBuilderForTable>> = {
        entity_graph_edges: edgesQb,
        entity_graph_nodes: nodesQb,
        entity_graph_snapshots: snapshotsQb,
      };
      const db = vi.fn((tableName: string) => {
        callOrder.push(tableName);
        return tableQbMap[tableName];
      }) as unknown as Knex;
      const repo = new EntityGraphRepository(db);
      await repo.deleteBySaveId('save-1');
      // 验证调用顺序：edges → nodes → snapshots（EG-M1-7 显式删除 3 张表）
      expect(callOrder).toEqual(['entity_graph_edges', 'entity_graph_nodes', 'entity_graph_snapshots']);
      expect(edgesQb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
      expect(nodesQb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
      expect(snapshotsQb.where).toHaveBeenCalledWith({ save_id: 'save-1' });
    });

    it('应返回 void', async () => {
      const edgesQb = createMockQueryBuilderForTable();
      const nodesQb = createMockQueryBuilderForTable();
      const snapshotsQb = createMockQueryBuilderForTable();
      const tableQbMap: Record<string, ReturnType<typeof createMockQueryBuilderForTable>> = {
        entity_graph_edges: edgesQb,
        entity_graph_nodes: nodesQb,
        entity_graph_snapshots: snapshotsQb,
      };
      const db = vi.fn((tableName: string) => tableQbMap[tableName]) as unknown as Knex;
      const repo = new EntityGraphRepository(db);
      const result = await repo.deleteBySaveId('save-1');
      expect(result).toBeUndefined();
    });
  });

  describe('trx 参数透传', () => {
    it('传入 trx 时应使用 trx 而非 db', async () => {
      const edgesQb = createMockQueryBuilderForTable();
      const nodesQb = createMockQueryBuilderForTable();
      const snapshotsQb = createMockQueryBuilderForTable();
      const tableQbMap: Record<string, ReturnType<typeof createMockQueryBuilderForTable>> = {
        entity_graph_edges: edgesQb,
        entity_graph_nodes: nodesQb,
        entity_graph_snapshots: snapshotsQb,
      };
      const db = vi.fn() as unknown as Knex;
      const trxMock = vi.fn((tableName: string) => tableQbMap[tableName]) as unknown as Knex.Transaction;
      const repo = new EntityGraphRepository(db);
      await repo.deleteBySaveId('save-1', trxMock);
      expect(trxMock).toHaveBeenCalledWith('entity_graph_edges');
      expect(trxMock).toHaveBeenCalledWith('entity_graph_nodes');
      expect(trxMock).toHaveBeenCalledWith('entity_graph_snapshots');
      expect(db).not.toHaveBeenCalled();
    });
  });
});
