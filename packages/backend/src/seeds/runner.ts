import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Knex } from 'knex';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Seed {
  seed: (knex: Knex) => Promise<void>;
}

async function loadSeed(filename: string): Promise<Seed> {
  const seedPath = path.join(__dirname, filename);
  const module = await import(`file://${seedPath}`);
  return module as Seed;
}

function getSeedOrder(filename: string): number {
  const match = filename.match(/^(\d+)_/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getSeedFiles(): Promise<string[]> {
  const files = fs.readdirSync(__dirname);
  return files
    .filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && f !== 'index.ts' && f !== 'index.js' && f !== 'runner.ts' && f !== 'runner.js')
    .sort((a, b) => getSeedOrder(a) - getSeedOrder(b));
}

export async function runSeeds(db: Knex): Promise<void> {
  const seedFiles = await getSeedFiles();

  for (const file of seedFiles) {
    console.log(`Running seed: ${file}`);
    const seed = await loadSeed(file);

    try {
      await seed.seed(db);
      console.log(`Seed ${file} completed successfully`);
    } catch (error) {
      console.error(`Seed ${file} failed:`, error);
      throw error;
    }
  }

  console.log('All seeds completed');
}
