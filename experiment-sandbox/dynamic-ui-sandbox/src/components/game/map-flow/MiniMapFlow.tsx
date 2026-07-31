import { CurrentLocationNode } from './CurrentLocationNode';
import { DiscoveredNode } from './DiscoveredNode';
import { UndiscoveredNode } from './UndiscoveredNode';
import { MermaidRenderer } from './MermaidRenderer';
import type { ParsedFlowNode } from './parseMermaidToFlowData';
import type { Node } from '@xyflow/react';

interface MiniMapFlowProps {
  mermaidCode: string;
  onNodeClick?: (nodeId: string) => void;
}

const nodeTypes = {
  current: CurrentLocationNode,
  discovered: DiscoveredNode,
  undiscovered: UndiscoveredNode,
};

const layoutOptions = { levelGap: 250, siblingGap: 120 };

function mapLocationNode(n: ParsedFlowNode, position: { x: number; y: number }): Node {
  const isCurrent = n.class === 'current';
  const isDiscovered = n.class !== 'undiscovered';
  return {
    id: n.id,
    type: isCurrent ? 'current' : isDiscovered ? 'discovered' : 'undiscovered',
    position,
    data: {
      id: n.id,
      name: n.label,
      discovered: isDiscovered,
      current: isCurrent,
      customStyle: n.style,
    },
  };
}

export function MiniMapFlow({ mermaidCode, onNodeClick }: MiniMapFlowProps) {
  return (
    <MermaidRenderer
      mermaidCode={mermaidCode}
      nodeTypes={nodeTypes}
      mapNode={mapLocationNode}
      layoutOptions={layoutOptions}
      emptyHint="无法解析地图数据"
      onNodeClick={(node) => {
        if (node.type === 'undiscovered') return;
        onNodeClick?.(node.id);
      }}
    />
  );
}
