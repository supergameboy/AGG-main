/**
 * HelpDocSync — 与现有 agent-help 文档字段级合并 + 漂移报告（M7 模块，§6.5/§9.2）。
 *
 * 字段级所有权表（§6.4）：
 * - 机器字段（tool/method/description/summary/paramTypes/returnType/since）：始终由代码重生成
 * - 手工字段（whenToUse/returnsSummary/未知自定义字段）：从现有文档解析后原样回写
 * - 正文 body：字节级保留，生成器永不修改已存在文件的正文
 *
 * 失败场景（§七 失败场景覆盖表 #4/#6）：
 * - 现有文档 frontmatter YAML 损坏 → errorCount+1 + 跳过该文件（不覆盖，防误删手工内容）
 * - 正文含 <!-- @manual-frontmatter --> → 跳过重生成，计入 manualSkipped（--check 不算失败）
 * - 现有文档无 frontmatter → 视为全手工正文，前置插入生成的 frontmatter（正文保留）
 * - 孤立文档（文档存在但代码无对应方法）→ --check 记 errorCount+1；--write 保留+报告；
 *   --write --prune 显式删除（删除是人的决策，默认仅报告）
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  FrontmatterError,
  parseFrontmatter,
} from '../../src/game-systems/shared/frontmatter/index.js';
import type { MethodDoc, ToolDocModel } from './tool-method-extractor.js';
import {
  renderMergedDocument,
  renderNewDocument,
  type PreservedManualFields,
} from './help-doc-template.js';

/**
 * 逃逸舱标记：正文中独立一行的 `<!-- @manual-frontmatter -->` HTML 注释。
 * 必须是独立注释行（行首可含空白，注释后行尾仅允许空白）——
 * 新文件骨架里的说明文字「添加 <!-- @manual-frontmatter --> 标记」嵌在更长的注释里，
 * 不构成独立标记行，不能触发逃逸舱（否则每次 --write 的新文件第二次跑都会被误判为手工接管）。
 */
const MANUAL_FRONTMATTER_PATTERN = /^[ \t]*<!--\s*@manual-frontmatter\s*-->[ \t]*$/m;

export interface HelpDocSyncReport {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly unchanged: readonly string[];
  readonly orphaned: readonly string[];
  readonly manualSkipped: readonly string[];
  readonly dynamicWarnings: ReadonlyArray<{ readonly file: string; readonly warning: string }>;
  readonly errors: readonly string[];
  /** --check 失败判定依据：孤立文档 + 损坏 frontmatter 文档数 */
  readonly errorCount: number;
}

export interface HelpDocSyncOptions {
  readonly mode: 'write' | 'check' | 'diff';
  readonly helpDir: string;
  readonly serviceFilter?: string;
  readonly prune?: boolean;
}

interface MethodTarget {
  readonly tool: ToolDocModel;
  readonly method: MethodDoc;
  readonly absolutePath: string;
  readonly relativePath: string;
}

/** 内部可变累积器，函数返回前转为 readonly 报告 */
class ReportBuilder {
  readonly created: string[] = [];
  readonly updated: string[] = [];
  readonly unchanged: string[] = [];
  readonly orphaned: string[] = [];
  readonly manualSkipped: string[] = [];
  readonly dynamicWarnings: { file: string; warning: string }[] = [];
  readonly errors: string[] = [];

  build(): HelpDocSyncReport {
    const sort = (items: string[]) => [...items].sort();
    return {
      created: sort(this.created),
      updated: sort(this.updated),
      unchanged: sort(this.unchanged),
      orphaned: sort(this.orphaned),
      manualSkipped: sort(this.manualSkipped),
      dynamicWarnings: [...this.dynamicWarnings].sort((a, b) => a.file.localeCompare(b.file)),
      errors: [...this.errors].sort(),
      errorCount: this.orphaned.length + this.errors.length,
    };
  }
}

/**
 * 同步 agent-help 文档（§6.5 接口契约）。
 *
 * 编排流程：
 * 1. 展开 models → (toolType, method) → 目标文件清单（serviceFilter 过滤）
 * 2. 逐目标文件合并（不存在 → created；存在 → 机器字段更新 + 手工保留 + 正文保留）
 * 3. 反向遍历 helpDir 全部 .md，无对应方法的 → orphaned（--prune 时删除）
 * 4. mode === 'write' 时仅落盘 created/updated（unchanged 不写，避免 mtime/git 噪音）
 */
export function syncHelpDocs(models: readonly ToolDocModel[], options: HelpDocSyncOptions): HelpDocSyncReport {
  const report = new ReportBuilder();
  const targets = collectTargets(models, options, report);
  const expectedKeys = new Set(targets.map((target) => targetKey(target.tool.toolType, target.method.name)));

  for (const target of targets) {
    syncTarget(target, options, report);
  }

  syncOrphans(options.helpDir, expectedKeys, options, report);

  return report.build();
}

function collectTargets(
  models: readonly ToolDocModel[],
  options: HelpDocSyncOptions,
  report: ReportBuilder,
): MethodTarget[] {
  const targets: MethodTarget[] = [];
  for (const tool of models) {
    if (options.serviceFilter !== undefined && tool.toolType !== options.serviceFilter) continue;
    for (const warning of tool.dynamicWarnings) {
      report.dynamicWarnings.push({ file: tool.sourceFile, warning });
    }
    for (const method of tool.methods) {
      const relativePath = `${tool.toolType}/${method.name}.md`;
      targets.push({
        tool,
        method,
        absolutePath: path.join(options.helpDir, tool.toolType, `${method.name}.md`),
        relativePath,
      });
    }
  }
  return targets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function syncTarget(target: MethodTarget, options: HelpDocSyncOptions, report: ReportBuilder): void {
  const { tool, method, absolutePath, relativePath } = target;

  if (!fs.existsSync(absolutePath)) {
    report.created.push(relativePath);
    if (options.mode === 'write') {
      writeFile(absolutePath, renderNewDocument(tool, method));
    }
    return;
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');

  // 逃逸舱（§6.4）：手工接管整个 frontmatter，机器字段漂移不阻断（manualSkipped 仅提示）。
  // 仅匹配正文中独立一行的 <!-- @manual-frontmatter --> 注释，
  // 不匹配新文件骨架里「添加 <!-- @manual-frontmatter --> 标记」这类说明文字。
  if (MANUAL_FRONTMATTER_PATTERN.test(raw)) {
    report.manualSkipped.push(relativePath);
    return;
  }

  const doc = parseExistingDocument(raw, relativePath, report);
  if (doc === undefined) return;

  const merged = renderMergedDocument(tool, method, pickPreservedFields(doc.attributes, method), doc.body);
  if (merged === normalizeLineEndings(raw)) {
    report.unchanged.push(relativePath);
    return;
  }

  report.updated.push(relativePath);
  if (options.mode === 'write') {
    writeFile(absolutePath, merged);
  }
}

interface ExistingDocument {
  readonly attributes: Record<string, unknown>;
  readonly body: string;
}

/**
 * 解析现有文档（统一 Parser，非正则替换，§6.4-1）。
 * 损坏文档计入 errors 并跳过（不覆盖，防误删手工内容，§七 #4）。
 * 无 frontmatter 的文档视为全手工正文（§七 #4 edge：前置插入生成的 frontmatter，正文保留）。
 */
function parseExistingDocument(
  raw: string,
  relativePath: string,
  report: ReportBuilder,
): ExistingDocument | undefined {
  try {
    const doc = parseFrontmatter(raw, { filePath: relativePath });
    return { attributes: doc.attributes, body: doc.body };
  } catch (error) {
    if (error instanceof FrontmatterError) {
      report.errors.push(`${relativePath}: ${error.message}`);
      return undefined;
    }
    throw error;
  }
}

const KNOWN_MANUAL_FIELDS = new Set(['whenToUse', 'returnsSummary']);
const OWNED_BY_GENERATOR = new Set([
  'tool',
  'method',
  'description',
  'summary',
  'paramTypes',
  'returnType',
  'since',
]);

/**
 * 从现有文档 attributes 提取需保留的手工字段（§6.4 字段级所有权表）。
 * 保留基于解析后结构化数据回写（非文本切片），字段顺序由 renderFrontmatter 固定。
 */
function pickPreservedFields(attributes: Record<string, unknown>, method: MethodDoc): PreservedManualFields {
  const unknownFields: Array<readonly [string, unknown]> = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (KNOWN_MANUAL_FIELDS.has(key) || OWNED_BY_GENERATOR.has(key)) continue;
    unknownFields.push([key, value]);
  }
  return {
    whenToUse: attributes.whenToUse,
    returnsSummary: attributes.returnsSummary,
    // 代码 summary/description 动态缺失时保留现有值（§9.5 降级策略）
    summary: method.summary === undefined ? attributes.summary : undefined,
    description: method.description === undefined ? attributes.description : undefined,
    unknownFields,
  };
}

function syncOrphans(
  helpDir: string,
  expectedKeys: ReadonlySet<string>,
  options: HelpDocSyncOptions,
  report: ReportBuilder,
): void {
  if (!fs.existsSync(helpDir)) return;
  for (const relativePath of walkMarkdownFiles(helpDir)) {
    if (options.serviceFilter !== undefined && !relativePath.startsWith(`${options.serviceFilter}/`)) continue;
    const parsed = relativePath.replace(/\.md$/, '').split('/');
    const key = parsed.length === 2 ? targetKey(parsed[0]!, parsed[1]!) : undefined;
    if (key !== undefined && expectedKeys.has(key)) continue;

    report.orphaned.push(relativePath);
    if (options.mode === 'write' && options.prune === true) {
      fs.unlinkSync(path.join(helpDir, relativePath));
    }
  }
}

function walkMarkdownFiles(dir: string): string[] {
  const collected: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relativeName = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relativeName);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        collected.push(relativeName);
      }
    }
  };
  walk(dir, '');
  return collected.sort();
}

function targetKey(toolType: string, methodName: string): string {
  return `${toolType}/${methodName}`;
}

function writeFile(absolutePath: string, content: string): void {
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
