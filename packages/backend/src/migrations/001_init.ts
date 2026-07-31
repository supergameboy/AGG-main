import { Knex } from 'knex';

/**
 * 初始化迁移：创建全部 50 个保留表的最终 schema。
 * 替代原 001-084 迁移的累积效果，直接创建最终结构。
 *
 * 设计文档: docs/design/fractal-design-20260710-migration-baseline-reset.md
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('PRAGMA foreign_keys = OFF');

  // ═══════════════════════════════════════════════════════════
  // 1. 基础表（无外键依赖）
  // ═══════════════════════════════════════════════════════════

  await knex.schema.createTable('schema_version', (table) => {
    table.integer('version').primary();
    table.integer('applied_at').notNullable();
    table.text('description');
  });

  await knex.schema.createTable('saves', (table) => {
    table.text('id').primary();
    table.text('name').notNullable();
    table.text('type').defaultTo('manual');
    table.text('template_id').notNullable();
    table.text('game_mode').notNullable();
    table.text('chapter').defaultTo('');
    table.text('location').defaultTo('');
    table.integer('level').defaultTo(1);
    table.text('main_quest').defaultTo('');
    table.integer('play_time').defaultTo(0);
    table.text('thumbnail').defaultTo('');
    table.integer('last_played_at').nullable();
    table.text('current_snapshot_id').nullable();
    table.integer('snapshot_count').defaultTo(0);
    table.text('language').defaultTo('zh-CN');
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
  });

  await knex.schema.createTable('templates', (table) => {
    table.text('id').primary();
    table.text('raw_content').notNullable();
    table.text('source').defaultTo('yaml');
    table.integer('is_builtin').defaultTo(0);
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
  });

  await knex.schema.createTable('prompts', (table) => {
    table.text('id').primary();
    table.text('agent_type').notNullable();
    table.text('prompt_type').notNullable();
    table.text('name').notNullable();
    table.text('content').notNullable();
    table.text('variables').defaultTo('[]');
    table.text('version').defaultTo('1.0.0');
    table.integer('is_active').defaultTo(1);
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
    table.unique(['agent_type', 'prompt_type', 'name']);
  });

  await knex.schema.createTable('model_providers', (table) => {
    table.text('id').primary();
    table.text('provider_type').notNullable();
    table.text('name').notNullable();
    table.text('base_url').notNullable();
    table.text('api_format').notNullable().defaultTo('openai');
    table.text('api_keys').notNullable();
    table.text('default_model').notNullable();
    table.integer('enabled').defaultTo(1);
    table.text('extra_config');
    table.integer('max_tokens').defaultTo(8192);
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
  });

  await knex.schema.createTable('events', (table) => {
    table.text('id').primary();
    table.text('template_id');
    table.text('name').notNullable();
    table.text('description').defaultTo('');
    table.text('type').notNullable();
    table.text('trigger_type').notNullable();
    table.text('trigger_data').defaultTo('{}');
    table.text('effects').defaultTo('[]');
    table.integer('priority').defaultTo(0);
    table.integer('repeatable').defaultTo(0);
    table.integer('cooldown').defaultTo(0);
    table.text('custom_data').defaultTo('{}');
  });

  await knex.schema.createTable('agent_profiles', (table) => {
    table.text('id').primary();
    table.text('name').notNullable().unique();
    table.text('description').defaultTo('');
    table.text('game_mode').notNullable();
    table.text('agents').defaultTo('{}');
    table.text('coordinator').defaultTo('{}');
    table.text('permissions').defaultTo('{}');
    table.text('tools').defaultTo('[]');
    table.integer('is_builtin').defaultTo(0);
    table.text('source').defaultTo('database');
    table.bigInteger('created_at').notNullable();
    table.bigInteger('updated_at').notNullable();
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ap_game_mode ON agent_profiles(game_mode)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ap_name ON agent_profiles(name)');

  await knex.schema.createTable('frontend_logs', (table) => {
    table.increments('id').primary();
    table.text('level').notNullable();
    table.text('category').notNullable();
    table.text('source').notNullable();
    table.text('message').notNullable();
    table.text('data').nullable();
    table.text('stack_trace').nullable();
    table.text('session_id').nullable();
    table.integer('timestamp').notNullable();
    table.integer('created_at').notNullable();
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_frontend_logs_level ON frontend_logs(level)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_frontend_logs_category ON frontend_logs(category)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_frontend_logs_timestamp ON frontend_logs(timestamp)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_frontend_logs_session ON frontend_logs(session_id)');

  await knex.schema.createTable('dev_snapshots', (table) => {
    table.string('id').primary();
    table.string('type').notNullable();
    table.text('data').notNullable();
    table.text('store_names').nullable();
    table.string('session_id').nullable();
    table.integer('timestamp').notNullable();
    table.integer('created_at').notNullable();
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dev_snapshots_type ON dev_snapshots(type)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dev_snapshots_timestamp ON dev_snapshots(timestamp)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dev_snapshots_session ON dev_snapshots(session_id)');

  await knex.schema.createTable('dev_consistency_reports', (table) => {
    table.increments('id').primary();
    table.integer('check_time').notNullable();
    table.integer('total_checks').notNullable();
    table.integer('mismatch_count').notNullable();
    table.text('details').notNullable();
    table.string('session_id').nullable();
    table.integer('created_at').notNullable();
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dev_consistency_reports_check_time ON dev_consistency_reports(check_time)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dev_consistency_reports_mismatch ON dev_consistency_reports(mismatch_count)');

  // ═══════════════════════════════════════════════════════════
  // 2. 依赖 saves 的表
  // ═══════════════════════════════════════════════════════════

  await knex.schema.createTable('save_snapshots', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('chapter');
    table.text('snapshot_data').notNullable();
    table.text('name').nullable();
    table.text('type').defaultTo('auto');
    table.text('game_mode').nullable();
    table.text('location').nullable();
    table.integer('level').nullable();
    table.text('main_quest').nullable();
    table.integer('play_time').nullable();
    table.text('thumbnail').nullable();
    table.text('description').nullable();
    table.integer('created_at').notNullable();
  });

  await knex.raw(`
    CREATE TABLE save_game_state (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      data_type TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data_value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id),
      UNIQUE(save_id, data_type, data_key)
    )
  `);

  await knex.schema.createTable('save_data_indexes', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('index_type').notNullable();
    table.text('index_key').notNullable();
    table.text('index_value').notNullable();
    table.integer('updated_at').notNullable();
    table.unique(['save_id', 'index_type', 'index_key']);
  });

  await knex.schema.createTable('save_write_logs', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('tool_type').notNullable();
    table.text('method').notNullable();
    table.text('params').notNullable();
    table.text('result');
    table.integer('timestamp').notNullable();
  });

  await knex.raw(`
    CREATE TABLE save_game_time (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      total_minutes INTEGER NOT NULL DEFAULT 0,
      day_number INTEGER NOT NULL DEFAULT 1,
      last_action TEXT DEFAULT '',
      last_action_at INTEGER NOT NULL,
      custom_data TEXT DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id),
      UNIQUE(save_id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_game_time_save ON save_game_time(save_id)');

  // ═══════════════════════════════════════════════════════════
  // 3. characters（复合 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE characters (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      current_location_id TEXT DEFAULT 'village-square',
      name TEXT NOT NULL,
      race TEXT NOT NULL,
      class TEXT NOT NULL,
      gender TEXT DEFAULT 'male',
      custom_gender TEXT,
      background TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      experience INTEGER DEFAULT 0,
      attributes TEXT NOT NULL,
      derived_attributes TEXT DEFAULT '{}',
      current_hp INTEGER DEFAULT 100,
      max_hp INTEGER DEFAULT 100,
      current_mp INTEGER DEFAULT 50,
      max_mp INTEGER DEFAULT 50,
      base_max_hp INTEGER,
      base_max_mp INTEGER,
      currency TEXT DEFAULT '{}',
      status TEXT DEFAULT '{}',
      custom_data TEXT DEFAULT '{}',
      age_group TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id),
      UNIQUE(save_id)
    )
  `);

  // ═══════════════════════════════════════════════════════════
  // 4. inventory + item_pool（复合 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE inventory (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      pool_id TEXT DEFAULT '',
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'misc',
      equipped INTEGER DEFAULT 0,
      quality TEXT DEFAULT 'common',
      durability INTEGER DEFAULT 100,
      max_durability INTEGER DEFAULT 100,
      equipped_slot TEXT,
      equipped_index INTEGER,
      weight INTEGER DEFAULT 1,
      max_stack INTEGER DEFAULT 99,
      quantity INTEGER DEFAULT 1,
      inventory_slot INTEGER,
      visible INTEGER DEFAULT 1,
      owner_type TEXT NOT NULL DEFAULT 'character',
      owner_id TEXT NOT NULL DEFAULT '',
      stats TEXT DEFAULT '{}',
      effects TEXT DEFAULT '[]',
      value TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      custom_data TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_save ON inventory(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory(save_id, owner_id, owner_type)');

  await knex.raw(`
    CREATE TABLE item_pool (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'misc',
      quality TEXT DEFAULT 'common',
      stats TEXT DEFAULT '{}',
      effects TEXT DEFAULT '[]',
      value TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      weight INTEGER DEFAULT 1,
      max_stack INTEGER DEFAULT 99,
      equipped_slot TEXT,
      durability INTEGER DEFAULT 100,
      max_durability INTEGER DEFAULT 100,
      taken INTEGER DEFAULT 0,
      custom_data TEXT DEFAULT '{}',
      recommended_classes TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_item_pool_save ON item_pool(save_id)');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_item_pool_name ON item_pool(save_id, name)');

  // ═══════════════════════════════════════════════════════════
  // 5. character_skills + skill_pool（复合 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE character_skills (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      category TEXT DEFAULT 'attack',
      effects TEXT DEFAULT '{}',
      element TEXT DEFAULT 'physical',
      experience INTEGER DEFAULT 0,
      cost TEXT DEFAULT '[]',
      max_level INTEGER DEFAULT 10,
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      level INTEGER DEFAULT 1,
      cooldown_remaining INTEGER DEFAULT 0,
      unlocked INTEGER DEFAULT 1,
      visible INTEGER DEFAULT 1,
      custom_data TEXT DEFAULT '{}',
      pool_id TEXT DEFAULT '',
      owner_id TEXT NOT NULL DEFAULT '',
      owner_type TEXT NOT NULL DEFAULT 'character',
      consecutive_uses INTEGER DEFAULT 0,
      last_used_at INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id),
      UNIQUE(save_id, owner_id, owner_type, skill_id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_character_skills_save ON character_skills(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_cs_owner ON character_skills(save_id, owner_id, owner_type)');

  await knex.raw(`
    CREATE TABLE skill_pool (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'attack',
      element TEXT DEFAULT 'physical',
      cost TEXT DEFAULT '[]',
      damage TEXT DEFAULT '{}',
      effects TEXT DEFAULT '[]',
      cooldown INTEGER DEFAULT 0,
      max_level INTEGER DEFAULT 10,
      target_type TEXT DEFAULT 'single',
      range INTEGER DEFAULT 1,
      learned INTEGER DEFAULT 0,
      custom_data TEXT DEFAULT '{}',
      recommended_classes TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_skill_pool_save ON skill_pool(save_id)');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_pool_name ON skill_pool(save_id, name)');

  // ═══════════════════════════════════════════════════════════
  // 6. npcs + npc_relations + npc_goals（复合 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE npcs (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      template_npc_id TEXT,
      name TEXT NOT NULL,
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      role TEXT DEFAULT '',
      race TEXT DEFAULT '',
      location_id TEXT,
      level INTEGER DEFAULT 1,
      services TEXT DEFAULT '[]',
      dialogue_history TEXT DEFAULT '[]',
      custom_data TEXT DEFAULT '{}',
      in_party INTEGER DEFAULT 0,
      joined_party_at INTEGER,
      reputation INTEGER DEFAULT 0,
      mood INTEGER DEFAULT 50,
      visible INTEGER DEFAULT 0 NOT NULL,
      currency TEXT DEFAULT '{}',
      attr_initialized INTEGER DEFAULT 0,
      inv_initialized INTEGER DEFAULT 0,
      skill_initialized INTEGER DEFAULT 0,
      attributes TEXT DEFAULT '{}',
      derived_attributes TEXT DEFAULT '{}',
      current_hp INTEGER,
      max_hp INTEGER,
      current_mp INTEGER,
      max_mp INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_npcs_save ON npcs(save_id)');

  await knex.raw(`
    CREATE TABLE npc_relations (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      npc_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_value INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id),
      UNIQUE(save_id, npc_id, target_type, target_id),
      FOREIGN KEY (save_id, npc_id) REFERENCES npcs(save_id, id) ON DELETE CASCADE
    )
  `);

  await knex.raw(`
    CREATE TABLE npc_goals (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      npc_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('long_term', 'mid_term')),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'abandoned', 'blocked', 'archived')),
      related_entity_ids TEXT NOT NULL DEFAULT '[]',
      progress TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (save_id, npc_id) REFERENCES npcs(save_id, id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ng_save ON npc_goals(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ng_npc ON npc_goals(save_id, npc_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ng_status ON npc_goals(save_id, npc_id, status)');

  // ═══════════════════════════════════════════════════════════
  // 7. locations + location_connections + discovered_locations（单列 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE locations (
      id TEXT NOT NULL,
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      location_level INTEGER DEFAULT 1,
      parent_location_id TEXT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'poi',
      terrain_type TEXT,
      x REAL,
      y REAL,
      danger_level INTEGER DEFAULT 1,
      is_explored INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 0,
      events TEXT DEFAULT '[]',
      custom_data TEXT DEFAULT '{}',
      created_at INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (id),
      CHECK (id IS NOT NULL AND length(id) > 0)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_locations_save_id ON locations(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_location_id)');

  await knex.raw(`
    CREATE TABLE location_connections (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      from_location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      to_location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      connection_type TEXT DEFAULT 'normal',
      distance INTEGER DEFAULT 1,
      custom_data TEXT DEFAULT '{}',
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(save_id, from_location_id, to_location_id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_lc_from ON location_connections(from_location_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_lc_to ON location_connections(to_location_id)');

  await knex.raw(`
    CREATE TABLE discovered_locations (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      discovered_at TEXT NOT NULL,
      UNIQUE(save_id, location_id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dl_save ON discovered_locations(save_id)');

  // ═══════════════════════════════════════════════════════════
  // 8. quests + quest_objectives（单列 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE quests (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'side',
      status TEXT DEFAULT 'available',
      visible INTEGER DEFAULT 0,
      giver_npc_id TEXT,
      prerequisite_quest_ids TEXT DEFAULT '[]',
      conditions TEXT DEFAULT '{}',
      giver_location_id TEXT,
      quest_chain_id TEXT,
      rewards TEXT DEFAULT '[]',
      time_limit INTEGER DEFAULT 0,
      custom_data TEXT DEFAULT '{}',
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_quests_save_id ON quests(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(save_id, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_quests_chain ON quests(save_id, quest_chain_id)');

  await knex.raw(`
    CREATE TABLE quest_objectives (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'kill',
      target TEXT DEFAULT '',
      required INTEGER DEFAULT 1,
      current INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      event_trigger TEXT,
      FOREIGN KEY (quest_id) REFERENCES quests(id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_quest_objectives_quest ON quest_objectives(save_id, quest_id)');

  // ═══════════════════════════════════════════════════════════
  // 9. dialogues + story_events（复合 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE dialogues (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      npc_id TEXT,
      speaker TEXT NOT NULL,
      content TEXT NOT NULL,
      emotion TEXT DEFAULT 'neutral',
      message_type TEXT NOT NULL DEFAULT 'npc',
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (save_id, id),
      FOREIGN KEY (save_id, npc_id) REFERENCES npcs(save_id, id) ON DELETE SET NULL
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dialogues_type ON dialogues(save_id, message_type)');

  await knex.raw(`
    CREATE TABLE story_events (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      chapter TEXT DEFAULT '',
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      importance TEXT NOT NULL DEFAULT 'minor',
      participants TEXT DEFAULT '[]',
      impact TEXT DEFAULT '{}',
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);

  // ═══════════════════════════════════════════════════════════
  // 10. event_triggers（复合 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE event_triggers (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      triggered_at INTEGER NOT NULL,
      resolved_at INTEGER,
      status TEXT DEFAULT 'pending',
      result_data TEXT DEFAULT '{}',
      PRIMARY KEY (save_id, id)
    )
  `);

  // ═══════════════════════════════════════════════════════════
  // 11. Agent 系统表
  // ═══════════════════════════════════════════════════════════

  await knex.schema.createTable('agent_contexts', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('agent_type').notNullable();
    table.text('messages').defaultTo('[]');
    table.text('state').defaultTo('{}');
    table.integer('updated_at').notNullable();
    table.unique(['save_id', 'agent_type']);
  });

  await knex.schema.createTable('agent_schedules', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('coordinator_id');
    table.text('agent_type').notNullable();
    table.text('action').nullable();
    table.text('input').defaultTo('{}');
    table.text('output').defaultTo('{}');
    table.integer('duration_ms');
    table.integer('success').defaultTo(1);
    table.integer('timestamp').notNullable();
    table.text('status').defaultTo('pending');
    table.integer('start_time');
    table.integer('end_time');
    table.integer('created_at');
    table.text('error');
    table.text('parentScheduleId');
  });

  await knex.schema.createTable('agent_llm_calls', (table) => {
    table.text('id').primary();
    table.text('save_id').references('id').inTable('saves').onDelete('CASCADE');
    table.text('agent_type').notNullable();
    table.text('model').notNullable();
    table.integer('prompt_tokens').defaultTo(0);
    table.integer('completion_tokens').defaultTo(0);
    table.integer('total_tokens').defaultTo(0);
    table.integer('duration_ms');
    table.integer('success').defaultTo(1);
    table.integer('timestamp').notNullable();
    table.integer('prompt_cache_hit_tokens').defaultTo(0);
    table.integer('prompt_cache_miss_tokens').defaultTo(0);
    table.text('stage');
    table.text('prefix_hash');
    table.text('cache_strategy');
    table.integer('react_iterations');
    table.integer('tool_calls_count');
    // M2-2：单次调用成本（USD，可空；未知模型为 null 而非 0，禁止编造）
    table.float('cost').nullable();
  });

  await knex.schema.createTable('decision_logs', (table) => {
    table.text('id').primary();
    table.text('save_id');
    table.text('agent_type').notNullable();
    table.text('decision_type').notNullable();
    table.text('input').notNullable();
    table.text('reasoning').defaultTo('');
    table.text('decision').notNullable();
    table.float('confidence').defaultTo(1.0);
    table.integer('timestamp').notNullable();
  });

  await knex.schema.createTable('agent_dispatch_log', (table) => {
    table.text('id').primary();
    table.text('save_id').notNullable().index();
    table.text('agent_type').notNullable();
    table.text('action').notNullable();
    table.text('task_hash').notNullable();
    table.text('status').notNullable().defaultTo('in_progress');
    table.integer('attempt_count').notNullable().defaultTo(1);
    table.integer('max_attempts').notNullable().defaultTo(3);
    table.text('task_description').notNullable().defaultTo('');
    table.text('manifest_summary').notNullable().defaultTo('');
    table.text('result_summary').nullable();
    table.bigInteger('last_dispatched_at').notNullable();
    table.bigInteger('expires_at').notNullable();
    table.bigInteger('created_at').notNullable();
    table.bigInteger('updated_at').notNullable();
    table.unique(['save_id', 'agent_type', 'action', 'task_hash'], {
      indexName: 'uq_agent_dispatch_log_key',
    });
  });

  await knex.schema.createTable('agent_episodic_memories', (table) => {
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
  await knex.raw('CREATE INDEX idx_episodic_save_agent ON agent_episodic_memories(save_id, agent_key)');
  await knex.raw('CREATE INDEX idx_episodic_type ON agent_episodic_memories(type)');
  await knex.raw('CREATE INDEX idx_episodic_importance ON agent_episodic_memories(importance)');

  await knex.schema.createTable('agent_procedural_memories', (table) => {
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
  await knex.raw('CREATE INDEX idx_procedural_save_agent ON agent_procedural_memories(save_id, agent_key)');
  await knex.raw('CREATE INDEX idx_procedural_effectiveness ON agent_procedural_memories(effectiveness)');

  // ═══════════════════════════════════════════════════════════
  // 12. model_config_defaults（依赖 model_providers）
  // ═══════════════════════════════════════════════════════════

  await knex.schema.createTable('model_config_defaults', (table) => {
    table.text('id').primary();
    table.text('default_provider_id').references('id').inTable('model_providers').onDelete('SET NULL');
    table.text('default_model');
    table.text('fast_provider_id').nullable().defaultTo(null);
    table.text('fast_model').nullable().defaultTo(null);
    table.integer('updated_at').notNullable();
  });

  // ═══════════════════════════════════════════════════════════
  // 13. dialogue_summaries + combat_states + combat_history（复合 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE dialogue_summaries (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      summary TEXT NOT NULL,
      original_count INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dialogue_summaries_save_id ON dialogue_summaries(save_id)');

  await knex.raw(`
    CREATE TABLE combat_states (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      combat_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);

  await knex.raw(`
    CREATE TABLE combat_history (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      result_data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (save_id, id)
    )
  `);

  // ═══════════════════════════════════════════════════════════
  // 14. 节奏系统
  // ═══════════════════════════════════════════════════════════

  await knex.schema.createTable('pacing_config', (table) => {
    table.increments('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.text('tension_range').notNullable();
    table.text('tension_weights').notNullable();
    table.text('density_params').notNullable();
    table.text('progress_params').notNullable();
    table.text('stage_thresholds').notNullable();
    table.integer('pacing_interval').notNullable().defaultTo(5);
    table.text('generated_by').notNullable().defaultTo('default');
    table.text('template_context_hash').nullable();
    table.bigInteger('created_at').notNullable();
    table.bigInteger('updated_at').notNullable();
    table.unique(['save_id']);
  });

  await knex.schema.createTable('pacing_history', (table) => {
    table.increments('id').primary();
    table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
    table.integer('round_number').notNullable();
    table.float('deterministic_value').notNullable();
    table.float('llm_adjusted_value').nullable();
    table.text('adjustment_reason').nullable();
    table.text('factors').notNullable();
    table.text('stage').notNullable();
    table.integer('event_count').notNullable().defaultTo(0);
    table.float('main_quest_progress').nullable();
    table.integer('is_calculation_round').notNullable().defaultTo(0);
    table.bigInteger('created_at').notNullable();
  });
  await knex.raw('CREATE INDEX idx_pacing_history_save_round ON pacing_history(save_id, round_number)');

  // ═══════════════════════════════════════════════════════════
  // 15. 实体图谱（raw SQL，单列 PK）
  // ═══════════════════════════════════════════════════════════

  await knex.raw(`
    CREATE TABLE entity_graph_nodes (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      label TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE,
      UNIQUE(save_id, entity_type, entity_id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_egn_save ON entity_graph_nodes(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_egn_entity ON entity_graph_nodes(save_id, entity_type, entity_id)');

  await knex.raw(`
    CREATE TABLE entity_graph_edges (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      properties TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE,
      UNIQUE(save_id, from_node_id, relation, to_node_id)
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ege_save ON entity_graph_edges(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ege_from ON entity_graph_edges(from_node_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_ege_to ON entity_graph_edges(to_node_id)');

  await knex.raw(`
    CREATE TABLE entity_graph_snapshots (
      id TEXT PRIMARY KEY,
      save_id TEXT NOT NULL,
      snapshot_type TEXT NOT NULL DEFAULT 'baseline',
      chapter_number INTEGER,
      nodes_count INTEGER NOT NULL,
      edges_count INTEGER NOT NULL,
      delta_from_snapshot_id TEXT,
      added_node_ids TEXT,
      removed_node_ids TEXT,
      added_edge_ids TEXT,
      removed_edge_ids TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (save_id) REFERENCES saves(id) ON DELETE CASCADE
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_egs_save ON entity_graph_snapshots(save_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_egs_chapter ON entity_graph_snapshots(save_id, chapter_number)');

  // 模块3：information_boundaries 表已删除（004_drop_information_boundaries.ts 迁移数据到 PERCEIVES 边）
  // 新库不再创建此表；旧库由 004 迁移脚本处理

  // ═══════════════════════════════════════════════════════════
  // 16. 模板池表（复合 PK: template_id + id）
  // ═══════════════════════════════════════════════════════════

  await knex.schema.createTable('template_skill_pool', (table) => {
    table.text('template_id').notNullable().references('id').inTable('templates').onDelete('CASCADE');
    table.text('id').notNullable();
    table.text('name').notNullable();
    table.text('description').defaultTo('');
    table.text('category').defaultTo('attack');
    table.text('element').defaultTo('physical');
    table.text('cost').defaultTo('[]');
    table.text('damage').defaultTo('{}');
    table.text('effects').defaultTo('[]');
    table.integer('cooldown').defaultTo(0);
    table.integer('max_level').defaultTo(10);
    table.text('target_type').defaultTo('single');
    table.integer('range').defaultTo(1);
    table.text('custom_data').defaultTo('{}');
    table.text('recommended_classes').defaultTo('[]');
    table.text('source').defaultTo('manual');
    table.text('icon').defaultTo('');
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
    table.primary(['template_id', 'id']);
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_template_skill_pool_template ON template_skill_pool(template_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_template_skill_pool_name ON template_skill_pool(template_id, name)');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_template_skill_pool_name ON template_skill_pool(template_id, name)');

  await knex.schema.createTable('template_item_pool', (table) => {
    table.text('template_id').notNullable().references('id').inTable('templates').onDelete('CASCADE');
    table.text('id').notNullable();
    table.text('name').notNullable();
    table.text('description').defaultTo('');
    table.text('category').defaultTo('misc');
    table.text('quality').defaultTo('common');
    table.text('stats').defaultTo('{}');
    table.text('effects').defaultTo('[]');
    table.text('value').defaultTo('{}');
    table.text('tags').defaultTo('[]');
    table.integer('weight').defaultTo(1);
    table.integer('max_stack').defaultTo(99);
    table.text('equipped_slot').nullable();
    table.integer('durability').defaultTo(100);
    table.integer('max_durability').defaultTo(100);
    table.text('custom_data').defaultTo('{}');
    table.text('recommended_classes').defaultTo('[]');
    table.text('source').defaultTo('manual');
    table.text('icon').defaultTo('');
    table.integer('created_at').notNullable();
    table.integer('updated_at').notNullable();
    table.primary(['template_id', 'id']);
  });
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_template_item_pool_template ON template_item_pool(template_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_template_item_pool_name ON template_item_pool(template_id, name)');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_template_item_pool_name ON template_item_pool(template_id, name)');

  await knex.raw('PRAGMA foreign_keys = ON');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('PRAGMA foreign_keys = OFF');

  const tables = [
    'template_item_pool', 'template_skill_pool',
    'entity_graph_snapshots', 'entity_graph_edges', 'entity_graph_nodes',
    'pacing_history', 'pacing_config',
    'combat_history', 'combat_states', 'dialogue_summaries',
    'model_config_defaults',
    'agent_procedural_memories', 'agent_episodic_memories', 'agent_dispatch_log',
    'decision_logs', 'agent_llm_calls', 'agent_schedules', 'agent_contexts',
    'event_triggers',
    'story_events', 'dialogues',
    'quest_objectives', 'quests',
    'discovered_locations', 'location_connections', 'locations',
    'npc_goals', 'npc_relations', 'npcs',
    'skill_pool', 'character_skills',
    'item_pool', 'inventory',
    'characters',
    'save_game_time', 'save_write_logs', 'save_data_indexes', 'save_game_state', 'save_snapshots',
    'agent_profiles', 'events',
    'model_providers', 'prompts', 'templates',
    'dev_consistency_reports', 'dev_snapshots', 'frontend_logs',
    'saves',
    'schema_version',
  ];

  for (const table of tables) {
    await knex.raw(`DROP TABLE IF EXISTS ${table}`);
  }

  await knex.raw('PRAGMA foreign_keys = ON');
}
