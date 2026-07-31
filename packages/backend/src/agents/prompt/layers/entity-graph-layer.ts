import type { PromptLayer, PromptContext, LayerBuildOutput } from '../types.js';
import type { EntityGraphService } from '../../../game-systems/entity-graph/EntityGraphService.js';
import type { EntityEdge } from '../../../game-systems/entity-graph/types.js';
import { buildEntityNodeId } from '@ai-rpg/shared/utils/entity-graph-id';

export class EntityGraphLayer implements PromptLayer {
  readonly name = 'entity-graph';
  readonly order = 53;

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    const saveId = ctx.domain.saveId as string | undefined;
    if (!saveId) {
      return { content: null, metadata: { nodeCount: 0, edgeCount: 0, subAgentsCount: 0 } };
    }

    const graphService = ctx.domain.graphService as EntityGraphService | undefined;
    if (!graphService) {
      return { content: null, metadata: { nodeCount: 0, edgeCount: 0, subAgentsCount: 0 } };
    }

    const agents = ctx.domain.availableAgents as Array<{ type: string; name: string; whenToInvoke?: string; supportedIntents?: string[] }> | undefined;
    const subAgentsCount = agents?.length ?? 0;

    switch (ctx.agentKey) {
      case 'gamemaster':
        return this.buildGamemasterContext(saveId, ctx, graphService, subAgentsCount);
      case 'npc_party':
        return this.buildNpcPartyContext(saveId, ctx, graphService, subAgentsCount);
      case 'output':
        return this.buildOutputContext(saveId, ctx, graphService, subAgentsCount);
      default:
        return { content: null, metadata: { nodeCount: 0, edgeCount: 0, subAgentsCount } };
    }
  }

  private async buildGamemasterContext(saveId: string, ctx: PromptContext, gs: EntityGraphService, subAgentsCount: number): Promise<LayerBuildOutput> {
    const parts: string[] = [];
    let nodeCount = 0;
    let edgeCount = 0;

    // 可用子Agent（从GameMasterContextLayer迁移），包含调度指导和能力边界
    const agents = ctx.domain.availableAgents as Array<{ type: string; name: string; whenToInvoke?: string; supportedIntents?: string[] }> | undefined;
    if (agents && agents.length > 0) {
      const lines = ['<available_agents>'];
      for (const agent of agents) {
        const whenToInvoke = agent.whenToInvoke ? ` whenToInvoke="${agent.whenToInvoke}"` : '';
        const supportedIntents = agent.supportedIntents && agent.supportedIntents.length > 0 ? ` supported_intents="${agent.supportedIntents.join(',')}"` : '';
        lines.push(`  <agent type="${agent.type}" name="${agent.name}"${whenToInvoke}${supportedIntents} />`);
      }
      lines.push('</available_agents>');
      parts.push(lines.join('\n'));
    } else {
      parts.push('<available_agents>\n  <!-- No sub-agents available. Use ServiceTool directly. -->\n</available_agents>');
    }

    // 游戏状态（从GameMasterContextLayer迁移）
    const inCombat = ctx.domain.inCombat as boolean | undefined;
    const sceneNPCs = ctx.domain.sceneNPCs as Array<{ id: string; name: string; role?: string }> | undefined;
    const targetNpcIds = new Set(ctx.domain.targetNpcIds as string[] | undefined ?? []);

    const stateLines = ['<current_game_state>'];
    stateLines.push(`  <save_id>${saveId}</save_id>`);
    stateLines.push(`  <in_combat>${inCombat ?? false}</in_combat>`);
    if (targetNpcIds.size > 0 && sceneNPCs) {
      const targetNames = sceneNPCs
        .filter(npc => targetNpcIds.has(npc.id))
        .map(npc => `${npc.name}(${npc.id})`)
        .join(', ');
      stateLines.push(`  <dialogue_targets>${targetNames}</dialogue_targets>`);
    }
    stateLines.push('</current_game_state>');
    parts.push(stateLines.join('\n'));

    // 实体关系图（XML格式）
    let graph = await gs.getFullGraph(saveId);
    if (graph.nodes.length > 0) {
      if (graph.nodes.length > 50) {
        const currentLocationId = ctx.domain.currentLocationId as string | undefined;
        if (currentLocationId) {
          const centerNode = buildEntityNodeId('location', saveId, currentLocationId);
          graph = await gs.getSubgraph(saveId, centerNode, 2);
        }
      }
      parts.push(this.formatGraphAsXml(graph, targetNpcIds));
      nodeCount = graph.nodes.length;
      edgeCount = graph.edges.length;
    }

    const content = parts.length > 0 ? parts.join('\n\n') : null;
    return { content, metadata: { nodeCount, edgeCount, subAgentsCount } };
  }

  private async buildNpcPartyContext(saveId: string, ctx: PromptContext, gs: EntityGraphService, subAgentsCount: number): Promise<LayerBuildOutput> {
    const npcId = ctx.domain.npcId as string | undefined;
    if (npcId) {
      const nodeId = buildEntityNodeId('npc', saveId, npcId);
      const graph = await gs.getSubgraph(saveId, nodeId, 1);
      if (graph.nodes.length === 0) {
        return { content: null, metadata: { nodeCount: 0, edgeCount: 0, subAgentsCount } };
      }
      return {
        content: this.formatGraphAsXml(graph),
        metadata: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, subAgentsCount },
      };
    }

    const content = await this.buildNpcProfileSummary(saveId, gs);
    const npcNodes = await gs.getNodesByType(saveId, 'npc');
    return { content, metadata: { nodeCount: npcNodes.length, edgeCount: 0, subAgentsCount } };
  }

  private async buildOutputContext(saveId: string, ctx: PromptContext, gs: EntityGraphService, subAgentsCount: number): Promise<LayerBuildOutput> {
    const npcId = ctx.domain.npcId as string | undefined;
    const currentLocationId = ctx.domain.currentLocationId as string | undefined;

    if (npcId) {
      const edges = await gs.getEdges(saveId, buildEntityNodeId('npc', saveId, npcId));
      if (edges.length > 0) {
        const lines = ['<EntityGraph>'];
        lines.push('  <edges>');
        for (const edge of edges) {
          lines.push(`    <edge relation="${edge.relation}" to="${edge.toNodeId}" />`);
        }
        lines.push('  </edges>');
        lines.push('</EntityGraph>');
        return {
          content: lines.join('\n'),
          metadata: { nodeCount: 1, edgeCount: edges.length, subAgentsCount },
        };
      }
    }

    if (currentLocationId) {
      const centerNode = buildEntityNodeId('location', saveId, currentLocationId);
      const graph = await gs.getSubgraph(saveId, centerNode, 1);
      if (graph.nodes.length > 0) {
        return {
          content: this.formatGraphAsXml(graph),
          metadata: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, subAgentsCount },
        };
      }
    }

    const content = await this.buildLocationOverview(saveId, gs);
    const locationNodes = await gs.getNodesByType(saveId, 'location');
    return { content, metadata: { nodeCount: locationNodes.length, edgeCount: 0, subAgentsCount } };
  }

  /**
   * 构建 NPC 画像摘要（模块5 L2-2 业务语言重构 + 006 升级）。
   *
   * 期望效果：
   * - 结构边（LOCATED_AT/KNOWS/ALLIED_WITH 等）输出为业务标签元素（一次 getFullGraph 内存分组）
   * - 感知数据（awareness/relationship）从 EntityGraphService.getEntityRelations 独立表读取（006 升级）
   * - 输出 <WorldContext><npcProfile>... 格式，业务语言无图论术语
   * - 无关系数据的 NPC 省略输出（L3-3 边界场景：不输出空标签）
   *
   * 006 升级：awareness/relationship 已从 PERCEIVES 边 properties 迁移到独立表，
   *   不再解析 edge.properties.awarenessScore/relationshipScore（设计文档 §24）。
   *   感知数据由 getEntityRelations 从 states 表读取，结构性关系仍由 fullGraph 内存分组获取。
   *
   * 保留约束：getNodesByType/getFullGraph 是 Service 方法（LLM 不可见的程序路径），
   * 由模块4 L2-1 明确保留。本方法仅重构数据源和输出格式，不改变数据获取路径。
   */
  private async buildNpcProfileSummary(saveId: string, gs: EntityGraphService): Promise<string | null> {
    const npcNodes = await gs.getNodesByType(saveId, 'npc');
    if (npcNodes.length === 0) return null;

    // 一次 getFullGraph 获取全部边（命中缓存零开销）
    const fullGraph = await gs.getFullGraph(saveId);
    const npcNodeIds = new Set(npcNodes.map(n => n.id));
    const labelById = new Map(fullGraph.nodes.map(n => [n.id, n.label]));
    const typeById = new Map(fullGraph.nodes.map(n => [n.id, n.entityType]));

    // 内存中按 from_node_id 分组结构性出边（PERCEIVES 边的感知数据从独立表读取，此处跳过）
    const structuralOutEdgesByNode = new Map<string, EntityEdge[]>();
    for (const edge of fullGraph.edges) {
      if (edge.relation === 'PERCEIVES') continue; // PERCEIVES 由 getEntityRelations 处理
      if (npcNodeIds.has(edge.fromNodeId)) {
        if (!structuralOutEdgesByNode.has(edge.fromNodeId)) structuralOutEdgesByNode.set(edge.fromNodeId, []);
        structuralOutEdgesByNode.get(edge.fromNodeId)!.push(edge);
      }
    }

    // 生成业务语言画像摘要
    const lines = ['<WorldContext>'];
    for (const node of npcNodes) {
      // 006 升级：从独立表读取感知数据（states 表 O(1) 查询）
      const relations = await gs.getEntityRelations(saveId, 'npc', node.entityId);
      const structuralOutEdges = structuralOutEdgesByNode.get(node.id) ?? [];
      const hasPerceptions = relations.perceptions.length > 0;
      if (structuralOutEdges.length === 0 && !hasPerceptions) continue; // 无关系数据省略整个 npcProfile

      const role = (node.properties?.role as string) ?? '';
      const roleAttr = role ? ` role="${role}"` : '';
      lines.push(`  <npcProfile name="${node.label}"${roleAttr}>`);

      // 渲染结构性关系（按类型映射为业务标签元素）
      for (const edge of structuralOutEdges) {
        const targetLabel = labelById.get(edge.toNodeId) ?? edge.toNodeId;
        const targetType = typeById.get(edge.toNodeId) ?? 'unknown';
        const child = this.formatStructuralRelationTag(edge.relation, targetLabel, targetType);
        if (child) lines.push(`    ${child}`);
      }

      // 渲染感知数据（从独立 states 表读取，006 升级）
      for (const perception of relations.perceptions) {
        const targetNode = this.findNodeInFullGraph(fullGraph.nodes, perception.targetType, perception.targetId);
        if (!targetNode) continue; // 过滤已删除实体的残留数据
        const targetLabel = targetNode.label;
        const targetType = perception.targetType;

        if (perception.currentAwarenessScore !== undefined) {
          const score = Number(perception.currentAwarenessScore);
          const noteAttr = perception.awarenessNote ? ` note="${this.escapeXml(perception.awarenessNote)}"` : '';
          lines.push(`    <awareness target="${this.escapeXml(targetLabel)}" targetType="${targetType}" score="${score}"${noteAttr} />`);
        }
        if (perception.currentRelationshipScore !== undefined) {
          const score = Number(perception.currentRelationshipScore);
          const noteAttr = perception.relationshipNote ? ` note="${this.escapeXml(perception.relationshipNote)}"` : '';
          lines.push(`    <relationship target="${this.escapeXml(targetLabel)}" targetType="${targetType}" score="${score}"${noteAttr} />`);
        }
      }

      lines.push(`  </npcProfile>`);
    }
    lines.push('</WorldContext>');
    return lines.length > 2 ? lines.join('\n') : null;
  }

  /**
   * 通过 entityType + entityId 从 fullGraph 节点数组中反查节点。
   * perception.targetId 是 entity_id，fullGraph.nodes 含 entityId 字段，遍历查找。
   * NPC 数量通常有限，性能可接受（与 information-boundary-layer 的 findNodeByEntityId 对称）。
   */
  private findNodeInFullGraph(
    nodes: ReadonlyArray<{ entityType: string; entityId?: string; label: string }>,
    entityType: string,
    entityId: string,
  ): { label: string } | undefined {
    for (const node of nodes) {
      if (node.entityType === entityType && node.entityId === entityId) {
        return node;
      }
    }
    return undefined;
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 构建地点概览（模块5 L2-2 业务语言重构）。
   *
   * 期望效果：
   * - 地点节点输出为 locationOverview 元素
   * - 地点的出边按目标类型分组：npc/item/subLocation/connection
   * - 输出 <WorldContext><locationOverview>... 格式，业务语言无图论术语
   * - 无内容的地块省略输出（L3-3 边界场景：不输出空标签）
   *
   * 保留约束：getNodesByType/getFullGraph 是 Service 方法（LLM 不可见的程序路径），
   * 由模块4 L2-1 明确保留。本方法仅重构输出格式，不改变数据获取路径。
   */
  private async buildLocationOverview(saveId: string, gs: EntityGraphService): Promise<string | null> {
    const locationNodes = await gs.getNodesByType(saveId, 'location');
    if (locationNodes.length === 0) return null;

    // 一次 getFullGraph 获取全部边（可复用 buildNpcProfileSummary 的缓存）
    const fullGraph = await gs.getFullGraph(saveId);
    const locationNodeIds = new Set(locationNodes.map(n => n.id));
    const labelById = new Map(fullGraph.nodes.map(n => [n.id, n.label]));
    const typeById = new Map(fullGraph.nodes.map(n => [n.id, n.entityType]));
    const roleById = new Map(fullGraph.nodes.map(n => [n.id, (n.properties?.role as string) ?? '']));

    // 内存中按 from_node_id 分组
    const outEdgesByNode = new Map<string, EntityEdge[]>();
    for (const edge of fullGraph.edges) {
      if (locationNodeIds.has(edge.fromNodeId)) {
        if (!outEdgesByNode.has(edge.fromNodeId)) outEdgesByNode.set(edge.fromNodeId, []);
        outEdgesByNode.get(edge.fromNodeId)!.push(edge);
      }
    }

    // 生成业务语言地点概览
    const lines = ['<WorldContext>'];
    for (const node of locationNodes) {
      const outEdges = outEdgesByNode.get(node.id) ?? [];
      if (outEdges.length === 0) continue; // 无内容省略整个 locationOverview

      const level = (node.properties?.location_level as number) ?? 1;
      lines.push(`  <locationOverview name="${node.label}" level="${level}">`);

      // 按目标类型分组归类
      const npcs: string[] = [];
      const items: string[] = [];
      const subLocations: string[] = [];
      const connections: string[] = [];
      for (const edge of outEdges) {
        const targetLabel = labelById.get(edge.toNodeId) ?? edge.toNodeId;
        const targetType = typeById.get(edge.toNodeId) ?? 'unknown';

        if (targetType === 'npc') {
          const role = roleById.get(edge.toNodeId) ?? '';
          const roleAttr = role ? ` role="${role}"` : '';
          npcs.push(`      <npc name="${targetLabel}"${roleAttr} />`);
        } else if (targetType === 'item') {
          items.push(`      <item name="${targetLabel}" />`);
        } else if (targetType === 'location') {
          if (edge.relation === 'BELONGS_TO') {
            subLocations.push(`      <location name="${targetLabel}" />`);
          } else if (edge.relation === 'CONNECTED_TO') {
            connections.push(`      <connection target="${targetLabel}" />`);
          }
        }
      }

      if (npcs.length > 0) {
        lines.push('    <npcs>');
        lines.push(...npcs);
        lines.push('    </npcs>');
      }
      if (items.length > 0) {
        lines.push('    <items>');
        lines.push(...items);
        lines.push('    </items>');
      }
      if (subLocations.length > 0) {
        lines.push('    <subLocations>');
        lines.push(...subLocations);
        lines.push('    </subLocations>');
      }
      if (connections.length > 0) {
        lines.push('    <connections>');
        lines.push(...connections);
        lines.push('    </connections>');
      }

      lines.push(`  </locationOverview>`);
    }
    lines.push('</WorldContext>');
    return lines.length > 2 ? lines.join('\n') : null;
  }

  /**
   * 将结构性关系类型映射为业务标签元素。
   * 返回 null 表示关系类型无业务标签映射，调用方应跳过。
   */
  private formatStructuralRelationTag(relation: string, targetLabel: string, targetType: string): string | null {
    const tagMap: Record<string, string> = {
      LOCATED_AT: 'locatedAt',
      KNOWS: 'knows',
      ALLIED_WITH: 'alliedWith',
      HOSTILE_TO: 'hostileTo',
      OWNS: 'owns',
      HAS_SKILL: 'hasSkill',
      PARTY_MEMBER: 'partyMember',
      BELONGS_TO: 'belongsTo',
      EQUIPPED_WITH: 'equippedWith',
      AWARE_OF: 'awareOf',
      WITNESSED: 'witnessed',
      PURSUES: 'pursues',
      REQUIRES: 'requires',
      TRIGGERS: 'triggers',
      CONNECTED_TO: 'connectedTo',
    };
    const tag = tagMap[relation];
    if (tag) {
      return `<${tag} targetType="${targetType}">${targetLabel}</${tag}>`;
    }
    // 未映射的关系类型：使用通用 structuralRelation 元素（不丢失信息）
    return `<structuralRelation type="${relation}" target="${targetLabel}" targetType="${targetType}" />`;
  }

  private formatGraphAsXml(
    graph: {
      nodes: Array<{ entityType: string; label: string; id: string; entityId?: string; properties?: Record<string, unknown> }>;
      edges: Array<{ fromNodeId: string; relation: string; toNodeId: string }>;
    },
    targetNpcIds?: Set<string>,
  ): string {
    const lines = ['<EntityGraph>'];

    const locationNodes = graph.nodes.filter(n => n.entityType === 'location');
    const otherNodes = graph.nodes.filter(n => n.entityType !== 'location');
    const sortedLocationNodes = this.sortLocationNodesByHierarchy(locationNodes, graph.edges);
    const sortedNodes = [...sortedLocationNodes, ...otherNodes];

    for (const node of sortedNodes) {
      const outEdges = graph.edges.filter(e => e.fromNodeId === node.id);

      if (node.entityType === 'location') {
        lines.push(this.formatLocationNode(node, outEdges, graph));
      } else if (node.entityType === 'npc') {
        const isTarget = targetNpcIds ? this.nodeMatchesTarget(node, targetNpcIds) : false;
        lines.push(this.formatNpcNode(node, outEdges, graph, isTarget));
      } else {
        lines.push(this.formatOtherNode(node));
      }
    }

    lines.push('</EntityGraph>');
    return lines.join('\n');
  }

  /** location节点：单行格式，按层级缩进 */
  private formatLocationNode(
    node: { entityType: string; label: string; id: string; entityId?: string; properties?: Record<string, unknown> },
    outEdges: Array<{ fromNodeId: string; relation: string; toNodeId: string }>,
    graph: { nodes: Array<{ id: string; label: string }>; edges: Array<{ fromNodeId: string; relation: string; toNodeId: string }> },
  ): string {
    const level = (node.properties?.location_level as number) ?? 1;
    const indent = '  '.repeat(level);
    const name = node.label;
    const explored = node.properties?.is_explored ? 'true' : 'false';
    const dangerLevel = (node.properties?.danger_level as number) ?? 0;
    const dangerAttr = dangerLevel > 0 ? ` danger="${dangerLevel}"` : '';
    const edgeList = outEdges
      .map(e => {
        const target = graph.nodes.find(n => n.id === e.toNodeId);
        return `${e.relation}→${target?.label || e.toNodeId}`;
      })
      .join(', ');
    return `${indent}<location id="${node.id}" name="${name}" level="${level}" explored="${explored}"${dangerAttr}>${edgeList}</location>`;
  }

  /** NPC节点：对话目标完整输出，非对话目标仅核心标识 */
  private formatNpcNode(
    node: { entityType: string; label: string; id: string; entityId?: string; properties?: Record<string, unknown> },
    outEdges: Array<{ fromNodeId: string; relation: string; toNodeId: string }>,
    graph: { nodes: Array<{ id: string; label: string }>; edges: Array<{ fromNodeId: string; relation: string; toNodeId: string }> },
    isTarget: boolean,
  ): string {
    const role = (node.properties?.role as string) ?? '';
    const targetAttr = isTarget ? ' isDialogueTarget="true"' : '';

    if (!isTarget) {
      return `  <npc id="${node.id}" name="${node.label}" role="${role}" />`;
    }

    const parts: string[] = [];
    for (const edge of outEdges) {
      const target = graph.nodes.find(n => n.id === edge.toNodeId);
      parts.push(`    <edge relation="${edge.relation}" to="${target?.label || edge.toNodeId}" />`);
    }

    if (parts.length === 0) {
      return `  <npc id="${node.id}" name="${node.label}" role="${role}"${targetAttr} />`;
    }
    return `  <npc id="${node.id}" name="${node.label}" role="${role}"${targetAttr}>\n${parts.join('\n')}\n  </npc>`;
  }

  /** 其他节点类型：单行格式 */
  private formatOtherNode(
    node: { entityType: string; label: string; id: string },
  ): string {
    return `  <node id="${node.id}" name="${node.label}" type="${node.entityType}" />`;
  }

  private sortLocationNodesByHierarchy(
    locationNodes: Array<{ entityType: string; label: string; id: string; entityId?: string; properties?: Record<string, unknown> }>,
    edges: Array<{ fromNodeId: string; relation: string; toNodeId: string }>,
  ): Array<{ entityType: string; label: string; id: string; entityId?: string; properties?: Record<string, unknown> }> {
    const nodeMap = new Map(locationNodes.map(n => [n.id, n]));
    const childrenMap = new Map<string, string[]>();

    for (const node of locationNodes) {
      childrenMap.set(node.id, []);
    }

    for (const edge of edges) {
      if (edge.relation === 'BELONGS_TO' && nodeMap.has(edge.fromNodeId) && nodeMap.has(edge.toNodeId)) {
        const children = childrenMap.get(edge.toNodeId) || [];
        children.push(edge.fromNodeId);
        childrenMap.set(edge.toNodeId, children);
      }
    }

    const result: Array<{ entityType: string; label: string; id: string; entityId?: string; properties?: Record<string, unknown> }> = [];
    const visited = new Set<string>();

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (node) {
        result.push(node);
        const children = childrenMap.get(nodeId) || [];
        for (const childId of children) {
          dfs(childId);
        }
      }
    };

    // 从 level=1 的根节点开始遍历
    const roots = locationNodes
      .filter(n => ((n.properties?.location_level as number) ?? 1) <= 1)
      .map(n => n.id);
    for (const rootId of roots) {
      dfs(rootId);
    }

    // 添加未被遍历到的节点
    for (const node of locationNodes) {
      if (!visited.has(node.id)) {
        result.push(node);
      }
    }

    return result;
  }

  private nodeMatchesTarget(node: { id: string; entityId?: string }, targetNpcIds: Set<string>): boolean {
    if (targetNpcIds.size === 0) return false;
    return targetNpcIds.has(node.entityId ?? '');
  }
}
