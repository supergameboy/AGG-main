import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import knex, { type Knex } from 'knex';
import { ProceduralMemoryService } from '../procedural-memory-service.js';
import { ProceduralMemoryRepository } from '../../../game-systems/memory/ProceduralMemoryRepository.js';


const SAVE_ID = 'save-proc-test-001';
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

  // 创建 agent_procedural_memories 表（迁移 078）
  await db.schema.createTable('agent_procedural_memories', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('agent_key').notNullable();
    table.text('condition').notNullable();
    table.text('action').notNullable();
    table.text('outcome').notNullable();
    table.integer('effectiveness').defaultTo(3);
    table.integer('usage_count').defaultTo(0);
    table.bigInteger('last_used_at');
    table.text('tags').defaultTo('[]');
    table.bigInteger('created_at').notNullable();
    table.bigInteger('updated_at').notNullable();
  });

  return db;
}

describe('ProceduralMemoryService', () => {
  let db: Knex;
  let service: ProceduralMemoryService;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    service = new ProceduralMemoryService(new ProceduralMemoryRepository(db));
  });

  // ─── save ───

  describe('save', () => {
    it('应保存程序化记忆并返回完整对象', async () => {
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '敌人弱火',
        action: '使用火球术攻击',
        outcome: '造成双倍伤害',
        effectiveness: 4,
        tags: ['combat', 'element'],
      });

      expect(memory).toMatchObject({
        saveId: SAVE_ID,
        agentKey: AGENT_KEY,
        condition: '敌人弱火',
        action: '使用火球术攻击',
        outcome: '造成双倍伤害',
        effectiveness: 4,
        usageCount: 0,
        lastUsedAt: null,
        tags: ['combat', 'element'],
      });
      expect(memory.id).toBeTruthy();
      expect(memory.createdAt).toBeGreaterThan(0);
      expect(memory.updatedAt).toBeGreaterThan(0);
    });

    it('应将 effectiveness 钳位到 1-5 范围', async () => {
      const low = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '测试', action: '测试', outcome: '测试', effectiveness: -1,
      });
      expect(low.effectiveness).toBe(1);

      const high = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '测试', action: '测试', outcome: '测试', effectiveness: 10,
      });
      expect(high.effectiveness).toBe(5);
    });

    it('应使用默认 effectiveness 3', async () => {
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '默认', action: '默认', outcome: '默认',
      });
      expect(memory.effectiveness).toBe(3);
    });
  });

  // ─── recall ───

  describe('recall', () => {
    beforeEach(async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { condition: '敌人弱火', action: '火球术', outcome: '双倍伤害', effectiveness: 5 });
      await service.save(SAVE_ID, AGENT_KEY, { condition: '队友受伤', action: '治疗术', outcome: '恢复HP', effectiveness: 3 });
      await service.save(SAVE_ID, AGENT_KEY, { condition: '宝箱陷阱', action: '检查陷阱', outcome: '安全开箱', effectiveness: 2 });
    });

    it('应返回指定 saveId 和 agentKey 的所有规则', async () => {
      const rules = await service.recall(SAVE_ID, AGENT_KEY);
      expect(rules.length).toBe(3);
    });

    it('应按 minEffectiveness 过滤', async () => {
      const rules = await service.recall(SAVE_ID, AGENT_KEY, { minEffectiveness: 3 });
      expect(rules.length).toBe(2);
      expect(rules.every(r => r.effectiveness >= 3)).toBe(true);
    });

    it('应按 effectiveness 降序、usageCount 降序排列', async () => {
      const rules = await service.recall(SAVE_ID, AGENT_KEY);
      expect(rules[0].effectiveness).toBeGreaterThanOrEqual(rules[1].effectiveness);
    });

    it('应按 limit 限制返回数量', async () => {
      const rules = await service.recall(SAVE_ID, AGENT_KEY, { limit: 2 });
      expect(rules.length).toBe(2);
    });
  });

  // ─── findApplicable ───

  describe('findApplicable', () => {
    beforeEach(async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { condition: '弱火,火属性', action: '火球术', outcome: '双倍伤害', effectiveness: 5 });
      await service.save(SAVE_ID, AGENT_KEY, { condition: '队友受伤', action: '治疗术', outcome: '恢复HP', effectiveness: 3 });
      await service.save(SAVE_ID, AGENT_KEY, { condition: '宝箱陷阱,地牢', action: '检查陷阱', outcome: '安全开箱', effectiveness: 4 });
    });

    it('应匹配 context 中包含 condition 关键词的规则', async () => {
      const rules = await service.findApplicable(SAVE_ID, AGENT_KEY, '遇到了弱火的敌人');
      expect(rules.length).toBe(1);
      expect(rules[0].action).toBe('火球术');
    });

    it('应匹配多个关键词中的任意一个', async () => {
      const rules = await service.findApplicable(SAVE_ID, AGENT_KEY, '地牢中探索');
      expect(rules.length).toBe(1);
      expect(rules[0].action).toBe('检查陷阱');
    });

    it('无匹配时应返回空数组', async () => {
      const rules = await service.findApplicable(SAVE_ID, AGENT_KEY, '在酒馆休息');
      expect(rules.length).toBe(0);
    });

    it('应结合 minEffectiveness 过滤', async () => {
      await service.save(SAVE_ID, AGENT_KEY, { condition: '受伤', action: '休息', outcome: '恢复', effectiveness: 1 });

      const rules = await service.findApplicable(SAVE_ID, AGENT_KEY, '队友受伤了', { minEffectiveness: 3 });
      expect(rules.every(r => r.effectiveness >= 3)).toBe(true);
    });
  });

  // ─── updateEffectiveness ───

  describe('updateEffectiveness', () => {
    it('应按 delta 调整 effectiveness', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '测试', action: '测试', outcome: '测试', effectiveness: 3,
      });

      const updated = await service.updateEffectiveness(memory.id, 1);
      expect(updated).toBe(true);

      const recalled = await service.recall(SAVE_ID, AGENT_KEY);
      expect(recalled[0].effectiveness).toBe(4);
    });

    it('应将 effectiveness 钳位到 1-5', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '测试', action: '测试', outcome: '测试', effectiveness: 5,
      });

      await service.updateEffectiveness(memory.id, 10);

      const recalled = await service.recall(SAVE_ID, AGENT_KEY);
      expect(recalled[0].effectiveness).toBe(5);
    });

    it('不存在的 id 应返回 false', async () => {
      const result = await service.updateEffectiveness('nonexistent-id', 1);
      expect(result).toBe(false);
    });
  });

  // ─── reinforce ───

  describe('reinforce', () => {
    it('应递增 usageCount 并更新 lastUsedAt', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '测试', action: '测试', outcome: '测试', effectiveness: 3,
      });

      expect(memory.usageCount).toBe(0);
      expect(memory.lastUsedAt).toBeNull();

      const reinforced = await service.reinforce(memory.id);
      expect(reinforced).toBe(true);

      const recalled = await service.recall(SAVE_ID, AGENT_KEY);
      expect(recalled[0].usageCount).toBe(1);
      expect(recalled[0].lastUsedAt).toBeGreaterThan(0);
    });

    it('多次 reinforce 应累加 usageCount', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '测试', action: '测试', outcome: '测试', effectiveness: 3,
      });

      await service.reinforce(memory.id);
      await service.reinforce(memory.id);
      await service.reinforce(memory.id);

      const recalled = await service.recall(SAVE_ID, AGENT_KEY);
      expect(recalled[0].usageCount).toBe(3);
    });

    it('不存在的 id 应返回 false', async () => {
      const result = await service.reinforce('nonexistent-id');
      expect(result).toBe(false);
    });
  });

  // ─── prune ───

  describe('prune', () => {
    it('应剪枝低效且长期未用的规则', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();

      // effectiveness=1 < minEffectivenessToRetain(2)，且 usageCount=0 < 3 → 应被剪枝
      await service.save(SAVE_ID, AGENT_KEY, {
        condition: '低效规则', action: '无效果', outcome: '无效', effectiveness: 1,
      });

      // effectiveness=5 >= minEffectivenessToRetain(2) → 不应被剪枝
      await service.save(SAVE_ID, AGENT_KEY, {
        condition: '高效规则', action: '有效', outcome: '有效', effectiveness: 5,
      });

      const result = await service.prune(SAVE_ID, AGENT_KEY);
      expect(result.prunedCount).toBe(1);

      const remaining = await service.recall(SAVE_ID, AGENT_KEY);
      expect(remaining.length).toBe(1);
      expect(remaining[0].effectiveness).toBe(5);
    });

    it('低效但使用次数 >= 3 的规则不应被剪枝', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();

      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '低效但常用', action: '测试', outcome: '测试', effectiveness: 1,
      });

      // 手动设置 usage_count >= 3
      await db('agent_procedural_memories')
        .where({ id: memory.id })
        .update({ usage_count: 5, last_used_at: Date.now() });

      const result = await service.prune(SAVE_ID, AGENT_KEY);
      expect(result.prunedCount).toBe(0);
    });

    it('无规则应剪枝时应返回 0', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, {
        condition: '高效规则', action: '有效', outcome: '有效', effectiveness: 5,
      });

      const result = await service.prune(SAVE_ID, AGENT_KEY);
      expect(result.prunedCount).toBe(0);
    });
  });

  // ─── getSummary ───

  describe('getSummary', () => {
    it('应返回格式化的规则摘要', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, {
        condition: '敌人弱火', action: '火球术', outcome: '双倍伤害', effectiveness: 5,
      });
      await service.reinforce((await service.recall(SAVE_ID, AGENT_KEY))[0].id);
      await service.reinforce((await service.recall(SAVE_ID, AGENT_KEY))[0].id);

      const summary = await service.getSummary(SAVE_ID, AGENT_KEY);

      expect(summary).toContain('当敌人弱火时');
      expect(summary).toContain('火球术');
      expect(summary).toContain('有效性:5');
      expect(summary).toContain('使用2次');
    });

    it('无规则时应返回空字符串', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      const summary = await service.getSummary(SAVE_ID, AGENT_KEY);
      expect(summary).toBe('');
    });
  });

  // ─── getRuleCount ───

  describe('getRuleCount', () => {
    it('应返回正确的规则数量', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { condition: '规则1', action: 'A', outcome: 'A', effectiveness: 3 });
      await service.save(SAVE_ID, AGENT_KEY, { condition: '规则2', action: 'B', outcome: 'B', effectiveness: 4 });

      const count = await service.getRuleCount(SAVE_ID, AGENT_KEY);
      expect(count).toBe(2);
    });

    it('无规则时应返回 0', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      const count = await service.getRuleCount(SAVE_ID, AGENT_KEY);
      expect(count).toBe(0);
    });
  });

  // ─── checkAndPruneIfNeeded ───

  describe('checkAndPruneIfNeeded', () => {
    it('规则数未达阈值时应返回 pruned: false', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      await service.save(SAVE_ID, AGENT_KEY, { condition: '规则', action: 'A', outcome: 'A', effectiveness: 3 });

      const result = await service.checkAndPruneIfNeeded(SAVE_ID, AGENT_KEY);
      expect(result.pruned).toBe(false);
    });

    it('规则数达到阈值时应触发剪枝', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();

      const lowThresholdService = new ProceduralMemoryService(new ProceduralMemoryRepository(db), { pruneThreshold: 3 });

      for (let i = 0; i < 5; i++) {
        await service.save(SAVE_ID, AGENT_KEY, {
          condition: `规则${i}`,
          action: `动作${i}`,
          outcome: `结果${i}`,
          effectiveness: i < 3 ? 1 : 5,
        });
      }

      const result = await lowThresholdService.checkAndPruneIfNeeded(SAVE_ID, AGENT_KEY);
      expect(result.pruned).toBe(true);
      expect(result.count).toBeGreaterThan(0);
    });
  });

  // ─── delete ───

  describe('delete', () => {
    it('应删除指定规则并返回 true', async () => {
      await db('agent_procedural_memories').where({ save_id: SAVE_ID }).delete();
      const memory = await service.save(SAVE_ID, AGENT_KEY, {
        condition: '待删除', action: '删除', outcome: '删除', effectiveness: 1,
      });

      const deleted = await service.delete(SAVE_ID, AGENT_KEY, memory.id);
      expect(deleted).toBe(true);

      const count = await service.getRuleCount(SAVE_ID, AGENT_KEY);
      expect(count).toBe(0);
    });

    it('删除不存在的规则应返回 false', async () => {
      const deleted = await service.delete(SAVE_ID, AGENT_KEY, 'nonexistent-id');
      expect(deleted).toBe(false);
    });
  });
});
