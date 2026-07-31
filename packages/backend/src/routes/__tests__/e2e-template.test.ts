import express from 'express';
import knex, { type Knex } from 'knex';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { createTemplateRouter } from '../template.js';
import { errorHandler } from '../../middlewares/errorhandler.js';
import { runMigrations } from '../../migrations/runner.js';

// === 测试数据 ===

const TEST_TEMPLATE_RAW = {
  id: 'test-template',
  name: 'Test Fantasy Template',
  description: 'A test template for e2e tests',
  version: '1.0.0',
  author: 'test',
  tags: ['fantasy', 'test'],
  game_mode: 'turn_based_rpg',
  numerical_complexity: 'medium',
  agent_profile: 'fantasy_rpg',
  is_builtin: false,
  world_setting: { name: 'Test World', description: 'A test world' },
  character_creation: {
    races: ['human', 'elf', 'dwarf'],
    classes: ['warrior', 'mage', 'rogue'],
    backgrounds: ['soldier', 'scholar', 'criminal'],
    attributes: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    attribute_points: 27,
  },
  game_rules: {},
  ai_constraints: {},
  starting_scene: {},
  initial_data: {},
  skills: [],
  items: [],
  ui_theme: {},
  ui_layout: {},
  special_rules: {},
  combat: {},
};

const TEST_SKILL = {
  name: 'Fireball',
  description: 'A blazing fireball',
  category: 'attack',
  element: 'fire',
  cost: [{ type: 'mp', value: 10 }],
  damage: { basePower: 20, scaling: [{ attribute: 'intelligence', multiplier: 0.5 }] },
  cooldown: 3,
  maxLevel: 10,
  targetType: 'single',
  range: 5,
};

const TEST_ITEM = {
  name: 'Iron Sword',
  description: 'A sturdy iron sword',
  category: 'weapon',
  quality: 'common',
  stats: { attack: 5 },
  effects: [],
  value: { gold: 50 },
  weight: 3,
  equippedSlot: 'weapon',
};

// === App 工厂 ===

function createApp(db: Knex) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/templates', createTemplateRouter(db));
  app.use(errorHandler);
  return app;
}

// === 测试套件 ===

describe('Template API e2e', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  /** 插入测试模板到 DB（raw_content 使用 YAML 格式，与 TemplateService 一致） */
  async function insertTestTemplate(overrides?: Record<string, unknown>) {
    const raw = { ...TEST_TEMPLATE_RAW, ...overrides };
    const now = Date.now();
    await db('templates').insert({
      id: raw.id,
      raw_content: yaml.dump(raw, { schema: yaml.DEFAULT_SCHEMA, lineWidth: -1 }),
      source: 'editor',
      is_builtin: raw.is_builtin ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return raw;
  }

  // ========================================
  // GET / — 列出所有模板
  // ========================================

  describe('GET /', () => {
    it('返回空数组当无模板', async () => {
      const app = createApp(db);
      const res = await request(app).get('/api/v1/templates');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('返回已有模板数组', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('test-template');
      expect(res.body.data[0].name).toBe('Test Fantasy Template');
    });
  });

  // ========================================
  // GET /:id — 获取模板详情
  // ========================================

  describe('GET /:id', () => {
    it('返回模板详情', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates/test-template');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('test-template');
      expect(res.body.data.name).toBe('Test Fantasy Template');
      expect(res.body.data.game_mode).toBe('turn_based_rpg');
    });

    it('不存在返回 404', async () => {
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  // ========================================
  // POST / — 创建模板
  // ========================================

  describe('POST /', () => {
    it('创建模板成功返回模板对象', async () => {
      const app = createApp(db);

      const res = await request(app)
        .post('/api/v1/templates')
        .send({ data: TEST_TEMPLATE_RAW });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('test-template');
      expect(res.body.data.name).toBe('Test Fantasy Template');
    });

    it('缺少 data 字段返回 400', async () => {
      const app = createApp(db);

      const res = await request(app)
        .post('/api/v1/templates')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });

    it('缺少必填 name 字段返回 400', async () => {
      const app = createApp(db);

      const invalidTemplate = { ...TEST_TEMPLATE_RAW };
      delete (invalidTemplate as Record<string, unknown>).name;

      const res = await request(app)
        .post('/api/v1/templates')
        .send({ data: invalidTemplate });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ========================================
  // PUT /:id — 更新模板
  // ========================================

  describe('PUT /:id', () => {
    it('更新模板成功返回更新后对象', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app)
        .put('/api/v1/templates/test-template')
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Name');
    });

    it('不存在返回 404', async () => {
      const app = createApp(db);

      const res = await request(app)
        .put('/api/v1/templates/nonexistent')
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
    });

    it('空更新体返回 400', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app)
        .put('/api/v1/templates/test-template')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    });
  });

  // ========================================
  // DELETE /:id — 删除模板
  // ========================================

  describe('DELETE /:id', () => {
    it('删除模板成功返回 { deleted: true }', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app).delete('/api/v1/templates/test-template');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleted).toBe(true);
      expect(res.body.data.id).toBe('test-template');

      // 验证已从 DB 中删除
      const remaining = await db('templates').where({ id: 'test-template' });
      expect(remaining).toHaveLength(0);
    });

    it('不存在返回 404', async () => {
      const app = createApp(db);

      const res = await request(app).delete('/api/v1/templates/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TEMPLATE_NOT_FOUND');
    });

    it('内置模板返回 403', async () => {
      await insertTestTemplate({ is_builtin: true });
      const app = createApp(db);

      const res = await request(app).delete('/api/v1/templates/test-template');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ========================================
  // GET /:id/character-options — 获取角色创建选项
  // ========================================

  describe('GET /:id/character-options', () => {
    it('返回角色创建选项', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates/test-template/character-options');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.races).toEqual(['human', 'elf', 'dwarf']);
      expect(res.body.data.classes).toEqual(['warrior', 'mage', 'rogue']);
      expect(res.body.data.backgrounds).toEqual(['soldier', 'scholar', 'criminal']);
      expect(res.body.data.attribute_points).toBe(27);
    });

    it('模板不存在返回 404', async () => {
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates/nonexistent/character-options');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ========================================
  // GET /:id/pool/skills — 列出模板技能池
  // ========================================

  describe('GET /:id/pool/skills', () => {
    it('返回空数组当无技能', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates/test-template/pool/skills');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('返回已有技能列表', async () => {
      await insertTestTemplate();
      // 直接插入技能到 DB
      const now = Date.now();
      await db('template_skill_pool').insert({
        template_id: 'test-template',
        id: 'tskill_fireball_1234',
        name: 'Fireball',
        description: 'A blazing fireball',
        category: 'attack',
        element: 'fire',
        cost: '[]',
        damage: '{}',
        effects: '[]',
        cooldown: 3,
        max_level: 10,
        target_type: 'single',
        range: 5,
        custom_data: '{}',
        recommended_classes: '[]',
        source: 'manual',
        created_at: now,
        updated_at: now,
      });

      const app = createApp(db);
      const res = await request(app).get('/api/v1/templates/test-template/pool/skills');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Fireball');
    });
  });

  // ========================================
  // POST /:id/pool/skills — 创建模板技能
  // ========================================

  describe('POST /:id/pool/skills', () => {
    it('创建技能成功返回技能对象', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app)
        .post('/api/v1/templates/test-template/pool/skills')
        .send(TEST_SKILL);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Fireball');
      expect(res.body.data.category).toBe('attack');
      expect(res.body.data.element).toBe('fire');
    });
  });

  // ========================================
  // GET /:id/pool/items — 列出模板物品池
  // ========================================

  describe('GET /:id/pool/items', () => {
    it('返回空数组当无物品', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates/test-template/pool/items');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('返回已有物品列表', async () => {
      await insertTestTemplate();
      const now = Date.now();
      await db('template_item_pool').insert({
        template_id: 'test-template',
        id: 'titem_iron-sword_1234',
        name: 'Iron Sword',
        description: 'A sturdy iron sword',
        category: 'weapon',
        quality: 'common',
        stats: '{}',
        effects: '[]',
        value: '{}',
        tags: '[]',
        weight: 3,
        max_stack: 1,
        equipped_slot: 'weapon',
        durability: 100,
        max_durability: 100,
        custom_data: '{}',
        recommended_classes: '[]',
        source: 'manual',
        created_at: now,
        updated_at: now,
      });

      const app = createApp(db);
      const res = await request(app).get('/api/v1/templates/test-template/pool/items');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Iron Sword');
    });
  });

  // ========================================
  // POST /:id/pool/items — 创建模板物品
  // ========================================

  describe('POST /:id/pool/items', () => {
    it('创建物品成功返回物品对象', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app)
        .post('/api/v1/templates/test-template/pool/items')
        .send(TEST_ITEM);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Iron Sword');
      expect(res.body.data.category).toBe('weapon');
    });
  });

  // ========================================
  // GET /:id/pool/stats — 池统计
  // ========================================

  describe('GET /:id/pool/stats', () => {
    it('返回空池统计', async () => {
      await insertTestTemplate();
      const app = createApp(db);

      const res = await request(app).get('/api/v1/templates/test-template/pool/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('返回含数据的池统计', async () => {
      await insertTestTemplate();
      const now = Date.now();

      // 插入技能
      await db('template_skill_pool').insert({
        template_id: 'test-template',
        id: 'tskill_fireball_1234',
        name: 'Fireball',
        description: '',
        category: 'attack',
        element: 'fire',
        cost: '[]',
        damage: '{}',
        effects: '[]',
        cooldown: 3,
        max_level: 10,
        target_type: 'single',
        range: 5,
        custom_data: '{}',
        recommended_classes: '[]',
        source: 'manual',
        created_at: now,
        updated_at: now,
      });

      // 插入物品
      await db('template_item_pool').insert({
        template_id: 'test-template',
        id: 'titem_iron-sword_1234',
        name: 'Iron Sword',
        description: '',
        category: 'weapon',
        quality: 'common',
        stats: '{}',
        effects: '[]',
        value: '{}',
        tags: '[]',
        weight: 3,
        max_stack: 1,
        equipped_slot: 'weapon',
        durability: 100,
        max_durability: 100,
        custom_data: '{}',
        recommended_classes: '[]',
        source: 'manual',
        created_at: now,
        updated_at: now,
      });

      const app = createApp(db);
      const res = await request(app).get('/api/v1/templates/test-template/pool/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });
});
