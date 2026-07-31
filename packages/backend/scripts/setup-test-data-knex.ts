import { createDatabaseConnection } from '../src/database/connection.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NOW = new Date().toISOString();
const SAVE_ID = 'test-save-001';

async function setupTestData() {
  console.log('=== Setting up Test Data via Knex ===\n');
  
  const db = createDatabaseConnection();
  
  try {
    // 1. Save
    const [save] = await db('saves')
      .where('id', SAVE_ID)
      .select('id');
    
    if (!save) {
      await db('saves').insert({
        id: SAVE_ID,
        name: 'Test Save',
        type: 'manual',
        template_id: 'tpl_fantasy_001',
        game_mode: 'fantasy',
        chapter: 'ch1',
        location: 'town_sq',
        level: 1,
        play_time: 0,
        created_at: NOW,
        updated_at: NOW,
      });
      console.log('✅ Save inserted');
    } else {
      console.log('ℹ️  Save already exists');
    }

    // 2. Character
    const [char] = await db('characters')
      .where('save_id', SAVE_ID)
      .select('id');
    
    if (!char) {
      const attrs = JSON.stringify({ strength: 12, agility: 10, intelligence: 14, vitality: 11, luck: 8 });
      const derived = JSON.stringify({ maxHealth: 315, maxMana: 190, attack: 34, defense: 22 });
      
      await db('characters').insert({
        id: 'char-test-001',
        save_id: SAVE_ID,
        name: '艾尔登',
        race: '人类',
        class: '战士',
        background: '年轻冒险者',
        level: 1,
        experience: 0,
        attributes: attrs,
        derived_attributes: derived,
        health: 315,
        max_health: 315,
        mana: 190,
        max_mana: 190,
        gold: 50,
        status: '{}',
        custom_data: '{}',
        created_at: NOW,
        updated_at: NOW,
      });
      console.log('✅ Character inserted (艾尔登 Lvl.1 Warrior)');
    } else {
      console.log('ℹ️  Character already exists');
    }

    // 3. Game Time - ensure table exists first
    const tableExists = await db.schema.hasTable('save_game_time');
    if (!tableExists) {
      console.log('⚠️  save_game_time table missing, creating...');
      await db.schema.createTable('save_game_time', (table) => {
        table.text('id').primary();
        table.text('save_id').notNullable().references('id').inTable('saves').onDelete('CASCADE');
        table.integer('total_minutes').notNullable().defaultTo(0);
        table.integer('day_number').notNullable().defaultTo(1);
        table.text('last_action').defaultTo('');
        table.integer('last_action_at').notNullable();
        table.text('custom_data').defaultTo('{}');
        table.integer('updated_at').notNullable();
        table.unique(['save_id']);
      });
      console.log('✅ save_game_time table created');
    }
    
    const [gt] = await db('save_game_time')
      .where('save_id', SAVE_ID)
      .select('id');
    
    if (!gt) {
      await db('save_game_time').insert({
        id: 'gt-test-001',
        save_id: SAVE_ID,
        total_minutes: 480,
        day_number: 1,
        last_action: 'init',
        last_action_at: NOW,
        updated_at: NOW,
      });
      console.log('✅ GameTime inserted (Day 1, 08:00)');
    } else {
      console.log('ℹ️  GameTime already exists');
    }

    // 4. NPC
    const [npc] = await db('npcs')
      .where('id', 'npc-blacksmith-001')
      .select('id');
    
    if (!npc) {
      const services = JSON.stringify([{ type: 'trade', name: '装备买卖' }]);
      
      await db('npcs').insert({
        id: 'npc-blacksmith-001',
        save_id: SAVE_ID,
        template_npc_id: 'tpl_npc_blacksmith',
        name: '老铁匠',
        title: '铁匠铺老板',
        description: '经验丰富的铁匠，可以帮你修理和升级装备',
        role: 'neutral',
        race: '人类',
        location_id: 'loc_town_bs',
        level: 5,
        stats: '{}',
        services: services,
        dialogue_history: '[]',
        custom_data: '{}',
        created_at: NOW,
        updated_at: NOW,
      });
      console.log('✅ NPC inserted (老铁匠 @ loc_town_bs)');
    } else {
      console.log('ℹ️  NPC already exists');
    }

    // Verification
    console.log('\n=== Verification ===');
    const saves = await db('saves').where('id', SAVE_ID).select('id', 'name');
    const chars = await db('characters').where('save_id', SAVE_ID).select('name', 'level');
    const npcs = await db('npcs').where('save_id', SAVE_ID).select('name');
    const time = await db('save_game_time').where('save_id', SAVE_ID).select('total_minutes', 'day_number');

    console.log(`Save: ${JSON.stringify(saves)}`);
    console.log(`Character: ${JSON.stringify(chars)}`);
    console.log(`NPC: ${JSON.stringify(npcs)}`);
    if (time.length > 0) {
      console.log(`GameTime: Day ${time[0].day_number}, ${time[0].total_minutes}min (${Math.floor(time[0].total_minutes / 60)}:${String(time[0].total_minutes % 60).padStart(2, '0')})`);
    }
    
    console.log('\n✅ Test data ready for ServiceTool + DAG testing!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await db.destroy();
  }
}

setupTestData().catch(console.error);
