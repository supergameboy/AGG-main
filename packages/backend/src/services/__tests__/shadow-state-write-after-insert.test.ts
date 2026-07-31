/**
 * ShadowStateLayer write-after-insert BUG 回归测试
 *
 * 验证修复：同一 staging 请求内先 insert 后 update 同一实体，
 * read() 必须返回合并后的数据，而不是陈旧的 insert 数据。
 *
 * BUG 现象（修复前）：
 *   1. apply('npcs', 'insert', {id:'npc_1', location_id:'loc_A'})
 *   2. apply('npcs', 'update', {location_id:'loc_B'}, {id:'npc_1'})
 *   3. read('npcs', {id:'npc_1'}) → 返回 {id:'npc_1', location_id:'loc_A'}（陈旧！）
 *
 * 修复后预期：返回 {id:'npc_1', location_id:'loc_B'}（合并后）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShadowStateLayer } from '../ShadowStateLayer.js';

// Mock logger 避免真实日志输出
vi.mock('../../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('ShadowStateLayer: write-after-insert', () => {
  let layer: ShadowStateLayer;

  beforeEach(() => {
    // 使用空 baseSnapshot（模拟新创建的实体不在快照中）
    const mockDb = {} as never;
    layer = new ShadowStateLayer(mockDb, {}, []);
  });

  it('insert 后 update 同一实体，read 返回合并后的数据', () => {
    // 1. insert NPC（模拟 create_npc）
    layer.apply('npcs', 'insert', {
      id: 'npc_村长_1',
      save_id: 'save_1',
      name: '村长艾德温',
      location_id: 'loc_暗影大陆_1',
      level: 5,
    });

    // 2. update NPC 的 location_id（模拟 move_npc）
    layer.apply('npcs', 'update', {
      location_id: 'loc_白杨村_2',
    }, {
      id: 'npc_村长_1',
    });

    // 3. read 应返回合并后的数据（location_id 为新值）
    const result = layer.readOne('npcs', { id: 'npc_村长_1', save_id: 'save_1' });
    expect(result).toBeDefined();
    expect(result!.location_id).toBe('loc_白杨村_2');
    expect(result!.name).toBe('村长艾德温');
    expect(result!.level).toBe(5);
  });

  it('insert 后多次 update，read 返回所有 update 的合并结果', () => {
    layer.apply('npcs', 'insert', {
      id: 'npc_1',
      save_id: 'save_1',
      name: 'NPC',
      location_id: 'loc_A',
      mood: 50,
    });

    layer.apply('npcs', 'update', { location_id: 'loc_B' }, { id: 'npc_1' });
    layer.apply('npcs', 'update', { mood: 80 }, { id: 'npc_1' });

    const result = layer.readOne('npcs', { id: 'npc_1' });
    expect(result).toBeDefined();
    expect(result!.location_id).toBe('loc_B');
    expect(result!.mood).toBe(80);
    expect(result!.name).toBe('NPC');
  });

  it('insert 后 delete，read 不返回该实体', () => {
    layer.apply('npcs', 'insert', {
      id: 'npc_1',
      save_id: 'save_1',
      name: 'NPC',
    });

    layer.apply('npcs', 'delete', {}, { id: 'npc_1' });

    const result = layer.readOne('npcs', { id: 'npc_1' });
    expect(result).toBeUndefined();
  });

  it('read 多条记录时，insert 行也正确合并 update', () => {
    // insert 两个 NPC
    layer.apply('npcs', 'insert', {
      id: 'npc_1',
      save_id: 'save_1',
      name: 'NPC1',
      location_id: 'loc_A',
    });
    layer.apply('npcs', 'insert', {
      id: 'npc_2',
      save_id: 'save_1',
      name: 'NPC2',
      location_id: 'loc_B',
    });

    // 只更新 npc_1
    layer.apply('npcs', 'update', { location_id: 'loc_C' }, { id: 'npc_1' });

    // 查询 save_id 下所有 NPC
    const results = layer.read('npcs', { save_id: 'save_1' });
    expect(results).toBeDefined();
    expect(results!.length).toBe(2);

    // 找到 npc_1 和 npc_2
    const npcRows = results! as Array<Record<string, unknown>>;
    const npc1 = npcRows.find(r => r.id === 'npc_1');
    const npc2 = npcRows.find(r => r.id === 'npc_2');

    expect(npc1).toBeDefined();
    expect(npc1!.location_id).toBe('loc_C');  // 合并了 update
    expect(npc2).toBeDefined();
    expect(npc2!.location_id).toBe('loc_B');  // 未被 update 影响
  });

  it('update 条目包含完整字段（id/save_id 等）', () => {
    // 这个测试验证次要修复：apply('update') 的 baseRow 查找补充了 pendingInserts
    layer.apply('npcs', 'insert', {
      id: 'npc_1',
      save_id: 'save_1',
      name: 'NPC',
      location_id: 'loc_A',
    });

    layer.apply('npcs', 'update', { mood: 80 }, { id: 'npc_1' });

    // pendingUpdates 条目应包含 id/save_id（来自 pendingInserts 的 baseRow）
    // 这样按非主键字段查询时也能匹配
    const result = layer.readOne('npcs', { save_id: 'save_1', mood: 80 });
    expect(result).toBeDefined();
    expect(result!.id).toBe('npc_1');
    expect(result!.mood).toBe(80);
  });

  // C9: 补充 getSnapshotSummary 测试
  // 原 BUG：update 找不到 baseRow 导致 pendingUpdates 为空，getSnapshotSummary 只显示 INSERT 不显示 UPDATE
  it('write-after-insert 后 getSnapshotSummary 显示完整 INSERT + UPDATE 摘要', () => {
    // getSnapshotSummary 依赖 snapshotTables 配置，需使用带 tables 配置的 layer
    const mockDb = {} as never;
    const summaryLayer = new ShadowStateLayer(mockDb, {}, [
      { table: 'npcs', scopeField: 'save_id' },
    ]);

    // 1. insert NPC
    summaryLayer.apply('npcs', 'insert', {
      id: 'npc_1',
      save_id: 'save_1',
      name: 'NPC',
      location_id: 'loc_A',
    });

    // 2. update 同一 NPC 的 location_id
    summaryLayer.apply('npcs', 'update', {
      location_id: 'loc_B',
    }, {
      id: 'npc_1',
    });

    // 3. getSnapshotSummary 应同时包含 INSERT 和 UPDATE
    const summary = summaryLayer.getSnapshotSummary();
    expect(summary).toContain('INSERT');
    expect(summary).toContain('UPDATE');
    expect(summary).toContain('npc_1');
    expect(summary).toContain('loc_A');
    expect(summary).toContain('loc_B');
  });

  it('write-after-insert 跨表场景：locations insert + npcs insert + npcs update 都在摘要中', () => {
    const mockDb = {} as never;
    const summaryLayer = new ShadowStateLayer(mockDb, {}, [
      { table: 'locations', scopeField: 'save_id' },
      { table: 'npcs', scopeField: 'save_id' },
    ]);

    // 模拟初始化场景：先创建地点，再创建 NPC 并更新其位置
    summaryLayer.apply('locations', 'insert', {
      id: 'loc_1',
      save_id: 'save_1',
      name: '白杨村',
    });
    summaryLayer.apply('npcs', 'insert', {
      id: 'npc_1',
      save_id: 'save_1',
      name: '村长',
      location_id: 'loc_1',
    });
    summaryLayer.apply('npcs', 'update', {
      status: 'friendly',
    }, {
      id: 'npc_1',
    });

    const summary = summaryLayer.getSnapshotSummary();
    // 两张表都有写入
    expect(summary).toContain('[locations]');
    expect(summary).toContain('[npcs]');
    // locations 只有 INSERT
    expect(summary).toContain('白杨村');
    // npcs 有 INSERT 和 UPDATE
    expect(summary).toContain('村长');
    expect(summary).toContain('status');
  });
});
