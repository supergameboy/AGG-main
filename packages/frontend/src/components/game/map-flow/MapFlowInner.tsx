import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './map-flow.css';
import { CurrentLocationNode } from './CurrentLocationNode';
import { DiscoveredNode } from './DiscoveredNode';
import { UndiscoveredNode } from './UndiscoveredNode';
import { PathEdge } from './PathEdge';
import { useMapFlowData } from './useMapFlowData';
import { mapFlowStyles, mapFlowDefaultEdgeOptions } from './theme';
import { useTheme } from '@/hooks/useTheme';
import type { FrontendMapLocation, FrontendMapConnection } from '@/types';

interface MapFlowInnerProps {
  locations: FrontendMapLocation[];
  connections: FrontendMapConnection[];
  currentLocationId?: string;
  discoveredLocationIds?: string[];
  selectedId?: string | null;
  onNodeClick?: (locationId: string) => void;
  regionOnly?: boolean;
}

export function MapFlowInner({
  locations,
  connections,
  currentLocationId,
  discoveredLocationIds,
  selectedId,
  onNodeClick,
  regionOnly,
}: MapFlowInnerProps) {
  const { nodes, edges } = useMapFlowData(
    locations,
    connections,
    currentLocationId,
    discoveredLocationIds,
    selectedId,
    regionOnly
  );
  const { fitView } = useReactFlow();
  const colorMode = useTheme().resolvedTheme;

  useEffect(() => {
    if (currentLocationId) {
      fitView({ nodes: [{ id: currentLocationId }], padding: 0.5, duration: 300 });
    }
  }, [currentLocationId, fitView]);

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
