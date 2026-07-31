import { useMemo, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './map-flow.css';
import { CurrentLocationNode } from './CurrentLocationNode';
import { DiscoveredNode } from './DiscoveredNode';
import { UndiscoveredNode } from './UndiscoveredNode';
import { PathEdge } from './PathEdge';
import { parseMermaidToFlowData } from './parseMermaidToFlowData';
import { radialLayout } from './radialLayout';
import { mapFlowStyles, mapFlowDefaultEdgeOptions } from './theme';
import { useTheme } from '@/hooks/useTheme';
import type { LocationNodeData, PathEdgeData } from './types';
import type { Node, Edge } from '@xyflow/react';

interface MiniMapFlowProps {
  mermaidCode: string;
  onNodeClick?: (nodeId: string) => void;
}

function MiniMapFlowInner({ mermaidCode, onNodeClick }: MiniMapFlowProps) {
  const colorMode = useTheme().resolvedTheme;

  const { nodes, edges } = useMemo(() => {
    const parsed = parseMermaidToFlowData(mermaidCode);
    if (parsed.nodes.length === 0) return { nodes: [], edges: [] };

    const ids = parsed.nodes.map((n) => n.id);
    const connections = parsed.edges.map((e) => ({ from: e.from, to: e.to }));
    const positions = radialLayout(ids, connections, ids[0]);

    const classMap = new Map(parsed.nodes.map((n) => [n.id, n.class]));
    const flowNodes: Node<LocationNodeData>[] = parsed.nodes.map((n) => {
      const cls = classMap.get(n.id);
      const isCurrent = cls === 'current';
      const isDiscovered = cls !== 'undiscovered';
      const pos = positions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        type: isCurrent ? 'current' : isDiscovered ? 'discovered' : 'undiscovered',
        position: pos,
        data: {
          id: n.id,
          name: n.label,
          discovered: isDiscovered,
          current: isCurrent,
        },
      };
    });

    const flowEdges: Edge<PathEdgeData>[] = parsed.edges.map((e, i) => ({
      id: `edge-${i}`,
      source: e.from,
      target: e.to,
      type: 'path',
      data: {
        isOneWay: false,
      },
      style: { stroke: 'var(--border-primary)', strokeWidth: 1.5 },
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [mermaidCode]);

  const nodeTypes = useMemo(() => ({
    current: CurrentLocationNode,
    discovered: DiscoveredNode,
    undiscovered: UndiscoveredNode,
  }), []);

  const edgeTypes = useMemo(() => ({
    path: PathEdge,
  }), []);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'undiscovered') return;
    onNodeClick?.(node.id);
  }, [onNodeClick]);

  if (nodes.length === 0) {
    return (
      <div className="p-2 text-xs text-[var(--text-muted)]">
        无法解析地图数据
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

export function MiniMapFlow(props: MiniMapFlowProps) {
  return (
    <div style={{ height: 300, background: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden' }}>
      <ReactFlowProvider>
        <MiniMapFlowInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
