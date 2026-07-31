/**
 * 集成测试 §10.4-2：真实语料全量解析。
 *
 * 用统一 Parser + 三 schema 解析 config/agent-skills、config/agent-rules、config/agent-help
 * 全部 .md，枚举所有 YAML 不兼容 / schema 校验失败项（Phase C 修复目标：0 失败）。
 */

import { describe, expect, it } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  helpFrontmatterSchema,
  parseAndValidate,
  ruleFrontmatterSchema,
  skillFrontmatterSchema,
} from '../index.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const CONFIG_DIR = join(PACKAGE_ROOT, 'config');

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = await stat(fullPath);
    if (stats.isDirectory()) {
      files.push(...(await walkMarkdownFiles(fullPath)));
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

interface CorpusFailure {
  readonly file: string;
  readonly error: string;
}

async function scanCorpus(
  dirName: string,
  schema: typeof skillFrontmatterSchema | typeof ruleFrontmatterSchema | typeof helpFrontmatterSchema,
): Promise<{ total: number; failures: CorpusFailure[] }> {
  const files = await walkMarkdownFiles(join(CONFIG_DIR, dirName));
  const failures: CorpusFailure[] = [];

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf-8');
    try {
      parseAndValidate(raw, schema, { filePath, requireFrontmatter: true });
    } catch (error) {
      failures.push({
        file: relative(CONFIG_DIR, filePath).replace(/\\/g, '/'),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { total: files.length, failures };
}

describe('真实语料全量解析（§10.4-2）', () => {
  it('agent-skills 全部通过 skillSchema', async () => {
    const { total, failures } = await scanCorpus('agent-skills', skillFrontmatterSchema);
    expect(total).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('agent-rules 全部通过 ruleSchema', async () => {
    const { total, failures } = await scanCorpus('agent-rules', ruleFrontmatterSchema);
    expect(total).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('agent-help 全部通过 helpSchema', async () => {
    const { total, failures } = await scanCorpus('agent-help', helpFrontmatterSchema);
    expect(total).toBeGreaterThan(0);
    if (failures.length > 0) {
      console.error(`agent-help corpus failures (${failures.length}):\n${JSON.stringify(failures, null, 2)}`);
    }
    expect(failures).toEqual([]);
  });
});
