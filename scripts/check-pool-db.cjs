const Database = require('better-sqlite3');
const db = new Database('game_data/game.db');

// 查找木制法杖、学徒兜帽等初始化物品
const rows = db.prepare("SELECT id, name, category, source FROM template_item_pool WHERE name LIKE '%木制%' OR name LIKE '%法杖%' OR name LIKE '%学徒兜帽%' OR name LIKE '%幸运护符%' OR name LIKE '%破旧%' OR name LIKE '%下水道%'").all();
console.log('=== template_item_pool: 初始化物品 ===');
console.log(JSON.stringify(rows, null, 2));

// 查总数
const count = db.prepare('SELECT COUNT(*) as total, source FROM template_item_pool GROUP BY source').all();
console.log('\n=== template_item_pool: 按source统计 ===');
console.log(JSON.stringify(count, null, 2));

// 查 template_skill_pool
const skillRows = db.prepare("SELECT id, name, category, source FROM template_skill_pool WHERE name LIKE '%火球%' OR name LIKE '%魔法飞弹%' OR name LIKE '%法力护盾%' OR name LIKE '%冰霜%' OR name LIKE '%奥术%'").all();
console.log('\n=== template_skill_pool: 初始化技能 ===');
console.log(JSON.stringify(skillRows, null, 2));

const skillCount = db.prepare('SELECT COUNT(*) as total, source FROM template_skill_pool GROUP BY source').all();
console.log('\n=== template_skill_pool: 按source统计 ===');
console.log(JSON.stringify(skillCount, null, 2));

// 查 saves 表中的 template_id
const saves = db.prepare('SELECT id, template_id FROM saves LIMIT 5').all();
console.log('\n=== saves: template_id ===');
console.log(JSON.stringify(saves, null, 2));

db.close();
