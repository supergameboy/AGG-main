/**
 * 去重防护共享工具：增量更新 + 字段级 diff + 黑名单触发提示。
 *
 * 用于 6 处去重防护场景（MapService.createLocation / CharacterService.createCharacter /
 * InventoryService.addPoolItem / SkillService.addPoolSkill / SkillService.learnSkill /
 * NPCService.createNPC），统一处理：
 * 1. 非黑名单字段增量更新（仅更新发生变化的字段）
 * 2. 黑名单字段拒绝更新并记录
 * 3. 生成字段级 diff warnings（"字段名: 旧值 → 新值"）
 * 4. 生成黑名单触发提示（"以下字段为黑名单字段，已拒绝更新并保留原值: ..."）
 *
 * 设计原则（code-standards 第二章第4条"一个概念只表达一次"）：
 * - diff 计算、黑名单检测、warning 格式化逻辑只在此处实现一次
 * - 各 Service 负责字段映射（如 x/y → coordinates）和字段解析（如 name → id）
 * - 调用方构建好扁平的 existingValues / newValues 后调用本工具
 */

/**
 * 字段级 diff（单个字段的变化记录）。
 */
export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * 被黑名单拒绝的字段。
 */
export interface BlockedField {
  field: string;
  rejectedValue: unknown;
  preservedValue: unknown;
}

/**
 * 增量更新计算结果。
 */
export interface DedupUpdateResult {
  /** 需要更新的字段及其 diff（仅包含发生变化的非黑名单字段） */
  updatedFields: FieldDiff[];
  /** 被黑名单拒绝的字段（仅包含 Agent 试图修改但被拒绝的黑名单字段） */
  blockedFields: BlockedField[];
}

/**
 * 比较已有实体与新输入值，计算增量更新结果。
 *
 * 期望效果：
 * - 遍历 newValues 中所有字段
 * - undefined 值跳过（Agent 未传入该字段）
 * - 黑名单字段：若 Agent 试图修改（新值与旧值不同）→ 记录到 blockedFields，不加入 updatedFields
 * - 非黑名单字段：若值发生变化 → 记录到 updatedFields
 * - 值未变化 → 跳过（不记录）
 *
 * @param existingValues 已有实体的字段值（扁平键值对，键为存储字段名）
 * @param newValues Agent 传入的新字段值（扁平键值对，键为存储字段名，已由调用方完成映射/解析）
 * @param blacklist 禁止覆盖的黑名单字段名列表
 * @returns 增量更新结果（updatedFields + blockedFields）
 */
export function computeDedupUpdate(
  existingValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  blacklist: readonly string[],
): DedupUpdateResult {
  const updatedFields: FieldDiff[] = [];
  const blockedFields: BlockedField[] = [];

  for (const [field, newValue] of Object.entries(newValues)) {
    // undefined 值跳过（Agent 未传入该字段）
    if (newValue === undefined) continue;

    const oldValue = existingValues[field];

    // 黑名单字段：拒绝更新，记录到 blockedFields
    if (blacklist.includes(field)) {
      // 仅当 Agent 试图修改（新值与旧值不同）时才记录
      if (!deepEqual(oldValue, newValue)) {
        blockedFields.push({ field, rejectedValue: newValue, preservedValue: oldValue });
      }
      continue;
    }

    // 非黑名单字段：仅当值发生变化时才记录到 updatedFields
    if (!deepEqual(oldValue, newValue)) {
      updatedFields.push({ field, oldValue, newValue });
    }
  }

  return { updatedFields, blockedFields };
}

/**
 * 格式化去重防护 warnings。
 *
 * 期望效果：
 * - 有更新字段时：生成 "<entityType> '<entityName>' 已存在，已增量更新 <field>: <old> → <new>, ..."
 * - 有黑名单触发时：生成 "以下字段为黑名单字段，已拒绝更新并保留原值: <field>: <preserved> (拒绝值: <rejected>), ..."
 * - 两者都有时：生成两条 warning
 * - 都没有时：生成 "<entityType> '<entityName>' 已存在，无字段变化"
 *
 * @param entityType 实体类型描述（如"地点"、"角色"、"物品池"）
 * @param entityName 实体名称
 * @param updatedFields 已更新字段 diff
 * @param blockedFields 被拒绝的黑名单字段
 * @returns warnings 字符串数组
 */
export function formatDedupWarnings(
  entityType: string,
  entityName: string,
  updatedFields: FieldDiff[],
  blockedFields: BlockedField[],
): string[] {
  const warnings: string[] = [];

  if (updatedFields.length > 0) {
    const diffStr = updatedFields
      .map(f => `${f.field}: ${formatValue(f.oldValue)} → ${formatValue(f.newValue)}`)
      .join(', ');
    warnings.push(`${entityType} '${entityName}' 已存在，已增量更新 ${diffStr}`);
  } else if (blockedFields.length === 0) {
    // 既无更新也无黑名单触发：告知 Agent 数据已存在但无变化
    warnings.push(`${entityType} '${entityName}' 已存在，无字段变化`);
  }

  if (blockedFields.length > 0) {
    const blockedStr = blockedFields
      .map(f => `${f.field}: ${formatValue(f.preservedValue)} (拒绝值: ${formatValue(f.rejectedValue)})`)
      .join(', ');
    warnings.push(`以下字段为黑名单字段，已拒绝更新并保留原值: ${blockedStr}`);
  }

  return warnings;
}

/**
 * 深度相等比较（用于判断字段值是否变化）。
 * 对原始类型直接比较；对对象/数组用 JSON 序列化后比较。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * 格式化字段值为可读字符串（用于 warning 消息）。
 */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
