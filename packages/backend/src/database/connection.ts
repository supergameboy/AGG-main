import knex, { Knex } from 'knex';
import { config } from '../utils/config.js';
import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';

const logger = createChildLogger('database');

let db: Knex | null = null;

export function createDatabaseConnection(): Knex {
  if (db) {
    return db;
  }

  db = knex({
    client: 'better-sqlite3',
    connection: {
      filename: config.database.filename,
    },
    useNullAsDefault: true,
    pool: {
      min: config.database.pool.min,
      max: config.database.pool.max,
      afterCreate: (conn: any, done: any) => {
        try {
          conn.pragma('journal_mode = WAL');
          conn.pragma('busy_timeout = 5000');
          conn.pragma('foreign_keys = ON');
          logger.info('SQLite configured: WAL mode, busy_timeout=5000ms, foreign_keys=ON');
          done(null, conn);
        } catch (err) {
          const errorMessage = getErrorMessage(err);
          logger.warn('Failed to configure SQLite', { error: errorMessage });
          done(err, conn);
        }
      },
    },
    migrations: {
      directory: './migrations',
      extension: 'ts',
    },
    seeds: {
      directory: './seeds',
      extension: 'ts',
    },
  });

  return db;
}

export function getDatabase(): Knex {
  if (!db) {
    throw new Error('Database not initialized. Call createDatabaseConnection() first.');
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const database = getDatabase();
    await database.raw('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}
