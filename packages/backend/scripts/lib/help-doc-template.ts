/**
 * HelpDocTemplate — ToolDocModel → markdown 文本（M7 模块）。
 *
 * frontmatter 生成规则（字段级所有权表）：
 * - 机器字段（始终重生成）：tool / method / description / paramTypes / returnType / since
 * - 条件机器字段：summary（代码有则重生成，代码无则保留现有文档值——代码不存在 summary 信息时
 *   删除手工策展内容属于破坏行为，视同 §9.5 动态字段降级处理）
 * - 手工字段（原样保留）：whenToUse / returnsSummary / 未知自定义字段
 * - description 等字符串统一 YAML 双引号包裹（修复值内 `: ` 内联冒号非法问题）
 * - 字段顺序固定：tool, method, description, summary, paramTypes, returnType, since,
 *   whenToUse, returnsSummary, ...未知字段（确定性输出，保证 --check 可重复）
 */

import yaml from 'js-yaml';
import type { MethodDoc, ParamDoc, ToolDocModel } from './tool-method-extractor.js';

/** 合并时从现有文档保留的手工字段 */
export interface PreservedManualFields {
  readonly whenToUse?: unknown;
  readonly returnsSummary?: unknown;
  /** 代码 summary 缺失时保留的现有 summary */
  readonly summary?: unknown;
  /** 代码 description 动态不可提取时保留的现有 description */
  readonly description?: unknown;
  /** 未知自定义字段（保持原文档顺序） */
  readonly unknownFields: ReadonlyArray<readonly [string, unknown]>;
}

/** YAML 双引号标量（转义反斜杠/引号/控制字符），确定性单行输出 */
export function escapeYamlDoubleQuoted(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** '2.0.0' → '2.0'；'1.0' → '1.0'；无法解析时原样返回 */
export function majorMinor(version: string): string {
  const parts = version.split('.');
  if (parts.length >= 2 && parts[0] !== '' && parts[1] !== '') {
    return `${parts[0]}.${parts[1]}`;
  }
  return version;
}

/**
 * 参数类型的签名级摘要（仅一层嵌套展开，§9.3）：
 * - array<object{locationId:string,locationName:string}>
 * - object{name:string,value:number}
 * - 完整结构留正文「参数详解」人工详述
 */
export function summarizeParamType(param: ParamDoc): string {
  if (param.type === 'array' && param.item) {
    return `array<${summarizeInline(param.item)}>`;
  }
  if (param.type === 'object' && param.children && param.children.length > 0) {
    return `object{${inlineProperties(param.children)}}`;
  }
  return param.type;
}

function summarizeInline(param: ParamDoc): string {
  if (param.type === 'object' && param.children && param.children.length > 0) {
    return `object{${inlineProperties(param.children)}}`;
  }
  if (param.type === 'array' && param.item) {
    return `array<${summarizeInline(param.item)}>`;
  }
  return param.type;
}

function inlineProperties(children: readonly ParamDoc[]): string {
  return children.map((child) => `${child.name}:${child.type}`).join(',');
}

/** paramTypes 值格式：`"type (required) - description"`（无描述时省略尾部） */
export function formatParamTypeValue(param: ParamDoc): string {
  const requirement = param.required ? 'required' : 'optional';
  const base = `${summarizeParamType(param)} (${requirement})`;
  return param.description ? `${base} - ${param.description}` : base;
}

/**
 * 渲染 frontmatter 区块（含首尾 `---` 行，不含结尾换行）。
 * preserved 中的手工字段按固定顺序附加在机器字段之后。
 */
export function renderFrontmatter(
  tool: ToolDocModel,
  method: MethodDoc,
  preserved: PreservedManualFields,
): string {
  const lines: string[] = ['---'];
  lines.push(`tool: ${tool.toolType}`);
  lines.push(`method: ${method.name}`);

  const description = method.description ?? asString(preserved.description);
  if (description !== undefined) {
    lines.push(`description: ${escapeYamlDoubleQuoted(description)}`);
  }

  const summary = method.summary ?? asString(preserved.summary);
  if (summary !== undefined) {
    lines.push(`summary: ${escapeYamlDoubleQuoted(summary)}`);
  }

  if (method.parameters.length > 0) {
    lines.push('paramTypes:');
    for (const param of method.parameters) {
      lines.push(`  ${param.name}: ${escapeYamlDoubleQuoted(formatParamTypeValue(param))}`);
    }
  }

  if (method.returnTypeName !== undefined) {
    lines.push(`returnType: ${escapeYamlDoubleQuoted(method.returnTypeName)}`);
  }

  lines.push(`since: ${escapeYamlDoubleQuoted(majorMinor(tool.toolVersion))}`);

  if (preserved.whenToUse !== undefined) {
    lines.push(dumpManualField('whenToUse', preserved.whenToUse));
  }
  if (preserved.returnsSummary !== undefined) {
    lines.push(dumpManualField('returnsSummary', preserved.returnsSummary));
  }
  for (const [key, value] of preserved.unknownFields) {
    lines.push(dumpManualField(key, value));
  }

  lines.push('---');
  return lines.join('\n');
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * 手工字段用 js-yaml 序列化（块列表风格与现语料一致），返回去掉末尾换行的片段。
 * 数组值的 `- ` 序列项缩进 2 空格（js-yaml 顶层 key 的序列默认顶格，
 * 现语料如 submit_dialogue.md 的 whenToUse 用 2 空格缩进块列表，需对齐）。
 */
function dumpManualField(key: string, value: unknown): string {
  const dumped = yaml
    .dump({ [key]: value }, { schema: yaml.JSON_SCHEMA, noRefs: true, lineWidth: -1 })
    .replace(/\n$/, '');
  if (!Array.isArray(value)) return dumped;
  return dumped
    .split('\n')
    .map((line, index) => (index > 0 && line.startsWith('- ') ? `  ${line}` : line))
    .join('\n');
}

/**
 * 新文件完整内容（机器字段 frontmatter + 正文骨架）。
 * 正文骨架中的「（待补充）」是面向人工文档作者的提示占位，不是代码 stub。
 */
export function renderNewDocument(tool: ToolDocModel, method: MethodDoc): string {
  const frontmatter = renderFrontmatter(tool, method, { unknownFields: [] });
  const description = method.description ?? '（待补充）';
  const body: string[] = [
    `# ${tool.toolType}.${method.name}`,
    '',
    '<!-- @manual: 本文件 frontmatter 由 generate-agent-help 自动维护，正文由人工维护 -->',
    '<!-- 如需完全手工维护 frontmatter，在正文任意处添加 <!-- @manual-frontmatter --> 标记 -->',
    '',
    '## 功能',
    description,
    '',
    '## 参数详解',
    ...renderParameterSkeleton(method),
    '',
    '## 返回值',
    '（待补充）',
    '',
    '## 注意事项',
    '（待补充）',
    '',
  ];
  return `${frontmatter}\n\n${body.join('\n')}`;
}

function renderParameterSkeleton(method: MethodDoc): string[] {
  if (method.parameters.length === 0) {
    return ['（无参数）'];
  }
  const lines = [
    '| 参数 | 类型 | 必填 | 说明 |',
    '|------|------|------|------|',
  ];
  for (const param of method.parameters) {
    lines.push(
      `| ${param.name} | ${summarizeParamType(param)} | ${param.required ? '是' : '否'} | ${param.description ?? '（待补充）'} |`,
    );
  }
  return lines;
}

/**
 * 现有文档合并渲染（§9.2/§9.4）：机器字段重生成 + 手工字段保留 + 正文字节级保留。
 *
 * 返回格式与 renderNewDocument 一致（frontmatter 与正文之间空一行），
 * 保证 --check 可重复（确定性输出）。body 原样拼接，不做 trim/重排。
 * 结尾统一补单个换行（parseFrontmatter 对 body trim，EOF 换行不参与 byte-compare，
 * 但落盘文件保持 POSIX 文本约定，避免 EOF-newline 抖动导致重复 updated）。
 */
export function renderMergedDocument(
  tool: ToolDocModel,
  method: MethodDoc,
  preserved: PreservedManualFields,
  body: string,
): string {
  const content = `${renderFrontmatter(tool, method, preserved)}\n\n${body}`;
  return content.endsWith('\n') ? content : `${content}\n`;
}
