/**
 * 统一 frontmatter 解析设施（架构规范 §十 跨层共享模块）。
 *
 * 替代 skill-registry / help-registry / rules-engine 三处复制粘贴的手写解析器，
 * 用 js-yaml（JSON_SCHEMA，与 ConfigLoader 对齐）替代手写逐行解析，修复：
 * - paramTypes 嵌套 map 被压扁成顶层幽灵键的静默数据损坏
 * - hook: null 被解析为字符串 "null" 的隐性缺陷
 * - 重复键后者静默覆盖前者
 */

import yaml from 'js-yaml';

/** frontmatter 文档抽象：attributes（解析后属性）+ body（正文）+ rawFrontmatter（原始 YAML 文本） */
export interface FrontmatterDocument<TAttributes extends Record<string, unknown> = Record<string, unknown>> {
  /** YAML 解析后的属性对象；无 frontmatter 时为 {} */
  readonly attributes: TAttributes;
  /** frontmatter 之后的正文（trim 后）；无 frontmatter 时为全文 */
  readonly body: string;
  /** 原始 YAML 文本（不含 --- 分隔符）；无 frontmatter 时为空字符串。供生成器做字段级合并 */
  readonly rawFrontmatter: string;
  /** 是否存在 frontmatter 区块 */
  readonly hasFrontmatter: boolean;
}

export interface FrontmatterParseOptions {
  /** 文件路径，仅用于错误消息定位（不读取文件） */
  readonly filePath?: string;
  /**
   * true 时缺失 frontmatter 抛 FrontmatterError(MISSING_FRONTMATTER)；
   * 默认 false：返回 hasFrontmatter=false 的文档（消费方按 warn+skip 语义处理，保持三 registry 现状）。
   */
  readonly requireFrontmatter?: boolean;
}

export type FrontmatterErrorCode =
  | 'MISSING_FRONTMATTER' // requireFrontmatter=true 但无 frontmatter 区块
  | 'YAML_SYNTAX_ERROR' // js-yaml 解析失败（含行号/列号）
  | 'NON_OBJECT_FRONTMATTER' // frontmatter 解析结果不是 plain object（如字符串/数组/标量）
  | 'SCHEMA_VALIDATION_FAILED'; // schema 校验失败（由 frontmatter-schema.ts 抛出）

export class FrontmatterError extends Error {
  readonly code: FrontmatterErrorCode;
  readonly filePath?: string;
  /** YAML 错误行号（相对 frontmatter 区块，1 起始）；非 YAML 错误为 undefined */
  readonly line?: number;
  /** YAML 错误列号（1 起始） */
  readonly column?: number;

  constructor(
    code: FrontmatterErrorCode,
    message: string,
    options?: { filePath?: string; line?: number; column?: number },
  ) {
    super(message);
    this.name = 'FrontmatterError';
    this.code = code;
    this.filePath = options?.filePath;
    this.line = options?.line;
    this.column = options?.column;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatLocation(filePath?: string): string {
  return filePath ? ` in ${filePath}` : '';
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * 解析 markdown 文本的 frontmatter。
 *
 * 行为契约：
 * - BOM 前缀剔除，CRLF/CR 规范化为 LF 后解析
 * - frontmatter 区块界定：文档以 `---` 起始，到下一个 `\n---` 结束（indexOf 策略，
 *   允许结尾 `---` 后无换行 / 文档仅含 frontmatter）
 * - YAML 解析：`yaml.load(yamlText, { schema: yaml.JSON_SCHEMA })`
 *   - JSON_SCHEMA：与 ConfigLoader 一致，避免 YAML 1.1 的 yes/no/on/off 被转 boolean
 *   - 不使用 json: true——js-yaml 默认（json: false）重复键抛错，json: true 反而放松为覆盖
 * - 解析结果为 null/undefined（空 frontmatter）→ attributes = {}
 * - 解析结果非 plain object → 抛 NON_OBJECT_FRONTMATTER
 * - `---` 起始但无结束 `---` → 按缺失处理（requireFrontmatter 语义同上）
 */
export function parseFrontmatter(
  content: string,
  options?: FrontmatterParseOptions,
): FrontmatterDocument {
  const filePath = options?.filePath;
  const normalized = stripBom(content)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const endIndex = normalized.startsWith('---') ? normalized.indexOf('\n---', 3) : -1;
  if (endIndex === -1) {
    if (options?.requireFrontmatter) {
      throw new FrontmatterError(
        'MISSING_FRONTMATTER',
        `Missing frontmatter${formatLocation(filePath)}: document does not start with a --- delimited block`,
        { filePath },
      );
    }
    return { attributes: {}, body: normalized.trim(), rawFrontmatter: '', hasFrontmatter: false };
  }

  const rawFrontmatter = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 4).trim();

  let parsed: unknown;
  try {
    parsed = yaml.load(rawFrontmatter, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    if (error instanceof yaml.YAMLException) {
      throw new FrontmatterError(
        'YAML_SYNTAX_ERROR',
        `Invalid YAML frontmatter${formatLocation(filePath)}: ${error.message}`,
        {
          filePath,
          line: error.mark ? error.mark.line + 1 : undefined,
          column: error.mark ? error.mark.column + 1 : undefined,
        },
      );
    }
    throw error;
  }

  if (parsed === null || parsed === undefined) {
    return { attributes: {}, body, rawFrontmatter, hasFrontmatter: true };
  }
  if (!isPlainObject(parsed)) {
    const received = Array.isArray(parsed) ? 'array' : typeof parsed;
    throw new FrontmatterError(
      'NON_OBJECT_FRONTMATTER',
      `Frontmatter must be a mapping${formatLocation(filePath)}, received ${received}`,
      { filePath },
    );
  }

  return { attributes: parsed, body, rawFrontmatter, hasFrontmatter: true };
}
