/**
 * combat 领域纯映射函数。
 *
 * 从 CombatService 私有方法迁入（getCombatState/saveCombatState 内的 combat_data JSON 序列化反序列化），
 * 供 CombatRepository / CombatHistoryRepository 共享。
 */
import type { ID } from '../../../../shared/src/types/core.js';
import type { CombatState, CombatStateRow } from './types.js';

/** JSON 字段安全解析：字符串则 parse，对象则直返，空值用 fallback */
function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

/**
 * combat_states 表行 → CombatStateRow 实体。
 *
 * combat_data 是 JSON 字符串，反序列化为 CombatState 实体。
 * 覆盖 CombatService.getCombatState L198-213 手工 JSON.parse 映射。
 */
export function rowToCombatState(row: Record<string, unknown>): CombatStateRow {
  return {
    id: row.id as ID,
    saveId: row.save_id as string,
    status: row.status as string,
    // mode 列 NOT NULL DEFAULT 'turn_based_combat'（migration 007），13.3 禁止兜底，直接映射
    mode: row.mode as string,
    combatData: parseJsonField<CombatState>(row.combat_data, {} as CombatState),
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  };
}
