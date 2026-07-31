// 临时调试脚本：查询 character_skills 表状态
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'dist-release', '0.0.69', 'game_data', 'game.db');
const db = new Database(dbPath, { readonly: true });

const saveId = 'save_人类_1784571558052_0';

console.log('=== character_skills 表中所有该 saveId 下的技能 ===');
const rows = db.prepare('SELECT id, skill_id, name, owner_type, owner_id, cooldown_remaining FROM character_skills WHERE save_id = ?').all(saveId);
console.log(JSON.stringify(rows, null, 2));

console.log('\n=== skill_pool 表中所有该 saveId 下的技能 ===');
const poolRows = db.prepare('SELECT id, name, category, cooldown FROM skill_pool WHERE save_id = ?').all(saveId);
console.log(JSON.stringify(poolRows, null, 2));

console.log('\n=== 检查 ID 为 skill_法力护盾_1784571718523_22 的记录（character_skills.id 匹配） ===');
const byId = db.prepare('SELECT id, skill_id, name, owner_type, owner_id FROM character_skills WHERE id = ?').all('skill_法力护盾_1784571718523_22');
console.log(JSON.stringify(byId, null, 2));

console.log('\n=== 检查 skill_id 为 skill_法力护盾_1784571718523_22 的记录（character_skills.skill_id 匹配） ===');
const bySkillId = db.prepare('SELECT id, skill_id, name, owner_type, owner_id FROM character_skills WHERE skill_id = ?').all('skill_法力护盾_1784571718523_22');
console.log(JSON.stringify(bySkillId, null, 2));

db.close();
