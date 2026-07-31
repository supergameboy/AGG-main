/**
 * generate-agent-help — agent-help 文档生成器 CLI 入口（M7 模块，§6.6）。
 *
 * 用法（packages/backend 下）：
 *   tsx scripts/generate-agent-help.ts --write                          # 全量同步（仅内容变化的文件落盘）
 *   tsx scripts/generate-agent-help.ts --check                          # CI 模式：任何漂移退出码 1
 *   tsx scripts/generate-agent-help.ts --diff                           # 打印 drift 文件的 diff，不落盘
 *   tsx scripts/generate-agent-help.ts --write --service map_service    # 单 service 同步
 *   tsx scripts/generate-agent-help.ts --write --prune                  # 同步并删除孤立文档
 *   tsx scripts/generate-agent-help.ts --help
 *
 * 退出码（§七 失败场景覆盖表 #7）：
 *   0 — 无漂移（check）或同步成功（write/diff）
 *   1 — 存在漂移（check 模式：created/updated/orphaned/errors 任一非空）
 *   2 — 用法/环境错误（扫描根不存在、--service 不存在、参数互斥）
 *
 * 数据源：全量发现（决策 5）扫描 src 下全部 BaseTool 子类，excludeTools 黑名单默认排除
 * audit_service（内部工具，无 agent-facing help 文档需求）；--include 可显式追加排除项。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectToolSourceFiles, extractToolDocModels } from './lib/tool-method-extractor.js';
import { syncHelpDocs, type HelpDocSyncReport } from './lib/help-doc-sync.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..');
const SRC_DIR = path.join(PACKAGE_ROOT, 'src');
const HELP_DIR = path.join(PACKAGE_ROOT, 'config', 'agent-help');

/** 决策 5：默认排除的内部工具（无 agent-facing help 文档） */
const DEFAULT_EXCLUDE_TOOLS: readonly string[] = ['audit_service'];

interface CliArgs {
  readonly mode: 'write' | 'check' | 'diff';
  readonly serviceFilter?: string;
  readonly prune: boolean;
  readonly excludeTools: readonly string[];
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = new Set(argv);
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const write = args.has('--write');
  const check = args.has('--check');
  const diff = args.has('--diff');
  const help = args.has('--help') || args.has('-h');
  const prune = args.has('--prune');
  const serviceFilter = get('--service');
  const includeRaw = get('--include');

  const modeCount = [write, check, diff].filter(Boolean).length;
  if (!help && modeCount !== 1) {
    throw new UsageError(`必须且只能指定 --write / --check / --diff 之一（当前 ${modeCount} 个）`);
  }
  if (prune && !write) {
    throw new UsageError('--prune 仅可与 --write 组合使用');
  }

  return {
    mode: write ? 'write' : check ? 'check' : 'diff',
    serviceFilter,
    prune,
    excludeTools: includeRaw === undefined
      ? DEFAULT_EXCLUDE_TOOLS
      : [...DEFAULT_EXCLUDE_TOOLS, ...includeRaw.split(',').map((item) => item.trim()).filter(Boolean)],
    help,
  };
}

class UsageError extends Error {}

function printUsage(): void {
  console.log(`generate-agent-help — agent-help 文档生成器

用法:
  tsx scripts/generate-agent-help.ts --write                 全量同步（仅内容变化的文件落盘）
  tsx scripts/generate-agent-help.ts --check                 CI 模式：任何漂移退出码 1
  tsx scripts/generate-agent-help.ts --diff                  打印 drift 文件的 diff，不落盘
  tsx scripts/generate-agent-help.ts --write --service <toolType>   单 service 同步
  tsx scripts/generate-agent-help.ts --write --prune         同步并删除孤立文档
  tsx scripts/generate-agent-help.ts --write --include <a,b> 追加排除工具（默认已排除 ${DEFAULT_EXCLUDE_TOOLS.join(',')}）

退出码: 0=无漂移/成功  1=存在漂移  2=用法或环境错误`);
}

function printReport(report: HelpDocSyncReport, mode: CliArgs['mode']): void {
  const sections: Array<[string, readonly string[]]> = [
    ['created  （文档缺失，代码有方法）', report.created],
    ['updated  （机器字段漂移）', report.updated],
    ['orphaned （文档存在，代码无方法）', report.orphaned],
    ['manualSkipped（@manual-frontmatter 手工接管）', report.manualSkipped],
    ['errors   （frontmatter 损坏，已跳过未覆盖）', report.errors],
  ];
  for (const [label, items] of sections) {
    if (items.length === 0) continue;
    console.log(`\n${label}: ${items.length}`);
    for (const item of items) console.log(`  ${item}`);
  }
  if (report.dynamicWarnings.length > 0) {
    console.log(`\ndynamicWarnings（非静态字段，已保留现有值，需人工确认）: ${report.dynamicWarnings.length}`);
    for (const warning of report.dynamicWarnings) {
      console.log(`  ${warning.file}: ${warning.warning}`);
    }
  }
  console.log(
    `\n汇总: created=${report.created.length} updated=${report.updated.length} unchanged=${report.unchanged.length} `
    + `orphaned=${report.orphaned.length} manualSkipped=${report.manualSkipped.length} `
    + `errors=${report.errors.length} errorCount=${report.errorCount} mode=${mode}`,
  );
}

function printDiff(report: HelpDocSyncReport, helpDir: string): void {
  const driftFiles = [...report.created, ...report.updated];
  if (driftFiles.length === 0) {
    console.log('（无 drift 文件）');
    return;
  }
  for (const relativePath of driftFiles.sort()) {
    const absolutePath = path.join(helpDir, relativePath);
    const exists = fs.existsSync(absolutePath);
    console.log(`\n${'='.repeat(72)}\n${relativePath}  ${exists ? '[updated]' : '[created]'}\n${'='.repeat(72)}`);
    if (exists) {
      console.log('--- 现有 frontmatter ---');
      const raw = fs.readFileSync(absolutePath, 'utf8');
      const end = raw.indexOf('\n---', 3);
      console.log(end >= 0 ? raw.slice(0, end + 4) : raw.slice(0, 400));
    } else {
      console.log('（新文件，将生成完整骨架）');
    }
  }
  console.log('\n提示: --diff 仅打印漂移文件清单与现有 frontmatter 片段；完整合并结果用 --write 后 git diff 查看。');
}

function main(): number {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`用法错误: ${error.message}\n`);
      printUsage();
      return 2;
    }
    throw error;
  }
  if (args.help) {
    printUsage();
    return 0;
  }

  if (!fs.existsSync(SRC_DIR)) {
    console.error(`扫描根不存在: ${SRC_DIR}`);
    return 2;
  }

  const files = collectToolSourceFiles(SRC_DIR);
  const models = extractToolDocModels(files, PACKAGE_ROOT)
    .filter((model) => !args.excludeTools.includes(model.toolType));

  if (args.serviceFilter !== undefined && !models.some((model) => model.toolType === args.serviceFilter)) {
    console.error(`--service 指定的 toolType 不存在: ${args.serviceFilter}`);
    console.error(`可用: ${models.map((model) => model.toolType).join(', ')}`);
    return 2;
  }

  const report = syncHelpDocs(models, {
    mode: args.mode,
    helpDir: HELP_DIR,
    serviceFilter: args.serviceFilter,
    prune: args.prune,
  });

  printReport(report, args.mode);
  if (args.mode === 'diff') {
    printDiff(report, HELP_DIR);
  }

  if (args.mode === 'check') {
    const driftCount = report.created.length + report.updated.length + report.errorCount;
    if (driftCount > 0 || report.errorCount > 0) {
      console.error(`\n--check 失败: ${driftCount} 项漂移（含 errorCount=${report.errorCount}）`);
      return 1;
    }
  }
  return 0;
}

process.exitCode = main();
