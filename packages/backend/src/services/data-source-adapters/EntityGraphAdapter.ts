import type {
  ContextFilter,
  ContextSection,
  ExpandContext,
} from '../../../../shared/src/types/context-manifest.js';
import type { DataSourceAdapter } from '../data-source-adapter.js';
import { formatByContextFormat } from '../data-source-adapter.js';

/**
 * EntityGraphAdapter - 关系数据.* tag 适配器（模块4 新增）。
 *
 * 数据源：EntityGraphService（实体关系图）。
 * 支持 tag 后缀：NPC关系/地点关系/实体关系/全图概览/全图/子图/节点列表/感知边/感知查询。
 *
 * filter 参数：
 * - entityId: NPC关系/地点关系/实体关系/子图/感知查询 必填
 * - entityType: 实体关系/节点列表/感知查询 必填，子图 可选默认 'npc'
 * - depth: 子图可选默认 2
 * - relation: 感知边可选默认 'PERCEIVES'（未来扩展用，当前 provider 固定 PERCEIVES）
 *
 * 失败处理：
 * - getNpcProfile/getLocationSummary 在 npcService/mapService 为 null 时抛错 →
 *   GameDataExpander 单 adapter 失败跳过该 section 记 warn（局部降级）
 * - filter 必填字段缺失 → 抛错（数据层问题，应阻断）
 */
export class EntityGraphAdapter implements DataSourceAdapter {
  readonly tagPrefix = '关系数据.';

  async expand(section: ContextSection, ctx: ExpandContext): Promise<string> {
    const suffix = section.tag.slice(this.tagPrefix.length);
    const filter = section.filter;
    const saveId = ctx.saveId;
    const provider = ctx.providers.entityGraphProvider;

    switch (suffix) {
      case 'NPC关系': {
        const entityId = this.requireFilterField(filter, 'entityId', section.tag);
        return formatByContextFormat(
          await provider.getNpcProfile(saveId, entityId),
          section.format,
        );
      }
      case '地点关系': {
        const entityId = this.requireFilterField(filter, 'entityId', section.tag);
        return formatByContextFormat(
          await provider.getLocationSummary(saveId, entityId),
          section.format,
        );
      }
      case '实体关系': {
        const entityId = this.requireFilterField(filter, 'entityId', section.tag);
        const entityType = this.requireFilterField(filter, 'entityType', section.tag);
        return formatByContextFormat(
          await provider.getEntityRelations(saveId, entityType, entityId),
          section.format,
        );
      }
      case '全图概览':
        return formatByContextFormat(
          await provider.getWorldStateSummary(saveId),
          section.format,
        );
      case '全图':
        return formatByContextFormat(
          await provider.getFullGraph(saveId),
          section.format,
        );
      case '子图': {
        const entityId = this.requireFilterField(filter, 'entityId', section.tag);
        const entityType = filter?.entityType ?? 'npc';
        const depth = filter?.depth ?? 2;
        const centerNodeId = `${entityType}:${saveId}:${entityId}`;
        return formatByContextFormat(
          await provider.getSubgraph(saveId, centerNodeId, depth),
          section.format,
        );
      }
      case '节点列表': {
        const entityType = this.requireFilterField(filter, 'entityType', section.tag);
        return formatByContextFormat(
          await provider.getNodesByType(saveId, entityType),
          section.format,
        );
      }
      case '感知边':
        return formatByContextFormat(
          await provider.getPerceivesEdges(saveId),
          section.format,
        );
      case '感知查询': {
        const entityId = this.requireFilterField(filter, 'entityId', section.tag);
        const entityType = this.requireFilterField(filter, 'entityType', section.tag);
        return formatByContextFormat(
          await provider.getEntityAwareness(saveId, entityType, entityId),
          section.format,
        );
      }
      default:
        throw new Error(
          `未知的关系数据 tag 后缀: ${suffix}，合法值: NPC关系/地点关系/实体关系/全图概览/全图/子图/节点列表/感知边/感知查询`,
        );
    }
  }

  /**
   * 校验 filter 必填字段，缺失时抛出明确错误（含 tag 名 + 字段名）。
   * 返回非空值（类型守卫，避免 `!` 非空断言违反 design-first §2.4）。
   */
  private requireFilterField<K extends keyof ContextFilter>(
    filter: ContextFilter | undefined,
    field: K,
    tag: string,
  ): NonNullable<ContextFilter[K]> {
    const value = filter?.[field];
    if (value === undefined || value === null) {
      throw new Error(`${tag} 需要 filter.${String(field)} 参数`);
    }
    return value;
  }
}
