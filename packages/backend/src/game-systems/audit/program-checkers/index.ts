import type { AuditRequest, AuditFailure } from '../../../../../shared/src/types/audit.js';
import type { ProgramChecker, AuditContext } from '../ProgramChecker.js';

/**
 * 创建类操作前缀 - 用于精确匹配 actualCount。
 *
 * 设计原则（architecture-standards 14.5 第2条）：
 * - 仅统计创建类操作（create/add/learn/insert/upsert/batch_create），排除查询/更新/删除操作
 * - 禁止 substring 匹配虚高 actualCount（如 get_address 误匹配 "add"）
 *
 * 修复（方案 2）：从 substring `.includes(kw)` 改为精确前缀匹配 `method.startsWith(prefix + '_')`，
 * 避免 `get_address` / `update_address` 等被误判为创建操作。
 *
 * 修复（bug-hunt-20260722）：补充 `batch_create` 前缀。
 * `batch_create_locations` 等批量创建操作的方法名以 `batch_create_` 开头，
 * 不匹配 `create_` 前缀（因 `batch_create_locations`.startsWith('create_') === false），
 * 导致 EntityCountsChecker 统计 actualCount=0，audit_feedback 传递错误信息。
 */
const CREATE_OPERATION_PREFIXES = ['create', 'add', 'learn', 'insert', 'upsert', 'batch_create'] as const;

/**
 * 批量创建工具的数组参数字段名映射。
 *
 * 设计文档方案 2：识别 params 中的批量数组字段，按数组长度计算实际实体数。
 * - inventory_service.add_item → items
 * - inventory_service.add_item_from_pool → items
 * - inventory_service.equip_item → items
 * - map_service.batch_create_locations → locations
 * - skill_service.learn_skill → skills（单数方法名，但 params.skills 为批量数组）
 * - npc_service.create_npc → npcs（单数方法名，批量场景由多个 create_npc 调用组成）
 *
 * 通用规则：复数形式字段名（items/npcs/locations/skills/quests/characters/sub_locations）作为批量数组。
 */
const BATCH_ARRAY_FIELD_NAMES = [
  'items', 'npcs', 'locations', 'skills', 'quests', 'characters', 'sub_locations',
] as const;

/**
 * 判断工具调用是否为创建类操作。
 *
 * 修复（方案 2）：使用精确前缀匹配，方法名必须以 `create_` / `add_` / `learn_` / `insert_` / `upsert_` / `batch_create_` 开头。
 * 修复 `get_address` / `update_address` 等被 substring `.includes('add')` 误判为创建操作的问题。
 *
 * 修复（bug-hunt-20260722）：`batch_create_` 前缀单独判断，避免被 `create_` 前缀漏判
 * （`batch_create_locations`.startsWith('create_') === false，但应被识别为创建类操作）。
 *
 * 导出供 AuditAgent.extractCurrentState 复用（方案 4），避免重复实现前缀匹配逻辑。
 */
export function isCreateOperation(method: string): boolean {
  const lower = method.toLowerCase();
  // batch_create_ 前缀单独判断（更具体的前缀，避免与 create_ 冲突）
  if (lower.startsWith('batch_create_')) return true;
  return CREATE_OPERATION_PREFIXES.some((prefix) => lower.startsWith(prefix + '_'));
}

/**
 * 判断 toolCall 是否匹配指定实体类型（精确 token 边界匹配）。
 *
 * 修复（方案 2）：从 substring `.includes(entityType)` 改为单词边界匹配，
 * 避免 `"inventory_service".includes("item")` 误匹配（"inventory" 不是 "item" 的完整 token）。
 *
 * 匹配规则：tool 名或 method 名包含 entityType 或 singular 作为独立 token（用下划线/字符串边界分隔）。
 */
function matchesEntity(
  toolCall: { tool: string; method: string },
  entityType: string,
  singular: string,
): boolean {
  const tokens = [entityType.toLowerCase(), singular.toLowerCase()];
  const candidates = [toolCall.tool.toLowerCase(), toolCall.method.toLowerCase()];
  for (const candidate of candidates) {
    for (const token of tokens) {
      // 单词边界匹配：token 前后必须是字符串边界或非字母数字字符（下划线、空格等）
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:$|[^a-z0-9])`, 'i');
      if (re.test(candidate)) return true;
    }
  }
  return false;
}

/**
 * 转义正则表达式特殊字符。
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从单个 toolCall 中提取实际创建的实体数量。
 *
 * 设计文档方案 2：对支持批量操作的工具（add_item / batch_create_locations / learn_skills 等），
 * 按 params 中批量数组字段长度计算实际实体数；无批量数组字段时按 1 计算（单个创建）。
 *
 * 约束：调用方需先确保 `isCreateOperation(toolCall.method) === true` 且 `matchesEntity(toolCall, ...) === true`。
 */
function extractCreatedEntityCount(
  toolCall: { tool: string; method: string; params?: unknown },
  entityType: string,
  singular: string,
): number {
  const params = toolCall.params;
  if (!params || typeof params !== 'object') return 1;

  const record = params as Record<string, unknown>;
  // 优先识别与实体类型匹配的批量数组字段
  const candidateFields = [
    entityType.toLowerCase(), // 复数形式（如 "items"）
    singular.toLowerCase(),   // 单数形式兜底（如 "item"）
    ...BATCH_ARRAY_FIELD_NAMES,
  ];
  for (const field of candidateFields) {
    const value = record[field];
    if (Array.isArray(value) && value.length > 0) {
      return value.length;
    }
  }
  return 1;
}

/**
 * EntityCountsChecker - entity_counts 维度检查（迁移自[A] TaskConformanceAudit）。
 * 检查实际产出的实体数量是否符合 taskContract.expected.counts。
 *
 * 设计原则（architecture-standards 14.2 + 14.5）：
 * - actualCount 仅统计创建类操作（create/add/learn/insert/upsert），避免 substring 匹配虚高
 * - 保留 actualCount < expectedCount 检测（severity=error）
 * - 不引入 actualCount > expectedCount 检测（撤回，避免阻断 LLM 合法扩展，重复创建由 Service 层去重防护兜底）
 */
export class EntityCountsChecker implements ProgramChecker {
  readonly dimension = 'entity_counts' as const;
  readonly parallelizable = true;

  async check(request: AuditRequest, _ctx: AuditContext): Promise<AuditFailure[]> {
    const expected = request.taskContract.expected?.counts;
    if (!expected) return [];

    const failures: AuditFailure[] = [];
    const toolCalls = request.actualOutput.toolCalls ?? [];

    for (const [entityType, expectedCount] of Object.entries(expected)) {
      // 仅统计创建类操作，避免 substring 匹配虚高 actualCount
      // entityType 可能是复数（如 "items"），tool method 用单数（如 "add_item_from_pool"）
      const singular = entityType.replace(/s$/, '');

      // sub_locations: 仅统计带 parent_location_id 的创建类操作（子地点数量审查）
      const isSubLocation = entityType.includes('sub_location');

      // 修复（方案 2）：actualCount 反映实际创建实体数（批量数组长度累加），而非 toolCall 数量
      const actualCount = toolCalls.reduce((sum, tc) => {
        if (!isCreateOperation(tc.method)) return sum;
        if (!matchesEntity(tc, entityType, singular)) return sum;
        // sub_locations 专项：必须有 parent_location_id 参数
        if (isSubLocation) {
          const params = tc.params as Record<string, unknown> | undefined;
          if (!params?.parent_location_id) return sum;
        }
        return sum + extractCreatedEntityCount(tc, entityType, singular);
      }, 0);

      if (actualCount < expectedCount) {
        failures.push({
          dimension: this.dimension,
          expected: { entityType, count: expectedCount },
          actual: { entityType, count: actualCount },
          reason: `实体数量不足: ${entityType} 期望 ${expectedCount}，实际 ${actualCount}`,
          severity: 'error',
        });
      }
    }

    return failures;
  }
}

/**
 * NpcLocationChecker - npc_location 维度检查（迁移自[D] ContinuityAuditor）。
 * 检查NPC的location是否在已知的locations表中。
 */
export class NpcLocationChecker implements ProgramChecker {
  readonly dimension = 'npc_location' as const;
  readonly parallelizable = true;

  async check(_request: AuditRequest, ctx: AuditContext): Promise<AuditFailure[]> {
    const savePool = ctx.auditProviders.shadowSavePoolProvider ?? ctx.dataProviders.savePoolProvider;
    const npcs = await savePool.listNpcs(ctx.saveId);
    const locations = await savePool.listLocations(ctx.saveId);
    const locationIds = new Set(locations.map((l) => String((l as Record<string, unknown>).id ?? '')).filter(Boolean));

    const failures: AuditFailure[] = [];
    for (const npc of npcs) {
      const npcRecord = npc as Record<string, unknown>;
      const npcLocationId = npcRecord.location_id as string | undefined;
      if (npcLocationId && !locationIds.has(npcLocationId)) {
        failures.push({
          dimension: this.dimension,
          expected: { npcLocationId, exists: true },
          actual: { npcLocationId, exists: false },
          reason: `NPC ${npcRecord.name} 的 location_id=${npcLocationId} 不在 locations 表中`,
          severity: 'error',
        });
      }
    }

    return failures;
  }
}

/**
 * ItemOwnershipChecker - item_ownership 维度检查（迁移自[D] ContinuityAuditor）。
 * 检查物品的 owner 是否在 characters/npcs 表中。
 */
export class ItemOwnershipChecker implements ProgramChecker {
  readonly dimension = 'item_ownership' as const;
  readonly parallelizable = true;

  async check(_request: AuditRequest, ctx: AuditContext): Promise<AuditFailure[]> {
    const savePool = ctx.auditProviders.shadowSavePoolProvider ?? ctx.dataProviders.savePoolProvider;
    const items = await savePool.listItems(ctx.saveId);
    const characters = await savePool.listCharacters(ctx.saveId);
    const npcs = await savePool.listNpcs(ctx.saveId);
    const ownerIds = new Set<string>();
    for (const c of characters) ownerIds.add(String((c as Record<string, unknown>).id));
    for (const n of npcs) ownerIds.add(String((n as Record<string, unknown>).id));

    const failures: AuditFailure[] = [];
    for (const item of items) {
      const itemRecord = item as Record<string, unknown>;
      const ownerId = itemRecord.owner_id as string | undefined;
      const ownerType = itemRecord.owner_type as string | undefined;
      // 13.3 规则: 归属校验必须覆盖 character + npc 两种 owner_type，禁止仅校验 character 导致 NPC 归属漏校。
      if (ownerId && (ownerType === 'character' || ownerType === 'npc') && !ownerIds.has(ownerId)) {
        failures.push({
          dimension: this.dimension,
          expected: { ownerId, exists: true },
          actual: { ownerId, exists: false },
          reason: `物品 ${itemRecord.name} 的 owner_id=${ownerId} 不在 characters/npcs 表中`,
          severity: 'error',
        });
      }
      // 13.3 规则: owner_type 缺失或非法枚举即抛错，禁止 fallback。
      if (!ownerId || !ownerType) {
        failures.push({
          dimension: this.dimension,
          expected: { ownerId: 'non-empty', ownerType: 'character|npc' },
          actual: { ownerId, ownerType },
          reason: `物品 ${itemRecord.name} 缺失 owner_id 或 owner_type`,
          severity: 'error',
        });
      } else if (ownerType !== 'character' && ownerType !== 'npc') {
        failures.push({
          dimension: this.dimension,
          expected: { ownerType: 'character|npc' },
          actual: { ownerType },
          reason: `物品 ${itemRecord.name} 的 owner_type=${ownerType} 非合法枚举`,
          severity: 'error',
        });
      }
    }

    return failures;
  }
}

/**
 * GraphConsistencyChecker 已删除（模块2 简化）。
 *
 * 删除原因：
 * 1. 依赖 EntityGraphAuditor.auditStagedWrites，EntityGraphAuditor 已在模块2 删除
 * 2. 图关系一致性由 Reconciler 全量重建兜底，不需要实时审核阻塞流程（§14.1）
 * 3. 孤立节点检测违反 §14.5 第4条（合法中间状态）
 * 4. 信息边界缺失检测违反 §14.5 第5条（过度约束 GM 创作自由度）
 *
 * graph_consistency 维度已从所有 auditScope 中移除。
 */

/**
 * InfoBoundaryChecker 已删除（architecture-standards 14.5 第3条）。
 *
 * 删除原因：
 * 1. 死代码：InfoBoundaryChecker 不在任何 auditScope 中（resolveAuditPolicy 为所有 agentType
 *    设置的 auditScope 均不包含 'info_boundary'），永远不会被执行
 * 2. 硬编码阻断合法关系：硬编码 "NPC 不能知道 quest" 业务规则，阻断了合法的 NPC-quest 知识关系
 *    （任务发布 NPC、剧情 NPC、队友 NPC 等合法场景）
 *
 * 模块2 简化：EntityGraphAuditor 已删除，信息边界检查由模块3 增强的 PERCEIVES 边模型承载。
 * 模块3 简化：信息边界管理通过 entity_graph_service.set_awareness / set_relationship 工具由 GM 显式管理。
 */
