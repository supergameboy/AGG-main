import { describe, expect, it, vi } from 'vitest';
import { EntityGraphLayer } from '../entity-graph-layer.js';
import type { PromptContext } from '../types.js';
import type { EntityGraphService } from '../../../../game-systems/entity-graph/EntityGraphService.js';
import type { EntityNode, EntityEdge, EntitySubgraph, EntityType, RelationType } from '../../../../game-systems/entity-graph/types.js';

/**
 * EntityGraphLayer 业务语言重构测试
 *
 * 设计文档：docs/design/fractal-design-20260716-entity-graph-simplification/
 *           fractal-design-20260716-entity-graph-simplification-模块5-提示词与配置清理.md
 * 章节：L2-2 + L3-3（entity-graph-layer.ts 业务语言重构 + 输出格式详细设计）
 *
 * 验证点：
 * 1. buildNpcProfileSummary 输出 <WorldContext><npcProfile>... 格式（非 <EntityGraph><node>）
 * 2. PERCEIVES 边解析 awarenessScore/relationshipScore（模块3 新模型 -10~+10）
 * 3. 结构性关系（LOCATED_AT/KNOWS 等）映射为业务标签元素（locatedAt/knows 等）
 * 4. 无关系数据的 NPC 省略输出（L3-3 边界场景：不输出空标签）
 * 5. buildLocationOverview 输出 <WorldContext><locationOverview>... 格式
 * 6. 地点出边按目标类型分组：npc/item/subLocation/connection
 * 7. note 可选（无 note 时省略 note 属性）
 * 8. 无 NPC/无 location 时返回 null
 * 9. 内部 Service 方法调用保留（getNodesByType/getFullGraph）
 */

// === 测试辅助构造函数 ===

function makeNode(overrides: Partial<EntityNode> & { id: string; entityType: EntityType; entityId: string; label: string }): EntityNode {
  return {
    saveId: 'save-1',
    properties: {},
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<EntityEdge> & { fromNodeId: string; toNodeId: string; relation: RelationType }): EntityEdge {
  return {
    id: `edge-${overrides.fromNodeId}-${overrides.toNodeId}-${overrides.relation}`,
    saveId: 'save-1',
    weight: 1,
    properties: {},
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeGraphService(
  nodes: EntityNode[],
  edges: EntityEdge[],
  options: {
    npcNodes?: EntityNode[];
    locationNodes?: EntityNode[];
  } = {},
): EntityGraphService {
  const fullGraph: EntitySubgraph = { nodes, edges };
  const npcNodes = options.npcNodes ?? nodes.filter(n => n.entityType === 'npc');
  const locationNodes = options.locationNodes ?? nodes.filter(n => n.entityType === 'location');
  const nodeById = new Map<string, EntityNode>(nodes.map(n => [n.id, n]));

  return {
    getFullGraph: vi.fn().mockResolvedValue(fullGraph),
    getNodesByType: vi.fn(async (_saveId: string, type: EntityType) => {
      if (type === 'npc') return npcNodes;
      if (type === 'location') return locationNodes;
      return nodes.filter(n => n.entityType === type);
    }),
    getSubgraph: vi.fn().mockResolvedValue(fullGraph),
    getEdges: vi.fn(async (_saveId: string, nodeId: string) => edges.filter(e => e.fromNodeId === nodeId || e.toNodeId === nodeId)),
    // getEntityRelations: 模拟生产实现，从 edges 中筛选 PERCEIVES 边构造 perceptions
    // 调用方 entity-graph-layer.ts:189 用于读取 NPC 感知数据（006 升级后从独立 states 表读）
    getEntityRelations: vi.fn(async (_saveId: string, entityType: EntityType, entityId: string) => {
      const node = nodes.find(n => n.entityType === entityType && n.entityId === entityId);
      if (!node) {
        throw new Error(`实体不存在: entityType=${entityType}, entityId=${entityId}`);
      }
      const perceptions: Array<{
        targetId: string;
        targetType: string;
        currentRelationshipScore?: number;
        relationshipNote?: string;
        currentAwarenessScore?: number;
        awarenessNote?: string;
      }> = [];
      const structuralRelations: Array<{ targetId: string; targetType: string; relation: RelationType }> = [];
      for (const edge of edges) {
        if (edge.fromNodeId !== node.id && edge.toNodeId !== node.id) continue;
        const isOutgoing = edge.fromNodeId === node.id;
        const otherNodeId = isOutgoing ? edge.toNodeId : edge.fromNodeId;
        const otherNode = nodeById.get(otherNodeId);
        if (!otherNode) continue;
        if (edge.relation === 'PERCEIVES' && isOutgoing) {
          perceptions.push({
            targetId: otherNode.entityId,
            targetType: otherNode.entityType,
            currentAwarenessScore: edge.properties?.awarenessScore as number | undefined,
            awarenessNote: edge.properties?.awarenessNote as string | undefined,
            currentRelationshipScore: edge.properties?.relationshipScore as number | undefined,
            relationshipNote: edge.properties?.relationshipNote as string | undefined,
          });
        } else if (edge.relation !== 'PERCEIVES') {
          structuralRelations.push({
            targetId: otherNode.entityId,
            targetType: otherNode.entityType,
            relation: edge.relation,
          });
        }
      }
      return { structuralRelations, perceptions };
    }),
  } as unknown as EntityGraphService;
}

function makeContext(agentKey: string, domain: Record<string, unknown>): PromptContext {
  return {
    agentKey,
    agentConfig: { tools: [] },
    excludedMethods: [],
    language: 'zh',
    templateContext: null,
    domain: { saveId: 'save-1', ...domain },
    options: {},
    message: {},
  };
}

// === 测试用例 ===

describe('EntityGraphLayer - L2-2 业务语言重构', () => {
  const layer = new EntityGraphLayer();

  describe('buildNpcProfileSummary（NPC 画像摘要）', () => {
    it('L3-3 场景1：NPC 画像含 PERCEIVES 边，输出 <WorldContext><npcProfile> + awareness/relationship 评分', async () => {
      // 场景：村长对玩家 Hero 有认识值 8 和关系值 5
      const playerNode = makeNode({ id: 'char:save-1:hero', entityType: 'character', entityId: 'char-hero', label: 'Hero' });
      const npcNode = makeNode({
        id: 'npc:save-1:npc-village-head',
        entityType: 'npc',
        entityId: 'npc-village-head',
        label: '村长艾德温',
        properties: { role: 'village_head' },
      });
      const perceivesEdge = makeEdge({
        fromNodeId: npcNode.id,
        toNodeId: playerNode.id,
        relation: 'PERCEIVES',
        properties: {
          awarenessScore: 8,
          awarenessNote: '本村英雄',
          relationshipScore: 5,
          relationshipNote: '曾经救过我的命',
        },
      });

      const gs = makeGraphService([playerNode, npcNode], [perceivesEdge]);
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      expect(result.content).not.toBeNull();
      const content = result.content as string;
      // 业务语言标签（非图论术语）
      expect(content).toContain('<WorldContext>');
      expect(content).toContain('<npcProfile');
      expect(content).not.toContain('<EntityGraph>');
      expect(content).not.toContain('<node ');
      // PERCEIVES 边解析为 awareness + relationship 元素
      expect(content).toContain('<awareness target="Hero" targetType="character" score="8" note="本村英雄" />');
      expect(content).toContain('<relationship target="Hero" targetType="character" score="5" note="曾经救过我的命" />');
      // 角色属性
      expect(content).toContain('name="村长艾德温"');
      expect(content).toContain('role="village_head"');
    });

    it('L3-3 边界场景：PERCEIVES 边仅含 awarenessScore 时，只输出 awareness 元素（不输出空 relationship）', async () => {
      const playerNode = makeNode({ id: 'char:save-1:hero', entityType: 'character', entityId: 'char-hero', label: 'Hero' });
      const npcNode = makeNode({
        id: 'npc:save-1:npc-merchant',
        entityType: 'npc',
        entityId: 'npc-merchant',
        label: '商人',
      });
      const perceivesEdge = makeEdge({
        fromNodeId: npcNode.id,
        toNodeId: playerNode.id,
        relation: 'PERCEIVES',
        properties: { awarenessScore: 6 }, // 仅 awarenessScore，无 relationshipScore
      });

      const gs = makeGraphService([playerNode, npcNode], [perceivesEdge]);
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      const content = result.content as string;
      expect(content).toContain('<awareness target="Hero" targetType="character" score="6"');
      expect(content).not.toContain('note="');
      // 不应输出空 relationship 元素
      expect(content).not.toContain('<relationship ');
    });

    it('L3-3 边界场景：awarenessScore=0 是有效值，应输出', async () => {
      const playerNode = makeNode({ id: 'char:save-1:hero', entityType: 'character', entityId: 'char-hero', label: 'Hero' });
      const npcNode = makeNode({ id: 'npc:save-1:npc-b', entityType: 'npc', entityId: 'npc-b', label: '路人B' });
      const perceivesEdge = makeEdge({
        fromNodeId: npcNode.id,
        toNodeId: playerNode.id,
        relation: 'PERCEIVES',
        properties: { awarenessScore: 0, relationshipScore: 0 },
      });

      const gs = makeGraphService([playerNode, npcNode], [perceivesEdge]);
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      const content = result.content as string;
      expect(content).toContain('score="0"');
    });

    it('L3-3 场景2：结构性关系（LOCATED_AT/KNOWS）映射为业务标签 locatedAt/knows', async () => {
      const locationNode = makeNode({ id: 'loc:save-1:loc-plaza', entityType: 'location', entityId: 'loc-plaza', label: '村中心广场' });
      const friendNode = makeNode({ id: 'npc:save-1:npc-smith', entityType: 'npc', entityId: 'npc-smith', label: '铁匠老张' });
      const npcNode = makeNode({ id: 'npc:save-1:npc-head', entityType: 'npc', entityId: 'npc-head', label: '村长' });

      const edges: EntityEdge[] = [
        makeEdge({ fromNodeId: npcNode.id, toNodeId: locationNode.id, relation: 'LOCATED_AT' }),
        makeEdge({ fromNodeId: npcNode.id, toNodeId: friendNode.id, relation: 'KNOWS' }),
      ];

      const gs = makeGraphService([locationNode, friendNode, npcNode], edges, { npcNodes: [npcNode] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      const content = result.content as string;
      expect(content).toContain('<locatedAt targetType="location">村中心广场</locatedAt>');
      expect(content).toContain('<knows targetType="npc">铁匠老张</knows>');
    });

    it('L3-3 边界场景：无关系数据的 NPC 省略输出（不输出空 npcProfile）', async () => {
      // 场景：两个 NPC，一个有关系，一个无关系
      const playerNode = makeNode({ id: 'char:save-1:hero', entityType: 'character', entityId: 'char-hero', label: 'Hero' });
      const npcWithRelations = makeNode({ id: 'npc:save-1:npc-a', entityType: 'npc', entityId: 'npc-a', label: '有关系的NPC' });
      const npcWithoutRelations = makeNode({ id: 'npc:save-1:npc-b', entityType: 'npc', entityId: 'npc-b', label: '无关系的NPC' });

      const edges: EntityEdge[] = [
        makeEdge({ fromNodeId: npcWithRelations.id, toNodeId: playerNode.id, relation: 'PERCEIVES', properties: { awarenessScore: 5 } }),
      ];

      const gs = makeGraphService([playerNode, npcWithRelations, npcWithoutRelations], edges, {
        npcNodes: [npcWithRelations, npcWithoutRelations],
      });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      const content = result.content as string;
      expect(content).toContain('name="有关系的NPC"');
      expect(content).not.toContain('无关系的NPC');
    });

    it('L3-3 边界场景：所有 NPC 都无关系数据，返回 null（不输出空 <WorldContext></WorldContext>）', async () => {
      const npcNode = makeNode({ id: 'npc:save-1:npc-lonely', entityType: 'npc', entityId: 'npc-lonely', label: '孤独NPC' });
      const gs = makeGraphService([npcNode], [], { npcNodes: [npcNode] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      expect(result.content).toBeNull();
    });

    it('L3-3 边界场景：无 NPC 节点，返回 null', async () => {
      const gs = makeGraphService([], [], { npcNodes: [] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      expect(result.content).toBeNull();
    });

    it('L2-2 保留约束：仅使用 getNodesByType + getFullGraph，不调用已删除方法', async () => {
      const npcNode = makeNode({
        id: 'npc:save-1:npc-x',
        entityType: 'npc',
        entityId: 'npc-x',
        label: 'X',
      });
      const playerNode = makeNode({ id: 'char:save-1:hero', entityType: 'character', entityId: 'char-hero', label: 'Hero' });
      const edge = makeEdge({
        fromNodeId: npcNode.id,
        toNodeId: playerNode.id,
        relation: 'PERCEIVES',
        properties: { awarenessScore: 3 },
      });
      const gs = makeGraphService([npcNode, playerNode], [edge], { npcNodes: [npcNode] });
      const ctx = makeContext('npc_party', { graphService: gs });

      await layer.build(ctx);

      // 验证：调用了 getNodesByType 和 getFullGraph
      expect(gs.getNodesByType).toHaveBeenCalledWith('save-1', 'npc');
      expect(gs.getFullGraph).toHaveBeenCalledWith('save-1');
    });
  });

  describe('buildLocationOverview（地点概览）', () => {
    it('L3-3 场景：地点出边按目标类型分组为 npcs/items/subLocations/connections', async () => {
      const locationNode = makeNode({
        id: 'loc:save-1:loc-village',
        entityType: 'location',
        entityId: 'loc-village',
        label: '白杨村',
        properties: { location_level: 1 },
      });
      const subLocationNode = makeNode({
        id: 'loc:save-1:loc-head-house',
        entityType: 'location',
        entityId: 'loc-head-house',
        label: '村长家',
        properties: { location_level: 2 },
      });
      const connectedLocationNode = makeNode({
        id: 'loc:save-1:loc-road',
        entityType: 'location',
        entityId: 'loc-road',
        label: '城外道路',
        properties: { location_level: 1 },
      });
      const npcNode = makeNode({
        id: 'npc:save-1:npc-head',
        entityType: 'npc',
        entityId: 'npc-head',
        label: '村长艾德温',
        properties: { role: '村长' },
      });
      const itemNode = makeNode({ id: 'item:save-1:item-sword', entityType: 'item', entityId: 'item-sword', label: '村长家的剑' });

      const edges: EntityEdge[] = [
        makeEdge({ fromNodeId: locationNode.id, toNodeId: npcNode.id, relation: 'OWNS' }),
        makeEdge({ fromNodeId: locationNode.id, toNodeId: itemNode.id, relation: 'OWNS' }),
        makeEdge({ fromNodeId: subLocationNode.id, toNodeId: locationNode.id, relation: 'BELONGS_TO' }),
        // 注意：BELONGS_TO 的 fromNodeId 是子地点，toNodeId 是父地点
        // buildLocationOverview 处理的是 locationNode 的出边，所以需要用 locationNode 作为 fromNode 的边
        makeEdge({ fromNodeId: locationNode.id, toNodeId: connectedLocationNode.id, relation: 'CONNECTED_TO' }),
      ];

      const gs = makeGraphService(
        [locationNode, subLocationNode, connectedLocationNode, npcNode, itemNode],
        edges,
        { locationNodes: [locationNode, subLocationNode, connectedLocationNode] },
      );
      const ctx = makeContext('output', { graphService: gs });

      const result = await layer.build(ctx);

      const content = result.content as string;
      // 业务语言标签
      expect(content).toContain('<WorldContext>');
      expect(content).toContain('<locationOverview');
      expect(content).not.toContain('<EntityGraph>');
      // 属性
      expect(content).toContain('name="白杨村"');
      expect(content).toContain('level="1"');
      // 分组归类
      expect(content).toContain('<npcs>');
      expect(content).toContain('<npc name="村长艾德温" role="村长" />');
      expect(content).toContain('<items>');
      expect(content).toContain('<item name="村长家的剑" />');
      expect(content).toContain('<connections>');
      expect(content).toContain('<connection target="城外道路" />');
    });

    it('L3-3 边界场景：无内容的地点省略输出', async () => {
      const emptyLocation = makeNode({
        id: 'loc:save-1:loc-empty',
        entityType: 'location',
        entityId: 'loc-empty',
        label: '空地点',
        properties: { location_level: 1 },
      });
      const richLocation = makeNode({
        id: 'loc:save-1:loc-rich',
        entityType: 'location',
        entityId: 'loc-rich',
        label: '富地点',
        properties: { location_level: 1 },
      });
      const npcNode = makeNode({ id: 'npc:save-1:npc-1', entityType: 'npc', entityId: 'npc-1', label: 'NPC1' });

      const edges: EntityEdge[] = [
        makeEdge({ fromNodeId: richLocation.id, toNodeId: npcNode.id, relation: 'OWNS' }),
      ];

      const gs = makeGraphService([emptyLocation, richLocation, npcNode], edges, {
        locationNodes: [emptyLocation, richLocation],
      });
      const ctx = makeContext('output', { graphService: gs });

      const result = await layer.build(ctx);

      const content = result.content as string;
      expect(content).toContain('name="富地点"');
      expect(content).not.toContain('空地点');
    });

    it('L3-3 边界场景：所有地点都无内容，返回 null', async () => {
      const emptyLocation = makeNode({
        id: 'loc:save-1:loc-empty',
        entityType: 'location',
        entityId: 'loc-empty',
        label: '空地点',
      });
      const gs = makeGraphService([emptyLocation], [], { locationNodes: [emptyLocation] });
      const ctx = makeContext('output', { graphService: gs });

      const result = await layer.build(ctx);

      expect(result.content).toBeNull();
    });

    it('L3-3 边界场景：无 location 节点，返回 null', async () => {
      const gs = makeGraphService([], [], { locationNodes: [] });
      const ctx = makeContext('output', { graphService: gs });

      const result = await layer.build(ctx);

      expect(result.content).toBeNull();
    });

    it('L2-2 保留约束：仅使用 getNodesByType + getFullGraph', async () => {
      const locationNode = makeNode({
        id: 'loc:save-1:loc-1',
        entityType: 'location',
        entityId: 'loc-1',
        label: '地点1',
      });
      const npcNode = makeNode({ id: 'npc:save-1:npc-1', entityType: 'npc', entityId: 'npc-1', label: 'NPC1' });
      const edge = makeEdge({ fromNodeId: locationNode.id, toNodeId: npcNode.id, relation: 'OWNS' });

      const gs = makeGraphService([locationNode, npcNode], [edge], { locationNodes: [locationNode] });
      const ctx = makeContext('output', { graphService: gs });

      await layer.build(ctx);

      expect(gs.getNodesByType).toHaveBeenCalledWith('save-1', 'location');
      expect(gs.getFullGraph).toHaveBeenCalledWith('save-1');
    });

    it('BELONGS_TO 关系归类为 subLocations', async () => {
      const parentLocation = makeNode({
        id: 'loc:save-1:loc-parent',
        entityType: 'location',
        entityId: 'loc-parent',
        label: '父地点',
        properties: { location_level: 1 },
      });
      const childLocation = makeNode({
        id: 'loc:save-1:loc-child',
        entityType: 'location',
        entityId: 'loc-child',
        label: '子地点',
        properties: { location_level: 2 },
      });

      // buildLocationOverview 处理 locationNode 出边
      // BELONGS_TO 在 sortLocationNodesByHierarchy 中是子→父，但在 buildLocationOverview 中按 fromNodeId 分组
      // 所以这里构造父→子的边（虽然实际 BELONGS_TO 是子→父，但测试 buildLocationOverview 的分组逻辑）
      const edges: EntityEdge[] = [
        makeEdge({ fromNodeId: parentLocation.id, toNodeId: childLocation.id, relation: 'BELONGS_TO' }),
      ];

      const gs = makeGraphService([parentLocation, childLocation], edges, {
        locationNodes: [parentLocation, childLocation],
      });
      const ctx = makeContext('output', { graphService: gs });

      const result = await layer.build(ctx);

      const content = result.content as string;
      expect(content).toContain('<subLocations>');
      expect(content).toContain('<location name="子地点" />');
    });
  });

  describe('build 入口分发', () => {
    it('agentKey=npc_party 走 buildNpcProfileSummary 路径', async () => {
      const npcNode = makeNode({
        id: 'npc:save-1:npc-1',
        entityType: 'npc',
        entityId: 'npc-1',
        label: 'NPC1',
      });
      const playerNode = makeNode({ id: 'char:save-1:hero', entityType: 'character', entityId: 'char-hero', label: 'Hero' });
      const edge = makeEdge({
        fromNodeId: npcNode.id,
        toNodeId: playerNode.id,
        relation: 'PERCEIVES',
        properties: { awarenessScore: 5 },
      });
      const gs = makeGraphService([npcNode, playerNode], [edge], { npcNodes: [npcNode] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);

      expect(result.content).toContain('<npcProfile');
    });

    it('agentKey=output 走 buildLocationOverview 路径（无 npcId/currentLocationId 时）', async () => {
      const locationNode = makeNode({
        id: 'loc:save-1:loc-1',
        entityType: 'location',
        entityId: 'loc-1',
        label: '地点1',
      });
      const npcNode = makeNode({ id: 'npc:save-1:npc-1', entityType: 'npc', entityId: 'npc-1', label: 'NPC1' });
      const edge = makeEdge({ fromNodeId: locationNode.id, toNodeId: npcNode.id, relation: 'OWNS' });

      const gs = makeGraphService([locationNode, npcNode], [edge], { locationNodes: [locationNode] });
      const ctx = makeContext('output', { graphService: gs });

      const result = await layer.build(ctx);

      expect(result.content).toContain('<locationOverview');
    });

    it('无 saveId 时返回空内容', async () => {
      const ctx = makeContext('npc_party', {}); // 无 saveId
      const result = await layer.build(ctx);
      expect(result.content).toBeNull();
    });

    it('无 graphService 时返回空内容', async () => {
      const ctx = makeContext('npc_party', { saveId: 'save-1' }); // 无 graphService
      const result = await layer.build(ctx);
      expect(result.content).toBeNull();
    });
  });

  describe('formatStructuralRelationTag - 结构性关系映射', () => {
    it('LOCATED_AT 映射为 locatedAt', async () => {
      const loc = makeNode({ id: 'loc:save-1:loc-1', entityType: 'location', entityId: 'loc-1', label: '地点' });
      const npc = makeNode({ id: 'npc:save-1:npc-1', entityType: 'npc', entityId: 'npc-1', label: 'NPC' });
      const edge = makeEdge({ fromNodeId: npc.id, toNodeId: loc.id, relation: 'LOCATED_AT' });

      const gs = makeGraphService([loc, npc], [edge], { npcNodes: [npc] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);
      expect(result.content).toContain('<locatedAt targetType="location">地点</locatedAt>');
    });

    it('ALLIED_WITH 映射为 alliedWith', async () => {
      const npc1 = makeNode({ id: 'npc:save-1:npc-1', entityType: 'npc', entityId: 'npc-1', label: 'NPC1' });
      const npc2 = makeNode({ id: 'npc:save-1:npc-2', entityType: 'npc', entityId: 'npc-2', label: 'NPC2' });
      const edge = makeEdge({ fromNodeId: npc1.id, toNodeId: npc2.id, relation: 'ALLIED_WITH' });

      const gs = makeGraphService([npc1, npc2], [edge], { npcNodes: [npc1] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);
      expect(result.content).toContain('<alliedWith targetType="npc">NPC2</alliedWith>');
    });

    it('HOSTILE_TO 映射为 hostileTo', async () => {
      const npc1 = makeNode({ id: 'npc:save-1:npc-1', entityType: 'npc', entityId: 'npc-1', label: 'NPC1' });
      const npc2 = makeNode({ id: 'npc:save-1:npc-2', entityType: 'npc', entityId: 'npc-2', label: 'NPC2' });
      const edge = makeEdge({ fromNodeId: npc1.id, toNodeId: npc2.id, relation: 'HOSTILE_TO' });

      const gs = makeGraphService([npc1, npc2], [edge], { npcNodes: [npc1] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);
      expect(result.content).toContain('<hostileTo targetType="npc">NPC2</hostileTo>');
    });

    it('未映射的关系类型使用通用 structuralRelation 元素（不丢失信息）', async () => {
      const npc1 = makeNode({ id: 'npc:save-1:npc-1', entityType: 'npc', entityId: 'npc-1', label: 'NPC1' });
      const npc2 = makeNode({ id: 'npc:save-1:npc-2', entityType: 'npc', entityId: 'npc-2', label: 'NPC2' });
      // 自定义关系类型（不在 tagMap 中）
      const edge = makeEdge({ fromNodeId: npc1.id, toNodeId: npc2.id, relation: 'CUSTOM_RELATION' as RelationType });

      const gs = makeGraphService([npc1, npc2], [edge], { npcNodes: [npc1] });
      const ctx = makeContext('npc_party', { graphService: gs });

      const result = await layer.build(ctx);
      expect(result.content).toContain('<structuralRelation type="CUSTOM_RELATION" target="NPC2" targetType="npc" />');
    });
  });
});
