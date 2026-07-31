import { logger } from './logger.js';
import { jsonrepair as jsonRepairLib } from 'jsonrepair';

const SNAKE_CASE_RE = /^[a-z]+(_[a-z0-9]+)+$/;

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function normalizeKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalizeKeys);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      const normalizedKey = SNAKE_CASE_RE.test(key) ? snakeToCamel(key) : key;
      result[normalizedKey] = normalizeKeys(record[key]);
    }
    return result;
  }
  return value;
}

export function extractJSONFromContent(content: string): string {
  let trimmed = content.trim();

  const uiSeparatorIndex = trimmed.indexOf('---UI---');
  if (uiSeparatorIndex !== -1) {
    trimmed = trimmed.substring(0, uiSeparatorIndex).trim();
  }

  // 移除 markdown 属性语法 {: .class-name } 或 {: #id-name }
  trimmed = trimmed.replace(/\{:\s*[.#][^}]*\}\s*/g, '').trim();

  // 剥离多行 :::组件语法 块（:::ComponentName\n...\n:::）
  trimmed = trimmed.replace(/:::\w+\s*\n[\s\S]*?\n:::/g, '').trim();

  // 剥离单行 :::组件语法 声明（:::ComponentName{prop="val"}）
  const mdComponentRegex = /:::\w+\{[^}]*\}\s*\n?/g;
  if (mdComponentRegex.test(trimmed)) {
    trimmed = trimmed.replace(/:::\w+\{[^}]*\}\s*\n?/g, '').trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      const jsonStart = trimmed.indexOf('{');
      const jsonStartArr = trimmed.indexOf('[');
      if (jsonStart === -1 && jsonStartArr === -1) {
        return '';
      }
    }
  }

  const allCodeBlocks = [...trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
  if (allCodeBlocks.length > 1) {
    const lastBlock = allCodeBlocks[allCodeBlocks.length - 1];
    const lastContent = lastBlock[1].trim();
    if (lastContent.startsWith('{') || lastContent.startsWith('[')) {
      return lastContent;
    }
  }

  const greedyMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*)\n?\s*```/);
  if (greedyMatch) {
    const inner = greedyMatch[1].trim();
    if (inner.startsWith('{') || inner.startsWith('[')) {
      return inner;
    }
  }

  const openOnlyMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*)/);
  if (openOnlyMatch) {
    let inner = openOnlyMatch[1].trim();
    if (inner.startsWith('{') || inner.startsWith('[')) {
      // 截取到最后一个结构闭合符，去除 JSON 后面的垃圾文本
      const lastClose = findLastStructuralClose(inner);
      if (lastClose !== -1) {
        inner = inner.substring(0, lastClose + 1);
      }
      return inner;
    }
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  const jsonStart = trimmed.indexOf('{');
  const jsonStartArr = trimmed.indexOf('[');
  let start = -1;
  if (jsonStart !== -1 && jsonStartArr !== -1) {
    start = Math.min(jsonStart, jsonStartArr);
  } else if (jsonStart !== -1) {
    start = jsonStart;
  } else if (jsonStartArr !== -1) {
    start = jsonStartArr;
  }
  if (start !== -1) {
    trimmed = trimmed.substring(start);
  }
  return trimmed;
}

function findLastStructuralClose(content: string): number {
  let inString = false;
  let escape = false;
  let lastClose = -1;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '}' || ch === ']') {
      lastClose = i;
    }
  }
  return lastClose;
}

function countOpenStructures(content: string): { braces: number; brackets: number } {
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  return { braces, brackets };
}

function isInStringAt(content: string, pos: number): boolean {
  let inString = false;
  let escape = false;
  for (let i = 0; i < pos; i++) {
    const ch = content[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
  }
  return inString;
}

function escapeControlCharacters(content: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (escape) {
      result += ch;
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      result += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === '\n') result += '\\n';
        else if (ch === '\r') result += '\\r';
        else if (ch === '\t') result += '\\t';
        else result += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
    }
    result += ch;
  }

  return result;
}

function tryFixUnescapedQuotes(content: string): Record<string, unknown> | null {
  let attempt = content;
  for (let i = 0; i < 10; i++) {
    try {
      return JSON.parse(attempt);
    } catch (e) {
      if (!(e instanceof SyntaxError)) return null;
      const posMatch = (e as SyntaxError).message?.match(/position\s+(\d+)/i);
      if (!posMatch) return null;
      const pos = parseInt(posMatch[1], 10);
      if (pos >= attempt.length) return null;
      const charAtPos = attempt[pos];
      if (charAtPos === '"') {
        const before = pos > 0 ? attempt[pos - 1] : '';
        if (before !== '\\') {
          attempt = attempt.substring(0, pos) + '\\"' + attempt.substring(pos + 1);
          continue;
        }
      }
      return null;
    }
  }
  return null;
}

export function attemptTruncatedJSONRepair(content: string): Record<string, unknown> | null {
  let trimmed = content.trim();

  try {
    const repaired = jsonRepairLib(trimmed);
    const parsed = JSON.parse(repaired);
    if (typeof parsed === 'object' && parsed !== null) {
      logger.info('JSON repaired by jsonrepair library', {
        originalLength: content.length,
      });
      return parsed as Record<string, unknown>;
    }
  } catch {
    // jsonrepair 无法修复，继续尝试自定义策略
  }

  const directFix = tryFixUnescapedQuotes(trimmed);
  if (directFix) {
    logger.info('JSON repaired by fixing unescaped quotes', {
      originalLength: content.length,
    });
    return directFix;
  }

  trimmed = escapeControlCharacters(trimmed);

  // 预处理：提取 ---UI--- 分隔符之后的内容，避免 :::组件语法 破坏 JSON 结构
  const uiSeparatorIndex = trimmed.indexOf('---UI---');
  if (uiSeparatorIndex !== -1) {
    trimmed = trimmed.substring(0, uiSeparatorIndex).trim();
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const jsonStart = trimmed.indexOf('{');
    const jsonStartArr = trimmed.indexOf('[');
    let start = -1;
    if (jsonStart !== -1 && jsonStartArr !== -1) {
      start = Math.min(jsonStart, jsonStartArr);
    } else if (jsonStart !== -1) {
      start = jsonStart;
    } else if (jsonStartArr !== -1) {
      start = jsonStartArr;
    }
    if (start !== -1) {
      trimmed = trimmed.substring(start);
    } else {
      return null;
    }
  }

  const unclosedString = isInStringAt(trimmed, trimmed.length);

  let repaired = trimmed;

  if (unclosedString) {
    repaired += '"';
  }

  const { braces, brackets } = countOpenStructures(repaired);

  if (braces > 0 || brackets > 0) {
    const lastClose = findLastStructuralClose(repaired);

    if (lastClose > 0) {
      repaired = repaired.substring(0, lastClose + 1);
    }

    const afterTruncate = countOpenStructures(repaired);

    for (let i = afterTruncate.braces; i > 0; i--) repaired += '}';
    for (let i = afterTruncate.brackets; i > 0; i--) repaired += ']';
  }

  try {
    const result = JSON.parse(repaired);
    logger.info('Truncated JSON repaired successfully', {
      originalLength: content.length,
      repairedLength: repaired.length,
    });
    return result as Record<string, unknown>;
  } catch {
    // try removing trailing commas before } or ]
    const trailingCommaRemoved = repaired.replace(/,\s*([}\]])/g, '$1');
    if (trailingCommaRemoved !== repaired) {
      try {
        const result = JSON.parse(trailingCommaRemoved);
        logger.info('JSON repaired by removing trailing commas', {
          originalLength: content.length,
          repairedLength: trailingCommaRemoved.length,
        });
        return result as Record<string, unknown>;
      } catch {
        // continue to next strategy
      }
    }

    // try progressively truncating to earlier structural closes
    let attempt = repaired;
    for (let retry = 0; retry < 5; retry++) {
      const prevClose = findLastStructuralClose(attempt.substring(0, attempt.length - 1));
      if (prevClose <= 0) break;

      attempt = attempt.substring(0, prevClose + 1);
      const counts = countOpenStructures(attempt);
      let candidate = attempt;
      for (let i = counts.braces; i > 0; i--) candidate += '}';
      for (let i = counts.brackets; i > 0; i--) candidate += ']';

      // also remove trailing commas
      candidate = candidate.replace(/,\s*([}\]])/g, '$1');

      try {
        const result = JSON.parse(candidate);
        logger.info('JSON repaired by progressive truncation', {
          originalLength: content.length,
          repairedLength: candidate.length,
          retries: retry + 1,
        });
        return result as Record<string, unknown>;
      } catch {
        // continue
      }
    }

    // jsonrepair 已是行业标准 JSON 修复库，集成了多种修复策略（语法校验、结构补全等），
    // 无需额外引入其他修复策略。此处仅增强诊断信息输出，帮助定位 LLM 输出截断等问题。
    logger.error('All JSON repair strategies failed', {
      originalLength: content.length,
      first100: content.substring(0, 100),
      last100: content.substring(Math.max(0, content.length - 100)),
      isLikelyTokenLimit: content.length > 1000,
      truncatedAt: content.length,
    });
    return null;
  }
}

export function parseLLMJson<T = Record<string, unknown>>(content: string, context?: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const extracted = extractJSONFromContent(content);
    if (extracted !== content.trim()) {
      try {
        parsed = JSON.parse(extracted);
        logger.info(`LLM JSON extracted from markdown${context ? ` in ${context}` : ''}`);
      } catch {
        const repaired = attemptTruncatedJSONRepair(extracted);
        if (repaired) {
          parsed = repaired;
        } else {
          throw new Error(
            `Failed to parse LLM JSON${context ? ` in ${context}` : ''}: ` +
            `content length=${content.length}, extracted length=${extracted.length}, ` +
            `first100=${content.substring(0, 100)}, ` +
            `last100=${extracted.substring(Math.max(0, extracted.length - 100))}`
          );
        }
      }
    } else {
      const repaired = attemptTruncatedJSONRepair(extracted);
      if (repaired) {
        parsed = repaired;
      } else {
        throw new Error(
          `Failed to parse LLM JSON${context ? ` in ${context}` : ''}: ` +
          `content length=${content.length}, ` +
          `first100=${content.substring(0, 100)}, ` +
          `last100=${content.substring(Math.max(0, content.length - 100))}`
        );
      }
    }
  }

  const normalized = normalizeKeys(parsed);
  return normalized as T;
}
