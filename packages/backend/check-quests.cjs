// 临时脚本：查询 quest 表状态 - 使用 node:sqlite
const { DatabaseSync } = require('node:sqlite');
const dbPath = 'C:/Users/super/Documents/trae_projects/AGG-main/dist-release/0.0.73/game_data/game.db';
const db = new DatabaseSync(dbPath, { readOnly: true });

// 列出所有表
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

// 列出 saves
console.log('\n=== saves ===');
try {
  const saves = db.prepare('SELECT id, name, status, created_at FROM saves ORDER BY created_at DESC LIMIT 10').all();
  console.log('Total saves:', saves.length);
  console.log(JSON.stringify(saves, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

// quests 表结构
console.log('\n=== quests table schema ===');
try {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='quests'").get();
  console.log(schema ? schema.sql : 'quests table not found');
} catch (e) {
  console.log('Error:', e.message);
}

// 列出 quests
console.log('\n=== quests ===');
try {
  const quests = db.prepare('SELECT * FROM quests ORDER BY created_at DESC LIMIT 20').all();
  console.log('Total quests:', quests.length);
  console.log(JSON.stringify(quests, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

// 按 save_id 分组统计 quest
console.log('\n=== quest counts by save_id + status ===');
try {
  const counts = db.prepare("SELECT save_id, status, COUNT(*) as cnt FROM quests GROUP BY save_id, status ORDER BY save_id").all();
  console.log(JSON.stringify(counts, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

// 按 save_id 分组统计 quest + visibility
console.log('\n=== quest counts by save_id + visibility ===');
try {
  const counts = db.prepare("SELECT save_id, visibility, COUNT(*) as cnt FROM quests GROUP BY save_id, visibility ORDER BY save_id").all();
  console.log(JSON.stringify(counts, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}

db.close();
