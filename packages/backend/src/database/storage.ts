import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';

export function ensureDirectories(): void {
  const dirs = [
    config.gameData.dir,
    config.gameData.saves,
    config.gameData.templates,
    config.gameData.images,
    config.logs.dir,
    config.gameData.backups,
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
}

export function getGameDataPath(subdir: string, filename?: string): string {
  const basePath = config.gameData[subdir as keyof typeof config.gameData];
  if (!basePath) {
    throw new Error(`Unknown game data directory: ${subdir}`);
  }
  if (filename) {
    return path.join(basePath, filename);
  }
  return basePath;
}

export function listFiles(dir: string, extension?: string): string[] {
  const fullPath = getGameDataPath(dir);
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  const files = fs.readdirSync(fullPath);
  if (extension) {
    return files.filter(f => f.endsWith(extension));
  }
  return files;
}

export function readJsonFile<T>(dir: string, filename: string): T | null {
  const filePath = getGameDataPath(dir, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export function writeJsonFile<T>(dir: string, filename: string, data: T): void {
  const filePath = getGameDataPath(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
