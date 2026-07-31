import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

export class TemplateLoader {
  private cache = new Map<string, Promise<string>>();

  constructor(private promptsDir: string) {}

  async load(filename: string): Promise<string> {
    const cached = this.cache.get(filename);
    if (cached) return cached;
    const promise = readFile(resolve(this.promptsDir, filename), 'utf-8');
    this.cache.set(filename, promise);
    return promise;
  }

  async loadIfExists(filename: string): Promise<string | null> {
    const filePath = resolve(this.promptsDir, filename);
    try {
      await access(filePath, constants.F_OK);
      return this.load(filename);
    } catch {
      return null;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}
