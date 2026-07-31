/**
 * JSON key 归一化工具——从 backend/utils/llm-json.ts 提取
 *
 * 仅提取 normalizeKeys 及其辅助函数 snakeToCamel，
 * 不包含依赖 logger 的 JSON 修复逻辑（那些保留在 backend）。
 */

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
