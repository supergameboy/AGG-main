/**
 * 统一 frontmatter 设施桶导出（解析 + schema 校验）。
 * 仅导出本模块内容，禁止跨层桶导出（架构规范 3.2 桶导出禁令）。
 */

export type {
  FrontmatterDocument,
  FrontmatterParseOptions,
  FrontmatterErrorCode,
} from './frontmatter-parser.js';
export { FrontmatterError, parseFrontmatter } from './frontmatter-parser.js';

export {
  skillFrontmatterSchema,
  ruleFrontmatterSchema,
  helpFrontmatterSchema,
  FrontmatterValidationError,
  parseAndValidate,
  validateAttributes,
} from './frontmatter-schema.js';
export type {
  SkillFrontmatter,
  RuleFrontmatter,
  HelpFrontmatter,
  FrontmatterIssue,
} from './frontmatter-schema.js';
