import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  type Node,
  Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../map-flow/map-flow.css';
import { ChildLocationNode } from './ChildLocationNode';
import { EntryPointNode } from './EntryPointNode';
import { useMiniMapData } from './useMiniMapData';
import { mapFlowStyles, mapFlowDefaultEdgeOptions } from '../map-flow/theme';
import { useTheme } from '@/hooks/useTheme';
import type { ChildLocationNodeData, EntryPointNodeData } from './types';
import { useMapStore } from '@/stores/mapStore';

interface MiniMapFlowProps {
  onTravel?: (locationId: string, locationName?: string) => void;
}

export function MiniMapFlow({ onTravel }: MiniMapFlowProps) {
  const colorMode = useTheme().resolvedTheme;
  const { childNodes, entryNodes, childEdges } = useMiniMapData();
  const currentLocationId = useMapStore((s) => s.mapState.currentLocationId);

  const { nodes, edges } = useMemo(() => {
    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];

    const centerChild = childNodes.find((c) => c.isCurrentLocation);
    const centerX = 0;
    const centerY = 0;

    const childPositions = new Map<string, { x: number; y: number }>();
    if (centerChild) {
      childPositions.set(centerChild.id, { x: centerX, y: centerY });
    }

    const otherChildren = childNodes.filter((c) => !c.isCurrentLocation);
    const radius = 140;
    for (let i = 0; i < otherChildren.length; i++) {
      const angle = (2 * Math.PI * i) / otherChildren.length - Math.PI / 2;
      childPositions.set(otherChildren[i].id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    }

    for (const child of childNodes) {
      const pos = childPositions.get(child.id) ?? { x: 0, y: 0 };
      allNodes.push({
        id: child.id,
        type: 'childLocation',
        position: pos,
        data: child,
      });
    }

    const entryRadius = 260;
    for (let i = 0; i < entryNodes.length; i++) {
      const angle = (2 * Math.PI * i) / Math.max(entryNodes.length, 1) - Math.PI / 2;
      allNodes.push({
        id: entryNodes[i].id,
        type: 'entryPoint',
        position: {
          x: centerX + entryRadius * Math.cos(angle),
          y: centerY + entryRadius * Math.sin(angle),
        },
        data: entryNodes[i],
      });
    }

    for (const edge of childEdges) {
      allEdges.push({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'default',
        style: edge.isEntryEdge
          ? { stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 4' }
          : { stroke: 'var(--border-primary)', strokeWidth: 1.5 },
      });
    }

    return { nodes: allNodes, edges: allEdges };
  }, [childNodes, entryNodes, childEdges]);

  const nodeTypes = useMemo(() => ({
    childLocation: ChildLocationNode,
    entryPoint: EntryPointNode,
  }), []);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'entryPoint') {
      const d = node.data as unknown as EntryPointNodeData;
      onTravel?.(d.id.replace('entry-', ''), d.regionName);
      return;
    }
    if (node.type === 'childLocation') {
      const d = node.data as unknown as ChildLocationNodeData;
      if (d.id !== currentLocationId) {
        onTravel?.(d.id, d.name);
      }
    }
  }, [onTravel, currentLocationId]);

  if (childNodes.length === 0 && entryNodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-[var(--text-muted)]">
        暂无区域详情
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      defaultEdgeOptions={mapFlowDefaultEdgeOptions}
      fitView
      colorMode={colorMode}
      nodeOrigin={[0.5, 0.5]}
      minZoom={0.5}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={mapFlowStyles}
    >
      <Background color="var(--border-primary)" gap={16} size={0.5} />
    </ReactFlow>
  );
}
