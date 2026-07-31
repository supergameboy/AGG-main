#!/usr/bin/env node

/**
 * 分层依赖检查脚本 (P3-S9)
 *
 * 检查 packages/backend/src/ 下的 import/export 语句是否违反分层依赖规则。
 * 参考设计: docs/design/fractal-design-20260626-backend-decoupling-refactor/
 *           fractal-design-20260626-backend-decoupling-refactor-模块C-严格分层解耦.md §3.6
 *
 * 用法:
 *   node scripts/check-layer-boundary.mjs           # warn 模式（不阻断构建）
 *   node scripts/check-layer-boundary.mjs --error   # error 模式（有 value import 违规则 exit 1）
 */

import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const BACKEND_SRC = resolve(PROJECT_ROOT, 'packages', 'backend', 'src');

/**
 * 分层依赖规则：源层 → 禁止依赖的目标层
 *
 * 路径相对于 packages/backend/src/，用正则匹配。
 * 适配说明（vs 设计 §3.6）：
 * - 设计写 game-systems 子目录下的 tools 路径，实际 tools 子目录不存在，
 *   工具文件以 Tool.ts 或 ServiceTool.ts 命名混在业务目录中，
 *   适配为 /^game-systems\/[^/]+\/[^/]*Tool\.ts$/
 * - 设计写 shared/session，实际 session 目录不存在，保留为前瞻规则（目录创建后自动生效）
 *
 * 字段说明:
 * - sourcePattern: 源文件路径正则（相对 packages/backend/src/）
 * - forbiddenLayers: 禁止依赖的内部层（相对路径 import 目标层）
 * - forbiddenPackages: 禁止依赖的外部裸包（如 @ai-rpg/ai，G2→H 禁止 LLM 调用）
 *
 * 类型导入处理:
 * - value import 违规 → ERROR（error 模式阻断构建）
 * - type-only import 违规 → WARNING（不阻断构建，架构规范允许 type import 端口接口）
 *
 * 阶段三新增（DF-033 修复）:
 * - G2→G: programs/ 禁止 value import agents/（零反向依赖 Agent 核心 G）
 * - G2→F: programs/ 禁止 value import game-systems/（仅允许 type import 端口接口）
 * - G2→H: programs/ 禁止 import @ai-rpg/ai（零 LLM 调用，纯代码编排）
 * - 阶段四更新: G2 层目录从 orchestrators/ 改名为 programs/
 */
const RULES = [
  {
    name: 'F→E',
    sourcePattern: /^game-systems\//,
    forbiddenLayers: ['services'],
    description: '业务层禁止依赖服务层（通过接口解耦）'
  },
  {
    name: 'I→E+G',
    sourcePattern: /^game-systems\/[^/]+\/[^/]*Tool\.ts$/,
    forbiddenLayers: ['services', 'agents'],
    description: '工具层禁止依赖服务层和Agent层'
  },
  {
    name: 'A→F',
    sourcePattern: /^database\//,
    forbiddenLayers: ['game-systems'],
    description: '数据层禁止依赖业务层'
  },
  {
    name: 'G→F',
    sourcePattern: /^agents\//,
    forbiddenLayers: ['game-systems'],
    description: 'Agent层禁止依赖业务层（组合根除外）'
  },
  {
    name: 'K→F',
    sourcePattern: /^session\//,
    forbiddenLayers: ['game-systems'],
    description: '会话层禁止依赖业务层'
  },
  {
    name: 'C→F',
    sourcePattern: /^schemas\//,
    forbiddenLayers: ['game-systems'],
    description: '验证层禁止依赖业务层'
  },
  // 阶段三新增（DF-033 修复）: G2 层依赖约束
  // 阶段四更新: G2 层目录从 orchestrators/ 改名为 programs/
  {
    name: 'G2→G+F',
    sourcePattern: /^programs\//,
    forbiddenLayers: ['agents', 'game-systems'],
    description: 'G2程序执行层禁止value import Agent层G和业务层F（仅允许type import端口接口）'
  },
  {
    name: 'G2→H',
    sourcePattern: /^programs\//,
    forbiddenLayers: [],
    forbiddenPackages: ['@ai-rpg/ai'],
    description: 'G2程序执行层禁止调用LLM（纯代码编排，零LLM依赖）'
  }
];

/**
 * 组合根允许清单：DI 装配点，必须 value import 具体类。
 * 设计 §3.8 v1.4 第 639 行确认"统一由 init.ts 组装后注入"。
 * - agents/init.ts: 主组合根，装配全局依赖
 * - agents/agent-deps.ts: AgentDeps 工厂，派生 EntityGraphUpdater 等具体类实例
 */
const COMPOSITION_ROOT_ALLOWLIST = new Set([
  'agents/init.ts',
  'agents/agent-deps.ts'
]);

const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'dist']);

/**
 * 递归遍历目录，收集所有 .ts 源文件（排除测试、声明文件）
 */
async function walkTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...await walkTsFiles(fullPath));
    } else if (entry.isFile()) {
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts')) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      files.push(fullPath);
    }
  }
  return files;
}

function toRelPath(absPath) {
  return relative(BACKEND_SRC, absPath).replace(/\\/g, '/');
}

/**
 * 解析 import 路径，返回相对于 BACKEND_SRC 的路径（若在 BACKEND_SRC 内）。
 * 仅处理相对路径（./ ../），裸包导入返回 null。
 */
function resolveImport(specifier, importerAbsPath) {
  if (!specifier.startsWith('.')) return null;
  const importerDir = dirname(importerAbsPath);
  const resolved = resolve(importerDir, specifier);
  const relPath = relative(BACKEND_SRC, resolved).replace(/\\/g, '/');
  if (relPath.startsWith('..')) return null;
  return relPath;
}

function extractLayer(relPath) {
  const slashIdx = relPath.indexOf('/');
  return slashIdx === -1 ? relPath : relPath.substring(0, slashIdx);
}

/**
 * 解析 TS 文件 AST，提取所有 import/export 依赖
 * @returns {Array<{ specifier: string, isTypeOnly: boolean, line: number, text: string }>}
 */
function parseImports(sourceFile) {
  const imports = [];

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        isTypeOnly: node.importClause?.isTypeOnly ?? false,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1,
        text: node.getText(sourceFile).replace(/\s+/g, ' ').trim()
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        isTypeOnly: node.isTypeOnly ?? false,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1,
        text: node.getText(sourceFile).replace(/\s+/g, ' ').trim()
      });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        imports.push({
          specifier: arg.text,
          isTypeOnly: false,
          line: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1,
          text: node.getText(sourceFile).replace(/\s+/g, ' ').trim()
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * 检测所有违规
 */
async function detectViolations() {
  const files = await walkTsFiles(BACKEND_SRC);
  const violations = [];
  const exemptedFiles = [];

  for (const filePath of files) {
    const relPath = toRelPath(filePath);
    const isExempted = COMPOSITION_ROOT_ALLOWLIST.has(relPath);

    const matchedRules = RULES.filter(r => r.sourcePattern.test(relPath));
    if (matchedRules.length === 0) continue;

    const forbiddenLayers = new Set(matchedRules.flatMap(r => r.forbiddenLayers));

    const content = await readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports = parseImports(sourceFile);

    let exemptCount = 0;
    for (const imp of imports) {
      // 检查内部层依赖（相对路径 import）
      const resolved = resolveImport(imp.specifier, filePath);
      if (resolved) {
        const targetLayer = extractLayer(resolved);
        if (forbiddenLayers.has(targetLayer)) {
          if (isExempted) {
            exemptCount++;
            continue;
          }
          const triggeredRule = matchedRules.find(r => r.forbiddenLayers?.includes(targetLayer));
          violations.push({
            file: relPath,
            line: imp.line,
            text: imp.text,
            isTypeOnly: imp.isTypeOnly,
            ruleName: triggeredRule.name,
            ruleDesc: triggeredRule.description,
            targetLayer
          });
          continue;
        }
      }

      // 检查外部裸包依赖（如 @ai-rpg/ai，G2→H 禁止 LLM 调用）
      // 裸包 import 一律视为 ERROR（type import 也禁止，G2→H 零 LLM 容忍）
      const forbiddenPackages = matchedRules.flatMap(r => r.forbiddenPackages || []);
      if (forbiddenPackages.length > 0) {
        const bareSpecifier = imp.specifier.split('/').slice(0, 2).join('/');
        if (forbiddenPackages.includes(bareSpecifier) || forbiddenPackages.includes(imp.specifier)) {
          if (isExempted) {
            exemptCount++;
            continue;
          }
          const triggeredRule = matchedRules.find(r => r.forbiddenPackages?.some(p => imp.specifier === p || bareSpecifier === p));
          violations.push({
            file: relPath,
            line: imp.line,
            text: imp.text,
            // G2→H 零容忍：type import 也视为 ERROR
            isTypeOnly: false,
            ruleName: triggeredRule.name,
            ruleDesc: triggeredRule.description,
            targetLayer: imp.specifier
          });
        }
      }
    }

    if (isExempted && exemptCount > 0) {
      exemptedFiles.push({ file: relPath, count: exemptCount });
    }
  }

  return { violations, exemptedFiles };
}

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';
const isTTY = process.stdout.isTTY;

function color(text, c) {
  return isTTY ? `${c}${text}${RESET}` : text;
}

function formatReport(violations, exemptedFiles, errorMode) {
  if (violations.length === 0) {
    const lines = [`${color('✓', GREEN)} 分层依赖检查通过，无违规`];
    if (exemptedFiles.length > 0) {
      for (const ex of exemptedFiles) {
        lines.push(`${color('豁免:', GRAY)} ${ex.file} (${ex.count} 处 import，组合根)`);
      }
    }
    return lines.join('\n');
  }

  const sorted = [...violations].sort((a, b) => {
    if (a.isTypeOnly !== b.isTypeOnly) return a.isTypeOnly ? 1 : -1;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  const errorCount = violations.filter(v => !v.isTypeOnly).length;
  const warningCount = violations.filter(v => v.isTypeOnly).length;

  const lines = [''];
  for (const v of sorted) {
    const severity = v.isTypeOnly ? 'WARNING' : 'ERROR';
    const severityColor = v.isTypeOnly ? YELLOW : RED;
    lines.push(`${color(`[${severity}]`, severityColor)}   ${v.file}:${v.line}`);
    lines.push(`          ${color('rule:', GRAY)} ${v.ruleName} (${v.ruleDesc})`);
    lines.push(`          ${color('import:', GRAY)} ${v.text}`);
    lines.push('');
  }

  lines.push(`${color('========== 汇总 ==========', CYAN)}`);
  lines.push(`${color('ERROR:', RED)}   ${errorCount} 个（value import 违规，error 模式会阻断构建）`);
  lines.push(`${color('WARNING:', YELLOW)} ${warningCount} 个（type-only 违规，不阻断构建）`);
  for (const ex of exemptedFiles) {
    lines.push(`${color('豁免:', GRAY)}    ${ex.file} (${ex.count} 处 import，组合根)`);
  }
  lines.push('');
  lines.push(`模式: ${errorMode ? color('error', RED) : color('warn', YELLOW)} (${errorMode ? '有 ERROR 则 exit 1' : 'exit 0'})`);

  return lines.join('\n');
}

async function main() {
  const errorMode = process.argv.includes('--error');
  const { violations, exemptedFiles } = await detectViolations();
  console.log(formatReport(violations, exemptedFiles, errorMode));

  if (violations.length === 0) {
    process.exit(0);
  }

  const errorCount = violations.filter(v => !v.isTypeOnly).length;
  if (errorMode && errorCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('分层依赖检查脚本执行失败:', err);
  process.exit(2);
});
