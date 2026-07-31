import { type NodeProps } from '@xyflow/react';
import { NodeHandles } from './NodeHandles';
import { NODE_COLORS } from './theme';
import type { LocationNodeData } from './types';

export function UndiscoveredNode({ data }: NodeProps) {
  const d = data as LocationNodeData;
  const colors = NODE_COLORS.undiscovered;
  const custom = d.customStyle;
  return (
    <div
      style={{
        width: 120,
        height: 50,
        border: `1px dashed ${custom?.stroke ?? colors.border}`,
        borderRadius: 12,
        background: custom?.fill ?? colors.bg,
        color: custom?.color ?? colors.text,
        opacity: 0.6,
        padding: '6px 10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        pointerEvents: 'none',
        cursor: 'not-allowed',
      }}
    >
      <NodeHandles />
      <div style={{ fontSize: 13, fontStyle: 'italic' }}>???</div>
    </div>
  );
}
