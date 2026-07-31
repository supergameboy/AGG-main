/**
 * 数据库恢复脚本：将备份的 API key 配置写入新数据库
 *
 * 策略：清空 model_providers + model_config_defaults 中的 seed 数据，用备份的 API key
 * 配置完整替换。这避免了 seed 的 convict-config provider（无 API key）与备份的
 * 真实 provider 冲突。
 *
 * 前置条件：
 *   1. 已执行 db-export-apikey.cjs 导出 API key 到 game_data/backup/api-keys.json
 *   2. 已删除损坏的 game_data/game.db（及 -shm / -wal）
 *   3. 后端服务器已启动过一次（migrations 自动重建表结构 + convict seed）
 *   4. 后端服务器已停止（避免 WAL 锁冲突）
 *
 * 用法：node scripts/db-import-apikey.cjs
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = 'game_data/game.db';
const BACKUP_FILE = path.join('game_data', 'backup', 'api-keys.json');

if (!fs.existsSync(BACKUP_FILE)) {
  console.error(`Backup file not found: ${BACKUP_FILE}`);
  console.error('Please run: node scripts/db-export-apikey.cjs first');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database file not found: ${DB_PATH}`);
  console.error('Please start the backend server once to trigger migrations, then stop it');
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
const db = new Database(DB_PATH);

try {
  // 1. 清空 seed 数据（避免与备份的 provider 冲突）
  console.log('Clearing seed data...');
  db.prepare('DELETE FROM model_config_defaults').run();
  db.prepare('DELETE FROM model_providers').run();
  console.log('Seed data cleared');

  // 2. 恢复 model_providers
  if (backup.model_providers && backup.model_providers.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO model_providers
      (id, provider_type, name, base_url, api_format, api_keys, default_model,
       enabled, extra_config, created_at, updated_at, max_tokens)
      VALUES (@id, @provider_type, @name, @base_url, @api_format, @api_keys,
              @default_model, @enabled, @extra_config, @created_at, @updated_at, @max_tokens)
    `);
    const tx = db.transaction((rows) => {
      for (const row of rows) stmt.run(row);
    });
    tx(backup.model_providers);
    console.log(`Restored ${backup.model_providers.length} model_providers`);
  }

  // 3. 恢复 model_config_defaults
  if (backup.model_config_defaults && backup.model_config_defaults.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO model_config_defaults
      (id, default_provider_id, default_model, updated_at, fast_provider_id, fast_model)
      VALUES (@id, @default_provider_id, @default_model, @updated_at, @fast_provider_id, @fast_model)
    `);
    const tx = db.transaction((rows) => {
      for (const row of rows) stmt.run(row);
    });
    tx(backup.model_config_defaults);
    console.log(`Restored ${backup.model_config_defaults.length} model_config_defaults`);
  }

  // 4. 验证
  const providers = db.prepare('SELECT id, name, provider_type, default_model, enabled FROM model_providers').all();
  console.log('\n=== Verification ===');
  console.log('model_providers:');
  for (const p of providers) {
    console.log(`  - ${p.name} (${p.provider_type}/${p.default_model}) enabled=${p.enabled}`);
  }
  const defaults = db.prepare('SELECT * FROM model_config_defaults').all();
  console.log('model_config_defaults:', JSON.stringify(defaults, null, 2));

  // 5. 完整性检查
  const integrity = db.pragma('integrity_check', { simple: false });
  console.log('\nIntegrity check:', JSON.stringify(integrity));

  console.log('\nAPI key restoration completed successfully');
} catch (e) {
  console.error('Restore failed:', e.message);
  process.exit(1);
} finally {
  db.close();
}
