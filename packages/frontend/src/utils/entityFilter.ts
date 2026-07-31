/**
 * 前端实体过滤与查找通用工具。
 *
 * 设计目标（架构提升）：
 * 1. 统一 ownerType 过滤语义为白名单（=== 'character'），消除黑名单（!== 'npc'）的不一致
 * 2. 统一 NPC 按 ID/名称查找路径，消除各组件 find/filter 分散
 * 3. 遵循 architecture-standards §13.3"归属缺失即抛错"，移除 ?? 'character' 兜底
 *
 * 期望效果：
 * - 所有面板（inventory/skills）的 ownerType 过滤通过本模块统一执行
 * - 所有"按 ID 或名称查找实体"通过本模块统一执行
 * - ownerType 缺失或非法值时立即抛错，暴露后端字段缺失
 */

/** 实体必须具备的 ownerType 字段（用于泛型约束） */
export interface WithOwnerType {
  ownerType?: string;
}

/** 实体必须具备的 id/name 字段（用于泛型约束） */
export interface WithIdAndName {
  id: string;
  name?: string;
}

/**
 * 按 ownerType 白名单过滤实体数组。
 *
 * 期望效果：
 * - 输入 items 含 character/npc 混合，输出只含指定 ownerType 的项
 * - ownerType 缺失或非法值时抛错（遵循 §13.3"归属缺失即抛错"）
 * - 空数组返回空数组
 *
 * @param items 待过滤数组
 * @param ownerType 期望保留的 ownerType（'character' 或 'npc'）
 * @returns 过滤后的新数组
 * @throws Error 当任一项的 ownerType 为 undefined 或非法值时
 */
export function filterByOwnerType<T extends WithOwnerType>(
  items: T[],
  ownerType: 'character' | 'npc',
): T[] {
  return items.filter((item) => {
    assertOwnerType(item.ownerType);
    return item.ownerType === ownerType;
  });
}

/**
 * 按 ID 优先、名称兜底查找实体。
 *
 * 期望效果：
 * - id 与 name 都提供时，先按 id 查找，未命中再按 name 查找
 * - 只提供 id 时，仅按 id 查找
 * - 只提供 name 时，仅按 name 查找
 * - 都不提供时抛错
 * - 都不命中时返回 undefined
 *
 * @param items 待查找数组
 * @param options 查找条件，至少提供 id 或 name 之一
 * @returns 匹配项或 undefined
 * @throws Error 当 id 和 name 都未提供时
 */
export function findEntityByIdOrName<T extends WithIdAndName>(
  items: T[],
  options: { id?: string; name?: string },
): T | undefined {
  if (!options.id && !options.name) {
    throw new Error(
      `findEntityByIdOrName: Must provide id or name. Received: ${JSON.stringify(options)}`
    );
  }

  // 1. 按 id 优先
  if (options.id) {
    const byId = items.find((item) => item.id === options.id);
    if (byId) return byId;
  }

  // 2. 按 name 兜底（id 未命中或 id 为空/undefined 时）
  if (options.name) {
    return items.find((item) => item.name === options.name);
  }

  return undefined;
}

/**
 * 断言 ownerType 合法，缺失或非法值时抛错。
 *
 * 期望效果：
 * - 'character' / 'npc' 直接返回
 * - undefined 抛错（遵循 §13.3"归属缺失即抛错"，替代 ?? 'character' 兜底）
 * - 其他值抛错（暴露后端字段非法值）
 *
 * @param ownerType 待断言的值
 * @returns 合法化的 ownerType
 * @throws Error 当 ownerType 为 undefined 或非 'character'/'npc' 时
 */
export function assertOwnerType(
  ownerType: string | undefined | null,
): 'character' | 'npc' {
  if (ownerType === undefined || ownerType === null) {
    throw new Error(
      `assertOwnerType: ownerType is missing. ` +
      `Backend must provide ownerType explicitly (architecture-standards §13.3).`
    );
  }
  if (ownerType !== 'character' && ownerType !== 'npc') {
    throw new Error(
      `assertOwnerType: Invalid ownerType '${ownerType}'. Expected 'character' or 'npc'.`
    );
  }
  return ownerType;
}
