import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M2 架构合规测试（设计文档 模块M2 §8.6 A1-A3）
 *
 * A1: packages/ai 零业务依赖——全 src 无 packages/backend / knex import
 * A2: IOAuthCredentialStore 端口隔离——oauth/ 目录仅 type import，无存储实现依赖
 * A3: 零 as unknown as / as any / as never——B2 新增文件全量扫描
 *
 * A4（check-layer-boundary.mjs 0 ERROR）为独立脚本，由 CI/验收流程执行，不在此重复。
 */

const AI_SRC = fileURLToPath(new URL('../src', import.meta.url));

/** 递归收集 src 下全部 .ts 源文件（排除 __tests__ / .test.ts / .d.ts） */
function walkTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...walkTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** 提取文件中全部 import/export-from/dynamic-import 的模块说明符（跳过注释，防误报） */
function extractSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** 禁止出现在 packages/ai 的业务/存储依赖（零业务依赖硬约束） */
function isForbiddenSpecifier(specifier: string): boolean {
  return (
    specifier === 'knex' ||
    specifier.startsWith('knex/') ||
    specifier.includes('packages/backend') ||
    specifier.startsWith('@ai-rpg/backend')
  );
}

const B2_NEW_FILES = [
  'oauth/types.ts',
  'oauth/oauth-registry.ts',
  'oauth/device-code.ts',
  'oauth/oauth-service.ts',
  'oauth/index.ts',
  'images-types.ts',
  'images-api-registry.ts',
];

describe('架构合规（§8.6 A1-A3）', () => {
  it('A1/A2: packages/ai 全 src 零 packages/backend / knex import（IOAuthCredentialStore 端口隔离）', () => {
    const violations: string[] = [];
    for (const file of walkTsFiles(AI_SRC)) {
      const specifiers = extractSpecifiers(readFileSync(file, 'utf8'));
      for (const specifier of specifiers) {
        if (isForbiddenSpecifier(specifier)) {
          violations.push(`${relative(AI_SRC, file)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('A3: B2 新增文件零 as unknown as / as any / as never', () => {
    const forbiddenCasts = [/as\s+unknown\s+as/, /as\s+any\b/, /as\s+never\b/];
    const violations: string[] = [];
    for (const relPath of B2_NEW_FILES) {
      const content = readFileSync(join(AI_SRC, relPath), 'utf8');
      for (const pattern of forbiddenCasts) {
        if (pattern.test(content)) {
          violations.push(`${relPath} 命中 ${pattern.source}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
