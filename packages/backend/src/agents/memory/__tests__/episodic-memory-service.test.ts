import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import knex, { type Knex } from 'knex';
import { EpisodicMemoryService } from '../episodic-memory-service.js';
import { EpisodicMemoryRepository } from '../../../game-systems/memory/EpisodicMemoryRepository.js';


const SAVE_ID = 'save-test-001';
const AGENT_KEY = 'story';

async function createTestDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });

  // 创建 saves 表（外键依赖）
  await db.schema.createTable('saves', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('template_id').notNullable();
    table.text('game_mode').notNullable();
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
  });

  await db('saves').insert({
    id: SAVE_ID,
    name: 'Test Save',
    template_id: 'tpl-1',
    game_mode: 'turn_based_rpg',
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  // 创建 agent_episodic_memories 表（迁移 078）
  await db.schema.createTable('agent_episodic_memories', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('agent_key').notNullable();
    table.text('content').notNullable();
    table.text('type').notNullable();
    table.integer('importance').defaultTo(1);
    table.text('related_entities').defaultTo('[]');
    table.text('tags').defaultTo('[]');
    table.integer('turn_index').defaultTo(0);
    table.bigInteger('created_at').notNullable();
  });

  return db;
}

describe('EpisodicMemoryService', () => {
  let db: Knex;
  let service: EpisodicMemoryService;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    service = new EpisodicMemoryService(new EpisodicMemoryRepository(db));
  });

  // ─── save ───

  describe('save', () => {
    it('应保存情景记忆并返回完整对象', async () => {
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        content: '勇者击败了巨龙',
        type: 'combat',
        importance: 4,
        relatedEntities: ['dragon'],
        tags: ['boss'],
        turnIndex: 5,
      });

      expect(memory).toMatchObject({
        saveId: SAVE_ID,
        agentKey: AGENT_KEY,
        content: '勇者击败了巨龙',
        type: 'combat',
        importance: 4,
        relatedEntities: ['dragon'],
        tags: ['boss'],
        turnIndex: 5,
      });
      expect(memory.id).toBeTruthy();
      expect(memory.createdAt).toBeGreaterThan(0);
    });

    it('应将 importance 钳位到 1-5 范围', async () => {
      const low = await service.save(SAVE_ID, AGENT_KEY, {
        content: '低重要性',
        type: 'plot',
        importance: -1,
      });
      expect(low.importance).toBe(1);

      const high = await service.save(SAVE_ID, AGENT_KEY, {
        content: '高重要性',
        type: 'plot',
        importance: 10,
      });
      expect(high.importance).toBe(5);
    });

    it('应使用默认值填充可选字段', async () => {
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        content: '简单记忆',
        type: 'dialogue',
      });

      expect(memory.importance).toBe(1);
      expect(memory.relatedEntities).toEqual([]);
      expect(memory.tags).toEqual([]);
      expect(memory.turnIndex).toBe(0);
    });
  });

  // ─── recall ───

  describe('recall', () => {
    beforeEach(async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { content: '剧情事件A', type: 'plot', importance: 3 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '战斗事件B', type: 'combat', importance: 5 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '对话事件C', type: 'dialogue', importance: 2 });
    });

    it('应返回指定 saveId 和 agentKey 的所有记忆', async () => {
      const memories = await service.recall(SAVE_ID, AGENT_KEY);
      expect(memories.length).toBe(3);
    });

    it('应按 type 过滤', async () => {
      const memories = await service.recall(SAVE_ID, AGENT_KEY, { type: 'combat' });
      expect(memories.length).toBe(1);
      expect(memories[0].type).toBe('combat');
    });

    it('应按 minImportance 过滤', async () => {
      const memories = await service.recall(SAVE_ID, AGENT_KEY, { minImportance: 3 });
      expect(memories.length).toBe(2);
      expect(memories.every(m => m.importance >= 3)).toBe(true);
    });

    it('应按 limit 限制返回数量', async () => {
      const memories = await service.recall(SAVE_ID, AGENT_KEY, { limit: 2 });
      expect(memories.length).toBe(2);
    });

    it('应按 importance 降序、createdAt 降序排列', async () => {
      const memories = await service.recall(SAVE_ID, AGENT_KEY);
      expect(memories[0].importance).toBeGreaterThanOrEqual(memories[1].importance);
    });

    it('不同 agentKey 应返回空数组', async () => {
      const memories = await service.recall(SAVE_ID, 'other-agent');
      expect(memories.length).toBe(0);
    });
  });

  // ─── saveBatch ───

  describe('saveBatch', () => {
    beforeEach(async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
    });

    it('应批量保存事实并去重', async () => {
      await service.save(SAVE_ID, AGENT_KEY, { content: '已存在的事实', type: 'plot', importance: 3 });

      const result = await service.saveBatch(SAVE_ID, AGENT_KEY, [
        { content: '已存在的事实', type: 'plot', importance: 3, relatedEntities: [], timestamp: Date.now() },
        { content: '新事实A', type: 'quest', importance: 4, relatedEntities: [], timestamp: Date.now() },
        { content: '新事实B', type: 'item', importance: 2, relatedEntities: [], timestamp: Date.now() },
      ]);

      expect(result.savedCount).toBe(2);
      expect(result.skippedDuplicateCount).toBe(1);
    });

    it('应跳过 importance < 2 的事实', async () => {
      const result = await service.saveBatch(SAVE_ID, AGENT_KEY, [
        { content: '低重要性事实', type: 'plot', importance: 1, relatedEntities: [], timestamp: Date.now() },
        { content: '合格事实', type: 'plot', importance: 3, relatedEntities: [], timestamp: Date.now() },
      ]);

      expect(result.savedCount).toBe(1);
      expect(result.skippedDuplicateCount).toBe(1);
    });

    it('空事实列表应返回零计数', async () => {
      const result = await service.saveBatch(SAVE_ID, AGENT_KEY, []);
      expect(result.savedCount).toBe(0);
      expect(result.skippedDuplicateCount).toBe(0);
    });
  });

  // ─── search ───

  describe('search', () => {
    beforeEach(async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { content: '勇者在森林中发现了宝箱', type: 'item', importance: 3 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '勇者击败了暗影骑士', type: 'combat', importance: 5 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '村民请求帮助寻找失踪的孩子', type: 'quest', importance: 4 });
    });

    it('应按关键词搜索记忆内容', async () => {
      const results = await service.search(SAVE_ID, AGENT_KEY, '勇者');
      expect(results.length).toBe(2);
    });

    it('无匹配时应返回空数组', async () => {
      const results = await service.search(SAVE_ID, AGENT_KEY, '不存在的关键词');
      expect(results.length).toBe(0);
    });

    it('应按 limit 限制返回数量', async () => {
      const results = await service.search(SAVE_ID, AGENT_KEY, '勇者', 1);
      expect(results.length).toBe(1);
    });
  });

  // ─── compress ───

  describe('compress', () => {
    it('应删除低重要性记忆（importance < retainHighImportance）', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { content: '低重要性1', type: 'plot', importance: 1 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '低重要性2', type: 'dialogue', importance: 2 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '高重要性', type: 'combat', importance: 5 });

      const result = await service.compress(SAVE_ID, AGENT_KEY);

      // 默认 retainHighImportance = 4，所以 importance < 4 的被删除
      expect(result.compressedCount).toBe(2);

      const remaining = await service.recall(SAVE_ID, AGENT_KEY);
      expect(remaining.length).toBe(1);
      expect(remaining[0].importance).toBe(5);
    });

    it('没有低重要性记忆时应返回 0', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { content: '高重要性', type: 'combat', importance: 5 });

      const result = await service.compress(SAVE_ID, AGENT_KEY);
      expect(result.compressedCount).toBe(0);
    });
  });

  // ─── getSummary ───

  describe('getSummary', () => {
    it('应返回格式化的记忆摘要', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { content: '勇者击败了巨龙', type: 'combat', importance: 5 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '获得了龙鳞盾', type: 'item', importance: 3 });

      const summary = await service.getSummary(SAVE_ID, AGENT_KEY);

      expect(summary).toContain('[战斗]');
      expect(summary).toContain('勇者击败了巨龙');
      expect(summary).toContain('[物品]');
      expect(summary).toContain('获得了龙鳞盾');
    });

    it('无记忆时应返回空字符串', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      const summary = await service.getSummary(SAVE_ID, AGENT_KEY);
      expect(summary).toBe('');
    });
  });

  // ─── getMemoryCount ───

  describe('getMemoryCount', () => {
    it('应返回正确的记忆数量', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { content: '记忆1', type: 'plot', importance: 3 });
      await service.save(SAVE_ID, AGENT_KEY, { content: '记忆2', type: 'quest', importance: 4 });

      const count = await service.getMemoryCount(SAVE_ID, AGENT_KEY);
      expect(count).toBe(2);
    });

    it('无记忆时应返回 0', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      const count = await service.getMemoryCount(SAVE_ID, AGENT_KEY);
      expect(count).toBe(0);
    });
  });

  // ─── checkAndCompressIfNeeded ───

  describe('checkAndCompressIfNeeded', () => {
    it('记忆数未达阈值时应返回 compressed: false', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { content: '记忆1', type: 'plot', importance: 3 });

      const result = await service.checkAndCompressIfNeeded(SAVE_ID, AGENT_KEY);
      expect(result.compressed).toBe(false);
    });

    it('记忆数达到阈值时应触发压缩', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();

      const lowThresholdService = new EpisodicMemoryService(new EpisodicMemoryRepository(db), { compressThreshold: 3 });

      for (let i = 0; i < 5; i++) {
        await service.save(SAVE_ID, AGENT_KEY, {
          content: `记忆${i}`,
          type: 'plot',
          importance: i < 3 ? 1 : 5,
        });
      }

      const result = await lowThresholdService.checkAndCompressIfNeeded(SAVE_ID, AGENT_KEY);
      expect(result.compressed).toBe(true);
      expect(result.count).toBeGreaterThan(0);
    });
  });

  // ─── delete ───

  describe('delete', () => {
    it('应删除指定记忆并返回 true', async () => {
      await db('agent_episodic_memories').where({ save_id: SAVE_ID }).delete();
      const memory = await service.save(SAVE_ID, AGENT_KEY, { content: '待删除', type: 'plot', importance: 1 });

      const deleted = await service.delete(SAVE_ID, AGENT_KEY, memory.id);
      expect(deleted).toBe(true);

      const count = await service.getMemoryCount(SAVE_ID, AGENT_KEY);
      expect(count).toBe(0);
    });

    it('删除不存在的记忆应返回 false', async () => {
      const deleted = await service.delete(SAVE_ID, AGENT_KEY, 'nonexistent-id');
      expect(deleted).toBe(false);
    });
  });
});
