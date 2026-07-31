import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Knex } from 'knex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Migration {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
}

const MIGRATIONS_DIR = __dirname;

async function loadMigration(filename: string): Promise<Migration> {
  const migrationPath = path.join(MIGRATIONS_DIR, filename);
  const module = await import(`file://${migrationPath}`);
  return module as Migration;
}

function getMigrationVersion(filename: string): number {
  const match = filename.match(/^(\d+)_/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getAppliedVersions(db: Knex): Promise<number[]> {
  const exists = await db.schema.hasTable('schema_version');
  if (!exists) {
    return [];
  }
  const rows = await db('schema_version').select('version');
  return rows.map((r: { version: number }) => r.version);
}

async function getMigrationFiles(): Promise<string[]> {
  const files = fs.readdirSync(MIGRATIONS_DIR);
  return files
    .filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && f !== 'index.ts' && f !== 'index.js' && f !== 'runner.ts' && f !== 'runner.js')
    .sort((a, b) => getMigrationVersion(a) - getMigrationVersion(b));
}

export async function runMigrations(db: Knex): Promise<void> {
  const appliedVersions = await getAppliedVersions(db);
  const migrationFiles = await getMigrationFiles();

  for (const file of migrationFiles) {
    const version = getMigrationVersion(file);
    if (appliedVersions.includes(version)) {
      console.log(`Migration ${file} already applied, skipping...`);
      continue;
    }

    console.log(`Running migration: ${file}`);
    const migration = await loadMigration(file);

    try {
      await migration.up(db);
      await db('schema_version').insert({
        version,
        applied_at: Date.now(),
        description: file,
      });
      console.log(`Migration ${file} completed successfully`);
    } catch (error) {
      console.error(`Migration ${file} failed:`, error);
      throw error;
    }
  }

  console.log('All migrations completed');
}

export async function rollbackMigrations(db: Knex, steps: number = 1): Promise<void> {
  const appliedVersions = await getAppliedVersions(db);
  const migrationFiles = await getMigrationFiles();

  const sortedVersions = [...appliedVersions].sort((a, b) => b - a);
  const versionsToRollback = sortedVersions.slice(0, steps);

  for (const version of versionsToRollback) {
    const file = migrationFiles.find(f => getMigrationVersion(f) === version);
    if (!file) {
      console.log(`Migration file for version ${version} not found, skipping...`);
      continue;
    }

    console.log(`Rolling back migration: ${file}`);
    const migration = await loadMigration(file);

    try {
      await migration.down(db);
      await db('schema_version').where('version', version).delete();
      console.log(`Rollback ${file} completed successfully`);
    } catch (error) {
      console.error(`Rollback ${file} failed:`, error);
      throw error;
    }
  }

  console.log('Rollback completed');
}

export async function getMigrationStatus(db: Knex): Promise<{ applied: number[]; pending: number[] }> {
  const appliedVersions = await getAppliedVersions(db);
  const migrationFiles = await getMigrationFiles();
  const allVersions = migrationFiles.map(f => getMigrationVersion(f));

  const pending = allVersions.filter(v => !appliedVersions.includes(v));

  return {
    applied: appliedVersions.sort((a, b) => a - b),
    pending: pending.sort((a, b) => a - b),
  };
}
