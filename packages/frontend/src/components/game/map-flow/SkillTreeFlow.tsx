import { useMemo, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MarkerType, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './map-flow.css';
import { SkillNode } from './SkillNode';
import { PathEdge } from './PathEdge';
import { parseMermaidToFlowData } from './parseMermaidToFlowData';
import { mapFlowStyles, mapFlowDefaultEdgeOptions } from './theme';
import { useTheme } from '@/hooks/useTheme';
import type { SkillNodeData, PathEdgeData } from './types';
import type { Node, Edge } from '@xyflow/react';

interface SkillTreeFlowProps {
  mermaidCode: string;
  onNodeClick?: (nodeId: string) => void;
}

function computeTreeLayout(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodeIds.length === 0) return positions;

  const childMap = new Map<string, string[]>();
  const parentCount = new Map<string, number>();
  for (const id of nodeIds) {
    childMap.set(id, []);
    parentCount.set(id, 0);
  }
  for (const e of edges) {
    if (childMap.has(e.from) && childMap.has(e.to)) {
      childMap.get(e.from)!.push(e.to);
      parentCount.set(e.to, (parentCount.get(e.to) ?? 0) + 1);
    }
  }

  const roots = nodeIds.filter((id) => (parentCount.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  const levelNodes = new Map<number, string[]>();

  const queue: Array<{ id: string; level: number }> = roots.map((id) => ({ id, level: 0 }));
  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (!levelNodes.has(level)) levelNodes.set(level, []);
    levelNodes.get(level)!.push(id);
    for (const child of childMap.get(id) ?? []) {
      if (!visited.has(child)) {
        queue.push({ id: child, level: level + 1 });
      }
    }
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      const maxLevel = Math.max(0, ...Array.from(levelNodes.keys()));
      const level = maxLevel + 1;
      if (!levelNodes.has(level)) levelNodes.set(level, []);
      levelNodes.get(level)!.push(id);
    }
  }

  const H_GAP = 160;
  const V_GAP = 100;

  for (const [level, ids] of levelNodes) {
    const totalWidth = (ids.length - 1) * H_GAP;
    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], {
        x: -totalWidth / 2 + i * H_GAP,
        y: level * V_GAP,
      });
    }
  }

  return positions;
}

function SkillTreeFlowInner({ mermaidCode, onNodeClick }: SkillTreeFlowProps) {
  const colorMode = useTheme().resolvedTheme;

  const { nodes, edges } = useMemo(() => {
    const parsed = parseMermaidToFlowData(mermaidCode);
    if (parsed.nodes.length === 0) return { nodes: [], edges: [] };

    const ids = parsed.nodes.map((n) => n.id);
    const connections = parsed.edges.map((e) => ({ from: e.from, to: e.to }));
    const positions = computeTreeLayout(ids, connections);

    const flowNodes: Node<SkillNodeData>[] = parsed.nodes.map((n) => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      const cls = n.class;
      return {
        id: n.id,
        type: 'skill',
        position: pos,
        data: {
          id: n.id,
          name: n.label,
          unlocked: cls !== 'locked',
          skillType: cls,
        },
      };
    });

    const flowEdges: Edge<PathEdgeData>[] = parsed.edges.map((e, i) => ({
      id: `edge-${i}`,
      source: e.from,
      target: e.to,
      type: 'path',
      data: {
        isOneWay: true,
      },
      style: { stroke: 'var(--border-primary)', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--border-primary)' },
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [mermaidCode]);

  const nodeTypes = useMemo(() => ({
    skill: SkillNode,
  }), []);

  const edgeTypes = useMemo(() => ({
    path: PathEdge,
  }), []);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    onNodeClick?.(node.id);
  }, [onNodeClick]);

  if (nodes.length === 0) {
    return (
      <div className="p-2 text-xs text-[var(--text-muted)]">
        无法解析技能树数据
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      defaultEdgeOptions={mapFlowDefaultEdgeOptions}
      fitView
      colorMode={colorMode}
      nodeOrigin={[0.5, 0.5]}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={mapFlowStyles}
    >
      <Background color="var(--border-primary)" gap={20} size={1} />
      <Controls position="bottom-left" />
    </ReactFlow>
  );
}

export function SkillTreeFlow(props: SkillTreeFlowProps) {
  return (
    <div style={{ height: 300, background: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden' }}>
      <ReactFlowProvider>
        <SkillTreeFlowInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
