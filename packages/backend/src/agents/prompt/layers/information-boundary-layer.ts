import type { PromptLayer, PromptContext, LayerBuildOutput } from '../types.js';
import type { EntityGraphService } from '../../../game-systems/entity-graph/EntityGraphService.js';
import type { EntityNode, EntityType } from '../../../game-systems/entity-graph/types.js';
import { buildEntityNodeId } from '@ai-rpg/shared/utils/entity-graph-id';

const NOTE_MAX_LENGTH = 100;

/**
 * InformationBoundaryLayer - 信息边界层（006 升级改造）。
 *
 * 设计文档 §23：从 EntityGraphService.getAwareness/getRelationship 读取数据（独立表），
 *   不再解析 entity_graph_edges.properties（awareness/relationship 已迁移到独立表）。
 *
 * 渲染格式不变（L3-6）：
 * <awarenessBlock observer="..." type="...">
 *   <awareness target="..." targetType="..." score="8" note="..." />
 *   <relationship target="..." targetType="..." score="7" note="..." />
 * </awarenessBlock>
 *
 * 数据读取策略：
 * - GM 上下文：遍历所有 NPC 节点 → 对每个 NPC 调用 getEntityRelations 获取感知数据
 * - NPC 对话/输出上下文：仅查询当前 NPC 的 getEntityRelations
 *
 * 一次 getFullGraph 用于获取节点列表（npcNodes + targetNode 反查），
 * 感知数据从独立表（awareness/relationship states）读取，避免解析 edge.properties。
 */
export class InformationBoundaryLayer implements PromptLayer {
  readonly name = 'information-boundary';
  readonly order = 54;

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const saveId = ctx.domain.saveId as string | undefined;
    if (!saveId) {
      return { content: null, metadata: { npcBoundaryCount: 0 } };
    }

    const graphService = ctx.domain.graphService as EntityGraphService | undefined;
    if (!graphService) {
      return { content: null, metadata: { npcBoundaryCount: 0 } };
    }

    switch (ctx.agentKey) {
      case 'gamemaster':
        return this.buildGamemasterBoundary(saveId, graphService);
      case 'npc_party':
      case 'output':
        return this.buildNpcBoundary(saveId, ctx, graphService);
      default:
        return { content: null, metadata: { npcBoundaryCount: 0 } };
    }
  }

  /**
   * GM 上下文：输出所有 NPC 的感知数据块。
   *
   * 006 升级：感知数据从 awareness/relationship states 表读取（独立表）。
   * 一次 getFullGraph 仅用于获取 NPC 节点列表，不解析 edge.properties。
   */
  private async buildGamemasterBoundary(saveId: string, gs: EntityGraphService): Promise<LayerBuildOutput> {
    const npcNodes = await gs.getNodesByType(saveId, 'npc');
    if (npcNodes.length === 0) {
      return { content: null, metadata: { npcBoundaryCount: 0 } };
    }

    const fullGraph = await gs.getFullGraph(saveId);
    const nodeById = new Map<string, EntityNode>(fullGraph.nodes.map(n => [n.id, n]));

    const blocks: string[] = [];
    let npcBoundaryCount = 0;
    for (const npcNode of npcNodes) {
      const block = await this.formatAwarenessBlock(saveId, gs, npcNode.entityId, npcNode.label, 'npc', nodeById);
      if (block) {
        blocks.push(block);
        npcBoundaryCount++;
      }
    }

    const content = blocks.length > 0
      ? `<informationBoundary>\n${blocks.join('\n')}\n</informationBoundary>`
      : null;
    return { content, metadata: { npcBoundaryCount } };
  }

  /**
   * NPC 对话/输出上下文：仅输出当前 NPC 的感知数据块。
   *
   * 006 升级：感知数据从 awareness/relationship states 表读取（独立表）。
   */
  private async buildNpcBoundary(saveId: string, ctx: PromptContext, gs: EntityGraphService): Promise<LayerBuildOutput> {
    const npcId = ctx.domain.npcId as string | undefined;
    if (!npcId) {
      return { content: null, metadata: { npcBoundaryCount: 0 } };
    }

    const fullGraph = await gs.getFullGraph(saveId);
    const nodeById = new Map<string, EntityNode>(fullGraph.nodes.map(n => [n.id, n]));

    const npcNodeId = buildEntityNodeId('npc', saveId, npcId);
    const npcNode = nodeById.get(npcNodeId);
    if (!npcNode) {
      return { content: null, metadata: { npcBoundaryCount: 0 } };
    }

    const block = await this.formatAwarenessBlock(saveId, gs, npcId, npcNode.label, 'npc', nodeById);
    if (!block) {
      return { content: null, metadata: { npcBoundaryCount: 0 } };
    }

    const content = `<informationBoundary>\n${block}\n</informationBoundary>`;
    return { content, metadata: { npcBoundaryCount: 1 } };
  }

  /**
   * 格式化单个 observer 的 awarenessBlock。
   *
   * 006 升级：感知数据从 awareness/relationship states 表读取（独立表），
   *   不再解析 edge.properties（设计文档 §23）。
   *
   * 输出格式（L3-6，不变）：
   * <awarenessBlock observer="..." type="...">
   *   <awareness target="..." targetType="..." score="8" note="..." />
   *   <relationship target="..." targetType="..." score="7" note="..." />
   * </awarenessBlock>
   *
   * 规则：
   * - 仅输出有 awarenessScore 或 relationshipScore 的 target（两者都缺失则跳过该 target）
   * - score=0 是有效值（中性/不了解），正常输出
   * - note 可选，无则省略 note 属性
   * - note 超过 100 字符截断并添加 "..."
   * - 过滤掉已删除实体的残留边（target 节点不存在则跳过）
   */
  private async formatAwarenessBlock(
    saveId: string,
    gs: EntityGraphService,
    observerId: string,
    observerLabel: string,
    observerType: EntityType,
    nodeById: Map<string, EntityNode>,
  ): Promise<string | null> {
    // 006 升级：调用 getEntityRelations 从独立表读取 awareness + relationship 当前状态
    const relations = await gs.getEntityRelations(saveId, observerType, observerId);
    if (relations.perceptions.length === 0) return null;

    const lines: string[] = [];
    for (const perception of relations.perceptions) {
      // 通过 fullGraph 反查 target 节点的 label（perception.targetId 是 entity_id）
      const targetNode = this.findNodeByEntityId(nodeById, perception.targetType, perception.targetId);
      if (!targetNode) continue; // 过滤已删除实体的残留数据

      const hasAwareness = perception.currentAwarenessScore !== undefined;
      const hasRelationship = perception.currentRelationshipScore !== undefined;

      if (hasAwareness) {
        const score = Number(perception.currentAwarenessScore);
        const note = this.truncateNote(perception.awarenessNote);
        const noteAttr = note ? ` note="${this.escapeXml(note)}"` : '';
        lines.push(`  <awareness target="${this.escapeXml(targetNode.label)}" targetType="${perception.targetType}" score="${score}"${noteAttr} />`);
      }

      if (hasRelationship) {
        const score = Number(perception.currentRelationshipScore);
        const note = this.truncateNote(perception.relationshipNote);
        const noteAttr = note ? ` note="${this.escapeXml(note)}"` : '';
        lines.push(`  <relationship target="${this.escapeXml(targetNode.label)}" targetType="${perception.targetType}" score="${score}"${noteAttr} />`);
      }
    }

    if (lines.length === 0) return null;

    return `<awarenessBlock observer="${this.escapeXml(observerLabel)}" type="${observerType}">\n${lines.join('\n')}\n</awarenessBlock>`;
  }

  /**
   * 通过 entityType + entityId 从 fullGraph 节点映射中反查节点。
   * nodeById 的键是 nodeId（egn_{type}_{saveId}_{entityId} 格式），无法直接按 entityId 查找，
   * 因此遍历查找（NPC 数量有限，性能可接受）。
   */
  private findNodeByEntityId(
    nodeById: Map<string, EntityNode>,
    entityType: string,
    entityId: string,
  ): EntityNode | undefined {
    for (const node of nodeById.values()) {
      if (node.entityType === entityType && node.entityId === entityId) {
        return node;
      }
    }
    return undefined;
  }

  private truncateNote(note: string | undefined): string {
    if (!note) return '';
    if (note.length <= NOTE_MAX_LENGTH) return note;
    return note.slice(0, NOTE_MAX_LENGTH) + '...';
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
