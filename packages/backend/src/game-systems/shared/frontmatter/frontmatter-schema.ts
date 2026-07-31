/**
 * skill / rule / help 三种文档的 zod schema + parseAndValidate 组合入口。
 *
 * 替代三 registry 的手写 validateFrontmatter（含 rules-engine 的 normalizeHook），
 * 校验失败抛 FrontmatterValidationError（多字段错误 issues 全量返回，非遇首个即抛）。
 *
 * 未知字段策略：passthrough 宽松保留——agent-help 是「代码镜像 + 手工策展」混合文档，
 * 未来新增手工字段不应被 schema 拒绝（与现状手写校验器行为一致：只查必填，不拒未知）。
 */

import { z } from 'zod';
import {
  FrontmatterError,
  parseFrontmatter,
  type FrontmatterDocument,
  type FrontmatterParseOptions,
} from './frontmatter-parser.js';

// ─── Skill（对齐原 skill-registry.ts ValidatedSkillFrontmatter） ───

export const skillFrontmatterSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    description: z.string().min(1, 'description is required'),
    targetAgent: z.array(z.string()).min(1, 'targetAgent is required and must be non-empty array'),
    trigger: z.array(z.string()).default([]),
    whenToUse: z.string().min(1, 'whenToUse is required'),
    recommendedTools: z.array(z.string()).default([]),
    relatedRules: z.array(z.string()).default([]),
    completionCriteria: z.string().min(1, 'completionCriteria is required'),
    version: z.string().default('1.0'),
    enabled: z.boolean().default(true),
  })
  .passthrough();
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

// ─── Rule（对齐原 rules-engine.ts ValidatedRuleFrontmatter + normalizeHook） ───

export const ruleFrontmatterSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    alwaysApply: z.boolean({ message: 'alwaysApply is required and must be boolean' }),
    // 替代 normalizeHook：string → [string]；null/undefined → []
    hook: z
      .union([z.string(), z.array(z.string()), z.null(), z.undefined()])
      .transform((value): string[] => {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
      })
      .default([]),
    targetAgent: z.array(z.string()).min(1, 'targetAgent is required and must be non-empty array'),
    description: z.string().min(1, 'description is required'),
    priority: z.number().default(0),
    enabled: z.boolean().default(true),
  })
  .passthrough();
export type RuleFrontmatter = z.infer<typeof ruleFrontmatterSchema>;

// ─── Help（对齐原 help-registry.ts ValidatedHelpFrontmatter） ───

export const helpFrontmatterSchema = z
  .object({
    tool: z.string().min(1, 'tool is required'),
    method: z.string().min(1, 'method is required'),
    description: z.string().min(1, 'description is required'),
    summary: z.string().optional(),
    whenToUse: z.array(z.string()).optional(),
    returnsSummary: z.string().optional(),
    // 嵌套 map：统一 Parser 修复手写解析器压扁嵌套键后首次真正生效
    paramTypes: z.record(z.string(), z.string()).optional(),
    returnType: z.string().optional(),
    since: z.string().optional(),
  })
  .passthrough();
export type HelpFrontmatter = z.infer<typeof helpFrontmatterSchema>;

// ─── 校验错误 ───

export interface FrontmatterIssue {
  /** 字段路径，如 'targetAgent' 或 'paramTypes.locations' */
  readonly path: string;
  /** 人类可读消息，如 'targetAgent is required and must be non-empty array' */
  readonly message: string;
  /** 期望类型/约束描述（从 zod issue 推导），如 'array' */
  readonly expected?: string;
  /** 实际值摘要（截断 80 字符） */
  readonly received?: string;
}

export class FrontmatterValidationError extends FrontmatterError {
  readonly issues: readonly FrontmatterIssue[];

  constructor(filePath: string | undefined, issues: readonly FrontmatterIssue[]) {
    const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    super('SCHEMA_VALIDATION_FAILED', `Invalid frontmatter in ${filePath ?? '(unknown file)'}: ${detail}`, {
      filePath,
    });
    this.name = 'FrontmatterValidationError';
    this.issues = issues;
  }
}

type ZodIssueLike = z.ZodError['issues'][number];

function toFrontmatterIssue(issue: ZodIssueLike, attributes: Record<string, unknown>): FrontmatterIssue {
  return {
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message,
    expected: 'expected' in issue && typeof issue.expected === 'string' ? issue.expected : undefined,
    // zod v4 嵌套对象 issue 不携带 input，从原 attributes 按路径取实际值
    received: summarizeReceived(issue.input ?? getValueAtPath(attributes, issue.path)),
  };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function getValueAtPath(source: Record<string, unknown>, path: readonly PropertyKey[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function summarizeReceived(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return serialized.length > 80 ? `${serialized.slice(0, 77)}...` : serialized;
}

// ─── 组合入口 ───

/**
 * parseFrontmatter + schema 校验一步完成。
 * 校验失败抛 FrontmatterValidationError；解析失败抛 FrontmatterError。
 * schema 校验通过时 attributes 为 z.infer<TSchema>（默认值已填充，类型精确，零 as 断言）。
 */
export function parseAndValidate<TSchema extends z.ZodType<Record<string, unknown>>>(
  content: string,
  schema: TSchema,
  options?: FrontmatterParseOptions,
): FrontmatterDocument<z.output<TSchema>> {
  const document = parseFrontmatter(content, options);
  const validated = validateAttributes(document.attributes, schema, options?.filePath);
  return {
    attributes: validated,
    body: document.body,
    rawFrontmatter: document.rawFrontmatter,
    hasFrontmatter: document.hasFrontmatter,
  };
}

/** 仅校验已解析的 attributes（生成器字段级合并时复用） */
export function validateAttributes<TSchema extends z.ZodType<Record<string, unknown>>>(
  attributes: Record<string, unknown>,
  schema: TSchema,
  filePath?: string,
): z.output<TSchema> {
  const result = schema.safeParse(attributes);
  if (!result.success) {
    throw new FrontmatterValidationError(
      filePath,
      result.error.issues.map((issue) => toFrontmatterIssue(issue, attributes)),
    );
  }
  return result.data;
}
