const Database = require('better-sqlite3');
const db = new Database('C:/Users/super/Documents/trae_projects/AGG (2)/game_data/game.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
try {
  const saves = db.prepare('SELECT COUNT(*) as cnt FROM saves').get();
  console.log('Saves count:', saves.cnt);
  const chars = db.prepare('SELECT COUNT(*) as cnt FROM characters').get();
  console.log('Characters count:', chars.cnt);
} catch (e) {
  console.log('Error:', e.message);
}
db.close();
