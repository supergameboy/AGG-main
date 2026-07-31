/**
 * 数据库恢复脚本：备份 API key 配置 → 删除损坏数据库 → 启动后端自动重建 → 恢复 API key
 *
 * 用法：
 *   1. node scripts/db-export-apikey.cjs   # 导出 API key 到 game_data/backup/api-keys.json
 *   2. 停止后端服务器
 *   3. 删除 game_data/game.db / game.db-shm / game.db-wal
 *   4. 启动后端服务器（migrations 自动重建表结构）
 *   5. node scripts/db-import-apikey.cjs   # 将 API key 写入新数据库
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = 'game_data/game.db';
const BACKUP_DIR = 'game_data/backup';
const BACKUP_FILE = path.join(BACKUP_DIR, 'api-keys.json');

// 确保备份目录存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const db = new Database(DB_PATH, { readonly: true });

const backup = {
  exported_at: new Date().toISOString(),
  model_providers: [],
  model_config_defaults: [],
};

try {
  backup.model_providers = db.prepare('SELECT * FROM model_providers').all();
  console.log(`Exported ${backup.model_providers.length} model_providers`);
} catch (e) {
  console.error('Failed to export model_providers:', e.message);
}

try {
  backup.model_config_defaults = db.prepare('SELECT * FROM model_config_defaults').all();
  console.log(`Exported ${backup.model_config_defaults.length} model_config_defaults`);
} catch (e) {
  console.error('Failed to export model_config_defaults:', e.message);
}

db.close();

fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2), 'utf8');
console.log(`API key backup saved to: ${BACKUP_FILE}`);
