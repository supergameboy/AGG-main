import type { Knex } from 'knex';
import type { ID } from '../../../shared/src/types/core.js';

/**
 * JSON 字段安全解析：数据库行中的 JSON 字段可能是字符串或已解析的对象
 */
export function parseJsonField<T>(value: unknown, defaultValue: T): T {
  if (!value) return defaultValue;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return defaultValue; }
  }
  return value as T;
}

/**
 * 从存档 ID 查询关联的模板 ID
 */
export async function getTemplateIdFromSave(db: Knex, saveId: ID): Promise<string | null> {
  const save = await db('saves').where({ id: saveId }).first('template_id');
  return save?.template_id as string | null ?? null;
}
