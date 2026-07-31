import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../src/utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = config.database.filename;

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

const NOW = Date.now();
const SAVE_ID = 'test-save-001';

function run(sql: string) {
  const result = db.prepare(sql).run();
  if (result.changes > 0) console.log(`  ✅ +${result.changes} row(s)`);
}

console.log('=== Setting up Test Data for ServiceTool Verification ===\n');

// 1. Save
run(`INSERT OR IGNORE INTO saves (id,name,type,template_id,game_mode,chapter,location,level,play_time,created_at,updated_at)
  VALUES ('${SAVE_ID}','Test Save','manual','tpl_fantasy_001','fantasy','ch1','town_sq',1,0,${NOW},${NOW})`);

// 2. Character
const attrs = JSON.stringify({ strength: 12, agility: 10, intelligence: 14, vitality: 11, luck: 8 });
const derived = JSON.stringify({ maxHealth: 315, maxMana: 190, attack: 34, defense: 22 });
run(`INSERT OR IGNORE INTO characters (id,save_id,name,race,class,background,level,experience,attributes,derived_attributes,health,max_health,mana,max_mana,gold,status,custom_data,created_at,updated_at)
  VALUES ('char-test-001','${SAVE_ID}','艾尔登','人类','战士','年轻冒险者',1,0,'${attrs}','${derived}',315,315,190,190,50,'{}','{}',${NOW},${NOW})`);

// 3. Game Time
run(`INSERT OR IGNORE INTO save_game_time (id,save_id,total_minutes,day_number,last_action,last_action_at,updated_at)
  VALUES ('gt-test-001','${SAVE_ID}',480,1,'init',${NOW},${NOW})`);

// 4. NPC
const services = JSON.stringify([{ type: 'trade', name: '装备买卖' }]);
run(`INSERT OR IGNORE INTO npcs (id,save_id,template_npc_id,name,title,description,role,race,location_id,level,stats,services,dialogue_history,custom_data,created_at,updated_at)
  VALUES ('npc-blacksmith-001','${SAVE_ID}','tpl_npc_blacksmith','老铁匠','铁匠铺老板','经验丰富的铁匠','neutral','人类','loc_town_bs',5,'{}','${services}','[]','{}',${NOW},${NOW})`);

// Verify
console.log('\n=== Verification ===');
const saves = db.prepare("SELECT id,name FROM saves WHERE id=?").all(SAVE_ID);
const chars = db.prepare("SELECT name,level FROM characters WHERE save_id=?").all(SAVE_ID);
const npcs = db.prepare("SELECT name FROM npcs WHERE save_id=?").all(SAVE_ID);
const time = db.prepare("SELECT total_minutes,day_number FROM save_game_time WHERE save_id=?").all(SAVE_ID);

console.log(`Save: ${JSON.stringify(saves)}`);
console.log(`Character: ${JSON.stringify(chars)}`);
console.log(`NPC: ${JSON.stringify(npcs)}`);
console.log(`GameTime: Day ${(time[0] as any)?.day_number}, ${(time[0] as any)?.total_minutes}min`);
console.log('\n✅ Test data ready!');
db.close();
