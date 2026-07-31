import { config } from './utils/config.js';
import { createDatabaseConnection, testConnection, closeDatabase } from './database/connection.js';
import { ensureDirectories } from './database/storage.js';
import { runMigrations, getMigrationStatus } from './migrations/runner.js';
import { runSeeds } from './seeds/runner.js';

async function testDatabaseSystem() {
  console.log('========================================');
  console.log('Testing Module 2 - Database System');
  console.log('========================================\n');

  try {
    console.log('Step 1: Ensuring data directories...');
    ensureDirectories();
    console.log('✓ Data directories created/verified\n');

    console.log('Step 2: Creating database connection...');
    const db = createDatabaseConnection();
    console.log('✓ Database connection created\n');

    console.log('Step 3: Testing database connection...');
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }
    console.log('✓ Database connection successful\n');

    console.log('Step 4: Checking migration status...');
    const status = await getMigrationStatus(db);
    console.log(`✓ Applied migrations: ${status.applied.length}`);
    console.log(`✓ Pending migrations: ${status.pending.length}\n`);

    console.log('Step 5: Running migrations...');
    await runMigrations(db);
    console.log('✓ All migrations completed\n');

    console.log('Step 6: Running seeds...');
    await runSeeds(db);
    console.log('✓ All seeds completed\n');

    console.log('Step 7: Verifying data...');
    const templateCount = await db('templates').count('* as count').first();
    console.log(`✓ Templates: ${(templateCount as { count: number }).count}\n`);

    console.log('========================================');
    console.log('✓ Module 2 - Database System PASSED');
    console.log('========================================\n');
    
    console.log('Database file:', config.database.filename);
    console.log('Game data directory:', config.gameData.dir);
    console.log('\nAll tasks completed successfully!');

    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('========================================');
    console.error('✗ Module 2 - Database System FAILED');
    console.error('========================================\n');
    console.error('Error:', error);
    await closeDatabase();
    process.exit(1);
  }
}

testDatabaseSystem();
