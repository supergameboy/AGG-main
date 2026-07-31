const Database = require('better-sqlite3');
const db = new Database('C:/Users/super/Documents/trae_projects/AGG-main/game_data/game.db');
const rows = db.prepare("SELECT id, name, hidden FROM locations WHERE save_id='save-d028a43a-90e7-4aad-997c-897b5b5fe83c'").all();
console.log(JSON.stringify(rows, null, 2));
db.close();
