// @vitest-environment node
// 此测试独立运行，不依赖全局 setup

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex, { type Knex } from 'knex';
import { runMigrations } from '../../migrations/runner.js';
import { SHADOW_STATE_TABLES } from '../../agents/init.js';

// ============================================================
// 数据库表结构验证测试 — 确保设计文档与实际 migration 一致
// ============================================================

describe('数据库表结构验证', () => {
  let db: Knex;

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
    });
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  // 辅助函数：获取表的所有列名
  async function getColumns(table: string): Promise<string[]> {
    const rows = await db.raw(`PRAGMA table_info(${table})`);
    return rows.map((r: { name: string }) => r.name);
  }

  // 辅助函数：检查表是否存在
  async function tableExists(table: string): Promise<boolean> {
    const rows = await db.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
    return rows.length > 0;
  }

  // 辅助函数：获取索引列表
  async function getIndexes(table: string): Promise<string[]> {
    const rows = await db.raw(`PRAGMA index_list(${table})`);
    return rows.map((r: { name: string }) => r.name);
  }

  // ============================================================
  // 核心表存在性验证
  // ============================================================
  describe('核心表存在性', () => {
    const requiredTables = [
      'saves', 'save_snapshots', 'save_game_state', 'save_game_time',
      'save_data_indexes', 'save_write_logs',
      'characters', 'inventory', 'item_pool',
      'character_skills', 'skill_pool',
      'quests', 'quest_objectives',
      'npcs', 'npc_goals',
      'locations', 'location_connections', 'discovered_locations',
      'dialogues', 'story_events',
      'agent_profiles', 'agent_contexts', 'agent_schedules',
      'agent_llm_calls', 'decision_logs', 'agent_dispatch_log',
      'agent_episodic_memories', 'agent_procedural_memories',
      'templates', 'prompts', 'model_providers', 'model_config_defaults',
      'template_skill_pool', 'template_item_pool',
      'events', 'event_triggers',
      'dialogue_summaries', 'frontend_logs',
      'dev_snapshots', 'dev_consistency_reports',
      'combat_states', 'combat_history',
      'entity_graph_nodes', 'entity_graph_edges',
      'entity_graph_snapshots',
      'pacing_config', 'pacing_history',
      // 006 升级：awareness/relationship 独立表
      'entity_awareness_events', 'entity_awareness_states',
      'entity_relationship_events', 'entity_relationship_states',
    ];

    for (const table of requiredTables) {
      it(`表 ${table} 应存在`, async () => {
        const exists = await tableExists(table);
        expect(exists).toBe(true);
      });
    }
  });

  // ============================================================
  // characters 表字段验证（迁移046重命名后）
  // ============================================================
  describe('characters 表字段（迁移046后）', () => {
    it('应有 current_hp 而非 health', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('current_hp');
      expect(cols).not.toContain('health');
    });

    it('应有 max_hp 而非 max_health', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('max_hp');
      expect(cols).not.toContain('max_health');
    });

    it('应有 current_mp 而非 mana', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('current_mp');
      expect(cols).not.toContain('mana');
    });

    it('应有 max_mp 而非 max_mana', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('max_mp');
      expect(cols).not.toContain('max_mana');
    });

    it('不应有 gold 字段（已合并到 currency）', async () => {
      const cols = await getColumns('characters');
      expect(cols).not.toContain('gold');
    });

    it('应有 currency 字段', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('currency');
    });

    it('应有 gender 字段（迁移040）', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('gender');
    });

    it('应有 custom_gender 字段（迁移041）', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('custom_gender');
    });

    it('应有 base_max_hp 和 base_max_mp 字段（迁移048）', async () => {
      const cols = await getColumns('characters');
      expect(cols).toContain('base_max_hp');
      expect(cols).toContain('base_max_mp');
    });
  });

  // ============================================================
  // saves 表新增字段验证
  // ============================================================
  describe('saves 表新增字段', () => {
    it('应有 current_snapshot_id 字段（迁移039）', async () => {
      const cols = await getColumns('saves');
      expect(cols).toContain('current_snapshot_id');
    });

    it('应有 snapshot_count 字段（迁移039）', async () => {
      const cols = await getColumns('saves');
      expect(cols).toContain('snapshot_count');
    });

    it('应有 language 字段（迁移042）', async () => {
      const cols = await getColumns('saves');
      expect(cols).toContain('language');
    });
  });

  // ============================================================
  // save_snapshots 表新增字段验证
  // ============================================================
  describe('save_snapshots 表新增字段（迁移039）', () => {
    const expectedNewFields = ['name', 'type', 'game_mode', 'location', 'level', 'main_quest', 'play_time', 'thumbnail', 'description'];

    for (const field of expectedNewFields) {
      it(`应有 ${field} 字段`, async () => {
        const cols = await getColumns('save_snapshots');
        expect(cols).toContain(field);
      });
    }
  });

  // ============================================================
  // character_skills 表验证
  // ============================================================
  describe('character_skills 表', () => {
    it('应有 unlocked 字段（迁移045）', async () => {
      const cols = await getColumns('character_skills');
      expect(cols).toContain('unlocked');
    });
  });

  // ============================================================
  // locations 表新增字段验证
  // ============================================================
  describe('locations 表新增字段', () => {
    it('应有 save_id 字段（迁移032）', async () => {
      const cols = await getColumns('locations');
      expect(cols).toContain('save_id');
    });

    it('应有 danger_level 字段（迁移037）', async () => {
      const cols = await getColumns('locations');
      expect(cols).toContain('danger_level');
    });
  });

  // ============================================================
  // 其他表新增字段验证
  // ============================================================
  describe('其他表新增字段', () => {
    it('templates 应有 raw_content 字段（迁移067重建后）', async () => {
      const cols = await getColumns('templates');
      expect(cols).toContain('raw_content');
    });

    it('event_triggers 应有 result_data 字段（迁移044）', async () => {
      const cols = await getColumns('event_triggers');
      expect(cols).toContain('result_data');
    });

    it('story_events 应有 importance 字段（迁移050）', async () => {
      const cols = await getColumns('story_events');
      expect(cols).toContain('importance');
    });

    it('agent_llm_calls 应有缓存指标字段（迁移049）', async () => {
      const cols = await getColumns('agent_llm_calls');
      expect(cols).toContain('prompt_cache_hit_tokens');
      expect(cols).toContain('prompt_cache_miss_tokens');
    });

    it('agent_llm_calls 应有 cost 字段（迁移010，M2-2 成本附带）', async () => {
      const cols = await getColumns('agent_llm_calls');
      expect(cols).toContain('cost');
    });
  });

  // ============================================================
  // 新表结构验证
  // ============================================================
  describe('新表结构验证', () => {
    it('combat_states 应有核心字段', async () => {
      const cols = await getColumns('combat_states');
      expect(cols).toContain('id');
      expect(cols).toContain('save_id');
      expect(cols).toContain('status');
      expect(cols).toContain('combat_data');
    });

    it('combat_history 应有核心字段', async () => {
      const cols = await getColumns('combat_history');
      expect(cols).toContain('id');
      expect(cols).toContain('save_id');
      expect(cols).toContain('result_data');
    });

    it('dialogue_summaries 应有核心字段', async () => {
      const cols = await getColumns('dialogue_summaries');
      expect(cols).toContain('id');
      expect(cols).toContain('save_id');
      expect(cols).toContain('summary');
    });

    it('frontend_logs 应有核心字段', async () => {
      const cols = await getColumns('frontend_logs');
      expect(cols).toContain('level');
      expect(cols).toContain('category');
      expect(cols).toContain('message');
    });
  });

  // ============================================================
  // templates 表新 schema 验证（迁移067后）
  // ============================================================
  describe('templates 表新 schema（迁移067后）', () => {
    it('应有 raw_content 字段', async () => {
      const cols = await getColumns('templates');
      expect(cols).toContain('raw_content');
    });

    it('不应有旧的 JSON 列字段', async () => {
      const cols = await getColumns('templates');
      expect(cols).not.toContain('world_setting');
      expect(cols).not.toContain('character_creation');
      expect(cols).not.toContain('game_rules');
      expect(cols).not.toContain('ai_constraints');
    });

    it('不应有 agent_profile 索引（列已删除）', async () => {
      const indexes = await getIndexes('templates');
      expect(indexes.some(i => i.includes('agent_profile'))).toBe(false);
    });
  });

  // ============================================================
  // 已删除表验证（迁移067删除 skills/items/template_npcs，迁移071删除 equipment）
  // ============================================================
  describe('已删除表验证', () => {
    it('skills 表应已删除', async () => {
      const exists = await tableExists('skills');
      expect(exists).toBe(false);
    });

    it('items 表应已删除', async () => {
      const exists = await tableExists('items');
      expect(exists).toBe(false);
    });

    it('template_npcs 表应已删除', async () => {
      const exists = await tableExists('template_npcs');
      expect(exists).toBe(false);
    });

    it('equipment 表应已删除（迁移071）', async () => {
      const exists = await tableExists('equipment');
      expect(exists).toBe(false);
    });
  });

  // ============================================================
  // inventory 表字段验证（迁移071后）
  // ============================================================
  describe('inventory 表字段（迁移071后）', () => {
    it('应有 inventory_slot 而非 slot', async () => {
      const cols = await getColumns('inventory');
      expect(cols).toContain('inventory_slot');
      expect(cols).not.toContain('slot');
    });

    it('应有 stats/effects/value/tags/description/pool_id 字段', async () => {
      const cols = await getColumns('inventory');
      expect(cols).toContain('stats');
      expect(cols).toContain('effects');
      expect(cols).toContain('value');
      expect(cols).toContain('tags');
      expect(cols).toContain('description');
      expect(cols).toContain('pool_id');
    });
  });

  // ============================================================
  // item_pool 表字段验证（迁移071）
  // ============================================================
  describe('item_pool 表字段（迁移071）', () => {
    it('应有核心字段', async () => {
      const cols = await getColumns('item_pool');
      expect(cols).toContain('id');
      expect(cols).toContain('save_id');
      expect(cols).toContain('name');
      expect(cols).toContain('description');
      expect(cols).toContain('category');
      expect(cols).toContain('quality');
      expect(cols).toContain('stats');
      expect(cols).toContain('effects');
      expect(cols).toContain('value');
      expect(cols).toContain('tags');
      expect(cols).toContain('weight');
      expect(cols).toContain('max_stack');
      expect(cols).toContain('equipped_slot');
      expect(cols).toContain('durability');
      expect(cols).toContain('max_durability');
      expect(cols).toContain('taken');
      expect(cols).toContain('custom_data');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });
  });

  // ============================================================
  // NPC升级迁移验证（迁移072后）
  // ============================================================
  describe('NPC升级迁移验证（迁移072后）', () => {
    it('npcs表不应有stats列', async () => {
      const cols = await getColumns('npcs');
      expect(cols).not.toContain('stats');
    });

    it('npcs表不应有hidden列（已重命名为visible）', async () => {
      const cols = await getColumns('npcs');
      expect(cols).not.toContain('hidden');
    });

    it('npcs表应有visible列', async () => {
      const cols = await getColumns('npcs');
      expect(cols).toContain('visible');
    });

    it('npcs表应有attr_initialized/inv_initialized/skill_initialized列', async () => {
      const cols = await getColumns('npcs');
      expect(cols).toContain('attr_initialized');
      expect(cols).toContain('inv_initialized');
      expect(cols).toContain('skill_initialized');
    });

    it('npcs表应有attributes/derived_attributes/current_hp/max_hp/current_mp/max_mp列', async () => {
      const cols = await getColumns('npcs');
      expect(cols).toContain('attributes');
      expect(cols).toContain('derived_attributes');
      expect(cols).toContain('current_hp');
      expect(cols).toContain('max_hp');
      expect(cols).toContain('current_mp');
      expect(cols).toContain('max_mp');
    });

    it('inventory表不应有hidden列（已重命名为visible）', async () => {
      const cols = await getColumns('inventory');
      expect(cols).not.toContain('hidden');
    });

    it('inventory表应有visible列', async () => {
      const cols = await getColumns('inventory');
      expect(cols).toContain('visible');
    });

    it('character_skills表不应有hidden列（已重命名为visible）', async () => {
      const cols = await getColumns('character_skills');
      expect(cols).not.toContain('hidden');
    });

    it('character_skills表应有visible列', async () => {
      const cols = await getColumns('character_skills');
      expect(cols).toContain('visible');
    });

    it('character_skills表应有owner_type/owner_id列', async () => {
      const cols = await getColumns('character_skills');
      expect(cols).toContain('owner_type');
      expect(cols).toContain('owner_id');
    });
  });

  // ============================================================
  // Location/Quest visible迁移验证（迁移073后）
  // ============================================================
  describe('Location/Quest visible迁移验证（迁移073后）', () => {
    it('locations表不应有hidden列（已重命名为visible）', async () => {
      const cols = await getColumns('locations');
      expect(cols).not.toContain('hidden');
    });

    it('locations表应有visible列', async () => {
      const cols = await getColumns('locations');
      expect(cols).toContain('visible');
    });

    it('quests表不应有hidden列（已重命名为visible）', async () => {
      const cols = await getColumns('quests');
      expect(cols).not.toContain('hidden');
    });

    it('quests表应有visible列', async () => {
      const cols = await getColumns('quests');
      expect(cols).toContain('visible');
    });
  });

  // ============================================================
  // Quest升级迁移验证（迁移074后）
  // ============================================================
  describe('Quest升级迁移验证（迁移074后）', () => {
    it('quests表不应有template_quest_id列', async () => {
      const cols = await getColumns('quests');
      expect(cols).not.toContain('template_quest_id');
    });

    it('quests表应有prerequisite_quest_ids列', async () => {
      const cols = await getColumns('quests');
      expect(cols).toContain('prerequisite_quest_ids');
    });

    it('quests表应有conditions列', async () => {
      const cols = await getColumns('quests');
      expect(cols).toContain('conditions');
    });

    it('quests表应有giver_location_id列', async () => {
      const cols = await getColumns('quests');
      expect(cols).toContain('giver_location_id');
    });

    it('quests表应有quest_chain_id列', async () => {
      const cols = await getColumns('quests');
      expect(cols).toContain('quest_chain_id');
    });

    it('quest_objectives表应有event_trigger列', async () => {
      const cols = await getColumns('quest_objectives');
      expect(cols).toContain('event_trigger');
    });
  });

  // ============================================================
  // 索引验证
  // ============================================================
  describe('索引验证', () => {
    it('save_game_time 应有 idx_game_time_save 索引', async () => {
      const indexes = await getIndexes('save_game_time');
      expect(indexes.some(i => i.includes('game_time'))).toBe(true);
    });

    it('locations 应有 save_id 相关索引', async () => {
      const indexes = await getIndexes('locations');
      expect(indexes.some(i => i.includes('save_id') || i.includes('locations_save'))).toBe(true);
    });

    it('item_pool 应有 idx_item_pool_save 索引', async () => {
      const indexes = await getIndexes('item_pool');
      expect(indexes.some(i => i.includes('item_pool_save'))).toBe(true);
    });
  });

  // ============================================================
  // 废弃表验证（迁移基线重置后不应存在）
  // ============================================================
  describe('废弃表验证', () => {
    const deprecatedTables = [
      'settings', 'game_logs', 'plan_cache', 'bindings',
      'items', 'skills', 'template_npcs', 'equipment', 'maps',
      'npc_relations',
    ];

    for (const table of deprecatedTables) {
      it(`表 ${table} 应不存在（已废弃）`, async () => {
        const exists = await tableExists(table);
        expect(exists).toBe(false);
      });
    }
  });

  // ============================================================
  // SHADOW_STATE_TABLES 配置完整性验证（架构规范 §13.1 第 5 条）
  // 验证 init.ts 的 SHADOW_STATE_TABLES 配置与实际 schema 一致：
  // 1. 配置中的所有表必须在 schema 中实际存在
  // 2. 配置中不应包含已废弃的表
  // 3. ReAct 循环内被写入的 save-scoped 表必须注册（防 character_skills 类 BUG 回归）
  // ============================================================
  describe('SHADOW_STATE_TABLES 配置完整性（架构规范 §13.1）', () => {
    // SHADOW_STATE_TABLES 已在文件顶部从 init.ts 导入

    it('SHADOW_STATE_TABLES 应为非空数组', () => {
      expect(Array.isArray(SHADOW_STATE_TABLES)).toBe(true);
      expect(SHADOW_STATE_TABLES.length).toBeGreaterThan(0);
    });

    // 校验 1：配置中的所有表必须在 schema 中实际存在
    for (const config of SHADOW_STATE_TABLES) {
      it(`配置中的表 ${config.table} 应在 schema 中实际存在`, async () => {
        const exists = await tableExists(config.table);
        expect(exists).toBe(true);
      });
    }

    // 校验 2：配置中不应包含已废弃的表
    it('SHADOW_STATE_TABLES 不应包含已废弃的表', () => {
      const deprecatedTables = [
        'settings', 'game_logs', 'plan_cache', 'bindings',
        'items', 'skills', 'template_npcs', 'equipment', 'maps',
        'npc_relations', 'information_boundaries',
      ];
      const configuredTables = SHADOW_STATE_TABLES.map((c) => c.table);
      const deprecatedInConfig = configuredTables.filter((t) => deprecatedTables.includes(t));
      expect(deprecatedInConfig).toEqual([]);
    });

    // 校验 3：ReAct 循环内被写入的关键 save-scoped 表必须注册
    // 这些表的特征：在 game-systems/* 的 ServiceTool 路径中被 update/insert/delete
    // 缺失任何一个都会导致类似 character_skills 的 "not found after update" BUG
    it('ReAct 循环内被写入的关键 save-scoped 表必须注册到 SHADOW_STATE_TABLES', () => {
      const requiredTables = [
        'npcs', 'characters', 'character_skills', 'quests', 'quest_objectives',
        'locations', 'location_connections', 'discovered_locations',
        'inventory', 'item_pool', 'skill_pool',
        'combat_states', 'combat_history',
        'dialogues', 'dialogue_summaries',
        'event_triggers', 'events', 'story_events', 'npc_goals',
        'save_game_time',
        'entity_graph_nodes', 'entity_graph_edges',
        // 006 升级：awareness/relationship 独立表（set_awareness/set_relationship ServiceTool 写入路径）
        'entity_awareness_events', 'entity_awareness_states',
        'entity_relationship_events', 'entity_relationship_states',
        // 2026-07-25 新增：select_challenge_mode/endChallenge 写入 saves.active_challenge_mode
        'saves',
      ];
      const configuredTables = SHADOW_STATE_TABLES.map((c) => c.table);
      const missing = requiredTables.filter(t => !configuredTables.includes(t));
      expect(missing).toEqual([]);
    });

    // 校验 4：每个配置项必须有 scopeField（save_id / template_id / id）
    // id 仅用于 saves 表（主键是 id，不是 save_id）
    it('每个 SHADOW_STATE_TABLES 配置项必须有 scopeField', () => {
      for (const config of SHADOW_STATE_TABLES) {
        expect(config.scopeField).toBeDefined();
        expect(['save_id', 'template_id', 'id']).toContain(config.scopeField);
      }
    });
  });

  // ============================================================
  // UNIQUE 约束实际生效验证（INIT-DATA-REBUILD: 三层防护之 DB 层）
  // 验证 UNIQUE 约束能实际拦截重复插入，而非仅存在于 schema 中
  // ============================================================
  describe('UNIQUE 约束实际生效验证', () => {
    // 辅助：插入 saves 记录以满足外键约束
    async function insertSave(saveId: string): Promise<void> {
      const now = Date.now();
      await db('saves').insert({
        id: saveId,
        name: `test-${saveId}`,
        template_id: 'tpl-test',
        game_mode: 'fantasy',
        created_at: now,
        updated_at: now,
      });
    }

    it('agent_dispatch_log: 相同 (save_id, agent_type, action, task_hash) 应被 UNIQUE 拦截', async () => {
      await insertSave('save-unique-adl');
      const now = Date.now();
      const base = {
        id: 'dispatch-1',
        save_id: 'save-unique-adl',
        agent_type: 'skill',
        action: 'skill_pool_init',
        task_hash: 'abc123hash456',
        status: 'in_progress',
        attempt_count: 1,
        max_attempts: 3,
        task_description: 'init skills',
        manifest_summary: '{}',
        last_dispatched_at: now,
        expires_at: now + 300000,
        created_at: now,
        updated_at: now,
      };
      await db('agent_dispatch_log').insert(base);

      // 插入相同去重键但不同 id 的记录 — 应被 UNIQUE(save_id, agent_type, action, task_hash) 拦截
      await expect(
        db('agent_dispatch_log').insert({ ...base, id: 'dispatch-2' })
      ).rejects.toThrow();
    });

    it('agent_dispatch_log: 不同 task_hash 应允许插入', async () => {
      await insertSave('save-unique-adl2');
      const now = Date.now();
      const base = {
        save_id: 'save-unique-adl2',
        agent_type: 'skill',
        action: 'skill_pool_init',
        status: 'in_progress',
        attempt_count: 1,
        max_attempts: 3,
        task_description: 'init skills',
        manifest_summary: '{}',
        last_dispatched_at: now,
        expires_at: now + 300000,
        created_at: now,
        updated_at: now,
      };
      await db('agent_dispatch_log').insert({ ...base, id: 'd1', task_hash: 'hash-a' });
      // 不同 task_hash 不冲突
      await db('agent_dispatch_log').insert({ ...base, id: 'd2', task_hash: 'hash-b' });
      const rows = await db('agent_dispatch_log').where('save_id', 'save-unique-adl2');
      expect(rows).toHaveLength(2);
    });

    it('item_pool: 相同 (save_id, name) 应被 UNIQUE 拦截', async () => {
      await insertSave('save-unique-ip');
      const now = Date.now();
      const base = {
        save_id: 'save-unique-ip',
        id: 'item-1',
        name: '长剑',
        created_at: now,
        updated_at: now,
      };
      await db('item_pool').insert(base);

      await expect(
        db('item_pool').insert({ ...base, id: 'item-2' })
      ).rejects.toThrow();
    });

    it('skill_pool: 相同 (save_id, name) 应被 UNIQUE 拦截', async () => {
      await insertSave('save-unique-sp');
      const now = Date.now();
      const base = {
        save_id: 'save-unique-sp',
        id: 'skill-1',
        name: '火球术',
        created_at: now,
        updated_at: now,
      };
      await db('skill_pool').insert(base);

      await expect(
        db('skill_pool').insert({ ...base, id: 'skill-2' })
      ).rejects.toThrow();
    });

    it('characters: 相同 save_id 第二个角色应被 UNIQUE(save_id) 拦截', async () => {
      await insertSave('save-unique-char');
      const now = Date.now();
      const base = {
        save_id: 'save-unique-char',
        id: 'char-1',
        name: '主角',
        race: 'human',
        class: 'warrior',
        background: 'none',
        attributes: '{}',
        created_at: now,
        updated_at: now,
      };
      await db('characters').insert(base);

      // 同一 save_id 插入第二个角色应被 UNIQUE(save_id) 拦截
      await expect(
        db('characters').insert({ ...base, id: 'char-2' })
      ).rejects.toThrow();
    });

    it('location_connections: 相同 (save_id, from_location_id, to_location_id) 应被 UNIQUE 拦截', async () => {
      await insertSave('save-unique-lc');
      const now = Date.now();
      // 先插入 locations（满足外键，locations 是单列 PK）
      await db('locations').insert({
        id: 'loc-from',
        save_id: 'save-unique-lc',
        name: '村庄',
        created_at: now,
        updated_at: now,
      });
      await db('locations').insert({
        id: 'loc-to',
        save_id: 'save-unique-lc',
        name: '森林',
        created_at: now,
        updated_at: now,
      });
      await db('location_connections').insert({
        id: 'conn-1',
        save_id: 'save-unique-lc',
        from_location_id: 'loc-from',
        to_location_id: 'loc-to',
        created_at: now,
        updated_at: now,
      });

      await expect(
        db('location_connections').insert({
          id: 'conn-2', save_id: 'save-unique-lc',
          from_location_id: 'loc-from', to_location_id: 'loc-to',
          created_at: now, updated_at: now,
        })
      ).rejects.toThrow();
    });

    it('entity_graph_nodes: 相同 (save_id, entity_type, entity_id) 应被 UNIQUE 拦截', async () => {
      await insertSave('save-unique-egn');
      const now = Date.now();
      await db('entity_graph_nodes').insert({
        id: 'node-1',
        save_id: 'save-unique-egn',
        entity_type: 'character',
        entity_id: 'char-1',
        label: '主角',
        created_at: now,
        updated_at: now,
      });

      await expect(
        db('entity_graph_nodes').insert({
          id: 'node-2', save_id: 'save-unique-egn',
          entity_type: 'character', entity_id: 'char-1',
          label: '主角副本', created_at: now, updated_at: now,
        })
      ).rejects.toThrow();
    });
    // 模块3：information_boundaries 表已删除（004_drop_information_boundaries.ts），UNIQUE 测试同步删除
  });

  // ============================================================
  // 006 升级：awareness/relationship 独立表 schema 验证
  // 设计文档 §7 测试用例大纲：
  //   - 4 张新表存在性校验
  //   - 字段完整性校验
  //   - UNIQUE 约束校验（states 表的 save_id+observer+target）
  //   - 外键约束校验
  //   - SHADOW_STATE_TABLES 配置完整性：新增 4 张表注册
  // ============================================================
  describe('006 升级：awareness/relationship 独立表 schema', () => {
    // 辅助：插入 saves 记录以满足外键约束
    async function insertSave(saveId: string): Promise<void> {
      const now = Date.now();
      await db('saves').insert({
        id: saveId,
        name: `test-${saveId}`,
        template_id: 'tpl-test',
        game_mode: 'fantasy',
        created_at: now,
        updated_at: now,
      });
    }

    describe('表存在性', () => {
      const newTables = [
        'entity_awareness_events',
        'entity_awareness_states',
        'entity_relationship_events',
        'entity_relationship_states',
      ];
      for (const table of newTables) {
        it(`006 表 ${table} 应存在`, async () => {
          const exists = await tableExists(table);
          expect(exists).toBe(true);
        });
      }
    });

    describe('字段完整性', () => {
      it('entity_awareness_events 应包含全部必需字段', async () => {
        const cols = await getColumns('entity_awareness_events');
        const expected = [
          'id', 'save_id', 'observer_node_id', 'target_node_id',
          'score_delta', 'awareness_note', 'source',
          'merged_count', 'created_at',
        ];
        for (const field of expected) {
          expect(cols).toContain(field);
        }
      });

      it('entity_awareness_states 应包含全部必需字段', async () => {
        const cols = await getColumns('entity_awareness_states');
        const expected = [
          'id', 'save_id', 'observer_node_id', 'target_node_id',
          'current_score', 'effective_note', 'effective_source',
          'effective_event_id', 'last_updated',
        ];
        for (const field of expected) {
          expect(cols).toContain(field);
        }
      });

      it('entity_relationship_events 应包含全部必需字段（含 relationship_note 非 awareness_note）', async () => {
        const cols = await getColumns('entity_relationship_events');
        const expected = [
          'id', 'save_id', 'observer_node_id', 'target_node_id',
          'score_delta', 'relationship_note', 'source',
          'merged_count', 'created_at',
        ];
        for (const field of expected) {
          expect(cols).toContain(field);
        }
        // relationship 表使用 relationship_note，不使用 awareness_note
        expect(cols).not.toContain('awareness_note');
      });

      it('entity_relationship_states 应包含全部必需字段', async () => {
        const cols = await getColumns('entity_relationship_states');
        const expected = [
          'id', 'save_id', 'observer_node_id', 'target_node_id',
          'current_score', 'effective_note', 'effective_source',
          'effective_event_id', 'last_updated',
        ];
        for (const field of expected) {
          expect(cols).toContain(field);
        }
      });
    });

    describe('UNIQUE 约束（states 表 save_id+observer+target）', () => {
      it('entity_awareness_states: 相同 (save_id, observer_node_id, target_node_id) 应被 UNIQUE 拦截', async () => {
        await insertSave('save-uniq-aes');
        const now = Date.now();
        const base = {
          id: 'ast-1',
          save_id: 'save-uniq-aes',
          observer_node_id: 'egn_npc_save-1_npc-tom',
          target_node_id: 'egn_character_save-1_player-1',
          current_score: 5,
          effective_source: '{}',
          effective_event_id: 'aev-1',
          last_updated: now,
        };
        await db('entity_awareness_states').insert(base);

        // 插入相同 (save_id, observer, target) 但不同 id 的记录应被 UNIQUE 拦截
        await expect(
          db('entity_awareness_states').insert({ ...base, id: 'ast-2' })
        ).rejects.toThrow();
      });

      it('entity_awareness_states: 不同 (observer, target) 应允许插入', async () => {
        await insertSave('save-uniq-aes2');
        const now = Date.now();
        const base = {
          save_id: 'save-uniq-aes2',
          current_score: 5,
          effective_source: '{}',
          effective_event_id: 'aev-1',
          last_updated: now,
        };
        // 使用独立 id 避免与上一个测试用例（id='ast-1'/'ast-2'）的 PRIMARY KEY 冲突
        await db('entity_awareness_states').insert({
          ...base, id: 'ast-allow-1',
          observer_node_id: 'egn_npc_1', target_node_id: 'egn_char_1',
        });
        // 不同 observer 或 target 不冲突
        await db('entity_awareness_states').insert({
          ...base, id: 'ast-allow-2',
          observer_node_id: 'egn_npc_2', target_node_id: 'egn_char_1',
        });
        const rows = await db('entity_awareness_states').where('save_id', 'save-uniq-aes2');
        expect(rows).toHaveLength(2);
      });

      it('entity_relationship_states: 相同 (save_id, observer_node_id, target_node_id) 应被 UNIQUE 拦截', async () => {
        await insertSave('save-uniq-rs');
        const now = Date.now();
        const base = {
          id: 'rst-1',
          save_id: 'save-uniq-rs',
          observer_node_id: 'egn_npc_save-1_npc-tom',
          target_node_id: 'egn_character_save-1_player-1',
          current_score: 3,
          effective_source: '{}',
          effective_event_id: 'rev-1',
          last_updated: now,
        };
        await db('entity_relationship_states').insert(base);

        await expect(
          db('entity_relationship_states').insert({ ...base, id: 'rst-2' })
        ).rejects.toThrow();
      });
    });

    describe('外键约束', () => {
      it('entity_awareness_events: save_id 不存在应被外键拦截', async () => {
        const now = Date.now();
        await expect(
          db('entity_awareness_events').insert({
            id: 'aev-fk-1',
            save_id: 'save-nonexistent',
            observer_node_id: 'egn_npc_1',
            target_node_id: 'egn_char_1',
            score_delta: 1,
            source: '{}',
            merged_count: 1,
            created_at: now,
          })
        ).rejects.toThrow();
      });

      it('entity_awareness_states: save_id 不存在应被外键拦截', async () => {
        const now = Date.now();
        await expect(
          db('entity_awareness_states').insert({
            id: 'ast-fk-1',
            save_id: 'save-nonexistent',
            observer_node_id: 'egn_npc_1',
            target_node_id: 'egn_char_1',
            current_score: 5,
            effective_source: '{}',
            effective_event_id: 'aev-1',
            last_updated: now,
          })
        ).rejects.toThrow();
      });

      it('entity_relationship_events: save_id 不存在应被外键拦截', async () => {
        const now = Date.now();
        await expect(
          db('entity_relationship_events').insert({
            id: 'rev-fk-1',
            save_id: 'save-nonexistent',
            observer_node_id: 'egn_npc_1',
            target_node_id: 'egn_char_1',
            score_delta: 1,
            source: '{}',
            merged_count: 1,
            created_at: now,
          })
        ).rejects.toThrow();
      });

      it('entity_relationship_states: save_id 不存在应被外键拦截', async () => {
        const now = Date.now();
        await expect(
          db('entity_relationship_states').insert({
            id: 'rst-fk-1',
            save_id: 'save-nonexistent',
            observer_node_id: 'egn_npc_1',
            target_node_id: 'egn_char_1',
            current_score: 3,
            effective_source: '{}',
            effective_event_id: 'rev-1',
            last_updated: now,
          })
        ).rejects.toThrow();
      });
    });

    describe('SHADOW_STATE_TABLES 配置完整性', () => {
      // SHADOW_STATE_TABLES 已在文件顶部从 init.ts 导入
      it('SHADOW_STATE_TABLES 应包含 4 张新表（save_id scope）', () => {
        const configured = SHADOW_STATE_TABLES.map((c) => c.table);
        expect(configured).toContain('entity_awareness_events');
        expect(configured).toContain('entity_awareness_states');
        expect(configured).toContain('entity_relationship_events');
        expect(configured).toContain('entity_relationship_states');
      });

      it('4 张新表 scopeField 应为 save_id', () => {
        const newTables = [
          'entity_awareness_events',
          'entity_awareness_states',
          'entity_relationship_events',
          'entity_relationship_states',
        ];
        for (const table of newTables) {
          const config = SHADOW_STATE_TABLES.find((c) => c.table === table);
          expect(config).toBeDefined();
          expect(config!.scopeField).toBe('save_id');
        }
      });
    });
  });

  // ============================================================
  // 007 升级：combat_states.mode 列（挑战模式分离）
  // 设计文档: docs/design/fractal-design-20260723-game-combat-mode-separation/code-design-20260723-game-combat-mode-separation.md §9.1
  // - combat_states 表新增 mode 列，存储 ChallengeMode 值
  // - 默认值 'turn_based_combat'（兼容存量战斗记录）
  // - 路由层 ModeRouter 通过此列判定是否在挑战中
  // ============================================================
  describe('007 升级：combat_states.mode 列', () => {
    it('combat_states 应有 mode 列', async () => {
      const cols = await getColumns('combat_states');
      expect(cols).toContain('mode');
    });

    it('combat_states.mode 默认值应为 turn_based_combat', async () => {
      // PRAGMA table_info 返回 dflt_value 字段表示默认值
      const rows = await db.raw(`PRAGMA table_info(combat_states)`);
      const modeCol = rows.find((r: { name: string }) => r.name === 'mode');
      expect(modeCol).toBeDefined();
      expect(modeCol.dflt_value).toBe("'turn_based_combat'");
    });

    it('combat_states.mode 应为 NOT NULL', async () => {
      const rows = await db.raw(`PRAGMA table_info(combat_states)`);
      const modeCol = rows.find((r: { name: string }) => r.name === 'mode');
      expect(modeCol).toBeDefined();
      // notnull=1 表示 NOT NULL
      expect(modeCol.notnull).toBe(1);
    });
  });

  // ============================================================
  // 008 升级：saves.active_challenge_mode 列（DF-007 修复）
  // 设计文档: docs/design/fractal-design-20260723-game-combat-mode-separation/code-design-20260723-game-combat-mode-separation.md §9.2
  // - saves 表新增 active_challenge_mode 列
  // - 用于跨请求持久化玩家选择的挑战模式
  // - nullable + defaultTo null：未进入挑战时为 null
  // ============================================================
  describe('008 升级：saves.active_challenge_mode 列', () => {
    it('saves 应有 active_challenge_mode 列', async () => {
      const cols = await getColumns('saves');
      expect(cols).toContain('active_challenge_mode');
    });

    it('saves.active_challenge_mode 应为 nullable', async () => {
      const rows = await db.raw(`PRAGMA table_info(saves)`);
      const modeCol = rows.find((r: { name: string }) => r.name === 'active_challenge_mode');
      expect(modeCol).toBeDefined();
      // notnull=0 表示 nullable
      expect(modeCol.notnull).toBe(0);
    });

    it('saves.active_challenge_mode 默认值应为 NULL', async () => {
      const rows = await db.raw(`PRAGMA table_info(saves)`);
      const modeCol = rows.find((r: { name: string }) => r.name === 'active_challenge_mode');
      expect(modeCol).toBeDefined();
      expect(modeCol.dflt_value).toBeNull();
    });
  });

  // ============================================================
  // 009 升级：model_providers.version + api_keys rateLimit + llm_dispatch_metrics 表
  // 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/solution-design-20260726-llm-request-dispatcher-L2L3-细化设计.md §9.1
  // - model_providers 新增 version 列（provider_config_changed 事件契约版本号）
  // - api_keys JSON 回填 rateLimit 默认配置（capacity=5, refillRatePerSec=1, maxConcurrent=3）
  // - 新增 llm_dispatch_metrics 表（v2.4 分表：M9 dispatcher 调度度量，非 save-scoped）
  // ============================================================
  describe('009 升级：model_providers.version + llm_dispatch_metrics 表', () => {
    it('model_providers 应有 version 列', async () => {
      const cols = await getColumns('model_providers');
      expect(cols).toContain('version');
    });

    it('model_providers.version 应为 NOT NULL 且默认 0', async () => {
      const rows = await db.raw(`PRAGMA table_info(model_providers)`);
      const versionCol = rows.find((r: { name: string }) => r.name === 'version');
      expect(versionCol).toBeDefined();
      // notnull=1 表示 NOT NULL
      expect(versionCol.notnull).toBe(1);
      // SQLite dflt_value 可能带引号（knex 渲染为 default '0'），剥离引号后比较
      expect(String(versionCol.dflt_value).replace(/'/g, '')).toBe('0');
    });

    it('llm_dispatch_metrics 表应存在', async () => {
      expect(await tableExists('llm_dispatch_metrics')).toBe(true);
    });

    it('llm_dispatch_metrics 列应完整', async () => {
      const cols = await getColumns('llm_dispatch_metrics');
      const expectedColumns = [
        'id', 'provider_id', 'agent_key', 'save_id', 'key_index',
        'success', 'error_type', 'duration_ms', 'attempt_count',
        'wait_ms', 'cooldown_triggered', 'created_at',
      ];
      for (const col of expectedColumns) {
        expect(cols).toContain(col);
      }
    });

    it('llm_dispatch_metrics.save_id 应为 nullable（非 save-scoped 表）', async () => {
      const rows = await db.raw(`PRAGMA table_info(llm_dispatch_metrics)`);
      const saveIdCol = rows.find((r: { name: string }) => r.name === 'save_id');
      expect(saveIdCol).toBeDefined();
      // notnull=0 表示 nullable
      expect(saveIdCol.notnull).toBe(0);
    });

    it('llm_dispatch_metrics 应有三个索引', async () => {
      const indexes = await getIndexes('llm_dispatch_metrics');
      expect(indexes).toContain('idx_llm_dispatch_metrics_provider_time');
      expect(indexes).toContain('idx_llm_dispatch_metrics_save_id');
      expect(indexes).toContain('idx_llm_dispatch_metrics_agent_time');
    });

    it('llm_dispatch_metrics 非 save-scoped，不应注册到 SHADOW_STATE_TABLES（§13.1 第 5 条）', () => {
      const configuredTables = SHADOW_STATE_TABLES.map((c) => c.table);
      expect(configuredTables).not.toContain('llm_dispatch_metrics');
    });

    it('009 迁移幂等：重复执行应安全，且为缺失 key 回填 rateLimit', async () => {
      // 插入一条无 rateLimit 的 provider（模拟 009 之前的历史数据）
      await db('model_providers').insert({
        id: 'test-provider-009',
        provider_type: 'openai',
        name: 'Test009',
        base_url: 'https://example.com/v1',
        api_format: 'openai',
        api_keys: JSON.stringify([{ key: 'sk-test-009', label: 'k0', priority: 0 }]),
        default_model: 'gpt-4o',
        enabled: 1,
        extra_config: null,
        max_tokens: 8192,
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      // 重复执行 009 up（beforeAll 已执行过一次）：应幂等不报错，且回填 rateLimit
      const migration = await import('../009_add_rate_limit_to_api_keys.js');
      await migration.up(db);

      const row = await db('model_providers').where({ id: 'test-provider-009' }).first();
      const keys = JSON.parse(row.api_keys) as Array<{ rateLimit?: { capacity: number; refillRatePerSec: number; maxConcurrent: number } }>;
      expect(keys[0].rateLimit).toEqual({ capacity: 5, refillRatePerSec: 1, maxConcurrent: 3 });

      // 清理，避免影响其他测试
      await db('model_providers').where({ id: 'test-provider-009' }).delete();
    });
  });
});
