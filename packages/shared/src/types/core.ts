export type ID = string;

export type Timestamp = number;

/**
 * 生成可读ID：${source}_${name}_${timestamp}
 * 所有游戏实体统一使用此格式，禁止使用UUID
 * @param source 实体类型前缀 (npc/skill/item/quest/loc/map/evt/rel)
 * @param name 实体名称（自动转为snake_case）
 */
let _idCounter = 0;
export function generateReadableId(source: string, name: string): ID {
  const safeName = name
    .replace(/[^\w\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 40);
  const ts = Date.now();
  const counter = _idCounter++;
  return `${source}_${safeName}_${ts}_${counter}`;
}

/**
 * 生成确定性ID——基于 scope + scopeId + name，相同输入相同输出。
 * 用于所有"同一作用域下应唯一"的实体主键生成，使同名/同业务键条目生成相同 ID，
 * 第二次插入主键冲突（被预查重或 UNIQUE 约束拦截）。
 *
 * @param scope ID 前缀（如 'tskill' / 'skill' / 'time' / 'ctx' / 'rel' / 'conn' / 'gs' / 'profile'）
 * @param scopeId 作用域 ID（templateId / saveId / 'global'，用于跨作用域隔离）
 * @param name 实体名称或业务键（用于生成确定性部分）
 * @returns 确定性 ID，格式：`{scope}_{safeScopeId}_{safeName}`
 */
export function generateDeterministicId(scope: string, scopeId: string, name: string): ID {
  const safeScopeId = scopeId.replace(/[^\w\u4e00-\u9fff]/g, '_');
  const safeName = name
    .replace(/[^\w\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 40);
  return `${scope}_${safeScopeId}_${safeName}`;
}

export type JSONValue = 
  | string 
  | number 
  | boolean 
  | null 
  | JSONValue[] 
  | { [key: string]: JSONValue };

export interface BaseEntity {
  id: ID;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PaginationParams {
  page: number;
  page_size: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    timestamp: number;
    requestId: string;
  };
}
