/**
 * 参数校验工具
 * 用于验证Tool调用时的必填参数
 */

/**
 * 验证必填参数是否存在且不为空
 * @param params - 调用参数对象
 * @param required - 必填字段列表
 * @returns 缺失的字段列表，空数组表示全部存在
 */
export function validateRequired(params: Record<string, unknown>, required: string[]): string | null {
  const missing: string[] = [];
  for (const key of required) {
    if (params[key] === undefined || params[key] === null || params[key] === '') {
      missing.push(key);
    }
  }
  if (missing.length === 0) return null;
  return `Missing required parameters: ${missing.join(', ')}`;
}

/**
 * 验证参数类型
 * @param value - 参数值
 * @param expectedType - 期望类型
 * @returns 是否符合期望类型
 */
export function validateType(value: unknown, expectedType: string): boolean {
  if (value === undefined || value === null) return false;

  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value) && value !== null;
    default:
      return true;
  }
}

/**
 * 验证字符串参数长度
 * @param value - 字符串值
 * @param min - 最小长度
 * @param max - 最大长度
 * @returns 是否在有效范围内
 */
export function validateStringLength(value: string, min?: number, max?: number): boolean {
  if (typeof value !== 'string') return false;
  const len = value.length;
  if (min !== undefined && len < min) return false;
  if (max !== undefined && len > max) return false;
  return true;
}

/**
 * 验证数值范围
 * @param value - 数值
 * @param min - 最小值
 * @param max - 最大值
 * @returns 是否在有效范围内
 */
export function validateNumberRange(value: number, min?: number, max?: number): boolean {
  if (typeof value !== 'number' || isNaN(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}
