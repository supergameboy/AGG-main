import { SkillNode } from './SkillNode';
import { MermaidRenderer } from './MermaidRenderer';
import type { ParsedFlowNode } from './parseMermaidToFlowData';
import type { Node } from '@xyflow/react';

interface SkillTreeFlowProps {
  mermaidCode: string;
  onNodeClick?: (nodeId: string) => void;
}

const nodeTypes = {
  skill: SkillNode,
};

const layoutOptions = { levelGap: 100, siblingGap: 170 };

function mapSkillNode(n: ParsedFlowNode, position: { x: number; y: number }): Node {
  return {
    id: n.id,
    type: 'skill',
    position,
    data: {
      id: n.id,
      name: n.label,
      unlocked: n.class !== 'locked',
      skillType: n.class,
      customStyle: n.style,
    },
  };
}

export function SkillTreeFlow({ mermaidCode, onNodeClick }: SkillTreeFlowProps) {
  return (
    <MermaidRenderer
      mermaidCode={mermaidCode}
      nodeTypes={nodeTypes}
      mapNode={mapSkillNode}
      layoutOptions={layoutOptions}
      emptyHint="无法解析技能树数据"
      onNodeClick={(node) => onNodeClick?.(node.id)}
    />
  );
}
