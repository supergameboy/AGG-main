import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_COLORS } from './theme';

export function UndiscoveredNode(_props: NodeProps) {
  const colors = NODE_COLORS.undiscovered;
  return (
    <div
      style={{
        width: 120,
        height: 50,
        border: `1px dashed ${colors.border}`,
        borderRadius: 12,
        background: colors.bg,
        color: colors.text,
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
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <div style={{ fontSize: 13, fontStyle: 'italic' }}>???</div>
    </div>
  );
}
